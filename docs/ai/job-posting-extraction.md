# 공고 추출 파이프라인 [영역 B]

> 사용자가 올린 PDF·이미지·URL·텍스트를 깨끗한 공고 본문으로 뽑아내고, 그 본문에서 기업명·직무·마감일 같은 메타데이터를 채워 넣는 비동기 파이프라인입니다. 무거운 OCR은 별도 Python 워커로 분리하고, 백엔드는 큐를 폴링하면서 품질 게이트를 통과한 결과만 다음 분석(적합도·면접) 단계로 넘깁니다.

::: tip 이 페이지의 위치
공고 추출은 **영역 B(공고 도메인)** 담당이고, 저(영역 C)는 직접 구현하지 않았습니다. 다만 B가 만든 `job_posting`이 채워져야 제 적합도 분석(FIT)이 시작되므로, "내 앞 단계가 어떻게 도는지"를 정확히 설명할 수 있어야 합니다. 그 연결고리(AutoPrep 의존그래프)는 [적합도 분석 파이프라인](/ai/fit-analysis)에서 다룹니다.
:::

## 1. 한 줄 정의

공고 추출 파이프라인은 **여러 형식(PDF/이미지/URL/텍스트)의 원본 입력을 단일한 "공고 본문 텍스트 + 품질 메타데이터"로 정규화**하는 비동기 처리 흐름입니다. 무거운 추출(OCR 등)은 Python 워커로, 가벼운 추출과 오케스트레이션은 Spring 백엔드로 나눠 맡습니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| 추출(Extraction) | 비정형 원본(PDF·이미지·HTML)에서 사람이 읽을 본문 텍스트를 뽑아내는 것 |
| OCR | Optical Character Recognition. 이미지 속 글자를 텍스트로 변환 |
| 워커(Worker) | API 요청에 직접 응답하지 않고 백그라운드에서 무거운 작업만 처리하는 별도 프로세스 |
| 품질 게이트(Quality Gate) | 추출 결과가 다음 단계로 갈 자격이 있는지 점수로 판정하는 관문 |
| SSRF | Server-Side Request Forgery. 서버가 공격자가 시킨 내부 주소로 요청을 보내게 만드는 공격 |
| 폴링(Polling) | 큐를 일정 주기로 들여다보며 처리할 작업이 있는지 확인하는 방식 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

채용공고는 형식이 제각각입니다. 캡처 이미지, 스캔 PDF, 채용 사이트 URL, 그냥 붙여넣은 텍스트. 이걸 하나로 정규화하지 않으면 뒤의 모든 AI 분석이 입력 형식마다 따로 놀게 됩니다.

특히 **OCR을 동기(synchronous)로 처리하면 안 되는** 이유가 핵심입니다.

- **느림**: 이미지 PDF OCR은 수 초에서 수십 초가 걸립니다. HTTP 요청 스레드를 그만큼 붙잡으면 동시 업로드 몇 건에 백엔드가 마비됩니다.
- **무거움**: PaddleOCR/PaddlePaddle 같은 OCR 엔진은 모델 로딩에 메모리가 크고, JVM 백엔드에 끼워 넣기 어려운 Python 생태계입니다.
- **불안정**: OCR 실패·타임아웃이 사용자 요청을 그대로 깨뜨리면 안 됩니다.

그래서 **업로드 요청은 즉시 "접수됨"으로 응답하고**, 실제 추출은 백그라운드 워커가 큐를 폴링하며 처리합니다. 사용자에겐 알림(성공/실패/검토필요)으로 결과를 전달합니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

두 개의 런타임이 협업합니다. **Spring 백엔드(오케스트레이터)** 와 **Python 워커(무거운 추출기)**.

### 백엔드 (Java, 영역 B)

| 구성요소 | 역할 |
| --- | --- |
| `ApplicationCaseExtractionWorker` | `@Scheduled` 폴링 워커. `application_case_extraction` 큐에서 작업을 claim → 추출 → 품질 게이트 → 메타데이터 채움 → 알림 |
| `JobPostingTextExtractor` | 실제 추출 진입점. PDF는 PDFBox, URL은 Jsoup, 이미지/스캔PDF는 워커 또는 OpenAI Vision OCR |
| `JobPostingAiWorkerClient` | Python 워커에 `POST /extract/job-posting` 호출하는 HTTP 클라이언트 |
| `JobPostingAiWorkerProperties` | `careertuner.extraction.ai-worker` 설정(enabled/baseUrl/timeout). 기본 `enabled=false` |
| `ApplicationCaseExtractionQualityGate` | 추출 본문을 점수화해 `PASS / REVIEW_REQUIRED / FAILED` 판정 |

관련 테이블: `application_case`(지원 건), `job_posting`(공고 본문·추출 결과), `application_case_extraction`(추출 작업 큐), `job_analysis`(B의 후속 공고 분석).

### Python 워커 (`ml/job-posting-worker`, 영역 B)

| 파일 | 역할 |
| --- | --- |
| `scripts/15_job_posting_worker_api.py` | `http.server` 기반 HTTP 서버. `:8091`에서 `/extract/job-posting`, `/health` 제공 |
| `scripts/14_extract_document_text.py` | 실제 추출 로직: 입력 분류, OCR(PPStructureV3 → PaddleOCR 폴백), 품질 점수화 |
| `Dockerfile` | `python:3.12-slim` 멀티옵션 이미지. `INSTALL_OCR=true`일 때만 PaddleOCR 설치 |

:::warning 영역 경계
위 클래스/파일은 전부 **영역 B 소유**입니다. 제가 면접에서 "제가 짰다"고 말할 부분은 아니고, "팀의 공고 추출 파이프라인이 이렇게 돌고, 제 적합도 분석이 그 결과를 입력으로 받습니다"라고 정확히 선을 그어 설명합니다.
:::

## 5. 핵심 동작 원리 (단계/표/코드)

### 전체 흐름 (비동기)

```text
[사용자 업로드/URL/텍스트]
      │  (요청은 즉시 "접수" 응답 → 큐에 INSERT)
      ▼
application_case_extraction (QUEUED)
      │  ApplicationCaseExtractionWorker @Scheduled 폴링 (5초 주기)
      ▼
claim(QUEUED→RUNNING)  ── 원자적 UPDATE로 단 1개 인스턴스만 점유
      ▼
JobPostingTextExtractor.extract*()
   ├─ PDF  → PDFBox(텍스트층) → 비면 워커/Vision OCR
   ├─ URL  → SSRF 검증 → 소켓 fetch → Jsoup 파싱
   ├─ IMAGE→ 워커 OCR (또는 OpenAI Vision)
   └─ TEXT → 그대로
      ▼
QualityGate (PASS / REVIEW_REQUIRED / FAILED)
      ├─ FAILED         → 실패 처리 + 실패 알림
      ├─ REVIEW_REQUIRED→ 저장하되 자동분석 보류 + 검토 알림
      └─ PASS           → 메타데이터 추출 → AutoPrep 후속(FIT/INTERVIEW) 트리거 + 성공 알림
```

### 폴링·중복 방지 (워커가 여러 개여도 안전)

`@Scheduled`로 5초마다 큐를 보지만, 인스턴스가 여러 개면 같은 작업을 두 번 잡을 수 있습니다. 그래서 **조건부 UPDATE(claim)** 로 "QUEUED인 행을 RUNNING으로 바꿨을 때 영향 행이 1인 경우에만" 점유합니다.

```java
// ApplicationCaseExtractionWorker (요지)
for (ApplicationCaseExtraction e : extractionMapper.findQueuedExtractions(BATCH_SIZE)) {
    if (!claim(e.getId())) continue;   // UPDATE ... = 1 일 때만 true
    processClaimed(e);                 // 추출 → 품질 → 메타데이터
}
```

추가로 `expireStaleRunningExtractions()`가 30분 넘게 RUNNING인 작업을 타임아웃 실패 처리해, 죽은 워커가 점유한 작업이 영구히 막히지 않게 합니다.

### 추출 전략 (입력별)

| sourceType | 1차 | 폴백 |
| --- | --- | --- |
| PDF | PDFBox `PDFTextStripper`(텍스트층) | 본문이 비면 → 워커 OCR 또는 OpenAI Vision |
| IMAGE | 워커 OCR(PaddleOCR) | OpenAI Vision (정책 허용 시) |
| URL | 소켓 fetch + Jsoup 파싱 | (없음) |
| TEXT/MANUAL | 입력 그대로 | (없음) |

핵심 설계: `extractFile()`은 먼저 워커를 시도하고, 워커가 꺼져 있으면(`enabled=false`) 로컬 추출로 떨어집니다.

```java
public ExtractedPosting extractFile(StoredJobPostingFile file) {
    return aiWorkerClient.extractFile(file)       // Optional — 워커 비활성이면 empty
            .orElseGet(() -> extractFileLocally(file));  // 폴백
}
```

### URL 추출의 SSRF 방어

URL 입력은 "서버가 임의 주소를 대신 호출"하는 기능이라 위험합니다. `JobPostingTextExtractor`는 호스트를 DNS로 해석한 뒤, **loopback / 사설망 / link-local / 클라우드 메타데이터(169.254.169.254) / CGNAT** 등을 모두 차단하고, 리다이렉트도 매 홉마다 재검증합니다(`MAX_REDIRECTS=5`). 응답 본문도 1MB로 잘라 메모리 폭주를 막습니다.

### 품질 게이트 점수화

```text
점수(0~100) = 기본 20
  + 길이 가산 (500자↑ +35 / 200자↑ +25 / 100자↑ +10)
  + 섹션 키워드 수 × 12 (최대 +35)   ← "자격요건","담당업무","skills" 등 감지
  + 채용 신호(채용/지원/hiring 등) +10
  − 경고 수 × 8 (최대 −24)            ← 너무 짧음, 깨진 문자(�), 기호 노이즈 과다
```

판정 규칙:

- `FAILED`: 200자 미만이거나 점수 40 미만 → 추출 자체가 쓸모없음
- `PASS`: 점수 70↑ + 500자↑ + 섹션 2개↑ → 자동 분석으로 직행
- `REVIEW_REQUIRED`: 그 사이 → 저장은 하되 사용자 검토 후 진행

### 워커 응답 계약 (Contract)

워커는 OpenAI를 호출하지 않고, 추출 텍스트 + 안정적인 메타데이터만 돌려줍니다.

```json
{ "text": "...", "meta": {
  "strategy": "PDF_TEXT | IMAGE_PDF_OCR | IMAGE_OCR | HTML_TEXT | TEXT_DIRECT",
  "qualityScore": 0, "qualityStatus": "PASS | REVIEW_REQUIRED | FAILED",
  "warnings": [], "sectionHints": [], "modelVersions": {}, "fallbackEligible": false
} }
```

백엔드는 워커가 이미 매긴 `qualityStatus`를 신뢰해 재사용하고(`qualityFromExtractedPosting`), 워커가 안 끼었을 때만 자바 쪽 게이트로 평가합니다.

## 6. 면접 답변 3단계

**초간단 1문장**
"공고 추출은 PDF·이미지·URL·텍스트를 하나의 공고 본문으로 정규화하는 비동기 파이프라인이고, 무거운 OCR은 Python 워커로 분리했습니다."

**기본 (30초)**
"사용자 업로드는 즉시 접수만 하고 `application_case_extraction` 큐에 넣습니다. 백엔드의 `@Scheduled` 워커가 5초마다 큐를 폴링해 작업을 원자적으로 점유하고, `JobPostingTextExtractor`가 PDF는 PDFBox, URL은 Jsoup, 이미지는 Python OCR 워커로 추출합니다. 결과는 품질 게이트에서 PASS/REVIEW_REQUIRED/FAILED로 판정돼, PASS만 메타데이터를 채우고 후속 분석을 자동 트리거합니다."

**꼬리질문 대응 (왜 분리했나)**
"OCR을 HTTP 요청 스레드에서 동기로 처리하면 수십 초씩 스레드를 잡아 동시성에 치명적입니다. 또 PaddleOCR은 Python·메모리 의존이 커서 JVM에 넣기 부적합합니다. 그래서 추출은 워커로 격리하고, 백엔드는 큐 폴링·품질 판정·트랜잭션·알림만 책임지게 했습니다. 워커가 꺼져 있어도 `Optional` 기반 폴백으로 로컬 추출이나 OpenAI Vision으로 떨어지게 설계돼 있습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 왜 동기 처리가 아니라 큐+폴링 방식인가요?
OCR은 작업당 수 초~수십 초가 걸려서, HTTP 요청 스레드를 그동안 점유하면 동시 업로드 몇 건에 백엔드가 막힙니다. 큐에 넣고 즉시 응답하면 사용자 경험이 끊기지 않고, 워커가 자기 속도로 처리한 뒤 알림(`JOB_POSTING_EXTRACTION_SUCCEEDED/FAILED/REVIEW_REQUIRED`)으로 결과를 전달합니다. 실패·타임아웃이 사용자 요청을 깨뜨리지 않는 장점도 큽니다.
:::

:::details Q. 워커 인스턴스가 여러 개면 같은 작업을 중복 처리하지 않나요?
조건부 UPDATE로 막습니다. `QUEUED`인 행을 `RUNNING`으로 바꾸는 UPDATE의 영향 행 수가 1일 때만 그 작업을 점유(claim)합니다. 두 워커가 동시에 시도해도 DB 잠금 덕에 한쪽만 1을, 다른 쪽은 0을 받아 건너뜁니다. 추가로 30분 넘게 RUNNING인 작업은 stale로 보고 실패 처리해, 죽은 워커가 잡은 작업이 영구히 막히지 않게 합니다.
:::

:::details Q. URL 추출의 보안 위험과 대응은?
URL 추출은 SSRF 위험이 있습니다. 서버가 공격자가 준 주소(예: 내부 관리 API, 클라우드 메타데이터 엔드포인트)를 대신 호출하게 만들 수 있죠. 그래서 호스트를 DNS 해석한 뒤 loopback·사설망·link-local·메타데이터(169.254.169.254)·CGNAT를 모두 차단하고, 리다이렉트는 매 홉마다 재검증합니다. 응답 크기·리다이렉트 횟수·타임아웃도 제한합니다.
:::

:::details Q. PDF인데 텍스트가 안 나오면 어떻게 되나요?
PDF는 먼저 PDFBox `PDFTextStripper`로 텍스트층을 뽑습니다. 스캔본이라 텍스트가 비어 있으면, 폴백 정책(`JobPostingFallbackPolicy`)이 허용할 때 Python 워커 OCR이나 OpenAI Vision OCR로 넘어갑니다. 폴백이 비활성이고 워커도 없으면 `FAILED`로 처리하고 사용자에게 알립니다. 즉 무조건 OpenAI를 부르지 않고, 단계적으로만 비용 드는 경로를 탑니다.
:::

:::details Q. 워커가 OpenAI를 직접 안 부르는 이유는?
역할 분리와 비용·키 관리 때문입니다. 워커는 "자체 호스팅 추출기"로 PaddleOCR 같은 로컬 엔진만 씁니다. OpenAI 폴백은 Spring 관리자 설정으로 제어되며 기본 비활성입니다. 이렇게 하면 비밀키가 워커로 새지 않고, 외부 AI 호출의 켜고 끔과 사용량 집계(`ai_usage_log`)를 백엔드 한 곳에서 통제할 수 있습니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드에 화살표를 그리며 "업로드 → 큐 → 폴링 워커 → 추출 → 품질 게이트 → 후속 분석" 흐름을 30초 안에 설명해 보세요. 각 단계에서 **무엇이 실패할 수 있고 어떻게 막았는지** 한 가지씩 덧붙이면 깊이가 생깁니다.
2. "왜 OCR을 별도 프로세스로 뺐나요?"에 대해 **성능·기술스택·안정성** 세 축으로 각각 한 문장씩 답해 보세요.

## 퀴즈

<QuizBox question="공고 추출에서 무거운 OCR을 Python 워커로 분리한 가장 큰 이유는?" :choices="['Java에서는 OCR이 불가능해서', 'OCR이 수십 초 걸려 HTTP 요청 스레드를 점유하면 동시성에 치명적이라서', 'OpenAI 비용을 줄이려고', '프론트엔드에서 직접 호출하려고']" :answer="1" explanation="OCR은 작업당 수 초~수십 초가 걸려 동기 처리 시 요청 스레드를 오래 점유합니다. 그래서 큐+폴링 워커로 비동기 격리했고, PaddleOCR의 Python·메모리 의존성도 분리 이유입니다." />

<QuizBox question="여러 워커 인스턴스가 같은 추출 작업을 중복 처리하지 않도록 막는 방법은?" :choices="['랜덤 sleep으로 충돌 회피', 'QUEUED→RUNNING 조건부 UPDATE의 영향 행 수가 1일 때만 점유', '작업마다 새 스레드 생성', '프론트에서 중복 클릭 방지']" :answer="1" explanation="claim 단계에서 QUEUED 행을 RUNNING으로 바꾸는 UPDATE가 1행을 바꿨을 때만 그 워커가 작업을 가져갑니다. DB 잠금으로 동시에 시도해도 한쪽만 성공합니다." />

<QuizBox question="품질 게이트가 추출 결과를 REVIEW_REQUIRED로 판정하면 무슨 일이 일어나는지 설명해 보세요." explanation="REVIEW_REQUIRED는 PASS와 FAILED 사이의 애매한 품질입니다. 추출 본문은 저장하되 자동 후속 분석(메타데이터 추출·AutoPrep 트리거)은 보류하고, 사용자에게 검토 요청 알림(JOB_POSTING_EXTRACTION_REVIEW_REQUIRED)을 보냅니다. 사용자가 본문을 확인·보정한 뒤에야 분석 단계로 진행합니다. 즉 품질이 의심스러운 텍스트가 그대로 AI 분석 입력이 되어 잘못된 결과를 내는 것을 막는 안전장치입니다." />

# 영역 B 면접 플레이북

> 지원 건 · 공고 · 기업 분석 영역 전체를 1분/3분으로 압축하고, 기술 선택의 "왜"와 예상 꼬리질문을 한 번에 정리한 종합 답안집.

## 1. 이 페이지가 답하는 면접 질문

이 페이지는 영역 B의 모든 세부 챕터(생명주기, 공고 저장, 텍스트 추출, 공고 분석, 기업 분석, 데이터 모델, UI, 관리자)를 한 자리에 모아 **면접에서 입으로 바로 나오게** 만드는 것이 목적이다. 답해야 할 질문은 이렇다.

- "이 영역에서 뭘 만들었는지 1분 안에 설명해 보세요."
- "왜 공고문을 통째로 LLM에 맡기지 않고 구조화 추출을 했나요?"
- "왜 PDFBox·Jsoup을 직접 썼고, 왜 OCR 워커를 분리했나요?"
- "URL 입력을 받는데 SSRF는 어떻게 막았나요?"
- "왜 공고에 revision을 두었나요?"

각 주제의 깊은 설명은 세부 챕터로 미루고, 여기서는 **면접 답변의 골격과 근거 클래스/테이블**만 빠르게 짚는다.

:::tip 영역 B를 한 문장으로
"공고가 아니라 **지원 건(Application Case)**을 핵심 단위로 두고, 공고 원문을 문장 단위로 쪼개 필수/우대/담당업무로 구조화 추출하며, 모든 산출물에 출처·버전·확인 상태를 붙여 **재현 가능하고 환각을 차단한** 분석 파이프라인을 만들었다."
:::

## 2. 1분 / 3분 자기소개 스크립트

### 2.1 1분 버전 (엘리베이터 피치)

> "저는 채용 지원 전략 플랫폼에서 **지원 건·공고·기업 분석 영역**을 담당했습니다. 사용자가 공고를 PDF·이미지·URL·텍스트로 올리면, 비동기 큐 워커가 텍스트를 추출하고 품질 게이트를 통과한 경우에만 자동 파이프라인이 **공고 분석·기업 분석·적합도·면접 질문을 한 번에** 생성합니다. 핵심은 공고문을 통째로 생성하지 않고 **문장 단위로 분류해 필수/우대/담당업무를 추출**하는 구조화 방식이고, 비용 때문에 작은 자체 호스팅 LLM을 쓰되 그 모델의 오분류를 **결정론 코드 후처리**로 교정합니다. LLM이 실패하면 규칙 엔진으로 폴백해 산출물이 비지 않게 보장했습니다."

### 2.2 3분 버전 (구조: 무엇 → 왜 → 어떻게 → 신뢰성)

1. **무엇** — "영역 B는 도메인 루트인 `application_case`와 그 하위 `job_posting`·`job_analysis`·`company_analysis`, 그리고 입력을 만드는 비동기 추출 잡 `application_case_extraction`을 소유합니다. 모든 산출물에 출처·revision·사용자 확인 상태를 함께 관리하는 게 이 영역의 책임입니다."
2. **왜 구조화 추출인가** — "공고문 전체를 LLM이 다시 써버리면 원문에 없던 조건이 끼어들어 취업 의사결정을 왜곡합니다. 그래서 OCR은 입력 텍스트 확보 단계일 뿐이고, 본질은 **OCR 이후 문장 분류와 조건 추출**입니다. `BJobSentenceClassifier`가 공고를 11개 라벨로 분류한 신호를 프롬프트에 같이 넣어 LLM이 근거 위에서 추출하게 합니다."
3. **어떻게** — "LLM 호출은 `BLocalLlmClient`가 Ollama `/api/chat`로 합니다. JSON Schema를 `format`에 직접 넣어 구조화 출력을 강제하고, `temperature=0`으로 결정성을 높입니다. `generateJobAnalysis`와 `generateCompanyAnalysis` 단 두 번의 호출로 #6~#11 여섯 기능이 나옵니다."
4. **신뢰성** — "작은 파인튜닝 모델이라 경력 연차를 오분류하거나 업무 문장을 스킬에 섞는 결함이 있어서, `reconcileExperienceLevel`·`filterSkillItems`·`validateGrounding` 같은 코드 후처리로 교정합니다. 추출 스킬이 원문에 토큰으로 안 나오면 grounding 검증에서 막고 규칙 엔진으로 폴백합니다. 또 느린 LLM 호출이 DB 커넥션을 잡지 않게 **AI 호출은 트랜잭션 밖**에 두고, payload를 받은 뒤에만 INSERT를 한 트랜잭션으로 묶습니다."

## 3. 기술 선택의 "왜" — 트레이드오프 정리

면접에서 가장 깊게 파고드는 부분이 "왜 그 기술을 골랐냐"다. 각 선택을 **대안 → 선택 → 이유**로 정리한다.

| 결정 | 대안 | 선택 | 이유 |
| --- | --- | --- | --- |
| 텍스트 PDF 추출 | OCR로 전부 처리 | **Apache PDFBox `PDFTextStripper`** | 디지털 PDF는 이미 텍스트 레이어가 있어 OCR이 불필요·부정확. 텍스트가 비었을 때만 OCR 단계로 넘어가는 2단 전략 |
| HTML 파싱 | 정규식, 전체 페이지 저장 | **Jsoup** | `script/style/noscript/svg` 제거 후 `body().text()`만 뽑아 노이즈 제거. 정규식으로 HTML 파싱은 깨지기 쉬움 |
| URL 가져오기 | 표준 `HttpClient`/라이브러리 | **직접 소켓 fetch(`DirectSocketHttpFetcher`)** | DNS 재바인딩(rebinding) 방어를 위해 **검증한 IP로 직접 연결**해야 함. 일반 클라이언트는 호스트명으로 재해석해 우회 가능 |
| OCR 모델 위치 | 메인 백엔드 내장 | **별도 Python 워커로 분리(기본 OFF)** | PaddleOCR는 무거운 파이썬 의존성·GPU/모델 로딩이 필요. JVM에 박으면 부팅·메모리 부담. HTTP 경계로 분리하면 끄고 켜기 쉬움 |
| 공고 저장 | 덮어쓰기(UPDATE) | **revision append-only** | "이 분석이 어느 원문 버전 기준인지"를 못 박아 재현성·stale 판정 가능. 원문을 못 지우게 해 감사 가능성 확보 |
| 영속성 | JPA | **MyBatis** | 팀 표준(JPA 금지). 복잡한 조건부 UPDATE를 SQL로 직접 표현하기 좋음 |
| LLM 경로 | OpenAI 직결 | **자체 호스팅 Ollama R1 + 규칙 폴백** | 비용·데이터 주권·오프라인성. 자체 LLM 단계는 무과금(`creditUsed=0`) |

:::details "왜 PDFBox로 텍스트 PDF를 먼저 시도하는가?" 짧은 코드
```java
// JobPostingTextExtractor.extractFileLocally (요약)
if ("PDF".equals(file.sourceType())) {
    String text = extractTextPdf(file);     // PDFBox: 텍스트 레이어 추출
    if (text.isBlank()) {                    // 스캔본이라 텍스트가 없으면
        if (!fallbackPolicy.allowed(STAGE_PDF_OCR)) { /* FAILED */ }
        text = openAiClient.extractPdfText(...); // 그때만 OCR 폴백(기본 OFF)
    }
    return new ExtractedPosting(..., limit(text), ...);
}
```
디지털 PDF는 PDFBox로 즉시·정확·무료로 추출되고, 스캔 이미지 PDF일 때만 OCR로 내려간다. 비용과 품질을 동시에 잡는 2단 구조다.
:::

## 4. 왜 SSRF 방어를 직접 구현했나 (면접 단골)

URL로 공고를 가져오는 기능은 **서버가 임의 주소로 요청을 보내는 구조**라, 사용자가 `http://169.254.169.254`(클라우드 메타데이터)나 사내 IP를 넣으면 내부망을 긁어올 수 있다. 이걸 SSRF(Server-Side Request Forgery)라 한다. `JobPostingTextExtractor`는 다층으로 막는다.

```text
URL 입력
 → scheme 검사(http/https만)
 → 호스트명이 localhost류면 즉시 차단
 → DNS 해석 후 모든 IP를 isUnsafeAddress로 검사
     (loopback / private / link-local / multicast /
      169.254.169.254 메타데이터 / 100.64/10 CGNAT / IPv6 ULA(fc00::/7))
 → 검증 통과한 IP로 "직접" 소켓 연결 (DNS 재바인딩 차단)
 → 리다이렉트(3xx)마다 Location을 다시 전부 재검증 (최대 5회)
 → 응답 body 1MB · 헤더 64KB 상한
```

핵심 포인트 3가지:
1. **검증한 IP로 직접 연결한다.** 호스트명을 다시 해석하는 일반 HTTP 클라이언트는 "검증 시점엔 안전한 IP, 연결 시점엔 사내 IP"로 바꾸는 DNS 재바인딩에 뚫린다. `DirectSocketHttpFetcher`는 `validateSafeHost`가 통과시킨 `InetAddress`로 직접 `Socket`을 연다.
2. **리다이렉트도 다 의심한다.** 첫 URL만 검사하면 `302`로 메타데이터 주소로 점프시킬 수 있어, 매 리다이렉트의 `Location`을 `validateRedirectUrl`로 재검증한다.
3. **응답 크기를 제한한다.** body 1MB·헤더 64KB·헤더 한 줄 8KB 상한으로 메모리 고갈을 막는다.

:::warning 면접 함정 질문 — "private IP만 막으면 되지 않나요?"
부족하다. ① 클라우드 메타데이터(`169.254.169.254`)는 link-local이라 별도 처리가 필요하고, ② CGNAT 대역(`100.64.0.0/10`)·IPv6 ULA(`fc00::/7`)도 내부망일 수 있으며, ③ DNS 재바인딩은 "검증 후 연결" 사이의 시점 차이를 노리므로 **검증한 IP로 직접 연결**해야만 닫힌다. 코드는 이 셋을 모두 처리한다.
:::

## 5. 왜 OCR 워커를 분리했나 (서비스 경계)

OCR은 영역 B에서 **선택적이고 기본 OFF**인 경로다. 그런데도 일부러 별도 서비스로 설계한 이유를 정리한다.

| 관점 | 메인 백엔드에 내장했다면 | 분리한 결과 |
| --- | --- | --- |
| 의존성 | PaddleOCR·PaddlePaddle·PyMuPDF를 JVM 옆에 둘 수 없음(파이썬 생태계) | `ml/job-posting-worker`에 격리 |
| 자원 | CPU OCR는 첫 케이스 모델 로딩+추론에 수십 초(긴 이미지 27.5s 실측) | 메인 부팅·응답 시간과 무관 |
| 토글 | 켜고 끄기 어려움 | `JOB_POSTING_AI_WORKER_ENABLED:false`로 환경변수 1개 토글 |
| 계약 | — | `POST /extract/job-posting`이 `text`+`meta`(strategy/qualityScore/qualityStatus/...) 형태로 응답하는 HTTP 계약 |

설계 원리는 **"품질이 다른 작업은 프로세스 경계로 가른다"**이다. 메인 백엔드는 텍스트 PDF·HTML 같은 **빠르고 결정적인** 추출만 직접 하고, 무거운 OCR은 HTTP 너머로 위임한다. 워커가 꺼져 있으면 `JobPostingAiWorkerClient.disabled()`가 빈 결과를 주고 로컬 추출로 자연스럽게 떨어진다.

:::tip 자체 호스팅 강조
이 워커도 외부 API를 호출하지 않는 **self-hosted PaddleOCR**다. OpenAI OCR 폴백은 또 별개의 경로(`JobPostingFallbackPolicy`)로, 전역 토글 ON + 단계 allowlist(`JOB_POSTING_PDF_OCR`/`JOB_POSTING_IMAGE_OCR`) 둘 다 켜야 작동하고 기본은 꺼져 있다.
:::

## 6. 왜 공고에 revision을 두었나 (재현성)

면접에서 "왜 그냥 덮어쓰지 않았냐"는 거의 항상 나온다. 답의 핵심은 **분석의 재현성**이다.

- `job_posting`은 **append-only**다. UPDATE 메서드 자체가 없고, `UNIQUE(application_case_id, revision)`로 같은 케이스 안에서 revision이 1씩 증가한다.
- `job_analysis`는 분석 시점의 `job_posting_id`+`job_posting_revision`을 **함께 저장(동결)**한다. 즉 "이 분석은 rev 3 원문 기준"이라는 사실이 고정된다.
- 사용자가 공고를 수정해 rev 4가 생기면, 프런트는 `jobPostingRevision !== latestJobPostingRevision`을 비교해 **"이전 공고 기준 분석" stale 배지**를 띄우고 재분석을 권한다.
- 원문이 삭제돼도 분석은 `ON DELETE SET NULL`로 보존돼, 분석 결과 자체는 사라지지 않는다.

```text
rev 1 공고 ─ 분석 A (rev=1 동결)
rev 2 공고(수정) ─ 분석 B (rev=2 동결)
                    └ 분석 A는 "stale: rev1 기준" 으로 표시
```

이 설계가 없으면 "분석이 어느 원문을 봤는지" 추적 불가능해지고, 공고가 바뀌었는데도 옛 분석을 최신인 양 보여주는 사고가 난다.

낙관적 동시성도 같이 묻는다: `replaceJobPosting`은 `COALESCE(MAX(revision),0)+1`로 다음 revision을 계산해 INSERT하고, 동시 삽입으로 `DuplicateKeyException`이 나면 최대 3회 재시도한다.

## 7. 구현됨 vs 계획 — 정직하게 구분 (이 영역의 신뢰 포인트)

면접에서 "전부 됐어요"라고 하면 오히려 의심받는다. **명확히 선을 긋는 것**이 강점이다.

| 항목 | 상태 |
| --- | --- |
| 자체 호스팅 LLM(Ollama R1) 공고/기업 분석 | 구현·기본 ON |
| `self-rules-v1` 규칙 폴백 | 구현 |
| LLM 출력 보정(연차/스킬/grounding) | 구현 |
| 추출 품질 게이트(규칙 3단계) | 구현 |
| URL SSRF 방어 | 구현(견고) |
| 텍스트 PDF 추출(PDFBox) | 구현 |
| 공고 revision append-only + 동결 | 구현 |
| OpenAI OCR/분석 폴백 | 구현됐으나 **기본 OFF** |
| Python OCR 워커(PaddleOCR) | 구현됐으나 **기본 OFF** |
| `jobanalysis/ai` OpenAI/OSS provider 추상화 | **죽은 코드(미배선)** |
| 면접 포인트(`interview_points`) → D 직접 입력 | **부분/간접**(스킬 경유) |
| 기업 외부 뉴스 실시간 조회 | **미구현(의도적)** |
| KLUE-RoBERTa 문장 분류 모델 | **계획**(현재는 규칙 기반 `BJobSentenceClassifier`) |

:::details "계획과 구현의 갭"을 면접에서 강점으로 말하는 법
세 가지 갭을 솔직히 말하면 "코드를 정확히 안다"는 신호가 된다.
1. **죽은 코드**: `jobanalysis/ai` 패키지(OpenAI Responses vs OSS `/chat/completions` 선택 추상화)는 자기 패키지 안에서만 참조하고 외부 주입이 0건이다. 한때 OpenAI 직결이던 설계 잔재이고, 현재 활성 경로는 `BAnalysisGenerationService → BLocalLlmClient` 단일 경로다.
2. **`interview_points` 미소비**: 기업 분석의 면접 포인트는 사용자에게 카드로 보여주지만, 자동 파이프라인의 D 질문 생성(`createInterviewPrep`)은 이걸 직접 입력하지 않고 `job_analysis`의 스킬 + 회사/직무명으로 **하드코딩 6문항 템플릿**을 만든다. "계획은 직접 입력, 구현은 스킬 경유 간접"이라고 말하면 정확하다.
3. **프롬프트 버전**: 런타임 카탈로그는 둘 다 `VERSION="b-v1"`이다. 스토리보드 데모에 보이는 "b-v3.2"는 목업 빌드 값이라 인용하면 안 된다.
:::

## 8. 면접 답변 3단계 (정의 → 설계 → 신뢰성)

어떤 B 질문을 받아도 이 3단 골격으로 답하면 막히지 않는다.

1. **정의**: "이건 지원 건을 루트로 하는 트리에서 ○○를 담당하는 부분입니다." (예: 공고 저장이면 "공고 원문을 revision 단위로 보관하는 append-only 테이블")
2. **설계 의도**: "○○를 위해 △△하게 설계했습니다." (예: "분석 재현성을 위해 분석 시점의 revision을 동결했습니다")
3. **신뢰성/방어**: "실패·악용·환각에 대비해 □□를 했습니다." (예: "원문이 삭제돼도 SET NULL로 분석을 보존하고, 동시 삽입은 재시도로 처리합니다")

## 9. 예상 질문 + 모범답안 (12선)

**Q1. 영역 B의 핵심 단위가 왜 '공고'가 아니라 '지원 건'인가요?**
A. 사용자는 같은 공고에도 여러 번·다른 전략으로 지원할 수 있고, 분석·면접·첨삭이 전부 "이 지원에 대한" 맥락을 가집니다. 그래서 도메인 루트를 `application_case`로 두고 공고·분석·추출을 그 아래에 `ON DELETE CASCADE`로 매답니다. 지원 건이 정리되면 하위가 함께 정리돼 정합성이 유지됩니다.

**Q2. 공고문을 그냥 LLM에 통째로 넣어 분석하면 안 되나요?**
A. 그러면 원문에 없던 조건이 생성돼 사용자가 그걸 "사실"로 믿고 지원 결정을 내릴 위험이 있습니다. 그래서 OCR은 입력 확보일 뿐이고, 본질은 `BJobSentenceClassifier`가 문장을 11라벨로 분류한 뒤 그 신호 위에서 필수/우대/담당업무를 **추출**하는 것입니다. 추출 스킬이 원문에 실제로 등장하는지 `validateGrounding`으로 검증하기까지 합니다.

**Q3. 작은 자체 모델을 쓰면 품질이 떨어지지 않나요?**
A. 떨어지는 부분을 코드로 보정합니다. R1 모델이 "경력 5년↑"을 JUNIOR로 오분류하면 `reconcileExperienceLevel`이 원문에서 정규식으로 연차를 파싱해 보정하고, "결제 시스템 백엔드 API 설계 및 개발" 같은 업무 문장을 스킬에 섞으면 `filterSkillItems`가 길이·단어수·"및/또는/담당" 패턴으로 걸러냅니다. 비용은 작은 모델로 아끼고 품질은 결정론 후처리로 끌어올리는 전략입니다.

**Q4. LLM이 실패하면 사용자에게 에러가 보이나요?**
A. 아닙니다. LLM 호출이 재시도까지 실패하면 `self-rules-v1` 규칙 엔진으로 폴백해 빈 산출물이 나오지 않게 합니다. 폴백 사실은 `ai_usage_log`에 "시도 모델+폴백 사유"를 FAILED로 남기고 규칙 결과는 SUCCESS로 기록합니다. 사용자에게 보이는 메시지는 `userFacingFailureMessage`가 SQL·스택트레이스를 마스킹합니다.

**Q5. 왜 LLM 호출을 트랜잭션 밖에 두나요?**
A. LLM 호출은 최대 수 분 걸릴 수 있는데, 트랜잭션 안에서 호출하면 그동안 DB 커넥션을 잡고 있어 커넥션 풀이 고갈됩니다. 그래서 payload를 다 받은 뒤에만 `TransactionTemplate`로 INSERT·상태전이·로그를 한 트랜잭션에 묶고, 실패하면 `restorePreviousStatus`로 상태를 되돌립니다.

**Q6. 같은 공고에 추출이 동시에 두 번 돌면요?**
A. `application_case_extraction`에 생성(가상) 컬럼 `active_status_marker`를 두고 `UNIQUE(application_case_id, active_status_marker)`를 걸어 **케이스당 진행 중 1건**을 DB 레벨에서 강제합니다. 워커는 `claimQueuedExtraction`으로 QUEUED→RUNNING 조건부 UPDATE를 하고 1행 성공해야 점유하므로 멀티 인스턴스에서도 안전합니다.

**Q7. 품질 게이트는 왜 3단계인가요?**
A. 저품질 OCR 결과로 자동 분석이 돌면 쓰레기 산출물이 나옵니다. PASS만 자동 진행하고, REVIEW_REQUIRED는 분석을 멈춰 사용자 검수를 끼우며, FAILED는 재시도나 직접 입력으로 유도합니다. "애매한 경우 사람을 끼운다"는 안전장치입니다.

**Q8. 기업 분석에서 환각은 어떻게 막나요?**
A. 세 층입니다. ① 데이터 모델에서 `verified_facts`와 `ai_inferences`를 **별 컬럼으로 분리**하고, ② 프롬프트에서 "외부 웹 검색 금지, 입력(회사명/직무명/공고문)에서 직접 확인되는 사실만 verifiedFacts에, 대표자·설립일·매출 등 입력에 없는 정보 금지"를 명문화하며, ③ 검증 단계에서 검증 가능한 회사 사실이 없으면 폴백시킵니다. UI도 "검증된 사실 vs AI 추론"을 2분할로 보여줍니다.

**Q9. URL 입력에서 SSRF는 어떻게 막나요?**
A. 4절에서 설명한 다층 방어입니다. scheme 화이트리스트 → localhost 차단 → DNS 해석 후 모든 IP를 사설/메타데이터/CGNAT/ULA까지 검사 → **검증한 IP로 직접 소켓 연결**(DNS 재바인딩 차단) → 리다이렉트마다 재검증 → body·헤더 크기 상한입니다. 일반 HTTP 클라이언트로는 재바인딩을 막을 수 없어 직접 소켓을 열었습니다.

**Q10. 프런트는 분석을 어떻게 트리거하나요?**
A. 프런트는 `createJobAnalysis`를 직접 호출하지 않습니다. 분석 실행의 단일 진실원은 **백엔드 자동 파이프라인**이고, 프런트는 추출·검수 통과를 트리거로만 씁니다. 저장은 순수 헬퍼(`jobPostingConfirm.ts`)가 ① 무변경 no-op ② 본문만 수정→`confirm`(OCR 재실행 없이 분석만 갱신) ③ 소스/URL 변경→재추출 큐잉의 3분기로 라우팅합니다.

**Q11. 화면을 떠나도 추출 진행을 어떻게 보장하나요?**
A. 추출은 비동기 큐 워커가 처리하므로 화면과 무관하게 계속됩니다. UI는 전역 `ApplicationExtractionMonitor`(4초 폴링)와 `localStorage` 브리지로 다른 화면에서도 진행·완료 토스트를 띄우고, 180초 넘게 멈춰 있으면 stuck으로 보고 토스트를 억제합니다.

**Q12. AI 사용량은 어떻게 기록하나요? 자체 LLM도 과금하나요?**
A. 모든 B AI 호출을 `ai_usage_log`에 `feature_type`(JOB_ANALYSIS/COMPANY_RESEARCH/JOB_POSTING_OCR/JOB_POSTING_METADATA)으로 남깁니다. 외부 LLM은 `recordSuccess`로 `ceil(tokens/1000)` 크레딧을 쓰지만, **자체 호스팅 LLM은 `recordLocalSuccess`로 크레딧 0**입니다. 무과금이 자체 모델을 쓰는 이유 중 하나입니다.

## 10. 꼬리질문 + 모범답안 (심화 5선)

**Q13. `jobanalysis/ai` 패키지가 죽은 코드라는 걸 어떻게 알았나요?**
A. 그 패키지의 `JobAnalysisAiProvider`(`@Component`)·`OpenAiJobAnalysisService`·`OssJobAnalysisClient` 등을 외부에서 참조하는 곳을 검색하면 매칭이 자기 패키지 파일들뿐입니다. 스프링 빈으로 등록은 돼 있지만 어디서도 주입·호출하지 않으니 배선되지 않은 설계 잔재입니다. 한때 OpenAI 직결 시절의 추상화였고, 자체 LLM으로 통합되면서 `BAnalysisGenerationService` 단일 경로만 남았습니다.

**Q14. grounding 검증은 정확히 어떻게 동작하나요?**
A. 추출된 필수·우대 스킬을 토큰으로 쪼개 공고 원문(공백 제거·소문자화)에 등장하는지 셉니다. 토큰 2개 이하면 1개라도 맞으면, 그 이상이면 절반 이상 맞으면 grounded로 봅니다. grounded 비율이 임계(기본 0.6) 미만이면 예외를 던져 규칙 폴백으로 보냅니다. "근거 없이 지어낸 스킬"을 차단하는 장치입니다.

**Q15. 구조화 출력은 어떻게 강제하나요?**
A. `BLocalLlmClient.chat`이 Ollama `/api/chat` 요청의 `format` 필드에 **JSON Schema를 직접** 넣습니다. `experienceLevel`은 enum(JUNIOR/MID/SENIOR), `difficulty`도 enum(EASY/NORMAL/HARD)으로 제약하고 `additionalProperties:false`, `required`로 누락을 막습니다. 그래도 소형 모델이 enum 밖 값을 줄 수 있어 `normalizeExperienceLevel`로 한 번 더 정규화합니다. 자세한 패턴은 [구조화된 출력](/ai/openai-structured-output) 참고.

**Q16. 기업 분석의 신선도(refresh)는 왜 필요한가요?**
A. 기업 정보는 시간이 지나면 낡습니다. 자동 파이프라인은 `checked_at`을 기록하고 `refresh_recommended_at`을 `checked_at + 30일`로 설정합니다. 관리자 화면은 `refreshDue` 필터로 재조회가 필요한 분석을 골라낼 수 있습니다. "노후 정보를 사실인 양 보여주지 않는다"는 원칙의 구현입니다.

**Q17. 영역 B의 출력은 다른 영역에 어떻게 연결되나요?**
A. `required_skills`/`preferred_skills`/`duties`는 [영역 C](/area-c/)의 적합도 판정 기준이 되고, 공고·기업 분석은 [영역 D](/area-d/) 면접과 영역 E 첨삭의 맥락으로 쓰입니다. 다만 D 질문 생성은 현재 `interview_points`를 직접 쓰지 않고 스킬을 경유하는 간접 연결이라는 점은 정직하게 구분해 말합니다. B는 A 데이터를 **읽기만** 하고 수정하지 않습니다.

## 11. 직접 말해보기

다음 질문에 **소리 내어** 60초씩 답해 보고, 막히면 해당 챕터로 돌아가라.

1. "지원 건 생명주기를 DRAFT부터 READY까지 상태 전이로 설명해 보세요." → [지원 건 생명주기](/area-b/application-lifecycle)
2. "공고 revision이 왜 필요하고 stale은 어떻게 판정하나요?" → [공고 원문·revision](/area-b/job-posting-storage)
3. "URL 공고 추출에서 SSRF를 어떻게 막았나요?" → [텍스트 추출·OCR·SSRF](/area-b/text-extraction-ocr)
4. "공고문에서 필수/우대를 어떻게 구분해 뽑나요?" → [필수·우대 조건](/area-b/required-preferred)
5. "기업 분석에서 사실과 추론을 어떻게 분리하나요?" → [기업 현황 요약](/area-b/company-analysis)
6. "작은 LLM의 결함을 코드로 어떻게 보정하나요?" → [공고문 분석](/area-b/job-analysis)

## 퀴즈

<QuizBox question="영역 B에서 URL로 공고를 가져올 때 일반 HTTP 클라이언트 대신 '검증한 IP로 직접 소켓 연결'을 한 가장 핵심적인 이유는?" :choices="['속도가 더 빠르기 때문', 'DNS 재바인딩(검증 후 호스트명 재해석)으로 사내 IP에 접근하는 우회를 막기 위해', 'HTTPS를 지원하려고', 'Jsoup이 소켓만 받기 때문']" :answer="1" explanation="일반 클라이언트는 연결 시점에 호스트명을 다시 해석해, 검증 시점엔 안전하던 주소가 연결 시점엔 내부 IP로 바뀌는 DNS 재바인딩에 뚫린다. DirectSocketHttpFetcher는 validateSafeHost가 통과시킨 InetAddress로 직접 연결해 이 시점 차이를 닫는다." />

<QuizBox question="job_analysis가 분석 시점의 job_posting_revision을 함께 저장(동결)하는 주된 목적은?" :choices="['저장 공간 절약', '분석이 어느 원문 버전 기준인지 못 박아 재현성과 stale 판정을 가능하게 하려고', 'LLM 토큰을 줄이려고', '관리자 권한 검사']" :answer="1" explanation="공고는 append-only revision으로 쌓이고, 분석은 그 시점의 revision을 동결한다. 이후 공고가 수정되면 latest revision과 비교해 '이전 공고 기준 분석' stale 배지를 띄울 수 있고, 어느 원문을 봤는지 추적 가능해 재현성이 확보된다." />

<QuizBox question="기업 분석(#10)에서 LLM 환각을 막는 '세 층 방어'에 해당하지 않는 것은?" :choices="['verified_facts와 ai_inferences를 별 컬럼으로 분리(데이터 모델)', '외부 웹 검색 금지를 명문화한 프롬프트', '검증 가능한 회사 사실이 없으면 규칙 폴백', '공고를 통째로 다시 생성해 정확도를 높임']" :answer="3" explanation="세 층은 데이터 모델 분리, 프롬프트 안전 불변식, 검증→폴백이다. '공고를 통째로 재생성'은 오히려 원문에 없는 정보를 만들어 환각을 키우므로 영역 B의 철학과 정반대다. B는 생성이 아니라 구조화 추출을 한다." />

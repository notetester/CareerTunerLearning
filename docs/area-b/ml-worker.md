# 공고 추출 워커 — Python 분리

> 공고 OCR/추출은 Spring(JVM) 안에서 돌리지 않고, `POST /extract/job-posting` 하나만 노출하는 **별도 Python 프로세스**로 떼어냈다. 이유는 단 하나 — OCR 의존성(PaddleOCR/PyMuPDF)이 JVM에 들어갈 수 없는 무거운 네이티브 스택이기 때문이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

`ml/job-posting-worker`는 채용공고 파일(PDF·이미지·HTML·텍스트)을 받아 **추출 텍스트 + 품질 게이트 메타데이터**를 돌려주는 자체 호스팅 Python 워커다. Spring 백엔드의 `JobPostingTextExtractor`가 HTTP로 이 워커를 호출하고, 워커가 꺼져 있거나 응답하지 않으면 **JVM 내부의 경량 추출 경로로 폴백**한다.

면접에서 받을 법한 질문:

- "OCR을 왜 백엔드 안에 안 넣고 별도 프로세스로 뺐나요?"
- "그 워커는 무슨 웹 프레임워크로 만들었나요? 왜 그렇게 했나요?"
- "워커가 죽으면 공고 등록이 막히나요? 어떻게 안 막히게 했나요?"
- "Spring과 Python 워커는 어떤 계약(contract)으로 통신하나요?"

:::tip 이 페이지의 핵심 한 문장
"언어·의존성·실패 격리"를 위해 추출을 프로세스 경계로 분리하되, **워커는 기본 OFF이고 항상 JVM-local 폴백이 살아 있어** 워커가 없어도 시스템은 동작한다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

워커를 별도 프로세스로 뺀 결정은 세 가지 압력에서 나왔다.

| 압력 | 워커 분리로 얻는 것 | 만약 JVM 안에 넣었다면 |
| --- | --- | --- |
| **의존성** | `paddleocr`/`paddlepaddle`/`PyMuPDF`는 Python 네이티브 휠. 이걸 JVM에서 직접 쓰는 건 사실상 불가 | JNI 브리지나 별도 OCR 서비스가 어차피 필요 |
| **언어** | OCR 생태계(PaddleOCR, PPStructureV3)는 Python이 1급 시민 | Java OCR 라이브러리는 한글 레이아웃 인식 품질이 떨어짐 |
| **실패 격리** | 무거운 모델 로딩·추론(수십 초)이 Spring 요청 스레드/커넥션을 점유하지 않음 | OCR 한 건이 멈추면 백엔드 톰캣 스레드가 같이 묶임 |

트레이드오프도 정직하게 본다. 프로세스를 나누면 **네트워크 홉(HTTP)·직렬화·타임아웃·헬스체크**라는 운영 비용이 생긴다. 그래서 워커는 다음 두 장치로 그 비용을 감당 가능하게 만들었다.

1. **항상 폴백이 있다.** 워커 호출은 `Optional`을 돌려주고, 비어 있으면 JVM 내부 추출로 떨어진다(§4). 워커는 "있으면 더 좋은" 가속기지 단일 장애점이 아니다.
2. **얇은 계약.** Spring↔워커는 단일 엔드포인트 + 고정 JSON 스키마(§3)만 공유한다. 워커 내부 구현(OCR 엔진 교체 등)이 바뀌어도 계약은 그대로다.

:::warning 그라운딩 정정 — 프레임워크는 Flask가 아니다
이 페이지의 출제 의도에는 "Flask"라고 적혀 있지만 **실제 코드에는 Flask가 없다**(`requirements.txt`는 `pillow`/`pypdf`뿐, `Flask`/`FastAPI` 임포트 0건). 워커는 Python **표준 라이브러리 `http.server`**(`BaseHTTPRequestHandler` + `HTTPServer`)로 구현돼 있다. 외부 웹 프레임워크 의존성을 0으로 두려는 선택으로 읽는 게 정확하다 — 엔드포인트가 `/health`, `/extract/job-posting` 두 개뿐이라 프레임워크가 필요 없다. 면접에서 "Flask로 만들었다"고 답하면 코드와 어긋난다.
:::

## 3. 어떤 기술로 구현했나 (실제 파일 · 클래스 근거)

### 3.1 Python 쪽 (워커 본체)

| 파일 | 역할 |
| --- | --- |
| `ml/job-posting-worker/scripts/15_job_posting_worker_api.py` | HTTP 서버. `WorkerHandler(BaseHTTPRequestHandler)`가 `GET /health`·`POST /extract/job-posting` 처리 |
| `ml/job-posting-worker/scripts/14_extract_document_text.py` | 추출 엔진. 전략 분류 → 텍스트 추출(PDF/OCR/HTML) → 품질 점수화. **API 스크립트가 이 모듈을 동적 로드**해서 재사용 |
| `ml/job-posting-worker/requirements.txt` | 기본 런타임 의존성: `pillow`, `pypdf`만 |
| `ml/job-posting-worker/requirements-ocr.txt` | **선택** OCR 런타임: `paddleocr` 3.x, `paddlepaddle` 3.x, `PyMuPDF` |
| `ml/job-posting-worker/Dockerfile` | `python:3.12-slim` 기반, `ARG INSTALL_OCR`로 OCR 스택 포함 여부 분기, 비루트 `appuser` |

핵심: API 스크립트는 `importlib.util`로 `14_extract_document_text.py`를 모듈로 띄워(`load_document_module()`) `normalize_text`/`analyze_quality`/`extract_document` 같은 함수를 그대로 호출한다. 즉 "추출 로직"과 "HTTP 표면"이 한 파일에 섞이지 않고 분리돼 있다.

### 3.2 Spring 쪽 (워커를 부르는 클라이언트)

| 파일 | 역할 |
| --- | --- |
| `backend/.../jobposting/service/JobPostingAiWorkerClient.java` | `java.net.http.HttpClient`로 워커에 POST, 응답 JSON을 `ExtractedPosting`으로 파싱 |
| `backend/.../jobposting/service/JobPostingAiWorkerProperties.java` | `careertuner.extraction.ai-worker.*` 설정 바인딩(`enabled`/`baseUrl`/`timeout`) |
| `backend/.../jobposting/service/JobPostingTextExtractor.java` | 워커 우선 호출 후 실패 시 JVM-local 추출로 폴백하는 진입점 |
| `backend/src/main/resources/application.yaml` | `enabled: false`(기본 OFF), `base-url: http://127.0.0.1:8091`, `timeout: 120s` |

워커는 **OpenAI를 호출하지 않는다**(README: "It does not call OpenAI"). OpenAI OCR 폴백은 별개로 `JobPostingFallbackPolicy`가 관리하며 그것도 기본 OFF다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 Spring → 워커 → 폴백 흐름

```text
공고 등록(파일/URL)
   │
   ▼
JobPostingTextExtractor.extractFile(file)
   │
   ├─ aiWorkerClient.extractFile(file)   // enabled=false 면 Optional.empty()
   │      │ POST http://host:8091/extract/job-posting  (JSON)
   │      ▼
   │   [Python 워커] 전략분류→추출→품질게이트→JSON 반환
   │
   └─ .orElseGet(() -> extractFileLocally(file))   // 워커 없으면 JVM 내부 추출
```

폴백의 정수는 이 한 줄이다(`JobPostingTextExtractor`):

```java
public ExtractedPosting extractFile(StoredJobPostingFile file) {
    return aiWorkerClient.extractFile(file)        // Optional<ExtractedPosting>
            .orElseGet(() -> extractFileLocally(file)); // 비면 JVM-local
}
```

`extractFile`은 `enabled=false`면 즉시 `Optional.empty()`를 돌려주므로, 워커가 꺼져 있어도 호출 자체가 비용 없이 폴백으로 흐른다.

### 4.2 워커 내부 처리 단계

워커가 요청을 받으면 `extract_job_posting(payload)`이 입력 형태에 따라 분기한다.

| 입력 | 처리 | strategy |
| --- | --- | --- |
| `filePath` 존재 | `extract_document()`로 파일 추출(임시 디렉터리에 txt/meta 작성) | 아래 분류 결과 |
| `sourceType=TEXT/MANUAL` | 요청 본문 텍스트 그대로 정규화 | `TEXT_DIRECT` |
| `sourceType=URL/HTML` | `html` 있으면 `strip_html_text`, 없으면 본문 텍스트 | `HTML_TEXT` |

파일 추출의 전략 분류(`classify_strategy`)는 확장자/이미지 비율 기반이다.

| 조건 | strategy | 의미 |
| --- | --- | --- |
| `.txt`/`.md` | `TEXT_DIRECT` | 추출 없이 정규화만 |
| `.html`/`.htm` | `HTML_TEXT` | 태그 제거 후 텍스트화 |
| `.pdf` + 텍스트 레이어 있음 | `PDF_TEXT` | `pypdf`로 직접 추출(OCR 불필요) |
| `.pdf` + 텍스트 없음(스캔본) | `IMAGE_PDF_OCR` | OCR 필요 |
| 이미지 + 세로로 긴 형태 | `LONG_IMAGE_TILING` | 긴 이미지 처리 경로 |
| 일반 이미지 | `IMAGE_OCR` | OCR 필요 |

OCR이 필요한 경로는 **3단 우선순위**로 텍스트를 건진다(`extract_text_for_strategy`):

1. **기존 OCR 텍스트**(`existing_ocr_dir`에 사전 생성본이 있으면 그대로) → `textSource=EXISTING_OCR`
2. **PPStructureV3**(레이아웃 인식 OCR — 표·2단 공고의 읽기 순서 복원) → `PPSTRUCTURE`
3. **PaddleOCR line-OCR**(레이아웃 실패/빈 결과 시 폴백) → `PADDLE_OCR`

### 4.3 품질 게이트 (워커가 판정해서 Spring에 넘김)

추출 텍스트는 `analyze_quality`로 0~100점을 받고 3단계 상태로 환산된다. 이 점수가 §[공고 추출 품질 게이트](/area-b/text-extraction-ocr)와 자동 분석 진행 여부를 가른다.

```text
길이 점수(최대 35) + 섹션 키워드 점수(최대 35) + 구조 점수(최대 25) − 노이즈 패널티(최대 25)
```

- 섹션 키워드: "담당업무"·"자격요건"·"우대사항"·"기술스택" 등 + 영문 헤더. 공백·대소문자 무시 매칭.
- 노이즈: "로그인"·"회원가입"·"공유하기" 등 채용 사이트 UI 잔재.
- 상태 판정: 길이 &lt; 200자면 `FAILED`, 점수≥70 + 길이≥500 + 섹션≥2개면 `PASS`, 점수≥40이면 `REVIEW_REQUIRED`, 나머지 `FAILED`.

### 4.4 응답 계약 (Spring과의 인터페이스)

워커는 항상 `text` + `meta`를 돌려준다. Spring의 `parseResponse`가 이 키들을 `ExtractedPosting`으로 매핑한다.

```json
{
  "text": "...정규화된 추출 텍스트...",
  "meta": {
    "strategy": "PDF_TEXT | IMAGE_PDF_OCR | IMAGE_OCR | LONG_IMAGE_TILING | HTML_TEXT | TEXT_DIRECT | WORKER_ERROR",
    "qualityScore": 0,
    "qualityStatus": "PASS | REVIEW_REQUIRED | FAILED",
    "metrics": {},
    "warnings": [],
    "sectionHints": [],
    "modelVersions": {},
    "fallbackEligible": false,
    "generatedAt": "..."
  }
}
```

`fallbackEligible`은 OCR 경로(`IMAGE_PDF_OCR`/`LONG_IMAGE_TILING`/`IMAGE_OCR`)일 때만 `true`다 — "이 결과가 부실하면 OpenAI OCR 폴백을 검토할 수 있는 단계"라는 신호다.

### 4.5 실패를 데이터로 돌려주는 설계

워커는 예외가 나도 5xx로 그냥 끊지 않고 **진단 가능한 JSON**으로 변환한다. `WorkerHandler.do_POST`가 예외를 잡아 `error_response(exc)`를 만들고, 이건 `strategy=WORKER_ERROR`, `warnings=["worker_error:..."]`인 정상 형태의 계약 응답이다. Spring 쪽 `parseFailureResponse`도 5xx 본문이 `qualityStatus=FAILED`인 유효 계약이면 그걸 그대로 결과로 받아들인다. 즉 **"실패"조차 상태 기계가 다룰 수 있는 구조화된 신호**로 흐른다.

## 5. 구현 상태 (됨 vs 계획 정직 구분)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 워커 HTTP 서버(`http.server` 기반) | **구현** | `15_job_posting_worker_api.py` `WorkerHandler` |
| 전략 분류 + 품질 게이트 점수화 | **구현** | `14_extract_document_text.py` `classify_strategy`/`analyze_quality` |
| PDF 텍스트 레이어 추출(`pypdf`) | **구현(기본 런타임)** | `requirements.txt` |
| PaddleOCR/PPStructureV3 OCR | **구현·단 선택 설치** | `requirements-ocr.txt`, `Dockerfile ARG INSTALL_OCR` |
| Spring → 워커 HTTP 클라이언트 | **구현** | `JobPostingAiWorkerClient` |
| 워커 없을 때 JVM-local 폴백 | **구현** | `extractFile().orElseGet(...)` |
| Docker 내부 전용 서비스 | **구현** | `docker-compose.yml`의 `expose: 8091` + 헬스체크 |
| **워커 실제 사용** | **기본 OFF** | `application.yaml:119` `enabled: ${JOB_POSTING_AI_WORKER_ENABLED:false}` |
| OpenAI 호출 | **하지 않음(설계상)** | README: "does not call OpenAI" |
| URL 직접 fetch | **워커는 미수행** | URL은 Spring이 fetch해 텍스트로 넘김. 워커는 `url_fetch_not_enabled` 경고 |

:::warning 혼동 주의값
① 기본 상태는 **OFF**다. 따라서 "운영에서 항상 워커가 돈다"가 아니라 "워커는 옵션이고, 기본 경로는 JVM-local 추출"이 정확하다. ② Spring `application.yaml`의 워커 타임아웃은 **120s**다(CPU PaddleOCR 첫 모델 로딩이 수십 초 걸려 30s로는 타임아웃). `docker-compose.yml`엔 30s 기본도 보이지만, 실측 근거로 yaml은 120s로 올려둔 상태다. ③ 프레임워크는 **Flask가 아니라 stdlib `http.server`**다(§2 경고).
:::

## 6. 면접 답변 3단계

**1단계 (한 문장):** "공고 OCR/추출을 Spring 안에 두지 않고, `/extract/job-posting` 하나만 노출하는 별도 Python 프로세스로 분리했습니다. PaddleOCR 같은 무거운 네이티브 의존성을 JVM에서 격리하고, OCR이 멈춰도 백엔드 스레드가 묶이지 않게 하려는 목적입니다."

**2단계 (왜 + 어떻게):** "분리의 핵심은 세 가지 — 의존성(Python OCR 스택), 언어(한글 레이아웃 OCR은 Python이 강함), 실패 격리입니다. 다만 프로세스를 나누면 네트워크 홉이 생기니, 워커 호출을 `Optional`로 감싸 비면 JVM 내부 경량 추출로 `orElseGet` 폴백하게 했습니다. 그래서 워커는 단일 장애점이 아니라 '있으면 더 좋은 가속기'고, 실제로 기본은 OFF입니다."

**3단계 (계약·신뢰성):** "Spring과 워커는 단일 엔드포인트 + 고정 JSON 계약(`text` + `meta`의 strategy/qualityScore/qualityStatus...)만 공유합니다. 워커는 예외도 `WORKER_ERROR` 계약 응답으로 돌려주고, 품질 게이트 점수를 워커가 매겨 PASS/REVIEW_REQUIRED/FAILED를 함께 넘기므로 백엔드 상태 기계가 실패까지 구조화된 신호로 다룹니다. Docker에서는 `expose`만 하고 업로드 볼륨을 read-only로 공유하는 내부 전용 서비스로 띄웁니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 왜 Flask/FastAPI를 안 쓰고 표준 라이브러리 `http.server`로 만들었나요?
엔드포인트가 `/health`와 `/extract/job-posting` 두 개뿐이라 라우팅·미들웨어가 필요 없습니다. 외부 웹 프레임워크 의존성을 0으로 두면 Docker 이미지가 가벼워지고 보안 표면이 줄며, 진짜 무거운 의존성(PaddleOCR)만 **선택 설치**로 분리할 수 있습니다. `WorkerHandler(BaseHTTPRequestHandler)`가 `do_GET`/`do_POST`만 구현하면 충분합니다.
:::

:::details Q2. 워커가 죽으면 공고 등록이 막히나요?
막히지 않습니다. `JobPostingTextExtractor.extractFile`이 `aiWorkerClient.extractFile(file).orElseGet(() -> extractFileLocally(file))` 구조라, 워커가 OFF거나 응답 불가면 JVM 내부 경량 추출(`pypdf` PDF 텍스트, HTML 파싱 등)로 떨어집니다. 실제로 워커는 `enabled` 기본값이 `false`라 평상시 경로 자체가 JVM-local입니다.
:::

:::details Q3. OCR 의존성을 왜 `requirements.txt`와 `requirements-ocr.txt`로 나눴나요?
PaddleOCR/PaddlePaddle/PyMuPDF는 수백 MB급이고 네이티브 빌드가 무겁습니다. 기본 워커는 텍스트 PDF/HTML만 처리하면 되는 경우가 많아 `pillow`+`pypdf`만 있으면 되고, 스캔 PDF·이미지 OCR이 필요한 운영 이미지에서만 `requirements-ocr.txt`를 추가합니다. `Dockerfile`의 `ARG INSTALL_OCR`로 이미지 빌드 시 분기합니다 — 같은 코드, 다른 두 이미지.
:::

:::details Q4. 한글 OCR에서 Windows 특유의 깨짐을 어떻게 막았나요?
`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`를 강제합니다. 이게 없으면 Windows에서 PaddleOCR 결과가 cp949로 인코딩돼 한글이 `?`나 surrogate로 깨지고 영어만 살아남습니다. 또 PaddlePaddle 3.x의 oneDNN 런타임 이슈를 피하려고 `FLAGS_use_mkldnn=0`을 셸과 코드(`configure_ocr_cache_env`) 양쪽에서 설정합니다 — paddle import 시점 때문에 코드 설정만으론 늦을 수 있어 셸에서도 명시합니다.
:::

:::details Q5. PPStructureV3와 그냥 PaddleOCR을 둘 다 쓰는 이유는?
채용공고는 표·2단 레이아웃이 흔해서 단순 line-OCR로 읽으면 읽기 순서가 뒤섞입니다. 그래서 1순위로 레이아웃 인식 OCR인 PPStructureV3를 써서 블록 단위로 읽기 순서를 복원하고, 그게 실패하거나 빈 결과면 2순위로 기본 PaddleOCR line-OCR에 폴백합니다. 워커 기동 시 `warmup_ocr()`로 두 엔진을 미리 예열해 첫 요청의 모델 로딩 지연을 줄입니다.
:::

:::details Q6. Docker에서 워커를 어떻게 격리·연결했나요?
`docker-compose.yml`에서 워커는 포트를 `ports`로 외부 공개하지 않고 `expose: 8091`만 해서 **내부 네트워크 전용**입니다(README: "do not publish it publicly"). 백엔드 업로드 볼륨을 `media_uploads:/app/.uploads:ro`로 read-only 공유해, Spring이 보낸 파일 경로를 워커가 그대로 읽을 수 있게 합니다. `/health`를 치는 헬스체크가 붙어 있고 백엔드가 `depends_on ... service_healthy`로 워커 준비를 기다립니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제는 통과다.

1. 추출을 별도 프로세스로 뺀 세 가지 이유(의존성·언어·실패 격리)를 각각 한 문장으로.
2. 워커가 꺼져 있을 때 공고 등록이 왜 안 막히는지를 `orElseGet` 한 줄로.
3. Spring↔워커 계약의 최소 형태(`text` + `meta`의 핵심 5개 키).
4. OCR 경로의 3단 우선순위(기존 OCR → PPStructureV3 → PaddleOCR)와 그 이유.
5. "이 워커는 Flask다"가 왜 틀린 답인지.

연관 주제: [공고 추출·OCR·품질 게이트](/area-b/text-extraction-ocr), [공고 원문 저장(revision)](/area-b/job-posting-storage), [지원 건 라이프사이클](/area-b/application-lifecycle), [영역 B 개요](/area-b/).

## 퀴즈

<QuizBox question="이 공고 추출 워커가 실제로 사용하는 HTTP 서버 기반은?" :choices="['Flask', 'FastAPI', 'Python 표준 라이브러리 http.server (BaseHTTPRequestHandler)', 'Spring WebFlux']" :answer="2" explanation="requirements.txt에는 pillow/pypdf만 있고 Flask/FastAPI 임포트가 없다. 워커는 stdlib http.server의 BaseHTTPRequestHandler/HTTPServer로 구현됐다. 엔드포인트가 /health, /extract/job-posting 두 개뿐이라 프레임워크가 필요 없다." />

<QuizBox question="Spring에서 Python 워커가 비활성(enabled=false)이거나 응답 불가일 때 일어나는 일은?" :choices="['공고 등록이 실패한다', 'JobPostingTextExtractor가 orElseGet으로 JVM 내부 경량 추출로 폴백한다', 'OpenAI를 자동 호출한다', '워커가 자동으로 켜진다']" :answer="1" explanation="extractFile은 aiWorkerClient 호출 결과 Optional이 비면 orElseGet(() -> extractFileLocally(file))로 JVM 내부 추출에 폴백한다. 워커는 단일 장애점이 아니라 옵션 가속기이고, 기본값은 OFF다." />

<QuizBox question="OCR이 필요한 파일에서 워커가 텍스트를 확보하는 우선순위 순서로 옳은 것은?" :choices="['PaddleOCR → PPStructureV3 → 기존 OCR 텍스트', '기존 OCR 텍스트 → PPStructureV3 → PaddleOCR line-OCR', 'OpenAI OCR → PaddleOCR → 기존 텍스트', 'PPStructureV3 → OpenAI → PaddleOCR']" :answer="1" explanation="extract_text_for_strategy는 ① 사전 생성된 기존 OCR 텍스트, ② 레이아웃 인식 PPStructureV3(표·2단 읽기순서 복원), ③ 기본 PaddleOCR line-OCR 순으로 시도한다. 워커는 OpenAI를 호출하지 않는다." />

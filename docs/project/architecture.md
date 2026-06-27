# 전체 아키텍처

> CareerTuner는 React SPA(웹·모바일) 한 종류의 클라이언트가 Spring Boot REST API 하나로만 말을 걸고, 그 백엔드가 MySQL·Python ML 워커·Qdrant·OpenAI/Ollama를 뒤에서 조율하는 구조다. 모든 응답은 `ApiResponse` 엔벨로프로 통일돼 있다.

## 1. 한 줄 정의

**프런트(React SPA) ↔ 백엔드(Spring Boot REST) ↔ 영속·외부 서비스(MySQL · Python ML 워커 · Qdrant · OpenAI/Ollama)** 로 이어지는 3층 클라이언트-서버 아키텍처. 클라이언트는 비즈니스 로직을 모르고 오직 `/api/**` HTTP로만 백엔드와 통신한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| SPA | Single Page Application. 페이지 새로고침 없이 JS가 화면을 갈아끼우는 앱. 여기선 React + Vite. |
| REST | Representational State Transfer. HTTP 메서드(GET/POST/...)와 URL로 자원을 다루는 API 규약. |
| 엔벨로프(envelope) | 모든 응답을 같은 봉투(`success/code/message/data`)로 감싸는 패턴. |
| 워커(worker) | 무거운 작업을 본 서버에서 떼어내 따로 처리하는 별도 프로세스. 여기선 Python 공고추출 서버. |
| RAG | Retrieval-Augmented Generation. 벡터DB에서 관련 자료를 찾아 LLM 프롬프트에 붙여주는 기법. Qdrant가 그 벡터 저장소. |
| SSR vs CSR | CareerTuner는 CSR(클라이언트 렌더링) SPA. 서버는 JSON만 주고 HTML 조립은 브라우저가 한다. |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **경계가 없으면**: 화면 코드와 DB 쿼리가 한 덩어리가 되면, 웹·안드로이드·iOS·데모용 목(mock) 4개 환경을 각각 손봐야 한다. REST 경계 하나로 묶으면 클라이언트는 전부 같은 API를 재사용한다.
- **응답 형식이 제각각이면**: 화면마다 에러 처리를 다르게 짜야 한다. `ApiResponse` 엔벨로프로 통일하면 프런트 `api()` 함수 한 곳에서 성공/실패/401을 일괄 처리한다.
- **AI·추출을 백엔드 안에 박아두면**: Python 라이브러리(PDF·HTML 파싱)와 GPU 추론을 JVM에 욱여넣게 된다. ML 워커·Qdrant·LLM을 **외부 서비스로 분리**해 각자 독립 배포·확장한다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/표시)

전 구간이 실제 동작하는 구현이다(자체 LLM 모델만 설계 단계).

| 계층 | 핵심 위치 | 역할 |
| --- | --- | --- |
| 클라이언트 | `frontend/src/app/lib/api.ts`, `tokenStore.ts` | 제네릭 `api()` 호출, `BASE = VITE_API_BASE_URL ?? "/api"`, 401 시 `tryRefresh()` 단일-플라이트 |
| 클라이언트 라우팅 | `app/routes.ts`, `admin/routes.ts` (React Router 7) | 사용자/관리자 SPA 분리 |
| 모바일 셸 | `platform/capacitor.ts`, `capacitor.config.ts` | Capacitor 8로 같은 SPA를 안드로이드/iOS 앱으로 포장 |
| API 엔벨로프 | `common/web/ApiResponse` (record `success/code/message/data`) | 모든 컨트롤러 응답의 표준 봉투 |
| 4계층 | `controller → service → mapper(@Mapper) → domain` | 예: `fitanalysis`, `analysis`, `dashboard`, `interview`, `jobposting` 패키지 |
| 영속성 | MyBatis `@Mapper` + `resources/mapper/**/*.xml` | JPA 금지. `users`, `application_case`, `fit_analysis`, `career_analysis_run`, `ai_usage_log` 등 |
| AI 오케스트레이터 | `ai/autoprep/AutoPrepOrchestrator`, `handler/FitPrepHandler` 등 | 의존그래프(JOB→FIT/INTERVIEW), `AutoPrepController.runStream()`이 `SseEmitter`로 실시간 진행 보고 |
| 외부 LLM | `OpenAiResponsesClient`(structured output), LangChain4j + Ollama | 적합도·경향·대시보드 분석 |
| ML 워커 | `ml/job-posting-worker`(Python Flask, `:8091`, Docker) | 공고 텍스트 추출(영역 B) |
| 벡터DB | Qdrant (`QDRANT_URL`, 면접 RAG `INTERVIEW_RAG_ENABLED`) | 면접 질문 RAG |
| 배포 토폴로지 | `docker-compose.yml` | `backend` + `qdrant` + `job-posting-worker` 3서비스. **MySQL은 외부 인스턴스 재사용** |

:::warning 영역 표시
이 페이지의 적합도/경향/대시보드 AI는 **영역 C(본인) 구현됨**. 공고추출 워커=B, 가상면접=D/E, 인프라·공통(`common`, `routes.ts`, `docker-compose`)=팀장 소유. 자체 LLM 커리어전략 모델(`ml/career-strategy-llm`)은 **설계 단계·미구현**.
:::

## 5. 핵심 동작 원리 (요청 흐름)

### 일반 REST 요청 한 번의 여정

```text
[React SPA]  api("/applications/123/fit")
   │  Authorization: Bearer <access>
   ▼
[Vite proxy / Capacitor]  /api → :8080
   ▼
[JwtAuthenticationFilter]  Bearer 파싱 → SecurityContext
   ▼
[Controller]  @RestController @RequestMapping("/api/...")
   ▼
[Service]  @Service @RequiredArgsConstructor (비즈니스 규칙·검증)
   ▼
[Mapper]  @Mapper + XML  ──►  MySQL
   ▼
[ApiResponse.ok(data)]  { success:true, code:"OK", data:{...} }
   ▲
프런트 api()가 엔벨로프 풀어서 data 반환 (401이면 tryRefresh)
```

### AI 분석(AutoPrep) 흐름 — 단순 요청과 다른 점

```text
[SPA] EventSource("/api/.../autoprep/stream")
   ▼  AutoPrepController.runStream() → SseEmitter
[AutoPrepOrchestrator] 의존그래프 실행
   ├─ JOB 단계(B) 공고추출  → ml/job-posting-worker(:8091)
   ├─ 완료 후 FIT 단계(C)   → FitAnalysisAiService → OpenAiResponsesClient
   └─ 완료 후 INTERVIEW(D)  → Qdrant RAG 검색 + LLM
   ▼ 각 단계마다 PrepProgress 이벤트를 SSE로 push
[SPA] 진행률 토스트/스텝 UI 실시간 갱신
```

### 통신 경계 한눈에

| 경계 | 프로토콜 | 특징 |
| --- | --- | --- |
| SPA → 백엔드 | HTTP/JSON `/api/**` | STATELESS, JWT Bearer. CORS 허용: `localhost:5173`, `capacitor://localhost` |
| SPA → 백엔드(진행) | SSE(`text/event-stream`) | AI 단계별 실시간 푸시 |
| 백엔드 → MySQL | JDBC (MyBatis) | 외부 인스턴스, 환경변수 주입 |
| 백엔드 → ML 워커 | HTTP (`:8091`) | 공고 추출 위임 |
| 백엔드 → Qdrant | HTTP/gRPC (`:6333/:6334`) | RAG 벡터 검색 |
| 백엔드 → LLM | HTTPS(OpenAI) / HTTP(Ollama 로컬) | 폴백 체인 |

## 6. 6명 수직 분담과 모바일

:::tip 수직 분담(vertical slice)
한 사람이 **프런트 화면 → 백엔드 API → 어드민**까지 한 기능을 세로로 책임진다. 가로(프런트팀/백엔드팀)로 자르지 않아 인수인계 비용이 적다.
:::

| 영역 | 담당 |
| --- | --- |
| A~F | 인증/공통, 공고추출(B), 적합도·경향·대시보드(C=본인), 가상면접(D), 면접평가/RAG(E), 결제·관리 등 |
| 공통 영역 | `common/`, `ai/prompt` 공통 엔진, `routes.ts`, `schema.sql`, `docker-compose` — 팀장 소유 |

**모바일은 별도 앱이 아니다.** Capacitor 8이 동일한 React 빌드를 웹뷰로 감싸 안드로이드/iOS 패키지를 만든다(`appId com.careertuner.app`, `androidScheme http` + cleartext 허용으로 평문 HTTP 백엔드 호출). 즉 한 코드베이스 → 웹/안드로이드/iOS/목(mock) 데모 4타깃.

## 7. 면접 답변 3단계

- **초간단(1문장)**: "React SPA가 Spring Boot REST 백엔드 하나에만 붙고, 백엔드가 MySQL·Python ML 워커·Qdrant·LLM을 조율하는 3층 구조이며, 모든 응답은 `ApiResponse` 엔벨로프로 통일했습니다."
- **기본**: "클라이언트는 비즈니스 로직을 모르고 `/api/**`로만 통신합니다. 백엔드는 controller→service→mapper(MyBatis)→domain 4계층이고, 무거운 공고추출은 Python Flask 워커로, 면접 RAG는 Qdrant로, AI 분석은 OpenAI/Ollama로 분리했습니다. 같은 React 빌드를 Capacitor로 감싸 모바일까지 한 코드베이스로 냅니다."
- **꼬리질문 대응**: "AI 분석은 일반 요청과 달리 의존그래프 오케스트레이터(`AutoPrepOrchestrator`)가 단계를 순서대로 돌리고, `SseEmitter`로 진행률을 실시간 푸시합니다. 인증은 STATELESS JWT라 401이 나면 프런트 `api()`가 단일-플라이트로 한 번만 refresh합니다."

## 8. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 왜 응답을 ApiResponse 엔벨로프로 통일했나?
화면이 4개 타깃(웹/안드로이드/iOS/목)이라 에러 처리가 흩어지면 비용이 큽니다. `success/code/message/data` 한 형식으로 묶으면 프런트 `api()` 한 곳에서 성공·`code`별 에러·401 refresh를 일괄 처리할 수 있습니다. 백엔드는 `ApiResponse.ok()/error()` + `GlobalExceptionHandler`로 항상 같은 봉투를 보장합니다.
:::

:::details Q. 공고추출을 왜 Spring 안이 아니라 Python 워커로 뺐나?
PDF·HTML 파싱·OCR은 Python 생태계가 강하고, 추출은 느리고 무겁습니다. `ml/job-posting-worker`(Flask, :8091)로 분리하면 본 API의 응답성을 지키고, 워커만 독립적으로 배포·스케일·재시작할 수 있습니다. compose에서 healthcheck로 준비된 뒤 backend가 의존하도록 묶었습니다.
:::

:::details Q. MySQL을 docker-compose에 안 넣은 이유는?
DB는 팀 공용 원격 인스턴스를 재사용하기 때문입니다. compose에는 상태가 가벼운 backend·qdrant·job-posting-worker만 두고, DB 접속값은 평문 커밋 금지 원칙에 따라 환경변수(`DB_HOST` 등 자리표시자)로 주입합니다.
:::

:::details Q. SPA인데 SEO/초기로딩은? 왜 SSR 안 썼나?
CareerTuner는 로그인 기반 취업 전략 도구라 색인 대상이 공개 마케팅 페이지 정도로 제한적이고, 개인화 대시보드가 핵심입니다. 그래서 CSR SPA로 가되, 모바일·오프라인 체감은 `vite-plugin-pwa`(Workbox)로 보완했습니다. 단 `/api` 경로는 `navigateFallbackDenylist`로 캐시에서 제외해 항상 실시간 데이터를 받습니다.
:::

:::details Q. AI 호출이 외부 의존인데 장애 시엔?
LLM은 외부 서비스라 항상 실패를 가정합니다. 에러는 `AI_UNAVAILABLE` `ErrorCode`로 표준화하고, 적합도 점수·판정 같은 핵심 값은 LLM 출력 그대로가 아니라 **서버 규칙·검증 로직으로 확정**합니다. 자체 LLM 전략 모델(설계 단계)에는 캐시→규칙엔진→OpenAI→Mock 폴백 체인을 계획해 두었습니다.
:::

## 9. 직접 말해보기 (말하기 훈련용)

1. 화이트보드 없이 60초 안에, 사용자가 "적합도 분석" 버튼을 누른 순간부터 화면에 결과가 뜰 때까지의 경로를 SPA→필터→컨트롤러→서비스→매퍼→AI→SSE 순으로 입으로 말해보라.
2. "왜 모바일을 React Native가 아니라 Capacitor로 했나?"에 30초로 답해보라(한 코드베이스·웹뷰·평문 HTTP 호출 키워드 포함).

관련: [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [JWT 보안](/backend/jwt-security) · [MyBatis](/backend/mybatis) · [DTO](/glossary/dto) · [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep)

## 퀴즈

<QuizBox question="CareerTuner의 docker-compose.yml에 포함되지 않는 서비스는?" :choices="['backend', 'qdrant', 'job-posting-worker', 'MySQL']" :answer="3" explanation="MySQL은 팀 공용 원격 인스턴스를 재사용하므로 compose에 넣지 않고, backend/qdrant/job-posting-worker 3개만 정의한다. DB 접속값은 환경변수로 주입한다." />

<QuizBox question="AI 분석(AutoPrep)이 일반 REST 요청과 통신 방식에서 다른 핵심은 무엇이며, 왜 그렇게 했는지 설명해보라." explanation="일반 요청은 한 번의 HTTP 요청-응답으로 ApiResponse를 받지만, AutoPrep은 AutoPrepController.runStream()이 SseEmitter로 단계별 진행 상황을 SSE(text/event-stream)로 실시간 푸시한다. 의존그래프(JOB 완료 후 FIT/INTERVIEW)를 순서대로 도는 동안 각 단계가 수 초씩 걸리는 LLM/추출 작업이라, 사용자에게 진행률을 즉시 보여줘 체감 대기시간을 줄이기 위해서다." />

<QuizBox question="프런트 api()에서 401 응답을 받았을 때 동작은?" :choices="['즉시 로그아웃시킨다', 'tryRefresh()로 토큰을 단일-플라이트로 한 번만 갱신 후 재시도', '매 요청마다 각각 refresh를 호출한다', '서버가 알아서 세션을 살린다']" :answer="1" explanation="STATELESS JWT라 동시 다발 401에도 refreshPromise를 공유해 /auth/refresh를 단 한 번만 호출(단일-플라이트)하고, 성공하면 원요청을 재시도한다." />

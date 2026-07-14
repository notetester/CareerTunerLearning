# 전체 아키텍처 (요약)

> CareerTuner는 **React SPA → (dev) Vite 프록시 → Spring Boot REST(`ApiResponse` 엔벨로프) → MyBatis/MySQL** 을 한 축으로, 여기에 **Python 공고추출 워커 · Qdrant 벡터DB · AI 공급자(OpenAI·Anthropic Haiku·자체 Ollama)** 가 곁가지로 붙는 구조다. 이 페이지는 그 큰 그림과 "요청 한 번이 어디를 거쳐 돌아오나"를 **한 장에 압축**한다. 더 깊은 단계별 추적은 [전체 흐름 아키텍처](/flow/architecture)로 넘긴다.

:::tip 이 페이지의 위치
이건 **프로젝트 전체를 처음 잡는 요약 지도**다. 6개 영역(A~F)을 동등하게 한 표에 올려 "누가 어느 경계 위에 사나"만 본다. 영역 내부 구현은 각 영역 페이지로, 요청 생명주기의 정밀 추적은 흐름 페이지로 분리한다.
:::

---

## 1. 한 줄 정의

세 개의 축 — **클라이언트(React SPA) · API(Spring Boot REST) · 영속/외부 서비스(MySQL · Python 워커 · Qdrant · LLM)** — 으로 이어지는 클라이언트–서버 아키텍처. 클라이언트는 비즈니스 로직을 모르고 오직 `/api/**` HTTP로만 백엔드와 통신하며, 모든 응답은 같은 `ApiResponse<T>` 봉투를 쓴다.

---

## 2. 구성 요소 한눈에

| 계층 | 기술 | 포트/위치 | 역할 |
| --- | --- | --- | --- |
| 클라이언트 | React 19 · Vite 8 · TS · Tailwind v4 (SPA) | `:5173` (dev) | 화면·상태·`fetch('/api/*')` |
| 모바일 셸 | Capacitor (WebView) | 네이티브 앱 | 같은 React 빌드를 감싼 앱 |
| 프록시 | Vite dev server | `:5173` → `:8080` | **dev 한정** `/api/*` 전달 |
| API | Spring Boot 4.1.0 · Java 21 (REST) | `:8080` `/api/**` | 인증·검증·비즈니스 |
| 영속성 | MyBatis (JPA 금지) | `@Mapper` + XML | SQL ↔ 도메인 매핑 |
| RDB | MySQL 8 | 기준 SHA의 정본 DDL 172개 테이블 | 진실의 원천(source of truth) |
| 벡터DB | Qdrant | `:6333` | 면접 RAG 검색(best-effort) |
| 비동기 워커 | Python 공고추출 워커 | 별도 프로세스 | OCR·문서텍스트 → 문장분류 |
| AI 공급자 | OpenAI / Anthropic Haiku / 자체 Ollama | 외부·원격 | 자연어 생성·요약·평가 |

```text
              ┌──────────── 클라이언트 ────────────┐
   [브라우저 SPA :5173]      [Capacitor 앱(WebView)]    ← 같은 React 빌드
          │  fetch /api/*              │  capacitor://localhost
          ▼                            ▼
   ┌──────────────────────────────────────────────────┐
   │  (dev) Vite 프록시 5173 → 8080  ·  (운영) 직접 호출  │
   └──────────────────────────────────────────────────┘
          │  HTTP /api/**   (Authorization: Bearer <JWT>)
          ▼
   ┌──────────────── Spring Boot REST :8080 ────────────────┐
   │  JwtAuthenticationFilter → @RestController              │
   │        (인증)                 (인가·검증)                │
   │                                 │                        │
   │                             Service (트랜잭션·비즈니스)    │
   │                                 │                        │
   │                             @Mapper (MyBatis)            │
   │                                 │                        │
   │                         ApiResponse<T> 직렬화 → JSON      │
   └────────┬──────────────┬──────────────┬─────────┬───────┘
            ▼              ▼              ▼         ▼
        [MySQL 8]      [Qdrant]    [Python 워커]  [AI 공급자]
        ~68 테이블    면접 RAG     OCR·공고추출   OpenAI/Haiku/OSS
```

핵심 명제: **표준 경로는 한 줄로 흐른다.** 가지(Qdrant·워커·AI)는 특정 영역이 필요할 때만 곁가지로 호출하며, 실패해도 표준 경로가 죽지 않게 best-effort/폴백으로 격리한다.

---

## 3. 6개 영역의 백엔드 도메인 배치

CareerTuner의 핵심 단위는 공고가 아니라 **지원 건(Application Case)** 이고, 6개 영역(A~F)이 하나의 지원 건을 함께 채운다. 각 영역은 `사용자 화면 + REST API + 관리자 + AI + DB 테이블` 을 수직으로 소유한다. 아래 표는 **모든 영역을 동등하게** 같은 4계층 위에 배치한 모습이다.

| 영역 | 한 줄 정체성 | 대표 도메인 패키지/클래스 | 핵심 소유 테이블 | AI # | 상세 |
| --- | --- | --- | --- | --- | --- |
| **A** | 회원·프로필·인증 (기반 신뢰 데이터) | `auth`·`profile`, `ProfileAiService` | `users`, `user_profile`(+버전 스냅샷), `user_consent` | 1~5 | [/area-a/](/area-a/) |
| **B** | 지원 건·공고·기업분석 | `jobposting`, `JobPostingTextExtractor` | `application_case`, `job_posting`, `job_analysis`, `company_analysis` | 6~11 | [/area-b/](/area-b/) |
| **C** | 적합도·전략·대시보드 | `fitanalysis`·`analysis`·`dashboard`, `FitAnalysisServiceImpl` | `fit_analysis`, `career_analysis_run` | 12~18 | [/area-c/](/area-c/) |
| **D** | 가상면접 | `interview`, `FallbackInterviewLlmGateway` | `interview_session`/`question`/`answer`, `file_asset` | 19~23 | [/area-d/](/area-d/) |
| **E** | 첨삭·결제·크레딧 | `correction`·`payment`·`credit`, `plan` | `correction_request`, `payment`, `credit_transaction`, `plan` | 24~28 | [/area-e/](/area-e/) |
| **F** | 커뮤니티·고객센터·챗봇 | `community`·`support`, `IntakeChatAgent` | `community_*`, `support_ticket`, `notification`, `notice`/`faq` | 29~34 | [/area-f/](/area-f/) |

:::tip 영역이 6개여도 한 시스템처럼 보이는 이유
6명이 6개 영역을 각자 만들지만, **계층 이름·책임·응답 형식이 전부 똑같다.** `controller → service → mapper → domain`(+필요 시 `dto`) 4계층과 단일 `ApiResponse<T>` 엔벨로프를 공유하기 때문이다. → [4계층 구조](/glossary/layered-architecture) · [ApiResponse 엔벨로프](/glossary/api-response-envelope)
:::

### 데이터 소유권 — 자기 결과는 쓰고, 남의 원본은 읽기전용

영역 간 결합은 "원본 비수정" 규칙으로 묶인다. 각 영역은 자기 산출물을 소유하고, 다른 영역의 원본 테이블은 **읽기전용으로만 참조**한다.

| 원천(쓰기 소유) | 어디로 흐르나(읽기전용 참조) |
| --- | --- |
| A `user_profile` | 전 영역(B·C·D·E·F)의 분석 입력 |
| B `job_analysis`·면접포인트 | C·D·E |
| C `fit_analysis` | D |
| D `interview_*` | C·E |

자세한 테이블 단위 경계는 [데이터 소유권 경계 맵](/flow/data-ownership) 참고.

---

## 4. 요청 한 번의 생명주기 (요약)

표준 REST 요청이 어디를 거치는지 6단계로 압축한다. 단계별 코드·라인 추적은 [전체 흐름 아키텍처](/flow/architecture)에 있다.

```text
[React SPA]   api('/applications/123/...')           ← Authorization: Bearer <access>
   │
   ▼  (dev) Vite 프록시 / (운영·모바일) 직접 호출
[JwtAuthenticationFilter]   Bearer 파싱 → SecurityContext (STATELESS, 못 막고 통과만)
   ▼
[Controller]   @RestController  (경로·인가·검증, 비즈니스는 위임)
   ▼
[Service]      @Transactional  (비즈니스·필요 시 곁가지 AI/Qdrant 호출)
   ▼
[Mapper]       @Mapper + XML  ──►  MySQL
   ▼
[ApiResponse.ok(data)]   { success:true, code:"OK", data:{...} }   → JSON
   ▲
프런트 api() 래퍼가 엔벨로프를 풀어 data만 화면에 전달 (401이면 단일-플라이트 refresh)
```

| 단계 | 누가 | 한 줄 책임 |
| --- | --- | --- |
| 0 | 프런트 `api()` 래퍼 | `fetch('/api/*')` + JWT 헤더 부착, 응답 언랩 |
| 1 | Vite 프록시 (**dev 한정**) | `/api/*` → `:8080` `changeOrigin` 전달 |
| 2 | `JwtAuthenticationFilter` | Bearer 파싱→신원 복원, STATELESS, 막지 않고 통과 |
| 3 | `@RestController` | 경로 매핑·인가·입력 검증, 비즈니스는 서비스로 위임 |
| 4 | `@Service` | 트랜잭션 경계 안 비즈니스, 필요 시 곁가지 호출 |
| 5 | `@Mapper` (MyBatis) | SQL ↔ 도메인 매핑, MySQL과 대화 |
| 6 | `ApiResponse<T>` | 결과를 단일 봉투로 감싸 JSON 직렬화 |

:::details AI 진행 스트림(SSE)은 이 경로의 예외다
AI 오케스트레이터 AutoPrep의 진행 스트림(`produces=text/event-stream`)은 한 번에 끝나는 응답이 아니라 이벤트(plan/part-start/substep/part-done)를 여러 번 흘린다. 그래서 단발 `ApiResponse` 엔벨로프를 타지 않고 프런트도 `fetch`로 직접 받아 파싱한다. → [AI 오케스트레이터](/flow/ai-orchestrator) · [SSE 용어](/glossary/sse)
:::

---

## 5. 곁가지 시스템 — 표준 경로 밖의 셋

표준 `controller→service→mapper→DB` 경로 외에, 특정 영역만 쓰는 외부 시스템이 셋 있다. 모두 **실패해도 본 요청을 깨뜨리지 않게** 격리돼 있다.

| 곁가지 | 주로 쓰는 영역 | 통신 | 실패 시 |
| --- | --- | --- | --- |
| Python 공고추출 워커 | B(공고분석) | 별도 프로세스, OCR·문서텍스트 → 문장분류 | 비동기, 본 요청과 분리 |
| Qdrant 벡터DB | D(면접 RAG) | `:6333` 벡터 검색, 원본 지식은 RDB | best-effort 스킵(RAG 없이 진행) |
| AI 공급자 | 전 영역(#1~34) | OpenAI / Anthropic Haiku / 자체 Ollama | 폴백 체인 또는 Mock 규칙엔진 |

:::warning 곁가지일수록 "끊겨도 본체는 산다"가 설계 의도
"그 외부 시스템이 죽으면요?"는 단골 꼬리질문이다. 답은 항상 **격리**다 — 워커는 별도 프로세스, Qdrant는 best-effort 스킵, AI는 폴백/Mock. 표준 경로(인증→컨트롤러→서비스→DB)는 곁가지에 운명을 걸지 않는다. 공통 폴백 사다리는 **자체 OSS → Haiku → OpenAI → Mock** 순이다. → [AI 폴백 전략](/ai/fallback) · [면접 RAG·Qdrant](/ai/rag-qdrant)
:::

---

## 6. AI를 묶는 오케스트레이터 — AutoPrep (요약)

여러 영역의 AI 단계는 따로 노는 게 아니라 한 두뇌가 의존 그래프로 엮는다. F의 인테이크 챗봇이 입구가 되어 플래너가 계획을 세우고, **공고 분석(JOB·B)이 끝난 뒤** 적합도(FIT·C)와 면접(INTERVIEW·D)을 **병렬로** 실행한다.

```text
독립 파트 (동시 출발): A 프로필 · B 공고 · E 자소서 · F 커뮤니티
의존 파트 (JOB 완료 뒤):  FIT(C) · INTERVIEW(D)   ← 병렬
```

- 진행 상황은 **SSE**(plan / part-start / substep / part-done)로 실시간 보고한다.
- 미구현·비활성 단계는 멈추지 않고 `SKIPPED`, 실패해도 `FAILED`로 기록하고 끝까지 완주한다.
- 모든 AI 호출은 전사 사용량 원장(`ai_usage_log`)에 남고 크레딧(E)과 연결된다.

자세히: [AI 오케스트레이터 전체](/flow/ai-orchestrator) · [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep) · [AI 기능 맵(#1~34)](/flow/ai-function-map)

---

## 7. 모바일은 "다른 앱"이 아니다 (Capacitor)

모바일 앱은 별도 코드베이스가 아니라 **같은 React 빌드를 Capacitor WebView로 감싼 것**이다. 그래서 웹에서 고치면 앱에도 반영된다(코드 1벌). CORS 허용 오리진에 `capacitor://localhost`가 들어가 있는 이유가 이것이다. → [모바일 앱(Capacitor)](/frontend/capacitor-mobile) · [프런트 API 레이어·JWT 리프레시](/frontend/api-layer-jwt-refresh)

---

## 8. 구현 상태 — 정직하게

| 구현 완료 (현재 동작) | 부분/계획 (정직 구분) |
| --- | --- |
| 4계층 + `ApiResponse` 엔벨로프 전 영역 | 자체 OSS 파인튜닝 모델 학습·서빙(영역별 진행도 상이) |
| STATELESS JWT + 리프레시 원장 | 일부 영역 실 AI 공급자 키 연동 활성화 단계 |
| MyBatis/MySQL 기준 SHA의 172개 테이블 | (정본 DDL과 증분 패치로 관리) |
| Vite 프록시 + CORS + Capacitor 셸 | |
| AutoPrep 오케스트레이터·SSE | |
| Qdrant RAG·Python 공고추출 워커 배선 | |

:::tip 정직한 한 줄
"**아키텍처와 계약(4계층·엔벨로프·인증 경계·곁가지 배선)은 완성**돼 있고, 일부 AI 공급자는 키/모델 발급 후 활성화하는 단계입니다. 화면과 API 계약은 실제 LLM과 동일하게 동작합니다."
:::

테이블 수는 기준 커밋의 canonical `schema.sql`에서 서로 다른 `CREATE TABLE` 선언 **172개**로 계수한다.

---

## 9. 면접 답변 — 전체를 60~90초로

> 아래를 막힘없이 말할 수 있으면 "아키텍처 설명해 보세요"는 통과다.

"CareerTuner는 React SPA, Spring Boot REST, MyBatis/MySQL의 3축에 Qdrant·Python 워커·AI 공급자가 곁가지로 붙은 구조입니다.

요청 생명주기를 따라가면 — 프런트가 `/api`로 `fetch`하면 dev에서는 Vite 프록시가 8080으로 넘기고, 운영·모바일에서는 백엔드를 직접 칩니다. 들어온 요청은 먼저 `JwtAuthenticationFilter`가 Bearer 토큰을 파싱해 신원을 복원하는데, 세션은 STATELESS라 서버가 상태를 안 듭니다. 그다음 컨트롤러가 인가·검증하고, 서비스가 트랜잭션 안에서 비즈니스를 처리하면서 필요하면 AI나 Qdrant를 호출하고, 매퍼가 MyBatis로 MySQL과 대화합니다. 마지막에 결과를 전부 `ApiResponse<T>` 엔벨로프로 감싸 돌려줍니다.

핵심 단위는 공고가 아니라 지원 건이고, 6명이 A부터 F까지 영역을 수직 분담하지만 같은 4계층과 같은 응답 형식을 공유해서 한 시스템처럼 동작합니다. 외부 의존은 전부 격리해서 워커는 별도 프로세스, Qdrant는 best-effort, AI는 폴백/Mock으로 본 경로가 죽지 않게 했습니다. 모바일은 같은 React 빌드를 Capacitor로 감싼 거라 코드가 한 벌입니다."

---

## 10. 더 깊이 — 관련 페이지

- [전체 흐름 아키텍처](/flow/architecture) — 요청 생명주기 단계별 정밀 추적(이 페이지의 심화판)
- [흐름 개요](/flow/) — 6영역을 가로지르는 전체 그림 허브
- [사용자 end-to-end 여정](/flow/user-journey) — A→F 화면 단위 흐름
- [지원 건 중심 흐름](/flow/application-case) — 핵심 단위가 왜 공고가 아니라 지원 건인가
- [데이터 소유권 경계 맵](/flow/data-ownership) — 테이블 단위 읽기전용 경계
- [AI 기능 맵](/flow/ai-function-map) · [AI 오케스트레이터](/flow/ai-orchestrator) — AI #1~34와 의존 그래프
- [팀 협업·시스템 경계](/flow/team-collaboration)
- 영역별 개요: [A](/area-a/) · [B](/area-b/) · [C](/area-c/) · [D](/area-d/) · [E](/area-e/) · [F](/area-f/)
- 용어: [4계층 구조](/glossary/layered-architecture) · [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [무상태(Stateless)](/glossary/stateless) · [MyBatis](/backend/mybatis) · [JWT 보안](/backend/jwt-security)

---

## 퀴즈

<QuizBox question="CareerTuner의 표준 요청 생명주기 순서로 옳은 것은?" :choices="['컨트롤러 → JWT필터 → 서비스 → 매퍼 → DB', 'JWT필터 → 컨트롤러 → 서비스 → 매퍼 → DB → ApiResponse', '서비스 → 컨트롤러 → 매퍼 → JWT필터 → DB', 'Vite프록시 → DB → 서비스 → 컨트롤러 → JWT필터']" :answer="1" explanation="요청은 (dev에서) Vite 프록시로 8080에 전달된 뒤, JwtAuthenticationFilter가 먼저 인증하고, 컨트롤러가 인가·검증, 서비스가 비즈니스·트랜잭션, 매퍼(MyBatis)가 DB를 다룬 후, 결과를 ApiResponse 엔벨로프로 감싸 돌려준다. JWT 필터가 컨트롤러보다 앞에 있는 것이 핵심이다." />

<QuizBox question="6개 영역(A~F)을 한 시스템처럼 묶어 주는 가장 핵심적인 공통 규약 두 가지는?" :choices="['Qdrant와 Python 워커', 'controller→service→mapper→domain 4계층과 ApiResponse 단일 응답 형식', 'OpenAI 키와 Capacitor', 'JPA 엔티티와 세션 인증']" :answer="1" explanation="6명이 각자 만든 영역이 한 시스템처럼 보이는 이유는 모두 같은 4계층 구조(controller→service→mapper→domain)와 같은 응답 엔벨로프(ApiResponse<T>)를 공유하기 때문이다. 영속성은 MyBatis 단일이며 JPA는 금지다." />

<QuizBox question="AutoPrep 오케스트레이터에서 FIT(C)와 INTERVIEW(D) 단계가 시작되는 시점으로 옳은 것은?" :choices="['모든 단계와 동시에 즉시 시작한다', '공고 분석(JOB·B)이 완료된 뒤 병렬로 시작한다', 'A 프로필 분석이 끝나야만 순차로 시작한다', 'Qdrant 검색이 끝난 뒤에만 시작한다']" :answer="1" explanation="의존 그래프상 FIT과 INTERVIEW는 JOB(공고 분석)에 의존한다. 독립 파트(A·B·E·F)는 동시에 출발하고, JOB이 완료된 뒤 FIT(C)·INTERVIEW(D)가 병렬로 실행된다. 진행 상황은 SSE로 실시간 보고된다." />

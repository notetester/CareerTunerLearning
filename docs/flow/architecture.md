# 전체 시스템 아키텍처

> CareerTuner는 **React SPA → Vite 프록시 → Spring Boot REST(ApiResponse 엔벨로프) → MyBatis/MySQL**을 한 축으로, 여기에 **Python 공고추출 워커 · Qdrant 벡터DB · 외부/자체 AI 공급자**가 곁가지로 붙는다. 이 페이지는 "요청 한 번이 어디를 거쳐 어떻게 돌아오나"와 "6개 영역(A~F)이 어느 경계 위에서 만나나"를 한 장에 담는다. 영역별 내부는 각 영역 페이지로 넘긴다.

---

## 1. 이 흐름이 답하는 면접 질문

이 페이지 하나로 다음 질문에 막힘없이 답할 수 있어야 한다.

- "전체 아키텍처를 그림으로 설명해 주세요."
- "프론트에서 버튼을 누르면 서버에서 무슨 일이 일어나나요?" (요청 생명주기)
- "백엔드 계층 구조가 어떻게 되나요? 왜 그렇게 나눴나요?"
- "응답 형식을 통일했다는데 어떻게요?" (`ApiResponse` 엔벨로프)
- "프론트와 백엔드는 어떻게 통신하나요? CORS·프록시는요?"
- "AI나 벡터DB, OCR 같은 건 어디에 붙어 있나요?"
- "모바일 앱은 같은 코드인가요?" (Capacitor)

:::tip 한 줄 요약
**모든 도메인이 같은 4계층(`controller → service → mapper → domain`)과 같은 응답 규약(`ApiResponse<T>`)을 공유한다.** 그래서 6명이 따로 만든 6개 영역이 한 시스템처럼 보인다. 아키텍처의 핵심은 화려한 컴포넌트가 아니라 **공통 규약**이다.
:::

---

## 2. 전체 그림

### 2-1. 구성 요소 한눈에

| 계층 | 기술 | 포트/위치 | 역할 |
| --- | --- | --- | --- |
| 클라이언트 | React 19 · Vite 8 · TS · Tailwind v4 (SPA) | `:5173` (dev) | 화면·상태·`fetch` |
| 모바일 셸 | Capacitor (WebView) | 네이티브 앱 | 같은 SPA 빌드를 감싼 앱 |
| 프록시 | Vite dev server | `:5173` → `:8080` | dev 한정 `/api/*` 전달 |
| API | Spring Boot 4.1.0 · Java 21 (REST) | `:8080` `/api/**` | 인증·검증·비즈니스 |
| 영속성 | MyBatis (JPA 금지) | `@Mapper` + XML | SQL ↔ 도메인 매핑 |
| RDB | MySQL 8 | 기준 SHA의 정본 DDL 172개 테이블 | 진실의 원천(source of truth) |
| 벡터DB | Qdrant | `:6333` | 면접 RAG 검색(best-effort) |
| 비동기 워커 | Python 공고추출 워커 | 별도 프로세스 | OCR·문서텍스트 → 문장분류 |
| AI 공급자 | OpenAI / Anthropic Haiku / 자체 Ollama(4090) | 외부·원격 | 자연어 생성·요약 |

### 2-2. 아키텍처 다이어그램 (ASCII)

```text
                         ┌──────────── 클라이언트 ────────────┐
   [브라우저 SPA :5173]   [Capacitor 앱(WebView)]   ← 같은 React 빌드
          │  fetch /api/*            │  capacitor://localhost
          ▼                          ▼
   ┌─────────────────────────────────────────────────┐
   │  (dev) Vite 프록시 5173 → 8080   ·   (운영) 직접 호출 │
   └─────────────────────────────────────────────────┘
          │  HTTP /api/**  (Authorization: Bearer <JWT>)
          ▼
   ┌──────────────── Spring Boot REST :8080 ────────────────┐
   │  JwtAuthenticationFilter  →  @RestController            │
   │        (인증)                  (인가·검증)               │
   │                                  │                       │
   │                              Service (트랜잭션·비즈니스)   │
   │                                  │                       │
   │                              @Mapper (MyBatis)           │
   │                                  │                       │
   │                          ApiResponse<T> 직렬화 → JSON     │
   └────────┬─────────────┬─────────────┬───────────┬────────┘
            ▼             ▼             ▼           ▼
        [MySQL 8]     [Qdrant]   [Python 워커]   [AI 공급자]
        172개 테이블  면접 RAG    OCR·공고추출   외부/자체 provider
```

핵심 명제: **표준 경로는 한 줄로 흐른다.** 가지(Qdrant·워커·AI)는 특정 도메인이 필요할 때만 곁가지로 호출하며, 실패해도 표준 경로가 죽지 않도록 best-effort/폴백으로 격리한다.

---

## 3. 단계별 상세 — 요청 한 번의 생명주기

"적합도 분석을 보여달라" 같은 요청이 들어왔을 때, 무엇을 받아 무엇을 넘기는지 단계별로 본다.

### 단계 0. 클라이언트가 요청을 만든다 (프론트)
- React 컴포넌트의 이벤트 → 기능 모듈 `api/` 레이어가 `fetch('/api/...')` 호출. 헤더에 `Authorization: Bearer <accessToken>` 부착.
- 모듈 구조: `frontend/src/features/<기능>/{pages,components,api,hooks,types}`. 응답 언랩·토큰 리프레시는 공통 `api()` 래퍼가 담당.
- **넘기는 것**: HTTP 요청(메서드·경로·JSON 바디·JWT 헤더).
- 자세히: [API 레이어와 JWT 리프레시](/frontend/api-layer-jwt-refresh) · [React](/frontend/react)

### 단계 1. Vite 프록시가 전달한다 (dev 한정)
- 브라우저는 같은 오리진 `:5173`으로 보내고, Vite dev server가 `/api/*`를 `http://localhost:8080`으로 `changeOrigin`하여 전달(`vite.config.ts`의 `server.proxy`). dev 단계 CORS 회피용이며, **운영/모바일에서는 SPA가 백엔드를 직접 호출**한다.
- 자세히: [프록시](/glossary/proxy)

### 단계 2. JWT 필터가 인증한다 (경계 입구)
- `JwtAuthenticationFilter`가 `UsernamePasswordAuthenticationFilter` 앞에 배치된다(`SecurityConfig.java:77`). `Authorization: Bearer` 파싱 → `AuthUser` 복원 → `ROLE_<role>` 권한 부여.
- 세션 정책은 **STATELESS**(`SecurityConfig.java:38`). 서버는 세션을 안 들고, 매 요청이 토큰으로 자기 신원을 증명한다.
- 토큰이 없거나 무효여도 필터에서 막지 않고 **익명으로 통과**시킨다. 실제 인가 판단은 `authorizeHttpRequests`가 한다(`/api/admin/**` → `hasAnyRole("ADMIN","SUPER_ADMIN")`, 그 외 `anyRequest().authenticated()`).
- **넘기는 것**: 인증된 `Authentication`(또는 익명) → 컨트롤러.
- 자세히: [JWT 인증 흐름](/area-a/auth-jwt) · [JWT와 Spring Security](/backend/jwt-security) · [무상태(Stateless)](/glossary/stateless)

### 단계 3. 컨트롤러가 인가·검증한다
- `@RestController`가 경로·메서드 매핑, `@AuthenticationPrincipal AuthUser`로 사용자 식별(`authUser.id()`), 입력 검증(Bean Validation).
- 컨트롤러는 **비즈니스 로직을 담지 않는다.** 받은 DTO를 서비스로 위임만.
- **받는 것**: HTTP 요청 + 인증 / **넘기는 것**: 검증된 커맨드/DTO → 서비스.
- 자세히: [Spring MVC와 REST 컨트롤러](/backend/spring-mvc-rest) · [입력 검증](/backend/validation)

### 단계 4. 서비스가 비즈니스를 처리한다 (트랜잭션 경계)
- `@Transactional` 경계 안에서 도메인 규칙 수행. 여기서 필요하면 곁가지(AI 공급자·Qdrant·Python 워커 결과)를 호출하고, 그 결과를 도메인으로 가공한다.
- 점수·판단·크레딧 차감 같은 **결정적 판단은 서버 코드가 소유**(뉴로-심볼릭). LLM은 설명 텍스트만. → [뉴로-심볼릭](/area-c/neuro-symbolic)
- **받는 것**: 커맨드 / **넘기는 것**: 영속화·조회 요청 → 매퍼.
- 자세히: [트랜잭션](/glossary/transaction)

### 단계 5. 매퍼가 DB와 대화한다 (MyBatis)
- `@Mapper` 인터페이스 ↔ `resources/mapper/**/*.xml`의 SQL. JPA는 쓰지 않는다 — SQL을 직접 들고 가는 게 이 프로젝트의 규칙.
- **받는 것**: 도메인/파라미터 / **넘기는 것**: MySQL 행 ↔ 도메인 객체.
- 자세히: [MyBatis](/backend/mybatis) · [ORM과 MyBatis](/glossary/orm-and-mybatis) · [MySQL 스키마](/backend/mysql-schema)

### 단계 6. ApiResponse로 감싸 돌려준다
- 서비스 결과를 `ApiResponse.ok(data)`로 감싼다. 성공 `{ success:true, code:"OK", data:{...} }` / 실패 `{ success:false, code, message }`. (`common/web/ApiResponse`, `record`)
- Jackson이 JSON 직렬화 → 응답. 프론트 `api()` 래퍼가 엔벨로프를 풀어 `data`만 화면으로 전달.
- 자세히: [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [직렬화](/glossary/serialization)

:::details SSE만 이 경로의 예외다
AI 오케스트레이터의 진행 스트림(`POST /api/auto-prep/run/stream`, `produces=text/event-stream`)은 한 번에 끝나는 응답이 아니라 이벤트를 여러 번 흘린다. 그래서 **`ApiResponse` 엔벨로프를 타지 않고**, 프론트도 `api()` 래퍼 대신 `fetch`로 직접 받아 `\n\n` 단위로 파싱한다. 또 SSE 비동기 재디스패치가 401로 끊기는 걸 막으려고 `SecurityConfig`에 `dispatcherTypeMatchers(ASYNC, ERROR).permitAll()`(`:43`)을 단 게 오케스트레이터가 건드린 **유일한 공통영역 변경**이다. → [AI 오케스트레이터 전체](/flow/ai-orchestrator) · [SSE](/glossary/sse)
:::

---

## 4. 곁가지 시스템 — 표준 경로 밖의 세 가지

표준 `controller→service→mapper→DB` 경로 외에, 특정 도메인만 쓰는 외부 시스템이 셋 있다. 모두 **실패해도 본 요청을 깨뜨리지 않게** 격리돼 있다.

| 곁가지 | 누가 쓰나 | 통신 | 실패 시 |
| --- | --- | --- | --- |
| Python 공고추출 워커 | B(공고분석) | 별도 프로세스, OCR·문서텍스트 → 문장분류 | 비동기, 본 요청과 분리 |
| Qdrant 벡터DB | D(면접 RAG) | `:6333` 코사인 검색, 원본은 `interview_knowledge` | best-effort 건너뜀(RAG 없이 진행) |
| AI 공급자 | 전 영역(#1~34) | OpenAI/Anthropic Haiku/원격 Ollama(4090) | 폴백 체인 또는 Mock 규칙엔진 |

- **공고추출 워커**: 사용자가 올린 공고 이미지/문서를 OCR·텍스트화하고 문장을 분류해 B의 구조화 입력을 만든다. 백엔드 도메인과 **느슨하게 결합**(별도 프로세스)된 게 핵심. → [공고 추출 워커(Python)](/area-b/ml-worker) · [텍스트 추출·OCR](/area-b/text-extraction-ocr)
- **Qdrant**: 면접 질문 RAG의 벡터 검색만 담당하고, 원본 지식은 RDB `interview_knowledge`에 둔다. Qdrant가 없어도 면접은 RAG 보강만 빠진 채 진행된다(best-effort). → [면접 RAG·근거주입](/area-d/rag-grounding) · [RAG와 벡터DB](/ai/rag-qdrant)
- **AI 공급자**: 각 도메인 서비스가 "설명·생성"이 필요할 때만 호출. 공급자가 죽어도 폴백·Mock으로 화면을 지킨다(영역별 편차 있음). → [AI 공급자·폴백 전략](/flow/ai-providers-fallback)

:::warning 곁가지일수록 "끊겨도 본체는 산다"가 설계 의도다
면접에서 "그 외부 시스템이 죽으면요?"는 단골 꼬리질문이다. 정답은 항상 **격리**다 — 워커는 별도 프로세스, Qdrant는 best-effort 스킵, AI는 폴백/Mock. 표준 경로(인증→컨트롤러→서비스→DB)는 곁가지에 운명을 걸지 않는다.
:::

---

## 5. 설계 포인트 — 왜 이렇게 연결했나

### 5-1. 4계층 공통 규약 (통합 클래스 설계서)
6명이 6개 영역을 각자 만들지만 **계층 이름·책임·응답 형식이 똑같다.** `controller → service → mapper → domain`(+필요 시 `dto`). 그래서 영역 간 코드를 읽을 때 위치를 추측하지 않아도 된다(예측가능성). 응답은 전부 `ApiResponse<T>`라 프론트의 응답 처리 코드도 단 하나면 된다. → [4계층 구조](/glossary/layered-architecture)

### 5-2. MyBatis 단일 영속성 (JPA 금지)
복잡한 적합도·집계 쿼리를 SQL로 직접 통제하기 위해 JPA 대신 MyBatis로 통일했다. "ORM이 만들어 주는 쿼리"가 아니라 "내가 쓴 SQL"이라 성능·정합성을 손에 쥔다. 규약: `@Mapper` 인터페이스 + `mapper/**/*.xml`.

### 5-3. STATELESS + JWT (수평 확장 가능한 경계)
서버가 세션을 안 들기 때문에 어느 인스턴스가 요청을 받아도 토큰만 보면 신원을 안다. 필터는 막지 않고 통과만, 인가는 `SecurityConfig`가 선언적으로 — **인증과 인가의 책임 분리**다. Access 30분 / Refresh 14일, 리프레시 원장은 DB(`auth/domain/RefreshToken`). → [토큰/세션/쿠키](/glossary/token-session-cookie) · [인증 vs 인가](/glossary/auth-authn-authz)

### 5-4. 단일 프록시 진입점 `/api/**`
모든 백엔드 컨트롤러가 `/api/**` 하위라, 프론트는 "이 경로면 백엔드"라는 규칙 하나로 라우팅·프록시·CORS를 통일한다. CORS는 `/api/**`에만 적용되며 Vite(5173)·Capacitor(`capacitor://localhost`) 오리진을 `allowCredentials=true`로 허용. → [CORS](/glossary/cors)

### 5-5. 곁가지 격리 = 가용성
앞 §4에서 본 대로, 외부 의존(워커·Qdrant·AI)은 본 경로에서 분리하고 폴백/스킵으로 감쌌다. "한 부품이 죽어도 전체가 안 죽는다"가 이 아키텍처가 데모를 넘어 운영 가능한 이유다.

### 5-6. 모바일은 "다른 앱"이 아니다 (Capacitor)
모바일 앱은 별도 코드베이스가 아니라 **같은 React 빌드를 Capacitor WebView로 감싼 것**이다. 그래서 웹에서 고치면 앱에도 반영된다(코드 1벌). CORS에 `capacitor://localhost`가 들어간 이유가 이것. → [모바일 앱(Capacitor)](/frontend/capacitor-mobile) · [PWA와 서비스워커](/frontend/pwa)

---

## 6. 구현 상태 — 정직하게

| 구현 완료 (현재 동작) | 부분/계획 (정직 구분) |
| --- | --- |
| 4계층 + `ApiResponse` 엔벨로프 전 영역 | 자체 OSS 파인튜닝 모델 학습·서빙(영역별 진행도 상이) |
| STATELESS JWT + 리프레시 원장 | 일부 영역 실 OpenAI 키 연동 활성화 |
| MyBatis/MySQL 기준 SHA의 172개 테이블 | (정본 DDL과 증분 패치로 관리) |
| Vite 프록시 + CORS + Capacitor 셸 | |
| AutoPrep 오케스트레이터·SSE | |
| Qdrant RAG·Python 공고추출 워커 배선 | |

:::tip 정직한 한 줄
"**아키텍처와 계약(4계층·엔벨로프·인증 경계·곁가지 배선)은 완성**돼 있고, 일부 AI 공급자는 키/모델 발급 후 활성화하는 단계입니다. 화면과 API 계약은 실제 LLM과 동일하게 동작합니다."
:::

기준 커밋의 canonical `schema.sql`에는 서로 다른 `CREATE TABLE` 선언이 **172개**다. 이후 패치에 따라 달라질 수 있으므로 항상 [문서 기준선](/project/source-baseline)의 SHA와 함께 말한다. → [데이터 소유권 경계 맵](/flow/data-ownership)

---

## 7. 면접 답변 — 전체를 흐름으로 설명하기

> 아래를 60~90초로 말할 수 있으면 "아키텍처 설명해 보세요"는 통과다.

"CareerTuner는 React SPA, Spring Boot REST, MyBatis/MySQL의 3축에 Qdrant·Python 워커·AI 공급자가 곁가지로 붙은 구조입니다.

요청 생명주기를 따라가면 — 프론트가 `/api`로 `fetch`하면 dev에서는 Vite 프록시가 8080으로 넘기고, 운영·모바일에서는 백엔드를 직접 칩니다. 들어온 요청은 먼저 `JwtAuthenticationFilter`가 Bearer 토큰을 파싱해 사용자를 복원하는데, 세션은 STATELESS라 서버가 상태를 안 듭니다. 그다음 컨트롤러가 인가·검증을 하고, 서비스가 트랜잭션 안에서 비즈니스를 처리하면서 필요하면 AI나 Qdrant를 호출하고, 매퍼가 MyBatis로 MySQL과 대화합니다. 마지막에 결과를 전부 `ApiResponse<T>` 엔벨로프로 감싸 돌려줍니다.

핵심 설계는 **공통 규약**입니다. 6명이 6개 영역을 만들어도 `controller→service→mapper→domain` 4계층과 `ApiResponse`라는 단일 응답 형식을 공유해서 한 시스템처럼 동작합니다. 외부 의존은 전부 격리해서, 워커는 별도 프로세스, Qdrant는 best-effort, AI는 폴백/Mock으로 본 경로가 죽지 않게 했습니다. 모바일은 같은 React 빌드를 Capacitor로 감싼 거라 코드가 한 벌입니다."

---

## 8. 꼬리질문 + 모범답안

::: details 왜 JPA 안 쓰고 MyBatis인가요?
적합도·집계 쿼리가 복잡해서 SQL을 직접 통제하고 싶었습니다. ORM이 생성하는 쿼리에 성능·정합성을 맡기는 대신, `@Mapper` + XML로 SQL을 손에 쥐어 튜닝과 디버깅을 명시적으로 합니다. 프로젝트 규약으로 영속성은 MyBatis 단일입니다.
:::

::: details STATELESS인데 로그아웃·토큰 무효화는 어떻게 하나요?
Access 토큰 자체는 짧게(30분) 두고, Refresh 토큰을 DB 원장(`RefreshToken`)으로 관리합니다. 로그아웃·재발급 시 그 원장을 폐기/회전시켜 무효화합니다. Access는 STATELESS로 빠르게 검증하고, 장기 신뢰는 DB가 통제하는 분리 구조입니다.
:::

::: details SSE는 왜 ApiResponse를 안 쓰나요?
SSE는 한 번에 끝나는 응답이 아니라 진행 이벤트를 연속으로 흘리는 스트림이라, 단발 JSON 엔벨로프(`ApiResponse`)와 형식이 안 맞습니다. 그래서 `text/event-stream`으로 내보내고 프론트도 `fetch`로 직접 `\n\n` 단위 파싱합니다. 대신 비동기 재디스패치가 401로 끊기지 않게 `ASYNC/ERROR` 디스패치를 permitAll로 열어줬습니다.
:::

::: details Qdrant나 AI 서버가 죽으면 서비스가 멈추나요?
아니요, 곁가지는 전부 격리돼 있습니다. Qdrant 장애는 RAG 보강만 건너뛰고 면접은 진행되며, AI 공급자 장애는 폴백 체인 또는 Mock 규칙엔진으로 흡수합니다. 표준 경로(인증→컨트롤러→서비스→DB)는 외부 의존에 운명을 걸지 않습니다.
:::

::: details 모바일 앱은 따로 개발했나요?
아니요. 웹과 같은 React 빌드를 Capacitor WebView로 감싼 단일 코드베이스입니다. 그래서 CORS 허용 오리진에 `capacitor://localhost`가 들어가 있고, 웹 수정이 앱에 그대로 반영됩니다.
:::

---

## 9. 직접 말해보기

다음을 보지 않고 말할 수 있으면 이 페이지는 합격이다.

- **요청 생명주기 6단계**를 순서대로 (fetch → 프록시 → JWT필터 → 컨트롤러 → 서비스 → 매퍼 → ApiResponse)
- **4계층 이름과 각 책임** 한 줄씩, 그리고 "왜 공통 규약이 핵심인가"
- **STATELESS + JWT**가 인증/인가 책임을 어떻게 나누나
- **곁가지 3종**(워커·Qdrant·AI)과 각각 "죽으면 어떻게 되나"
- **Capacitor**가 왜 "다른 앱이 아닌가"

---

## 관련 흐름 페이지

- [흐름 개요](/flow/) — 6영역을 가로지르는 전체 그림
- [사용자 end-to-end 여정](/flow/user-journey) — A→F 화면 8단계
- [지원 건 중심 흐름](/flow/application-case) — 핵심 단위가 왜 공고가 아니라 지원 건인가
- [데이터 소유권 경계 맵](/flow/data-ownership) — 테이블 단위 읽기전용 경계
- [AI 오케스트레이터 전체](/flow/ai-orchestrator) — 의존그래프·SSE
- [팀 협업·시스템 경계](/flow/team-collaboration)

---

## 퀴즈

<QuizBox question="CareerTuner의 표준 요청 생명주기 순서로 옳은 것은?" :choices="['컨트롤러 → JWT필터 → 서비스 → 매퍼 → DB', 'JWT필터 → 컨트롤러 → 서비스 → 매퍼 → DB → ApiResponse', '서비스 → 컨트롤러 → 매퍼 → JWT필터 → DB', 'Vite프록시 → DB → 서비스 → 컨트롤러 → JWT필터']" :answer="1" explanation="요청은 (dev에서) Vite 프록시로 8080에 전달된 뒤, JwtAuthenticationFilter가 먼저 인증하고, 컨트롤러가 인가·검증, 서비스가 비즈니스·트랜잭션, 매퍼(MyBatis)가 DB를 다룬 후, 결과를 ApiResponse 엔벨로프로 감싸 돌려준다. JWT 필터가 컨트롤러보다 앞에 있는 것이 핵심이다." />

<QuizBox question="6개 영역(A~F)을 한 시스템처럼 묶어 주는 가장 핵심적인 공통 규약 두 가지는?" :choices="['Qdrant와 Python 워커', 'controller→service→mapper→domain 4계층과 ApiResponse 단일 응답 형식', 'OpenAI 키와 Capacitor', 'JPA 엔티티와 세션 인증']" :answer="1" explanation="6명이 각자 만든 영역이 한 시스템처럼 보이는 이유는 모두 같은 4계층 구조(controller→service→mapper→domain)와 같은 응답 엔벨로프(ApiResponse<T>)를 공유하기 때문이다. 영속성은 MyBatis 단일이며 JPA는 금지다." />

<QuizBox question="Qdrant 벡터DB가 일시적으로 응답하지 않을 때 면접(D) 기능의 동작으로 옳은 것은?" :choices="['면접 요청 전체가 500 에러로 실패한다', 'RAG 근거 보강만 건너뛰고(best-effort) 면접은 계속 진행된다', '자동으로 MySQL 세션을 롤백한다', 'ApiResponse 엔벨로프가 비활성화된다']" :answer="1" explanation="Qdrant는 면접 RAG의 벡터 검색만 담당하는 곁가지이고 원본 지식은 RDB(interview_knowledge)에 있다. Qdrant 장애는 best-effort로 건너뛰어 RAG 보강만 빠진 채 면접이 진행된다. 곁가지 격리가 가용성을 지킨다." />

# 기초 용어집 개요

> 면접에서 막히는 진짜 이유는 "구현을 못 해서"가 아니라 "그 단어를 내 입으로 정의 못 해서"다. 여기서 단어부터 잡는다.

## 왜 단어 정의부터 잡아야 하는가

면접관이 "REST가 뭐예요?"라고 물으면, 코드를 잘 짠 사람도 절반은 "음... HTTP로 API 만드는 거요" 같은 흐릿한 답을 한다. 문제는 실력이 아니라 **단어의 경계를 못 그어서**다. CareerTuner를 직접 만들었다면 이미 REST, JWT, DTO, MyBatis를 매일 썼지만, "써본 것"과 "한 문장으로 정의하고 옆 개념과의 차이를 설명하는 것"은 완전히 다른 능력이다.

이 용어집은 그 간극을 메운다. 각 페이지는 **한 줄 정의 → 단어 뜻(약자 풀이) → 왜 필요한가 → CareerTuner의 실제 클래스/파일에서 어디에 썼나 → 면접 답변 3단계** 순서로 똑같이 구성돼서, 어떤 단어를 물어봐도 같은 틀로 답이 튀어나오게 훈련한다.

:::tip 핵심 원칙
면접 답변은 항상 "정의 한 문장 → 왜 쓰는지 → 우리 프로젝트에서 어디에" 순서다. 정의가 흐리면 뒤의 설명이 다 무너진다. 그래서 정의부터다.
:::

## 단어가 흐릿하면 무슨 문제가 생기나

| 흐릿한 답 | 무엇을 못 짚은 건가 | 명료한 답 |
| --- | --- | --- |
| "REST? 그냥 API요" | REST와 HTTP를 구분 못 함 | "자원을 URL로, 행위를 HTTP 메서드로 표현하는 API 설계 원칙" |
| "JWT는 로그인 토큰요" | 세션과의 차이, stateless를 못 짚음 | "서버가 상태를 저장하지 않고 서명으로 검증하는 자체 포함 토큰" |
| "DTO는 그냥 객체요" | Entity와 경계가 무너짐 | "계층 간 전송 전용 객체, 도메인/응답을 분리하는 그릇" |

흐릿한 정의 하나가 꼬리질문 3개를 연쇄로 무너뜨린다. 반대로 정의가 날카로우면 면접관이 파고들수록 점수가 올라간다.

## 권장 학습 순서

아래 순서는 "바깥에서 안으로" 흐른다. 클라이언트가 서버를 부르는 통신 규약부터 시작해서, 서버 내부 계층, 데이터 저장, 보안, 마지막에 프론트엔드와 배포로 들어간다. **위에서부터 순서대로 읽으면 다음 단어가 앞 단어를 전제로 쌓인다.**

### 1단계 — 통신의 뼈대 (어떻게 주고받나)

1. [API](/glossary/api) — 프로그램끼리 약속한 호출 창구
2. [REST API](/glossary/rest-api) — 자원 중심 API 설계 원칙
3. [HTTP 메서드와 상태코드](/glossary/http-methods) — REST가 올라타는 통신 프로토콜
4. [JSON](/glossary/json) — 데이터를 주고받는 텍스트 포맷
5. [Request / Response](/glossary/request-response) — 요청 한 번에 응답 한 번, 그 한 쌍의 구조

### 2단계 — 서버 내부 구조 (요청이 안에서 어떻게 흐르나)

6. [DTO](/glossary/dto) — 계층 간 전송 전용 객체
7. [Entity / Domain](/glossary/entity-domain) — 도메인/DB 행을 표현하는 객체
8. [4계층 구조](/glossary/layered-architecture) — controller → service → mapper → domain
9. [ORM과 MyBatis](/glossary/orm-and-mybatis) — SQL 매퍼 영속성 프레임워크
10. [트랜잭션](/glossary/transaction) — 전부 성공 아니면 전부 취소

### 3단계 — 보안과 신원 (누가 호출하는가)

11. [인증 vs 인가](/glossary/auth-authn-authz) — 누구인지 vs 무엇을 할 수 있는지
12. [토큰 / 세션 / 쿠키](/glossary/token-session-cookie) — 신원을 담은 증표 (Access/Refresh)
13. [CORS](/glossary/cors) — 브라우저의 교차 출처 호출 정책

### 4단계 — 우리 팀 규약과 프론트 (어떻게 묶는가)

14. [ApiResponse 엔벨로프](/glossary/api-response-envelope) — 모든 응답을 감싸는 공통 포맷
15. [SPA](/glossary/spa) — 페이지 새로고침 없는 단일 페이지 앱
16. [컴포넌트 / Props / State](/glossary/component-props-state) — UI를 재사용 단위로 쪼갠 조각
17. [Hook](/glossary/hook) — React 함수형 상태/로직 재사용

### 5단계 — 만든 걸 굴리기

18. [CI / CD](/glossary/ci-cd) — 통합/배포 자동화 파이프라인

:::details 왜 하필 이 순서인가?
통신 규약(API/REST/HTTP/JSON)을 먼저 잡아야 "서버가 받은 JSON을 DTO로 받는다" 같은 다음 문장이 성립한다. DTO/Entity를 알아야 4계층에서 무엇이 흐르는지 보이고, 4계층을 알아야 MyBatis가 어느 칸에 들어가는지 보인다. 보안은 통신 위에 얹히는 층이라 통신 다음이고, 프론트/배포는 전체를 감싸는 가장 바깥이라 마지막이다.
:::

## CareerTuner에서 이 단어들이 실제로 사는 곳

용어집은 추상 사전이 아니다. 모든 단어가 CareerTuner 코드에 박혀 있다. 아래 표의 클래스/파일을 보면서 단어를 외우면 "외운 정의"가 아니라 "내가 만진 코드"로 말하게 된다.

| 용어 | CareerTuner 실제 위치 |
| --- | --- |
| API / REST / HTTP | `@RestController` + `@RequestMapping("/api/**")` 컨트롤러 전부 |
| JSON | `OpenAiResponsesClient`의 structured output, 모든 응답 본문 |
| DTO / Entity | `dto` 패키지(요청·응답) vs `domain` 패키지(테이블 매핑) |
| 4계층 | `controller → service → mapper → domain` (예: `fitanalysis` 모듈) |
| MyBatis | `@Mapper` 인터페이스 + `resources/mapper/**/*.xml` |
| 인증/인가 / 토큰 | `JwtTokenProvider`, `JwtAuthenticationFilter`, `SecurityConfig` |
| CORS | `SecurityConfig`의 허용 오리진 `localhost:5173`, `capacitor://localhost` |
| ApiResponse | `common/web/ApiResponse` record (`success`, `code`, `message`, `data`) |
| 예외/에러코드 | `BusinessException` + `ErrorCode` enum + `GlobalExceptionHandler` |
| SPA / 컴포넌트 / Hook | React Router 8, `app/components/ui`, `useApplicationFitAnalysis` |
| CI/CD | GitHub Actions 5종 (`frontend-ci`, `service-pipeline-ci`, `deploy-demo` 등) |

:::tip 영역 표시 (정직하게 말하기)
이 표는 학습용 좌표다. CareerTuner는 6명이 영역 A~F를 나눠 맡고(자세히는 [영역별 심화](/areas/)), 인증/CORS/ApiResponse·예외 처리 같은 공통 영역은 팀 공통 규약이다. 면접에서는 **자기가 직접 만든 영역**과 **팀 공통 규약을 따라 쓴 부분**을 정직하게 구분해서 말하는 게 핵심이다.
:::

## 이 영역 단골 면접질문 5개

이 5개는 어느 회사 면접이든 거의 반드시 나온다. 각 질문에 대한 정식 답변은 연결된 페이지에서 단계별로 훈련한다.

1. **REST API가 뭔가요? RESTful하다는 건 무슨 뜻이죠?**
   → 자원을 URL로, 행위를 HTTP 메서드(GET/POST/PUT/DELETE)로 표현하는 설계 원칙. 자세히는 [REST API](/glossary/rest-api).

2. **JWT는 어떻게 동작하나요? 세션과 뭐가 다른가요?**
   → 서버가 상태를 저장하지 않고 서명으로 검증하는 stateless 토큰. CareerTuner는 Access 30분 / Refresh 14일(DB 저장). 자세히는 [토큰 / 세션 / 쿠키](/glossary/token-session-cookie).

3. **DTO와 Entity의 차이는?**
   → 전송 전용 그릇(DTO) vs 도메인·DB 행 표현(Entity). 계층 경계를 지키려고 분리한다. 자세히는 [DTO](/glossary/dto) · [Entity / Domain](/glossary/entity-domain).

4. **MyBatis를 왜 썼나요? JPA와 비교하면?**
   → SQL을 직접 통제하는 매퍼 프레임워크. CareerTuner는 JPA 금지 규약이라 `@Mapper` + XML만 쓴다. 자세히는 [ORM과 MyBatis](/glossary/orm-and-mybatis).

5. **CORS 에러는 왜 나고 어떻게 푸나요?**
   → 브라우저가 다른 출처 응답을 막는 보안 정책. 서버에서 허용 오리진을 명시해 푼다. 자세히는 [CORS](/glossary/cors).

:::tip 답변 공식 (어떤 질문이든)
한 문장 정의 → 왜 필요한지(없으면 생기는 문제) → CareerTuner의 실제 클래스/파일 한 개. 이 3박자만 지키면 흐릿하게 안 들린다.
:::

## 직접 말해보기

다음 두 질문에 **각각 30초 안에** 소리 내어 답해봐라. 답이 막히는 단어가 바로 다음에 펼칠 페이지다.

1. "REST → HTTP → JSON" 세 단어를 한 문장씩, 서로의 관계가 드러나게 이어서 설명해보라. (힌트: REST는 설계 원칙, HTTP는 그 원칙이 올라타는 프로토콜, JSON은 그 위로 오가는 데이터 포맷)
2. CareerTuner에서 사용자가 적합도 분석을 요청했을 때, 요청이 `controller → service → mapper`를 거치며 DTO와 Entity가 어디서 등장하고, 응답이 `ApiResponse`로 어떻게 감싸여 나가는지 한 호흡으로 말해보라.

## 퀴즈

<QuizBox
  question="이 용어집의 권장 학습 순서가 'API → REST → HTTP → JSON'으로 시작하는 이유로 가장 적절한 것은?"
  :choices="['알파벳 순서이기 때문에', '통신 규약(바깥)을 먼저 잡아야 서버 내부 구조 설명이 성립하기 때문에', '난이도가 가장 낮은 순서이기 때문에', 'CareerTuner에서 가장 먼저 구현한 순서이기 때문에']"
  :answer="1"
  explanation="학습 순서는 바깥에서 안으로 흐른다. 통신 규약을 먼저 알아야 '서버가 받은 JSON을 DTO로 받는다' 같은 다음 문장이 성립하고, 그 위에 보안과 프론트가 층층이 쌓인다."
/>

<QuizBox
  question="면접에서 어떤 기술 용어를 물어봐도 통하는 '답변 공식' 3박자를 순서대로 말해보라."
  explanation="첫째 한 문장 정의(이게 무엇인가), 둘째 왜 필요한가(없으면 생기는 문제), 셋째 CareerTuner의 실제 클래스/파일 한 개로 착지. 예를 들어 JWT라면 '서버 상태 없이 서명으로 검증하는 stateless 토큰 → 서버를 확장해도 세션 공유가 필요 없어서 → JwtTokenProvider로 Access 30분 토큰을 발급한다'처럼 정의·이유·실물 세 박자를 지키면 흐릿하게 들리지 않는다."
/>

<QuizBox
  question="CareerTuner에서 DTO와 Entity는 각각 주로 어느 패키지에 두고, 왜 나누는가?"
  :choices="['둘 다 domain 패키지에 두고 이름만 다르게 한다', 'DTO는 dto 패키지(전송용), Entity(도메인)는 domain 패키지에 두어 계층 경계를 지킨다', 'DTO는 controller에, Entity는 service에 인라인으로 선언한다', '구분 없이 Map 하나로 처리한다']"
  :answer="1"
  explanation="요청·응답 전송 전용 객체는 dto 패키지, 도메인/DB 행을 표현하는 객체는 domain 패키지에 둔다. 이렇게 분리해야 컨트롤러의 입출력 형태 변화가 도메인까지 번지지 않고 계층 경계가 유지된다."
/>

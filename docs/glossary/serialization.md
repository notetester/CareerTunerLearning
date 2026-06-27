# 직렬화 / 역직렬화 (Serialization)

> 메모리 위의 객체를 JSON 같은 전송 가능한 형태로 바꾸고(직렬화), 다시 객체로 되돌리는(역직렬화) 변환. CareerTuner의 모든 HTTP 요청·응답이 이 변환 위에서 돈다.

## 1. 한 줄 정의

직렬화는 **메모리 안의 객체를 바이트열/문자열(주로 JSON)로 변환**하는 것이고, 역직렬화는 그 **문자열을 다시 객체로 복원**하는 것이다. 네트워크나 디스크는 객체를 모르고 바이트만 알기 때문에 경계를 넘으려면 반드시 한 번 펴고(직렬화), 받는 쪽에서 다시 접는다(역직렬화).

## 2. 단어 뜻 (약자·어원)

| 용어 | 어원·뜻 |
| --- | --- |
| Serialization | serial(직렬, 줄지어 늘어선) + -ization. 객체 그래프를 "한 줄의 바이트 흐름"으로 펴는 것 |
| Deserialization | de-(반대) + serialization. 줄로 편 것을 다시 객체 구조로 접는 것 |
| Marshalling / Unmarshalling | 같은 개념의 다른 이름. RPC·CORBA 계열에서 주로 씀 |
| JSON | JavaScript Object Notation. CareerTuner가 직렬화 결과로 쓰는 텍스트 포맷 |
| Jackson | Java 진영의 표준 JSON 직렬화 라이브러리. Spring Boot가 기본 탑재 |

핵심 직관: **직렬화는 "객체 → 글자", 역직렬화는 "글자 → 객체"**. 방향만 반대다.

## 3. 왜 필요 (없으면 무슨 문제)

- **프로세스 경계를 넘을 수 없다.** 브라우저(React)와 서버(Spring)는 서로 다른 프로세스다. 자바 객체 `FitAnalysisResult` 인스턴스를 그대로 네트워크에 흘려보낼 방법은 없다. 둘 다 이해하는 공통 텍스트(JSON)로 바꿔야 한다.
- **언어가 다르다.** 서버는 Java, 클라이언트는 TypeScript다. 공통 표현이 없으면 통신 자체가 불가능하다. JSON이 그 중립 지대다.
- **저장·캐시도 같은 문제다.** DB의 JSON 컬럼, Redis 캐시, 로그 파일 — 전부 "객체를 글자로 펴서 저장하고, 읽을 때 되돌리는" 직렬화 문제다.
- **수동으로 하면 지옥이다.** 필드 하나 추가할 때마다 손으로 문자열을 이어붙이면 따옴표·이스케이프·null·날짜 포맷에서 반드시 버그가 난다. Jackson이 이걸 규약 기반으로 자동화한다.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner 백엔드는 **Spring Boot 4 / Jackson 3** 위에서 동작한다. 일반 코드에서 `new ObjectMapper()`를 직접 만들지 않고 **Spring이 관리하는 ObjectMapper Bean을 생성자 주입**받아 쓰는 규약이 코드로 강제돼 있다.

- **응답 직렬화 (객체 → JSON):** 모든 컨트롤러는 `ApiResponse<T>` 엔벨로프를 반환한다. `D:/dev/CareerTuner/backend/src/main/java/com/careertuner/common/web/ApiResponse.java` 의 `record ApiResponse<T>(boolean success, String code, String message, T data)` 가 Jackson에 의해 JSON으로 펴진다.
  - 같은 파일 클래스 선언에 `@JsonInclude(JsonInclude.Include.NON_NULL)` 가 붙어 있어, `message`가 `null`인 성공 응답에서는 그 필드가 **JSON에서 통째로 빠진다**. (아래 5절 표 참고)
- **응답 DTO (직렬화 대상):** C 담당 적합도 기능의 `FitAnalysisDetailResponse` (`backend/.../fitanalysis/dto/FitAnalysisDetailResponse.java`) 가 대표적이다. `record`의 컴포넌트(`fitScore`, `matchedSkills`, `applyDecision`, `scoreBreakdown` 등)가 그대로 JSON 키가 된다. 도메인 객체 `FitAnalysisResult`를 그대로 노출하지 않고 이 응답 전용 DTO로 한 번 갈아끼운다 — 노출 필드 제어를 위해서다. ([DTO](/glossary/dto) 참고)
- **요청 역직렬화 (JSON → 객체):** `FitAnalysisController.updateLearningTask(...)` 의 파라미터 `@RequestBody UpdateLearningTaskRequest request` 가 그것. 클라이언트가 보낸 JSON 본문을 Jackson이 `record UpdateLearningTaskRequest(boolean completed)` 로 되돌린다.
- **DB의 JSON 컬럼 ↔ 객체:** 분석 결과의 일부는 텍스트/JSON으로 DB에 저장된다. `fit_analysis`·`career_analysis_run` 같은 테이블에서 꺼낸 JSON 문자열을 서비스 계층에서 주입받은 `ObjectMapper`로 `readValue` 해 객체로 푼다 (예: `FitAnalysisServiceImpl`, `AnalysisServiceImpl`이 `tools.jackson.databind.ObjectMapper`와 `TypeReference`를 사용).
- **AI 구조화 출력:** `OpenAiResponsesClient` 계열은 LLM이 돌려준 JSON 텍스트를 `JsonNode`/객체로 역직렬화해 서버 규칙으로 검증한다 ([OpenAI 구조화 출력](/ai/openai-structured-output)).

:::tip 보안 메모
공개 응답에는 비밀번호 해시·내부 ID·토큰 같은 민감 필드가 절대 새어나가면 안 된다. CareerTuner는 도메인 엔티티를 직접 직렬화하지 않고 응답 **DTO만** 직렬화하므로, "DTO에 없는 필드는 JSON에 못 나간다"가 1차 방어선이다.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

### 방향과 진입점

| 방향 | 트리거 | 입력 | 출력 | CareerTuner 예 |
| --- | --- | --- | --- | --- |
| 직렬화 | 컨트롤러가 객체 `return` | 자바 객체 | JSON 문자열 | `ApiResponse.ok(detail)` → 응답 본문 |
| 역직렬화 | `@RequestBody` 바인딩 | JSON 문자열 | 자바 객체 | `UpdateLearningTaskRequest request` |

### 직렬화 결과 — `@JsonInclude(NON_NULL)` 효과

`ApiResponse.ok(data)` 는 `message`를 `null`로 둔다. `NON_NULL` 정책 때문에 그 키는 출력에서 사라진다.

```json
// 성공: message 가 null 이라 키 자체가 빠진다
{ "success": true, "code": "OK", "data": { "fitScore": 82 } }

// 실패: ApiResponse.error(...) → data 가 null 이라 data 키가 빠진다
{ "success": false, "code": "NOT_FOUND", "message": "분석을 찾을 수 없습니다" }
```

### record 가 직렬화/역직렬화되는 방식

```java
// 직렬화: record 의 컴포넌트 이름이 곧 JSON 키
public record UpdateLearningTaskRequest(boolean completed) {}
// → { "completed": true }

// 역직렬화: Jackson 이 JSON 키를 보고 표준 생성자로 객체를 만든다
// @RequestBody UpdateLearningTaskRequest request  ← 위 JSON 본문을 받아 복원
```

### Spring 관리 ObjectMapper 를 쓰는 이유 (코드로 강제됨)

CareerTuner에는 규약을 지키는지 검사하는 테스트가 있다. `new ObjectMapper(...)` 직접 생성과 구버전 Jackson import를 금지한다.

```java
// JacksonUsageConventionTests: 아래가 코드에 있으면 테스트 실패
//   import com.fasterxml.jackson.databind.*   (구버전 import 금지)
//   new ObjectMapper(...)                     (직접 생성 금지)
// → 서비스는 생성자 주입된 단일 ObjectMapper Bean 만 사용
```

왜 단일 Bean을 강제하나: 날짜 포맷, `NON_NULL` 정책, 모듈 등록 같은 설정이 **앱 전체에서 일관**되도록. 각자 `new ObjectMapper()`를 만들면 어떤 응답은 날짜가 타임스탬프로, 어떤 응답은 ISO 문자열로 나가는 식의 불일치가 생긴다.

### 자주 쓰는 어노테이션 (필드 노출 제어)

| 어노테이션 | 효과 |
| --- | --- |
| `@JsonInclude(NON_NULL)` | null 필드를 JSON에서 제외 |
| `@JsonIgnore` | 그 필드를 직렬화·역직렬화 양쪽에서 무시 |
| `@JsonProperty("name")` | 자바 필드명과 다른 JSON 키 매핑 |

:::warning 흔한 함정
역직렬화는 **신뢰 경계의 입구**다. 클라이언트가 보낸 JSON에 서버가 기대하지 않은 필드가 있어도 기본은 무시되지만, **권한·점수 같은 값은 절대 요청 JSON을 그대로 믿으면 안 된다.** CareerTuner에서 적합도 점수·판정은 LLM/요청이 아니라 **서버 규칙과 검증으로 확정**한다 — 역직렬화는 "값을 받는 통로"일 뿐 "값을 신뢰하는 근거"가 아니다.
:::

## 6. 면접 답변 3단계 (초간단/기본/꼬리질문)

- **초간단:** "직렬화는 객체를 JSON 같은 글자로 펴는 것, 역직렬화는 글자를 다시 객체로 되돌리는 것입니다. 서버와 브라우저가 객체를 직접 주고받을 수 없어서 필요합니다."
- **기본:** "CareerTuner는 Spring Boot + Jackson을 씁니다. 컨트롤러가 `ApiResponse` 같은 객체를 반환하면 Jackson이 JSON으로 직렬화하고, `@RequestBody` DTO로 들어오는 JSON은 record로 역직렬화합니다. 도메인 엔티티가 아니라 응답 DTO만 직렬화해서 노출 필드를 통제하고, `@JsonInclude(NON_NULL)`로 null 필드를 빼 응답을 가볍게 합니다."
- **꼬리질문 대비:** "ObjectMapper는 직접 만들지 않고 Spring이 관리하는 단일 Bean을 주입받습니다. 날짜 포맷·null 정책 같은 직렬화 규칙을 앱 전체에서 일관되게 유지하려는 거고, 실제로 직접 생성을 막는 컨벤션 테스트가 있습니다."

## 7. 꼬리질문 + 모범답안 (3~5)

:::details Q1. 직렬화와 역직렬화의 방향을 헷갈리지 않게 설명해 보세요.
직렬화는 "내보내기": 메모리의 객체 → 전송용 글자(JSON). 응답을 만들 때 일어납니다. 역직렬화는 "받아들이기": 들어온 글자 → 객체. 요청 본문을 받을 때 일어납니다. CareerTuner 기준으로는 `ApiResponse.ok(detail)`이 직렬화, `@RequestBody UpdateLearningTaskRequest`가 역직렬화입니다.
:::

:::details Q2. 도메인 엔티티를 그대로 직렬화하면 왜 안 되나요?
세 가지 문제입니다. (1) 보안 — 비밀번호 해시·내부 식별자처럼 노출되면 안 되는 필드가 새어나갈 수 있습니다. (2) 결합 — DB 스키마가 바뀌면 API 응답이 같이 흔들립니다. (3) 형태 불일치 — 화면이 필요로 하는 모양과 테이블 모양은 다릅니다. 그래서 `FitAnalysisDetailResponse` 같은 응답 DTO로 한 번 갈아끼워 노출을 명시적으로 통제합니다. (자세히는 [DTO](/glossary/dto))
:::

:::details Q3. `@JsonInclude(NON_NULL)`은 무엇을 해결하나요?
값이 없는 필드를 JSON에서 통째로 빼서 페이로드를 줄이고, 클라이언트가 "키가 없다 = 값이 없다"로 단순하게 판단하게 합니다. CareerTuner의 `ApiResponse`는 성공일 때 `message`가, 실패일 때 `data`가 null인데 이 정책으로 각각 그 키가 사라집니다. 응답 형태가 상황별로 깔끔해집니다.
:::

:::details Q4. ObjectMapper를 매번 new로 만들지 않고 Bean으로 주입받는 이유는?
ObjectMapper는 스레드 세이프하고 생성 비용이 있어 재사용이 권장됩니다. 더 중요한 건 일관성입니다. 날짜 포맷, null 포함 정책, 등록 모듈 같은 직렬화 규칙이 인스턴스마다 달라지면 응답 포맷이 들쭉날쭉해집니다. CareerTuner는 Spring이 구성한 단일 Bean을 생성자 주입으로 받게 하고, 직접 생성과 구버전 import를 컨벤션 테스트로 막습니다.
:::

:::details Q5. 역직렬화에서 보안상 주의할 점은?
역직렬화는 외부 입력이 시스템에 들어오는 지점이라 신뢰 경계입니다. 들어온 값을 그대로 권위 있는 데이터로 믿으면 안 됩니다. 예를 들어 적합도 점수나 판정은 요청 JSON 값을 그대로 쓰지 않고 서버 규칙으로 다시 계산·검증해 확정합니다. 또 Bean 검증(`@Valid`, `@NotBlank` 등)으로 형태를 1차로 거릅니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 30초 안에 설명할 수 있으면 통과다.

1. 직렬화/역직렬화를 각각 한 문장으로, 방향을 정확히 말하기.
2. CareerTuner에서 직렬화가 일어나는 지점 1개(`ApiResponse` 응답)와 역직렬화가 일어나는 지점 1개(`@RequestBody` DTO)를 실제 클래스명으로 들기.
3. "왜 도메인 엔티티 대신 응답 DTO를 직렬화하는가"를 보안·결합 관점으로 답하기.
4. `@JsonInclude(NON_NULL)`이 우리 `ApiResponse`에서 구체적으로 무엇을 빼는지 말하기.

## 퀴즈

<QuizBox question="CareerTuner에서 직렬화(객체 → JSON)가 일어나는 지점은?" :choices="['@RequestBody UpdateLearningTaskRequest 로 요청 본문을 받을 때', '컨트롤러가 ApiResponse 객체를 return 할 때', 'MyBatis 가 SELECT 결과를 도메인에 매핑할 때', 'JWT 토큰을 검증할 때']" :answer="1" explanation="컨트롤러가 ApiResponse 같은 객체를 반환하면 Jackson이 이를 JSON 문자열로 직렬화해 응답 본문으로 내보냅니다. @RequestBody 는 반대로 역직렬화입니다." />

<QuizBox question="ApiResponse 에 붙은 @JsonInclude(JsonInclude.Include.NON_NULL) 의 효과로 옳은 것은?" :choices="['null 인 필드를 JSON 출력에서 제외한다', 'null 인 필드를 빈 문자열로 바꾼다', '모든 필드를 항상 출력한다', '역직렬화 시 null 을 거부한다']" :answer="0" explanation="NON_NULL 정책은 값이 null 인 필드를 직렬화 결과에서 통째로 뺍니다. 그래서 성공 응답에선 message 키가, 실패 응답에선 data 키가 사라집니다." />

<QuizBox question="도메인 엔티티를 그대로 직렬화하지 않고 응답 전용 DTO 를 직렬화하는 이유를 한 가지 이상 설명하세요." explanation="모범답안: (1) 보안 — 민감 필드 노출 차단(DTO에 없으면 JSON에 못 나감), (2) 결합 분리 — DB 스키마 변경이 API 응답을 흔들지 않게, (3) 형태 제어 — 화면에 맞는 모양으로 가공. CareerTuner는 FitAnalysisResult 도메인을 FitAnalysisDetailResponse 로 갈아끼워 노출을 통제한다." />

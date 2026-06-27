# JSON

> JSON은 "키-값" 텍스트 포맷으로, CareerTuner의 모든 API 응답은 `ApiResponse` 엔벨로프를 JSON으로 직렬화해서 주고받습니다. 백엔드는 Jackson, 프런트는 브라우저 기본 `JSON`으로 변환합니다.

## 1. 한 줄 정의

JSON은 **데이터를 사람이 읽을 수 있는 텍스트(문자열)로 표현하는 경량 직렬화 포맷**이다. 서버와 브라우저가 서로 다른 언어(Java / TypeScript)를 써도 이 텍스트만 주고받으면 객체를 복원할 수 있다.

## 2. 단어 뜻 (약자/어원 풀이)

- **J**ava**S**cript **O**bject **N**otation — "자바스크립트 객체 표기법".
- 원래 JavaScript 객체 리터럴 문법에서 출발했지만, 지금은 언어 중립 표준(RFC 8259)이다. Java도 Python도 다 쓴다.
- **직렬화(Serialization)**: 메모리 안의 객체 → 전송/저장 가능한 텍스트로 바꾸는 것.
- **역직렬화(Deserialization)**: 그 텍스트 → 다시 객체로 복원하는 것.

기본 타입은 6가지뿐이다: `object`(키-값), `array`(목록), `string`, `number`, `boolean`, `null`.

```json
{
  "success": true,
  "code": "OK",
  "data": { "fitScore": 78, "missingSkills": ["Kafka", "Redis"] }
}
```

:::tip 헷갈리기 쉬운 점
JSON에는 날짜 타입, 주석, 정수/실수 구분, 후행 콤마가 없다. 날짜는 보통 `"2026-06-27T10:00:00"` 같은 문자열로 표현한다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

서버(Java 객체)와 브라우저(JS 객체)는 메모리 구조가 완전히 다르다. Java의 `FitAnalysisResult` 객체를 그대로 네트워크로 보낼 수는 없다. 둘 다 이해하는 **공통 중간 표현**이 필요하고, 그게 JSON이다.

| 없으면 생기는 문제 | JSON이 해결하는 방식 |
| --- | --- |
| 언어마다 객체 구조가 달라 못 보냄 | 언어 중립 텍스트로 변환 |
| XML은 태그가 무거움 | 키-값만 있어 가볍고 파싱 빠름 |
| 사람이 디버깅 못 함 | 그냥 텍스트라 눈으로 읽힘 (Swagger/네트워크 탭) |
| 구조가 제각각이면 프런트가 매번 다르게 처리 | `ApiResponse` 엔벨로프로 형태 고정 |

## 4. CareerTuner에서 어디에 썼나

### 백엔드 — 응답 엔벨로프 (공통, 영역 A/팀장)

모든 REST 응답은 `common/web/ApiResponse.java`(record)로 감싸 JSON으로 내려간다.

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(boolean success, String code, String message, T data) { ... }
```

- `@JsonInclude(NON_NULL)` → `message`가 `null`이면 그 키를 **아예 JSON에서 빼버린다**. 성공 응답이 깔끔해진다.
- Spring Boot가 컨트롤러 반환값을 자동으로 Jackson에 넘겨 JSON으로 직렬화한다.

### 백엔드 — Jackson 3 사용 (프로젝트 컨벤션)

이 프로젝트는 **Jackson 3** (`tools.jackson.databind.ObjectMapper`)을 쓴다. Jackson 2의 `com.fasterxml.jackson.databind`가 아니다. 이걸 `JacksonUsageConventionTests`가 빌드 시 강제한다(구버전 import나 `new ObjectMapper()` 직접 생성 발견 시 테스트 실패).

### 영역 C — 적합도 분석에서 직접 직렬화 (구현됨)

`fitanalysis/service/FitAnalysisServiceImpl.java`는 Spring이 관리하는 `ObjectMapper`를 주입받아, 스킬 목록(List)을 **JSON 문자열로 직렬화해 `fit_analysis` 테이블 컬럼에 저장**한다. 별도 테이블을 안 만들고 한 컬럼에 리스트를 담는 실용적 패턴이다.

```java
// 저장: List -> JSON 문자열
private String toJson(Object values) {
    try {
        return objectMapper.writeValueAsString(values == null ? List.of() : values);
    } catch (JacksonException ex) {
        return "[]";  // 실패해도 빈 배열로 안전하게
    }
}

// 조회: JSON 문자열 -> List 복원
private List<String> parseList(String json) {
    if (json == null || json.isBlank()) return List.of();
    try {
        return objectMapper.readValue(json, new TypeReference<List<String>>() {});
    } catch (JacksonException ex) {
        return List.of();
    }
}
```

- `matchedSkills`, `missingSkills`, `strategyActions` 같은 필드가 이 방식으로 `fit_analysis`에 저장된다.
- `TypeReference`로 제네릭(`List<String>`)의 타입 정보를 런타임까지 보존한다(타입 소거 우회).

### 영역 C — AI 출력 파싱 (구현됨)

`fitanalysis/ai/OpenAiFitAnalysisAiService.java`는 OpenAI structured output(JSON)을 `JsonNode`로 받아 트리 탐색으로 점수·매칭/부족 스킬·로드맵을 꺼낸다. 자유 텍스트가 아니라 **구조화된 JSON**으로 받아야 서버가 검증·확정할 수 있다.

### 프런트엔드 — 브라우저 기본 JSON (영역 공통)

`frontend/src/app/lib/api.ts`는 브라우저 내장 `JSON`을 쓴다.

```ts
body: JSON.stringify({ refreshToken })          // 요청 직렬화
const env = (await res.json()) as ApiEnvelope<T> // 응답 역직렬화
```

`res.json()`이 응답 본문 JSON 텍스트를 JS 객체로 파싱하고, 이를 `ApiEnvelope` 타입으로 다룬다.

### 영역 C — 스토리보드 spec (구현됨)

자동 스토리보드 파이프라인(`docs/storyboard/C`)에서 **진실의 원천이 JSON spec 파일**이다. 프레임·콜아웃 정의를 JSON으로 두고, 도구가 읽어 HTML/MD/PDF/DOCX/PPTX 5포맷을 생성한다.

## 5. 핵심 동작 원리

요청 한 건의 JSON 왕복:

```text
[브라우저]                                  [백엔드]
JS 객체
  └ JSON.stringify ──▶ {"refreshToken":...} ──▶ HTTP body
                                                  │ Jackson 역직렬화
                                                  ▼
                                              DTO 객체 (@Valid 검증)
                                                  │ service 처리
                                                  ▼
                                              ApiResponse<T> 객체
                                                  │ Jackson 직렬화
JS 객체 ◀── res.json() ◀── {"success":true,...} ◀┘ (@JsonInclude로 null 제거)
```

| 단계 | 백엔드(Jackson 3) | 프런트(브라우저) |
| --- | --- | --- |
| 객체 → 텍스트 | `objectMapper.writeValueAsString(obj)` | `JSON.stringify(obj)` |
| 텍스트 → 객체 | `objectMapper.readValue(json, type)` | `JSON.parse(str)` / `res.json()` |
| 키 매핑 | record 필드명 그대로 / MyBatis는 `map-underscore-to-camel-case` | TS 타입(`types.ts`)으로 형태 보장 |

:::warning 직렬화 실패 처리
JSON 파싱은 항상 실패할 수 있다(깨진 데이터, AI가 형식을 어김). CareerTuner C 코드는 `catch (JacksonException)`에서 빈 배열·fallback을 돌려줘 화면이 깨지지 않게 한다. 파싱 결과를 무조건 믿지 말 것.
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "JSON은 서버와 브라우저가 객체를 텍스트로 주고받는 표준 포맷이고, 저희는 모든 API 응답을 `ApiResponse` JSON 엔벨로프로 통일했습니다."
- **기본:** "백엔드는 Jackson으로 자바 객체를 JSON으로 직렬화/역직렬화합니다. 응답은 `success`, `code`, `message`, `data` 네 필드를 가진 record 엔벨로프로 감싸고, `@JsonInclude(NON_NULL)`로 빈 필드는 빼서 응답을 깔끔하게 유지합니다. 프런트는 브라우저 기본 `JSON`으로 다룹니다."
- **꼬리질문 대응:** "제 영역(적합도 분석)에서는 매칭/부족 스킬 리스트를 별도 테이블 없이 `ObjectMapper`로 JSON 문자열 직렬화해 `fit_analysis` 컬럼에 저장하고, 조회 시 `TypeReference`로 다시 `List`로 복원합니다. AI 출력도 자유 텍스트가 아닌 structured JSON으로 받아 `JsonNode`로 파싱한 뒤 서버 규칙으로 점수를 확정합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. JSON과 XML 차이는?**
JSON은 키-값과 배열만으로 표현해 태그 오버헤드가 없고 파싱이 가볍다. XML은 닫는 태그·네임스페이스 등 표현력이 크지만 무겁다. REST API에는 가벼운 JSON이 사실상 표준이라 CareerTuner도 전부 JSON을 쓴다.

**Q2. Jackson이 뭐고 왜 직접 안 만들고 라이브러리를 쓰나?**
Jackson은 자바의 JSON 직렬화 라이브러리다. 직접 문자열을 이어붙이면 이스케이프·중첩 객체·null 처리에서 버그가 난다. Jackson은 리플렉션으로 객체↔JSON을 안전하게 변환하고, Spring Boot가 기본 통합해 컨트롤러 반환값을 자동 직렬화한다. 우리 프로젝트는 Jackson 3(`tools.jackson`)를 쓰고 컨벤션 테스트로 강제한다.

**Q3. `@JsonInclude(NON_NULL)`은 무슨 역할?**
직렬화 시 값이 `null`인 필드를 JSON에서 제외한다. 성공 응답에서 `message`가 null이면 그 키가 아예 안 나가 페이로드가 작아지고 프런트 처리가 단순해진다.

**Q4. 리스트를 왜 정규화된 테이블이 아니라 JSON 컬럼에 넣었나?**
매칭/부족 스킬은 단순 문자열 목록이고, 적합도 분석 결과의 부속 데이터라 조인·검색 요구가 없었다. 별도 테이블 + 조인 비용보다 한 컬럼에 JSON으로 저장하는 게 단순하고 빠르다. 단, 그 컬럼으로 검색·정렬이 필요해지면 정규화로 바꿔야 한다는 트레이드오프는 인지하고 있다.

**Q5. AI 응답 JSON이 형식을 어기면?**
structured output으로 형식을 강제하지만 100%는 아니다. 그래서 `JsonNode`로 방어적으로 탐색하고, 파싱 실패 시 `catch`에서 fallback(빈 배열 등)을 돌려줘 화면이 죽지 않게 한다. 점수·판정은 AI 텍스트가 아니라 서버 검증 로직으로 최종 확정한다.

## 8. 직접 말해보기

1. (30초) "CareerTuner에서 사용자가 적합도 분석을 누르면 부족 스킬 리스트가 화면에 뜬다. 그 데이터가 DB에서 JSON으로 어떻게 저장되고, 어떤 단계를 거쳐 브라우저 화면까지 오는지" 직렬화/역직렬화 단어를 넣어 설명해보기.
2. (1분) 동료가 "응답에 그냥 객체를 바로 내려주면 되지 왜 `ApiResponse`로 한 번 더 감싸냐"고 묻는다. JSON 엔벨로프의 장점(형태 고정, `success`/`code`로 일관된 에러 처리)을 들어 설득해보기.

## 퀴즈

<QuizBox question="CareerTuner 백엔드에서 자바 객체를 JSON 문자열로 변환할 때 사용하는 라이브러리는?" :choices="['Gson', 'Jackson (ObjectMapper)', 'org.json', 'JSON.stringify']" :answer="1" explanation="백엔드는 Jackson의 ObjectMapper로 직렬화/역직렬화한다. 특히 이 프로젝트는 Jackson 3(tools.jackson.databind)를 쓰고 컨벤션 테스트로 강제한다. JSON.stringify는 프런트(브라우저) 쪽 함수다." />

<QuizBox question="ApiResponse에 붙은 @JsonInclude(NON_NULL) 어노테이션의 효과는?" :choices="['모든 필드를 항상 포함한다', '값이 null인 필드를 JSON에서 제외한다', 'null이면 빈 문자열로 바꾼다', 'null이면 예외를 던진다']" :answer="1" explanation="직렬화 시 값이 null인 필드(예: 성공 응답의 message)를 JSON 출력에서 빼버려 페이로드를 작게 유지한다." />

<QuizBox question="적합도 분석에서 매칭/부족 스킬 목록(List)을 fit_analysis 테이블의 한 컬럼에 저장한 방식과 그 장단점을 설명해보세요." explanation="ObjectMapper의 writeValueAsString으로 List를 JSON 문자열로 직렬화해 컬럼에 넣고, 조회 시 readValue + TypeReference로 다시 List로 역직렬화한다. 장점은 별도 테이블·조인 없이 단순하고 구현이 빠르다는 것. 단점은 그 컬럼으로 검색/정렬/부분 갱신이 어렵다는 것이라, 검색 요구가 생기면 정규화 테이블로 전환해야 한다. 또 파싱은 실패할 수 있어 catch에서 빈 배열 fallback으로 방어한다." />

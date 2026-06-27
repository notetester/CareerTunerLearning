# 제네릭 (Generic, 타입 매개변수)

> 타입을 값이 아니라 "매개변수"로 받아, 컴파일 시점에 타입 안전을 보장하면서 코드를 재사용하는 기법.

## 1. 한 줄 정의

제네릭은 클래스나 메서드, 인터페이스가 다룰 데이터의 **타입을 호출하는 쪽에서 정해 넘기게** 만드는 문법이다. 컴파일러가 그 타입을 알고 검사해 주므로, 캐스팅 없이도 타입이 보장된다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 뜻 | 비고 |
| --- | --- | --- |
| Generic | 영어 "일반적인". 특정 타입에 묶이지 않고 두루 쓰인다는 의미 | 라틴어 *genus*(종류)에서 유래 |
| Type Parameter | 타입 매개변수. `T`, `E`, `K`, `V` 같은 자리표시자 | 관례: T=Type, E=Element, K=Key, V=Value |
| Type Argument | 타입 인자. `ApiResponse<User>`의 `User`처럼 실제로 넣는 타입 | 매개변수에 대응되는 실제 값 |
| Parametric Polymorphism | 매개변수적 다형성. 제네릭의 학술적 이름 | 하나의 코드가 여러 타입에 동작 |

`T`는 값(value)을 받는 일반 매개변수가 아니라 **타입(type)을 받는 매개변수**라는 점이 핵심이다. 메서드가 `(int x)`로 정수를 받듯, 제네릭은 `<T>`로 타입을 받는다.

## 3. 왜 필요 (없으면 무슨 문제)

제네릭이 없던 시절 자바는 모든 것을 `Object`로 담고 꺼낼 때 캐스팅했다. 그 결과:

- **타입 안전 상실**: `List`에 `String`을 넣어야 하는데 실수로 `Integer`를 넣어도 컴파일러가 못 막는다. 꺼내 쓰는 런타임에 `ClassCastException`으로 터진다.
- **캐스팅 지옥**: 꺼낼 때마다 `(String) list.get(0)` 같은 형변환이 필요해 코드가 지저분하고 위험하다.
- **중복 코드**: 정수용 박스, 문자열용 박스를 타입마다 따로 만들면 같은 로직이 복붙된다.

제네릭은 이 세 문제를 한 번에 해결한다. **버그를 런타임에서 컴파일타임으로 앞당기고**, 캐스팅을 없애고, 코드 하나로 모든 타입을 커버한다. 타입스크립트에서 제네릭 대신 `any`를 쓰면 똑같이 타입 검사가 꺼져 [DTO](/glossary/dto) 모양이 깨져도 모르게 된다.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner의 응답 규약 자체가 제네릭 위에 서 있다. 백엔드와 프론트가 **같은 모양의 제네릭 봉투**를 양쪽에서 정의해, 데이터 타입만 갈아끼우며 전 API에 재사용한다.

| 위치 | 코드 | 역할 |
| --- | --- | --- |
| 백엔드 | `common/web/ApiResponse.java` → `record ApiResponse<T>(...)` | 모든 REST 응답을 감싸는 제네릭 봉투 |
| 백엔드 | `ApiResponse.<T>ok(data)` / `error(...)` | 제네릭 정적 팩터리 메서드 |
| 프론트 | `app/lib/api.ts` → `interface ApiEnvelope<T>` | 백엔드 봉투의 TS 거울 |
| 프론트 | `export async function api<T = unknown>(...)` | 응답 타입을 호출부에 전파하는 제네릭 함수 |

실제 컨트롤러는 `ApiResponse<TicketResponse>`, `ApiResponse<List<NoticeListResponse>>`처럼 **봉투 코드는 그대로 두고 `T`만 바꿔** 끝없이 재사용한다(`support/controller/TicketController.java`, `NoticeController.java` 등). [ApiResponse 엔벨로프](/glossary/api-response-envelope) 패턴이 제네릭 없이는 성립하지 않는다.

:::tip 한 줄로 요약하면
"봉투(`ApiResponse` / `ApiEnvelope`)는 한 번 만들고, 안에 든 내용물 타입(`T`)만 매번 바꿔 쓴다. 그래서 봉투 코드는 한 벌, 타입 안전은 전부 챙긴다."
:::

## 5. 핵심 동작 원리 (표·작은 코드)

### 백엔드 — 제네릭 record와 정적 팩터리

```java
// record 자체가 <T>를 받는다. data 필드의 타입이 곧 T.
public record ApiResponse<T>(boolean success, String code, String message, T data) {
    // 메서드 단위 제네릭: 호출 인자로 T가 추론된다.
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, "OK", null, data);
    }
}
```

`ApiResponse.ok(ticket)`을 호출하면 컴파일러가 `ticket`의 타입을 보고 `T = TicketResponse`로 **추론**한다. 반환 타입은 자동으로 `ApiResponse<TicketResponse>`가 된다. 다이아몬드 `<>`는 우변 타입을 좌변에서 추론하라는 표시다.

### 프론트 — 제네릭 함수의 타입 전파

```typescript
// 호출부가 T를 지정하면, env.data 가 T 로 좁혀지고 반환 타입도 T 가 된다.
export async function api<T = unknown>(path: string): Promise<T> {
  const env = (await res.json()) as ApiEnvelope<T> | null;
  return env.data as T;   // 호출부에서 정확한 타입으로 받힌다
}

// 사용: User 타입이 me 변수까지 그대로 흐른다. 캐스팅·any 불필요.
const me = await api<User>("/users/me");
```

| 개념 | 자바 | 타입스크립트 |
| --- | --- | --- |
| 선언 | `class Box<T>` | `interface Box<T>` |
| 제약 | `<T extends Number>` | `<T extends number>` |
| 추론 | `var x = ok(data)` | `const x = api(...)` (지정 시 명시) |
| 소거 시점 | 컴파일 후 타입 정보 소거(erasure) | 컴파일 후 JS엔 타입 없음 |

:::warning 타입 소거(Type Erasure)
자바 제네릭은 **컴파일 후 타입 정보가 지워진다**. 런타임에 `ApiResponse<User>`와 `ApiResponse<Ticket>`은 둘 다 그냥 `ApiResponse`다. 그래서 `new T()`나 `instanceof List<String>` 같은 건 불가능하다. 타입스크립트는 한술 더 떠 **컴파일되면 타입 자체가 사라진다** — 제네릭은 순전히 개발 시점 안전장치다.
:::

## 6. 면접 답변 3단계 (초간단/기본/꼬리질문)

- **초간단**: "제네릭은 타입을 매개변수처럼 받아서, 캐스팅 없이 컴파일 시점에 타입 안전을 보장하는 문법입니다."
- **기본**: "CareerTuner는 모든 응답을 `ApiResponse<T>` 봉투로 감쌉니다. 봉투 코드는 한 벌만 두고 `T`만 `TicketResponse`, `List<NoticeListResponse>`처럼 바꿔 재사용합니다. 프론트에서도 같은 모양의 `ApiEnvelope<T>`와 `api<T>()` 함수로 응답 타입을 호출부까지 전파해서, `any`나 캐스팅 없이 타입이 흐릅니다."
- **꼬리질문 대비**: "자바 제네릭은 런타임에 타입이 소거(erasure)되기 때문에 `new T()`는 못 하고, 그게 필요하면 `Class<T>`를 따로 받습니다. 타입스크립트 제네릭도 컴파일되면 사라지므로, 런타임 검증이 필요하면 zod 같은 스키마 검사를 별도로 둡니다."

## 7. 꼬리질문 + 모범답안 (3~5)

:::details Q1. `ApiResponse<T>`를 그냥 `Object data`로 받으면 안 되나요?
가능은 하지만 그러면 컴파일러가 `data`의 진짜 타입을 모릅니다. 컨트롤러가 `ApiResponse<TicketResponse>`를 반환한다고 선언하면, 잘못된 타입을 넣을 때 컴파일이 실패해 버그를 빌드 단계에서 잡습니다. 또 프론트가 `api<User>()`로 받으면 그 타입이 그대로 흘러 자동완성과 검사가 됩니다. `Object`나 `any`는 이 모든 이점을 버리는 겁니다.
:::

:::details Q2. 타입 소거(erasure)란 무엇이고 어떤 제약을 만드나요?
자바 제네릭은 하위 호환을 위해 **컴파일 후 타입 인자를 지웁니다**. 런타임엔 `ApiResponse<User>`도 그냥 `ApiResponse`입니다. 그래서 `new T()`, `T[] arr = new T[10]`, `obj instanceof List<String>` 같은 건 불가능합니다. 런타임에 타입이 필요하면 `Class<T> clazz`를 인자로 같이 받는 패턴을 씁니다.
:::

:::details Q3. `<T extends Number>` 같은 제약(bounded type)은 왜 씁니까?
`T`에 아무 타입이나 오면 `T`의 메서드를 호출할 수 없습니다. 상한(upper bound)을 두면 그 타입이 가진 메서드를 안전하게 쓸 수 있습니다. 예: `<T extends Comparable<T>>`로 제약하면 `compareTo`를 호출할 수 있죠. 제약은 "이 타입은 최소한 이건 할 줄 안다"는 컴파일러와의 계약입니다.
:::

:::details Q4. 와일드카드 `List<? extends Number>`와 `List<T>`의 차이는?
`<T>`는 그 타입을 이름으로 잡아 두고 여러 곳에서 같은 타입임을 보장할 때 씁니다. 와일드카드 `?`는 "어떤 타입인지 이름은 필요 없고 읽기만 하면 된다"처럼 유연하게 받을 때 씁니다. `? extends`는 읽기(공변), `? super`는 쓰기(반공변)에 적합합니다(PECS: Producer extends, Consumer super).
:::

:::details Q5. 백엔드와 프론트가 같은 제네릭 봉투를 양쪽에 정의하면 중복 아닌가요?
같은 "구조"를 두 언어로 표현한 것이라 일종의 중복은 맞습니다. 다만 자바와 TS는 타입 시스템이 분리돼 있어 한쪽 타입을 다른 쪽이 자동으로 알 수 없습니다. 현재는 `ApiResponse<T>`(서버)와 `ApiEnvelope<T>`(클라이언트)를 수동으로 일치시킵니다. 규모가 커지면 OpenAPI 스키마에서 TS 타입을 생성해 단일 소스로 맞추는 방향을 고려할 수 있습니다.
:::

## 8. 직접 말해보기

다음을 막힘 없이 말할 수 있으면 이 개념은 내 것이다.

1. 제네릭이 없을 때 생기는 세 가지 문제(타입 안전 상실, 캐스팅, 중복)를 한 문장씩.
2. CareerTuner의 `ApiResponse<T>`와 `ApiEnvelope<T>`가 어떻게 봉투 코드를 한 벌로 재사용하는지.
3. `ApiResponse.ok(ticket)`을 호출하면 `T`가 어떻게 추론되는지.
4. 타입 소거가 무엇이고, 그 때문에 못 하는 일 하나.

## 퀴즈

<QuizBox question="자바 제네릭에서 컴파일 후 타입 인자 정보가 지워지는 현상을 무엇이라 하는가?" :choices="['타입 추론(type inference)', '타입 소거(type erasure)', '타입 캐스팅(type casting)', '타입 다형성(polymorphism)']" :answer="1" explanation="자바는 하위 호환을 위해 컴파일 시 제네릭 타입 인자를 지운다. 그래서 런타임엔 ApiResponse<User> 도 그냥 ApiResponse 이며, new T() 같은 건 불가능하다." />

<QuizBox question="CareerTuner에서 모든 REST 응답을 감싸며 data 필드 타입을 T 로 받는 제네릭 record 의 이름은?" :choices="['ApiEnvelope', 'ApiResponse', 'BusinessException', 'ResponseEntity']" :answer="1" explanation="backend/common/web/ApiResponse.java 의 record ApiResponse<T>(success, code, message, data) 가 표준 봉투다. 프론트의 거울은 ApiEnvelope<T> 인터페이스다." />

<QuizBox question="프론트 api<T>() 함수에서 제네릭 대신 any 를 쓰면 무엇을 잃게 되는지 한 문장으로 설명하라." explanation="컴파일 시점 타입 검사와 자동완성을 모두 잃는다. 응답 data 의 실제 모양이 깨져도 컴파일러가 잡지 못해, 버그가 런타임으로 밀려나고 호출부에서 잘못된 필드 접근이 통과된다." />

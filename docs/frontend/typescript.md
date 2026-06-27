# TypeScript

> "JavaScript에 정적 타입을 입혀, 런타임 전에 컴파일러가 오류를 잡게 해주는 언어입니다. CareerTuner 프론트는 백엔드 응답 envelope부터 기능별 도메인 타입까지 전부 TS로 계약을 박아 타입 안전을 확보합니다."

## 1. 한 줄 정의

TypeScript는 **JavaScript의 상위집합(superset)** 으로, 코드에 타입을 붙여 **컴파일 시점에 오류를 검출**하고 빌드 결과로는 순수 JavaScript를 내보내는 언어다. 모든 유효한 JS는 유효한 TS다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| TypeScript | "Type"(타입) + "Script"(JavaScript의 별칭) — JS에 타입 시스템을 얹은 것 |
| 정적 타입 (static type) | 실행 전(컴파일 타임)에 타입이 결정·검사됨. 반대는 동적 타입(런타임에만 확인) |
| `tsc` | TypeScript Compiler. 타입 검사 + JS로 트랜스파일 |
| 타입 소거 (type erasure) | 빌드 후 산출물에는 타입이 사라짐 — 런타임 비용 0 |
| 구조적 타이핑 (structural typing) | "이름이 같아서"가 아니라 "모양(필드)이 같으면" 같은 타입으로 본다 |

:::tip 핵심 한 줄
TS의 타입은 **개발 중에만 존재하는 안전벨트**다. 빌드되면 사라지고 브라우저는 순수 JS만 본다. 런타임 검증이 아니라 **개발 시점 계약**이다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

순수 JS는 `user.naem`(오타)이나 `response.data.score + ""`(타입 혼동)을 **런타임에야** 터뜨린다. 화면에서 `undefined`가 떠야 버그를 안다.

- **API 계약 깨짐 방치**: 백엔드가 `fitScore`를 `number | null`로 주는데 프론트가 그냥 `number`로 쓰면, `null`일 때 `toFixed()` 호출이 런타임 크래시. TS는 이걸 빌드 단계에서 막는다.
- **리팩터링 공포**: 필드명을 바꾸면 그 타입을 쓰는 모든 곳에서 컴파일 에러가 떠 누락 없이 고칠 수 있다.
- **자동완성·문서화**: 에디터가 객체의 가능한 필드를 알려준다 → 사람의 기억에 의존하지 않음.
- **팀 협업**: CareerTuner는 6명 수직 분담. 타입이 곧 모듈 간 **인터페이스 명세**라 영역 간 호출 실수를 줄인다.

:::warning 흔한 오해
TS가 런타임을 보호하지는 않는다. 서버가 약속과 다른 JSON을 보내면 TS는 못 막는다. 그래서 CareerTuner는 타입과 별개로 `types.contract.test.ts` 같은 **계약 테스트**로 타입-실데이터 정합성을 따로 검증한다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

프론트 전역이 TS(`strict: true`)다. 핵심 사용처:

| 위치 | 무엇을 하나 | 영역 |
| --- | --- | --- |
| `app/lib/api.ts` | 제네릭 `api<T>()` fetch 래퍼, `ApiEnvelope<T>` 인터페이스, `ApiError` 클래스 | 공통(팀장) |
| `features/<기능>/types/*.ts` | 기능별 도메인 타입(아래 예시) | 각 담당 |
| `features/analysis/types/fitAnalysis.ts` | `FitAnalysisDetail`, `FitGapRecommendation`, `FitApplyDecision` 등 적합도 분석 타입 | **C(본인)** |
| `features/autoprep/types/autoPrep.ts` | `PrepEvent`(SSE 이벤트 유니온), `PrepStepResult`, `PREP_PARTS` | C 연관 |
| `features/applications/types/applicationCase.ts` | `ApplicationStatus`, `ApplicationSourceType` 등 리터럴 유니온 + 가드 함수 | 핵심 도메인 |
| `admin/features/*/types.contract.test.ts` | 타입 객체를 실제로 만들어 컴파일로 계약 검증 | 관리자 |

`tsconfig.json`은 `strict: true`, `noFallthroughCasesInSwitch: true`, 경로 별칭 `@/* → ./src/*`. 빌드 게이트는 `npm run typecheck`(= `tsc --noEmit`)이며 CI(frontend-ci)에서 타입 검사 + 빌드를 강제한다.

:::details 실제 코드 — 제네릭 fetch 래퍼 (app/lib/api.ts, 축약)
```ts
export interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message?: string;
  data?: T;
}

// T는 호출자가 지정하는 응답 데이터 타입
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  config: { auth?: boolean } = {},
): Promise<T> {
  // ...fetch, 401 시 자동 refresh...
  const env = (await res.json()) as ApiEnvelope<T> | null;
  if (!res.ok || !env || env.success === false) {
    throw new ApiError(env?.message ?? "요청 실패", env?.code ?? "ERROR", res.status);
  }
  return env.data as T; // envelope를 벗겨 data만 반환
}
```
호출부는 타입만 끼워 넣으면 끝이다:
```ts
// features/analysis/api/fitAnalysisApi.ts
export function getFitAnalyses() {
  return api<FitAnalysisDetail[]>("/fit-analyses"); // 반환 타입 자동으로 FitAnalysisDetail[]
}
```
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### interface vs type

| 구분 | `interface` | `type` |
| --- | --- | --- |
| 객체 모양 정의 | O (주용도) | O |
| 선언 병합(declaration merging) | 가능 | 불가 |
| 유니온/튜플/매핑 등 | 불가 | 가능 |
| CareerTuner 관례 | 객체 형태(`ApplicationCase`)에 주로 사용 | 유니온·별칭(`ApplicationStatus`)에 사용 |

```ts
// 리터럴 유니온 타입 — 가능한 문자열을 못박는다 (applicationCase.ts)
export type ApplicationStatus = "DRAFT" | "ANALYZING" | "READY" | "APPLIED" | "CLOSED";

// 객체 인터페이스
export interface ApplicationCase {
  id: number;
  companyName: string;
  postingDate: string | null;   // null 가능 명시 → 사용처에서 null 체크 강제
  status: ApplicationStatus;     // 위 유니온만 허용
}
```

### 제네릭 (Generic)

`<T>`는 "타입을 인자처럼 받는" 장치다. `api<T>()` 하나로 모든 엔드포인트에 타입 안전을 부여한다 — 같은 코드, 호출마다 다른 타입.

```ts
api<FitAnalysisDetail>(`/fit-analyses/application-cases/${id}`);     // T = FitAnalysisDetail
api<FitAnalysisHistoryEntry[]>(`/.../${id}/history`);                // T = 배열
```

### 판별 유니온 (Discriminated Union) — SSE 이벤트

`autoPrep.ts`의 `PrepEvent`는 `type` 필드로 분기하는 판별 유니온이다. `switch(e.type)`에서 각 분기마다 TS가 해당 모양만 허용한다.

```ts
export type PrepEvent =
  | { type: "plan"; plan: PrepPlan }
  | { type: "part-done"; result: PrepStepResult }
  | { type: "error"; message: string };
// e.type === "error" 분기에서 e.message만 안전하게 접근 가능
```

### 타입 가드 함수

```ts
// 런타임 값으로 좁히는 함수 (applicationCase.ts)
export function isApplicationCaseExtractionActive(s: ApplicationCaseExtractionStatus): boolean {
  return s === "QUEUED" || s === "RUNNING";
}
```

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

- **1문장**: "TypeScript는 JS에 정적 타입을 더해 컴파일 타임에 오류를 잡는 언어이고, 빌드되면 타입은 사라집니다."
- **기본**: "CareerTuner 프론트는 전부 strict 모드 TS입니다. 백엔드 공통 응답을 `ApiEnvelope<T>` 제네릭 인터페이스로 정의하고, `api<T>()` fetch 래퍼 하나로 모든 엔드포인트가 타입 안전하게 응답을 받습니다. 기능별로는 `features/기능/types`에 도메인 타입을 모아 모듈 간 계약으로 씁니다."
- **꼬리질문 대응**: "`null` 가능 필드는 타입에 `string | null`로 명시해 사용처에서 null 체크를 강제하고, 가능한 상태는 리터럴 유니온(`ApplicationStatus`)으로 못박아 잘못된 값을 컴파일에서 차단합니다. 타입이 런타임을 보장하진 않으므로 contract 테스트로 실데이터 정합성을 따로 검증합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. interface와 type의 차이는?
둘 다 객체 모양을 정의할 수 있지만, `interface`는 선언 병합이 되고 객체 확장에 적합하며, `type`은 유니온·튜플·매핑 타입 등 더 넓은 표현이 가능합니다. CareerTuner는 객체엔 `interface`(`ApplicationCase`), 유니온·별칭엔 `type`(`ApplicationStatus`)을 쓰는 관례를 따릅니다.
:::

:::details Q. 제네릭을 왜 쓰나요? any로 받으면 안 되나요?
`any`로 받으면 타입 검사를 꺼버려 자동완성·오류 검출이 전부 사라집니다. 제네릭 `api<T>()`는 호출자가 기대 타입을 주입하면 그 타입으로 반환을 좁혀, 코드 재사용과 타입 안전을 동시에 잡습니다. `api<FitAnalysisDetail[]>(...)`의 반환은 컴파일러가 정확히 배열로 압니다.
:::

:::details Q. TS는 런타임 오류도 막아주나요?
아니요. 타입은 컴파일 후 소거되므로 런타임 비용도 보호도 없습니다. 서버가 타입과 다른 JSON을 보내면 TS는 못 막습니다. 그래서 외부 입력은 런타임 검증(또는 CareerTuner의 contract 테스트로 타입-데이터 정합성 확인)이 별도로 필요합니다.
:::

:::details Q. strict 모드를 켜면 뭐가 달라지나요?
`strictNullChecks`가 핵심입니다. `null`/`undefined`를 다른 타입과 섞을 수 없게 강제해, `postingDate: string | null`처럼 명시한 곳에서 null 체크 없이 접근하면 컴파일 에러가 납니다. CareerTuner는 `strict: true`라 null 누락 버그가 빌드에서 걸립니다.
:::

:::details Q. 판별 유니온(discriminated union)이 왜 유용한가요?
공통 판별 필드(`type`)를 가진 여러 모양을 합치면, `switch`나 `if`로 그 필드를 분기할 때 TS가 각 분기 안에서 해당 모양으로 타입을 자동으로 좁혀줍니다. SSE 진행 이벤트 `PrepEvent`가 그 예로, `error` 분기에서만 `message`에 안전하게 접근할 수 있습니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. CareerTuner에서 `api<T>()` 제네릭 래퍼가 왜 좋은지, `any`로 받았을 때와 비교해 30초 안에 설명해보라.
2. `postingDate: string | null` 같은 nullable 타입이 strict 모드에서 어떤 버그를 미리 잡아주는지 실제 사용 흐름으로 말해보라.

## 퀴즈

<QuizBox question="TypeScript의 타입은 빌드 후 런타임에 어떻게 되는가?" :choices="['JS 객체로 변환되어 런타임 검증에 쓰인다','소거(erase)되어 사라지고 순수 JS만 남는다','별도 메타데이터 파일로 저장된다','런타임에 타입 검사 코드가 자동 삽입된다']" :answer="1" explanation="TS 타입은 컴파일 타임에만 존재하고 빌드 결과에서는 소거된다. 그래서 런타임 비용이 0이지만, 동시에 런타임을 보호하지도 못한다." />

<QuizBox question="CareerTuner의 api 함수 시그니처가 api<T>() 형태로 제네릭인 이유로 가장 적절한 것은?" :choices="['fetch 속도를 높이려고','하나의 래퍼로 모든 엔드포인트에 호출자가 지정한 타입 안전을 부여하려고','백엔드 envelope를 제거하려고','네트워크 에러를 무시하려고']" :answer="1" explanation="제네릭 덕분에 api<FitAnalysisDetail[]>() 처럼 호출 시 기대 타입을 주입하면 반환이 그 타입으로 좁혀진다. 코드 재사용과 타입 안전을 동시에 얻는다." />

<QuizBox question="interface와 type의 차이를 한 문장으로 설명해보라. (CareerTuner의 실제 관례를 포함해서)" explanation="둘 다 객체 모양을 정의할 수 있으나 interface는 선언 병합과 객체 확장에 강하고, type은 유니온·튜플 등 더 넓은 표현이 가능하다. CareerTuner는 객체 형태(ApplicationCase)에는 interface를, 리터럴 유니온·별칭(ApplicationStatus)에는 type을 쓴다." />

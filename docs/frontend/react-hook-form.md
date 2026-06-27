# 폼 처리 (React Hook Form)

> React Hook Form은 입력값을 state로 들고 있지 않고 비제어(uncontrolled) DOM에 맡겨 리렌더를 최소화하면서 검증·제출을 묶어주는 폼 라이브러리다. 핵심은 `register`로 input을 ref에 연결하고, `handleSubmit`이 검증을 통과한 값만 콜백에 넘기는 흐름이다.

## 1. 한 줄 정의

폼 입력을 매 글자마다 React state로 동기화하지 않고, 비제어 input의 ref를 모아 두었다가 제출 시점에만 값을 읽어 검증·전송하는 폼 관리 라이브러리.

## 2. 단어 뜻 (약자/어원 풀이)

| 단어 | 뜻 |
| --- | --- |
| React **Hook** Form | React 훅(`useXxx`) 기반으로 동작 — 컴포넌트에서 `useForm()` 하나로 시작 |
| **register** | input을 폼에 "등록"한다. ref + onChange + onBlur + name을 한 번에 붙여줌 |
| **uncontrolled (비제어)** | 입력값의 진실원이 React state가 아니라 DOM 자체. RHF가 ref로 접근 |
| **controlled (제어)** | `value={state}` + `onChange={setState}` 로 React가 매 입력을 들고 있는 방식 |
| **handleSubmit** | submit 이벤트를 가로채 검증 → 성공 콜백 / 실패 콜백으로 분기 |
| **resolver** | Zod·Yup 같은 외부 스키마로 검증을 위임하는 어댑터 |

:::tip 한 줄 비유
제어 컴포넌트는 "비서가 받아쓰기를 한 글자마다 따라 적는" 방식, RHF(비제어)는 "제출 버튼을 누를 때 종이를 한 번에 걷어가는" 방식. 후자가 도장 찍는(리렌더) 횟수가 훨씬 적다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

순수 `useState` 제어 컴포넌트로 폼을 만들면 다음 비용이 든다.

- **필드마다 state + onChange 보일러플레이트**: 회원가입 폼 하나에 이름·이메일·비번·비번확인·약관 4개 → state 8개, setter 8개.
- **리렌더 폭증**: input 한 글자 칠 때마다 `setState` → 폼 전체 컴포넌트 리렌더. 필드가 많으면 입력 지연이 체감된다.
- **검증 로직이 submit 함수에 뭉친다**: "비어있나 / 형식 맞나 / 비번 일치하나"를 if문으로 줄줄이.
- **에러 메시지 위치·접근성(aria) 수작업**: 어떤 필드가 틀렸는지 표시·포커스 이동을 직접 구현.

RHF는 비제어로 리렌더를 줄이고, `register`로 보일러플레이트를 압축하고, `formState.errors`로 검증 결과를 표준화한다.

:::warning CareerTuner의 솔직한 현황
CareerTuner는 `react-hook-form@7.55.0`을 **설치했고**, shadcn 표준 래퍼(`app/components/ui/form.tsx`)가 들어와 있다. 하지만 **실제 사용자/관리자 페이지의 폼은 아직 대부분 `useState` 제어 컴포넌트로 구현**돼 있다 (예: 로그인·회원가입 `Login.tsx`, 새 지원 건 마법사 `NewApplicationPage.tsx`, FAQ 작성 `FaqCompose.tsx`). 즉 "RHF 인프라는 준비됐지만 페이지 채택은 진행 전" 상태다. 면접에서는 이 차이를 정확히 말하는 게 가산점이다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

영역: 프론트엔드 공통(`app/components/ui`) + 각 기능 폼 페이지.

| 위치 | 상태 | 내용 |
| --- | --- | --- |
| `frontend/package.json` → `react-hook-form: 7.55.0` | 설치됨 | 의존성으로 고정 |
| `app/components/ui/form.tsx` | 구현됨(래퍼) | shadcn 표준 폼 래퍼: `Form(=FormProvider)`, `FormField(=Controller 감쌈)`, `FormItem/FormLabel/FormControl/FormDescription/FormMessage`, `useFormField` 훅. `aria-invalid`, `aria-describedby`, 에러 메시지 자동 연결 |
| `app/pages/Login.tsx` | useState 제어 | 로그인/회원가입. `name/email/password/passwordConfirm/...` 각각 `useState`, `handleSubmit`에서 `event.preventDefault()` 후 수동 검증 |
| `features/applications/pages/NewApplicationPage.tsx` | useState 제어 | 공고 등록 3단계 마법사. `basicForm`/`postingForm`을 객체 state로 묶고 `setBasicField`/`setPostingField` 헬퍼로 갱신 |
| `admin/features/faqs/pages/FaqCompose.tsx` | useState 제어 | 관리자 FAQ 작성. `canSubmit = q.trim().length > 4 && a.trim().length > 9` 같은 파생 검증 |

:::details form.tsx 래퍼가 실제로 해주는 일
`form.tsx`는 RHF의 `Controller`를 `FormField`로 감싸고, `useFormField` 훅이 현재 필드의 `error`/`id`를 컨텍스트에서 꺼낸다. 그래서 `FormControl`은 자동으로 `aria-invalid={!!error}`와 `aria-describedby`를 붙이고, `FormMessage`는 `error.message`가 있으면 그것을, 없으면 children을 렌더한다. 즉 접근성과 에러 표시를 한 번에 표준화한 컴포넌트 세트다. 다만 이걸 쓰려면 페이지가 `useForm()`으로 폼 인스턴스를 만들어 `<Form {...methods}>`로 감싸야 하는데, 현재 페이지들은 그 단계를 밟지 않고 있다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 비제어 vs 제어 한눈에

| 구분 | 제어(useState, 현재 CareerTuner 방식) | 비제어(React Hook Form) |
| --- | --- | --- |
| 값의 진실원 | React state | DOM(ref) |
| 글자 입력 시 리렌더 | 매번 | 거의 없음(구독한 곳만) |
| 코드량 | 필드당 state+setter | `...register("name")` 한 줄 |
| 검증 | submit 함수에 if문 | rule 옵션 또는 resolver |
| 에러 표시 | 직접 분기 | `formState.errors.name` |

### RHF 기본 흐름 (3줄)

```tsx
import { useForm } from "react-hook-form";

type SignupForm = { email: string; password: string };

function SignupForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<SignupForm>();

  const onSubmit = async (data: SignupForm) => {
    await register(data.email, data.password); // 검증 통과한 값만 도달
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("email", { required: "이메일을 입력하세요" })} />
      {errors.email && <p>{errors.email.message}</p>}
      <input type="password" {...register("password", { minLength: 8 })} />
      <button disabled={isSubmitting}>가입</button>
    </form>
  );
}
```

동작 단계:
1. `register("email", rules)` 가 input에 `name/ref/onChange/onBlur`를 주입 → 폼이 그 input을 추적.
2. 사용자가 타이핑해도 React state가 아니라 DOM ref에만 반영 → 폼 컴포넌트 리렌더 안 일어남.
3. submit 시 `handleSubmit`이 등록된 모든 필드를 읽어 rule/resolver로 검증.
4. 통과하면 `onSubmit(data)` 호출, 실패하면 `errors`에 채우고 콜백을 막음.
5. `errors`를 구독한 부분만 리렌더되어 메시지 표시.

### 같은 회원가입을 두 방식으로 비교

CareerTuner `Login.tsx`의 현재(제어) 방식 — 발췌·축약:

```tsx
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const handleSubmit = (e: FormEvent) => {
  e.preventDefault();
  if (!email.trim() || !password) { setError("이메일/비번 입력"); return; }
  if (password !== passwordConfirm) { setError("비번 불일치"); return; }
  // ...
};
<input value={email} onChange={(e) => setEmail(e.target.value)} />
```

RHF로 옮기면 state·setter가 사라지고 검증이 선언적으로 바뀐다:

```tsx
const { register, handleSubmit, watch, formState: { errors } } = useForm();
<input {...register("password", { required: true })} />
<input {...register("passwordConfirm", {
  validate: (v) => v === watch("password") || "비밀번호가 일치하지 않습니다",
})} />
```

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(1문장)**: "React Hook Form은 입력값을 비제어로 다뤄 리렌더를 줄이고, `register`·`handleSubmit`으로 폼 등록과 검증을 표준화하는 라이브러리입니다."
- **기본**: "제어 컴포넌트는 글자마다 setState가 일어나 폼 전체가 리렌더되는데, RHF는 값을 DOM ref에 두고 제출 시점에만 읽습니다. `register`로 input을 등록하면 ref와 이벤트가 자동 연결되고, `handleSubmit`이 검증을 통과한 값만 콜백에 넘깁니다. 에러는 `formState.errors`로 표준화돼 표시·접근성 처리가 쉬워집니다."
- **꼬리질문 대응(정직 버전)**: "CareerTuner는 RHF와 shadcn `form.tsx` 래퍼까지 도입해 뒀지만, 실제 폼 페이지(로그인·공고 등록·FAQ 작성)는 아직 `useState` 제어 방식입니다. 필드 수가 적어 당장은 문제없지만, 회원가입처럼 약관·검증이 많은 폼부터 RHF로 이관하면 보일러플레이트와 리렌더를 줄일 수 있어 점진 이관을 계획하고 있습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안 (3~5개)

:::details Q1. 제어 컴포넌트와 비제어 컴포넌트의 차이는?
제어는 input의 값을 React state가 들고 `value`/`onChange`로 양방향 동기화하는 방식이고, 비제어는 값을 DOM이 들고 React는 ref로 필요할 때만 읽는 방식입니다. 제어는 입력값을 실시간으로 가공·표시하기 좋지만 리렌더가 잦고, 비제어는 리렌더가 적어 큰 폼에 유리합니다. RHF는 기본 비제어이며, 외부 UI 라이브러리(Radix Select 등)처럼 value를 직접 제어해야 하는 컴포넌트만 `Controller`로 감싸 제어 모드로 끼웁니다.
:::

:::details Q2. RHF가 리렌더를 어떻게 줄이나요?
입력값을 state가 아닌 ref(subscription 기반)로 관리하기 때문에, 타이핑이 컴포넌트 리렌더를 트리거하지 않습니다. 리렌더가 필요한 건 검증 에러 표시나 `watch`로 구독한 특정 필드 정도이고, 그것도 구독한 부분만 갱신됩니다. 반면 useState 제어는 한 글자 입력 = 부모 폼 컴포넌트 전체 리렌더입니다.
:::

:::details Q3. 검증은 어떻게 하나요? Zod와의 관계는?
간단한 검증은 `register("email", { required, pattern, minLength, validate })` 같은 rule 옵션으로 충분합니다. 스키마가 복잡하거나 백엔드 DTO와 타입을 공유하고 싶으면 `@hookform/resolvers` + Zod/Yup을 `resolver`로 끼워 스키마 검증을 위임합니다. CareerTuner는 현재 zod/resolvers를 넣지 않았고, 백엔드는 Jakarta Validation(`@NotBlank`/`@Size`)으로 서버측 검증을 합니다. 즉 클라이언트는 UX용 1차 검증, 서버가 최종 권위라는 이중 검증 구도입니다.
:::

:::details Q4. shadcn form.tsx의 FormField/Controller는 왜 필요한가요?
RHF는 기본이 비제어라 native input에는 `register`만 펼치면 됩니다. 하지만 Radix Select·Checkbox·Switch처럼 `value`/`onChange`를 props로 받는 제어형 컴포넌트는 ref만으로는 연결이 안 됩니다. 이때 `Controller`(= `FormField`)가 RHF의 `field` 객체를 받아 그 컴포넌트의 `value`/`onChange`에 다리를 놔줍니다. `form.tsx`는 여기에 `useFormField`로 에러·id를 묶어 `aria-invalid`·에러 메시지까지 자동화한 래퍼입니다.
:::

:::details Q5. 그럼 CareerTuner는 왜 아직 useState로 폼을 만들었나요?
현재 폼들은 필드 수가 많지 않고, 회원가입처럼 단계·중복확인(`onBlur`로 이메일 중복 체크)·동적 분기가 섞여 있어 초기엔 명시적 state가 읽기 쉬웠기 때문입니다. RHF 인프라(라이브러리 + form.tsx)는 깔아 뒀으므로, 검증 규칙이 늘어나는 폼부터 점진적으로 RHF로 이관하는 게 현실적인 로드맵입니다. 면접에서 "도입했다"가 아니라 "도입 준비/부분 적용 상태"라고 정확히 구분하는 게 핵심입니다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문 1~2개)

1. "CareerTuner 회원가입 폼을 useState 제어에서 React Hook Form으로 바꾼다면, 무엇이 사라지고 무엇이 추가되며 왜 좋아지는지" 30초 안에 설명해 보세요. (state/setter 제거 → `register`, 검증의 선언화, 리렌더 감소를 짚기)
2. "비제어가 항상 좋은가? 제어가 더 나은 경우는?"에 1분으로 답해 보세요. (입력값 실시간 가공·미리보기, 외부 제어형 컴포넌트, 입력에 따라 다른 필드를 즉시 보여줘야 하는 경우 → `Controller`/`watch`로 해결)

## 퀴즈

<QuizBox question="React Hook Form이 useState 제어 폼 대비 리렌더를 줄이는 핵심 이유는?" :choices="['모든 입력을 Redux에 저장해서', '입력값을 React state가 아닌 비제어 DOM(ref)으로 관리해 타이핑이 리렌더를 트리거하지 않아서', 'input마다 React.memo를 자동으로 붙여서', '서버에서 검증을 대신 해줘서']" :answer="1" explanation="RHF는 기본이 비제어(uncontrolled)라 입력값을 ref/subscription으로 관리합니다. 글자 입력이 setState를 부르지 않으므로 폼 전체가 리렌더되지 않고, 에러 표시나 watch로 구독한 부분만 갱신됩니다." />

<QuizBox question="Radix Select나 Checkbox처럼 value/onChange를 props로 받는 제어형 컴포넌트를 RHF와 연결할 때 사용하는 것은?" :choices="['register만 펼치면 된다', 'Controller(shadcn의 FormField)', 'useEffect로 수동 동기화', 'useState를 따로 둔다']" :answer="1" explanation="native input은 register로 충분하지만, value/onChange를 받는 제어형 컴포넌트는 ref만으로 연결되지 않습니다. Controller(= form.tsx의 FormField)가 RHF의 field 객체를 받아 그 컴포넌트의 value/onChange에 다리를 놓습니다." />

<QuizBox question="CareerTuner의 폼 처리 현황을 면접에서 가장 정확하게 설명한 문장은? (모범답안을 직접 말해보세요)" explanation="react-hook-form 7.55.0과 shadcn 표준 래퍼 form.tsx(FormField/FormControl/useFormField)는 도입돼 있지만, 실제 폼 페이지(Login의 로그인·회원가입, NewApplicationPage 공고 등록 마법사, FaqCompose)는 아직 useState 제어 컴포넌트 + 제출 핸들러 내 수동 검증으로 구현돼 있다. 즉 RHF 인프라는 준비됐고 페이지 채택은 진행 전 상태이며, 검증 규칙이 많은 폼부터 점진 이관이 합리적이다. 또한 클라이언트 검증과 별개로 백엔드가 Jakarta Validation으로 최종 검증한다는 이중 검증 구조를 함께 언급하면 좋다." />

# E 프론트엔드 UI/UX — 첨삭 화면과 결제·크레딧 흐름

> 첨삭 화면은 아직 "API 준비 중" 정적 플레이스홀더이고, 결제/크레딧/사용량/내역 화면은 실제 API와 Toss 결제창까지 연동되어 있다. 이 비대칭이 영역 E 프론트의 핵심 그림이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 E의 프론트엔드는 **두 개의 단일 페이지**로 압축된다. 첨삭은 `Correction.tsx`(4탭), 과금은 `Billing.tsx`(4탭)이다. 보조로 결제 콜백(`BillingSuccess` / `BillingFail`)과 마케팅 요금제(`Pricing`)가 붙는다.

이 페이지가 면접에서 답해야 할 질문:

- "첨삭 화면은 어디까지 동작하나요?" → **백엔드 `/api/corrections`는 실재하지만 프론트는 API 호출 0건의 정적 샘플**이라는 정직한 구분을 설명할 수 있어야 한다.
- "결제는 실제로 되나요? 위변조는 어떻게 막나요?" → ready/confirm 2단계, 서버 신뢰 금액, StrictMode 중복 승인 방지를 설명할 수 있어야 한다.
- "크레딧 차감은 화면에서 어떻게 보이나요?" → 크레딧 단가가 **클라이언트 상수로 하드코딩**되어 있고 실제 차감은 아직 배선되지 않았다는 점까지 말할 수 있어야 한다.

:::warning 규약과 실제의 격차 (먼저 알아야 할 사실)
표준 모듈 규약은 `features/<기능>/{pages,components,api,hooks,types}`지만, **E의 화면 파일은 `frontend/src/app/pages/`에 있다.** `features/correction/`은 전부 `.gitkeep`만 있는 빈 폴더이고, `features/billing/`은 `api/`·`types/`·`utils/`에만 코드가 있다. 즉 "기능 모듈 안에 화면이 있을 것"이라는 가정으로 코드를 찾으면 빈 폴더를 만난다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2-1. 첨삭은 왜 정적 플레이스홀더인가

`Correction.tsx`는 상단에 "첨삭 API 준비 중 / 현재 화면은 입력 흐름 샘플입니다"라는 배너를 띄우고, 실행 버튼은 `disabled "준비 중"` 상태다. 백엔드 `/api/corrections`(생성/목록/단건)는 실제로 구현되어 있는데도 프론트가 연결되지 않은 이유는 **프론트와 백엔드의 작업 시점차**다.

이 선택의 정직성은 mock 레지스트리에도 박혀 있다. `mock/domains/correction.ts`는 `correctionRoutes = []`(빈 배열)을 유지하며, 주석에 "가로챌 `api()` 호출이 없으므로 등록할 mock 라우트가 없다. 존재하지 않는 엔드포인트를 임의로 날조하지 않는다"고 명시한다. → **"화면을 그럴듯하게 보이려고 가짜 API를 만들지 않는다"**는 원칙이 코드에 남아 있다.

### 2-2. 결제는 왜 ready/confirm 2단계 + 버튼 단위 busy인가

결제는 한 번 잘못되면 돈이 움직인다. 그래서 프론트가 단독으로 결정하지 않고 **서버가 금액을 고정**(ready)한 뒤 Toss 결제창을 띄우고, 콜백에서 다시 **서버가 승인을 검증**(confirm)한다. 프론트는 "결제창을 여는 트리거"와 "콜백 파라미터를 서버로 넘기는 전달자"일 뿐이다.

| 결정 | 이유 |
| --- | --- |
| 버튼 단위 `busy` 키(`sub-{code}`/`buy-{code}`/`cancel`) | 카드 여러 개가 동시에 비활성화되지 않고, **클릭한 버튼만** 스피너 표시 → 동시클릭·중복결제 방지 |
| `loadPublic`(요금제·상품)과 `loadMine`(내 구독·사용량·내역) 분리 | 공개 데이터 실패는 에러 배너, 내 데이터 실패는 **조용히 무시** → 비로그인 사용자도 요금제는 본다 |
| 로딩 스피너 없이 빈 값으로 렌더 | 첫 페인트를 막지 않고 데이터가 채워지면 갱신 → 체감 속도 우선 |

### 2-3. 크레딧 단가를 왜 클라이언트 상수로 두었나 (트레이드오프)

`Correction.tsx`의 `correctionMeta` 상수가 탭별 크레딧을 직접 들고 있다(`answer:1`, `cover/resume/portfolio:2`). 서버의 `ai_feature_benefit_policy`(default_credit_cost=2)와 **별도로 하드코딩**되어 있어 동기화가 깨질 수 있다. 화면이 아직 정적 샘플이라 당장 문제는 없지만, 실제 연동 시 **서버 정책을 단일 근거(source of truth)로 끌어와야 하는 부채**다. 이건 면접에서 "알면서 둔 트레이드오프"로 설명할 수 있는 좋은 소재다.

## 3. 어떤 기술로 구현했나 (실제 파일 · API 근거)

```text
frontend/src/
├─ app/pages/
│  ├─ Correction.tsx       /correction        (4탭, API 0건 — 정적 샘플)
│  ├─ Billing.tsx          /billing           (4탭, 실 API 연동)
│  ├─ BillingSuccess.tsx   /billing/success   (Toss confirm 콜백)
│  ├─ BillingFail.tsx      /billing/fail      (실패 안내)
│  └─ Pricing.tsx          /pricing           (마케팅 비교표, CTA만 /billing 위임)
└─ features/billing/api/
   ├─ billingApi.ts        /billing/* (plans, credit-products, me, usage, payments, subscribe…)
   ├─ paymentApi.ts        /payments/toss/{ready,confirm}
   └─ tossPaymentSdk.ts    Toss 브라우저 SDK lazy-load + requestPayment
```

핵심 기술 요소:

- **공통 `api<T>()` 헬퍼**(`app/lib/api.ts`): `ApiResponse<T>` envelope를 풀어 `data`만 반환, 실패 시 `ApiError(message, code, status)` throw. 401이면 refresh 토큰으로 **1회만 재시도**(동시 401은 단일 프라미스 공유). `VITE_USE_MOCK==="true"`면 네트워크 대신 mock 응답.
- **인증 분기**: `getPlans`/`getCreditProducts`는 `{ auth: false }`로 비로그인도 호출. `getMyBilling`/`getMonthlyUsage`/`getMyPayments`는 인증 필요.
- **AuthContext**: `MeUser.credit`을 전역으로 들고 있고, `refreshMe()`가 `/auth/me`로 갱신. Header 우상단 "크레딧 N" 배지의 단일 소스.
- **Toss SDK**: `tossPaymentSdk.ts`가 스크립트를 한 번만 lazy-load(프라미스 캐시). `VITE_TOSS_CLIENT_KEY` 미설정 시 throw → 키 없는 환경에서 결제창을 못 열어도 명확히 실패.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 첨삭 화면 — 구조만 있고 동작은 없음

`Correction.tsx`는 `?tab=`만 URL에서 읽어 4탭을 전환한다. 모든 데이터가 컴포넌트 내부 상수다.

```tsx
// 탭 메타 — 크레딧 단가가 여기 하드코딩되어 있다(서버 정책과 별개)
const correctionMeta = {
  answer:    { title: "답변 첨삭",     credit: 1 },  // #24
  cover:     { title: "자기소개서 첨삭", credit: 2 },  // #25
  resume:    { title: "이력서 첨삭",    credit: 2 },  // #26
  portfolio: { title: "포트폴리오 설명 첨삭", credit: 2 }, // #27
};
// 좌: 업로드 드롭존 + placeholder 텍스트박스 + disabled 버튼 3개("준비 중"/"지원 건 연결"/"임시 저장")
// 우: 첨삭 기준 체크리스트 + "최근 첨삭 기록"(샘플 더미 3건, "샘플 ·" prefix)
```

4탭은 담당 AI 기능 #24~27과 1:1 대응한다. 우측 Badge에 크레딧을 표시하지만 **클릭해도 첨삭이 실행되지 않는다.**

### 4-2. 결제 화면 — 4탭 데이터 로딩

```tsx
// 항상: 공개 데이터 (실패하면 에러 배너)
const loadPublic = () => Promise.all([getPlans(), getCreditProducts()]);
// 로그인 시만: 내 데이터 (실패하면 조용히 무시)
const loadMine = () => isAuthenticated
  ? Promise.all([getMyBilling(), getMonthlyUsage(), getMyPayments()])
  : undefined;
```

| 탭 | 데이터 | 동작 |
| --- | --- | --- |
| `plans` | `getPlans()` | FREE는 즉시 `subscribe()`, 유료는 `readyTossPayment(code,"SUBSCRIPTION")`→결제창. PRO에 "추천" Badge |
| `usage` | `getMonthlyUsage()` | feature별 사용 횟수·크레딧을 Progress 바로(화면 내 최대 used 대비 **상대 비율**). 우측 보유 크레딧 카드 + "충전하러 가기" |
| `credits` | `getCreditProducts()` | 상품 카드, `readyTossPayment(code,"CREDIT")`→결제창 |
| `history` | `getMyPayments()` | 결제 카드 리스트(PAID는 "결제 완료" Badge) |

요금제 혜택 라벨은 **서버 `benefits` 우선**, 없으면 클라이언트 상수 `PLAN_FEATURES`로 fallback한다. `usage` 탭이 곧 **#28(요금제 추천)의 데이터 기반 화면**이다 — "이번 달 사용량 vs 보유 크레딧"을 보여주지만, 이를 묶어 **추천 문구를 산출하는 로직은 아직 없다.**

### 4-3. 결제 흐름 — ready → 결제창 → confirm

```text
[Billing.tsx]  doSubscribe / doPurchase
   └─ readyTossPayment(code, type)  → POST /payments/toss/ready
        · 서버가 payment 행을 READY로 선기록 + 금액 고정 + orderId 발급
   └─ requestTossCardPayment(ready) → Toss SDK 결제창(카드)
        · amount/orderId/orderName/successUrl/failUrl 전달
   ↓ Toss 리다이렉트
[BillingSuccess.tsx]  ?paymentKey&orderId&amount
   └─ confirmTossPayment(...)        → POST /payments/toss/confirm
        · 서버가 Toss 승인 + 금액 재검증 + READY→PAID 전환 + 크레딧/사용권 지급
   └─ refreshMe()                    → /auth/me 로 헤더 크레딧·플랜 갱신
```

콜백의 **중복 승인 방지**가 면접 포인트다. React StrictMode는 개발 중 effect를 두 번 실행하는데, confirm이 두 번 가면 같은 결제를 두 번 승인하려 한다. 그래서 `useRef`로 가드한다.

```tsx
const requestedRef = useRef(false);
useEffect(() => {
  if (requestedRef.current) return;   // 두 번째 호출 차단
  requestedRef.current = true;
  // ... paymentKey/orderId/amount 검증 후 confirmTossPayment(...)
}, [refreshMe, searchParams]);
```

서버도 `Idempotency-Key`와 `markPaidIfReady`(조건부 UPDATE)로 멱등을 보장하므로, 프론트 가드가 뚫려도 결제가 두 번 되지는 않는다. **클라이언트 가드 + 서버 멱등의 이중 방어**다.

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

### 됨 (코드 실재)

- **결제/크레딧/사용량 프론트** — `Billing.tsx` 4탭이 실 API 연동(plans/usage/credits/history).
- **Toss 결제창 + 콜백** — ready/confirm, SDK lazy-load, `VITE_TOSS_CLIENT_KEY` 가드, StrictMode 중복 방지.
- **결제 성공 후 헤더 갱신** — `refreshMe()`로 `/auth/me` 재조회, 크레딧·플랜 단일 소스.
- **마케팅 요금제** `Pricing.tsx` — 비교표 + 월/연 토글(순수 클라 상태), 모든 CTA는 결제를 직접 안 하고 `/billing?tab=...`으로 위임.
- **Mock 모드** — `mock/domains/billing.ts`가 결제 도메인 전체를 self-contained 응답으로 제공(subscribe/purchase/cancel 즉시 반영).

### 계획 / 미연결 (근거 있는 갭)

| 항목 | 상태 |
| --- | --- |
| **첨삭 화면 API 연동** | `Correction.tsx`는 `api()` 호출 0건, 배너 "준비 중", 버튼 disabled. 백엔드 `/api/corrections`는 실재(프론트만 미연결) |
| **크레딧 단가** | 클라이언트 상수 하드코딩(서버 정책과 비동기화 가능) |
| **실제 크레딧/사용권 차감** | 차감 엔진은 백엔드에 완성·테스트 통과지만 AI 실행 경로와 미배선 → 화면에 차감이 반영될 차감 자체가 아직 안 일어남 |
| **#28 요금제 추천 문구** | `usage` 탭에 재료 데이터는 다 있으나 추천 산출 로직 없음 |
| **미사용 API 자산** | `getCreditTransactions`/`subscriptionApi`/`creditProductsApi`는 어떤 화면도 호출 안 함(향후 확장 흔적) |
| **관리자 첨삭/크레딧 화면** | 없음. 관리자 결제 화면(`AdminPaymentsPage`)만 존재 |

:::tip 면접에서 이 갭을 강점으로 말하는 법
"화면이 정적이다"는 약점이 아니라, **백엔드 우선 + 날조 금지** 원칙의 결과로 설명하라. mock 라우트를 빈 배열로 유지하고, "API 준비 중" 배너를 명시한 것은 **데모를 위해 가짜 데이터를 만들지 않겠다는 의식적 선택**이다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "영역 E 프론트는 첨삭 화면 하나와 결제 화면 하나로 압축됩니다. 첨삭은 4탭 정적 샘플이고, 결제는 요금제/사용량/크레딧/내역 4탭이 실제 API와 Toss 결제창까지 연동돼 있습니다."
2. **왜** — "결제는 돈이 움직이는 흐름이라 프론트가 단독으로 결정하지 않고 서버가 금액을 고정·재검증하게 설계했습니다. 첨삭은 백엔드 API는 있지만 프론트 연동이 아직이라, 가짜 mock으로 채우지 않고 'API 준비 중'을 명시했습니다."
3. **어떻게** — "결제는 `readyTossPayment`→Toss SDK 결제창→`confirmTossPayment`의 3단계이고, 콜백에서 `useRef`로 StrictMode 중복 승인을 막고 서버 멱등으로 이중 방어합니다. 결제 성공 후 `refreshMe()`로 헤더 크레딧을 단일 소스(`/auth/me`)에서 갱신합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 첨삭 화면에서 버튼을 눌러도 아무 일이 안 일어나는 이유는?
`Correction.tsx`는 의도된 정적 플레이스홀더입니다. 실행 버튼이 `disabled "준비 중"`이고 `api()` 호출이 0건입니다. 모든 데이터(탭 메타, 체크리스트, "최근 첨삭 기록" 3건)가 컴포넌트 내부 상수입니다. 백엔드 `/api/corrections`(생성/목록/단건)는 실제로 구현되어 있어서, 프론트가 그 엔드포인트에 `create` 요청을 붙이는 것만으로 연결됩니다. mock 레지스트리도 `correctionRoutes=[]`로 비워, 존재하지 않는 API를 날조하지 않는 원칙을 지킵니다.
:::

:::details Q2. 크레딧 차감이 화면에 어떻게 반영되나요?
현재는 반영될 차감 자체가 일어나지 않습니다. AI 사용량 로그(`ai_usage_log`)와 첨삭 결과 행은 쌓이지만, 실제 `users.credit` 차감은 차감 엔진과 AI 실행 경로가 아직 배선되지 않아 발생하지 않습니다. 화면 쪽에서 크레딧 단가는 `Correction.tsx`의 `correctionMeta` 상수(answer 1, 나머지 2)로 표시만 하고, 보유 크레딧은 `Billing.tsx`의 `creditBalance`와 Header 배지에서 `/auth/me` 기준으로 보여줍니다. 결제로 충전하면 `confirmTossPayment` 후 `refreshMe()`가 이 값을 갱신합니다.
:::

:::details Q3. 결제 금액 위변조는 프론트에서 어떻게 막나요?
프론트는 금액을 결정하지 않습니다. `readyTossPayment(code, type)`에 **상품 코드만** 보내고, 서버가 ready 단계에서 금액을 산정해 `payment` 행에 고정합니다. 프론트는 그 `ready.amount`로 Toss 결제창을 열 뿐입니다. 콜백에서 다시 `confirmTossPayment`로 넘기면 서버가 Toss 응답의 `totalAmount`와 ready 금액을 둘 다 대조합니다. 즉 "클라이언트가 보낸 금액을 믿지 않는다"가 프론트 설계에도 그대로 반영돼, 화면에서 amount를 조작해도 서버 confirm에서 걸립니다.
:::

:::details Q4. StrictMode에서 결제가 두 번 승인되지 않게 어떻게 했나요?
`BillingSuccess.tsx`에서 `useRef(false)` 플래그(`requestedRef`)를 둬, effect 첫 실행에서 `true`로 바꾸고 두 번째 실행은 즉시 `return`합니다. StrictMode가 개발 중 effect를 두 번 실행해도 confirm은 한 번만 갑니다. 더 중요한 건 서버도 `Idempotency-Key: orderId`와 `markPaidIfReady`(READY→PAID 조건부 UPDATE)로 멱등을 보장한다는 점입니다. 클라이언트 가드가 뚫려도 결제가 중복되지 않는 이중 방어 구조입니다.
:::

:::details Q5. 비로그인 사용자가 결제 페이지에 들어오면 어떻게 되나요?
`loadPublic`(요금제·크레딧 상품)은 `{ auth: false }`라 비로그인도 보입니다. `loadMine`(내 구독·사용량·내역)은 `isAuthenticated`일 때만 호출하고, 실패해도 조용히 무시합니다. 화면에는 "로그인하면 내 구독 상태·사용량·내역을 볼 수 있습니다" 안내 배너가 뜨고, 구독/충전 버튼은 `disabled !isAuthenticated`로 막힙니다. 즉 **요금제 탐색은 누구나, 결제 액션은 로그인 후**입니다.
:::

:::details Q6. Pricing 페이지는 Billing과 무엇이 다른가요?
`Pricing.tsx`(`/pricing`)는 마케팅 비교표입니다. `getPlans`/`getCreditProducts`/`getFeatureBenefitPolicies`를 병렬 로드하되 각각 실패 시 빈 배열로 fallback하고 에러 배너도 띄우지 않습니다(마케팅 페이지라 조용히). 월/연 토글과 구독형/크레딧형 탭은 순수 클라이언트 상태이고, **모든 CTA는 결제를 직접 하지 않고 `/billing?tab=plans` 또는 `/billing?tab=credits`로 위임**합니다. 실제 결제 로직은 `Billing.tsx` 한 곳에만 두어 중복을 막는 설계입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있는지 점검하라.

- `Correction.tsx`가 정적인 이유와, 그것이 "약점"이 아니라 "원칙"인 까닭.
- ready/confirm 2단계에서 프론트가 하는 일과 하지 않는 일(금액을 결정하지 않는다).
- `useRef` 가드 + 서버 멱등의 이중 방어를 한 문장으로.
- `loadPublic` vs `loadMine`의 에러 처리 차이와 그 의도.
- 크레딧 단가가 클라 상수로 하드코딩된 트레이드오프와 향후 수정 방향(서버 정책을 단일 근거로).

연관 학습: [공통 구조화 출력](/ai/openai-structured-output), [AI 사용량·크레딧](/ai/ai-usage-credit), [JWT 인증](/backend/jwt-security).

## 퀴즈

<QuizBox question="Correction.tsx(첨삭 화면)의 현재 구현 상태로 가장 정확한 것은?" :choices="['백엔드 /api/corrections에 연결되어 실제 첨삭이 동작한다', '백엔드 API는 실재하지만 프론트는 api() 호출 0건의 정적 샘플이다', '백엔드도 프론트도 둘 다 미구현이다', 'mock 라우트로 가짜 첨삭 결과를 보여준다']" :answer="1" explanation="백엔드 /api/corrections(생성/목록/단건)는 구현되어 있으나 Correction.tsx는 api() 호출이 전혀 없는 정적 플레이스홀더다. 배너에 '첨삭 API 준비 중'이 명시되고, mock 레지스트리도 correctionRoutes=[]로 비워 가짜 결과를 만들지 않는다." />

<QuizBox question="BillingSuccess.tsx에서 useRef(requestedRef)를 사용하는 주된 이유는?" :choices="['로딩 스피너 상태를 관리하려고', 'StrictMode의 effect 이중 실행으로 인한 confirm 중복 호출을 막으려고', '결제 금액을 클라이언트에서 검증하려고', 'Toss SDK를 한 번만 로드하려고']" :answer="1" explanation="React StrictMode는 개발 중 effect를 두 번 실행하므로 confirm이 두 번 갈 수 있다. requestedRef로 두 번째 실행을 차단해 중복 승인을 막고, 서버의 Idempotency-Key·markPaidIfReady와 함께 이중 방어한다." />

<QuizBox question="Billing.tsx에서 결제 금액 위변조를 막는 프론트 설계로 옳은 것은?" :choices="['프론트가 금액을 계산해 Toss로 직접 전송한다', '프론트는 상품 코드만 보내고 서버가 ready에서 금액을 고정·confirm에서 재검증한다', '사용자가 입력한 금액을 그대로 신뢰한다', '결제 후 amount를 로컬스토리지에 저장해 비교한다']" :answer="1" explanation="readyTossPayment에는 productCode만 보내고 서버가 금액을 산정·고정한다. 콜백 confirm에서 서버가 Toss totalAmount와 ready 금액을 둘 다 대조하므로, 화면에서 금액을 조작해도 서버에서 걸린다. '클라이언트가 보낸 금액을 믿지 않는다'는 원칙이 프론트에도 반영된 것이다." />

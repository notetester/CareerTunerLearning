# 컴포넌트 아키텍처 (feature-first · shadcn/Radix)

> "기능별로 폴더를 나누고(feature-first), 각 기능 안에 api/components/hooks/pages/types/utils를 두며, 공통 UI는 shadcn/Radix 기반 약 50개 프리미티브를 합성해서 만듭니다."

## 1. 한 줄 정의

**컴포넌트 아키텍처**는 화면을 "기능 단위 폴더(feature-first)"로 수직 분할하고, 그 안에서 화면 조각을 **재사용 가능한 컴포넌트**로 조립하는 프론트엔드 구조 규칙이다. CareerTuner는 여기에 **shadcn/Radix 합성 패턴**과 **사용자/관리자 영역 분리**를 더했다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 | 한 줄 설명 |
| --- | --- | --- |
| feature-first | 기능 우선 분할 | `type별`(전체 components/, hooks/)이 아니라 `기능별`(applications/, analysis/)로 먼저 나눈다 |
| 합성(composition) | 작은 것을 조립 | 상속 대신 작은 컴포넌트를 합쳐 큰 화면을 만드는 React의 기본 모델 |
| shadcn/ui | "복붙하는" 컴포넌트 모음 | npm 라이브러리가 아니라, 소스 파일을 내 repo에 **복사해 두고 직접 소유**하는 방식 |
| Radix UI | headless 프리미티브 | 동작·접근성만 제공하고 스타일은 없는 컴포넌트(`@radix-ui/react-*`) |
| headless | 스타일 없는 | 마크업/스타일은 내가, 키보드·포커스·ARIA는 라이브러리가 담당 |
| primitive | 최소 단위 부품 | Button, Dialog, Select 같은 더 못 쪼개는 UI 조각 |
| cva | class-variance-authority | variant(default/outline 등)별 Tailwind 클래스를 선언적으로 묶는 도구 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

CareerTuner는 6명이 수직 분담(A~F)하는 프로젝트다. 구조 규칙이 없으면 다음이 터진다.

- **type별 폴더의 함정**: `components/`에 모든 컴포넌트를, `hooks/`에 모든 훅을 몰아넣으면, "적합도 분석" 한 기능을 고치려고 5개 폴더를 헤집어야 한다. 기능이 어디서 시작하고 끝나는지 경계가 사라진다.
- **충돌 폭증**: 담당자 6명이 같은 거대 `components/` 폴더를 동시에 건드리면 PR 충돌이 상시화된다. feature-first면 보통 자기 폴더 안에서만 변경이 닫힌다.
- **버튼이 47개 모양**: 공통 프리미티브가 없으면 화면마다 버튼/모달을 새로 만들고, 다크모드·접근성·포커스 처리가 제각각이 된다.
- **접근성 재발명**: 모달 포커스 트랩, ESC 닫기, ARIA role을 직접 구현하면 거의 항상 빠뜨린다. Radix가 이걸 보장한다.

:::tip 한 문장 요약
feature-first = **유지보수·소유권 경계**, shadcn/Radix = **재사용·접근성**. 둘은 다른 문제를 푼다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

프론트엔드 영역 전반. 본인 담당은 영역 C(분석/대시보드).

**(1) feature-first 모듈** — `frontend/src/features/<기능>/{api,components,hooks,pages,types,utils}`

```text
frontend/src/features/
  applications/   지원 건(Application Case) — api/ components/ hooks/ pages/ types/ utils/
  analysis/       [C] 적합도·커리어·요약 분석
  dashboard/      [C] 대시보드
  interview/ auth/ billing/ company/ ...  (사용자 기능 모듈 약 19개)
```

실제 `features/analysis/`(C 영역) 내부:

| 폴더 | 실제 파일 예 | 역할 |
| --- | --- | --- |
| `api/` | `fitAnalysisApi.ts`, `careerPlanApi.ts`, `analysisSummaryApi.ts` | 서버 호출(공통 `api()` 래퍼 사용) |
| `components/` | `FitAnalysisProgress.tsx`, `CareerPlanCard.tsx`, `AiResultBadge.tsx` | 화면 조각 |
| `hooks/` | `useApplicationFitAnalysis.ts`, `useFitAnalysisHistory.ts` | 상태/로직 |
| `pages/` | `AnalysisPage.tsx` | 라우트 진입 화면 |
| `types/` | `fitAnalysis.ts`, `careerPlan.ts` | 타입 정의 |

**(2) 공통 UI 프리미티브** — `frontend/src/app/components/ui/`
shadcn/Radix 기반 약 50개: `button.tsx`, `dialog.tsx`, `select.tsx`, `form.tsx`, `tabs.tsx`, `table.tsx`, `tooltip.tsx`, `sheet.tsx`, `drawer.tsx`, `sidebar.tsx`, `chart.tsx`, `sonner.tsx`(토스트) 등. 합성용 유틸은 `ui/utils.ts`의 `cn()`.

**(3) 사용자/관리자 분리**
같은 feature-first 규칙을 관리자에도 적용해 **완전히 분리**했다: `frontend/src/admin/features/<기능>/`(약 36개 모듈 — `fit-analysis/`, `ai-usage/`, `users/` 등)에 별도 `components/`, `hooks/`, `lib/`, `pages/`, `routes.ts`까지 둔다. 라우팅도 `app/routes.ts`(사용자)와 `admin/routes.ts`(관리자)로 갈라진다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### shadcn 합성 패턴 3종 세트 — 실제 `ui/button.tsx`

```tsx
// 1) cva: variant/size별 Tailwind 클래스를 선언적으로 묶는다
const buttonVariants = cva("inline-flex items-center ... rounded-md", {
  variants: {
    variant: { default: "bg-primary ...", outline: "border ...", ghost: "..." },
    size: { default: "h-9 px-4", sm: "h-8 px-3", icon: "size-9" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

function Button({ className, variant, size, asChild = false, ...props }) {
  // 2) Slot: asChild면 button을 렌더 안 하고, 자식(예: <a>)에 스타일만 합성
  const Comp = asChild ? Slot : "button";
  // 3) cn: clsx + tailwind-merge — 충돌하는 Tailwind 클래스를 똑똑하게 병합
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
```

- **cva** → 버튼 모양이 코드 전역에 흩어지지 않고 한 곳에서 관리된다.
- **`asChild` + Slot** → `<Button asChild><a href>`처럼 **태그는 바꾸되 스타일은 물려받기**. 링크인데 버튼처럼 보이게 할 때 새 컴포넌트가 필요 없다.
- **`cn()`** = `twMerge(clsx(...))` → 호출부에서 `className`으로 일부만 덮어쓸 수 있고, `p-4`와 `p-2`가 겹치면 뒤엣것만 남긴다.

### Radix 합성 패턴 — 실제 `ui/dialog.tsx`

Dialog는 하나의 거대 컴포넌트가 아니라 **여러 조각을 export**해 사용처에서 조립한다.

```tsx
<Dialog>
  <DialogTrigger>열기</DialogTrigger>
  <DialogContent>            {/* 포커스 트랩·ESC 닫기·오버레이를 Radix가 보장 */}
    <DialogHeader><DialogTitle>...</DialogTitle></DialogHeader>
    ...
  </DialogContent>
</Dialog>
```

각 조각은 `@radix-ui/react-dialog`의 프리미티브를 감싸고 `data-slot` 속성 + `cn()`으로 스타일만 입힌다. **접근성(포커스 이동, ARIA, 키보드)은 Radix가, 디자인은 우리가** 담당한다.

### 의존 방향 규칙

```text
features/analysis/pages  →  features/analysis/{components,hooks,api,types}  →  app/components/ui(공통)
                                                                          →  app/lib/api.ts(공통 fetch)
```

- 화면(`AnalysisPage`)은 같은 기능 폴더의 조각을 조립한다.
- 로직은 훅으로 뺀다. 예: `useApplicationFitAnalysis`가 `loading/generating/error/generate`를 한 객체로 반환 → 페이지는 상태 분기만 한다.
- 공통(`ui/`, `lib/`)은 **위에서 아래로만** 의존. 기능 폴더끼리 가로로 참조하지 않는다.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "기능별 폴더로 나누고(feature-first), 공통 UI는 shadcn/Radix 프리미티브를 합성해 만들었습니다."
- **기본**: "사용자 기능은 `features/<기능>/{api,components,hooks,pages,types,utils}`로 수직 분할해서 6명 수직 분담과 PR 충돌 최소화에 맞췄고, 관리자는 `admin/features/`로 완전히 분리했습니다. 공통 UI는 `app/components/ui`에 약 50개의 shadcn/Radix 프리미티브를 두고 cva·Slot·cn으로 합성합니다."
- **꼬리질문 대응**: "shadcn은 라이브러리 설치가 아니라 소스를 repo에 복사해 직접 소유하는 방식이라 디자인 토큰·다크모드를 자유롭게 커스터마이즈할 수 있고, 동작·접근성은 headless Radix가 보장해 포커스 트랩이나 ARIA를 재발명하지 않습니다. 로직은 `useApplicationFitAnalysis` 같은 커스텀 훅으로 분리해 페이지를 얇게 유지합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. feature-first와 type별(atoms/molecules) 구조의 차이는?
type별은 `components/`, `hooks/`에 종류별로 몰아넣어 한 기능을 고칠 때 폴더를 넘나들어야 한다. feature-first는 한 기능에 필요한 모든 것(api/components/hooks/types)을 한 폴더에 모아 **변경이 한 폴더 안에서 닫힌다**. 6명 수직 분담에서는 소유권 경계와 충돌 최소화가 중요해 feature-first가 적합했다. 단, 여러 기능이 공유하는 진짜 공통 UI는 `app/components/ui`로 따로 뺐다.
:::

:::details Q2. shadcn은 그냥 컴포넌트 라이브러리 아닌가?
아니다. shadcn/ui는 npm 의존성이 아니라 **소스 코드를 내 repo에 복사**해 직접 소유하는 패턴이다. 그래서 `button.tsx`를 직접 열어 variant나 다크모드 클래스를 고칠 수 있다. 버전 업그레이드 자동화는 포기하지만, 디자인 시스템을 우리 토큰(Tailwind v4 CSS 변수)에 맞춰 자유롭게 통제할 수 있는 게 핵심 이점이다.
:::

:::details Q3. Radix를 왜 쓰나? 직접 div로 모달 만들면 안 되나?
모달은 포커스 트랩, ESC 닫기, 외부 클릭 닫기, 포커스 복원, `role`/`aria-*` 등 **접근성 디테일이 굉장히 많고 직접 구현하면 거의 빠뜨린다**. Radix는 이런 동작과 접근성만 제공하는 headless 프리미티브라, 우리는 `cn()`으로 스타일만 입히면 된다. `dialog.tsx`가 `@radix-ui/react-dialog`를 감싸 `DialogContent`에서 포커스 트랩을 공짜로 얻는 게 그 예다.
:::

:::details Q4. cva와 cn은 정확히 무슨 역할인가?
cva(class-variance-authority)는 `variant`/`size` 같은 prop별 Tailwind 클래스 조합을 **선언적으로 한 곳에 정의**한다. cn은 `twMerge(clsx(...))`로, 조건부 클래스를 합치면서 **충돌하는 Tailwind 클래스를 뒤엣것 우선으로 병합**한다. 둘 덕분에 호출부에서 `className`으로 일부만 안전하게 덮어쓸 수 있다.
:::

:::details Q5. 페이지가 비대해지는 건 어떻게 막나?
로직을 커스텀 훅으로 분리한다. 예로 적합도 분석은 `useApplicationFitAnalysis(applicationCaseId, enabled)`가 데이터 fetch·생성(`generate`)·`loading/generating/error` 상태를 캡슐화해 한 객체로 반환한다. 페이지(`AnalysisPage`)는 그 상태로 분기·렌더만 하므로 얇게 유지된다. 화면 조각은 `FitAnalysisProgress`, `CareerPlanCard`처럼 `components/`로 잘게 쪼갠다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. "우리 프론트 폴더 구조를 처음 보는 동료에게 30초 안에 설명해 보세요. `features/`와 `app/components/ui/`의 역할이 어떻게 다른지, 관리자는 왜 따로 뺐는지 포함해서."
2. "shadcn/Radix 합성 패턴에서 cva, Slot(asChild), cn이 각각 무슨 문제를 푸는지 `button.tsx`를 떠올리며 한 문장씩 말해 보세요."

관련 글: [DTO](/glossary/dto) · [JWT/보안](/backend/jwt-security) · [ApiResponse 엔벨로프](/glossary/api-response-envelope)

## 퀴즈

<QuizBox question="CareerTuner 프론트의 feature-first 구조에서 한 기능 폴더 안에 보통 들어가는 하위 폴더로 가장 적절한 것은?" :choices="['atoms / molecules / organisms', 'api / components / hooks / pages / types / utils', 'models / views / controllers', 'store / actions / reducers']" :answer="1" explanation="features/<기능>/{api,components,hooks,pages,types,utils} 형태로 기능마다 수직 분할한다. atoms/molecules는 type별(atomic) 구조라 이 프로젝트의 선택과 다르다." />

<QuizBox question="shadcn/ui가 일반적인 npm 컴포넌트 라이브러리와 가장 다른 점은?" :choices="['런타임 성능이 항상 더 빠르다', '소스 코드를 내 repo에 복사해 직접 소유·수정한다', '접근성을 전혀 제공하지 않는다', 'CSS-in-JS를 강제한다']" :answer="1" explanation="shadcn은 의존성 설치가 아니라 컴포넌트 소스를 repo로 복사해 직접 소유하는 방식이다. 그래서 ui/button.tsx를 직접 열어 variant와 다크모드 클래스를 커스터마이즈할 수 있다." />

<QuizBox question="Radix 같은 headless 프리미티브를 직접 만든 div 모달 대신 쓰는 핵심 이유를 한 문단으로 설명해 보세요." explanation="모달은 포커스 트랩, ESC/외부 클릭 닫기, 포커스 복원, role과 aria-* 같은 접근성·키보드 동작이 매우 많고 직접 구현하면 거의 빠뜨린다. Radix는 이런 동작과 접근성만 제공하는 headless 프리미티브라, 우리는 cn()으로 Tailwind 스타일만 입히면 된다. CareerTuner의 ui/dialog.tsx도 @radix-ui/react-dialog를 감싸 DialogContent에서 포커스 트랩과 ARIA를 공짜로 얻고, data-slot과 cn으로 디자인만 우리가 담당한다." />

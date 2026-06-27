# Tailwind CSS와 다크모드

> Tailwind는 미리 만들어진 작은 유틸리티 클래스를 HTML에서 조합해 스타일을 짜는 CSS 프레임워크고, CareerTuner는 색을 CSS 변수로 한 곳에 모은 뒤 `.dark` 클래스 하나로 라이트/다크를 전환합니다. 전환은 next-themes가, 모바일 노치 회피는 `env(safe-area-inset-*)`가 담당합니다.

## 1. 한 줄 정의

**Tailwind CSS**는 `flex` `pt-4` `text-foreground` 같은 단일 목적 **유틸리티 클래스**를 마크업에서 직접 조합해 디자인하는 "유틸리티 우선(utility-first)" CSS 프레임워크다. **다크모드**는 그 위에서 색 값을 CSS 변수로 두고 루트 요소의 `.dark` 클래스 유무에 따라 변수 값만 바꿔 화면 전체 톤을 뒤집는 기법이다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| Utility-first | 의미 단위 컴포넌트 클래스(`.card`)를 먼저 만들지 않고, 원자적 유틸리티(`p-4 rounded-lg`)부터 조합하는 방식 |
| Tailwind v4 | 2024~2025 메이저. 설정이 JS(`tailwind.config.js`)에서 **CSS 우선**(`@theme`, `@import "tailwindcss"`)으로 이동 |
| `@tailwindcss/vite` | v4에서 PostCSS 대신 쓰는 Vite 전용 플러그인. 빌드가 더 빠르고 설정이 간단 |
| 시맨틱 토큰 | `--background` `--foreground`처럼 "역할"로 이름 붙인 색 변수. 값은 모드마다 다르게 |
| `@custom-variant` | v4 문법. `dark:` 같은 변형을 직접 정의 |
| safe-area | 노치·홈 인디케이터에 가리지 않는 안전 영역. `env(safe-area-inset-*)`로 읽음 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **유틸리티 우선이 없으면**: 컴포넌트마다 별도 CSS 파일·클래스명을 짓고(네이밍 지옥), 안 쓰는 스타일이 쌓이며, "이 클래스를 지워도 되나?"를 늘 걱정한다. Tailwind는 마크업에 스타일이 붙어 있어 **삭제·이동이 안전**하고, 디자인 토큰을 강제해 일관성이 생긴다.
- **CSS 변수 기반 토큰이 없으면**: 다크모드를 하려면 모든 컴포넌트에 `dark:bg-...`를 일일이 다는데, 색을 바꿀 때마다 수백 군데를 고쳐야 한다. CareerTuner는 색을 `theme.css` **한 파일**에 모아 두어, 팔레트 변경이 한 곳 수정으로 끝난다.
- **safe-area가 없으면**: Capacitor로 감싼 모바일 앱에서 헤더가 노치에 잘리고 하단 네비가 홈 바에 가린다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

> 영역: 프론트엔드 공통 (라우팅·테마는 공통 영역이라 변경 시 팀 합의 대상)

| 위치 | 역할 |
| --- | --- |
| `frontend/vite.config.ts` | `import tailwindcss from '@tailwindcss/vite'` 후 플러그인 배열에 `tailwindcss()` 등록 (v4 방식) |
| `frontend/src/styles/tailwind.css` | `@import 'tailwindcss' source(none);` + `@source '../**/*.{js,ts,jsx,tsx}';`로 스캔 범위 지정, `tw-animate-css` import |
| `frontend/src/styles/theme.css` | 디자인 시스템 단일 출처. `@custom-variant dark`, `:root`(라이트)/`.dark`(다크) 변수, `@theme inline`(변수→유틸리티 브리지) |
| `frontend/src/styles/index.css` | `fonts → tailwind → theme → av-base` 순서로 묶는 진입 CSS |
| `frontend/src/app/App.tsx` | `ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}` (next-themes) |
| `frontend/src/app/components/layout/ThemeToggle.tsx` | `useTheme()`의 `resolvedTheme`/`setTheme`로 라이트↔다크 토글, 선택은 localStorage 저장 |
| `Header.tsx` / `MobileBottomNav.tsx` / `Root.tsx` | `env(safe-area-inset-top/bottom)`로 노치·홈바 회피 (예: `pb-[calc(56px+env(safe-area-inset-bottom))]`) |

구현 사실 두 가지를 정직하게 짚으면:
- **기본 테마가 다크**다(`defaultTheme="dark"`). 토글의 초기 표시도 다크 기준(`mounted` 전엔 `isDark = true`)이라 SSR/하이드레이션 깜빡임을 피한다.
- **시스템 테마 추종은 끔**(`enableSystem={false}`). OS 다크 설정을 자동으로 따르지 않고 사용자의 명시적 토글만 따른다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### (1) 색 토큰 → 유틸리티 브리지

`theme.css`는 3단으로 동작한다.

```css
/* 1) 변형 정의: .dark 조상 아래면 dark: 적용 */
@custom-variant dark (&:is(.dark *));

/* 2) 모드별 값: 같은 이름, 다른 값 */
:root { --background: #fafafa; --foreground: #16171a; }
.dark { --background: #08090a; --foreground: #f7f8f8; }

/* 3) 변수를 Tailwind 색으로 등록 → bg-background/text-foreground 생성 */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}
```

그러면 컴포넌트는 모드를 신경 쓸 필요가 없다.

```tsx
<div className="bg-background text-foreground border border-border">
```

`.dark`가 붙는 순간 `--background` 값이 바뀌고, 이 클래스들이 가리키는 색이 통째로 따라 바뀐다. **`dark:` 접두사를 컴포넌트마다 달 필요가 없다**는 게 핵심이다.

### (2) "팔레트 브리지" (CareerTuner 고유 트릭)

`theme.css` 하단은 `--color-slate-900: var(--foreground)` 처럼 **하드코딩된 Tailwind 색까지 시맨틱 토큰에 매핑**한다. 과거에 `text-slate-900`로 박아 둔 페이지를 일일이 고치지 않아도 다크모드가 자동 대응되게 만든 장치다. (주석에 한계도 명시: `bg-white`나 의도적 다크 배경 `bg-slate-900`은 자동 매핑이 깨질 수 있어 개별 수정.)

### (3) 전환 흐름

| 단계 | 무슨 일 |
| --- | --- |
| 1 | 사용자가 `ThemeToggle` 클릭 → `setTheme("light"/"dark")` |
| 2 | next-themes가 `<html>`의 class를 `dark`↔없음으로 바꾸고 localStorage에 저장 |
| 3 | `.dark` 셀렉터가 켜져 CSS 변수 값이 교체됨 |
| 4 | `var(--...)`를 쓰는 모든 유틸리티 클래스가 새 색으로 리렌더 없이 반영 |

### (4) safe-area

```tsx
// 하단 네비가 있을 때만 홈 인디케이터 높이만큼 패딩
<main className={showMobileNav
  ? "pb-[calc(56px+env(safe-area-inset-bottom))] xl:pb-0" : ""} />
```

`env(safe-area-inset-bottom)`은 OS가 주는 안전 영역 값으로, 일반 브라우저에선 0, 노치 기기에선 실제 높이가 들어온다.

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **1문장**: "Tailwind는 유틸리티 클래스로 스타일을 짜는 프레임워크고, 저는 색을 CSS 변수로 모아 `.dark` 클래스 하나로 다크모드를 전환했습니다."
- **기본**: "`theme.css`에 `:root`(라이트)와 `.dark`(다크)로 같은 이름의 CSS 변수를 다른 값으로 정의하고, v4의 `@theme inline`으로 그 변수를 `bg-background` 같은 유틸리티에 연결했습니다. 컴포넌트는 `dark:`를 안 달아도 되고, next-themes가 `<html>`에 `dark` 클래스를 토글하면 색이 통째로 바뀝니다. 팔레트 변경이 한 파일 수정으로 끝나는 게 장점입니다."
- **꼬리질문 대응**: "기존에 `text-slate-900`처럼 하드코딩된 색들도 다크 대응하려고, Tailwind 팔레트 키 자체를 시맨틱 토큰에 매핑하는 브리지를 `@theme inline`에 넣었습니다. 모바일은 Capacitor라 `env(safe-area-inset-*)`로 노치·홈바를 피했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 `dark:bg-...` 대신 CSS 변수 방식을 택했나?
`dark:` 접두사 방식은 컴포넌트마다 라이트/다크 두 색을 같이 적어야 해서, 팔레트를 바꾸면 수백 곳을 고쳐야 한다. CSS 변수는 **색의 단일 출처**를 `theme.css`에 두고 컴포넌트는 역할 이름(`bg-background`)만 참조하므로, 디자인 변경 비용이 한 파일로 수렴한다. 토큰 일관성도 강제된다.
:::

:::details Q2. Tailwind v3와 v4 설정 차이는?
v3은 `tailwind.config.js`(JS)와 PostCSS 기반이었지만, v4는 **CSS 우선**으로 옮겨 `@import "tailwindcss"`, `@theme`, `@custom-variant`를 CSS에서 직접 쓴다. 우리는 PostCSS 대신 `@tailwindcss/vite` 플러그인을 `vite.config.ts`에 등록해 빌드 속도와 설정 단순함을 챙겼다.
:::

:::details Q3. 다크모드에서 화면 깜빡임(FOUC)은 어떻게 막나?
next-themes가 `<html>`에 클래스를 적용하는 시점과 React 하이드레이션 타이밍이 어긋나면 깜빡인다. 우리는 `disableTransitionOnChange`로 전환 트랜지션을 끄고, `defaultTheme="dark"`로 초기값을 고정했으며, `ThemeToggle`은 `mounted` 전에는 다크로 가정해 서버/클라 불일치 경고와 아이콘 깜빡임을 줄였다.
:::

:::details Q4. `@theme inline`이 정확히 뭘 하나?
CSS 변수를 Tailwind가 인식하는 **테마 토큰**으로 등록한다. `--color-background: var(--background)`라고 쓰면 Tailwind가 `bg-background`, `text-background` 같은 유틸리티를 생성한다. `inline`은 값을 그대로(런타임 `var()` 참조로) 흘려보내서, `:root`/`.dark`의 변수 교체가 즉시 반영되도록 한다.
:::

:::details Q5. `enableSystem={false}`로 둔 이유는?
OS 다크 설정 자동 추종을 끄고 사용자의 명시적 토글만 존중하기 위해서다. 제품 기본 톤을 다크로 잡고(브랜드 톤이 Linear 계열 어두운 UI), 사용자가 원하면 라이트로 바꾸는 정책이라 시스템 추종은 의도적으로 비활성화했다. 추후 시스템 추종이 필요하면 `enableSystem`만 켜면 된다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문)

1. "CareerTuner의 다크모드 전환을, 클릭 → CSS 변수 → 화면 반영까지 30초 안에 흐름으로 설명해 보세요. (`ThemeToggle` → next-themes → `.dark` → `var()` 키워드를 포함)"
2. "팀에 입사한 신입이 `text-slate-900`을 하드코딩했습니다. 다크모드에서 글씨가 안 보일 수 있는데, 우리 코드베이스는 왜 (어느 정도) 자동으로 버텨내는지 한 문장으로 설명해 보세요."

## 관련 페이지

- [Vite와 프론트 빌드](/frontend/vite)
- [React Context와 상태관리](/frontend/state-management)
- [Capacitor 모바일 래핑](/frontend/capacitor-mobile)
- [CSS 변수와 디자인 토큰](/frontend/design-tokens)

## 퀴즈

<QuizBox question="CareerTuner에서 라이트/다크 색 값을 같은 이름으로 다르게 정의하는 단일 출처 파일은?" :choices="['vite.config.ts', 'theme.css의 :root와 .dark', 'App.tsx의 ThemeProvider', 'tailwind.css']" :answer="1" explanation="theme.css에서 :root(라이트)와 .dark(다크)에 같은 이름의 CSS 변수를 다른 값으로 정의하고, @theme inline으로 유틸리티에 연결합니다. 색의 단일 출처입니다." />

<QuizBox question="Tailwind v4에서 CareerTuner가 PostCSS 대신 사용하는 빌드 통합 방식은?" :choices="['tailwind.config.js', '@tailwindcss/vite 플러그인', 'webpack loader', 'CDN 스크립트 태그']" :answer="1" explanation="vite.config.ts에서 @tailwindcss/vite 플러그인을 등록합니다. v4는 설정이 CSS 우선으로 옮겨졌고 Vite 전용 플러그인으로 빌드가 빨라집니다." />

<QuizBox question="CSS 변수 기반 다크모드가 컴포넌트마다 dark: 접두사를 다는 방식보다 나은 점을 한 문단으로 설명해 보세요." explanation="색을 역할 이름의 CSS 변수로 모아 단일 출처(theme.css)에 두면, 컴포넌트는 bg-background 같은 역할 클래스만 참조하므로 .dark 클래스 하나로 전체 톤이 바뀝니다. dark: 방식은 컴포넌트마다 라이트/다크 두 색을 함께 적어야 해 팔레트 변경 시 수백 곳을 고쳐야 하지만, 변수 방식은 한 파일 수정으로 끝나고 토큰 일관성도 강제됩니다. CareerTuner는 여기에 하드코딩된 slate/gray 색까지 시맨틱 토큰에 매핑하는 브리지를 더해 기존 페이지도 자동 대응되게 했습니다." />

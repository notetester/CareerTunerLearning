# 디자인 토큰과 CSS 변수

> 색·간격·타이포 같은 디자인 결정을 "이름 붙인 변수"로 한 곳에 모아두고, 화면 전체가 그 이름만 참조하게 만드는 기법. CareerTuner는 `theme.css`의 CSS 커스텀 프로퍼티로 라이트/다크를 한 번에 갈아끼운다.

## 1. 한 줄 정의

디자인 토큰은 `#5e6ad2` 같은 날 값(raw value) 대신 `--primary`처럼 **의미 있는 이름**을 붙여 디자인 결정을 단일 출처(single source of truth)로 관리하는 변수다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 뜻 | 비고 |
| --- | --- | --- |
| Token | "값을 대신하는 표"라는 의미. 화폐 대신 쓰는 토큰처럼, 실제 색값 대신 쓰는 이름표 | 디자인 시스템 용어 |
| CSS Custom Property | CSS 표준의 사용자 정의 변수. `--이름: 값;`으로 선언, `var(--이름)`으로 사용 | 흔히 "CSS 변수"로 부름 |
| `--` 접두사 | 커스텀 프로퍼티임을 표시하는 CSS 문법 규칙 | 브라우저 네이티브, 빌드 불필요 |
| Semantic token | 역할 기반 이름(`--primary`, `--background`) | 값이 아니라 "쓰임"을 가리킴 |
| Primitive token | 원시 값(`#5e6ad2`) | 시맨틱 토큰이 참조하는 바닥값 |

핵심은 **CSS 변수는 런타임에 살아있다**는 점이다. SCSS 변수처럼 빌드 때 사라지는 게 아니라, 브라우저가 DOM 트리를 따라 상속·재정의(cascade)한다. 그래서 부모 요소의 클래스 하나만 바꿔도 자식 전체의 변수 값이 즉시 달라진다 — 다크모드가 가능한 이유가 여기 있다.

## 3. 왜 필요 (없으면 무슨 문제)

색을 컴포넌트마다 하드코딩하면 다음이 깨진다.

- **일관성 붕괴**: 어떤 버튼은 `#5e6ad2`, 어떤 버튼은 `#5d6bd0`. 디자이너 의도와 미세하게 어긋난 색이 수백 군데 흩어진다.
- **테마 교체 불가**: 다크모드를 만들려면 `#ffffff`가 박힌 모든 파일을 찾아 `#08090a`로 바꿔야 한다. 누락이 반드시 생긴다.
- **변경 비용 폭발**: 브랜드색이 바뀌면 전수 검색·치환. 리뷰 지옥.

:::tip
토큰의 진짜 가치는 "한 곳을 바꾸면 전부 바뀐다"이다. CareerTuner에서 `--primary` 한 줄만 고치면 버튼·링크·포커스 링·사이드바 액티브가 동시에 따라온다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

단일 출처는 `frontend/src/styles/theme.css`다. 로딩 순서는 `frontend/src/styles/index.css`가 `tailwind.css` → `theme.css` 순으로 `@import` 한다.

토큰은 세 층으로 구성된다.

1. **라이트 토큰** — `:root`에 선언 (Vercel 톤). 예: `--background: #fafafa; --primary: #5e6ad2; --foreground: #16171a;`
2. **다크 토큰** — `.dark` 선택자에서 같은 이름을 재정의 (Linear 톤). 예: `--background: #08090a; --foreground: #f7f8f8;`
3. **Tailwind 브리지** — `@theme inline` 블록에서 `--color-primary: var(--primary)` 식으로 매핑해, `bg-primary` `text-foreground` 같은 유틸리티 클래스가 토큰을 가리키게 한다.

테마 토글은 라이브러리 `next-themes`가 담당한다. `frontend/src/app/App.tsx`의 `ThemeProvider`가 `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`로 설정돼 있어, 다크일 때 `<html>`에 `.dark` 클래스를 붙였다 뗐다 한다. 사용자가 누르는 토글은 `frontend/src/app/components/layout/ThemeToggle.tsx`이고, 선택은 `next-themes`가 localStorage에 저장한다.

토큰의 도메인별 확장도 실제로 쓰인다.

| 토큰 그룹 | 예시 | 용도 |
| --- | --- | --- |
| 확장 표면·텍스트 위계 | `--surface-2`, `--ink-2~4`, `--border-strong` | Linear/Vercel식 깊이감 |
| AI 오케스트레이터 강조 | `--orch-indigo`, `--orch-point`, `--gradient-orchestrator` | 챗봇 모드 전환 신호(AutoPrep 위젯) |
| 커뮤니티 카테고리 | `--cat-job-bg/fg`, `--cat-interview-bg/fg` | 게시판 카테고리 뱃지 |
| 상태색 | `--success`, `--warning`, `--destructive` | 성공/경고/파괴적 액션 |

특히 인상적인 부분은 **Tailwind 팔레트 브리지**다. 과거 페이지에 하드코딩됐던 `slate`/`gray`/`zinc`/`blue` 같은 Tailwind 기본 색을 `@theme inline`에서 시맨틱 토큰으로 강제 매핑한다. 예를 들어 `--color-slate-900: var(--foreground)`. 덕분에 옛 페이지 파일을 손대지 않고도 다크/라이트가 자동 대응된다. 색 모노톤화 정책(잡색을 단일 액센트로 수렴)도 이 블록에서 일괄 처리한다.

:::warning
브리지에는 함정도 있다. `bg-slate-900`처럼 "의도적으로 어두운 배경"을 쓴 곳은 `--foreground`로 매핑돼 **다크모드에서 색이 뒤집힌다**. `theme.css` 주석에도 "개별 수정 필요"라고 명시돼 있다. 자동 매핑은 만능이 아니라 마이그레이션 보조 장치다.
:::

토큰 연결의 전체 흐름과 다크모드 토글 메커니즘은 [Tailwind와 다크모드](/frontend/tailwind-darkmode)에서 이어진다.

## 5. 핵심 동작 원리 (표·작은 코드)

선언 → 브리지 → 사용의 3단계다.

```css
/* 1) :root = 라이트 기본값, .dark = 다크 재정의 (theme.css) */
:root  { --background: #fafafa; --foreground: #16171a; --primary: #5e6ad2; }
.dark  { --background: #08090a; --foreground: #f7f8f8; }

/* 2) Tailwind 유틸리티가 토큰을 가리키도록 브리지 (@theme inline) */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary:    var(--primary);
}
```

```tsx
// 3) 컴포넌트는 색을 모르고 "역할"만 쓴다
<button className="bg-primary text-primary-foreground">분석 시작</button>
// .dark 클래스가 붙으면 var(--background) 값이 바뀌고, 별도 코드 변경 없이 색이 전환된다
```

런타임 동작 순서:

| 단계 | 일어나는 일 |
| --- | --- |
| 1 | 사용자가 `ThemeToggle` 클릭 |
| 2 | `next-themes`가 `<html class="dark">` 추가/제거 + localStorage 기록 |
| 3 | 브라우저 cascade가 `.dark` 안 `--background` 등 변수 값을 교체 |
| 4 | `var(--background)`를 참조하던 모든 요소가 리페인트 — JS 재렌더 없음 |

여기서 "값이 아니라 이름을 쓴다"는 발상은 백엔드의 [ApiResponse 엔벨로프](/glossary/api-response-envelope)가 응답 형태를 한 군데로 통일하는 것과 같은 종류의 추상화다. 표면을 통일하면 변경 지점이 하나로 모인다.

## 6. 면접 답변 3단계 (초간단/기본/꼬리질문)

**초간단**: "색·간격 같은 디자인 값에 이름을 붙여 CSS 변수로 한 곳에 모았습니다. 다크모드는 그 변수 값만 통째로 바꿔 구현했습니다."

**기본**: "`theme.css`의 `:root`에 라이트 토큰을, `.dark`에 같은 이름의 다크 토큰을 선언했습니다. `@theme inline`으로 Tailwind 유틸리티가 이 토큰을 가리키게 브리지했고, `next-themes`가 `<html>`에 `.dark` 클래스를 토글하면 CSS cascade가 변수 값을 갈아끼웁니다. 컴포넌트는 색값을 모르고 `bg-primary` 같은 역할 이름만 씁니다."

**꼬리질문 대응**: "기존 페이지에 박힌 Tailwind 기본 색(`slate`, `gray` 등)도 `@theme inline`에서 시맨틱 토큰으로 강제 매핑해, 페이지 파일을 수정하지 않고 다크 대응을 입혔습니다. 다만 의도적 다크 배경처럼 뒤집히는 케이스는 개별 수정이 필요해, 자동 매핑을 마이그레이션 보조로만 봤습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. SCSS 변수로도 되는데 왜 CSS 커스텀 프로퍼티인가?
SCSS 변수는 빌드 타임에 값으로 치환돼 사라지므로 런타임에 바꿀 수 없습니다. 다크모드는 런타임 전환이라 SCSS로는 라이트/다크 두 벌의 CSS를 전부 빌드해야 합니다. CSS 커스텀 프로퍼티는 DOM에 살아있어 부모 클래스(`.dark`) 하나로 자식 전체 변수를 cascade로 재정의할 수 있습니다. CareerTuner가 클래스 토글만으로 테마를 바꾸는 근거입니다.
:::

:::details Q2. 시맨틱 토큰과 프리미티브 토큰을 왜 나누나?
프리미티브(`#5e6ad2`)는 "무슨 색인가", 시맨틱(`--primary`)은 "어디에 쓰는가"입니다. 컴포넌트가 시맨틱만 참조하면, 브랜드색을 바꿀 때 프리미티브 한 줄만 고쳐도 됩니다. 또 라이트/다크가 같은 시맨틱 이름을 각자 다른 프리미티브로 매핑하므로, 컴포넌트 코드는 테마를 전혀 몰라도 됩니다.
:::

:::details Q3. Tailwind 팔레트 브리지의 위험은?
`--color-slate-900: var(--foreground)` 같은 매핑은 라이트에서 자연스럽지만, `bg-slate-900`을 "의도적으로 어두운 배경"으로 쓴 곳은 다크에서 `--foreground`(밝은색)로 뒤집힙니다. 그래서 `theme.css` 주석에 개별 수정 대상으로 표시했고, 브리지는 전수 치환 전의 보조 수단으로만 신뢰합니다.
:::

:::details Q4. 다크모드 깜빡임(FOUC)은 어떻게 막나?
`next-themes`를 `defaultTheme="dark"`로 두고 `attribute="class"`로 `<html>`에 적용합니다. `next-themes`는 첫 페인트 전에 localStorage 값을 읽어 클래스를 설정하므로, 라이트로 떴다가 다크로 깜빡이는 현상을 줄입니다. `disableTransitionOnChange`도 켜 전환 시 트랜지션 잔상을 없앴습니다.
:::

:::details Q5. 차트색이 oklch인 이유는?
`--chart-1~5`는 `oklch()`로 선언했습니다. oklch는 인지적으로 균일한 색 공간이라, 명도·채도를 같게 유지하며 색상만 돌리기 쉬워 차트 시리즈 색을 균형 있게 뽑기 좋습니다. 표면 토큰은 디자이너 지정 hex를 그대로 썼고, 차트만 의도적으로 oklch를 택했습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 합격선이다.

- `:root` / `.dark` / `@theme inline` 세 블록이 각각 무슨 역할인지 한 문장씩
- 사용자가 토글을 누른 순간부터 화면 색이 바뀌기까지의 4단계 (`next-themes` → `<html>.dark` → cascade → 리페인트)
- 시맨틱 토큰과 프리미티브 토큰의 차이, 그리고 왜 컴포넌트는 시맨틱만 써야 하는지
- Tailwind 팔레트 브리지가 해결한 문제와, 그게 만든 새 위험(다크에서 뒤집히는 배경)

## 퀴즈

<QuizBox question="CareerTuner에서 다크모드 전환의 실제 트리거는 무엇인가?" :choices="['JS가 모든 요소의 style을 직접 다시 칠한다', 'next-themes가 <html>에 .dark 클래스를 토글해 CSS 변수 값이 cascade로 바뀐다', 'SCSS를 다시 컴파일한다', '서버가 다크용 CSS 파일을 새로 내려준다']" :answer="1" explanation="next-themes가 attribute=class 설정으로 <html>에 .dark를 붙이면, .dark 선택자 안에서 재정의된 --background 등의 변수 값으로 cascade가 갈아끼우고, var()를 참조하던 요소들이 JS 재렌더 없이 리페인트된다." />

<QuizBox question="theme.css의 @theme inline 블록(예: --color-primary: var(--primary))이 하는 일은?" :choices="['브라우저 기본 색을 초기화한다', 'CSS 변수를 SCSS 변수로 변환한다', 'Tailwind 유틸리티 클래스(bg-primary 등)가 디자인 토큰을 가리키도록 연결한다', '다크모드를 비활성화한다']" :answer="2" explanation="@theme inline은 Tailwind v4가 --color-* 이름으로 유틸리티를 생성하게 하는 브리지다. var(--primary)를 가리키게 매핑하면 bg-primary 같은 클래스가 시맨틱 토큰을 참조한다." />

<QuizBox question="색을 컴포넌트마다 hex로 하드코딩할 때 생기는 문제를 시맨틱 토큰이 어떻게 해결하는지 한 문장으로 설명하라." explanation="모범답안: 하드코딩은 같은 색이 수백 군데 흩어져 일관성이 깨지고 테마 교체·브랜드 변경 시 전수 치환이 필요하지만, 컴포넌트가 --primary 같은 역할 이름만 참조하면 단일 출처(theme.css) 한 곳만 고쳐도 전부 따라오고 라이트/다크는 같은 이름을 다른 값으로 매핑해 해결한다." />

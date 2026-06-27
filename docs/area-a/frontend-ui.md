# A 프론트엔드 UI/UX — 인증·프로필·설정 화면

> 영역 A의 화면은 "인증으로 나를 증명하고 · 프로필로 나를 설명하고 · 설정으로 동의를 관리한다"는 흐름을 React 18 + Vite로 구현한다. 폼은 라이브러리 없이 `useState` + 수동 검증으로 처리하고, 토큰은 localStorage에 두고 401 자동 갱신으로 세션을 유지한다.

---

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 A의 프론트엔드는 사용자가 **계정을 만들고(로그인/회원가입/소셜)**, **스펙을 입력하고(프로필)**, **AI 추출 결과를 확인·수정하고**, **개인정보·AI 동의를 관리하는(설정)** 화면 묶음이다.

:::tip 이 페이지가 답하는 면접 질문
- "로그인 폼 상태와 검증을 어떻게 처리했나요? React Hook Form 같은 라이브러리를 썼나요?"
- "토큰은 어디에 저장하고, 만료되면 화면에서 어떻게 처리하나요?"
- "프로필 입력처럼 동적으로 늘어나는 폼(학력·경력 여러 개)은 어떻게 다뤘나요?"
- "AI 추출 결과를 사용자가 그대로 신뢰하지 않고 수정할 수 있게 한 이유는?"
:::

핵심 한 줄: **"폼 라이브러리 없이 단방향 데이터 흐름(`useState` → 검증 → API)으로 가볍게 가고, 인증은 서버를 단일 권위로 삼아 클라이언트는 상태를 거의 들고 있지 않는다."**

---

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 폴더 구조: 표준 `features/`는 빈 스캐폴딩, 실제 화면은 `app/`에 있다

문서가 지정한 표준 경로 `frontend/src/features/auth`, `features/profile`, `features/settings`는 **`.gitkeep`과 빈 하위 폴더만 있는 껍데기**다. 실제 사용자 화면은 전부 `frontend/src/app/` 아래에 있다.

| 표준 경로(계획) | 실제 구현 위치 |
| --- | --- |
| `features/auth/pages` | `app/pages/Login.tsx`, `AuthCallback.tsx` 등 |
| `features/profile/pages` | `app/pages/Profile.tsx` |
| `features/settings/pages` | `app/pages/Settings.tsx` |
| 인증 코어 | `app/auth/AuthContext.tsx`, `app/lib/{api,tokenStore}.ts` |

읽히는 의도: **인증은 모든 라우트의 전제 조건(공통 기반)**이라 기능 모듈로 격리하기보다 앱 코어(`app/`)에 직접 두는 초기 프로토타입 구조를 그대로 운영 중이다. 반대로 **관리자 화면만** `admin/features/{users,consents,profiles}/`로 표준 모듈 구조를 따른다. 면접에서는 이 불일치를 "알고 있는 부채"로 정직히 설명하는 편이 낫다.

### 폼 처리: React Hook Form을 쓰지 않는다

영역 A 화면은 **React Hook Form·Formik 같은 폼 라이브러리를 쓰지 않는다.** 모든 입력은 제어 컴포넌트(controlled component) + `useState`이고, 검증은 제출 시점에 호출하는 순수 함수다.

- 의도: 화면 수가 적고 폼 구조가 단순/중첩적이라(프로필은 배열·중첩 객체) 라이브러리의 스키마 추상화보다 **명시적 상태 변환 함수**가 데이터 모델(JSON 컬럼)과 1:1로 대응돼 읽기 쉽다.
- 트레이드오프: 필드별 onChange 핸들러를 직접 써야 해 보일러플레이트가 늘고, 검증이 "제출 시 한 번"이라 필드 단위 즉시 피드백은 제한적이다(이메일 중복만 `onBlur`로 예외 처리).

### 인증 권위는 서버에 둔다 — 클라이언트 라우트 가드 없음

`/profile`·`/settings`에 `ProtectedRoute` 같은 클라이언트 가드가 **없다**. 비로그인 상태로 진입은 가능하지만, 화면이 호출하는 API가 401을 주고 → 토큰 갱신 실패 → 에러 박스로 처리된다.

- 의도: "이 사용자가 이 데이터에 접근 가능한가"의 **단일 판정 권위는 서버**다. 클라이언트가 같은 판단을 복제하면 두 곳이 어긋날 위험이 생긴다.
- 트레이드오프: 비로그인 진입 시 화면이 잠깐 그려졌다가 에러로 바뀌는 깜빡임(flash)이 있다.

---

## 3. 어떤 기술로 구현했나 (실제 클래스·파일 근거)

| 레이어 | 파일 | 역할 |
| --- | --- | --- |
| 토큰 보관 | `app/lib/tokenStore.ts` | access/refresh를 localStorage 단일 키 `careertuner.auth`에 JSON으로 |
| API 래퍼 | `app/lib/api.ts` | envelope 해제 + 401 자동 refresh + Mock 모드 분기 |
| 전역 인증 상태 | `app/auth/AuthContext.tsx` | `MeUser` 모델, login/register/socialLogin/logout 액션 |
| 로그인/가입 | `app/pages/Login.tsx` | mode 토글 단일 폼, 소셜 3버튼, 동의 4종 |
| 프로필 | `app/pages/Profile.tsx` | 스펙 입력 + AI 도구 3버튼 + 결과 확인 |
| 설정 | `app/pages/Settings.tsx` | 4탭(계정/개인정보/AI동의/알림) |
| 기기 잠금 | `app/components/AppLockSettings.tsx` | 서버와 무관한 PIN/생체 2차 잠금 |
| 소셜 콜백 | `app/pages/AuthCallback.tsx` | URL `#fragment` 토큰 후처리 |

스택: **React 18 + Vite 6 + TypeScript + Tailwind v4**, 라우팅은 `react-router`, UI 프리미티브는 `components/ui/*`(Button/Card/Input/Tabs/Checkbox/Progress 등), 아이콘은 `lucide-react`. `/api/*` 요청은 Vite 프록시가 8080으로 전달한다. 관련 백엔드는 [JWT/보안](/backend/jwt-security)과 [영역 A 개요](/area-a/)를 함께 보면 좋다.

---

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 토큰 보관과 401 자동 갱신

`tokenStore.ts`는 두 토큰을 한 키에 JSON으로 묶어 localStorage에 둔다. `api.ts`의 공통 래퍼가 매 요청에 `Authorization: Bearer`를 붙이고, **401이 오면 한 번만 refresh를 시도**한 뒤 원요청을 재시도한다.

```ts
// app/lib/api.ts — 핵심만 축약
let refreshPromise: Promise<boolean> | null = null;   // 동시 401을 한 번으로 합침

if (res.status === 401 && withAuth && getRefreshToken()) {
  const ok = await tryRefresh();                       // /auth/refresh 1회
  if (ok) res = await fetch(url, withFreshToken());     // 새 토큰으로 재시도
}
```

핵심 포인트:
- **동시성 제어:** 여러 요청이 동시에 401을 받아도 `refreshPromise` 하나를 공유해 refresh는 **딱 한 번**만 일어난다(갱신 폭주 방지).
- **갱신 실패 시:** `clearTokens()`로 세션을 비운다. 그 뒤 호출은 401 → 에러 박스로 표면화.
- **Mock 모드:** `VITE_USE_MOCK==="true"`면 네트워크 대신 mock 레지스트리로 응답하고, 미등록 엔드포인트는 501(`DEMO_UNAVAILABLE`)을 던진다 → 백엔드 없이 데모/APK 시연 가능.

:::warning 보안 트레이드오프
토큰을 **localStorage**에 두면 새로고침 후 세션 복원은 쉽지만 XSS에 노출된다(스크립트가 `localStorage`를 읽을 수 있음). HttpOnly 쿠키 대비 의도된 절충이며, 면접에서 약점으로 정직히 말할 수 있어야 한다.
:::

### 4.2 세션 복원 흐름

```text
새로고침 → AuthProvider 마운트 → getAccessToken() 있으면
        → GET /auth/me → 성공: setUser(me) / 실패: clearTokens()+setUser(null)
```

`AuthContext`가 들고 있는 전역 사용자 모델은 `MeUser { id, email, name, role, userType, emailVerified, plan, credit }` 하나다. 화면들은 이 컨텍스트를 구독해 로그인 여부와 권한을 읽는다.

### 4.3 로그인/회원가입 단일 폼 (`Login.tsx`)

하나의 컴포넌트가 `mode: "login" | "signup"` 토글로 두 흐름을 모두 처리한다. 검증은 제출 핸들러에서 순서대로 수행한다.

| 단계 | 검증/동작 |
| --- | --- |
| 공통 | 이메일·비밀번호 빈 값 차단 |
| 가입 | 이름 필수, 비밀번호 확인 일치, **필수 동의(이용약관·개인정보)** 체크 |
| 가입 | 이메일 `onBlur` 시 `checkEmailDuplicate`로 중복 사전 확인 → 즉시 빨간 경고 |
| 로그인 | 403 + 메시지에 "휴면" 포함 시 → 휴면 해제 메일 요청 링크 노출 |
| 에러 매핑 | 401/403/409를 사용자 친화 한국어 메시지로 변환(`toAuthErrorMessage`) |

소셜 로그인은 SPA 라우팅이 아니라 **전체 페이지 이동**이다:

```ts
// AuthContext.socialLogin
window.location.href = `/api/auth/oauth/${provider}`;  // google | kakao | naver
```

:::warning 정합성 관찰 — userType이 서버에 저장되지 않는다
가입 폼은 사용자 유형(취준생/이직자/경력자)을 UI로 받지만, `register` 액션이 서버로 보내는 payload는 `{ email, password, name, ...consents }`뿐이다. **`userType`은 전송되지 않아** 화면 선택과 DB 저장이 단절돼 있다. 알려진 미연결 지점이다.
:::

### 4.4 프로필: 동적 폼 + JSON 양면 호환 (`Profile.tsx`)

프로필은 영역 A에서 가장 복잡한 폼이다. 단일 `ProfileForm` 상태 객체에 스칼라·여러 줄 텍스트·**배열(학력/경력/경험)**·중첩 객체(희망 조건)가 섞여 있다.

폼 상태 ↔ 서버 모델 변환은 두 순수 함수가 책임진다.

```text
서버 응답(JSON 컬럼) ──toForm()──▶ ProfileForm(화면 상태) ──toRequest()──▶ 저장 요청(JSON)
```

- 배열 항목 추가/삭제: "추가" 버튼이 `[...prev.education, createEducation()]`, 삭제는 `removeAt`(마지막 1개는 빈 카드로 유지).
- 필드 갱신: `updateEducation(index, key, value)`처럼 인덱스+키로 불변 업데이트(`map`으로 새 배열 생성).
- **JSON 양면 호환 방어:** 기간 데이터가 레거시 `period`(문자열)일 수도, 신형 `startDate`/`endDate`일 수도 있다. `parseEntries`가 둘 다 흡수하고, 저장 시 `formatPeriod`로 다시 직렬화한다 → 자유형/레거시 데이터에 내성.

검증은 저장 직전 `validateProfile(form)` 한 함수에서: 희망 직무 필수, 직무·산업 80자 제한, 이력서 20,000자·자기소개 10,000자 제한, 기간 역전(종료월 &lt; 시작월) 차단.

AI 도구는 좌측 카드의 버튼 3개로 노출된다.

| 버튼 | 호출 | featureType |
| --- | --- | --- |
| 프로필 AI 요약 | `summarizeProfile()` | `PROFILE_SUMMARY` |
| 역량 키워드 추출 | `extractProfileSkills()` | `PROFILE_SKILL_EXTRACT` |
| 완성도 진단 | `diagnoseProfileCompleteness()` | `PROFILE_COMPLETENESS` |

`aiLoading` 상태가 켜지면 세 버튼이 모두 disabled 되고, 결과는 "AI 결과" 탭에 모델·상태·직무군 배지와 함께 표시된다. **AI 실행이 실패하면 "AI 데이터 동의 상태를 확인해 주세요"** 안내가 뜬다 — 동의가 AI 실행의 전제이기 때문(서버의 `AI_DATA` 게이트가 거부하면 화면이 이렇게 안내). 자세한 동의 게이트는 [동의 게이팅](/area-a/consent-gating) 참고.

:::warning 정합성 관찰 — 프로필 탭 딥링크 불일치
헤더는 `?tab=basic|resume|cover|career|skills|certificates`로 링크하지만, `Profile.tsx`는 `Tabs defaultValue="basic"`만 쓰고 `?tab` 쿼리를 읽지 않는다. 따라서 cover/career/certificates 딥링크는 항상 basic으로 진입한다(반면 `Settings`는 `?tab`을 정상 동기화).
:::

### 4.5 "AI가 추출했지만 사용자가 최종 결정한다"

AI 역량 추출 결과는 화면에 태그로 보여주되, **사용자의 직무 역량 입력란을 자동으로 덮어쓰지 않는다.** 스킬 칩은 사용자가 직접 토글(`toggleSkill`)해 자기 텍스트에 넣고 빼는 구조다. 즉 AI는 제안자, 최종 편집권은 사람에게 있다 — 영역 A의 "프로필 원본 수정 책임은 A(사용자)에게만"이라는 데이터 소유 원칙이 UI에서도 지켜진다.

### 4.6 설정: 4탭 + 동의 토글 + 기기 잠금 (`Settings.tsx`)

탭 상태는 URL 쿼리 `?tab=`(account|privacy|ai-consent|notifications)와 동기화된다(`useSearchParams`).

| 탭 | 내용 |
| --- | --- |
| 계정 | 이메일·이름·역할·플랜 readOnly 표시 + `AppLockSettings` + 로그아웃/전기기 로그아웃 |
| 개인정보 | TERMS/PRIVACY/MARKETING 토글 → `saveMyConsents` |
| AI 동의 | `AI_DATA` 토글 + **철회 버튼**(`revokeAiConsent`), 철회 시 AI 제한 안내 |
| 알림 | F 영역의 `NotificationSettings` 임베드(소유는 F, A는 자리만 빌림) |

**기기 잠금(`AppLockSettings`)** 은 서버·refresh_token과 완전히 독립한 클라이언트 측 2차 잠금이다. 4~6자리 PIN/생체 인증을 기기 로컬에 저장해 네이티브 앱(Capacitor) 진입을 한 번 더 막는다. PIN 검증도 `^\d{4,6}$` 정규식으로 화면에서 처리한다.

### 4.7 소셜 콜백: URL `#fragment` 토큰 후처리 (`AuthCallback.tsx`)

백엔드 OAuth 성공 핸들러는 토큰을 URL **해시 프래그먼트**에 담아 프런트로 보낸다. 콜백 화면이 이를 파싱한다.

```text
#accessToken=...&refreshToken=...
  → setTokens() → refreshMe() → getMyConsents()
  → 필수동의 누락? social-consent : dashboard
```

:::warning 보안 관찰 포인트
토큰을 URL `#fragment`로 전달하면 쿼리스트링과 달리 서버 로그·Referer에는 안 남지만, 브라우저 히스토리·확장 프로그램에는 노출될 수 있다. 면접에서 "왜 fragment인가, 한계는 무엇인가"를 설명할 수 있어야 한다.
:::

---

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

**구현 완료:**
- 로그인/회원가입 단일 폼, 소셜 3종 버튼(google/kakao/naver) 진입.
- 이메일 중복 `onBlur` 사전 확인, 휴면 계정 해제 링크 노출.
- 401 자동 토큰 갱신(단일 프라미스 공유), 세션 복원(`/auth/me`).
- 프로필 동적 폼(배열 추가/삭제), JSON 양면 호환, 저장 전 수동 검증.
- AI 도구 3버튼(요약/역량추출/완성도진단)과 결과·완성도 카드.
- 설정 4탭, 동의 저장/철회, 기기 PIN/생체 잠금.
- 인증 보조 화면: ForgotPassword/ResetPassword/AuthCallback/SocialConsent/VerifyEmailResult/ReleaseDormant.
- Mock 모드(백엔드 없이 데모): 페르소나 기반 `/profile`·`/profile/ai/*`·`/consents/*` 시연.

**미구현 / 미연결 (구현됨으로 말하면 사실 오류):**
- 가입 폼 `userType` 서버 저장 — UI는 받지만 register payload에 미포함.
- 프로필 탭 `?tab` 딥링크 — 헤더 링크와 `Profile.tsx` 탭이 미동기화(cover/career/certificates 미작동).
- 표준 `features/{auth,profile,settings}` 폴더 — 빈 스캐폴딩(실제 화면은 `app/`).
- 클라이언트 라우트 가드(`ProtectedRoute`) — 없음(서버 401에 의존).

**라이브러리 사용 정정:** React Hook Form/Formik 등 폼 라이브러리는 **사용하지 않는다.** 제어 컴포넌트 + `useState` + 수동 검증 함수가 전부다.

---

## 6. 면접 답변 3단계

**1단계 (한 줄):**
"영역 A 프론트엔드는 인증·프로필·설정 세 화면 묶음이고, 폼 라이브러리 없이 `useState`로 제어하며, 토큰은 localStorage에 두고 401 자동 갱신으로 세션을 유지합니다."

**2단계 (구조):**
"인증 상태는 `AuthContext`가 전역으로 들고, 모든 API는 `app/lib/api.ts` 래퍼를 통해 나갑니다. 이 래퍼가 envelope를 풀고, 401이 오면 `refreshPromise` 하나를 공유해 refresh를 딱 한 번 시도한 뒤 재시도합니다. 프로필 폼은 배열·중첩 객체가 섞여 있어 `toForm`/`toRequest` 두 순수 함수로 서버 JSON과 화면 상태를 변환하고, 검증은 저장 직전 `validateProfile` 한 곳에서 처리합니다."

**3단계 (트레이드오프·결함 인지):**
"클라이언트 라우트 가드를 두지 않아 인증 권위를 서버로 단일화했는데, 대신 비로그인 진입 시 깜빡임이 있습니다. localStorage 토큰은 새로고침 복원이 쉽지만 XSS에 노출됩니다. 그리고 가입 폼 `userType`이 서버로 안 가는 미연결과 프로필 탭 딥링크 불일치는 알고 있는 부채입니다."

---

## 7. 꼬리질문 + 모범답안

:::details Q1. React Hook Form을 안 쓰고 `useState`로 폼을 만든 이유는?
화면 수가 적고, 프로필처럼 배열·중첩 객체가 섞인 폼은 라이브러리 스키마보다 **명시적 변환 함수(`toForm`/`toRequest`)가 데이터 모델(JSON 컬럼)과 1:1로 대응**돼 읽기 쉽습니다. 대신 필드별 핸들러 보일러플레이트가 늘고 필드 단위 즉시 검증이 약한 게 비용입니다. 폼이 더 복잡해지면 RHF 도입을 고려할 수 있습니다.
:::

:::details Q2. 토큰이 만료되면 화면에서 어떤 일이 일어나나요?
요청이 401을 받으면 `api.ts`가 refresh 토큰으로 `/auth/refresh`를 **한 번** 호출합니다. 동시에 여러 요청이 401을 받아도 `refreshPromise` 하나를 공유해 갱신은 한 번만 일어납니다. 갱신 성공이면 원요청을 새 토큰으로 재시도, 실패면 토큰을 비우고 이후 호출이 401로 에러 박스에 표면화됩니다.
:::

:::details Q3. 클라이언트에 라우트 가드가 없는데 보안에 문제 없나요?
보호의 실제 권위는 서버입니다. 클라이언트 가드는 UX(미리 리다이렉트)일 뿐이고, 가드를 우회해도 API가 401/403으로 막습니다. 클라이언트가 같은 권한 판단을 복제하면 서버와 어긋날 위험이 생겨, 의도적으로 서버를 단일 권위로 뒀습니다. 비용은 비로그인 진입 시의 깜빡임입니다.
:::

:::details Q4. 프로필에서 학력·경력을 여러 개 추가하는 동적 폼은 어떻게 처리했나요?
각 섹션을 배열 상태(`education[]` 등)로 두고, "추가"는 `createEducation()` 빈 항목을 spread로 덧붙이며, 수정은 `updateList(items, index, key, value)`가 `map`으로 불변 갱신합니다. 삭제는 `removeAt`이 해당 인덱스를 빼되 마지막 1개는 빈 카드로 유지해 폼이 비지 않게 합니다.
:::

:::details Q5. AI가 추출한 역량을 사용자 입력란에 자동 반영하지 않은 이유는?
영역 A의 원칙이 "프로필 원본 수정 책임은 사용자에게만"이라서입니다. AI 추출은 제안으로 태그로 보여주고, 실제 반영은 사용자가 스킬 칩을 직접 토글해야 합니다. AI를 신뢰하되 최종 편집권은 사람에게 남겨, 잘못된 추출이 원본을 오염시키지 않게 합니다.
:::

:::details Q6. Mock 모드는 왜 있고 어떻게 동작하나요?
백엔드 없이 데모/APK를 시연하기 위해서입니다. `VITE_USE_MOCK==="true"`면 `api.ts`가 네트워크 대신 mock 레지스트리로 응답하고, 등록 안 된 엔드포인트는 501(`DEMO_UNAVAILABLE`)을 던집니다. 페르소나 데이터로 프로필·AI·동의 흐름까지 보여줄 수 있어, 동의 철회 시 AI가 제한되는 연동도 백엔드 없이 시연됩니다.
:::

---

## 8. 직접 말해보기

다음을 막힘없이 소리 내어 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 로그인부터 대시보드 진입까지의 흐름을, 토큰 저장 위치와 401 처리를 포함해 설명해 보라.
2. 프로필 폼에서 학력 항목을 추가/삭제하고 저장할 때 상태가 어떻게 변하고 서버로 어떤 형태가 가는지 말해 보라.
3. 이 화면들의 알려진 부채 3가지(userType 미전송, 탭 딥링크 불일치, 빈 features 폴더)를 면접관에게 정직하게 설명해 보라.

---

## 퀴즈

<QuizBox question="영역 A의 로그인/프로필/설정 화면이 폼을 처리하는 방식으로 옳은 것은?" :choices="['React Hook Form 스키마 검증', 'Formik + Yup', 'useState 제어 컴포넌트 + 제출 시 수동 검증 함수', 'Redux Form']" :answer="2" explanation="영역 A 화면은 폼 라이브러리를 쓰지 않는다. 제어 컴포넌트 + useState로 상태를 들고, 검증은 validateProfile 같은 순수 함수를 제출 직전에 호출한다." />

<QuizBox question="api.ts가 401 응답을 받았을 때 동시에 여러 요청이 실패해도 토큰 갱신이 한 번만 일어나도록 보장하는 장치는?" :choices="['요청 큐(queue)', '단일 공유 refreshPromise', 'localStorage 락', 'AbortController']" :answer="1" explanation="refreshPromise 하나를 공유해 동시 401에서도 /auth/refresh 호출은 단 한 번만 실행되고, 나머지는 그 결과를 기다린다." />

<QuizBox question="회원가입 폼에서 화면에는 입력받지만 실제로 서버 register payload에 전달되지 않는(미연결) 값은?" :choices="['이메일', '비밀번호', 'userType(사용자 유형)', '이용약관 동의']" :answer="2" explanation="register 액션은 email/password/name/consents만 전송한다. userType은 UI로 받지만 payload에 포함되지 않아 DB 저장과 단절돼 있다(알려진 부채)." />

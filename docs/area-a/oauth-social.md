# OAuth2 소셜 로그인

> Kakao / Naver / Google 인가코드 흐름을 Spring Security `oauth2Login` 없이 **수동 REST**로 구현하고, 쿠키·세션 없이 **서명된 state JWT(5분)**로 CSRF를 막은 뒤, `user_social` 매핑으로 같은 사람을 한 계정에 모은다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

CareerTuner의 소셜 로그인은 표준 OAuth2 **authorization-code grant**를 직접 코드로 풀어 쓴 것이다. 프런트가 `/api/auth/oauth/{provider}`로 전체 페이지를 이동시키면, 백엔드가 제공자 인가 URL을 만들어 리다이렉트하고, 콜백에서 인가코드를 토큰으로 교환한 뒤 사용자 정보를 조회해 우리 계정(`users`)과 매핑(`user_social`)하고, 우리 서비스의 access/refresh 토큰을 발급한다.

이 페이지로 답할 수 있어야 하는 질문들:

- "소셜 로그인을 Spring Security `oauth2Login`으로 안 하고 왜 직접 짰나?"
- "OAuth에서 CSRF는 어떻게 막았나? 쿠키 없이 state를 어떻게 검증하나?"
- "카카오로 처음 들어온 사람과, 이미 같은 이메일로 가입한 사람을 어떻게 구분해서 연결하나?"
- "제공자가 이메일을 안 주면 계정 식별을 어떻게 하나?"
- "이 흐름에서 보안상 약한 지점이 어디인가?"

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 왜 `oauth2Login`을 안 쓰고 수동 REST인가

이 영역의 인증은 전체가 **무상태(STATELESS)** 설계다. Access는 JWT, refresh는 DB opaque UUID, 세션 저장소가 없다. Spring Security의 `oauth2Login`은 인가 흐름 중간 상태(특히 state·nonce)를 **서버 세션(`HttpSession`)에 저장**하는 것을 전제로 동작한다. 무상태 정책과 충돌하고, 우리 토큰 발급 파이프라인(`issueTokens`, refresh 회전, 로그인 히스토리 기록)과도 어긋난다.

그래서 `SocialOAuthService`가 인가 URL 생성 → 토큰 교환 → 사용자 정보 조회를 **`RestClient`로 직접** 수행한다. 대가로 제공자별 분기 코드(엔드포인트 URL, 응답 JSON 구조)를 우리가 떠안지만, 인증 흐름 전체가 한 곳에서 무상태로 통제된다.

:::tip 핵심 경계 메시지
"무상태 인증을 일관되게 유지하려고 소셜 로그인도 세션 의존 `oauth2Login` 대신 수동 REST로 짰고, 세션이 없으니 CSRF state도 서버에 저장하는 대신 **서명된 JWT 한 개로 자기검증**하게 만들었다." — 이 한 문장이 설계 의도 전체를 요약한다.
:::

### 트레이드오프 요약

| 결정 | 얻은 것 | 내준 것 |
| --- | --- | --- |
| 수동 REST (`oauth2Login` 미사용) | 무상태 일관성, 토큰 파이프라인 통합 | 제공자별 분기 코드 직접 유지 |
| state를 서명 JWT로 (세션 미사용) | 서버 저장소 0, 수평 확장 친화 | state 단건 폐기(one-time) 불가 — 5분 내 재사용 이론상 가능 |
| 토큰을 URL `#fragment`로 전달 | 프런트가 SPA에서 바로 수신 | 브라우저 히스토리/리퍼러 노출 가능성 (관찰 포인트) |
| 이메일 기준 자동 계정 연결 | 같은 사람 = 한 계정, 중복가입 방지 | 제공자가 미검증 이메일을 주면 계정 탈취 위험 (신뢰 가정) |

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

```text
AuthController        /api/auth/oauth/{provider}, .../callback  (REST 진입점, 리다이렉트)
  └─ AuthServiceImpl  buildAuthorizationUrl / handleOAuthCallback / findOrCreateSocialUser
        ├─ JwtTokenProvider     createOauthState / validateOauthState   (state JWT)
        ├─ SocialOAuthService   getAuthorizationUrl / fetchUserInfo      (제공자 REST)
        └─ AuthMapper           findSocial / insertSocial → user_social
```

핵심 클래스/메서드:

- **`AuthController`** — `GET /api/auth/oauth/{provider}`(인가 리다이렉트)와 `GET /api/auth/oauth/{provider}/callback`(콜백) 두 엔드포인트. 둘 다 HTTP 302 리다이렉트를 반환한다.
- **`SocialOAuthService`** — 제공자별 authorize URL 생성, 인가코드 → 토큰 교환, 사용자 정보 조회. 지원 제공자는 `KAKAO` / `NAVER` / `GOOGLE` 세 개(`isSupported`).
- **`AuthServiceImpl.handleOAuthCallback`** — state 검증 → 사용자 정보 조회 → 계정 매핑 → 상태 검증 → 토큰 발급.
- **`JwtTokenProvider`** — `createOauthState(provider)` / `validateOauthState(state, provider)`. state도 JWT 서명 키를 공유한다.
- **`SocialUserInfo`** — `record SocialUserInfo(String provider, String providerUserId, String email, String name)`. 제공자 응답을 우리 도메인 형태로 정규화한 값.
- **`user_social` 테이블** — `(provider, provider_user_id)` UNIQUE, `user_id`로 `users` 1:N. VO는 `UserSocial`(provider, providerUserId, linkedAt).

제공자별 실제 엔드포인트(코드에 하드코딩):

| 제공자 | authorize | token 교환 | userinfo |
| --- | --- | --- | --- |
| KAKAO | `kauth.kakao.com/oauth/authorize` | `kauth.kakao.com/oauth/token` | `kapi.kakao.com/v2/user/me` |
| NAVER | `nid.naver.com/oauth2.0/authorize` | `nid.naver.com/oauth2.0/token` | `openapi.naver.com/v1/nid/me` |
| GOOGLE | `accounts.google.com/o/oauth2/v2/auth` | `oauth2.googleapis.com/token` | `googleapis.com/oauth2/v2/userinfo` |

제공자별 미세 차이(면접에서 자주 파고드는 지점):

- **GOOGLE만** authorize에 `scope=openid email profile`을 붙인다. 카카오/네이버는 콘솔에서 동의 항목을 설정하므로 URL에 scope를 싣지 않는다.
- **NAVER만** 토큰 교환 요청에 `state`를 다시 실어 보낸다(네이버 규격). 카카오/구글은 교환 시 state를 요구하지 않는다.
- 응답 파싱 위치가 전부 다르다: 카카오는 `kakao_account.email` / `kakao_account.profile.nickname`, 네이버는 `response.{id,email,name}`(없으면 `nickname`), 구글은 평면 `{id,email,name}`.

## 4. 동작 원리 (전체 흐름)

### 4-1. 두 번의 리다이렉트로 끝나는 흐름

```text
[프런트]  window.location.href = /api/auth/oauth/google      ← SPA 라우팅이 아니라 전체 페이지 이동
   │
[백엔드]  GET /oauth/{provider}
   │   buildAuthorizationUrl: state JWT 생성 → 제공자 authorize URL 302
   ▼
[제공자]  사용자 동의/로그인 → redirect_uri 로 ?code=...&state=... 콜백
   │
[백엔드]  GET /oauth/{provider}/callback
   │   ① validateOauthState(state, provider)   서명·만료·provider 일치 검증
   │   ② exchangeToken(code) → access_token     (토큰 교환)
   │   ③ fetchUserInfo → SocialUserInfo          (사용자 정보)
   │   ④ findOrCreateSocialUser                  (계정 매핑/생성)
   │   ⑤ 상태 검증 + issueTokens                 (우리 토큰 발급)
   ▼
[백엔드]  302 → /auth/callback#accessToken=...&refreshToken=...&expiresIn=...
   │
[프런트]  AuthCallback: hash 파싱 → 토큰 저장 → refreshMe → 동의 미완료면 /auth/social-consent
```

프런트의 시작점은 SPA 라우팅이 아니라 `window.location.href = /api/auth/oauth/{provider}`로의 **전체 페이지 이동**이다(`AuthContext.socialLogin`). 제공자 인증을 거치려면 외부 도메인으로 나갔다 와야 하므로 SPA 내비게이션으로는 처리할 수 없기 때문이다.

### 4-2. state 토큰으로 CSRF 막기 (세션 없이)

OAuth에서 state는 "내가 시작한 인가 요청이 맞다"를 콜백에서 증명하는 CSRF 방지 값이다. 보통 서버 세션에 무작위값을 저장했다가 콜백에서 비교하지만, 우리는 세션이 없다. 대신 **서명된 JWT 자체가 증거**다.

```java
// JwtTokenProvider — 발급(콜백 검증용 5분짜리 state)
Jwts.builder()
    .subject(provider)                  // KAKAO/NAVER/GOOGLE
    .id(UUID.randomUUID().toString())   // jti
    .claim("type", "oauth_state")
    .expiration(now + 300초)            // 5분
    .signWith(key).compact();

// 검증: 서명 OK + type=="oauth_state" + subject==provider
"oauth_state".equals(c.get("type")) && provider.equals(c.getSubject());
```

검증 포인트가 세 가지다: **서명 위조 불가**(우리 키로 서명), **5분 만료**(재생공격 창 축소), **provider 일치**(카카오 state를 구글 콜백에 못 쓴다). 위조·만료·불일치 state는 `validateOauthState`가 `false`를 반환하고, 콜백은 `UNAUTHORIZED("잘못된 OAuth state입니다.")`로 끊는다.

:::warning state는 일회용이 아니다 — 정직한 한계
state JWT는 서버에 저장하지 않으므로 **사용했다고 폐기(blacklist)할 수단이 없다.** 5분 안이라면 같은 state JWT가 이론상 재사용될 수 있다. 만료 시간을 짧게(5분) 두어 위험 창을 줄이는 방식이며, 진짜 일회성(nonce 폐기)까지는 구현돼 있지 않다. 면접에서 물으면 이 한계를 인정하고 "단건 폐기를 하려면 jti를 단기 저장소에 기록해야 한다"까지 말하면 좋다.
:::

### 4-3. 계정 매핑: findOrCreateSocialUser 3단계

콜백에서 받은 `SocialUserInfo(provider, providerUserId, email, name)`로 우리 계정을 찾거나 만든다. 우선순위는 **이미 연동됨 → 같은 이메일 자동 연결 → 신규 생성**이다.

| 단계 | 조건 | 처리 |
| --- | --- | --- |
| ① 이미 연동 | `findSocial(provider, providerUserId)` 존재 | 그 `user_id`의 계정 그대로 사용 |
| ② 이메일 자동 연결 | 제공자가 이메일 제공 + 같은 이메일 계정 존재 | 그 계정에 `user_social` 행만 추가(단, **DELETED 계정이면 차단**) |
| ③ 신규 생성 | 위 둘 다 아님 | `users` insert + `user_social` insert |

신규 계정의 기본값은 일반 가입과 다르다: `password=null`, `passwordEnabled=false`(소셜 전용), `emailVerified=true`(제공자가 검증했다고 신뢰), `userType=JOB_SEEKER`, `role=USER`, `status=ACTIVE`, `plan=FREE`, `credit=0`.

**제공자가 이메일을 안 줄 때**(카카오는 이메일 동의가 선택이라 흔함)가 핵심 디테일이다. 이메일이 없으면 식별·연결 기준이 사라지므로 **합성 이메일**을 만든다:

```text
{provider}_{providerUserId}@social.careertuner            ← 기본 합성값
{provider}_{providerUserId}_{timestamp}@social.careertuner ← 만약 충돌하면 타임스탬프 추가
```

이렇게 하면 이메일이 없는 소셜 사용자도 우리 시스템에서 유일한 식별자를 갖고, 둘째 줄의 타임스탬프 분기로 `users.email` UNIQUE 충돌까지 회피한다.

### 4-4. 매핑 후 상태 검증과 토큰 발급

계정을 찾았다고 끝이 아니다. 일반 로그인과 동일하게 **상태 검증이 비밀번호(여기선 토큰 교환)보다 뒤가 아니라, 발급 직전 게이트**로 들어간다.

1. `releaseExpiredBlockIfNeeded` — 잠금 만료된 BLOCKED면 자동 해제.
2. `validateSocialLoginAllowed` — DELETED / BLOCKED / DORMANT면 `FORBIDDEN`. 즉, 카카오 인증에 성공해도 **차단·휴면·삭제 계정엔 토큰을 내주지 않는다.**
3. 성공 시에만 `user_login_history`에 `authProvider=KAKAO/NAVER/GOOGLE`, `loginMethod=OAUTH`로 기록하고 `issueTokens`로 access(JWT) + refresh(DB UUID)를 발급한다.

실패하면 콜백 컨트롤러가 예외를 잡아 `/auth/callback#error=social_login_failed`로 리다이렉트하고, 프런트는 에러 메시지를 띄운다. (관련 무상태 토큰 구조는 [인증과 JWT 토큰](/area-a/auth-jwt) 참고.)

## 5. 구현 상태 (됨 vs 계획 — 정직 구분)

**구현 완료:**

- KAKAO / NAVER / GOOGLE 세 제공자 authorization-code 흐름 전체(인가 리다이렉트 → 토큰 교환 → 사용자 정보 → 매핑 → 토큰 발급).
- 서명 state JWT 기반 CSRF 방지(5분, provider 바인딩).
- `user_social` 매핑, 이메일 기준 자동 계정 연결, 이메일 미제공 시 합성 이메일.
- 소셜 신규 가입 후 동의 미완료 시 `/auth/social-consent`로 유도(필수 약관 사후 수집).
- 차단/휴면/삭제 계정의 소셜 로그인 차단.

**미구현 / 없음 (구현됐다고 말하면 사실 오류):**

- **소셜 연동 해제(unlink)** — `user_social` 행을 지우는 `deleteSocial`/unlink 경로가 코드 어디에도 없다. 한 번 연결되면 코드상 끊는 API가 없다. ("매핑/해제"를 묻는 질문에 정직하게 답해야 하는 지점.)
- **소셜 재연동 토큰 갱신/제공자 토큰 보관** — 제공자 access_token은 사용자 정보 조회에만 쓰고 저장하지 않는다(우리 토큰만 발급·관리).
- **관리자 화면의 소셜 계정 가시화** — `AdminUserDetail`은 로그인 히스토리·상태 이력·동의·이메일 인증·refresh 토큰·AI 사용·프로필을 모으지만, **연동된 `user_social` 목록은 노출하지 않는다.** 로그인 히스토리의 `authProvider`로 간접 확인만 가능.

**보안 관찰 포인트(결함성 트레이드오프):**

- 콜백이 access/refresh 토큰을 URL `#fragment`로 프런트에 넘긴다(히스토리/리퍼러 노출 가능).
- 자동 계정 연결이 제공자 이메일을 신뢰한다 — 미검증 이메일을 주는 제공자라면 계정 탈취 벡터가 된다.
- state JWT가 일회성 폐기 불가(4-2 경고 참고).

## 6. 면접 답변 3단계

**1단계 (한 줄):** "소셜 로그인은 Spring Security `oauth2Login` 대신 authorization-code 흐름을 `RestClient`로 직접 구현했고, 세션이 없어서 CSRF state는 서명된 5분짜리 JWT로 자기검증하게 만들었습니다."

**2단계 (흐름):** "프런트가 `/api/auth/oauth/{provider}`로 전체 페이지를 이동시키면 백엔드가 state JWT를 만들어 제공자 인가 URL로 보냅니다. 콜백에서 state를 검증하고 인가코드를 토큰으로 교환해 사용자 정보를 받은 뒤, `user_social`로 기존 연동을 찾거나 같은 이메일 계정에 자동 연결하거나 신규 생성합니다. 마지막에 우리 access/refresh 토큰을 발급해 URL fragment로 돌려줍니다."

**3단계 (트레이드오프·한계):** "무상태를 지키려고 세션 대신 서명 JWT를 썼는데, 그 대가로 state를 단건 폐기할 수 없어 5분 만료로 위험 창을 줄였습니다. 또 토큰을 fragment로 넘기고 이메일 기반 자동 연결이 제공자 이메일을 신뢰한다는 점, 그리고 현재 연동 해제 API가 없다는 점이 알려진 한계입니다."

## 7. 꼬리질문과 모범답안

:::details Q1. state를 그냥 랜덤 문자열로 쓰고 세션에 저장하지 않고 JWT로 만든 이유는?
세션이 없는 무상태 서버이기 때문입니다. 랜덤 문자열을 검증하려면 어딘가 저장해 둬야 하는데, 그 저장소를 두면 무상태 정책이 깨지고 수평 확장도 어려워집니다. JWT는 서명 자체가 "내가 발급했다"는 증거라 별도 저장 없이 검증됩니다. 대신 발급한 state를 사용 후 폐기할 수 없다는 한계가 생겨, 만료를 5분으로 짧게 잡았습니다.
:::

:::details Q2. state JWT에 provider를 subject로 박은 이유는? 없으면 무슨 문제가 생기나?
검증 시 `subject == 콜백의 provider`를 비교해 **제공자 교차 사용**을 막기 위해서입니다. 만약 provider 바인딩이 없으면, 공격자가 카카오용으로 발급된 정상 state를 구글 콜백에 끼워 넣는 식의 혼선이 가능해집니다. subject 바인딩으로 "이 state는 이 제공자 흐름 전용"임을 강제합니다.
:::

:::details Q3. 카카오가 이메일을 안 주면 어떻게 식별하나? 같은 사람이 두 번 들어오면 중복 계정이 생기지 않나?
이메일이 없으면 `{provider}_{providerUserId}@social.careertuner` 형태의 합성 이메일로 계정을 만듭니다. 같은 사람이 다시 들어오면 `findSocial(provider, providerUserId)`가 먼저 매칭되므로 같은 계정으로 로그인됩니다. 즉 식별의 진짜 기준은 이메일이 아니라 `(provider, provider_user_id)` UNIQUE 쌍이고, 이메일은 보조 연결 키입니다.
:::

:::details Q4. 이메일 기반 자동 연결은 보안상 위험하지 않나?
위험할 수 있습니다. 제공자가 **미검증 이메일**을 내려주는데 우리가 그걸 믿고 기존 계정에 붙이면, 공격자가 피해자 이메일로 소셜 계정을 만들어 계정을 탈취할 수 있습니다. 우리 구현은 제공자가 이메일을 검증했다고 신뢰하는 전제이고, 삭제 계정으로의 연결만 차단합니다. 더 엄격히 하려면 제공자의 `email_verified` 플래그를 확인하거나, 자동 연결 대신 기존 비밀번호 확인을 요구하는 방식이 안전합니다.
:::

:::details Q5. 콜백에서 토큰을 URL fragment로 넘기는 게 왜 관찰 포인트인가?
`#fragment`는 서버로 전송되지는 않지만 브라우저 히스토리에 남고, 잘못 짠 페이지에서는 리퍼러나 로깅을 통해 새어 나갈 수 있습니다. 더 안전한 방식은 짧은 수명의 일회용 교환 코드를 fragment로 주고 프런트가 그것을 다시 토큰으로 교환하거나, HttpOnly 쿠키로 내려주는 것입니다. 현재 구현은 SPA가 토큰을 바로 받아 localStorage에 저장하는 단순함을 택한 트레이드오프입니다.
:::

:::details Q6. 소셜 계정을 한 번 연결하면 해제할 수 있나?
현재 코드에는 연동 해제(unlink) API가 없습니다. `AuthMapper`에 `findSocial`/`insertSocial`은 있지만 `deleteSocial`이 없어, `user_social` 행을 지우는 경로가 구현돼 있지 않습니다. 따라서 "매핑은 되지만 해제는 미구현"이 정확한 답이고, 추가하려면 매퍼에 삭제 쿼리와 컨트롤러 엔드포인트, 그리고 "마지막 로그인 수단을 지우면 계정 접근 불가"가 되지 않도록 비밀번호 미설정(`passwordEnabled=false`) 계정의 마지막 소셜 해제를 막는 검증이 필요합니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명할 수 있으면 이 페이지를 이해한 것이다.

- 프런트의 `window.location.href` 이동부터 토큰 발급까지의 **두 번의 리다이렉트** 흐름을 순서대로.
- state JWT가 검증하는 **세 가지**(서명·만료·provider 일치)와, 일회용이 아니라는 한계.
- `findOrCreateSocialUser`의 **3단계 우선순위**(연동됨 → 이메일 자동 연결 → 신규)와 이메일 미제공 시 합성 이메일 규칙.
- KAKAO/NAVER/GOOGLE의 **제공자별 미세 차이**(GOOGLE scope, NAVER 교환 시 state, 응답 JSON 경로).
- 이 흐름의 **보안 관찰 포인트 3개**(fragment 토큰, 이메일 신뢰, state 폐기 불가).

## 퀴즈

<QuizBox question="CareerTuner가 소셜 로그인에서 OAuth state를 세션이 아니라 서명된 JWT로 만든 가장 큰 이유는?" :choices="['JWT가 랜덤 문자열보다 짧아서', '인증 전체가 무상태(STATELESS) 설계라 서버 저장소를 두지 않기 위해', '제공자가 JWT 형식 state를 요구해서', '쿠키를 쓰면 모바일 앱에서 동작하지 않아서']" :answer="1" explanation="세션이 없는 무상태 서버이기 때문에 state를 저장할 곳이 없다. 서명 JWT는 서명 자체가 발급 증거라 별도 저장 없이 검증되며, 대가로 단건 폐기가 불가능해 5분 만료로 위험 창을 줄인다." />

<QuizBox question="제공자가 이메일을 주지 않은 소셜 사용자가 처음 로그인할 때, 우리 시스템에서 그 사용자를 유일하게 식별하는 기준은?" :choices="['users.email 컬럼 값', 'user_social의 (provider, provider_user_id) UNIQUE 쌍', '제공자 access_token', 'refresh_token의 UUID']" :answer="1" explanation="이메일이 없으면 합성 이메일을 만들지만, 같은 사람을 다시 알아보는 진짜 기준은 findSocial이 조회하는 (provider, provider_user_id) UNIQUE 쌍이다. 이메일은 보조 연결 키일 뿐이다." />

<QuizBox question="다음 중 현재 코드에 구현되어 있지 않은 것은?" :choices="['카카오/네이버/구글 인가코드 토큰 교환', '이메일이 같으면 기존 계정에 자동 연결', '소셜 연동 해제(unlink) API', '차단/휴면 계정의 소셜 로그인 차단']" :answer="2" explanation="AuthMapper에는 findSocial과 insertSocial만 있고 deleteSocial이 없어 user_social 행을 제거하는 연동 해제 경로가 구현돼 있지 않다. 나머지 셋은 모두 구현되어 있다." />

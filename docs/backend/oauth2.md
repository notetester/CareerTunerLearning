# OAuth2 소셜 로그인

> 사용자가 비밀번호를 우리한테 안 주고도, 카카오/네이버/구글이 대신 "이 사람 맞다"고 보증해주는 표준 로그인 방식이다. 핵심은 인가코드 흐름과 state 토큰으로 CSRF를 막는 것.

## 1. 한 줄 정의

OAuth2는 **사용자의 비밀번호를 우리 서버에 직접 넘기지 않고**, 제3자 인증 제공자(카카오 등)가 발급한 토큰으로 그 사용자의 신원·일부 정보(이메일, 닉네임)에 접근하게 해주는 **위임 인가(authorization) 표준**이다.

CareerTuner는 그중에서도 서버용 앱에 가장 안전한 **Authorization Code Grant(인가코드 흐름)** 를 쓴다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| OAuth | **O**pen **Auth**orization. "인증(누구냐)"이 아니라 "**인가**(무엇을 할 수 있게 허용)"가 핵심 |
| Authorization Code | 제공자가 콜백으로 던져주는 **1회용 단기 임시 코드**. 이것만으로는 아무것도 못 함 |
| Access Token | 인가코드를 백엔드가 뒤에서 교환해 받는 **실제 접근 토큰**. 사용자 정보 조회에 사용 |
| Redirect URI | 인증 후 제공자가 사용자를 되돌려 보낼 **사전 등록된 콜백 주소** |
| Scope | 요청하는 권한 범위. 구글의 경우 `openid email profile` |
| state | CSRF 방지용 **위변조 불가 난수/서명값**. 보낼 때 만들고 돌아올 때 검증 |

:::tip 인증 vs 인가
OAuth2 자체는 "인가" 프로토콜이다. "이 사람이 누구인지(인증)"까지 표준화한 게 그 위에 얹은 **OpenID Connect(OIDC)** 이고, 구글 scope의 `openid`가 바로 그 신호다. 면접에서 "OAuth는 인증이 아니라 인가"라고 짚으면 정확하다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **비밀번호를 안 받아도 된다.** 사용자의 카카오 비밀번호가 우리 DB를 거치지 않으니, 유출돼도 우리 책임 범위 밖이고 사용자 신뢰가 올라간다.
- **가입 마찰 감소.** 이메일 인증·비밀번호 설정 단계를 건너뛰고 클릭 한 번으로 가입/로그인.
- **직접 구현의 위험 회피.** 비밀번호 저장·해싱·재설정·유출대응을 제공자에게 위임.
- **없으면?** 모든 사용자에게 별도 비밀번호를 받아야 하고, 그 자체가 공격 표면이자 운영 부담이 된다. 또 state 같은 방어 없이 콜백을 처리하면 **CSRF로 남의 계정에 내 소셜이 묶이는** 사고가 난다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역: **백엔드 인증**(공통/팀 합의 영역). 본인 영역(C)은 아니지만 인증 흐름 이해는 면접 단골이라 정리한다.

| 역할 | 클래스 / 파일 | 메모 |
| --- | --- | --- |
| 진입·콜백 엔드포인트 | `auth/controller/AuthController` | `GET /api/auth/oauth/{provider}`, `GET /api/auth/oauth/{provider}/callback` |
| 흐름 오케스트레이션 | `auth/service/AuthServiceImpl` | `buildAuthorizationUrl`, `handleOAuthCallback`, `findOrCreateSocialUser` |
| 제공자별 REST 처리 | `auth/service/SocialOAuthService` | authorize URL 생성, 토큰 교환, 사용자정보 조회 |
| state 토큰 발급/검증 | `common/security/JwtTokenProvider` | `createOauthState`(5분), `validateOauthState` |
| 제공자 설정 | `common/config/CareerTunerProperties` (`Oauth.Provider`) | `clientId`/`clientSecret`/`redirectUri`, `isConfigured()` |
| 소셜 연동 저장 | 테이블 `user_social` (`auth/domain/UserSocial`) | `provider`, `provider_user_id`, `user_id` |
| 토큰 발급 | `AuthServiceImpl.issueTokens` → `refresh_token` 테이블 | 로그인 성공 후 우리 자체 JWT 발급 |

:::warning 우리는 Spring Security `oauth2Login`을 안 쓴다
CareerTuner는 `SocialOAuthService`에서 `RestClient`로 **인가코드 흐름을 직접(수동)** 구현했다. 프레임워크 자동 흐름 대신 매뉴얼 REST로 제어권을 가져간 형태다. "왜 직접 했나?"는 단골 꼬리질문이니 7번 참고.
:::

지원 제공자: **카카오 / 네이버 / 구글** 3종. 클라이언트 ID·시크릿은 코드에 없고 환경변수로 주입되며(`KAKAO_CLIENT_ID` 같은 자리표시자), 미설정 시 `isConfigured()`가 `false`라 `INTERNAL_ERROR`로 막는다.

## 5. 핵심 동작 원리 (단계)

```text
[브라우저]                [우리 백엔드]                 [카카오/네이버/구글]
   │ 1. /api/auth/oauth/KAKAO 클릭
   │ ───────────────────────►│
   │                         │ 2. state 토큰 생성(JWT,5분)
   │                         │    authorize URL 조립
   │ ◄─── 302 redirect ──────│
   │ 3. 제공자 로그인+동의 ─────────────────────────────►│
   │ ◄──── 302: ...callback?code=AUTH_CODE&state=...────│
   │ 4. /callback?code=...&state=...
   │ ───────────────────────►│
   │                         │ 5. validateOauthState(state) ── CSRF 방어
   │                         │ 6. code → access_token 교환 ───►│  (서버끼리, 뒤에서)
   │                         │ ◄──────── access_token ─────────│
   │                         │ 7. access_token으로 사용자정보 ─►│
   │                         │ ◄──────── id/email/name ────────│
   │                         │ 8. user_social 조회→find-or-create
   │                         │ 9. 우리 JWT(access)+refresh 발급
   │ ◄── 302 /auth/callback#accessToken=...&refreshToken=...
```

핵심 포인트 4가지:

1. **인가코드와 토큰 교환을 분리** — 브라우저(앞단)에는 단기 1회용 `code`만 노출되고, 진짜 `access_token`은 **백엔드끼리(back-channel)** 교환한다. 그래서 `client_secret`이 브라우저에 안 새어 나간다.
2. **state로 CSRF 방어** — `createOauthState(provider)`가 서명된 JWT(`type=oauth_state`, subject=provider, 만료 5분)를 만들고, 콜백에서 `validateOauthState`로 **서명·타입·provider 일치**를 확인. 쿠키/세션 없이(stateless) 위변조를 잡는다.
3. **find-or-create + 이메일 자동연결** — `user_social(provider, provider_user_id)`로 기존 연동을 찾고, 없으면 제공자가 준 이메일로 기존 계정을 찾아 자동 연결, 그마저 없으면 신규 가입.
4. **최종 토큰은 우리 것** — 제공자 토큰은 사용자 식별에만 쓰고 버린다. 이후 인증은 CareerTuner 자체 JWT(access 30분) + DB refresh로 동작한다. ([JWT 인증](/backend/jwt-security) 참고)

작은 코드 — state 검증부 (`AuthServiceImpl.handleOAuthCallback`):

```java
if (!jwtTokenProvider.validateOauthState(state, normalized)) {
    throw new BusinessException(ErrorCode.UNAUTHORIZED, "잘못된 OAuth state입니다.");
}
SocialUserInfo info = socialOAuthService.fetchUserInfo(normalized, code, state);
User user = findOrCreateSocialUser(info);
```

토큰 교환 요청 본문(`SocialOAuthService.exchangeToken`)은 `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri`, `code`를 form으로 POST한다. 네이버만 추가로 `state`를 함께 보낸다.

## 6. 면접 답변 3단계

**초간단(1문장):** "OAuth2 인가코드 방식으로 카카오/네이버/구글 로그인을 붙였고, state 토큰으로 콜백 CSRF를 막은 뒤 우리 자체 JWT를 발급합니다."

**기본(30초):** "사용자가 소셜 로그인을 누르면 서버가 서명된 state 토큰을 만들어 제공자 인증 페이지로 리다이렉트합니다. 동의 후 제공자가 콜백으로 1회용 인가코드와 state를 돌려주면, 백엔드끼리 그 코드를 access token으로 교환해 사용자 정보를 조회합니다. state 서명을 먼저 검증해 CSRF를 막고, `user_social` 테이블 기준으로 find-or-create 한 다음, 제공자 토큰은 버리고 우리 서비스의 JWT를 발급합니다."

**꼬리질문 대응(요지):** "code와 token을 분리하는 이유는 client_secret을 브라우저에 노출하지 않으려는 것이고(back-channel 교환), state를 stateless JWT로 만든 건 서버에 세션을 안 두려는 설계 선택입니다. Spring Security oauth2Login 대신 RestClient로 직접 구현해 제공자별 응답 차이(카카오의 kakao_account, 네이버의 response 래핑)를 명시적으로 다뤘습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. Authorization Code 방식과 Implicit 방식의 차이는?
Implicit는 토큰을 리다이렉트 URL fragment로 **브라우저에 직접** 던져 노출 위험이 크고, 지금은 사실상 폐기(deprecated) 방향입니다. Code 방식은 브라우저엔 단기 1회용 code만 주고 실제 토큰은 **백엔드끼리 교환**하므로 안전합니다. 그래서 서버가 있는 우리 앱은 Code 방식을 씁니다.
:::

:::details Q. state 토큰은 정확히 무엇을 막나요? 왜 JWT로 했나요?
CSRF(Cross-Site Request Forgery)를 막습니다. 공격자가 자기 인가코드로 콜백을 위조해 피해자에게 실행시키면, 피해자 계정에 공격자 소셜이 묶일 수 있습니다. 우리가 보낸 state가 콜백에 그대로 돌아왔고 서명이 유효해야만 통과시켜 이를 차단합니다. JWT(서명+만료 5분)로 만든 건 **서버에 세션/쿠키를 저장하지 않고도** 위변조와 만료를 검증하기 위해서입니다. `validateOauthState`가 서명·`type=oauth_state`·provider 일치를 함께 확인합니다.
:::

:::details Q. 왜 Spring Security oauth2Login을 안 쓰고 직접 구현했나요?
제공자별 사용자정보 응답 구조가 제각각입니다(카카오는 `kakao_account.profile.nickname`, 네이버는 `response` 래핑, 구글은 평면 구조). 매뉴얼 REST로 짜면 이 차이와 find-or-create·이메일 자동연결·로그인 이력 기록 같은 우리 도메인 로직을 한 흐름에서 명시적으로 제어할 수 있습니다. 트레이드오프는 표준 흐름을 직접 관리해야 한다는 점이고, 그래서 state/토큰 교환 같은 보안 포인트를 직접 검증 로직으로 보강했습니다.
:::

:::details Q. 소셜로 처음 로그인한 사람과 이미 이메일 가입한 사람이 같은 이메일이면?
`findOrCreateSocialUser`가 `user_social(provider, provider_user_id)`로 먼저 찾고, 없으면 제공자가 내려준 이메일로 **기존 계정을 조회해 자동 연결**합니다. 둘 다 없을 때만 신규 가입입니다. 단 삭제 계정은 연결 전에 차단하고, 차단/휴면 계정은 연결은 하되 `validateSocialLoginAllowed`에서 로그인만 막습니다.
:::

:::details Q. client_secret 같은 비밀값은 어디에 두나요?
코드·저장소에 절대 넣지 않고 환경변수로 주입합니다(`CareerTunerProperties.Oauth.Provider`의 clientId/clientSecret/redirectUri). 미설정이면 `isConfigured()`가 false라 인가 URL 생성 단계에서 막습니다. 토큰 교환은 브라우저가 아닌 백엔드에서 일어나므로 secret이 클라이언트에 노출되지 않습니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드 없이 말로만, "버튼 클릭 → 제공자 동의 → 콜백 → 토큰 교환 → 우리 JWT 발급"까지 7단계 흐름을 끊김 없이 설명해보라. 각 단계에서 **브라우저가 보는 것 vs 백엔드만 보는 것**을 구분해서 말하면 가산점.
2. "state 토큰이 없으면 어떤 공격이 가능한가?"를 공격자 시나리오로 30초 안에 설명해보라.

## 퀴즈

<QuizBox question="CareerTuner가 채택한 OAuth2 흐름과 그 핵심 보안 이점은?" :choices="['Implicit 흐름 - 토큰을 브라우저로 바로 받아 빠르다','Authorization Code 흐름 - 실제 토큰은 백엔드끼리 교환해 client_secret을 노출하지 않는다','Password 흐름 - 사용자 비밀번호를 직접 받아 검증한다','Client Credentials 흐름 - 사용자 없이 서버 토큰만 쓴다']" :answer="1" explanation="서버가 있는 앱은 Authorization Code 흐름을 쓴다. 브라우저엔 1회용 code만 주고 실제 access token과 client_secret 교환은 back-channel(백엔드끼리)에서 일어나 노출 위험이 없다." />

<QuizBox question="CareerTuner의 state 토큰(createOauthState)에 대한 설명으로 옳은 것은?" :choices="['DB에 세션으로 저장해 콜백 때 조회한다','서명된 JWT(type=oauth_state, 만료 5분)로 stateless하게 CSRF를 방지한다','access token과 동일한 14일 만료를 가진다','네이버 로그인에서만 생성된다']" :answer="1" explanation="JwtTokenProvider.createOauthState는 subject=provider, type=oauth_state, 만료 5분의 서명 JWT를 만든다. 세션/쿠키 없이 validateOauthState로 서명·타입·provider 일치를 검증해 CSRF를 막는다." />

<QuizBox question="왜 OAuth2 콜백에서 인가코드(code)를 받고 곧바로 사용자 정보를 주지 않고, 별도의 토큰 교환 단계를 거치는지 설명해보라." explanation="인가코드는 브라우저(프런트채널)를 거쳐 전달되므로 노출 위험이 있는 단기 1회용 임시값일 뿐이다. 이 code를 실제 access token으로 바꾸는 교환은 백엔드와 제공자 사이(백채널)에서 일어나며 이때 client_secret이 필요하다. 즉 code/token을 분리함으로써 (1) 브라우저에 진짜 토큰과 secret을 노출하지 않고, (2) code를 가로채도 secret 없이는 토큰을 못 얻게 만들어 보안을 확보한다. CareerTuner는 SocialOAuthService.exchangeToken에서 grant_type=authorization_code로 백엔드 교환을 수행한다." />

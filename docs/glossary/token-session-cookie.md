# 토큰 / 세션 / 쿠키

> "CareerTuner는 서버에 세션을 저장하지 않는 STATELESS 구조라, 로그인 상태를 JWT 토큰으로 들고 다닙니다. Access 토큰(30분)으로 매 요청을 인증하고, 만료되면 DB에 저장된 Refresh 토큰(14일)으로 재발급받습니다."

## 1. 한 줄 정의

- **세션(Session)**: 로그인 상태를 **서버 메모리/DB에 저장**하고, 클라이언트는 그 방을 가리키는 **세션 ID**만 들고 다니는 방식. (서버가 상태를 기억함 = stateful)
- **토큰(Token)**: 로그인 정보를 **서명된 문자열 자체에 담아** 클라이언트가 들고 다니는 방식. 서버는 서명만 검증하면 되고 따로 기억하지 않음 (= stateless).
- **쿠키(Cookie)**: 위 두 가지를 **브라우저에 어떻게 보관·전송하느냐**의 한 가지 수단(자동 전송 저장소). 토큰을 꼭 쿠키에 넣어야 하는 건 아니다.

:::tip 핵심 한 줄
세션 vs 토큰은 "누가 상태를 기억하느냐"의 문제(서버냐 클라이언트냐)이고, 쿠키는 "어디에 저장/전송하느냐"의 문제다. 차원이 다르다.
:::

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Session | "한 번 앉아서 끝내는 한 묶음의 대화". 사용자가 로그인해서 로그아웃할 때까지의 연결 상태. |
| Token | 동전·교환권(token). 들고 있으면 권한을 증명하는 '징표'. |
| Cookie | 브라우저가 사이트별로 저장하는 작은 데이터 조각. 이름 유래는 'magic cookie'(전달용 데이터 토막). |
| JWT | **J**SON **W**eb **T**oken. `헤더.페이로드.서명` 세 토막을 점으로 이은 서명된 문자열. |
| Stateless | 상태(state) 없음(less). 서버가 요청 사이의 로그인 상태를 저장하지 않음. |
| Access / Refresh | 자원 접근용 단기 토큰 / 그 토큰을 재발급받기 위한 장기 토큰. |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

HTTP는 **상태가 없다**. 매 요청은 서로를 모르는 남남이라, 한 번 로그인해도 다음 요청에서 "넌 누구냐"를 다시 묻게 된다. 이걸 메우는 게 세션 또는 토큰이다.

**세션 방식의 한계 (서버가 기억하는 비용):**

- 로그인 사용자가 늘면 서버가 들고 있어야 할 세션 저장소가 같이 커진다.
- 서버를 여러 대로 늘리면(scale-out) 어느 서버에 세션이 있는지 맞춰줘야 한다(sticky session / 공유 세션 스토어 필요).
- 모바일 앱(Capacitor WebView)·다른 도메인에서 쿠키 기반 세션은 다루기 까다롭다.

**토큰(JWT) 방식이 푸는 것:**

- 서버가 아무것도 기억 안 해도 됨 → 서버를 마음대로 늘려도 인증이 깨지지 않는다.
- 토큰 안에 사용자 id·email·role이 들어 있어, 서명만 검증하면 곧바로 누구인지 안다.

:::warning 토큰의 대가
서명만으로 검증하니 "이미 발급한 토큰을 즉시 무효화하기"가 어렵다. 그래서 Access는 일부러 **짧게(30분)** 만들고, 즉시 끊어야 하는 로그아웃·강제 만료는 **DB에 저장한 Refresh 토큰을 폐기**하는 식으로 해결한다. 이게 CareerTuner가 둘을 섞어 쓰는 이유다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

CareerTuner는 **STATELESS + JWT** 구조다. HttpSession을 쓰지 않는다. (영역: 공통 인증 — 팀장/A 소유, 본인=영역 C는 사용 측)

| 위치 | 파일/클래스 | 역할 |
| --- | --- | --- |
| 세션 정책 | `common/config/SecurityConfig.java` | `SessionCreationPolicy.STATELESS`, CSRF disable, BCrypt PasswordEncoder, `/api/admin/**`는 ADMIN/SUPER_ADMIN 권한 |
| 토큰 발급/검증 | `common/security/JwtTokenProvider.java` | Access 토큰 생성(`createAccessToken`)·파싱(`parseAccessToken`), OAuth state 토큰(5분) |
| 요청별 인증 | `common/security/JwtAuthenticationFilter.java` | `Authorization: Bearer ...` 헤더에서 Access 토큰 파싱 → SecurityContext 주입 |
| Refresh 저장 | `auth/domain/RefreshToken.java` + `refresh_token` 테이블 | Refresh 토큰을 **DB에 저장**(회전/폐기/IP·UA 기록) |
| 유효기간 설정 | `common/config/CareerTunerProperties.java` | `accessTokenValiditySeconds=1800`(30분), `refreshTokenValiditySeconds=1209600`(14일) |
| 클라이언트 보관 | `frontend/src/app/lib/tokenStore.ts` | `localStorage` 키 `careertuner.auth`에 `{ accessToken, refreshToken }` 저장 |
| 자동 재발급 | `frontend/src/app/lib/api.ts` | 401 응답 시 `tryRefresh()`로 `/auth/refresh` 호출, 단일 플라이트(single-flight) |
| 전역 인증 상태 | `AuthContext` / `AuthProvider` | 로그인 여부를 React Context로 앱 전체에 공유 |

:::details 토큰 구조 한눈에 보기 (실제 값 X, 형태만)
```text
Access 토큰 (JWT, 서명됨)
  subject : userId
  email   : 사용자 이메일
  role    : USER / ADMIN ...
  type    : "access"
  exp     : 발급 + 30분

Refresh 토큰
  형태   : 불투명한 UUID 문자열 (JWT 아님)
  저장   : refresh_token 테이블 (userId, expiredAt, revoked, ipAddress, userAgent)
  수명   : 14일
```
Access는 자기 증명형(self-contained) JWT라 서버가 안 기억해도 되고, Refresh는 **DB로 추적·폐기**해야 해서 의도적으로 불투명 UUID + DB 저장으로 갔다.
:::

## 5. 핵심 동작 원리 (표/단계)

**로그인 후 한 사이클:**

1. 로그인 성공 → 서버가 Access(30분)·Refresh(14일) 두 개 발급, Refresh는 `refresh_token` 테이블에 저장.
2. 프런트가 둘 다 `localStorage`(`careertuner.auth`)에 저장.
3. 이후 모든 API 요청에 `Authorization: Bearer <access>` 헤더를 붙인다.
4. 서버 `JwtAuthenticationFilter`가 서명·만료·`type=access`를 검증 → 통과하면 그 요청만 인증된 상태.
5. Access가 만료되면 서버는 **401**을 던진다.
6. 프런트 `api.ts`가 401을 잡아 `/auth/refresh`로 Refresh 토큰을 보내 새 Access를 받는다.
7. 서버는 DB의 Refresh가 유효·미폐기인지 확인 후 새 토큰 발급. (Refresh도 만료/폐기면 재로그인)

**Access vs Refresh 비교:**

| 항목 | Access 토큰 | Refresh 토큰 |
| --- | --- | --- |
| 수명 | 30분 (단기) | 14일 (장기) |
| 형태 | JWT(서명, 자기증명) | 불투명 UUID |
| 서버 저장 | 안 함 (stateless) | `refresh_token` 테이블에 저장 |
| 쓰임 | 매 API 요청 인증 | Access 재발급 전용 |
| 무효화 | 만료까지 기다림(짧으니 OK) | DB에서 폐기 시 즉시 무효 |

**단일 플라이트(single-flight) 재발급** — 동시에 여러 요청이 401을 받아도 `/auth/refresh`는 딱 한 번만 호출:

```ts
let refreshPromise: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise; // 이미 진행 중이면 그 약속을 공유
  refreshPromise = (async () => {
    // .../auth/refresh 호출, 새 토큰 저장 ...
  })();
  return refreshPromise;
}
```

:::tip 왜 localStorage인가 (쿠키가 아니라)
CareerTuner는 Capacitor 네이티브 앱(Android `http://localhost`, iOS `capacitor://localhost`)에서도 같은 백엔드를 부른다. 쿠키는 도메인·SameSite 제약으로 이런 교차 오리진/WebView 환경에서 다루기 까다롭다. `Authorization` 헤더 + localStorage 토큰 방식은 웹과 앱에서 **동일하게** 동작한다. 대신 XSS에 토큰이 노출될 수 있어, 입력 escape·의존성 관리로 XSS 자체를 막는 게 전제가 된다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "세션은 서버가 로그인 상태를 기억하는 방식, 토큰은 클라이언트가 서명된 증표를 들고 다니는 방식이고, 저희는 stateless하게 JWT 토큰을 씁니다."
- **기본:** "HTTP가 무상태라 매 요청마다 인증이 필요한데, 세션 방식은 서버가 상태를 저장해 확장이 번거롭습니다. 그래서 CareerTuner는 SecurityConfig에서 세션을 STATELESS로 두고, Access 토큰(30분)을 Authorization 헤더로 받아 매 요청을 인증합니다. 만료되면 DB에 저장한 Refresh 토큰(14일)으로 재발급합니다."
- **꼬리질문 대응:** "Access를 자기증명 JWT로 짧게 두면 서버가 기억할 필요가 없어 확장에 유리하지만 즉시 무효화가 어렵습니다. 그 약점을 Refresh를 DB에 저장(불투명 UUID)해서 보완합니다. 로그아웃이나 강제 만료는 DB의 Refresh를 폐기해 다음 재발급을 막는 식입니다. 프런트는 401을 받으면 단일 플라이트로 /auth/refresh를 한 번만 호출해 토큰을 갱신합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. Access 토큰을 왜 30분으로 짧게 두나요?
JWT는 서명만으로 검증하기 때문에, 한 번 발급하면 만료 전까지 서버가 강제로 무효화하기 어렵습니다. 토큰이 유출돼도 피해 시간을 줄이려고 의도적으로 짧게(30분) 둡니다. 사용자 편의를 위한 장기 유지는 Refresh(14일)가 담당합니다.
:::

:::details Q. Refresh 토큰은 왜 DB에 저장하나요? JWT로 만들면 안 되나요?
무효화 때문입니다. Refresh를 자기증명 JWT로 만들면 폐기가 안 되어 14일간 누구도 못 끊습니다. CareerTuner는 Refresh를 불투명 UUID로 만들어 `refresh_token` 테이블에 저장하고, 로그아웃·이상행위 시 그 행을 revoked 처리해 즉시 못 쓰게 합니다. IP·UserAgent도 함께 기록해 추적합니다.
:::

:::details Q. 토큰을 localStorage에 두면 XSS에 위험하지 않나요?
맞습니다, localStorage는 자바스크립트로 읽혀서 XSS에 노출됩니다. 트레이드오프를 알고 선택한 건데, 이유는 Capacitor 네이티브 앱과 웹이 같은 인증을 써야 해서 쿠키보다 헤더+localStorage가 환경 일관성이 좋기 때문입니다. 대신 XSS 자체를 막는 게 전제라 입력 escape·CSP·의존성 점검으로 방어합니다. 더 보수적으로 가려면 Refresh를 HttpOnly 쿠키에 두는 방식도 고려할 수 있습니다.
:::

:::details Q. STATELESS인데 CSRF는 왜 disable했나요?
CSRF는 브라우저가 쿠키를 자동으로 실어 보내는 점을 악용하는 공격입니다. CareerTuner는 인증을 쿠키가 아니라 직접 붙이는 `Authorization: Bearer` 헤더로 하기 때문에, 공격자가 사용자의 토큰을 자동으로 끼워 넣을 수 없어 CSRF 위험이 구조적으로 낮습니다. 그래서 SecurityConfig에서 csrf를 disable합니다.
:::

:::details Q. OAuth state 토큰(5분)은 뭔가요?
소셜 로그인(Kakao/Naver/Google) 콜백이 정상 흐름인지 검증하는 일회성 CSRF 방지 토큰입니다. 보통은 세션에 state를 저장하지만, 저희는 stateless라 세션을 못 씁니다. 그래서 `createOauthState`로 5분짜리 서명 토큰을 만들어 보내고, 콜백 때 `validateOauthState`로 서명·provider를 검증합니다. 세션 없이 CSRF를 막는 방법입니다.
:::

## 8. 직접 말해보기

1. "세션·토큰·쿠키 세 단어가 서로 어떻게 다른지, 그리고 CareerTuner가 왜 토큰(stateless)을 골랐는지 30초 안에 설명해 보세요."
2. "Access(30분)와 Refresh(14일)를 굳이 둘로 나눈 이유를, '무효화'와 '확장성' 두 단어를 넣어 한 호흡에 말해 보세요."

관련 문서: [JWT와 Spring Security](/backend/jwt-security) · [DTO](/glossary/dto) · [ApiResponse 엔벨로프](/glossary/api-response-envelope)

## 퀴즈

<QuizBox question="CareerTuner의 인증 구조 설명으로 옳은 것은?" :choices="['서버 메모리에 세션을 저장하는 stateful 방식이다', '세션을 쓰지 않는 STATELESS + JWT 토큰 방식이다', 'Access 토큰을 DB에, Refresh 토큰을 localStorage에 저장한다', '인증을 HttpOnly 쿠키로만 처리한다']" :answer="1" explanation="SecurityConfig에서 SessionCreationPolicy.STATELESS로 두고, Access 토큰을 Authorization 헤더로 받아 매 요청을 인증합니다. 서버는 로그인 상태를 세션으로 기억하지 않습니다." />

<QuizBox question="Refresh 토큰을 (자기증명 JWT가 아니라) 불투명 UUID로 DB(refresh_token 테이블)에 저장한 가장 큰 이유는?" :choices="['토큰 길이를 줄이려고', '즉시 무효화(폐기)가 가능하도록', '서명 검증 속도를 높이려고', '쿠키에 담기 쉬워서']" :answer="1" explanation="자기증명 JWT는 만료 전 강제 무효화가 어렵습니다. Refresh를 DB로 관리하면 로그아웃·이상행위 시 해당 행을 revoked 처리해 다음 재발급을 즉시 막을 수 있습니다." />

<QuizBox question="STATELESS + JWT 구조에서 Access 토큰을 일부러 짧게(30분) 두는 이유와, 즉시 로그아웃을 어떻게 구현하는지 설명해 보세요." explanation="JWT는 서명만으로 검증하므로 발급 후 만료 전까지 서버가 강제 무효화하기 어렵습니다. 그래서 토큰 유출 시 피해 시간을 줄이기 위해 Access를 30분으로 짧게 둡니다. 즉시 로그아웃·강제 만료는 토큰 자체가 아니라 DB에 저장된 Refresh 토큰(refresh_token 테이블)을 폐기(revoked)하는 방식으로 구현합니다. 그러면 30분 안에 현재 Access는 만료되고, 재발급이 막혀 사실상 세션이 끊깁니다." />

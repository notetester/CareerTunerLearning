# JWT (JSON Web Token)

> 서버가 세션을 기억하지 않아도, 토큰 안의 서명을 검증하는 것만으로 "이게 진짜 내가 발급한 신분증인가"를 판단하는 인증 방식이다.

## 1. 한 줄 정의

JWT는 사용자 정보(클레임)를 담고 서버 비밀키로 서명한, 자기 자신을 증명하는 문자열 형태의 토큰이다. 서버는 이 토큰의 서명만 검증하면 별도 저장소 조회 없이 "누구인지"를 알 수 있다.

## 2. 단어 뜻 (약자 · 어원)

| 조각 | 풀이 |
| --- | --- |
| JSON | JavaScript Object Notation. 토큰 안의 데이터가 JSON 객체 형태다. |
| Web | 웹/HTTP 환경에서 주고받기 좋게 만든 표준 (RFC 7519). |
| Token | "징표/표". 입장권처럼 들고 다니며 신분을 증명하는 짧은 데이터. |

JWT는 보통 "조트(jot)"라고 읽는다. 읽는 법은 발음일 뿐 시험엔 안 나오지만, 면접에서 자연스럽게 쓰면 익숙해 보인다.

핵심 친척 개념: **Claim(클레임)** = 토큰이 "주장하는 사실" 한 조각. 예: `sub`(누구), `role`(권한), `exp`(언제 만료). **Bearer** = "소지자". `Authorization: Bearer <토큰>`은 "이 토큰을 가진 사람을 그 사람으로 취급하라"는 뜻이다.

## 3. 왜 필요한가 (없으면 무슨 문제)

전통적 세션 방식은 로그인하면 서버 메모리/DB에 세션을 저장하고, 브라우저엔 세션 ID만 쿠키로 준다. 요청이 올 때마다 서버는 그 ID로 세션 저장소를 **조회**해야 한다.

세션 방식의 문제:

- **확장이 어렵다.** 서버를 여러 대로 늘리면 "어느 서버가 이 세션을 들고 있나"를 맞춰야 한다(스티키 세션 / 공유 세션 스토어 필요).
- **상태(state)를 서버가 떠안는다.** 동시 접속자 수만큼 서버 메모리가 든다.
- **여러 클라이언트가 곤란하다.** 웹·모바일 앱·API를 동시에 지원할 때 쿠키 기반 세션은 불편하다.

JWT는 "신분 정보 + 서명"을 토큰 안에 다 넣어버린다. 그래서 서버는 토큰을 **기억할 필요가 없고**, 받은 토큰의 서명만 검증하면 된다. 이게 [무상태(stateless) 인증](/glossary/token-session-cookie)의 핵심이다. CareerTuner는 모바일(Capacitor) 앱과 웹 SPA를 같은 백엔드로 받기 때문에 이 방식이 맞다.

:::warning JWT는 "위조 방지"이지 "비밀 보관"이 아니다
서명은 내용이 변조되지 않았음을 보장할 뿐, payload 자체는 누구나 Base64url 디코드로 읽을 수 있다. 그래서 토큰 안에 비밀번호·주민번호 같은 민감 정보를 넣으면 안 된다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

발급·검증의 중심은 `common/security` 패키지의 두 클래스다.

| 파일 | 역할 |
| --- | --- |
| `common/security/JwtTokenProvider.java` | Access 토큰 발급·검증, OAuth state 토큰 발급·검증 |
| `common/security/JwtAuthenticationFilter.java` | `Authorization: Bearer` 헤더 파싱 → `SecurityContext`에 인증 주입 |

토큰의 수명·발급처를 정리하면:

| 토큰 | 수명 | 저장 위치 | 근거 |
| --- | --- | --- | --- |
| Access | 30분 (설정값 `accessTokenValiditySeconds`) | 저장 안 함(무상태) | `JwtTokenProvider.createAccessToken()` |
| Refresh | 14일 | DB `refresh_token` 테이블 | `AuthMapper`의 `insertRefreshToken / findRefreshToken / revokeRefreshToken` |
| OAuth state | 5분(300초) | 저장 안 함(서명만으로 CSRF 방지) | `JwtTokenProvider.createOauthState()` |

여기서 한 가지 설계 포인트를 짚어두자: **CareerTuner는 Refresh 토큰을 JWT로 다루지 않고 DB에서 관리한다.** `JwtTokenProvider`의 클래스 주석에도 "리프레시 토큰은 DB(`refresh_token`)에서 관리하므로 여기서 다루지 않는다"고 명시돼 있다. 이유는 6장과 꼬리질문에서 다룬다.

서명 키와 만료시간은 코드에 박지 않고 `CareerTunerProperties`(@ConfigurationProperties)를 통해 `application.yaml`에서 주입한다. 자세한 설정 패턴은 [설정 프로퍼티](/backend/configuration-properties), 보안 필터 체인·CORS·`STATELESS` 적용 등 적용 전체 그림은 [JWT 기반 시큐리티](/backend/jwt-security)에서 다룬다. 이 페이지는 "토큰이 무엇이고 어떻게 검증되는가"라는 원리에 집중한다.

## 5. 핵심 동작 원리 (구조와 서명)

### 5.1 구조: `header.payload.signature`

JWT는 점(`.`) 두 개로 나뉜 세 조각을, 각각 **Base64url**로 인코딩해 이어붙인 문자열이다.

```text
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiI0MiIsInJvbGUiOiJVU0VSIn0 . 3Tn8K-서명바이트...
└────── header ──────┘ └──────────── payload ─────────────┘ └──── signature ────┘
```

| 조각 | 담는 것 | CareerTuner 예 |
| --- | --- | --- |
| Header | 서명 알고리즘(`alg`), 타입 | HS256 (HMAC-SHA256) |
| Payload | 클레임들 | `sub`=userId, `email`, `role`, `type:"access"`, `iat`(발급), `exp`(만료) |
| Signature | 위 둘을 비밀키로 서명한 값 | 서버 비밀키로 계산한 HMAC |

Base64url은 암호화가 아니라 "URL에 안전한 글자만 쓰는 인코딩"이다. 즉 header·payload는 **누구나 디코드해 읽을 수 있다**. 위조를 막는 것은 오직 signature다.

### 5.2 서명과 검증 — 왜 위조가 안 되나

CareerTuner는 **HMAC-SHA256(HS256)** 대칭키 방식을 쓴다. 비밀키 하나로 서명도 하고 검증도 한다.

```text
[발급]  signature = HMAC_SHA256( base64url(header) + "." + base64url(payload), 비밀키 )
[검증]  같은 입력으로 서명을 다시 계산 → 토큰에 붙어온 signature와 일치하는지 비교
```

공격자가 payload의 `role`을 `USER`에서 `ADMIN`으로 바꾸면, 그 payload에 맞는 새 서명을 만들어야 하는데 **비밀키가 없으니 만들 수 없다**. 서버가 검증 시 서명을 다시 계산하면 불일치 → 거부. 이게 "서명으로 위조를 막는다"의 전부다. 추가로 `exp`(만료)도 검증해 시간이 지난 토큰을 막는다.

CareerTuner 코드에서 발급은 `Jwts.builder()...signWith(key).compact()`, 검증은 `Jwts.parser().verifyWith(key).build().parseSignedClaims(token)`로 jjwt 라이브러리가 처리한다. 검증이 실패하면 `JwtException`이 발생한다.

### 5.3 요청 한 번이 처리되는 흐름

```text
1) 클라이언트: Authorization: Bearer <accessToken> 헤더로 요청
2) JwtAuthenticationFilter: "Bearer " 뒤를 잘라 parseAccessToken() 호출
3) JwtTokenProvider: 서명·만료 검증 → AuthUser(id, email, role) 복원
4) 필터: SecurityContext에 ROLE_<role> 권한과 함께 인증 주입
5) 토큰이 없거나 깨졌으면? 예외를 삼키고 '익명'으로 통과 → 인가는 SecurityConfig가 판단
```

마지막 줄이 중요하다. CareerTuner의 필터는 토큰이 잘못돼도 거기서 401을 내지 않고 그냥 익명으로 통과시킨다. "이 요청에 권한이 필요한가"는 시큐리티 설정이 따로 판단한다. 인증(authn)과 인가(authz)의 역할 분리다 → [인증과 인가](/glossary/auth-authn-authz).

## 6. 면접 답변 3단계

**초간단 (한 줄):**
"JWT는 사용자 정보를 담고 서버 비밀키로 서명한 토큰이라서, 서버가 세션을 저장하지 않고 서명 검증만으로 로그인 상태를 확인할 수 있습니다."

**기본 (구조 + 수명):**
"JWT는 header.payload.signature 세 조각을 Base64url로 인코딩한 문자열입니다. payload엔 userId, role 같은 클레임이 들어가고, signature는 그 내용을 HMAC-SHA256으로 서명한 값이라 비밀키 없이는 위조할 수 없습니다. CareerTuner에선 Access 토큰을 30분 무상태로 쓰고, 보안상 더 오래 살아야 하는 Refresh 토큰은 14일짜리로 DB(`refresh_token`)에서 관리해 강제 무효화가 가능하게 했습니다."

**꼬리질문 대비 (설계 의도):**
"JwtTokenProvider가 발급·검증을 맡고, JwtAuthenticationFilter가 Bearer 헤더를 파싱해 SecurityContext에 인증을 채웁니다. 비밀키와 만료시간은 @ConfigurationProperties로 yaml에서 주입해 환경별로 바꿀 수 있게 했고, OAuth 콜백은 세션 없이 5분짜리 서명 state 토큰으로 CSRF를 막습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. JWT 안의 payload는 암호화돼 있나요?
아니요. payload는 Base64url **인코딩**일 뿐 암호화가 아니라 누구나 디코드해 읽을 수 있습니다. JWT가 보장하는 건 "내용 무결성(서명으로 위조 방지)"이지 "내용 비밀"이 아닙니다. 그래서 비밀번호 같은 민감 정보는 넣지 않고, CareerTuner도 payload에 userId·email·role·type 정도만 담습니다.
:::

:::details Q2. Access 토큰이 30분으로 짧은 이유는? 그리고 만료되면?
토큰이 탈취돼도 피해 시간을 줄이기 위해서입니다. 무상태 토큰은 서버가 즉시 회수할 수단이 없으니 수명을 짧게 가져갑니다. 만료되면 클라이언트가 더 오래 사는 Refresh 토큰으로 새 Access를 발급받습니다. CareerTuner 프런트(`app/lib/api.ts`)는 응답이 401이면 `/auth/refresh`로 자동 재발급을 시도하고, 동시 요청이 몰려도 리프레시는 한 번만 도는 single-flight로 처리합니다.
:::

:::details Q3. Refresh 토큰은 왜 JWT가 아니라 DB에 저장했나요?
무상태 JWT의 약점은 "서버가 강제로 무효화할 수 없다"는 점입니다. Access는 30분이라 그 위험을 짧은 수명으로 견디지만, 14일이나 사는 Refresh까지 무상태로 두면 탈취 시 2주간 막을 방법이 없습니다. 그래서 CareerTuner는 Refresh를 DB `refresh_token` 테이블로 관리합니다. 로그아웃·비밀번호 변경·계정 정지 때 `revokeRefreshToken`으로 그 자리에서 무효화할 수 있습니다. "짧은 무상태 Access + 회수 가능한 Refresh"라는 보편적 절충안입니다.
:::

:::details Q4. 서명을 HS256(대칭키)으로 했는데, RS256(비대칭키)과 차이는?
HS256은 비밀키 하나로 서명·검증을 모두 합니다. 단일 백엔드가 발급·검증을 다 하는 CareerTuner 구조에선 단순하고 충분합니다. RS256은 개인키로 서명, 공개키로 검증이라 "발급 주체와 검증 주체가 다를 때"(예: 인증 서버 따로, 다수의 리소스 서버가 공개키로만 검증) 유리합니다. 비밀키 배포 없이 검증을 분산할 수 있는 게 장점이지만, 지금 규모엔 과합니다.
:::

:::details Q5. 토큰이 위조되거나 만료되면 서버에서 어떻게 처리되나요?
검증은 jjwt가 `parseSignedClaims`에서 서명·만료를 함께 확인하고, 실패하면 `JwtException`을 던집니다. CareerTuner의 `JwtAuthenticationFilter`는 이 예외를 잡아 SecurityContext를 비우고 **익명 상태로 그냥 통과**시킵니다. 거기서 401을 내지 않는 이유는, 그 요청이 인증이 필요한지 아닌지는 SecurityConfig의 인가 규칙이 판단하기 때문입니다. 인증과 인가의 책임을 분리한 설계입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 한 번에 설명할 수 있으면 이 주제는 끝난 것이다.

1. JWT의 세 조각이 각각 무엇이고, 그중 "위조를 막는" 건 어느 조각인가?
2. payload는 왜 암호화가 아닌데도 안전하다고 말할 수 있는가? 반대로 무엇을 넣으면 안 되나?
3. CareerTuner가 Access는 무상태 30분, Refresh는 DB 14일로 나눈 이유를 한 문장으로.
4. 요청 하나가 들어왔을 때 `JwtAuthenticationFilter` → `JwtTokenProvider` → `SecurityContext`로 이어지는 흐름을 말로.

## 퀴즈

<QuizBox question="JWT에서 내용 위조를 실제로 막아주는 조각은?" :choices="['header', 'payload', 'signature', '세 조각 모두 동일하게 막는다']" :answer="2" explanation="header와 payload는 Base64url 인코딩이라 누구나 읽고 바꿔 쓸 수 있다. 위조를 막는 것은 비밀키로 계산한 signature뿐이다. payload를 바꾸면 서명이 불일치해 검증에서 거부된다." />

<QuizBox question="CareerTuner가 Access 토큰은 무상태 JWT로 두면서 Refresh 토큰은 DB(refresh_token)에 저장한 핵심 이유는?" :choices="['DB가 JWT보다 빠르기 때문', '서버가 Refresh 토큰을 강제로 무효화(회수)할 수 있게 하려고', 'Refresh 토큰은 서명할 수 없기 때문', 'Access 토큰은 암호화가 안 되기 때문']" :answer="1" explanation="무상태 JWT는 서버가 즉시 회수할 수 없다. 14일로 오래 사는 Refresh를 탈취 시 막으려면 회수 수단이 필요해 DB에서 관리하고, revokeRefreshToken으로 무효화한다. Access는 30분으로 짧아 그 위험을 수명으로 견딘다." />

<QuizBox question="payload는 암호화가 아닌 Base64url 인코딩일 뿐인데도 JWT가 안전하다고 말하는 근거를 한 문장으로 설명하라. 또한 그 성질 때문에 payload에 넣으면 안 되는 것은?" explanation="모범답안: signature가 비밀키로 내용을 서명하므로 누가 payload를 바꿔도 서명이 불일치해 거부된다(무결성 보장). 다만 payload는 누구나 디코드해 읽을 수 있으므로 비밀번호·주민번호 같은 민감 정보는 넣으면 안 된다. JWT는 '위조 방지'이지 '비밀 보관'이 아니다." />

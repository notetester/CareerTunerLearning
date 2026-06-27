# JWT와 Spring Security

> CareerTuner는 서버에 세션을 저장하지 않는 STATELESS 인증을 씁니다. 모든 요청은 `Authorization: Bearer` 헤더의 액세스 토큰을 필터에서 검증해 `SecurityContext`에 사용자를 채우고, 짧은 액세스 토큰(30분)은 무상태 JWT, 긴 리프레시 토큰(14일)은 DB에 저장해 회전·폐기로 통제합니다.

## 1. 한 줄 정의

JWT는 "서버가 서명한, 위변조 불가능한 자격 증명 문자열"이고, Spring Security는 그 토큰을 매 요청마다 검증해 "이 요청을 누가 보냈고 무엇을 할 수 있는지"를 결정하는 보안 필터 체계입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| JWT | JSON Web Token. `header.payload.signature` 세 조각을 점(`.`)으로 이은 문자열. 각각 Base64Url 인코딩 |
| Claim | payload에 담긴 키-값 사실. CareerTuner는 `subject`(userId), `email`, `role`, `type`을 넣음 |
| Signature | header+payload를 비밀키로 해싱한 값. 한 글자라도 바뀌면 검증 실패 |
| HMAC-SHA | 대칭키 서명 알고리즘. 같은 비밀키로 서명·검증. jjwt의 `Keys.hmacShaKeyFor(secret)` 사용 |
| STATELESS | 서버가 세션을 저장하지 않음. 토큰 자체가 신원을 증명하므로 서버 메모리에 로그인 상태가 없음 |
| Access / Refresh | 짧게 쓰고 버리는 토큰 / 그 액세스 토큰을 재발급받는 데 쓰는 긴 토큰 |

:::tip 자기 입으로 설명하는 핵심
"JWT는 서버가 서명했기 때문에 DB를 다시 조회하지 않아도 위변조 여부와 내용을 신뢰할 수 있다. 그래서 STATELESS가 가능하다." — 이 한 문장이 면접의 30초 답변 뼈대입니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **세션 방식의 한계**: 전통적 세션은 로그인 상태를 서버 메모리/세션 저장소에 둔다. 서버가 여러 대로 늘면 "내 세션이 어느 서버에 있나" 문제(sticky session, 공유 세션 스토어)가 생긴다. STATELESS JWT는 토큰만 있으면 어느 서버든 검증 가능 → 수평 확장이 쉽다.
- **모바일/SPA 친화**: CareerTuner 프런트는 React SPA + Capacitor 네이티브 앱이다. 쿠키 세션보다 `Authorization` 헤더로 토큰을 실어 보내는 편이 CORS/네이티브 WebView 환경에서 단순하다.
- **토큰 탈취 위험을 짧은 수명으로 상쇄**: JWT는 한 번 발급하면 만료까지 서버가 막기 어렵다(stateless의 대가). 그래서 액세스 토큰을 **30분**으로 짧게 두고, 폐기가 필요한 장수명 권한은 **DB 리프레시 토큰**으로 분리해 통제한다.

:::warning JWT의 함정
"발급된 JWT는 만료 전까지 서버가 무효화하기 어렵다." 이 단점을 모르고 JWT를 만능으로 답하면 꼬리질문에서 무너집니다. CareerTuner가 리프레시 토큰만 DB에 둔 이유가 바로 이 단점을 보완하기 위함입니다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역: **백엔드 공통(common)** — 공통 보안 인프라이므로 팀장 소유. 본인(영역 C)은 이 위에서 동작하는 AI 도메인을 얹는 입장입니다.

| 구성요소 | 위치 | 책임 |
| --- | --- | --- |
| `SecurityConfig` | `common/config/SecurityConfig.java` | 필터 체인, 공개/인증 엔드포인트, CORS, BCrypt, STATELESS 정책 |
| `JwtAuthenticationFilter` | `common/security/JwtAuthenticationFilter.java` | `Bearer` 헤더 파싱 → `SecurityContext`에 인증 주입 |
| `JwtTokenProvider` | `common/security/JwtTokenProvider.java` | 액세스 토큰 발급/검증, OAuth state 토큰(5분 CSRF) |
| `AuthUser` | `common/security/AuthUser.java` | `record(id, email, role)` — 토큰에서 복원된 인증 주체 |
| `CareerTunerProperties.Jwt` | `common/config/CareerTunerProperties.java` | `secret`, `accessTokenValiditySeconds=1800`, `refreshTokenValiditySeconds=1209600` |
| `AuthServiceImpl` | `auth/service/AuthServiceImpl.java` | 토큰 발급(`issueTokens`), 리프레시 회전(`refresh`), 폐기(`logout`, `logoutAll`) |
| `refresh_token` 테이블 | `RefreshToken` 도메인 VO | userId, token, expiredAt, revoked, ipAddress, userAgent 저장 |

- 액세스 토큰 = **무상태 JWT**(HMAC 서명). 리프레시 토큰 = **불투명 UUID**를 `refresh_token` 테이블에 저장 → 회전·폐기 가능.
- `@AuthenticationPrincipal AuthUser`로 컨트롤러에서 현재 사용자 주입. `@EnableMethodSecurity`로 메서드 단위 권한도 가능.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 요청 1건이 흐르는 순서

```text
요청 → JwtAuthenticationFilter (Bearer 파싱·검증)
     → SecurityContext에 인증 채움(또는 익명)
     → authorizeHttpRequests 인가 판단
     → 통과 시 컨트롤러 도달
```

`JwtAuthenticationFilter`는 `OncePerRequestFilter`를 상속하고, `SecurityConfig`에서 `UsernamePasswordAuthenticationFilter` **앞에** 등록됩니다.

```java
// JwtAuthenticationFilter — 핵심만 축약
String header = request.getHeader("Authorization");
if (header != null && header.startsWith("Bearer ")) {
    try {
        AuthUser user = tokenProvider.parseAccessToken(header.substring(7));
        var auth = new UsernamePasswordAuthenticationToken(
                user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role())));
        SecurityContextHolder.getContext().setAuthentication(auth);
    } catch (Exception ignored) {
        SecurityContextHolder.clearContext(); // 토큰 불량 → 익명으로 진행
    }
}
chain.doFilter(request, response);
```

:::details 왜 필터는 토큰이 없어도 401을 던지지 않을까
필터의 책임은 "신원 채우기"이고, "막을지 말지(인가)"는 `SecurityConfig`의 `authorizeHttpRequests`가 정합니다. 책임 분리 때문에 토큰이 없으면 익명으로 통과시키고, 보호 엔드포인트면 그제서야 인가 단계에서 401을 줍니다. `authenticationEntryPoint`가 `SC_UNAUTHORIZED`를 응답합니다.
:::

### 5-2. 액세스 토큰 발급/검증 (JwtTokenProvider)

```java
// 발급: 누가(subject) + 부가정보(claim) + 만료 + 서명
Jwts.builder()
    .subject(String.valueOf(userId))
    .claim("email", email).claim("role", role).claim("type", "access")
    .expiration(Date.from(now.plusSeconds(accessValiditySeconds)))
    .signWith(key).compact();

// 검증: 서명 확인 + type이 access인지까지 확인
Claims c = Jwts.parser().verifyWith(key).build()
              .parseSignedClaims(token).getPayload();
if (!"access".equals(c.get("type", String.class))) throw new JwtException(...);
```

`type` 클레임으로 access / refresh / oauth_state 토큰을 구분해 **토큰 혼용(type confusion)을 차단**합니다.

### 5-3. 토큰 정책 한눈에

| 토큰 | 수명 | 저장 위치 | 형식 | 폐기 방법 |
| --- | --- | --- | --- | --- |
| Access | 30분(1800s) | 클라이언트만 | 서명된 JWT | 만료까지 못 막음(짧게 둠) |
| Refresh | 14일(1209600s) | `refresh_token` DB + 클라이언트 | 불투명 UUID | DB에서 `revoked=true` |
| OAuth state | 5분(300s) | 클라이언트만 | 서명된 JWT | 만료까지 |

### 5-4. 리프레시 토큰 회전(rotation)과 폐기

`AuthServiceImpl.refresh()`가 핵심입니다.

1. DB에서 리프레시 토큰 조회 → `revoked`/만료/존재 여부 검사 (불량이면 401 + 로그인 이력 기록)
2. 계정 상태 재확인(`validateTokenAllowed`) — 토큰이 유효해도 계정이 잠겼으면 거부
3. **기존 리프레시 토큰을 `revokeRefreshToken`으로 폐기**
4. `issueTokens`로 **새 액세스 + 새 리프레시 발급** → 매 갱신마다 토큰이 바뀜(회전)

폐기는 회전 외에도 여러 시나리오에서 발생합니다.

| 트리거 | 처리 |
| --- | --- |
| 로그아웃 | `revokeRefreshToken(해당 토큰)` |
| 전체 로그아웃 / 비번 재설정 / 로그인 실패 잠금 | `revokeAllForUser(userId)` — 모든 세션 폐기 |
| 토큰 갱신 | 기존 폐기 후 새 토큰 발급(회전) |

### 5-5. 인가(authorization) 규칙

```java
.requestMatchers("/api/admin/**").hasAnyRole("ADMIN", "SUPER_ADMIN")
.anyRequest().authenticated()
```

- `/api/admin/**`는 URL 레벨에서 관리자 권한 강제. `SUPER_ADMIN`은 상위 역할이라 일반 관리자 API도 접근.
- 공개 엔드포인트(`/api/auth/login`, `/api/health`, `/swagger-ui.html`, 커뮤니티 글 조회 등)는 `permitAll`.
- `SessionCreationPolicy.STATELESS`, CSRF 비활성(쿠키 세션을 안 쓰므로), `httpBasic`/`formLogin` 비활성.
- CORS 허용 오리진은 `localhost:5173`(Vite)과 `capacitor://localhost`(네이티브 WebView). `allowCredentials=true`.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "JWT로 무상태 인증을 하고, 액세스 토큰은 짧게(30분), 리프레시 토큰은 DB에 저장해 회전·폐기로 통제했습니다."
- **기본**: "요청마다 `JwtAuthenticationFilter`가 `Bearer` 헤더를 파싱해 서명을 검증하고 `SecurityContext`에 사용자를 채웁니다. 액세스 토큰은 HMAC 서명된 stateless JWT라 DB 조회 없이 검증되고, 리프레시 토큰은 불투명 UUID를 `refresh_token` 테이블에 저장해 로그아웃이나 비번 변경 시 폐기할 수 있게 했습니다. 갱신 때는 기존 리프레시를 폐기하고 새 쌍을 발급하는 회전 방식입니다."
- **꼬리질문 대응**: "JWT의 약점은 발급 후 만료 전까지 서버가 무효화하기 어렵다는 점입니다. 그래서 권한이 강한 장수명 토큰만 DB로 빼서 폐기 가능하게 하고, 액세스 토큰은 수명을 30분으로 짧게 둬 탈취 피해 창을 줄였습니다. STATELESS라 서버 확장이 쉬운 장점은 그대로 유지합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 액세스 토큰이 탈취되면 어떻게 막나요?
"stateless JWT는 만료 전까지 즉시 무효화가 어렵습니다. 그래서 두 가지로 대응합니다. (1) 수명을 30분으로 짧게 둬 피해 창을 최소화하고, (2) 더 위험한 리프레시 토큰은 DB에 두고 `revokeAllForUser`로 모든 세션을 한 번에 끊을 수 있게 했습니다. 비밀번호 재설정이나 로그인 실패 잠금 시 자동으로 전체 폐기됩니다. 즉시 차단이 필요하면 블랙리스트를 도입할 수 있지만, 그건 stateless의 장점을 일부 포기하는 트레이드오프입니다."
:::

:::details Q2. 왜 리프레시 토큰은 JWT가 아니라 UUID인가요?
"리프레시 토큰은 폐기가 핵심 요구사항입니다. JWT로 만들면 서버가 무효화하려면 결국 DB나 블랙리스트가 필요하니 stateless 장점이 사라집니다. 그럴 바엔 처음부터 의미 없는 불투명 UUID를 DB에 저장하는 게 단순하고, 폐기·회전·기기별 관리(IP·UserAgent 저장)가 자연스럽습니다. 반대로 자주 쓰는 액세스 토큰은 DB 조회 없이 검증돼야 하므로 서명된 JWT가 맞습니다."
:::

:::details Q3. 토큰 회전(rotation)이 왜 중요한가요?
"리프레시 토큰을 한 번 쓰고 새것으로 바꾸면, 탈취된 옛 토큰은 다음 갱신 순간 무효가 됩니다. `refresh()`에서 기존 토큰을 `revokeRefreshToken`으로 폐기한 뒤 새 쌍을 발급하는 게 그 구현입니다. 더 강하게는 '폐기된 토큰이 재사용되면 그 계정의 모든 세션을 끊는' reuse detection까지 확장할 수 있습니다."
:::

:::details Q4. 필터에서 토큰이 없거나 틀려도 왜 바로 401을 안 던지나요?
"인증(누구인가)과 인가(접근 허용 여부)의 책임을 분리했기 때문입니다. 필터는 신원을 채우거나 익명으로 두기만 하고, 막을지는 `authorizeHttpRequests`가 결정합니다. 덕분에 공개 엔드포인트는 토큰 없이도 통과하고, 보호 엔드포인트는 `authenticationEntryPoint`가 401을 응답합니다. 또 `OncePerRequestFilter`라 한 요청당 한 번만 실행돼 SSE/async 재디스패치에서 중복 검증을 피합니다."
:::

:::details Q5. CSRF를 왜 껐나요? 안전한가요?
"CSRF 공격은 브라우저가 쿠키를 자동으로 실어 보내는 점을 악용합니다. CareerTuner는 세션 쿠키가 아니라 `Authorization` 헤더로 토큰을 보내고, 헤더는 자동 전송되지 않으므로 전형적 CSRF 벡터가 없습니다. 그래서 STATELESS + 헤더 토큰 조합에서는 CSRF를 끄는 게 표준입니다. 대신 토큰을 어디에 저장하느냐(XSS 노출)가 더 중요해져, 프런트는 localStorage 토큰과 401 시 단일-플라이트 자동 리프레시로 관리합니다."
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "요청 한 건이 들어와서 컨트롤러에 도달하기까지" 필터 → SecurityContext → 인가 순서를 30초 안에 말로 설명해 보세요.
2. "왜 액세스는 JWT인데 리프레시는 DB UUID냐"를 면접관이 물었다고 가정하고, stateless의 장점과 폐기 요구사항의 트레이드오프로 1분간 답해 보세요.

## 퀴즈

<QuizBox question="CareerTuner에서 액세스 토큰과 리프레시 토큰의 저장/형식 조합으로 옳은 것은?" :choices="['둘 다 DB 저장 JWT', '액세스=DB UUID, 리프레시=stateless JWT', '액세스=stateless JWT, 리프레시=DB 저장 UUID', '둘 다 클라이언트만 보관하는 stateless JWT']" :answer="2" explanation="액세스 토큰은 서명된 stateless JWT로 DB 조회 없이 검증하고, 리프레시 토큰은 폐기·회전이 필요해 불투명 UUID를 refresh_token 테이블에 저장합니다." />

<QuizBox question="JwtAuthenticationFilter가 Bearer 토큰이 유효하지 않을 때 하는 동작은?" :choices="['즉시 401을 응답하고 체인을 끊는다', 'SecurityContext를 비우고 익명으로 다음 필터로 진행한다', '리프레시 토큰을 자동 발급한다', '예외를 던져 GlobalExceptionHandler가 처리한다']" :answer="1" explanation="필터는 신원만 채웁니다. 토큰이 불량이면 컨텍스트를 비우고 익명으로 통과시키며, 막을지 여부(401)는 SecurityConfig의 인가 단계와 authenticationEntryPoint가 결정합니다." />

<QuizBox question="JWT를 stateless로 쓸 때 가장 본질적인 단점과, CareerTuner가 그걸 보완한 방법을 설명해 보세요." explanation="stateless JWT는 한 번 발급하면 만료 전까지 서버가 즉시 무효화하기 어렵다는 단점이 있습니다. CareerTuner는 (1) 액세스 토큰 수명을 30분으로 짧게 둬 탈취 피해 창을 줄이고, (2) 폐기가 꼭 필요한 장수명 권한인 리프레시 토큰은 불투명 UUID로 refresh_token 테이블에 저장해 로그아웃·비밀번호 재설정·로그인 실패 잠금 시 revokeRefreshToken/revokeAllForUser로 폐기하며, 갱신 시 기존 토큰을 폐기하고 새 쌍을 발급하는 회전 방식으로 보완했습니다." />

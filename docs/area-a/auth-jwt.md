# JWT 인증 흐름

> Access는 무상태 서명 토큰(짧은 수명), Refresh는 DB에 저장된 opaque UUID(회전·폐기·감사 가능). 둘을 의도적으로 분리해 "확장성"과 "통제권"을 동시에 얻은 구조.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

CareerTuner의 로그인 세션은 **두 개의 서로 다른 토큰**으로 굴러간다. 짧게 사는 **Access Token**(JWT, 서버가 상태를 들고 있지 않음)과, 길게 사는 **Refresh Token**(DB `refresh_token` 행으로 존재하는 의미 없는 UUID)이다. Access로 매 요청을 통과시키고, Access가 만료되면 Refresh로 새 토큰 쌍을 발급받는다.

이 페이지가 답하는 면접 질문:

- "세션을 JWT로 했다는데, 왜 무상태(STATELESS)로 갔나? 서버 세션 대비 트레이드오프는?"
- "JWT는 한 번 발급하면 만료 전까지 못 막는데, 로그아웃이나 강제 차단은 어떻게 하나?"
- "Access와 Refresh를 왜 나눴고, Refresh는 왜 JWT가 아니라 DB UUID인가?"
- "Refresh 회전(rotation)이 뭐고 왜 하나?"

핵심 클래스는 단 두 개로 좁힌다: 발급·검증을 담당하는 `JwtTokenProvider`, 매 요청에서 토큰을 까서 인증을 채우는 `JwtAuthenticationFilter`. 둘 다 `com.careertuner.common.security` 패키지에 있다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 무상태(STATELESS)를 택한 이유

`SecurityConfig`는 세션을 아예 만들지 않도록 못 박는다.

```java
.sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
.csrf(csrf -> csrf.disable())
.httpBasic(basic -> basic.disable())
.formLogin(form -> form.disable())
```

서버가 세션을 안 들고 있으니, **어떤 서버 인스턴스든 토큰만 보고 요청을 처리**할 수 있다. 수평 확장 시 세션 스토어(Redis 등)를 공유할 필요가 없고, 모바일(Capacitor) 클라이언트도 쿠키·세션 의존 없이 동일한 Bearer 토큰 방식으로 붙는다. CSRF를 끈 것도 이 결정의 연장선이다 — 쿠키 기반 세션이 없으면 CSRF 공격 표면 자체가 사라지므로, 대신 `Authorization: Bearer` 헤더로 인증한다.

대가(트레이드오프)는 분명하다. **무상태 JWT는 서버가 "이 토큰 무효야"라고 즉시 선언할 수단이 없다.** 서명이 유효하고 만료 전이면, 서버는 그 토큰을 받아들일 수밖에 없다. 이 한계를 어떻게 메우느냐가 다음 설계 결정의 핵심이다.

### 토큰을 둘로 쪼갠 이유 (이원화)

| 구분 | Access Token | Refresh Token |
| --- | --- | --- |
| 형식 | JWT (HMAC 서명) | opaque UUID (의미 없는 문자열) |
| 보관 위치 | 클라이언트만 (서버 무상태) | **서버 DB `refresh_token` 행** |
| 수명 | 짧음 (기본 1800초 = 30분) | 김 (기본 1209600초 = 14일) |
| 용도 | 매 API 요청 인증 | Access 만료 시 재발급 |
| 즉시 폐기 | 불가 (만료까지 유효) | **가능 (`revoked` 플래그)** |
| 감사 정보 | 없음 | IP·User-Agent·발급시각 동반 |

설계 의도는 **"빠른 통과는 무상태로, 통제는 상태 있게"** 다. Access는 짧게 살다 죽으니 탈취돼도 피해 시간이 짧고, 매 요청마다 DB를 조회하지 않아 빠르다. Refresh는 DB에 실체가 있으니 회전·폐기·세션 목록 조회가 전부 가능하다. 즉, 무상태 JWT의 "즉시 무효화 불가" 약점을, **짧은 Access 수명 + 폐기 가능한 Refresh** 조합으로 메우는 구조다.

:::tip 면접 한 줄 요약
"Access는 성능을 위해 무상태로, Refresh는 통제를 위해 상태 있게 — 두 토큰의 역할이 다르기 때문에 형식도 다르게 갔다."
:::

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### `JwtTokenProvider` — 발급·검증 단일 책임

`io.jsonwebtoken`(jjwt) 라이브러리를 쓴다. 비밀키는 설정값(`CareerTunerProperties.Jwt.secret`)을 HMAC-SHA 키로 변환해 보관한다.

```java
public String createAccessToken(Long userId, String email, String role) {
    Instant now = Instant.now();
    return Jwts.builder()
            .subject(String.valueOf(userId))   // sub = 사용자 ID
            .claim("email", email)
            .claim("role", role)               // 인가에 쓰는 권한
            .claim("type", "access")           // 토큰 종류 구분
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plusSeconds(accessValiditySeconds)))
            .signWith(key)                     // HMAC 서명
            .compact();
}
```

검증 쪽은 서명을 확인한 뒤 `type` 클레임이 `"access"`인지까지 본다. 같은 키로 OAuth용 state 토큰(`type=oauth_state`)도 발급하기 때문에, **종류가 다른 토큰이 access 자리에 끼어드는 것을 명시적으로 막는다.**

```java
public AuthUser parseAccessToken(String token) {
    Claims c = Jwts.parser().verifyWith(key).build()
                   .parseSignedClaims(token).getPayload();
    if (!"access".equals(c.get("type", String.class))) {
        throw new JwtException("not an access token");  // type 위조/혼동 방지
    }
    return new AuthUser(Long.valueOf(c.getSubject()),
                        c.get("email", String.class),
                        c.get("role", String.class));
}
```

주석에 명시되어 있듯, **Refresh 토큰은 이 클래스가 다루지 않는다.** Refresh는 JWT가 아니라 DB 행이라서 `AuthServiceImpl`이 직접 관리한다.

### `JwtAuthenticationFilter` — 요청마다 한 번, 익명 통과

`OncePerRequestFilter`를 상속해 요청당 한 번 동작하고, `UsernamePasswordAuthenticationFilter` 앞에 끼워진다(`SecurityConfig`의 `addFilterBefore`).

```java
String header = request.getHeader("Authorization");
if (header != null && header.startsWith("Bearer ")) {
    try {
        AuthUser user = tokenProvider.parseAccessToken(header.substring(7));
        var authentication = new UsernamePasswordAuthenticationToken(
                user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role())));
        SecurityContextHolder.getContext().setAuthentication(authentication);
    } catch (Exception ignored) {
        SecurityContextHolder.clearContext();   // 토큰 깨졌으면 익명으로 진행
    }
}
chain.doFilter(request, response);
```

설계 포인트는 **"토큰이 없거나 깨져도 401을 던지지 않고 그냥 통과시킨다"** 는 것이다. 인증(누구인가)과 인가(접근 권한이 있는가)를 분리해서, 필터는 인증만 채우고 **인가 판단은 전적으로 `SecurityConfig`의 URL 규칙에 맡긴다.** 그래서 공개 엔드포인트는 토큰 없이도 정상 동작하고, 보호 엔드포인트는 인증이 비어 있으면 Spring Security가 401/403을 낸다. 역할은 `ROLE_` 접두어를 붙여 권한으로 변환하고, `/api/admin/**`는 URL 레벨에서 `hasAnyRole("ADMIN", "SUPER_ADMIN")`로 한 번 더 걸린다.

### `refresh_token` 테이블 — Refresh의 실체

| 컬럼 | 의미 |
| --- | --- |
| `token` | UUID 문자열 (UK) |
| `user_id` | 소유자 |
| `revoked` | 폐기 플래그 (로그아웃·상태변경 시 true) |
| `expired_at` | 만료 시각 |
| `ip_address` / `user_agent` | 발급 환경 (세션 감사용) |

`ip_address`·`user_agent`를 같이 저장하므로, 관리자 화면에서 "이 계정의 활성 세션 목록"을 그대로 보여줄 수 있다. 무상태 Access로는 불가능한 일을 Refresh의 상태성이 가능하게 만든다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 로그인 → 토큰 발급

모든 인증 경로(로그인, 회원가입 자동 로그인, 소셜, 비번 재설정 후 등)는 결국 `issueTokens` 한 곳으로 모인다.

```java
private TokenResponse issueTokens(User user, LoginRequestContext context) {
    String accessToken  = jwtTokenProvider.createAccessToken(user.getId(), user.getEmail(), user.getRole());
    String refreshToken = UUID.randomUUID().toString();   // ← JWT가 아니라 그냥 UUID
    // access는 stateless JWT, refresh는 DB에 기기/접속정보와 함께 저장
    authMapper.insertRefreshToken(RefreshToken.builder()
            .userId(user.getId())
            .token(refreshToken)
            .expiredAt(LocalDateTime.now().plusSeconds(props.getJwt().getRefreshTokenValiditySeconds()))
            .ipAddress(truncate(context.ipAddress(), 45))
            .userAgent(truncate(context.userAgent(), 500))
            .build());
    return TokenResponse.of(accessToken, refreshToken, ...);
}
```

### 매 요청 인증 흐름

| 단계 | 주체 | 동작 |
| --- | --- | --- |
| 1 | 클라이언트 | `Authorization: Bearer <access>` 헤더로 요청 |
| 2 | `JwtAuthenticationFilter` | 헤더 파싱 → `parseAccessToken` → 성공 시 `SecurityContext`에 인증 채움 |
| 3 | `SecurityConfig` | URL 규칙으로 인가 판단 (보호 경로인데 인증 없으면 401/403) |
| 4 | 컨트롤러 | `@AuthenticationPrincipal AuthUser`로 사용자 사용 |

### Access 만료 → Refresh 회전(rotation)

Access가 만료되면 클라이언트는 Refresh를 들고 `/auth/refresh`를 친다. 핵심은 **검증된 Refresh를 즉시 폐기하고 완전히 새로운 Refresh를 발급**한다는 점 — 이것이 회전이다.

```java
public TokenResponse refresh(String refreshToken, LoginRequestContext context) {
    RefreshToken stored = authMapper.findRefreshToken(refreshToken);
    // 없거나 / 폐기됐거나 / 만료됐으면 거부 + 실패 히스토리 기록
    if (stored == null || stored.isRevoked()
            || stored.getExpiredAt().isBefore(LocalDateTime.now())) {
        recordLoginHistory(..., false, "INVALID_REFRESH_TOKEN", context);
        throw ...;
    }
    // refresh가 유효해도 현재 계정 상태(차단/휴면/삭제)면 세션을 연장하지 않는다
    User user = ...; validateLoginAllowed(user);

    authMapper.revokeRefreshToken(refreshToken);  // ← 쓴 refresh는 즉시 폐기 (회전)
    recordLoginHistory(user.getId(), "REFRESH", ..., true, null, context);
    return issueTokens(user, context);            // ← 새 access + 새 refresh
}
```

회전의 효과는 **재사용 탐지**다. 한 Refresh는 정확히 한 번만 유효하므로, 이미 폐기된 Refresh가 다시 들어오면 "탈취 후 재사용" 신호로 보고 거부 + 실패 로그를 남긴다. 또 하나 중요한 점: Refresh가 기술적으로 멀쩡해도 **계정 상태 검증(`validateLoginAllowed`)을 다시 통과해야** 한다. 관리자가 차단한 계정은 14일짜리 Refresh가 남아 있어도 갱신 시점에 끊긴다.

### 로그아웃·강제 차단으로 무상태의 약점을 메우는 법

```text
로그아웃        → revokeRefreshToken(token)     (해당 세션 1개 폐기)
전 기기 로그아웃 → revokeAllForUser(userId)      (그 사용자 모든 refresh 폐기)
관리자 차단/휴면 → revokeAllForUser(userId)      (상태변경과 동시에 전 세션 폐기)
```

여기서 무상태의 한계가 드러난다. **이미 발급된 Access JWT는 만료 전까지 살아 있다.** Refresh를 폐기해도 그 사람의 Access는 최대 30분(기본값)까지 유효하다. 이 틈을 **짧은 Access 수명으로 좁히는 것**이 의도된 안전 마진이다 — "즉시 차단"은 불가능하지만 "30분 안에 자연 만료 + Refresh 갱신 차단"으로 실효적 차단을 만든다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

**구현 완료:**

- Access JWT 발급·검증(`type=access` 구분 포함), HMAC 서명.
- Refresh를 DB UUID로 발급·저장(IP/UA 동반).
- `/auth/refresh`에서 **Refresh 회전**(쓴 토큰 폐기 + 새 토큰 발급) 및 만료·폐기·계정상태 재검증.
- 로그아웃(단일 폐기) / 전 기기 로그아웃(`revokeAllForUser`) / 관리자 상태변경 시 전 세션 폐기.
- 갱신 성공·실패 모두 `user_login_history`에 `event_type=REFRESH`로 감사 기록.
- STATELESS 세션, CSRF/formLogin/httpBasic 비활성, `/api/admin/**` URL 레벨 역할 검사.

**의도된 한계(결함 아님, 트레이드오프):**

- **발급된 Access의 즉시 무효화는 불가** — 짧은 수명으로만 완화. "즉시 강제 로그아웃"을 원하면 Access마다 DB 조회(블랙리스트)가 필요한데, 이는 무상태 이점을 깎으므로 채택하지 않았다.

**관찰 포인트(보안 소재):**

- 프런트는 토큰을 `localStorage`(`careertuner.auth`)에 보관 → XSS 시 노출 위험. 쿠키(HttpOnly) 대비 트레이드오프다.
- OAuth 콜백은 토큰을 URL `#fragment`로 프런트에 넘긴다 — 브라우저 히스토리/로그 노출 가능성.
- 보호 화면은 `withAuthGate`, AI 데이터 화면은 `withConsentGate`로 진입을 차단한다. 이 UX 게이트와 별개로 최종 접근 권위는 서버의 401/403·소유권 검사다.

:::warning 사실 정정
같은 비밀키로 Access JWT와 OAuth state JWT(`type=oauth_state`, 5분)를 모두 서명하지만, **검증 시 `type` 클레임을 확인**하므로 서로의 자리에 쓸 수 없다. "JWT면 다 통과"가 아니다.
:::

## 6. 면접 답변 3단계

**1단계 (한 문장):** "세션을 Access·Refresh 두 토큰으로 이원화했고, Access는 무상태 JWT, Refresh는 DB에 저장한 폐기 가능한 UUID입니다."

**2단계 (왜):** "Access를 무상태로 둬서 서버가 세션을 안 들고도 수평 확장·모바일 대응이 되게 했습니다. 대신 무상태 JWT는 즉시 무효화를 못 하니, 통제가 필요한 Refresh만 DB에 실체로 두고 회전·폐기·세션 감사를 가능하게 했습니다. Access는 짧게(30분), Refresh는 길게(14일) 살려 보안과 사용성을 동시에 잡았습니다."

**3단계 (어떻게):** "`JwtAuthenticationFilter`가 매 요청 Bearer 토큰을 까서 `SecurityContext`에 인증을 채우되, 깨져도 통과시키고 인가는 `SecurityConfig`가 판단합니다. `/auth/refresh`는 들어온 Refresh를 검증·폐기하고 새 토큰 쌍을 발급하는 회전 구조라, 폐기된 Refresh 재사용을 탈취 신호로 걸러냅니다. 로그아웃·관리자 차단은 `revokeAllForUser`로 Refresh를 끊고, 살아 있는 Access는 짧은 수명으로 자연 만료시킵니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. JWT는 즉시 무효화가 안 되는데, 강제 로그아웃은 어떻게 보장하나?
완전한 즉시성은 포기하고 두 가지로 메웁니다. 첫째, Refresh를 `revokeAllForUser`로 끊어 더는 갱신을 못 하게 합니다. 둘째, Access 수명을 30분으로 짧게 잡아 살아 있는 Access도 곧 만료됩니다. 진짜 즉시 차단이 요구되면 Access마다 DB 블랙리스트 조회를 추가해야 하는데, 그러면 무상태 이점이 사라지므로 의도적으로 택하지 않았습니다. 단, 관리자 차단처럼 보안이 급한 경우 만료 전 최대 30분의 잔여 유효 구간이 있다는 점은 정직하게 인지하고 있습니다.
:::

:::details Q2. Refresh를 왜 JWT로 안 하고 DB UUID로 했나?
JWT로 만들면 Refresh도 무상태가 되어 폐기·회전·세션 조회가 불가능해집니다. Refresh의 존재 이유가 바로 "통제"이므로, 일부러 DB에 실체가 있는 opaque UUID로 뒀습니다. 그러면 `revoked` 플래그로 폐기하고, IP·User-Agent를 같이 저장해 활성 세션 목록을 관리자에게 보여줄 수 있습니다. UUID 자체는 정보가 없어 토큰 내용 노출 위험도 없습니다.
:::

:::details Q3. Refresh 회전(rotation)이 정확히 뭐고 왜 하나?
`/auth/refresh`에서 들어온 Refresh를 검증한 뒤 **즉시 폐기하고 완전히 새 Refresh를 발급**하는 겁니다. 한 Refresh가 한 번만 유효해지므로, 이미 폐기된 Refresh가 다시 들어오면 탈취 후 재사용으로 간주해 거부하고 실패 로그를 남깁니다. 토큰이 길게 살수록(14일) 탈취 위험이 커지는데, 회전이 그 위험을 한 번 쓸 때마다 리셋해 줍니다.
:::

:::details Q4. 필터에서 토큰이 깨졌는데 왜 401을 안 던지고 통과시키나?
인증과 인가를 분리하기 위해서입니다. 필터의 책임은 "누구인지" 채우는 것까지고, "이 경로에 접근 권한이 있는지"는 `SecurityConfig`의 URL 규칙이 판단합니다. 그래서 공개 엔드포인트는 토큰 없이도 동작하고, 보호 경로는 인증이 비면 Spring Security가 알아서 401/403을 냅니다. 필터가 직접 401을 던지면 공개 경로 처리가 꼬이고 인가 로직이 두 군데로 흩어집니다.
:::

:::details Q5. STATELESS로 하면 CSRF는 어떻게 되나?
CSRF는 브라우저가 쿠키를 자동 전송하는 점을 악용하는 공격입니다. 이 시스템은 세션 쿠키를 안 쓰고 `Authorization: Bearer` 헤더로 인증하는데, 헤더는 브라우저가 교차 출처 요청에 자동으로 붙여주지 않으므로 CSRF 표면이 사라집니다. 그래서 `SecurityConfig`에서 CSRF를 명시적으로 비활성했습니다. 대신 토큰을 `localStorage`에 두는 구조라 XSS에는 노출되는 트레이드오프가 있습니다.
:::

:::details Q6. Refresh가 아직 안 만료됐는데 갱신을 거부하는 경우가 있나?
네. 토큰 자체가 유효(미폐기·미만료)해도 갱신 시점에 `validateLoginAllowed`로 **계정 상태를 다시 검증**합니다. 관리자가 차단·휴면·삭제 처리한 계정이면, 14일짜리 Refresh가 멀쩡히 남아 있어도 갱신을 거부합니다. 토큰의 유효성과 계정의 자격을 분리해서, 상태 변경이 다음 갱신 시점에 반드시 반영되게 한 겁니다.
:::

## 8. 직접 말해보기

아래를 입 밖으로 막힘없이 설명할 수 있으면 이 주제는 통과다.

1. Access와 Refresh의 형식·수명·보관 위치를 표 없이 줄줄 말하기.
2. `JwtAuthenticationFilter`가 토큰 깨졌을 때 왜 통과시키는지, 인증과 인가 분리로 설명하기.
3. "JWT는 즉시 무효화가 안 된다"는 약점을 어떤 두 가지로 메우는지(Refresh 폐기 + 짧은 Access 수명).
4. Refresh 회전이 탈취 재사용을 어떻게 탐지하는지.
5. Refresh가 멀쩡해도 갱신이 거부될 수 있는 시나리오 하나.

연관 주제: [영역 A 개요](/area-a/), [OAuth 소셜 로그인](/area-a/oauth-social), [동의 게이팅](/area-a/consent-gating).

## 퀴즈

<QuizBox question="Refresh Token을 JWT가 아니라 DB에 저장한 opaque UUID로 구현한 가장 핵심적인 이유는?" :choices="['UUID가 JWT보다 길이가 짧아서', '폐기·회전·세션 감사 같은 통제를 가능하게 하려고', 'JWT 라이브러리를 쓰기 싫어서', 'Refresh는 서명이 필요 없어서']" :answer="1" explanation="Refresh의 존재 이유가 통제(폐기·회전·세션 목록)다. 무상태 JWT로 만들면 이 통제가 전부 불가능해지므로 일부러 DB에 실체가 있는 UUID로 뒀다." />

<QuizBox question="JwtAuthenticationFilter가 유효하지 않은 토큰을 만났을 때의 동작으로 옳은 것은?" :choices="['즉시 401을 응답한다', 'SecurityContext를 비우고 익명으로 요청을 계속 통과시킨다', '예외를 다시 던져 서버를 멈춘다', 'Refresh 토큰으로 자동 재발급한다']" :answer="1" explanation="필터는 인증만 채우고 인가는 SecurityConfig에 맡긴다. 토큰이 깨지면 컨텍스트를 비우고 익명으로 통과시켜, 공개 경로는 동작하고 보호 경로는 Security가 401/403을 낸다." />

<QuizBox question="무상태 JWT(Access)의 '즉시 무효화 불가' 약점을 이 프로젝트가 보완하는 방식 두 가지는?" :choices="['Access 블랙리스트 DB 조회 + 긴 수명', 'Refresh 폐기 + 짧은 Access 수명', '쿠키 암호화 + 세션 고정', 'CSRF 토큰 + 재로그인 강제']" :answer="1" explanation="Refresh를 revokeAllForUser로 끊어 갱신을 막고, Access 수명을 30분으로 짧게 잡아 살아 있는 Access도 곧 자연 만료시킨다. Access 블랙리스트 조회는 무상태 이점을 깎으므로 채택하지 않았다." />

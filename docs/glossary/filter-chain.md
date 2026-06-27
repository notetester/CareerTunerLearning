# 필터 / 필터체인 / 인터셉터

> 요청이 컨트롤러에 닿기 **전후**로 순서대로 거치는 전처리 사슬. 인증·로깅·CORS 같은 "모든 요청에 공통으로 필요한 일"(횡단 관심사)을 한 곳에 모은다.

## 1. 한 줄 정의

필터(Filter)는 서블릿 컨테이너가 컨트롤러보다 먼저 실행하는 요청 가로채기 컴포넌트이고, 필터체인(Filter Chain)은 그런 필터들을 정해진 순서로 줄 세운 사슬이며, 인터셉터(Interceptor)는 그보다 안쪽(Spring MVC 내부)에서 컨트롤러 호출 직전후를 가로채는 컴포넌트다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 어원/의미 | 한 줄 설명 |
| --- | --- | --- |
| Filter | "거르다" (커피 필터) | 들어오는 요청을 거르고 가공한다. 통과시킬지/막을지 결정 |
| Chain | "사슬" | 필터를 일렬로 연결. `chain.doFilter()`로 다음 고리에 넘긴다 |
| Interceptor | inter(사이) + cept(잡다) = "가로채다" | 요청과 핸들러 "사이"에 끼어든다 |
| 횡단 관심사 (cross-cutting concern) | 여러 기능을 "가로질러" 공통으로 필요한 일 | 인증, 로깅, 트랜잭션처럼 컨트롤러마다 반복되는 관심사 |
| `OncePerRequestFilter` | "요청당 한 번" | 포워드/리다이렉트로 같은 요청이 여러 번 돌아도 필터 본문은 1회만 실행 보장 |

핵심 비유: 필터체인은 **공항 보안 검색대 라인**이다. 게이트(컨트롤러)에 가기 전, 여러 검색대(필터)를 순서대로 통과한다. 신분 확인(인증) 검색대에서 막히면 게이트까지 못 간다.

## 3. 왜 필요 (없으면 무슨 문제)

인증 검사를 컨트롤러마다 코드로 넣는다고 상상해 보자.

```java
// 안티패턴: 컨트롤러마다 토큰 검사를 반복
@GetMapping("/api/applications")
public ApiResponse<?> list(HttpServletRequest req) {
    String token = req.getHeader("Authorization"); // 100개 컨트롤러에 100번 복붙
    if (token == null) throw new UnauthorizedException();
    // ...실제 비즈니스 로직
}
```

문제는 명확하다.

- **중복**: 컨트롤러 수백 개에 같은 검사 로직이 흩어진다.
- **누락**: 새 API를 만들 때 검사 한 줄 빼먹으면 그게 곧 보안 구멍.
- **관심사 섞임**: 컨트롤러가 "비즈니스 로직"과 "토큰 파싱"을 동시에 떠안아 읽기 어렵다.

필터체인은 이 공통 작업을 **컨트롤러 바깥 한 곳**으로 끌어낸다. 컨트롤러는 "이미 인증된 사용자가 들어온다"고 가정하고 본업에만 집중한다. CareerTuner도 [JWT 인증](/backend/jwt-security)을 컨트롤러가 아니라 필터 한 곳에서 처리한다.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner는 Spring Security 필터체인에 커스텀 필터 하나를 꽂아 JWT를 처리한다.

| 구성 요소 | 파일 | 역할 |
| --- | --- | --- |
| `JwtAuthenticationFilter` | `backend/.../common/security/JwtAuthenticationFilter.java` | `Authorization: Bearer ...` 헤더를 파싱해 `SecurityContext`에 인증 주입 |
| `SecurityConfig` | `backend/.../common/config/SecurityConfig.java` | `SecurityFilterChain` 빈 정의. 공개/보호 URL 규칙, 필터 삽입 위치 결정 |
| `JwtTokenProvider` | `backend/.../common/security/JwtTokenProvider.java` | 토큰 파싱·검증(Access 30분/Refresh 14일). 필터가 호출 |

**필터 본문** — 토큰이 있으면 인증을 세팅하고, 없거나 깨졌으면 익명으로 그냥 통과시킨다. 막는 건 필터가 아니라 뒤의 인가 규칙(`SecurityConfig`)이 한다.

```java
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtTokenProvider tokenProvider;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            try {
                AuthUser user = tokenProvider.parseAccessToken(header.substring(7));
                var authentication = new UsernamePasswordAuthenticationToken(
                        user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (Exception ignored) {
                SecurityContextHolder.clearContext(); // 유효하지 않은 토큰 → 익명
            }
        }
        chain.doFilter(request, response); // 다음 고리로 넘김 (핵심!)
    }
}
```

**삽입 위치** — `SecurityConfig`에서 `addFilterBefore(...)`로 표준 폼 로그인 필터 앞에 끼운다.

```java
.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
```

즉 CareerTuner의 인증은 "JWT를 먼저 검사 → 그다음 Spring 표준 처리" 순서로 흐른다.

:::tip CareerTuner가 STATELESS인 이유
`SecurityConfig`는 `SessionCreationPolicy.STATELESS`다. 서버가 세션을 안 만들기 때문에 매 요청마다 필터가 토큰을 읽어 그 요청 한 번의 `SecurityContext`만 채운다. 요청이 끝나면 컨텍스트도 사라진다. 자세한 비교는 [토큰·세션·쿠키](/glossary/token-session-cookie) 참고.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

### 요청 한 번의 흐름

```text
[클라이언트] → 서블릿 컨테이너
   → CorsFilter            (CORS 헤더 검사)
   → JwtAuthenticationFilter (Bearer 파싱 → SecurityContext 세팅)  ← CareerTuner 커스텀
   → AuthorizationFilter   (SecurityConfig 규칙으로 인가 판정)
   → DispatcherServlet
       → [인터셉터 preHandle]
           → 컨트롤러 (이미 인증된 사용자 가정)
       → [인터셉터 postHandle / afterCompletion]
   ← 응답이 같은 사슬을 역순으로 빠져나옴
```

`chain.doFilter()` 호출 전 코드는 **요청이 들어갈 때**, 호출 후 코드는 **응답이 나갈 때** 실행된다. 그래서 필터는 "요청 들어옴 → 다음으로 넘김 → 응답 받아 나감"을 한 메서드에서 감쌀 수 있다(예: 응답 시간 측정).

### 필터 vs 인터셉터 vs 프론트 미들웨어

세 개를 헷갈리는 게 흔한 함정이다. 위치와 소관이 다르다.

| 구분 | 필터 (Filter) | 인터셉터 (Interceptor) | 프론트 미들웨어 |
| --- | --- | --- | --- |
| 소속 | 서블릿 컨테이너 (Spring 바깥) | Spring MVC (DispatcherServlet 안쪽) | 브라우저/클라이언트 |
| 작동 시점 | DispatcherServlet **전후** | 컨트롤러 호출 **직전후** | 요청을 **보내기 전** |
| 알 수 있는 정보 | 원시 `HttpServletRequest`/`Response` | 어떤 핸들러(컨트롤러)가 매핑됐는지 | 앱 상태(토큰 등) |
| 표준 인터페이스 | `jakarta.servlet.Filter` | `HandlerInterceptor` | 라이브러리/직접 구현 |
| CareerTuner 사례 | `JwtAuthenticationFilter` (인증) | (현재 별도 커스텀 인터셉터 없음) | `api.ts`의 401 자동 refresh |

**프론트 미들웨어**는 CareerTuner에서 `frontend/src/app/lib/api.ts`의 `api<T>()` 함수가 맡는다. 모든 요청에 토큰을 붙이고, 응답이 401이면 자동으로 `/auth/refresh`를 한 번만 호출(단일 플라이트)한 뒤 원 요청을 재시도한다. 서버 필터의 "들어오는 요청 가로채기"와 대칭으로, 이건 "나가는 요청 가로채기"다.

```ts
// api.ts — 클라이언트 쪽 "필터": 응답 가로채 401이면 토큰 갱신 후 재시도
let res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options, withAuth) });
if (res.status === 401 && withAuth && getRefreshToken()) {
  const refreshed = await tryRefresh();      // 동시 401에도 refresh는 단 한 번
  if (refreshed) res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options, true) });
}
```

자세한 프론트 동작은 [API 레이어와 JWT 리프레시](/frontend/api-layer-jwt-refresh) 참고.

:::warning DispatcherType 함정
CareerTuner `SecurityConfig`에는 `dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll()`이 있다. AutoPrep의 SSE 같은 비동기 응답은 같은 요청이 ASYNC 디스패치로 다시 필터체인을 타는데, 이때 또 인증을 요구하면 401이 난다. 그래서 "원 요청에서 이미 인증됨"을 근거로 재디스패치는 허용한다. 필터체인이 요청당 한 번이 아니라 **디스패치당** 도는 경우가 있다는 증거다.
:::

## 6. 면접 답변 3단계

**초간단 (한 문장)**
"필터체인은 요청이 컨트롤러에 닿기 전 순서대로 거치는 전처리 사슬이고, CareerTuner는 거기에 JWT 인증 필터를 꽂아 토큰을 검증합니다."

**기본 (3~4문장)**
"인증·로깅 같은 횡단 관심사를 컨트롤러마다 중복하지 않으려고 필터체인으로 뺐습니다. CareerTuner는 `JwtAuthenticationFilter`를 `OncePerRequestFilter`로 만들어 `Authorization: Bearer` 헤더를 파싱하고, 유효하면 `SecurityContext`에 인증을 채웁니다. 토큰이 없거나 깨졌으면 막지 않고 익명으로 통과시키며, 실제 차단은 `SecurityConfig`의 인가 규칙이 합니다. 세션을 안 쓰는 STATELESS 구조라 매 요청마다 필터가 토큰을 다시 읽습니다."

**꼬리질문 대비 (요약)**
"필터는 서블릿 레벨이라 원시 요청·응답을 다루고, 인터셉터는 Spring MVC 안쪽이라 어떤 컨트롤러가 매핑됐는지까지 압니다. 프론트의 `api.ts`는 클라이언트 쪽 미들웨어로, 나가는 요청에 토큰을 붙이고 401이면 refresh 후 재시도합니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 필터에서 토큰이 없으면 왜 401을 던지지 않고 그냥 통과시키나요?
관심사 분리 때문입니다. 필터의 일은 "인증 정보를 채우는 것(authentication)"이고, "이 요청이 인증을 요구하는지 판정하는 것(authorization)"은 별개입니다. 공개 엔드포인트(`/api/auth/login`, `/api/health`, 커뮤니티 글 조회 등)는 토큰 없이도 허용돼야 하므로, 필터가 무조건 막으면 그 규칙을 표현할 수 없습니다. 그래서 필터는 토큰이 있으면 채우기만 하고, 차단 여부는 뒤의 `AuthorizationFilter`가 `SecurityConfig` 규칙(`anyRequest().authenticated()`)으로 판정합니다. 인증/인가 구분은 [인증·인가](/glossary/auth-authn-authz) 참고.
:::

::: details Q2. `OncePerRequestFilter`를 쓴 이유는? 그냥 `Filter`면 안 되나요?
포워드/에러 재디스패치 같은 내부 재진입이 일어나면 같은 요청에 필터가 여러 번 호출될 수 있습니다. 토큰 파싱을 중복 실행하면 낭비고, 컨텍스트를 덮어쓰는 부작용도 생길 수 있습니다. `OncePerRequestFilter`는 요청 속성으로 실행 여부를 추적해 본문(`doFilterInternal`)이 요청당 한 번만 돌도록 보장합니다. Spring Security 인증 필터의 사실상 표준 베이스입니다.
:::

::: details Q3. 필터와 인터셉터, 같은 일을 한다면 어디에 무엇을 둬야 하나요?
경계가 다릅니다. 인증·CORS처럼 Spring이 요청을 받기도 전에, 원시 요청 수준에서 결정해야 하는 건 필터가 맞습니다(그래서 JWT는 필터). 반대로 "어떤 컨트롤러/핸들러가 호출되는지"에 의존하는 로직(예: 특정 어노테이션이 붙은 메서드만 권한 추가 로깅)은 인터셉터가 적합합니다. 인터셉터는 `handler` 객체를 받기 때문입니다. CareerTuner는 인증을 필터에 두고, 메서드 단위 권한은 `@EnableMethodSecurity` 기반 어노테이션으로 처리합니다.
:::

::: details Q4. `addFilterBefore(..., UsernamePasswordAuthenticationFilter.class)`에서 "Before"가 왜 중요한가요?
필터는 **순서**가 전부입니다. JWT 필터가 표준 인증 필터보다 **앞**에 와야, 우리가 먼저 토큰을 읽어 `SecurityContext`를 채운 상태로 이후 인가 단계가 그 인증 정보를 보고 판정할 수 있습니다. 순서를 뒤로 두면 인가 시점에 컨텍스트가 비어 있어 보호 API가 전부 401이 됩니다. 폼 로그인은 비활성화했지만, 그 필터를 위치 기준점(anchor)으로 삼아 "그 앞"이라고 명시한 것입니다.
:::

::: details Q5. 동시에 여러 요청이 401을 받으면 refresh가 여러 번 일어나지 않나요?
프론트 `api.ts`에서 `refreshPromise` 하나를 공유해 막습니다. 첫 401이 refresh를 시작하면 동시에 들어온 다른 401들은 같은 프라미스를 기다렸다가, 갱신된 토큰으로 각자 원 요청을 재시도합니다. 이른바 단일 플라이트(single-flight)입니다. 이게 없으면 토큰 한 개를 두고 여러 refresh가 경쟁해 refresh 토큰이 무효화되는 사고가 납니다.
:::

## 8. 직접 말해보기

아래를 막힘 없이 소리 내어 설명할 수 있으면 이 주제는 합격이다.

1. 필터체인을 공항 보안 검색대에 비유해 1분 안에 설명하기.
2. CareerTuner의 `JwtAuthenticationFilter`가 하는 일과 **하지 않는 일**(차단)을 구분해 말하기.
3. 필터 / 인터셉터 / 프론트 미들웨어의 위치 차이를 "서블릿 바깥 / MVC 안쪽 / 클라이언트"로 짚기.
4. `addFilterBefore`의 순서가 왜 인가 결과를 좌우하는지 설명하기.
5. STATELESS라서 매 요청 필터가 토큰을 다시 읽는다는 점을, 세션 방식과 대비해 말하기.

## 퀴즈

<QuizBox question="CareerTuner의 JwtAuthenticationFilter는 Bearer 토큰이 없을 때 어떻게 동작하는가?" :choices="['즉시 401을 응답한다', '막지 않고 익명으로 통과시키며 차단은 인가 규칙이 한다', '세션을 생성해 로그인 페이지로 리다이렉트한다', '예외를 던져 GlobalExceptionHandler가 처리한다']" :answer="1" explanation="필터는 인증 정보를 채우기만 하고, 차단(인가)은 SecurityConfig의 authorizeHttpRequests 규칙이 판정한다. 공개 엔드포인트를 허용하려면 필터가 무조건 막아선 안 된다." />

<QuizBox question="필터, 인터셉터, 프론트 미들웨어의 위치를 가장 정확히 짝지은 것은?" :choices="['셋 다 Spring MVC 안에서 동작한다', '필터=서블릿 컨테이너, 인터셉터=Spring MVC 내부, 미들웨어=클라이언트', '필터=클라이언트, 인터셉터=서블릿, 미들웨어=DB', '필터와 인터셉터는 같은 레벨이고 미들웨어만 다르다']" :answer="1" explanation="필터는 DispatcherServlet 바깥(서블릿 컨테이너), 인터셉터는 DispatcherServlet 안쪽(어떤 핸들러가 매핑됐는지 안다), 프론트 미들웨어는 클라이언트에서 나가는 요청을 가로챈다." />

<QuizBox question="SecurityConfig에서 addFilterBefore로 JwtAuthenticationFilter를 표준 인증 필터 '앞'에 두는 이유를 설명하라." explanation="필터는 순서가 핵심이다. JWT 필터가 먼저 실행돼 토큰을 파싱하고 SecurityContext에 인증을 채워야, 그 뒤의 인가 단계가 채워진 인증 정보를 보고 접근 허용/차단을 판정할 수 있다. 순서가 뒤면 인가 시점에 컨텍스트가 비어 보호 API가 전부 401이 된다." />

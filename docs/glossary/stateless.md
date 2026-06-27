# 무상태 (Stateless)

> 서버가 요청과 요청 사이에 아무 기억도 갖지 않는다. 매 요청이 스스로 인증·맥락을 들고 와서 자기완결적으로 처리된다.

## 1. 한 줄 정의

무상태(Stateless)는 **서버가 클라이언트의 직전 요청 상태(세션)를 저장하지 않고, 각 요청을 그 요청만으로 완결되게 처리하는** 설계 원칙이다. "누구냐"는 매번 요청에 담긴 토큰으로 다시 확인한다.

## 2. 단어 뜻 (약자·어원)

- **State** = 상태. 여기서는 "이 사용자가 누구이고, 직전에 무엇을 했는지"를 서버 메모리에 들고 있는 것.
- **-less** = 없음. 그래서 Stateless = "상태 없음".
- 반대말은 **Stateful**(상태 보존). 전통적 로그인 방식이 여기에 해당한다: 서버가 `HttpSession`을 만들어 메모리에 사용자 정보를 들고 있고, 클라이언트는 `JSESSIONID` 쿠키로 "내 세션 좀 찾아줘"라고 요청한다.
- REST(Representational State Transfer)의 6가지 제약 중 하나가 바로 **Statelessness**다. 즉 무상태는 REST API가 REST답기 위한 핵심 조건이다. 관련: [REST API](/glossary/rest-api).

:::tip 상태가 "없다"는 게 아니다
무상태라고 데이터가 사라지는 게 아니다. 사용자·지원 건 같은 **영속 상태는 DB에 있다**. 없애는 건 "이 연결/세션에 묶인 휘발성 메모리 상태"다. 상태를 서버 메모리에서 DB·토큰 같은 명시적 저장소로 옮긴 것이다.
:::

## 3. 왜 필요 (없으면 무슨 문제)

Stateful 세션 방식은 작은 서버 한 대에서는 잘 돌지만 다음 문제를 만든다.

| 상황 | Stateful(세션) | Stateless(토큰) |
| --- | --- | --- |
| 서버 2대로 늘릴 때 | A서버가 만든 세션을 B서버는 모름 → 로그인 풀림 | 어느 서버든 토큰만 검증하면 됨 |
| 서버 재시작/배포 | 메모리 세션 날아감 → 전원 재로그인 | 영향 없음(서버가 기억하는 게 없음) |
| 부하 분산(로드밸런서) | "같은 사람은 같은 서버로"(sticky session) 강제 필요 | 아무 서버로 보내도 됨 |
| 메모리 | 접속자 수만큼 세션 메모리 증가 | 서버는 세션을 안 들고 있음 |

핵심은 **수평 확장(scale-out)과 서버 교체의 자유**다. CareerTuner는 AI 분석·SSE 진행 보고처럼 트래픽이 들쭉날쭉한 작업이 있어, "서버를 부담 없이 늘리고 줄일 수 있는" 무상태 구조가 운영상 유리하다.

:::warning 공짜는 아니다
무상태의 대가: (1) 한 번 발급한 토큰은 만료 전까지 서버가 "취소"하기 까다롭다(블랙리스트나 짧은 만료가 필요). (2) 토큰을 매 요청 검증하는 비용이 든다. 그래서 CareerTuner는 **Access 토큰은 짧게(30분), Refresh 토큰은 DB에 저장**해 무상태와 통제 가능성의 균형을 맞춘다. 비교: [토큰·세션·쿠키](/glossary/token-session-cookie).
:::

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner 백엔드는 Spring Security를 명시적으로 무상태로 설정했다.

**`common/config/SecurityConfig.java`** — 세션을 아예 만들지 않도록 선언한다.

```java
.sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
.httpBasic(basic -> basic.disable())
.formLogin(form -> form.disable())
```

- `STATELESS`: Spring Security가 `HttpSession`을 생성하지도, 참조하지도 않는다.
- `formLogin`/`httpBasic` 비활성화: 세션 기반 로그인 폼 대신 JWT로만 인증한다.
- CORS 허용 오리진은 `http://localhost:5173`(Vite), `capacitor://localhost`(iOS WebView), `http://localhost`(Android WebView)이고 `CORS_ALLOWED_ORIGINS` 환경변수로 교체한다.

**`common/security/JwtAuthenticationFilter.java`** — "매 요청이 자기완결"을 구현하는 곳. 요청마다 `Authorization: Bearer <토큰>`을 파싱해 인증을 다시 채운다.

```java
String header = request.getHeader("Authorization");
if (header != null && header.startsWith("Bearer ")) {
    AuthUser user = tokenProvider.parseAccessToken(header.substring(7));
    var authentication = new UsernamePasswordAuthenticationToken(
            user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role())));
    SecurityContextHolder.getContext().setAuthentication(authentication);
}
chain.doFilter(request, response);
```

이 필터는 `OncePerRequestFilter`다. 즉 **요청 하나마다 SecurityContext를 새로 만들고**, 요청이 끝나면 그 컨텍스트는 버려진다. 서버는 다음 요청 때 "이 사람 누구였더라"를 기억하지 않고, 다시 토큰을 보고 판단한다. 이것이 무상태의 실체다.

:::details 무상태인데 SSE는 어떻게? (실제 코드의 디테일)
AutoPrep 오케스트레이터는 SSE로 실시간 진행을 보고한다. SSE/비동기 응답은 서블릿이 원 요청과 별개의 `ASYNC`/`ERROR` 디스패치로 다시 들어오는데, 이때는 헤더가 없어 토큰 재검증을 못 한다. 그래서 `SecurityConfig`는 이렇게 예외를 둔다.

```java
.dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll()
```

원 요청에서 이미 인증됐으므로 재디스패치는 허용한다. 이게 없으면 SSE가 401로 끊긴다. "무상태"라고 해서 모든 디스패치를 똑같이 다루면 안 된다는 실전 교훈.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

한 번의 보호된 API 호출 흐름:

```text
[클라이언트]                         [서버 — 아무것도 기억 안 함]
  Authorization: Bearer eyJ...  ──▶  JwtAuthenticationFilter
                                       └ 토큰 서명·만료 검증
                                       └ SecurityContext에 인증 주입 (이번 요청만)
                                     컨트롤러 처리 → ApiResponse 반환
  ◀── 응답                            요청 끝 → SecurityContext 폐기
```

| 비교 축 | Stateful(세션) | Stateless(CareerTuner) |
| --- | --- | --- |
| "누구냐"의 출처 | 서버 메모리의 세션 객체 | 요청의 JWT 클레임 |
| 클라이언트가 보내는 것 | `JSESSIONID` 쿠키 | `Authorization: Bearer` 헤더 |
| 검증 위치 | 세션 저장소 조회 | 토큰 서명 검증(`JwtTokenProvider`) |
| 서버 메모리 | 접속자 수에 비례 | 거의 없음 |
| 로그아웃 | 세션 즉시 삭제로 끝 | Access는 만료까지 유효, Refresh는 DB에서 무효화 |

CareerTuner의 토큰 수명(`JwtTokenProvider`): **Access 30분 / Refresh 14일(DB 저장) / OAuth state 5분**. 만료된 Access는 프론트 `app/lib/api.ts`가 401을 감지해 단일 비행(single-flight) `/auth/refresh`로 자동 갱신한다. 관련: [프론트 API 레이어·리프레시](/frontend/api-layer-jwt-refresh), [JWT 보안](/backend/jwt-security).

## 6. 면접 답변 3단계 (초간단/기본/꼬리질문)

- **초간단**: "무상태는 서버가 요청 사이의 세션을 안 들고 있는 거예요. CareerTuner는 매 요청에 JWT를 실어 보내고 서버가 그걸 다시 검증합니다."
- **기본**: "Spring Security를 `SessionCreationPolicy.STATELESS`로 설정해 `HttpSession`을 안 만들고, `JwtAuthenticationFilter`가 요청마다 `Authorization: Bearer` 헤더를 파싱해 `SecurityContext`를 그 요청 동안만 채웁니다. 덕분에 어느 서버 인스턴스로 요청이 가도 동일하게 동작해 수평 확장과 무중단 배포가 쉬워집니다."
- **꼬리질문 대비**: "무상태의 대가인 '토큰 즉시 취소가 어렵다'는 문제는 Access를 30분으로 짧게 두고, Refresh를 DB에 저장해 로그아웃 시 그 레코드를 무효화하는 방식으로 보완했습니다. 완전 무상태가 아니라 '인증은 무상태, 세션 통제는 최소한의 상태'를 의도적으로 섞은 구조입니다."

## 7. 꼬리질문 + 모범답안

**Q1. 무상태인데 로그아웃은 어떻게 처리하나요? 토큰을 서버가 못 지우잖아요.**
A. Access 토큰은 서명만 맞으면 만료 전까지 유효해서 서버가 직접 못 지웁니다. 그래서 두 가지로 막습니다. (1) Access 수명을 30분으로 짧게 둔다. (2) Refresh 토큰은 DB에 저장하므로, 로그아웃 시 해당 Refresh 레코드를 삭제·무효화하면 그 이후로는 토큰 재발급이 막힙니다. 즉시성이 중요한 경우라면 짧은 만료 + Refresh 무효화 조합으로 실질적 로그아웃을 만듭니다.

**Q2. 진짜 100% 무상태인가요?**
A. 인증 판단은 무상태입니다. 다만 사용자·지원 건은 MySQL에, Refresh 토큰도 DB에 있습니다. 무상태가 의미하는 건 "연결/세션에 묶인 휘발성 서버 메모리 상태가 없다"는 것이지 "데이터가 없다"가 아닙니다. CareerTuner는 인증을 무상태로 두되 통제용 상태(Refresh)는 명시적으로 DB에 둬서, 무상태의 확장성과 통제 가능성을 함께 가져갑니다.

**Q3. 무상태면 CSRF 방어는 왜 꺼뒀나요?**
A. CSRF 공격은 브라우저가 쿠키를 자동으로 실어 보내는 것을 악용합니다. CareerTuner는 인증을 쿠키가 아니라 JS가 명시적으로 붙이는 `Authorization` 헤더로 합니다. 공격 사이트는 그 헤더를 임의로 못 붙이므로 CSRF 표면이 사라져 `csrf.disable()`이 정당화됩니다. 대신 토큰을 어디 저장하느냐(XSS 위험)에 신경 써야 합니다.

**Q4. SSE/비동기 응답이 401로 끊긴 적은 없나요?**
A. 있을 수 있어서 막아뒀습니다. 서블릿의 `ASYNC`/`ERROR` 디스패치는 헤더가 없어 토큰 재검증을 못 하는데, 원 요청에서 이미 인증된 흐름입니다. 그래서 `dispatcherTypeMatchers(ASYNC, ERROR).permitAll()`로 재디스패치를 허용했습니다. 무상태 설정이라도 디스패치 타입까지 고려해야 SSE가 안 끊깁니다.

**Q5. 무상태가 항상 정답인가요?**
A. 아닙니다. 단일 서버에 트래픽이 작고 서버측 세션 무효화가 자주 필요한 서비스라면 Stateful 세션이 더 단순할 수 있습니다. 무상태는 "여러 인스턴스로 확장·무중단 배포가 중요할 때" 빛납니다. CareerTuner는 AI 작업 부하가 들쭉날쭉해 확장 자유가 중요해서 무상태를 택했습니다.

## 8. 직접 말해보기

다음을 막힘 없이 입으로 설명할 수 있으면 이 페이지를 이해한 것이다.

1. Stateful과 Stateless의 차이를, "서버가 무엇을 기억하느냐" 관점에서 한 문장으로.
2. CareerTuner의 `SecurityConfig`에서 무상태를 만드는 한 줄과, 그게 무슨 효과인지.
3. `JwtAuthenticationFilter`가 "매 요청 자기완결"을 어떻게 구현하는지 흐름으로.
4. 무상태의 단점 한 가지와, CareerTuner가 그걸 어떻게 보완했는지(Access 만료 + Refresh DB 무효화).

## 퀴즈

<QuizBox question="CareerTuner 백엔드가 무상태 인증을 만드는 핵심 설정은?" :choices="['HttpSession 풀 크기를 0으로 설정', 'SecurityConfig에서 SessionCreationPolicy.STATELESS 설정', 'JSESSIONID 쿠키를 HttpOnly로 설정', 'Redis 세션 클러스터 구성']" :answer="1" explanation="SecurityConfig.java가 sessionManagement에서 SessionCreationPolicy.STATELESS로 선언해 Spring Security가 HttpSession을 만들지도 참조하지도 않게 한다. 인증은 매 요청 JWT로 다시 판단한다." />

<QuizBox question="무상태 구조의 장점으로 가장 적절한 것은?" :choices="['서버를 늘려도 sticky session 없이 어느 인스턴스로든 요청을 보낼 수 있다', '한 번 발급한 토큰을 서버가 즉시 취소하기 쉽다', '클라이언트가 토큰을 보내지 않아도 인증된다', 'CSRF 공격에 자동으로 면역된다']" :answer="0" explanation="무상태는 서버가 세션을 안 들고 있어 수평 확장과 무중단 배포가 쉽다. 토큰 즉시 취소는 오히려 무상태의 약점이라 짧은 만료+Refresh DB 무효화로 보완한다." />

<QuizBox question="무상태(STATELESS)로 설정하면 사용자·지원 건 데이터도 사라지는가? 그렇지 않다면 무상태가 없애는 것은 무엇인가?" explanation="사라지지 않는다. 영속 데이터(사용자, 지원 건, Refresh 토큰)는 MySQL에 그대로 있다. 무상태가 없애는 것은 '연결/세션에 묶인 휘발성 서버 메모리 상태(HttpSession)'다. 상태를 서버 메모리에서 토큰·DB라는 명시적 저장소로 옮긴 것이지 데이터를 버린 것이 아니다." />

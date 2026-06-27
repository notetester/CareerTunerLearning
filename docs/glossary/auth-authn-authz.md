# 인증 vs 인가 (Authentication / Authorization)

> 인증은 "너 누구냐"를 확인하는 것이고, 인가는 "그걸 할 권한이 있냐"를 확인하는 것이다. 둘은 항상 인증 → 인가 순서로 일어난다.

## 1. 한 줄 정의

- **인증(Authentication)**: 요청을 보낸 주체가 **누구인지** 신원을 확인하는 절차.
- **인가(Authorization)**: 확인된 그 주체가 **이 작업을 해도 되는지** 권한을 판단하는 절차.

먼저 누구인지 알아야(인증) 그 사람이 뭘 할 수 있는지 따질 수 있다(인가). 순서가 거꾸로 될 수 없다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 줄임말 | 어원 | 핵심 질문 |
| --- | --- | --- | --- |
| Authentication | **AuthN** (끝의 N) | authentic = 진짜의 | "이 사람이 진짜 본인 맞아?" |
| Authorization | **AuthZ** (끝의 Z) | authorize = 권한을 주다 | "이 사람이 이걸 해도 돼?" |

실무에서 둘 다 "auth"로 줄여 부르다 보니 헷갈린다. 그래서 끝 글자를 따 **AuthN / AuthZ**로 구분한다. 면접에서 이 약자를 정확히 쓰면 개념을 제대로 이해한 신호가 된다.

:::tip 한 문장 비유
공항에서 **여권 확인 = 인증**(너 누구야), **탑승권으로 비즈니스 라운지 출입 = 인가**(거기 들어갈 자격 있어). 여권 없이는 탑승권도 무의미하다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **인증이 없으면**: 누구나 아무 계정으로 행세할 수 있다. 남의 지원 건(Application Case)이나 분석 결과를 마음대로 본다.
- **인가가 없으면**: 신원은 확인됐지만 권한 구분이 없다. 일반 사용자가 `/api/admin/**` 같은 관리자 API를 그대로 호출해 다른 사람의 결제 내역·AI 사용량을 조회한다.
- **둘을 안 나누면**: "로그인만 하면 다 된다"는 위험한 시스템이 된다. 인증과 인가는 **별개의 방어선**이라 따로 둬야 한다.

CareerTuner는 크레딧 차감(`ai_usage_log`, `INSUFFICIENT_CREDIT`)과 관리자 운영 기능이 있어서, "로그인 여부"만으로는 부족하고 "무슨 역할이냐"까지 따져야 한다.

## 4. CareerTuner에서 어디에 썼나 (영역: 백엔드 공통 / Owner 팀장)

> 인증/인가는 공통 보안 영역(`common/`)이라 영역 C 단독 소유가 아니다. 아래는 실제 구현된 코드 기준이다.

| 구분 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| 인증 (토큰 발급·검증) | `common/security/JwtTokenProvider` | Access 토큰 생성/파싱, OAuth state 토큰(5분 CSRF 방지) |
| 인증 (요청마다 신원 채움) | `common/security/JwtAuthenticationFilter` | `Authorization: Bearer` 파싱 → `SecurityContext`에 인증 주입 |
| 인가 (URL 레벨) | `common/config/SecurityConfig` | 경로별 접근 정책. `/api/admin/**` → `hasAnyRole("ADMIN","SUPER_ADMIN")` |
| 인가 (메서드 레벨) | `@EnableMethodSecurity` + `@PreAuthorize("hasRole('ADMIN')")` | 컨트롤러 단위 권한. 예: `AdminModerationController` |
| 인가 (서비스 레벨) | `requireAdmin(authUser)` 가드 + `AdminAiUsageService` | 서비스 진입부에서 역할 재검사, 미충족 시 `FORBIDDEN` |
| 인가 위반 응답 | `BusinessException` + `ErrorCode.FORBIDDEN` / `UNAUTHORIZED` | `ApiResponse` 엔벨로프로 통일된 에러 |

핵심 포인트: CareerTuner는 인가를 **세 겹**으로 친다 — URL 매칭(`SecurityConfig`) → 메서드 애너테이션(`@PreAuthorize`) → 서비스 로직(`requireAdmin`). 한 겹이 빠져도 다음 겹이 막는 방어적 다층 구조다.

:::warning 흔한 오해
필터(`JwtAuthenticationFilter`)는 토큰이 없거나 깨졌어도 **막지 않고 익명으로 통과**시킨다. 실제 차단은 그 뒤의 `SecurityConfig`(인가 단계)가 한다. 즉 **필터 = 인증, SecurityConfig = 인가**로 역할이 깔끔히 분리돼 있다.
:::

## 5. 핵심 동작 원리 (요청 한 건의 흐름)

```text
요청: GET /api/admin/ai-usage   (Header: Authorization: Bearer eyJ...)

1) JwtAuthenticationFilter        ← 인증(AuthN)
   - "Bearer " 떼고 토큰 파싱
   - 서명·만료·type=access 검증
   - 통과 시 SecurityContext에 AuthUser(role=...) 저장
   - 실패해도 막지 않고 익명으로 통과(컨텍스트 clear)

2) SecurityConfig 인가 규칙       ← 인가(AuthZ) 1차
   - /api/admin/** 는 hasAnyRole("ADMIN","SUPER_ADMIN")
   - role이 USER면 여기서 차단 → 403

3) @PreAuthorize("hasRole('ADMIN')")  ← 인가 2차 (해당 컨트롤러)

4) requireAdmin(authUser)             ← 인가 3차 (서비스 로직)
   - 통과해야 비로소 비즈니스 로직 실행
```

토큰에 담기는 클레임(실제 `createAccessToken` 기준):

```text
subject = userId
email   = 사용자 이메일
role    = USER / ADMIN / SUPER_ADMIN   ← 인가 판단의 근거
type    = "access"                     ← refresh 토큰과 구분
exp     = 발급 + accessTokenValiditySeconds
```

여기서 `role` 클레임이 **인증 결과이자 인가의 입력**이라는 점이 둘을 잇는 다리다. 필터가 `ROLE_` 접두사를 붙여(`ROLE_ADMIN`) Spring Security 권한으로 변환하면, `hasRole("ADMIN")`이 그걸 보고 판단한다.

:::details 왜 STATELESS인가
`SecurityConfig`는 `SessionCreationPolicy.STATELESS`다. 서버가 세션을 저장하지 않고, **요청마다 토큰만 보고** 매번 새로 인증한다. 그래서 확장(scale-out)이 쉽고, SPA·모바일(Capacitor)에서 동일하게 쓴다. 대신 인증 상태를 토큰 자체에 담으므로 토큰 유출/만료 관리가 중요해진다(그래서 Access는 짧게, Refresh는 DB `refresh_token`에 저장).
:::

## 6. 면접 답변 3단계

1. **초간단 1문장**: "인증은 너 누구냐를 확인하는 거고, 인가는 그걸 할 권한이 있냐를 확인하는 거예요. 인증이 먼저고 인가가 그다음입니다."
2. **기본**: "저희 프로젝트는 JWT로 인증합니다. `JwtAuthenticationFilter`가 요청마다 Bearer 토큰을 검증해 누구인지(role 포함) `SecurityContext`에 채우고, 그 뒤 `SecurityConfig`가 경로별로 인가를 판단합니다. 예를 들어 `/api/admin/**`는 ADMIN 역할만 통과시킵니다."
3. **꼬리질문 대응**: "인가는 한 겹이 아니라 URL 레벨(`SecurityConfig`), 메서드 레벨(`@PreAuthorize`), 서비스 레벨(`requireAdmin`) 세 겹으로 막습니다. 필터는 토큰이 없으면 막지 않고 익명으로 통과시키고, 실제 차단은 인가 단계가 하도록 책임을 분리했습니다. 세션은 STATELESS라 매 요청 토큰만으로 판단합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 인증과 인가, 어느 게 먼저인가요? 왜죠?**
인증이 먼저입니다. 누구인지 모르면 권한을 따질 근거(role)가 없기 때문입니다. CareerTuner도 필터가 신원을 채운 뒤에야 `SecurityConfig`가 역할을 봅니다.

**Q2. 401과 403의 차이는?**
401 Unauthorized는 **인증 실패**(토큰 없음·만료·위조 → 너 누구인지 모르겠다), 403 Forbidden은 **인가 실패**(인증은 됐는데 권한이 없다)입니다. CareerTuner는 인증 실패를 `authenticationEntryPoint`로 401, 권한 부족을 `ErrorCode.FORBIDDEN`으로 처리합니다.

**Q3. 토큰에 role을 넣는데, 사용자가 위조하면요?**
JWT는 서버 시크릿으로 HMAC 서명되어 있어, 페이로드를 바꾸면 서명 검증(`verifyWith(key)`)에서 깨집니다. `parseAccessToken`이 예외를 던지고 필터가 익명 처리하므로 위조된 role은 통하지 않습니다. 단, 페이로드는 암호화가 아니라 인코딩일 뿐이라 **비밀 정보는 토큰에 담지 않습니다**.

**Q4. URL 레벨 인가가 있는데 왜 `@PreAuthorize`와 서비스 가드까지 두나요?**
다층 방어입니다. URL 규칙은 경로 패턴 실수에 취약하고, 새 엔드포인트를 깜빡 빠뜨릴 수 있습니다. 메서드/서비스 레벨 가드가 있으면 한 겹이 뚫려도 다음 겹이 막습니다. 특히 정렬·필터 화이트리스트 같은 세밀한 검증은 서비스에서 합니다.

**Q5. 인증을 필터에서 하는 이유는?**
모든 요청에 공통으로 적용돼야 하고, 컨트롤러 로직보다 앞서 실행돼야 하기 때문입니다. `OncePerRequestFilter`로 요청당 한 번 토큰을 풀어 `SecurityContext`에 넣어두면, 이후 컨트롤러·서비스는 "이미 인증된 사용자"를 전제로 깔끔하게 동작합니다.

## 8. 직접 말해보기

1. 화이트보드 없이 1분 안에: "요청 하나가 `/api/admin/ai-usage`에 들어왔을 때, 인증과 인가가 각각 어디서 어떻게 일어나는지" 흐름을 순서대로 말해보라.
2. 후배가 "로그인했는데 왜 403이 떠요?"라고 물었다. 401이 아니라 403인 이유를 인증/인가 개념으로 설명해보라.

관련 페이지: [JWT 인증과 Spring Security](/backend/jwt-security) · [DTO](/glossary/dto) · [ApiResponse 엔벨로프](/glossary/api-response-envelope)

## 퀴즈

<QuizBox question="인증(AuthN)과 인가(AuthZ)의 차이로 가장 정확한 것은?" :choices="['인증은 권한 확인, 인가는 신원 확인이다', '인증은 너 누구냐(신원), 인가는 그걸 할 권한이 있냐(권한)이다', '둘은 같은 말이며 순서만 다르다', '인가가 먼저 일어나고 인증이 나중에 일어난다']" :answer="1" explanation="인증=신원 확인(너 누구냐), 인가=권한 확인(그걸 해도 되냐). 항상 인증 다음에 인가 순서로 일어난다." />

<QuizBox question="CareerTuner에서 토큰이 만료/위조되어 신원을 확인할 수 없을 때 반환되는 HTTP 상태 코드는?" :choices="['200 OK', '401 Unauthorized', '403 Forbidden', '500 Internal Server Error']" :answer="1" explanation="신원 확인 실패는 인증(AuthN) 문제이므로 401. 인증은 됐지만 권한이 없는 인가(AuthZ) 실패는 403이다." />

<QuizBox question="CareerTuner의 JwtAuthenticationFilter가 인증 실패(토큰 없음·위조) 시 곧바로 요청을 차단하지 않고 익명으로 통과시키는 이유를 설명하라." explanation="필터는 인증(누구인지 채우기)만 담당하고, 실제 차단은 뒤의 인가 단계(SecurityConfig의 경로 규칙, @PreAuthorize, requireAdmin)가 맡도록 책임을 분리했기 때문이다. 이렇게 하면 공개 엔드포인트(예: 로그인, 공고 조회)는 토큰 없이도 통과하고, 보호가 필요한 경로만 인가 규칙이 선별해 막을 수 있다. 즉 필터=인증, SecurityConfig=인가로 역할이 깔끔히 나뉜다." />

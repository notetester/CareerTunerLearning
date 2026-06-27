# 비밀번호 해싱 · 이메일 인증

> 비밀번호는 절대 평문으로 저장하지 않고 BCrypt 단방향 해시로만 보관하며, 이메일 인증·비밀번호 재설정·휴면 해제는 모두 `email_verification` 테이블의 일회성 UUID 토큰 하나로 통일된 패턴으로 처리한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

이 페이지는 영역 A(회원·프로필·인증)에서 **자격 증명(credential)의 안전한 저장과 검증**을 다룬다. 구체적으로 두 축이다.

- **비밀번호 해싱**: 가입/재설정 시 비밀번호를 어떻게 저장하고, 로그인 시 어떻게 검증하는가.
- **토큰 기반 메일 인증**: 이메일 인증, 비밀번호 재설정, 휴면 해제라는 세 가지 시나리오를 하나의 토큰 테이블(`email_verification`)로 어떻게 일관되게 구현했는가.

면접에서 받게 되는 질문:

- "비밀번호를 어떻게 저장하나요? 왜 해시인가요? salt는요?"
- "BCrypt를 쓴 이유는? SHA-256과 뭐가 다른가요?"
- "이메일 인증 토큰은 어떻게 만들고 검증하나요? 만료와 재사용은 어떻게 막나요?"
- "비밀번호 재설정 토큰과 이메일 인증 토큰은 같은 구조인가요, 다른가요?"

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 비밀번호: 단방향 해시 + BCrypt

핵심 결정은 "**비밀번호는 복호화 가능한 형태로 절대 저장하지 않는다**"이다. DB가 유출돼도 원문 비밀번호를 복원할 수 없어야 한다. 그래서 양방향 암호화가 아니라 **단방향 해시**를 쓴다. 로그인 검증은 "저장된 해시를 푸는" 것이 아니라 "입력 비밀번호를 같은 방식으로 해시해서 비교"하는 방식이다.

해시 알고리즘으로 `SHA-256` 같은 범용 고속 해시가 아니라 **BCrypt**를 선택한 이유:

| 관점 | 범용 해시(SHA-256 등) | BCrypt |
| --- | --- | --- |
| 속도 | 매우 빠름 → 무차별 대입에 유리(공격자에게) | 의도적으로 느림(work factor) |
| salt | 직접 관리해야 함 | 해시 문자열에 salt 내장 |
| 레인보우 테이블 | 취약(salt 없으면) | salt 자동 → 같은 비밀번호도 매번 다른 해시 |
| 비용 조정 | 불가 | cost factor로 연산량 조절 가능 |

BCrypt는 같은 비밀번호라도 매 인코딩마다 다른 salt를 섞어 **서로 다른 해시 문자열**을 만든다. 그래서 두 사용자가 같은 비밀번호를 써도 DB 값은 다르고, 레인보우 테이블 공격이 무력화된다. 또한 일부러 느리게 설계돼 대량 추측 공격의 비용을 키운다. 이 영역에서는 Spring Security의 `BCryptPasswordEncoder`를 기본 cost로 사용한다.

:::tip
"단방향 해시"의 핵심은 **로그인 시 비밀번호를 복호화하지 않는다**는 점이다. 서버는 사용자의 원문 비밀번호를 어디에서도 알 수 없고, 알 필요도 없다. 매칭은 `encoder.matches(평문, 저장된해시)` 한 줄로 끝난다.
:::

### 메일 토큰: 세 시나리오를 한 테이블로

이메일 인증, 비밀번호 재설정, 휴면 해제는 표면적으로 다른 기능이지만 **본질이 같다**: "메일로 보낸 일회성 링크를 클릭하면 특정 행동을 허가한다." 그래서 별도 테이블 3개를 만들지 않고, `email_verification` 한 테이블에 `purpose` 컬럼(`VERIFY` / `RESET_PW` / `DORMANT_RELEASE`)으로 구분한다.

트레이드오프:
- **장점**: 토큰 발급/검증 로직을 단일 메서드(`issueEmailVerification`)로 재사용. 만료·일회성·UUID 생성 규칙이 한 곳에 모여 일관성이 보장된다.
- **비용**: 토큰 종류별 유효기간이 다르므로(VERIFY 24시간, RESET/DORMANT 1시간) 검증 시 `purpose`를 반드시 함께 비교해야 한다. `RESET_PW` 토큰으로 `VERIFY`를 통과시키면 안 되므로 `purpose` 일치 검사가 보안상 필수다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

### 핵심 클래스

| 역할 | 클래스 / 빈 | 비고 |
| --- | --- | --- |
| 인증 흐름 전체 | `AuthServiceImpl` | register/login/verifyEmail/resetPassword 등 |
| 비밀번호 인코더 | `BCryptPasswordEncoder` (빈) | `SecurityConfig.passwordEncoder()`에서 생성 |
| 메일 발송 | `EmailService` | SMTP 미설정 시 링크를 로그로 출력 |
| 토큰/사용자 영속성 | `AuthMapper`, `UserMapper` | MyBatis 매퍼 (JPA 금지) |
| 메일 토큰 도메인 | `EmailVerification` | token / purpose / expiredAt / used |

`SecurityConfig`에서 인코더는 단순하다.

```java
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
}
```

서비스는 구현체가 아니라 `PasswordEncoder` 인터페이스에 의존하므로, 나중에 Argon2 등으로 교체해도 서비스 코드는 그대로다.

### 관련 테이블

**`users.password`** — `VARCHAR(255) NULL`. 주석 그대로 "BCrypt로 암호화한 비밀번호 해시. 소셜 전용 계정은 NULL 가능". 소셜 로그인만으로 가입한 계정은 비밀번호가 없으므로 `password = NULL`, `password_enabled = 0`이다. 255자는 BCrypt 해시(약 60자)를 충분히 담고 알고리즘 교체 여지까지 둔 폭이다.

**`email_verification`** — 메일 토큰 테이블.

| 컬럼 | 타입 | 의미 |
| --- | --- | --- |
| `user_id` | BIGINT NULL | 대상 회원 (FK) |
| `email` | VARCHAR(255) | 발송 대상 이메일 |
| `token` | VARCHAR(255) | UUID 문자열, **UNIQUE** |
| `purpose` | VARCHAR(20) | `VERIFY` / `RESET_PW` / `DORMANT_RELEASE` |
| `expired_at` | DATETIME | 만료 시각 |
| `used` | TINYINT(1) | 일회성 사용 플래그(기본 0) |
| `used_at` | DATETIME NULL | 사용 처리 시각 |

`token`에 UNIQUE 키가 걸려 있어 토큰 값만으로 단건 조회가 가능하다. `used` + `expired_at`이 토큰의 "유효성"을 결정하는 두 축이다.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 비밀번호 저장 (가입 · 재설정)

가입 시 평문 비밀번호는 즉시 인코딩되어 해시만 저장된다. `AuthServiceImpl.register`:

```java
User user = User.builder()
        .email(email)
        .password(passwordEncoder.encode(request.password())) // 평문 → BCrypt 해시
        .passwordEnabled(true)
        ...
        .build();
```

비밀번호 재설정도 같은 인코딩을 거친다. `resetPassword`:

```java
userMapper.updatePassword(user.getId(),
        passwordEncoder.encode(request.newPassword()));
authMapper.revokeAllForUser(user.getId()); // 재설정 후 모든 세션 폐기
```

재설정 직후 **모든 refresh token을 폐기**하는 점이 중요하다. 비밀번호가 바뀌었으면 기존에 로그인돼 있던 세션은 더 이상 신뢰할 수 없기 때문이다.

### 4-2. 비밀번호 검증 (로그인)

로그인은 복호화가 아니라 비교다. `login`:

```java
if (!passwordEncoder.matches(request.password(), user.getPassword())) {
    userMapper.increaseFailedLogin(user.getId());
    // 5회 초과 시 10분 자동 BLOCKED + 전 세션 폐기 (무차별 대입 방어)
    ...
    throw invalidLogin();
}
```

`matches`는 저장된 해시에 내장된 salt를 꺼내 입력값을 같은 방식으로 해시한 뒤 일치 여부를 반환한다. 검증 순서에도 의도가 있다 — **계정 상태 검증(`validateLoginAllowed`)을 비밀번호 검증보다 먼저** 수행한다. 차단/휴면/삭제 계정은 비밀번호가 맞아도 토큰을 발급하지 않는다.

### 4-3. 이메일 인증 토큰 생성

가입 직후 `VERIFY` 토큰을 발급하고 메일을 보낸다. 토큰 생성의 단일 진입점 `issueEmailVerification`:

```java
private EmailVerification issueEmailVerification(User user, String purpose, int validHours) {
    EmailVerification verification = EmailVerification.builder()
            .userId(user.getId())
            .email(user.getEmail())
            .token(UUID.randomUUID().toString())        // 추측 불가 랜덤 토큰
            .purpose(purpose)                            // VERIFY / RESET_PW / DORMANT_RELEASE
            .expiredAt(LocalDateTime.now().plusHours(validHours))
            .build();
    authMapper.insertEmailVerification(verification);
    return verification;
}
```

세 시나리오는 `purpose`와 `validHours`만 다르게 같은 메서드를 호출한다.

| 시나리오 | purpose | 유효시간 | 발송 메서드 | 클릭 후 도착지 |
| --- | --- | --- | --- | --- |
| 이메일 인증 | `VERIFY` | 24시간 | `sendVerificationEmail` | 백엔드 `/api/auth/verify-email` |
| 비밀번호 재설정 | `RESET_PW` | 1시간 | `sendPasswordResetEmail` | 프런트 `/auth/reset-password?token=` |
| 휴면 해제 | `DORMANT_RELEASE` | 1시간 | `sendDormantReleaseEmail` | 프런트 `/auth/release-dormant?token=` |

이메일 인증 링크만 **백엔드 엔드포인트로** 먼저 가서 검증 후 프런트로 리다이렉트하고, 재설정/휴면은 **프런트 페이지로** 직접 가서 사용자가 새 값을 입력하게 한다. 행동의 성격(즉시 확정 vs 추가 입력 필요)이 다르기 때문이다.

### 4-4. 토큰 검증의 4중 게이트

토큰 검증은 항상 같은 4가지를 본다. `verifyEmail` 예:

```java
EmailVerification ev = authMapper.findEmailVerificationByToken(token);
if (ev == null                                    // ① 존재하는 토큰인가
        || ev.isUsed()                            // ② 이미 사용됐는가 (재사용 방지)
        || !"VERIFY".equals(ev.getPurpose())      // ③ 용도가 맞는가
        || ev.getExpiredAt().isBefore(now())) {   // ④ 만료되지 않았는가
    return false;
}
authMapper.markEmailVerificationUsed(ev.getId()); // 일회성 소진
userMapper.markEmailVerified(ev.getUserId());
```

`resetPassword`, `releaseDormant`도 `purpose` 상수만 바뀔 뿐 **완전히 동일한 4중 게이트**를 통과한다. ③ purpose 검사가 빠지면 휴면 해제 토큰으로 비밀번호를 바꾸는 식의 교차 오용이 가능해지므로, 이 검사는 보안상 핵심이다.

:::tip 토큰이 "일회성"인 이유
`used` 플래그를 검증 직후 즉시 1로 바꾸기 때문이다. 같은 링크를 두 번 클릭하면 두 번째는 ②에서 막힌다. 이메일은 보관·전달될 수 있으므로 한 번 쓰면 무효가 되어야 안전하다.
:::

### 4-5. 개발 환경 메일 폴백

`EmailService.send`는 SMTP가 설정되지 않았거나 devMode면 실제 발송 대신 **링크를 로그로만 출력**한다.

```java
if (props.getMail().isDevMode() || smtpUnset) {
    log.info("[DEV-MAIL] ... 링크={}", linkForDevLog);
    return; // 실제 메일 전송 생략
}
```

덕분에 SMTP 계정 없이도 개발자가 로그에서 토큰 링크를 꺼내 전체 흐름을 테스트할 수 있다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

**구현 완료:**

- BCrypt 단방향 해시 저장/검증 (가입·로그인·재설정 전부).
- 이메일 인증(`VERIFY`, 24시간) — 가입 시 자동 발급 + 재발송(`email/resend`).
- 비밀번호 재설정(`RESET_PW`, 1시간) — 요청·확정 2단계.
- 휴면 해제(`DORMANT_RELEASE`, 1시간) — 같은 토큰 패턴 재사용.
- 일회성(`used`)·만료(`expired_at`)·용도(`purpose`) 4중 검증.
- 재설정 성공 시 전 세션 폐기(`revokeAllForUser`).
- SMTP 미설정 시 로그 출력 폴백.

**보안 트레이드오프 / 관찰 포인트 (결함 포함, 면접 소재):**

- **계정 존재 여부 노출**: 비밀번호 재설정 요청(`requestPasswordReset`)은 미존재/삭제 이메일에 대해 `NOT_FOUND`("등록되지 않은 이메일입니다")를 던진다. 응답이 성공/실패로 갈려 **이메일 가입 여부가 외부에 드러난다**. 일반적인 권장은 항상 동일한 "메일을 보냈습니다" 응답을 주는 것이다. 반면 휴면 해제(`requestDormantRelease`)는 대상이 아니어도 조용히 통과시켜 이 누설을 피한다 — **두 경로의 정책이 일관되지 않다.**
- BCrypt cost factor는 명시 지정 없이 기본값을 사용한다(코드에 `new BCryptPasswordEncoder()`만 존재).
- 토큰은 `UUID.randomUUID()` 기반이다. 추측은 사실상 불가능하지만, 별도의 해싱 없이 토큰 원문이 DB에 그대로 저장된다.

**계획/미구현 (이 영역 코드에 없음):**

- 휴면 **전환**(ACTIVE→DORMANT) 배치/스케줄러는 없다. 휴면 **해제** 경로만 존재한다.
- 만료된 `email_verification` 행을 정리하는 별도 청소 작업은 코드에 없다.

## 6. 면접 답변 3단계

1. **한 줄**: "비밀번호는 BCrypt 단방향 해시로만 저장하고, 이메일 인증·비밀번호 재설정·휴면 해제는 `email_verification` 테이블의 일회성 UUID 토큰 하나로 통일했습니다."
2. **왜**: "복호화 가능한 저장은 DB 유출 시 치명적이라 단방향 해시를 쓰고, salt 내장과 의도적 저속성 때문에 BCrypt를 골랐습니다. 메일 토큰 세 종류는 본질이 같아 `purpose` 컬럼으로 구분해 발급/검증 로직을 재사용했습니다."
3. **어떻게**: "가입 시 `passwordEncoder.encode`로 해시만 저장하고, 로그인은 `matches`로 비교만 합니다. 토큰은 `UUID`로 생성해 발급하고, 검증은 항상 존재·사용여부·용도·만료의 4중 게이트를 통과시킨 뒤 `used`를 즉시 소진해 일회성을 보장합니다. 재설정에 성공하면 기존 세션을 전부 폐기합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. BCrypt와 SHA-256의 차이는? 왜 SHA-256을 안 썼나요?
SHA-256은 범용 고속 해시라 같은 입력에 항상 같은 출력이 나오고 salt도 직접 관리해야 하며, 빠르기 때문에 무차별 대입에 오히려 유리합니다. BCrypt는 salt를 해시 문자열에 내장해 같은 비밀번호도 매번 다른 해시를 만들고, cost factor로 의도적으로 느리게 설계돼 대량 추측 비용을 키웁니다. 비밀번호 저장 목적에는 "느린 해시"가 정답이라 BCrypt를 썼습니다.
:::

:::details Q2. salt는 어디에 저장되나요?
별도 컬럼이 없습니다. BCrypt 해시 문자열 자체에 cost factor와 salt가 포함되어 있어, `matches` 호출 시 저장된 해시에서 salt를 꺼내 입력값을 같은 방식으로 해시한 뒤 비교합니다. 그래서 `users.password` 한 컬럼만으로 검증이 끝납니다.
:::

:::details Q3. 로그인할 때 저장된 비밀번호를 복호화하나요?
아니요. 단방향 해시라 복호화가 불가능하고 필요도 없습니다. `passwordEncoder.matches(입력평문, 저장된해시)`로 비교만 합니다. 서버는 사용자의 원문 비밀번호를 어디에서도 보관하지 않습니다.
:::

:::details Q4. 이메일 인증 토큰과 비밀번호 재설정 토큰은 같은 테이블인가요? 어떻게 구분하나요?
같은 `email_verification` 테이블을 쓰고 `purpose` 컬럼으로 구분합니다(`VERIFY` / `RESET_PW` / `DORMANT_RELEASE`). 유효기간만 달라서 인증은 24시간, 재설정·휴면 해제는 1시간입니다. 검증할 때 토큰 존재·사용여부·만료뿐 아니라 `purpose`가 일치하는지도 반드시 확인합니다. 이 검사가 없으면 재설정 토큰으로 인증을 통과시키는 교차 오용이 가능해집니다.
:::

:::details Q5. 토큰 재사용(같은 링크 두 번 클릭)은 어떻게 막나요?
`used` 플래그입니다. 검증을 통과하면 즉시 `markEmailVerificationUsed`로 `used=1`을 세팅하고, 다음 검증에서 `ev.isUsed()`가 true면 거부합니다. 이메일은 보관·전달될 수 있으므로 일회성이 필수입니다.
:::

:::details Q6. 비밀번호 재설정 요청에서 보안적으로 아쉬운 점이 있나요?
있습니다. 현재 재설정 요청은 미존재/삭제 이메일에 대해 `NOT_FOUND`를 반환해, 응답만으로 해당 이메일의 가입 여부가 드러납니다(account enumeration). 같은 영역의 휴면 해제 요청은 대상이 아니어도 조용히 통과시켜 이 누설을 피하는데, 두 경로의 정책이 엇갈립니다. 개선한다면 재설정도 항상 동일한 "안내 메일을 보냈습니다" 응답으로 통일하는 것이 맞습니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 비밀번호를 저장할 때와 로그인 검증할 때 각각 어떤 메서드가 호출되는지, 그 둘이 왜 "암호화/복호화"가 아닌지.
2. BCrypt가 SHA-256보다 비밀번호 저장에 나은 이유 3가지(salt 내장, 의도적 저속, 같은 비번도 다른 해시).
3. `email_verification` 토큰이 통과해야 하는 4중 게이트와, 그중 `purpose` 검사가 왜 보안상 중요한지.
4. 비밀번호 재설정 성공 후 세션을 전부 폐기하는 이유.
5. 재설정 요청의 account enumeration 결함과 개선 방향.

## 퀴즈

<QuizBox question="이 영역에서 비밀번호를 저장하는 방식으로 옳은 것은?" :choices="['AES로 양방향 암호화해 저장하고 로그인 시 복호화한다', 'BCrypt 단방향 해시로 저장하고 로그인 시 matches로 비교한다', 'SHA-256 해시에 공용 salt를 붙여 저장한다', '평문으로 저장하되 DB 권한으로만 보호한다']" :answer="1" explanation="비밀번호는 BCryptPasswordEncoder로 단방향 해시 저장하고, 로그인은 복호화가 아니라 passwordEncoder.matches(평문, 해시) 비교로 검증한다. salt는 BCrypt 해시 문자열에 내장된다." />

<QuizBox question="email_verification 토큰 검증에서 '용도'를 함께 비교(purpose 일치 검사)하는 주된 이유는?" :choices="['만료 시간을 계산하기 위해', '재설정 토큰으로 이메일 인증을 통과시키는 교차 오용을 막기 위해', 'UUID 충돌을 방지하기 위해', '메일 발송 대상 주소를 찾기 위해']" :answer="1" explanation="VERIFY/RESET_PW/DORMANT_RELEASE가 한 테이블을 공유하므로, purpose가 일치하는지 확인하지 않으면 한 용도의 토큰으로 다른 행동을 허가하는 교차 오용이 가능해진다." />

<QuizBox question="비밀번호 재설정 요청(requestPasswordReset)에서 지적된 보안 트레이드오프는?" :choices="['토큰이 평문으로 메일에 노출된다', '미존재/삭제 이메일에 NOT_FOUND를 반환해 계정 존재 여부가 드러난다(account enumeration)', 'BCrypt cost가 너무 높아 느리다', '재설정 후 세션을 폐기하지 않는다']" :answer="1" explanation="재설정 요청이 미존재 이메일에 NOT_FOUND를 던져 가입 여부가 외부에 노출된다. 같은 영역의 휴면 해제는 조용히 통과시켜 이 누설을 피하는데, 두 경로 정책이 일관되지 않다는 점이 관찰 포인트다." />

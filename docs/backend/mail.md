# 이메일 발송 (Spring Mail)

> 회원가입 인증·비밀번호 재설정처럼 "토큰이 든 링크를 메일로 보내는" 기능을 Spring의 `JavaMailSender`로 구현했고, SMTP가 없는 개발 환경에서는 실제 발송 대신 링크를 로그로 찍어 흐름을 테스트할 수 있게 만들었습니다.

## 1. 한 줄 정의

Spring Mail은 자바 표준 메일 API(JavaMail)를 Spring 스타일로 감싼 모듈이고, 핵심은 `JavaMailSender` 빈으로 SMTP 서버에 메일을 보내는 것입니다. CareerTuner에서는 이메일 인증·비밀번호 재설정·휴면 해제 링크를 보내는 데 씁니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| SMTP | Simple Mail Transfer Protocol. 메일을 "보낼 때" 쓰는 표준 프로토콜. 받을 때는 IMAP/POP3. |
| JavaMail (Jakarta Mail) | 자바 표준 메일 라이브러리. `MimeMessage`, `Session` 등을 제공. |
| `JavaMailSender` | Spring이 JavaMail을 감싼 인터페이스. 자동 설정으로 빈이 만들어짐. |
| MIME | Multipurpose Internet Mail Extensions. 본문에 HTML·첨부파일·인코딩을 담는 메일 포맷 규격. |
| `MimeMessageHelper` | `MimeMessage`를 쉽게 채우게 해주는 헬퍼(받는사람·제목·HTML 본문·인코딩 설정). |
| starttls / ssl | 평문 SMTP 연결을 TLS로 암호화하는 방식. 465 포트는 암묵적 SSL, 587은 STARTTLS가 일반적. |

`JavaMailSender`라는 이름 그대로 "자바 메일을 보내는 사람"이라고 기억하면 됩니다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **본인 확인**: 회원가입 이메일이 진짜 그 사람 것인지 확인해야 스팸·도용 가입을 막습니다. 인증 링크 메일이 없으면 아무 이메일로나 가입됩니다.
- **비밀번호 재설정**: 비번을 잊었을 때 안전하게 복구하려면, 본인만 받는 메일함으로 1회용 링크를 보내야 합니다. 이게 없으면 관리자가 직접 비번을 바꿔주는 위험한 방식밖에 없습니다.
- **직접 SMTP 코드를 짜면 번거롭다**: 소켓 연결, 인증, TLS 핸드셰이크, MIME 인코딩을 손으로 짜면 실수가 많습니다. `JavaMailSender`는 이걸 설정값 몇 줄로 끝냅니다.
- **개발 편의**: 개발 중에 진짜 메일을 계속 쏘면 계정 막힘·스팸 문제가 생깁니다. 그래서 "dev mode"로 발송을 건너뛰고 링크만 로그에 남기는 장치가 필요합니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역: **백엔드 / 인증(auth)** — 메일 자체는 공통 인프라지만 사용처는 인증 도메인입니다.

| 요소 | 위치 | 역할 |
| --- | --- | --- |
| `EmailService` | `auth/service/EmailService.java` | 메일 발송 전담 서비스. `JavaMailSender` + 설정 주입. |
| `JavaMailSender` | Spring Boot 자동 설정 | `application.yaml`의 `spring.mail.*`를 읽어 빈 생성. |
| `CareerTunerProperties.Mail` | `common/config/CareerTunerProperties.java` | `from`, `senderName`, `devMode` 보유 (`careertuner.mail.*`). |
| `EmailVerification` | `auth/domain/EmailVerification.java` | `email_verification` 테이블 VO. 토큰·목적·만료·사용여부. |
| `AuthServiceImpl` | `auth/service/AuthServiceImpl.java` | 토큰 발급(`issueEmailVerification`) 후 `EmailService` 호출, 검증(`verifyEmail`/`resetPassword`). |
| `email_verification` 테이블 | `db/schema.sql` | 발송한 토큰을 저장·검증하는 테이블. |

**발송 메서드 3종** (모두 `EmailService` 안):

| 메서드 | 목적 | 링크가 향하는 곳 | TTL |
| --- | --- | --- | --- |
| `sendVerificationEmail` | 회원가입 이메일 인증 | 백엔드 `/api/auth/verify-email?token=...` → 검증 후 프런트 리다이렉트 | 24시간 |
| `sendPasswordResetEmail` | 비밀번호 재설정 | 프런트 `/auth/reset-password?token=...` | 1시간 |
| `sendDormantReleaseEmail` | 휴면 계정 해제 | 프런트 `/auth/release-dormant?token=...` | 1시간 |

`email_verification` 테이블 핵심 컬럼:

```sql
token       VARCHAR(255) -- UUID, UNIQUE
purpose     VARCHAR(20)  -- 'VERIFY' / 'RESET_PW'
expired_at  DATETIME     -- 만료 시각
used        TINYINT(1)   -- 1회용: 사용되면 1
```

## 5. 핵심 동작 원리 (표/작은 코드/단계)

**전체 흐름 (이메일 인증 예시)**

1. 회원가입 → `AuthServiceImpl.issueEmailVerification`이 `UUID.randomUUID()`로 토큰 생성, `expiredAt = now + 24h`로 `email_verification`에 INSERT.
2. `EmailService.sendVerificationEmail(email, token)` 호출 → 링크 조립 후 발송(또는 dev 로그).
3. 사용자가 메일 링크 클릭 → 백엔드 `verify-email`이 토큰 조회.
4. `verifyEmail`이 검증: **존재 + 미사용 + purpose='VERIFY' + 미만료** → 통과 시 `used=1` 처리하고 사용자 `email_verified` 갱신.

**dev mode 분기 — 면접 포인트**

발송 직전 두 조건 중 하나라도 참이면 실제 발송을 건너뛰고 링크만 로그로 남깁니다.

```java
boolean smtpUnset = smtpUsername == null || smtpUsername.isBlank();
if (props.getMail().isDevMode() || smtpUnset) {
    log.info("[DEV-MAIL] (devMode={}, smtpUnset={}) → 발송 생략. 대상={}, 링크={}", ...);
    return;
}
```

즉 **`MAIL_DEV_MODE=true`이거나 SMTP 계정(username)이 비어 있으면** 발송하지 않습니다. SMTP 계정을 발급받지 못한 개발 단계에서도 가입·재설정 흐름 전체를 테스트할 수 있게 하는 장치입니다.

**실제 발송 경로 (운영)**

```java
MimeMessage message = mailSender.createMimeMessage();
MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
helper.setFrom(props.getMail().getFrom(), props.getMail().getSenderName());
helper.setTo(to);
helper.setSubject(subject);
helper.setText(html, true);   // true = HTML 본문
mailSender.send(message);
```

실패하면 `BusinessException(ErrorCode.INTERNAL_ERROR)`로 변환해 던지고, 응답은 공통 `ApiResponse` 엔벨로프로 나갑니다.

**설정 위치 (값은 자리표시자)**

| 항목 | 키 | 설명 |
| --- | --- | --- |
| SMTP 서버 | `spring.mail.host` (`MAIL_HOST`) | 메일 서버 주소 |
| 포트 | `spring.mail.port` (`MAIL_PORT`) | 465(SSL) 등 |
| 계정 | `spring.mail.username/password` (`MAIL_USERNAME`/`MAIL_PASSWORD`) | 비우면 dev 로그 모드 |
| TLS | `mail.smtp.ssl.enable`, `mail.smtp.starttls.enable` | 암호화 옵션 |
| 발신자 | `careertuner.mail.from` / `sender-name` | 보내는 주소·이름 |
| dev 모드 | `careertuner.mail.dev-mode` (`MAIL_DEV_MODE`) | 발송 on/off 토글 |

:::tip
설정은 모두 `ENV:기본값` 패턴이라 운영에서는 환경변수로 덮어씁니다. 비밀번호·계정 같은 민감값은 코드/yaml에 박지 않고 환경변수로만 주입합니다.
:::

## 6. 면접 답변 3단계

- **초간단 1문장**: "Spring의 `JavaMailSender`로 이메일 인증·비번 재설정 링크를 보내고, SMTP가 없는 개발 환경에서는 링크를 로그로 출력하도록 했습니다."
- **기본**: "메일 발송을 `EmailService`로 분리했습니다. 가입 시 UUID 토큰을 `email_verification` 테이블에 만료시각과 함께 저장하고, 그 토큰을 담은 링크를 `MimeMessageHelper`로 HTML 메일에 실어 보냅니다. 사용자가 링크를 누르면 토큰의 존재·미사용·목적·만료를 검사하고 1회용으로 소비합니다."
- **꼬리질문 대응**: "운영에선 SMTP(465/SSL)로 실제 발송하지만, 계정 발급 전 개발 단계에선 `MAIL_DEV_MODE` 토글과 'username 비어있음' 검사로 발송을 건너뛰고 링크를 로그에 남깁니다. 덕분에 메일 서버 없이도 가입·재설정 흐름 전체를 검증할 수 있고, 발송 실패는 `BusinessException`으로 감싸 일관된 에러 응답으로 내보냅니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 토큰을 어떻게 만들고 안전하게 관리하나요?
`UUID.randomUUID()`로 추측 불가능한 토큰을 만들어 `email_verification` 테이블에 저장합니다. 검증 시 네 가지를 모두 확인합니다 — 토큰 존재, `used=false`(1회용), `purpose` 일치(VERIFY vs RESET_PW), `expired_at` 미경과. 통과하면 즉시 `used=1`로 막아 재사용을 차단합니다. 인증은 24시간, 비번 재설정은 1시간으로 만료를 짧게 둡니다.
:::

:::details Q2. dev mode는 왜 두었고 어떻게 동작하나요?
SMTP 계정을 아직 발급받지 못했거나 개발 중에 실제 메일을 쏘고 싶지 않을 때를 위해서입니다. `careertuner.mail.dev-mode=true`이거나 `spring.mail.username`이 비어 있으면 실제 발송을 건너뛰고 `[DEV-MAIL]` 로그로 인증 링크만 출력합니다. 개발자는 그 로그의 링크를 직접 눌러 인증·재설정을 테스트합니다. 운영에서는 환경변수로 dev-mode를 끄고 SMTP 계정을 채웁니다.
:::

:::details Q3. 인증 링크는 왜 백엔드를 거치고, 재설정 링크는 프런트로 바로 가나요?
이메일 인증은 "토큰을 소비하고 사용자 상태를 바꾸는" 서버 작업이라, 링크가 백엔드 `verify-email`을 먼저 때리고 처리 후 프런트로 리다이렉트합니다. 반면 비번 재설정은 사용자가 새 비밀번호를 입력하는 화면이 필요하므로 링크가 프런트 `reset-password` 페이지로 가고, 거기서 토큰과 새 비번을 함께 API로 보냅니다.
:::

:::details Q4. HTML 메일은 어떻게 만들었나요? 첨부파일은요?
`MimeMessageHelper`의 `setText(html, true)`에서 두 번째 인자 `true`가 "HTML 본문"을 뜻합니다. 본문 HTML은 자바 텍스트 블록으로 작성하고 `String.formatted`로 링크를 끼워 넣습니다. 첨부파일은 현재 안 쓰는데, 필요하면 `MimeMessageHelper`를 멀티파트(`true`)로 만들고 `addAttachment`를 호출하면 됩니다.
:::

:::details Q5. 메일 발송이 느리거나 실패하면 가입이 막히지 않나요?
지금 구조는 동기 발송이라, 발송 실패는 `BusinessException(INTERNAL_ERROR)`로 변환됩니다. 개선 방향으로는 `@Async`나 메시지 큐로 비동기 발송해 가입 응답을 막지 않고, 실패는 재시도 큐에 넣는 방식을 말할 수 있습니다. 타임아웃은 이미 `mail.smtp.connectiontimeout/timeout`으로 5초씩 걸어둬서 행(hang)을 방지합니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드 없이, "회원이 가입 버튼을 누른 순간부터 이메일 인증이 완료되기까지"를 토큰 생성·저장·발송·검증 4단계로 30초 안에 설명해 보세요.
2. 면접관이 "메일 서버도 없는데 어떻게 테스트했냐"고 물으면, dev mode 두 가지 발동 조건과 로그 기반 검증 방식을 한 문장으로 답해 보세요.

## 퀴즈

<QuizBox question="EmailService에서 실제 메일 발송을 건너뛰고 링크를 로그로 남기는 조건은 무엇인가?" :choices="['devMode가 true이거나 SMTP username이 비어 있을 때', 'devMode가 true이고 동시에 SMTP username이 채워져 있을 때', '토큰이 만료되었을 때', '받는 사람 주소가 사내 도메인일 때']" :answer="0" explanation="props.getMail().isDevMode() 또는 smtpUsername이 비어 있으면(둘 중 하나라도 참) 발송을 생략하고 [DEV-MAIL] 로그로 링크만 출력한다. SMTP 계정 없이도 인증·재설정 흐름을 테스트하기 위한 장치다." />

<QuizBox question="이메일 인증 토큰을 검증할 때 verifyEmail이 확인하는 항목 4가지를 설명하라." explanation="email_verification에서 토큰으로 행을 조회한 뒤 네 가지를 모두 확인한다. (1) 행이 존재하는가, (2) used가 false인가(1회용 미사용), (3) purpose가 VERIFY인가(목적 일치), (4) expired_at이 현재보다 미래인가(미만료). 모두 통과하면 used를 1로 바꿔 재사용을 막고 사용자의 email_verified 상태를 갱신한다." />

<QuizBox question="HTML 본문 메일을 만들 때 MimeMessageHelper에서 HTML임을 지정하는 방법은?" :choices="['setText(html, true)에서 두 번째 인자를 true로 준다', 'setSubject에 html 태그를 넣는다', 'setFrom에 content-type을 지정한다', 'createMimeMessage(true)로 만든다']" :answer="0" explanation="setText(content, true)의 두 번째 boolean이 isHtml 플래그다. true면 HTML 본문으로 렌더링되고, false(기본)면 평문으로 처리된다." />

# 영역 A 면접 플레이북

> 회원·프로필·인증(영역 A) 한 영역을 1분/3분/꼬리질문까지 막힘없이 설명하기 위한 종합 대본. 각 주장에는 실제 클래스·테이블 근거를 붙인다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 A는 CareerTuner의 **기반 신뢰 데이터 소유자**다. "내가 누구인지(인증) · 나를 어떻게 설명하는지(프로필) · 무엇을 보완해야 하는지(AI 진단)" 세 가지를 책임지고, B(공고)·C(적합도)·D(면접질문)·E(첨삭)가 공통으로 읽어 가는 입력 원천을 제공한다.

이 페이지가 답하는 면접 질문:

- "이 영역을 30초/1분/3분으로 설명해 주세요."
- "왜 access는 JWT, refresh는 DB UUID로 나눴나요?"
- "왜 프로필 버전 스냅샷을 안 만들었나요?" (★계획엔 있었지만 미구현)
- "AI 동의를 왜 게이트로 강제했나요?"
- "AI가 점수를 만드나요, 서버가 만드나요?"

핵심은 **"무엇을·왜·어떤 기술로·어떻게"를 코드 근거로 설명하는 것**, 그리고 **구현됨/미구현/계획만을 정직히 구분하는 것**이다. 후자를 흐리면 "이 사람은 자기 코드를 모른다"가 된다.

:::tip 한 문장 요약
영역 A는 "사용자의 인증·프로필 원본을 소유하고 읽기전용으로 다른 영역에 빌려주는 신뢰 계층"이며, 인증은 무상태 JWT + 회전형 refresh, AI 진단은 "서버가 점수를 계산하고 LLM은 원점수·근거만 만드는" 뉴로-심볼릭 구조로 설계됐다.
:::

## 2. 1분/3분 설명 대본

### 30초 버전 (엘리베이터)

"영역 A는 회원·프로필·인증을 담당합니다. 사용자의 계정 상태와 취업 준비 프로필이 여기서 만들어지고, 다른 영역은 이 데이터를 **읽기만** 합니다. 인증은 무상태 JWT access 토큰과 DB에 저장하는 회전형 refresh 토큰으로 나눴고, 프로필 AI 진단은 OpenAI를 쓰되 키가 없으면 규칙엔진으로 폴백하는 2단 구조입니다."

### 1분 버전

위 30초에 이어 붙인다:

"세 가지 설계 결정이 핵심입니다. 첫째, **토큰 이원화** — access는 짧은 수명의 무상태 JWT라 검증이 빠르고, refresh는 DB의 opaque UUID라 IP·UA와 함께 저장해 회전·폐기·세션 감사가 됩니다. 둘째, **동의 게이팅** — AI 실행 전에 `AI_DATA` 동의를 반드시 확인하고, 동의는 덮어쓰지 않고 append-only 이력으로 쌓아 개인정보보호법상 동의·철회 시점을 완전 재구성할 수 있습니다. 셋째, **뉴로-심볼릭 분리** — 프로필 완성도 점수는 LLM이 아니라 서버가 직무군별 가중치로 계산하고, LLM은 각 항목 원점수와 개선 문장만 만듭니다. 그래서 재현성과 직무 공정성을 서버가 보증합니다."

### 3분 버전 (구조 → 결정 → 정직)

1. **데이터 경계 (30초):** A는 9개 테이블을 소유한다 — `users`(상태 대표), `user_profile`(1:1, JSON 8종 + 원문 2종), `user_consent`(append-only), `user_social`/`refresh_token`/`user_login_history`/`user_status_history`/`email_verification`(인증 감사 분리), 그리고 공통 `ai_usage_log`(스키마 소유는 A). `users` 중심 트리에서 `user_profile`만 1:1이고 나머지는 1:N.
2. **인증 (45초):** 회원가입은 필수동의 검증 → user insert → 동의 4행 insert → 메일 인증 발송 + 즉시 토큰 발급(자동 로그인). 로그인은 **상태 검증을 비밀번호 검증보다 먼저** 한다(차단·휴면·삭제 계정엔 비번이 맞아도 토큰 미발급). 5회 실패 시 10분 자동 BLOCKED. 소셜 로그인은 Spring Security `oauth2Login`을 쓰지 않고 RestClient로 직접 authorization-code 흐름을 처리한다.
3. **AI 진단 (45초):** 3개 엔드포인트(요약/스킬추출/완성도진단)가 모두 단일 진입점 `ProfileAiService.evaluate(profile, featureType)`로 들어간다. 직무군 분류 → 가중치 결정 → (키 있으면) OpenAI 구조화 출력 + 2차 검증, (키 없으면) 규칙엔진 폴백. 운영 기본값은 키 미발급이라 규칙엔진이 실제 동작한다.
4. **정직 (20초):** 계획엔 `user_profile_version` 스냅샷 테이블과 자소서·경력 키워드 추출 전용 기능이 있었지만, **둘 다 독립 구현은 없다**. 스냅샷은 단일행 upsert로 단순화됐고, 키워드는 요약 응답 필드에 흡수됐다. 자체 파인튜닝 모델은 설계만 됐고 키 미발급이라 규칙엔진이 1차 경로다.

## 3. 기술 선택 이유 — 왜 이렇게 했나

면접에서 "왜"를 못 대면 점수가 깎인다. A의 3대 "왜"를 코드 근거와 함께 정리한다.

### 왜 access=JWT / refresh=DB UUID로 이원화했나

| 토큰 | 형태 | 저장 위치 | 이유 |
| --- | --- | --- | --- |
| access | 무상태 서명 JWT | 저장 안 함(검증만) | 매 요청 빠른 검증, 서버 세션 부담 0 |
| refresh | opaque UUID | `refresh_token` 테이블 | 회전·폐기·세션 감사 필요 |

무상태 JWT의 한계는 **즉시 무효화가 안 된다**는 것이다. 토큰이 탈취돼도 만료 전까지 유효하다. 이걸 access의 **짧은 수명** + refresh의 **DB 폐기**로 보완한다. refresh는 매 발급마다 새 UUID로 갈아끼우는 **회전(rotation)** 구조라, 탈취된 옛 토큰 재사용을 막는다. IP·UA를 함께 저장(`refresh_token.ip_address/user_agent`)해 관리자가 세션 목록을 볼 수 있게 했다. 관리자가 계정을 차단/휴면/삭제로 바꾸면 `revokeAllForUser`로 전 refresh를 즉시 폐기한다 — access는 짧은 수명으로 자연 만료된다.

자세한 흐름은 [JWT 보안](/backend/jwt-security)과 [OAuth2 소셜 로그인](/backend/oauth2) 참고.

### 왜 프로필 버전 스냅샷을 안 만들었나 (★정직 포인트)

계획 문서(분담표)에는 `user_profile_version` 테이블이 있었다 — "분석 시점의 프로필을 스냅샷으로 떠 두면 나중에 분석을 재현할 수 있다"는 의도였다. **하지만 `schema.sql`에는 이 테이블이 없다.** 실제 프로필은 단일 행 upsert + `updated_at`만 있다.

면접 모범답안은 **변명이 아니라 트레이드오프 설명**이다: "버전 테이블은 분석 재현성을 위한 것이었는데, 현재는 분석 결과 자체를 DB에 캐시하지 않고 응답으로만 내려보내는 구조라(프로필 AI는 `creditUsed=0`, 결과 캐시 없음) 스냅샷의 효용이 줄었습니다. 관리자 화면의 '프로필 스냅샷'(`AdminUserProfileSnapshot`)도 버전 테이블이 아니라 현재 `user_profile` 한 행을 평면화한 읽기 모델입니다. 재현성이 필요해지는 시점(예: 분석 결과를 영구 저장)에 버전 테이블을 도입하는 게 맞다고 봅니다."

### 왜 AI 동의를 게이트로 강제했나

`AI_DATA` 동의가 없으면 AI 엔드포인트가 `FORBIDDEN`을 던진다(`requireAiConsent` → `consentService.hasCurrentConsent(userId, "AI_DATA")`). 이유는 두 가지다:

1. **법적 근거** — 프로필 원문(이력서·자소서)을 외부 LLM에 보내는 건 개인정보 처리다. 사용자의 명시적 동의가 전제여야 한다.
2. **감사 가능성** — 동의는 덮어쓰지 않고 append-only로 쌓는다. `findLatest`(같은 type 최신 1행)가 `agreed=true AND revoked_at IS NULL`이면 현재 동의다. 그래서 "언제 동의하고 언제 철회했는지"를 완전히 재구성할 수 있다.

자세히는 [동의 게이팅](/area-a/consent-gating) 참고.

## 4. 동작 원리 — 핵심 흐름 요약

### 로그인 (상태 검증 우선)

```text
identifier+password
  → 사용자 조회
  → validateLoginAllowed(user)   // ★상태 검증이 비번보다 먼저
       └ BLOCKED/DORMANT/DELETED → 토큰 발급 거부
  → BCrypt 비번 비교
       └ 실패 → failedLoginCount++ (롤백 안 함)
              └ 5회 도달 → 10분 BLOCKED + 전 refresh 폐기 + status_history 기록
  → 성공 → access JWT + refresh UUID 발급, 로그인 이력 기록
```

`@Transactional(noRollbackFor = BusinessException.class)`가 핵심이다. 로그인 실패는 비즈니스 예외를 던지지만, **실패 카운트 증가와 감사 이력 insert는 롤백하면 안 된다** — 롤백되면 보안 감사가 통째로 사라진다. `MAX_FAILED_LOGIN_COUNT=5`, `FAILED_LOGIN_LOCK_MINUTES=10`(`AuthServiceImpl.java:44-45`).

### 프로필 AI (3 엔드포인트 → 1 진입점)

```text
POST /api/profile/ai/{summary|skills|completeness}
  → evaluateWithConsent:
      requireUser → requireAiConsent → evaluate → recordAi
  → OpenAiProfileAiService.evaluate(profile, featureType):
      JobFamily.classify(profile)          // 8직무군, 0이면 GENERAL
      weightPolicy.weightsFor(family)       // 6축 가중치(합 100)
      openAiClient.configured()?
        ├ false → RuleBasedProfileAiService (status=SUCCESS)
        └ true  → OpenAI Responses API (json_schema strict:true)
                    → ProfileAiJsonValidator (2차 검증)
                    → 예외 시 RuleBased 폴백 (status=FALLBACK)
  → ProfileScoreCalculator로 서버가 총점 가중합산   // LLM이 아님
  → ai_usage_log 기록 (creditUsed=0)
```

**"서버가 점수를 만든다"**가 면접 한 방 포인트다. SYSTEM_PROMPT는 LLM에게 각 항목 원점수(rawScore 0~100)·근거·개선문장만 요구하고, 총점은 `ProfileScoreCalculator`가 `Math.round(rawScore*weight)/100.0`의 합으로 계산한다. 규칙엔진과 검증기가 같은 계산기를 **공유**하므로 train/serve가 정합하고 직무군 공정성을 서버가 강제한다.

### 직무군 × 평가축 가중치 (코드 직접 확인)

순서 = (목표명확성, 경험구체성, 성과근거, 직무역량적합성, 문서완성도, 개선실행성), 각 행 합 = 100 (`JobFamilyWeightPolicy.java:15-22`):

| 직무군 | GOAL | EXP | ACHV | SKILL | DOC | IMPR | 최고 가중 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEVELOPMENT_DATA | 10 | 15 | 20 | **30** | 15 | 10 | 직무역량 |
| SALES_MARKETING | 15 | 20 | **25** | 20 | 10 | 10 | 성과근거 |
| DESIGN_CONTENT | 10 | 20 | 20 | 25 | 15 | 10 | 직무역량 |
| BUSINESS_OFFICE | 15 | 20 | 20 | 15 | 20 | 10 | 문서완성도 |
| HEALTHCARE_SERVICE | 15 | 25 | 20 | 20 | 10 | 10 | 경험구체성 |
| EDUCATION_PUBLIC | 15 | 25 | 15 | 20 | 15 | 10 | 경험구체성 |
| PRODUCTION_LOGISTICS | 10 | 25 | 25 | 20 | 10 | 10 | 경험·성과 |
| GENERAL | 15 | 20 | 20 | 20 | 15 | 10 | 균등 |

개발 직무에서 직무역량(SKILL)이 30으로 가장 높지만, 비개발 직무는 경험구체성·성과근거를 더 본다 — **직무 편향 방지**가 매트릭스에 박혀 있다.

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

면접에서 이걸 정직하게 말하면 신뢰가 오른다. "구현됐다"고 잘못 말하면 한 번에 무너진다.

:::warning 구현됨으로 말하면 사실 오류가 되는 것들
아래 "미구현/계획만"을 "됐다"고 답하면 거짓이 된다. 반드시 구분해서 설명하라.
:::

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 인증 전체(회원가입/로그인/refresh/logout/me) | **됨** | `AuthController`, `AuthServiceImpl` |
| 이메일 인증·비번 재설정·휴면 해제 | **됨** | `email_verification.purpose` (VERIFY/RESET_PW/DORMANT_RELEASE) |
| 소셜 OAuth(google/kakao/naver) | **됨** | RestClient 수동 흐름 |
| 5회/10분 자동 잠금, 토큰 회전 | **됨** | `AuthServiceImpl.java:44-45` |
| 프로필 CRUD(단일행 upsert) | **됨** | `ProfileController` GET/PUT |
| AI 요약·스킬추출·완성도진단 | **됨** | 3 엔드포인트, 규칙엔진 항상 동작 |
| 동의 append-only + AI 게이트 | **됨** | `ConsentServiceImpl`, `requireAiConsent` |
| 관리자 회원/프로필/동의 조회 | **됨** | 회원 상태변경만 쓰기, 나머지 읽기전용 |
| `user_profile_version` 스냅샷 테이블 | ★**미구현** | `schema.sql`에 없음 |
| 자소서 키워드(#3)·경력 키워드(#4) 전용 기능 | ★**미구현** | 전용 엔드포인트·featureType 없음, 요약 응답에 흡수 |
| 휴면 전환(ACTIVE→DORMANT) 배치 | ★**미구현** | 해제 경로만 존재 |
| 회원가입 `userType` 저장 | ★**미구현** | 프론트 UI는 받지만 payload 미전달 |
| 자체 파인튜닝 모델 `careertuner-a-profile-3b` | **설계만** | 키 미발급, 운영 기본은 규칙엔진(`profile-rule-v2`) |

알아둘 보안 트레이드오프(정직하게 결함으로 인정할 것): 비번 재설정 요청이 미존재 이메일에 404를 줘 계정 존재 여부가 노출됨 / OAuth 콜백이 토큰을 URL `#fragment`로 전달 / 토큰을 localStorage 보관(XSS 노출) / 클라이언트 라우트 가드 부재.

## 6. 면접 답변 3단계 공식

어떤 A 관련 질문이든 이 3단계로 답하면 구조가 잡힌다:

1. **무엇 (정의 한 줄):** "이건 ~를 담당하는 ~입니다." — 클래스/테이블 이름을 박는다.
2. **왜 (트레이드오프):** "~ 때문에 ~를 선택했고, 대가로 ~를 감수했습니다." — 장단을 같이 말한다.
3. **정직 (경계):** "다만 ~는 계획이었고 현재는 ~로 단순화돼 있습니다." 또는 "~는 C/F 영역 소유라 A는 어댑터/임베드만 합니다."

예) "프로필 완성도 점수는 누가 계산하나요?"
→ (무엇) "`ProfileScoreCalculator`라는 서버 계산기가 직무군별 6축 가중치로 가중합산합니다." → (왜) "LLM이 총점을 멋대로 만들면 재현성과 직무 공정성이 깨지기 때문에, LLM에겐 항목별 원점수와 근거만 받습니다." → (정직) "규칙엔진과 LLM 검증기가 같은 계산기를 공유해서 train/serve가 정합합니다. 운영 기본값은 키 미발급이라 규칙엔진이 실제로 돕니다."

## 7. 예상 꼬리질문 + 모범답안

:::details Q1. access 토큰을 즉시 무효화해야 하는 사고가 났습니다. 어떻게 하나요?
무상태 JWT access는 즉시 무효화가 구조적으로 불가능합니다. 그래서 두 가지로 대응합니다 — (1) access 수명을 짧게 잡아 노출 창을 줄이고, (2) 해당 사용자의 **모든 refresh를 `revokeAllForUser`로 폐기**해 access 만료 후 재발급을 막습니다. 즉시성이 정말 중요하면 블랙리스트나 토큰 버전 컬럼을 둬야 하는데, 그건 무상태의 이점을 일부 포기하는 트레이드오프라 현재는 채택하지 않았습니다.
:::

:::details Q2. 왜 상태 검증을 비밀번호 검증보다 먼저 하나요? 순서가 중요한가요?
중요합니다. `validateLoginAllowed`가 비번 비교 **앞**에 옵니다. 차단·휴면·삭제된 계정은 비밀번호가 정확해도 토큰을 발급하지 않기 위해서입니다. 만약 비번을 먼저 검증하고 토큰을 만든 뒤 상태를 보면, 비활성 계정에 토큰이 새어 나갈 창이 생깁니다. 순서로 그 창 자체를 없앴습니다.
:::

:::details Q3. 로그인 실패가 트랜잭션 롤백되지 않게 한 이유는?
`@Transactional(noRollbackFor = BusinessException.class)`를 씁니다. 로그인 실패는 비즈니스 예외를 던지는데, 그 예외로 트랜잭션이 롤백되면 **실패 카운트 증가와 로그인 이력 insert가 같이 사라집니다.** 그러면 무차별 대입을 탐지할 감사 데이터가 없어집니다. 그래서 실패 경로의 부수효과(카운트·이력)는 커밋되도록 롤백 대상에서 뺐습니다.
:::

:::details Q4. 동의를 왜 현재값 한 컬럼으로 안 두고 이력 테이블로 쌓나요?
개인정보보호 감사 요건 때문입니다. `user_consent`는 append-only라 등록(REGISTER/SETTINGS)과 철회(REVOKE) 이벤트를 누적합니다. "현재 동의"는 같은 type의 최신 1행이 `agreed=true AND revoked_at IS NULL`인지로 판단합니다(`findLatest` = ORDER BY id DESC LIMIT 1). 단일 컬럼으로 덮어쓰면 "언제 동의하고 언제 철회했는지"를 영영 못 복원하는데, 이력 구조는 그걸 완전 재구성할 수 있습니다.
:::

:::details Q5. OAuth를 Spring Security oauth2Login으로 안 하고 직접 구현한 이유는?
authorization-code 흐름을 RestClient로 직접 처리합니다(kakao/naver/google). 무상태 API라 쿠키·세션이 없어서, oauth2Login이 기대하는 세션 기반 state 관리를 그대로 못 씁니다. 대신 CSRF 방어를 **서명된 state JWT(5분 수명)**로 합니다. 신규 가입이면 `passwordEnabled=false, emailVerified=true`로 만들고, 같은 이메일의 기존 계정이 있으면 자동 연결합니다(삭제 계정은 차단). 다만 콜백이 토큰을 URL `#fragment`로 프런트에 넘기는 건 관찰해야 할 보안 포인트입니다.
:::

:::details Q6. "AI 5기능"이라던데 엔드포인트는 3개네요? 설명해 주세요.
계획 문서는 AI를 #1~#5로 나눴지만, 구현은 3개 엔드포인트(요약/스킬추출/완성도진단)로 통합됐습니다. #3 자소서 키워드는 요약 응답의 `strengths`에, #4 경력 키워드는 `gaps`와 `criteria[].evidence`에 흡수됐고, **전용 엔드포인트·서비스·featureType은 없습니다.** 셋 다 단일 진입점 `evaluate(profile, featureType)`을 호출하고 featureType 문자열로만 분기해 출력 매핑만 다릅니다. "3·4번이 독립 구현됐다"고 말하면 사실 오류입니다.
:::

:::details Q7. OpenAI 키가 없는데 AI 기능이 어떻게 동작하나요?
2단 폴백 구조입니다. `openAiClient.configured()`가 false면 즉시 `RuleBasedProfileAiService`로 가서 결정론적 규칙으로 평가하고 `status="SUCCESS"`, model `"profile-rule-v2"`를 줍니다. 키가 있는데 호출이 실패하면 규칙엔진으로 폴백하되 `status="FALLBACK"`, model `"profile-rule-fallback"`으로 구분하고 errorMessage에 원인을 남깁니다. status가 응답과 `ai_usage_log`에 그대로 노출돼서 운영자가 폴백 발생을 추적할 수 있습니다. 운영 기본값은 키 미발급이라 규칙엔진이 실제 경로입니다.
:::

:::details Q8. 관리자 프로필·동의 화면은 자체 매퍼가 있나요?
없습니다. `AdminProfileController`/`AdminConsentController`는 자체 매퍼를 두지 않고 사용자 도메인 서비스(`ProfileServiceImpl`/`ConsentServiceImpl`)를 **재사용**합니다. 진입부에서 `AdminAccess.requireAdmin`(ADMIN|SUPER_ADMIN) 분기만 추가합니다. 권한은 `@PreAuthorize`를 안 쓰고 수동 검사하며, URL 레벨(SecurityConfig `hasAnyRole`)과 서비스 레벨로 이중 방어합니다. 회원 도메인만 상태변경 쓰기가 있고 프로필·동의는 읽기 전용입니다.
:::

:::details Q9. 프로필 JSON 컬럼이 깨져 있으면 어떻게 되나요?
`user_profile`의 JSON 8종(education/career/projects/skills/...)은 MyBatis가 String으로 다루고 직렬화/역직렬화를 서비스가 책임집니다. 역직렬화에 실패하면 예외를 삼키고 **원문 문자열을 그대로 반환**합니다. 레거시·자유형 데이터에 대한 내성을 위해서입니다. 프론트도 period 문자열↔start/end, 문자열↔객체 양면 호환 방어를 합니다. 다만 이 방어 로직이 사용자 Profile과 관리자 Profiles에 독립 중복 구현돼 있는 건 알려진 부채입니다.
:::

:::details Q10. 프로필 AI 결과는 어디에 저장되나요? 비용은?
결과 점수·criteria 자체는 DB에 저장하지 않습니다 — 응답으로만 내려가고 **결과 캐시 테이블이 없습니다.** `ai_usage_log`에는 호출 메타데이터(userId·featureType·status·model·token·errorMessage)만 기록하고, 프로필 AI는 `creditUsed=0`으로 무료 고정입니다. 그래서 재현이 필요하면 다시 호출해야 하고, 이게 버전 스냅샷 테이블을 안 만든 배경과도 연결됩니다.
:::

:::details Q11. 공통 AI 클라이언트는 A 소유인가요?
아닙니다. `CareerAnalysisOpenAiClient`는 C(팀장 공통 엔진) 소유입니다. A의 `OpenAiProfileAiService`는 이 클라이언트를 감싸는 **어댑터**일 뿐입니다. 마찬가지로 알림 설정(`NotificationSettings`)은 F 소유라 A의 Settings 화면이 탭으로 임베드만 합니다. "공통 AI 엔진은 팀장 소유라 A는 어댑터만 둔다"가 정확한 경계입니다. 반대로 `ai_usage_log` 테이블은 전 영역이 함께 쓰지만 **스키마 소유·운영 책임은 A**입니다.
:::

:::details Q12. 다른 영역이 A 프로필을 수정할 수 있나요?
없습니다. 데이터 경계가 **읽기전용 원칙**입니다. B(공고)·C(적합도)·D(면접질문)·E(첨삭)가 프로필을 가공하더라도 원본 수정 책임은 A에게만 있습니다. 다른 영역은 A 프로필을 자기 분석의 입력으로 읽을 뿐 쓰기 권한이 없습니다. 그래서 A가 "기반 신뢰 데이터 소유자"라고 부릅니다.
:::

:::details Q13. 휴면 전환은 어떻게 동작하나요?
정직하게 말하면, **휴면 전환(ACTIVE→DORMANT) 배치/스케줄러는 A 코드에 없습니다.** 구현된 건 휴면 **해제** 경로뿐입니다 — `email_verification.purpose=DORMANT_RELEASE`(1시간 토큰)로 메일을 받아 해제하면 즉시 자동 로그인됩니다. 전환을 일으키는 스케줄러는 향후 과제입니다. "휴면 기능이 다 됐다"고 말하면 절반만 맞습니다.
:::

## 8. 직접 말해보기

거울 보고 소리 내어 연습할 항목. 막히면 위 섹션으로 돌아간다.

1. A의 데이터 경계를 한 문장으로 — "기반 신뢰 데이터 소유자, 읽기전용으로 빌려준다"가 나오는가?
2. access/refresh 이원화를 표 없이 30초 안에 — 회전·폐기·감사 키워드가 나오는가?
3. "AI가 점수를 만드나요?"에 즉답 — "아니요, 서버의 `ProfileScoreCalculator`가 직무군 가중치로 계산하고 LLM은 원점수·근거만"이 나오는가?
4. 미구현 3가지(버전 스냅샷 / 자소서·경력 키워드 전용 / 휴면 전환 배치)를 변명 없이 트레이드오프로 설명할 수 있는가?
5. "공통 AI 엔진 소유는?"에 "C(팀장), A는 어댑터"가 바로 나오는가?

## 퀴즈

<QuizBox question="영역 A가 access 토큰은 무상태 JWT로, refresh 토큰은 DB에 저장하는 opaque UUID로 이원화한 가장 핵심적인 이유는?" :choices="['JWT가 UUID보다 길어서 보안이 강하기 때문', 'refresh의 회전·폐기·세션 감사가 필요한데 무상태 토큰으로는 불가능하기 때문', 'OpenAI API가 UUID를 요구하기 때문', 'MySQL이 JWT를 저장할 수 없기 때문']" :answer="1" explanation="무상태 JWT는 즉시 무효화가 안 되는 한계가 있다. refresh를 DB에 opaque UUID로 저장하면 IP·UA와 함께 세션을 감사하고, 매 발급마다 회전시키며, 사고 시 revokeAllForUser로 즉시 폐기할 수 있다. access의 짧은 수명이 무상태의 한계를 보완한다." />

<QuizBox question="프로필 완성도 점수의 총점을 계산하는 주체로 옳은 것은?" :choices="['LLM이 프롬프트에서 총점을 직접 계산해 반환한다', '서버의 ProfileScoreCalculator가 직무군별 가중치로 가중합산하고, LLM은 항목별 원점수와 근거만 만든다', 'MySQL 트리거가 자동 계산한다', '프론트엔드가 응답 필드를 합산해 표시한다']" :answer="1" explanation="뉴로-심볼릭 분리가 핵심이다. LLM은 각 항목 원점수(0~100)와 근거·개선문장만 생성하고, 총점 가중합산은 서버의 ProfileScoreCalculator가 직무군 정책으로 결정론적으로 계산한다. 규칙엔진과 검증기가 같은 계산기를 공유해 재현성과 직무 공정성을 서버가 보증한다." />

<QuizBox question="다음 중 영역 A에서 '계획에는 있었으나 실제로는 미구현/단순화된' 항목이 아닌 것은?" :choices="['user_profile_version 스냅샷 테이블', '자소서 키워드(#3)·경력 키워드(#4) 전용 엔드포인트', '동의의 append-only 이력 저장과 AI 게이팅', '휴면 전환(ACTIVE→DORMANT) 배치 스케줄러']" :answer="2" explanation="동의 append-only 이력과 AI 게이팅은 실제로 구현돼 동작한다(ConsentServiceImpl, requireAiConsent). 나머지 셋은 미구현 또는 단순화 — 버전 테이블은 schema.sql에 없고, 키워드 #3·#4는 전용 엔드포인트 없이 요약 응답에 흡수됐으며, 휴면은 해제 경로만 있고 전환 배치는 없다." />

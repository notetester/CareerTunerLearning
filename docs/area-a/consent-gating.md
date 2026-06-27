# 동의 관리와 AI 기능 게이팅

> 동의는 "현재 상태"가 아니라 "이벤트 이력"으로 저장하고, AI 실행 직전에 그 이력의 최신값을 게이트로 검사한다. 동의·철회를 덮어쓰지 않고 누적해 개인정보 감사 요건을 만족시키는 것이 핵심이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

CareerTuner의 동의 시스템은 회원의 약관·개인정보·AI 데이터·마케팅 동의를 `user_consent` 테이블에 **append-only(추가 전용) 이벤트**로 기록하고, 프로필 AI 기능을 실행하기 직전에 `AI_DATA`의 현재 동의 여부를 검사해 **동의가 없으면 403으로 차단**한다.

이 페이지는 면접에서 자주 나오는 다음 질문들에 답한다.

- "동의 상태를 어떻게 저장했나요? 컬럼 하나에 boolean으로 덮어쓰면 안 되나요?"
- "사용자가 AI 동의를 철회하면 AI 기능은 어떻게 막히나요? 그 연결 고리가 어디인가요?"
- "철회 이력을 왜 굳이 남기나요? 그게 어떤 법적/운영적 이유가 있나요?"
- "필수 동의와 선택 동의를 어떻게 구분해서 처리했나요?"

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 핵심 결정: 동의는 "현재값"이 아니라 "이력"이다

가장 단순한 설계는 `users` 테이블에 `ai_consent BOOLEAN` 같은 컬럼을 두고 토글할 때마다 덮어쓰는 것이다. CareerTuner는 이 방식을 의도적으로 버리고, **별도 테이블에 동의/철회 이벤트를 한 행씩 누적**하는 append-only 구조를 택했다.

이유는 개인정보보호 관점의 감사 가능성(auditability)이다. "이 사용자가 **언제** AI 데이터 사용에 동의했고, **언제** 철회했으며, 그게 **가입 시점인지 설정 화면인지**"를 사후에 완전히 재구성할 수 있어야 한다. 덮어쓰기 컬럼 하나로는 "지금 동의 안 함" 만 알 수 있을 뿐 그 이력을 잃는다.

| 항목 | 덮어쓰기 컬럼 방식 | 이력 테이블 방식 (채택) |
| --- | --- | --- |
| 현재 동의 조회 | 빠름 (단일 컬럼) | 약간 비용 (최신 1행 조회) |
| 동의/철회 시점 추적 | 불가 | 가능 (행마다 시각·source) |
| 개인정보 감사 대응 | 어려움 | 용이 |
| 테이블 행 증가 | 없음 | 누적 (트레이드오프) |

트레이드오프는 분명하다. 행이 계속 쌓이고, "현재 동의값"을 알려면 매번 최신 행을 찾아야 한다. 하지만 동의 변경은 빈번한 작업이 아니고, 감사 요건이 이 비용을 정당화한다.

### 부수 결정: AI 동의를 AI 실행의 전제 조건으로

AI 데이터 동의(`AI_DATA`)는 선택 동의지만, 동의가 없으면 프로필 AI 기능(요약·역량 추출·완성도 진단)을 아예 실행하지 않는다. "프로필 저장은 되지만 AI 분석은 안 된다"는 명확한 경계를 둔 이유는, AI 분석이 사용자의 이력서 원문·자기소개 같은 민감 데이터를 외부 모델에 보낼 수 있기 때문이다. 동의 없이 그 데이터를 처리하지 않는다는 원칙을 코드 레벨 게이트로 강제한다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

동의 도메인은 백엔드 4계층(`controller → service → mapper → domain`)을 그대로 따른다.

| 계층 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| 컨트롤러 | `ConsentController` (`/api/consents/**`) | 조회/저장/AI 철회 3개 엔드포인트 |
| 서비스 | `ConsentServiceImpl` | 이력 기록, 최신 동의 판정, 게이트용 `hasCurrentConsent` 제공 |
| 매퍼 | `ConsentMapper` → `ConsentMapper.xml` | `user_consent` SELECT/INSERT |
| 도메인 | `UserConsent` | 한 동의 이벤트 |
| DTO | `ConsentRequest`, `ConsentStatusResponse`, `ConsentView` | 요청/상태/이력 행 |

### 엔드포인트 (`ConsentController`)

```text
GET  /api/consents/me        현재 동의 상태 + 전체 이력
POST /api/consents/me        4종 동의값 일괄 저장 (source="USER")
POST /api/consents/ai/revoke AI_DATA 단독 철회 (source="REVOKE")
```

세 엔드포인트 모두 `@AuthenticationPrincipal AuthUser`만 받고, 응답은 공통 `ApiResponse<ConsentStatusResponse>` envelope로 감싼다.

### `user_consent` 테이블 (schema.sql)

```sql
CREATE TABLE user_consent (
  id           BIGINT AUTO_INCREMENT,
  user_id      BIGINT      NOT NULL,         -- users FK (ON DELETE CASCADE)
  consent_type VARCHAR(40) NOT NULL,         -- TERMS / PRIVACY / AI_DATA / MARKETING
  agreed       TINYINT(1)  NOT NULL,         -- 이 이벤트가 동의(true)인지 철회(false)인지
  agreed_at    DATETIME    NULL,             -- 동의 시각 (철회면 NULL)
  revoked_at   DATETIME    NULL,             -- 철회 시각 (동의면 NULL)
  source       VARCHAR(40) NULL,             -- REGISTER / USER / REVOKE 등 발생 위치
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

설계 포인트가 컬럼에 그대로 드러난다.

- **`agreed` + `agreed_at` + `revoked_at`을 함께 둔다.** 동의 이벤트면 `agreed=true, agreed_at=now, revoked_at=NULL`, 철회 이벤트면 `agreed=false, agreed_at=NULL, revoked_at=now`. 한 행이 "무슨 일이 일어났는지"를 자기 완결적으로 담는다.
- **`source`로 발생 맥락을 구분한다.** 가입 시 기록은 `REGISTER`, 설정 화면 저장은 `USER`, AI 철회 버튼은 `REVOKE`다. 같은 `AI_DATA` 타입이라도 어디서 바뀌었는지 추적된다.
- **UNIQUE 제약이 없다.** (user_id, consent_type)에 행이 여러 개 쌓이는 것이 정상이다. 인덱스는 조회용 `idx_user_consent_user`, `idx_user_consent_type` 두 개뿐이다.

:::tip
이 테이블에는 "현재 동의 컬럼"이 없다. 현재 상태는 저장된 값이 아니라 **이력에서 매번 계산되는 파생값**이다. 이 점이 면접에서 깊이를 보여줄 수 있는 부분이다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### "현재 동의" = 같은 type의 최신 1행

핵심 판정 로직은 `ConsentServiceImpl.hasCurrentConsent`다. 매퍼가 `ORDER BY id DESC LIMIT 1`로 해당 타입의 가장 최근 행을 가져오고, 그 행이 동의 상태인지 검사한다.

```java
public boolean hasCurrentConsent(Long userId, String consentType) {
    ConsentView latest = mapper.findLatest(userId, consentType);
    return latest != null
        && latest.isAgreed()
        && latest.getRevokedAt() == null;
}
```

즉 **최신 행의 `agreed`가 true이고 `revoked_at`이 NULL일 때만** "현재 동의함"으로 본다. 그 위에 더 새로운 철회 행이 쌓이면 자동으로 "동의 아님"으로 바뀐다. 옛 행은 그대로 남아 이력이 된다.

### 동의 저장 흐름 (`save`)

설정 화면의 "저장"은 4종 동의를 통째로 다시 기록한다.

1. 필수 동의 검증: `termsAgreed`·`privacyAgreed`가 둘 다 true가 아니면 `INVALID_INPUT` 예외.
2. TERMS / PRIVACY / AI_DATA / MARKETING **4행을 모두 새로 insert** (`source="USER"`).
3. 다시 `build`로 현재 상태를 계산해 응답.

여기서 흥미로운 점은, 값이 안 바뀐 동의도 새 행으로 한 번 더 기록된다는 것이다. 이는 append-only 모델의 자연스러운 결과이고, "이 시점에 사용자가 이 설정을 확인·저장했다"는 사실 자체가 이력으로 남는 이점이 있다.

### 철회 흐름 (`revokeAi`)

```java
public ConsentStatusResponse revokeAi(AuthUser authUser) {
    Long userId = requireUser(authUser);
    insert(userId, "AI_DATA", false, "REVOKE");   // agreed=false, revoked_at=now
    return build(userId);
}
```

철회는 행을 삭제하거나 수정하지 않는다. `agreed=false`인 새 `AI_DATA` 행을 하나 더 추가할 뿐이다. 이후 `hasCurrentConsent("AI_DATA")`는 이 최신 행 때문에 false를 돌려준다. 프론트 안내 문구가 정확히 이 의미를 설명한다: "철회는 삭제가 아니라 감사 가능한 이력으로 남기는 방식입니다."

### AI 게이팅: 동의가 AI 실행을 막는 지점

여기가 "동의 ↔ AI 기능"이 실제로 연결되는 핵심이다. 게이트는 동의 도메인이 아니라 **프로필 AI 실행 경로**(`ProfileServiceImpl`)에 있다. 세 AI 엔드포인트(`summarize` / `extractSkills` / `diagnoseCompleteness`)는 모두 단일 내부 메서드 `evaluateWithConsent`를 통과한다.

```java
private ProfileAiResult evaluateWithConsent(AuthUser authUser, String featureType) {
    Long userId = requireUser(authUser);
    requireAiConsent(userId);                    // ← 동의 게이트
    ProfileAiResult result =
        profileAiService.evaluate(findOrEmpty(userId), featureType);
    recordAi(userId, result);                    // ai_usage_log 기록
    return result;
}

private void requireAiConsent(Long userId) {
    if (!consentService.hasCurrentConsent(userId, "AI_DATA")) {
        throw new BusinessException(ErrorCode.FORBIDDEN,
            "AI 데이터 사용 동의가 필요합니다.");
    }
}
```

전체 흐름을 표로 정리하면:

| 단계 | 위치 | 동작 |
| --- | --- | --- |
| 1 | `ProfileController` | `POST /api/profile/ai/summary` 등 진입, 인증 확인 |
| 2 | `evaluateWithConsent` | `requireUser`로 로그인 검증 |
| 3 | `requireAiConsent` | `hasCurrentConsent(userId, "AI_DATA")` 검사 |
| 4a | 동의 false | `BusinessException(FORBIDDEN)` → 403, AI 실행 안 함 |
| 4b | 동의 true | `profileAiService.evaluate(...)` 실행 |
| 5 | `recordAi` | 결과를 `ai_usage_log`에 기록 |

게이트가 **AI 평가 호출 이전**에 있다는 점이 중요하다. 동의가 없으면 모델 호출도, 규칙엔진 실행도 일어나지 않는다. 민감 데이터가 처리 파이프라인에 진입하기 전에 차단된다.

### 프론트엔드 연동

- `Settings.tsx`의 "AI 데이터 동의" 탭에서 토글 + "AI 동의 철회" 버튼을 제공하고, `consentApi.ts`의 `revokeAiConsent()`가 `POST /consents/ai/revoke`를 호출한다.
- 철회 후 안내: "이후 AI 프로필 분석 기능은 제한됩니다."
- `Profile.tsx`에서 AI 버튼을 눌렀을 때 403이 오면 "AI 데이터 동의 상태를 확인해 주세요"를 표시한다. 서버 게이트가 1차 방어선이고, 프론트는 그 신호를 사용자 친화적으로 해석한다.
- 약관 메타(제목·버전·필수 여부·시행일·요약문)는 프론트 상수 `consentTerms.ts`에 있다. 단, 안내 주석대로 **구속력 있는 전문은 별도 `/legal` 페이지가 기준**이며 이 상수는 화면 표시용 요약이다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 기능 | 상태 |
| --- | --- |
| `user_consent` append-only 이력 (TERMS/PRIVACY/AI_DATA/MARKETING) | 구현됨 |
| 회원가입 시 4종 동의 기록 (`source=REGISTER`, 필수 동의 검증) | 구현됨 |
| 설정 화면 동의 일괄 저장 (`source=USER`) | 구현됨 |
| AI 동의 단독 철회 (`source=REVOKE`) | 구현됨 |
| AI 실행 전 `AI_DATA` 게이트 (403 차단) | 구현됨 |
| 소셜 가입 시 동의 수집 화면(`SocialConsent`) | 구현됨 |
| 관리자 동의 이력 조회·필터 (읽기 전용) | 구현됨 |

:::warning 정확히 짚어야 할 경계
- **TERMS/PRIVACY/MARKETING에는 별도 게이트가 없다.** 코드에서 기능 차단과 직접 연결된 동의는 `AI_DATA` 하나뿐이다. 필수 동의(TERMS/PRIVACY)는 "가입·저장 시점에 강제"될 뿐, 런타임에 특정 기능을 막는 게이트로는 쓰이지 않는다.
- **동의 버전 관리(재동의 요청)는 미구현이다.** 약관에 `version` 필드가 있지만(예: `v2026.06`), 약관이 바뀌었을 때 사용자에게 재동의를 요구하는 로직은 코드에 없다. 버전은 표시용이다.
- **관리자 동의 화면은 읽기 전용이다.** 관리자가 사용자의 동의를 대신 변경하지 못한다. `AdminConsentController`는 조회·필터만 제공하고, 쓰기 로직은 `ConsentServiceImpl`의 사용자 메서드를 재사용한다.
:::

## 6. 면접 답변 3단계

면접에서 "동의 관리를 어떻게 설계했나"를 받으면 다음 3단계로 답하면 막힘이 없다.

1. **무엇 (1문장):** "동의는 현재값을 덮어쓰지 않고, `user_consent` 테이블에 동의·철회를 한 행씩 누적하는 append-only 이력으로 저장했습니다."
2. **왜 (트레이드오프):** "개인정보 감사 요건 때문입니다. '언제 동의·철회했고 어디서 일어났는지'를 사후에 완전히 재구성해야 해서, 행이 누적되는 비용을 감수하고 이력 구조를 택했습니다. 현재 동의는 같은 타입의 최신 1행으로 계산합니다."
3. **어떻게 (게이트):** "AI 기능은 이 동의와 직접 묶었습니다. 프로필 AI 세 기능이 공통으로 거치는 `evaluateWithConsent`에서 `hasCurrentConsent('AI_DATA')`를 먼저 검사하고, 동의가 없으면 모델을 호출하기 전에 403으로 막습니다."

## 7. 꼬리 질문 + 모범 답안

**Q1. 동의 상태를 `users` 컬럼 하나에 boolean으로 두면 안 됐나요?**
가능하지만 그러면 "언제·어디서 동의/철회했는지"를 잃습니다. 개인정보보호 관점에서 동의 이력은 보존·재구성이 필요한 데이터라, 별도 이력 테이블에 이벤트를 누적하고 현재값은 최신 행에서 파생하도록 했습니다. 조회가 약간 비싸지는 트레이드오프는 동의 변경 빈도가 낮아 감수할 만합니다.

**Q2. "현재 동의함"은 정확히 어떻게 판정하나요?**
`findLatest`가 `(user_id, consent_type)`의 가장 최근 행을 `ORDER BY id DESC LIMIT 1`로 가져오고, 그 행의 `agreed`가 true이고 `revoked_at`이 NULL일 때만 동의로 봅니다. 더 새로운 철회 행이 쌓이면 자동으로 미동의가 되며, 옛 행은 이력으로 남습니다.

**Q3. AI 동의를 철회하면 데이터가 지워지나요?**
아니요. 철회는 `agreed=false`인 `AI_DATA` 행을 하나 더 추가하는 것이고, 기존 행이나 프로필 데이터는 그대로입니다. 다만 다음 AI 호출부터 게이트에서 막혀 분석이 실행되지 않습니다. 삭제가 아니라 "기능 차단 + 감사 이력 보존"이 의도입니다.

**Q4. AI 게이트가 컨트롤러가 아니라 서비스에 있는 이유는?**
요약·역량 추출·완성도 진단 세 엔드포인트가 모두 `evaluateWithConsent`라는 단일 내부 경로를 거치기 때문입니다. 게이트를 컨트롤러마다 두면 중복·누락 위험이 있어, 공통 경로 한 곳에서 `requireAiConsent`로 검사하도록 모았습니다. 모델/규칙엔진 호출 이전 단계라 민감 데이터가 처리되기 전에 차단됩니다.

**Q5. 필수 동의(약관·개인정보)는 어떻게 강제하나요?**
저장·가입 시점에 검증합니다. `save`와 회원가입 경로 모두 `termsAgreed`·`privacyAgreed`가 둘 다 true가 아니면 `INVALID_INPUT`으로 거부합니다. 다만 이들에는 AI처럼 런타임 기능 게이트가 별도로 걸려 있지는 않습니다.

**Q6. 약관이 개정되면 어떻게 재동의를 받나요?**
현재는 미구현입니다. 약관 메타에 `version` 필드가 있어 표시는 되지만, 버전이 올라갔을 때 재동의를 요구하는 로직은 없습니다. 확장한다면 "현재 동의 행의 버전 &lt; 최신 약관 버전"을 비교해 재동의를 트리거하는 방식이 자연스럽고, 이력 구조라 그 비교에 필요한 데이터는 이미 갖춰져 있습니다.

## 8. 직접 말해보기

아래 항목을 보지 않고 소리 내어 설명할 수 있으면 이 주제는 면접에서 안전하다.

- `user_consent`가 append-only인 이유와, 그 트레이드오프(행 누적 vs 감사 가능성)
- "현재 동의" = 최신 1행에서 파생되는 값이라는 점과 `hasCurrentConsent`의 3가지 조건
- 철회가 "삭제"가 아니라 "false 행 추가"라는 점
- AI 게이트의 정확한 위치(`evaluateWithConsent` → `requireAiConsent`)와 차단 시점(모델 호출 이전)
- 게이트가 걸린 동의는 `AI_DATA` 하나뿐이고, 필수 동의는 저장/가입 시점 검증이라는 구분
- `source` 값 3종(REGISTER/USER/REVOKE)이 발생 맥락을 어떻게 구분하는지

## 퀴즈

<QuizBox question="CareerTuner에서 사용자가 AI 데이터 사용 동의를 철회하면 user_consent 테이블에는 어떤 일이 일어나는가?" :choices="['기존 AI_DATA 행의 agreed를 false로 UPDATE한다', '기존 AI_DATA 행을 DELETE한다', 'agreed=false인 새 AI_DATA 행을 INSERT한다', 'users 테이블의 ai_consent 컬럼을 false로 바꾼다']" :answer="2" explanation="철회는 append-only 원칙에 따라 기존 행을 건드리지 않고 agreed=false, source=REVOKE인 새 AI_DATA 행을 추가한다. 이후 hasCurrentConsent는 이 최신 행 때문에 false를 반환한다." />

<QuizBox question="프로필 AI 기능에 대한 동의 게이트(requireAiConsent)는 실행 흐름의 어느 지점에 있는가?" :choices="['ProfileAiService.evaluate로 모델/규칙엔진을 호출한 직후', 'ai_usage_log에 기록한 다음', '모델/규칙엔진을 호출하기 전(evaluateWithConsent 안)', '프론트엔드에서 버튼을 누르는 시점에만']" :answer="2" explanation="evaluateWithConsent는 requireUser → requireAiConsent → profileAiService.evaluate → recordAi 순서다. 게이트가 evaluate 호출 이전이라, 동의가 없으면 민감 데이터가 처리 파이프라인에 들어가기 전에 403으로 차단된다." />

<QuizBox question="'현재 AI_DATA 동의함'으로 판정되려면 findLatest가 가져온 최신 행이 만족해야 하는 조건이 아닌 것은?" :choices="['행이 NULL이 아님', 'agreed가 true', 'revoked_at이 NULL', 'source가 REGISTER']" :answer="3" explanation="hasCurrentConsent의 조건은 (1) 최신 행 존재, (2) agreed=true, (3) revoked_at IS NULL 세 가지뿐이다. source는 발생 맥락(REGISTER/USER/REVOKE)을 구분하는 감사용 필드일 뿐 현재 동의 판정에는 쓰이지 않는다." />

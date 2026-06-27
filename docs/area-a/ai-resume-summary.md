# AI 이력서/프로필 요약 (#1)

> 사용자가 입력한 프로필 12개 필드를 받아 "경력·강점·직무 방향"을 한 덩어리의 요약으로 압축하는 기능. 요약을 만드는 주체는 LLM 또는 규칙엔진이지만, 직무군 분류와 점수 합산은 항상 서버가 결정론적으로 소유한다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

**AI 이력서/프로필 요약**은 `POST /api/profile/ai/summary` 한 방으로 동작한다. 별도의 요청 바디가 없고, 인증된 사용자의 현재 `user_profile` 1행 전체를 입력으로 삼아 "이 사람을 한 문단으로 어떻게 설명할 수 있는가"를 만들어 낸다. 출력은 요약문(`summary`) 하나에 그치지 않고, 추출 역량·강점·보완점·개선 제안·6축 평가 점수까지 함께 내려가는 `ProfileAiResponse`다.

이 페이지가 답하는 면접 질문은 이것이다.

- "프로필 요약 기능은 입력으로 무엇을 받고, 무엇을 출력하나요?"
- "LLM이 요약을 만든다면, 점수의 신뢰성은 어떻게 보장하나요?"
- "API 키가 없는데도 이 기능이 동작한다고요? 어떻게요?"
- "이 요약이 영역 C(적합도 분석)에서 어떻게 쓰이나요?"

:::tip 핵심 메시지 한 줄
"요약 텍스트와 근거는 모델이 생성하지만, **총점은 서버가 계산한다.** 모델은 점수를 임의로 못 만든다." — 이 한 문장이 이 기능 설계의 절반이다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 "AI 5기능"이 아니라 단일 진입점 하나

계획 문서는 프로필 AI를 #1 요약 / #2 스킬추출 / #3 자소서 키워드 / #4 경력 키워드 / #5 완성도 진단의 다섯 기능으로 나눴다. 그러나 구현은 **단일 메서드 `ProfileAiService.evaluate(UserProfile, featureType)`** 하나로 통합돼 있다. 컨트롤러에 노출된 AI 엔드포인트는 정확히 3개(`/ai/summary`, `/ai/skills`, `/ai/completeness`)뿐이고, 세 엔드포인트 모두 같은 `evaluate`를 호출한 뒤 **출력 매핑만 다르게** 한다.

요약(`PROFILE_SUMMARY`)과 스킬추출(`PROFILE_SKILL_EXTRACT`)은 응답 매핑까지 완전히 동일하다(`ProfileServiceImpl.toAiResponse`). 즉 두 기능은 서버 입장에서 같은 평가를 돌리고, 같은 `ProfileAiResponse`를 돌려주며, 프론트가 어떤 필드를 강조하느냐만 다르다. 이 설계의 의도는 "한 번 평가하면 요약·역량·강점·보완을 동시에 얻으므로, 기능을 잘게 쪼개 LLM을 여러 번 호출하는 비용 낭비를 막는다"이다.

:::warning 정직한 구분
계획상 #3(자소서 키워드)·#4(경력 키워드)는 **전용 엔드포인트·서비스·featureType이 없다.** 요약 응답의 `strengths`(강점)와 `gaps`(보완점), 그리고 평가 기준의 `evidence`(근거)에 부분적으로 흡수되어 있을 뿐이다. "구현됨"이라고 말하면 사실 오류다.
:::

### 2.2 뉴로-심볼릭 분리 — 모델에게 총점 계산을 맡기지 않는다

가장 중요한 설계 결정이다. LLM에게 "이 프로필 80점이야"라고 시키면 점수가 매번 흔들리고, 같은 입력에 다른 점수가 나오며, 직무군 간 공정성을 보장할 수 없다. 그래서:

- **모델이 하는 일:** 요약문, 강점/보완 목록, 각 평가축의 원점수(`rawScore`, 0~100 정수), 근거(`evidence`), 개선 문장(`improvement`) **생성만**.
- **서버가 하는 일:** 직무군 분류(`JobFamily.classify`) → 직무군별 6축 가중치 결정(`JobFamilyWeightPolicy`) → 가중합으로 총점 계산(`ProfileScoreCalculator`).

이 분리 덕분에 같은 원점수가 들어오면 총점은 항상 같고, 직무군별 가중치 공정성을 서버가 강제한다. SYSTEM_PROMPT에도 명시돼 있다: "최종 점수는 서버가 다시 계산하므로 criterionScores.rawScore에는 각 기준의 원점수만 0~100 사이 정수로 작성합니다."

### 2.3 트레이드오프 — 결과를 저장하지 않는다

진단 결과(점수·criteria)는 **DB에 저장하지 않는다.** `ai_usage_log`에는 호출 메타데이터(featureType·status·model·토큰)만 남고, 점수 결과 캐시 테이블은 존재하지 않는다. 장점은 단순함과 "항상 최신 프로필 기준으로 평가"이고, 단점은 매번 다시 호출해야 하며 시계열 추적이 불가능하다는 점이다. 또한 크레딧 차감은 `creditUsed=0` 고정 — 프로필 AI는 무료다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

| 역할 | 클래스 | 핵심 책임 |
| --- | --- | --- |
| 진입 컨트롤러 | `ProfileController` | `POST /api/profile/ai/summary` → `service.summarize(authUser)` |
| 오케스트레이션 | `ProfileServiceImpl` | 동의 게이트 → 평가 위임 → `ai_usage_log` 기록 → 응답 매핑 |
| 평가 인터페이스 | `ProfileAiService` | `evaluate(UserProfile, featureType)` 단일 메서드 |
| LLM 경로 (@Primary) | `OpenAiProfileAiService` | 구조화 출력 호출 + 실패 시 폴백 |
| 규칙엔진 (운영 기본값) | `RuleBasedProfileAiService` | 결정론적 요약·점수 생성 |
| 직무군 분류 | `JobFamily` (8종 enum) | 키워드 매칭 점수 최댓값으로 분류 |
| 가중치 정책 | `JobFamilyWeightPolicy` | 8×6 가중치 매트릭스(행 합 100) |
| 점수 계산 | `ProfileScoreCalculator` | 가중합 총점 — 규칙엔진·검증기가 **공유** |
| 2차 검증 | `ProfileAiJsonValidator` | LLM JSON을 다시 파싱·검증 |
| 프롬프트 카탈로그 | `ProfilePromptCatalog` | SYSTEM_PROMPT·VERSION(`a-profile-v2`) 상수 |
| 공유 LLM 클라이언트 | `CareerAnalysisOpenAiClient` | C(팀장) 소유, A는 어댑터로 의존 |

**입력 테이블:** `user_profile`(user_id UNIQUE, 1:1). JSON 컬럼 8종(education/career/projects/skills/certificates/languages/portfolio_links/preferences) + 원문 2종(resume_text/self_intro MEDIUMTEXT) + desired_job/desired_industry. 자세한 스키마는 [백엔드 MySQL 스키마](/backend/mysql-schema) 참고.

**기록 테이블:** `ai_usage_log`(전 영역 공통, 스키마 소유는 A). 요약 호출 시 application_case_id는 NULL.

:::tip 어댑터 패턴이 보이는 지점
`OpenAiProfileAiService`는 OpenAI를 직접 부르지 않고 C 소유의 `CareerAnalysisOpenAiClient`를 주입받아 감싼다. "공통 AI 엔진은 팀장 소유라 A는 어댑터만 둔다"가 정확한 경계 설명이다. 구조화 출력 자체의 동작 원리는 [공통 구조화 출력](/ai/openai-structured-output)에서 다룬다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 전체 흐름 (요청 → 응답)

```
POST /api/profile/ai/summary  (바디 없음, Bearer 토큰만)
  │
  ▼  ProfileServiceImpl.summarize → evaluateWithConsent("PROFILE_SUMMARY")
  ├─ requireUser        : 인증 확인 (없으면 UNAUTHORIZED)
  ├─ requireAiConsent   : hasCurrentConsent(userId,"AI_DATA") false면 FORBIDDEN
  ├─ profileAiService.evaluate(현재 user_profile, featureType)
  └─ recordAi           : ai_usage_log insert (creditUsed=0)
  │
  ▼  OpenAiProfileAiService.evaluate (@Primary)
  ├─ JobFamily.classify(profile)          → 8직무군 중 하나 (0이면 GENERAL)
  ├─ weightPolicy.weightsFor(family)      → 6축 가중치(합 100)
  ├─ openAiClient.configured() == false ? → RuleBasedProfileAiService 폴백
  └─ configured면:
       openAiClient.request("profile_evaluation", schema, SYSTEM_PROMPT, userPrompt)
       → ProfileAiJsonValidator.validate(...)  (2차 방어)
```

### 4.2 동의가 모든 AI 실행의 전제 조건

`evaluateWithConsent`의 두 번째 줄이 `requireAiConsent`다. `AI_DATA` 동의가 없으면 프로필이 아무리 완벽해도 `FORBIDDEN`으로 막힌다. 동의는 덮어쓰기가 아니라 append-only 이력(`user_consent`)으로 관리되며, "현재 동의"는 같은 type의 최신 1행이 `agreed=true AND revoked_at IS NULL`인지로 판정한다. 이 게이트는 [동의 게이팅](/area-a/consent-gating)에서 깊게 다룬다.

### 4.3 입력 12필드 → 요약문으로 (규칙엔진 경로 예시)

규칙엔진이 만드는 요약문은 결정론적 템플릿이다(`RuleBasedProfileAiService.summary`). 추상화하면:

```java
// 직무군 라벨 · 희망직무 · 상위 5개 역량 · 가중치 점수 · 우선 보완항목을 한 문장으로 조립
"%s 기준으로 %s 직무 준비도를 평가했습니다. 핵심 역량 후보는 %s이며, "
+ "가중치 기반 점수는 %d점입니다. %s"
  .formatted(jobFamily.label(), desiredJob, skillText, score, gapText);
```

예) "개발/데이터 기준으로 백엔드 개발자 직무 준비도를 평가했습니다. 핵심 역량 후보는 Java, Spring, MySQL, JWT, React이며, 가중치 기반 점수는 72점입니다. 우선 보완 항목은 성과근거입니다."

LLM 경로에서는 이 자리에 모델이 생성한 자연어 요약이 들어가지만, **점수(72)는 어느 경로든 서버 `ProfileScoreCalculator`가 계산한 값**이다.

### 4.4 요약 응답의 필드 구성 (`ProfileAiResponse`)

| 필드 | 의미 | 생성 주체 |
| --- | --- | --- |
| `summary` | 한 문단 요약문 | 모델/규칙엔진 |
| `extractedSkills` | 추출 역량 키워드 | 모델/규칙엔진 |
| `strengths` | 강점 목록 (#3 자소서 키워드가 흡수됨) | 모델/규칙엔진 |
| `gaps` | 보완점 (#4 경력 키워드가 흡수됨) | 원점수 70 미만 기준 라벨 |
| `recommendations` | 개선 제안 (가중치 높은 순 상위 4개) | 모델/규칙엔진 |
| `completenessScore` | 총점 0~100 | **서버 가중합** |
| `jobFamily` / `jobFamilyLabel` | 분류된 직무군 | **서버 분류** |
| `criteria[]` | 6축별 rawScore·weight·weightedScore·evidence·improvement | 점수는 서버, 텍스트는 모델 |
| `model` | `gpt-5` 또는 `profile-rule-v2` 등 | 실행 경로 표식 |
| `status` | `SUCCESS` / `FALLBACK` | 운영 가시성 |

### 4.5 가중합 계산 (`ProfileScoreCalculator`)

각 평가축의 가중점수는 `Math.round(rawScore * weight) / 100.0`이고, 총점은 이들의 합을 반올림한 값이다. 직무군마다 가중치가 다르므로 같은 원점수라도 직무군에 따라 총점이 달라진다. 예를 들어 개발/데이터는 직무역량적합성(JOB_SKILL_ALIGNMENT)에 30점을 주지만, 의료/서비스는 경험구체성(EXPERIENCE_SPECIFICITY)에 25점을 준다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 |
| --- | --- |
| `POST /profile/ai/summary` 엔드포인트 | 구현 완료 |
| 규칙엔진 요약(항상 동작, `profile-rule-v2`) | 구현 완료 |
| LLM 요약(키 주입 시 활성, 구조화 출력 + 2차 검증) | 구현 완료, 단 **운영 기본은 키 미발급** |
| 2단 폴백 + status 가시성 | 구현 완료 |
| 동의 게이트(AI_DATA) | 구현 완료 |
| #3 자소서 키워드 전용 기능 | **미구현** — 요약 `strengths`에 흡수 |
| #4 경력·프로젝트 키워드 전용 기능 | **미구현** — 요약 `gaps`/`evidence`에 흡수 |
| 진단 결과 저장/캐시 테이블 | **없음** — 응답으로만 내려감 |
| `user_profile_version`(분석 재현용 스냅샷) | **미구현** — 단일행 upsert + updated_at만 |
| 자체 파인튜닝 모델 `careertuner-a-profile-3b`(Qwen2.5-3B LoRA) | **설계만** — 1차 경로로 의도, 키 미발급이라 규칙엔진이 실제 동작 |

:::warning 면접에서 절대 과장하지 말 것
운영 기본값은 **규칙엔진**이다. API 키가 주입되지 않은 상태에서 요약을 호출하면 `status=SUCCESS`, `model=profile-rule-v2`로 결정론적 결과가 내려간다. "LLM이 요약을 생성한다"가 아니라 "키가 있으면 LLM, 없으면 규칙엔진이 같은 인터페이스로 요약을 생성하고 어느 경우든 서버가 점수를 계산한다"가 정확한 표현이다.
:::

## 6. 면접 답변 3단계

1. **무엇:** "프로필 요약은 사용자가 입력한 12개 필드(이력서 원문·경력·프로젝트·역량 등)를 받아 경력·강점·직무 방향을 한 요약과 6축 평가로 압축하는 기능입니다. `POST /api/profile/ai/summary` 하나로 동작하고, AI_DATA 동의가 전제 조건입니다."

2. **왜:** "핵심은 뉴로-심볼릭 분리입니다. 모델은 요약문과 각 축의 원점수만 만들고, 직무군 분류·가중치·총점은 서버가 결정론적으로 계산합니다. LLM이 점수를 멋대로 못 만들게 해 재현성과 직무군 공정성을 서버가 보장하기 위해서입니다."

3. **어떻게:** "`OpenAiProfileAiService`가 @Primary로 LLM 경로를 맡되, 키가 없거나 호출이 실패하면 `RuleBasedProfileAiService`로 폴백합니다. LLM 응답은 구조화 출력(`json_schema strict:true`)으로 1차, `ProfileAiJsonValidator`로 2차 검증하고, 폴백 여부는 응답 `status` 필드에 그대로 노출돼 운영자가 추적할 수 있습니다. 결과는 `ai_usage_log`에 메타데이터만 기록하고 점수는 응답으로만 내려갑니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 요약과 스킬추출은 응답이 같다고 했는데, 그럼 두 엔드포인트를 왜 나눴나요?
서버 입장에서는 둘 다 같은 `evaluate`를 호출하고 같은 `ProfileAiResponse`를 돌려줍니다(`toAiResponse`). 분리한 이유는 (1) featureType이 `ai_usage_log`에 다르게 기록되어 어떤 버튼을 눌렀는지 추적 가능하고, (2) 프론트가 같은 응답에서 강조 필드를 다르게 보여주기 때문입니다(요약 버튼은 `summary`를, 역량추출 버튼은 `extractedSkills`를 부각). 향후 두 기능의 출력 매핑이 달라질 여지를 열어 둔 분리이기도 합니다.
:::

:::details Q2. LLM이 잘못된 JSON을 주면 어떻게 되나요?
2단 방어가 있습니다. 1차는 OpenAI Responses API의 `json_schema strict:true`로, 스키마를 벗어난 응답 자체를 막습니다. 2차는 `ProfileAiJsonValidator`로, criterionScores가 배열인지, rawScore가 0~100인지, 6개 평가축이 모두 채워졌는지를 다시 검증합니다. 어느 단계든 예외가 나면 `OpenAiProfileAiService`가 잡아서 규칙엔진 결과로 폴백하고, `status=FALLBACK`, `model=profile-rule-fallback`, `errorMessage`에 원인을 남깁니다. 자세한 폴백 철학은 [폴백 전략](/ai/fallback)에 있습니다.
:::

:::details Q3. 점수는 서버가 계산한다는데, 모델이 보낸 점수는 어디로 가나요?
모델은 총점을 보내지 않습니다. 각 평가축의 `rawScore`(원점수 0~100)만 보냅니다. 서버는 이 rawScore에 직무군별 가중치를 곱해(`Math.round(rawScore*weight)/100.0`) 가중점수를 만들고 합산해 총점을 냅니다. 그래서 같은 rawScore가 들어오면 총점은 항상 동일합니다. 이 계산기(`ProfileScoreCalculator`)는 LLM 경로의 검증기와 규칙엔진이 **공유**하기 때문에 train/serve 정합이 보장됩니다.
:::

:::details Q4. 이 요약이 영역 C(적합도 분석)에서 어떻게 쓰이나요?
A는 "기반 신뢰 데이터 소유자"이고, `user_profile`은 C(적합도)·D(면접질문)·E(첨삭)가 공통으로 읽는 입력 원천입니다. 다만 **다른 영역은 A 프로필을 읽기만** 하고 원본 수정 권한은 A에게만 있습니다. C의 적합도 분석은 공고 요구사항과 사용자 프로필을 매칭하는데, 프로필 요약/추출 역량이 그 입력의 정제된 형태로 활용됩니다. 경계 자체는 [영역 C](/area-c/)에서 봅니다.
:::

:::details Q5. 직무군 분류는 어떻게 동작하나요? 개발 직무에 편향되지 않나요?
`JobFamily.classify`가 desiredJob·industry·skills·career·projects·resume·selfIntro를 소문자로 합쳐, 8개 직무군 각각의 키워드 매칭 점수를 세고 최댓값 직무군을 고릅니다. 어느 직무군도 0점이면 GENERAL입니다. 편향 방지를 위해 SYSTEM_PROMPT가 "개발 직무에만 치우치지 말라"고 명시하고, 직무군 8종에 영업/마케팅/디자인/사무/의료/교육/생산/물류를 포함하며, 규칙엔진의 KNOWN_SKILLS에도 비개발 역량(상담·회계·간호·물류 등)을 대거 넣었습니다.
:::

:::details Q6. 프로필을 수정한 직후 요약을 호출하면 최신 내용이 반영되나요?
네. 요약 엔드포인트는 별도 바디 없이 `findOrEmpty(userId)`로 **현재 user_profile 1행을 즉시 다시 읽어** 평가합니다. 결과 캐시가 없으므로 항상 최신 프로필 기준입니다. 단점은 매번 다시 호출해야 한다는 것이고, 결과 시계열(예: 지난주 대비 점수 추이)을 보려면 별도 저장이 필요한데 현재는 미구현입니다.
:::

## 8. 직접 말해보기

다음을 90초 안에 막힘없이 설명할 수 있으면 이 주제를 이해한 것이다.

1. `POST /api/profile/ai/summary`의 입력(요청 바디)이 무엇이고, 왜 그렇게 설계됐는지.
2. "모델이 만드는 것"과 "서버가 만드는 것"의 경계를 한 문장으로.
3. 키가 없을 때 이 기능이 어떻게 동작하며 그것을 어떻게 알 수 있는지(`status`, `model`).
4. #3·#4 기능이 "구현됨"이 아니라 "흡수됨"인 이유.

## 퀴즈

<QuizBox question="POST /api/profile/ai/summary 요청의 바디는 무엇인가?" :choices="['요약할 이력서 텍스트를 JSON으로 보낸다', '바디 없이 인증 주체만 받고 서버가 현재 user_profile 1행을 다시 읽어 입력으로 쓴다', 'job_posting_id를 보내 공고와 매칭한다', 'criterionScores 배열을 클라이언트가 채워 보낸다']" :answer="1" explanation="엔드포인트는 @AuthenticationPrincipal만 받고, evaluateWithConsent가 findOrEmpty(userId)로 현재 user_profile 1행을 다시 읽어 평가 입력으로 사용한다. 결과 캐시가 없어 항상 최신 프로필 기준이다." />

<QuizBox question="프로필 요약에서 총점(completenessScore)은 누가 계산하는가?" :choices="['LLM이 응답에 직접 넣어 보낸다', '프론트엔드가 criteria를 합산한다', '서버의 ProfileScoreCalculator가 직무군 가중치로 가중합한다', 'ai_usage_log 트리거가 DB에서 계산한다']" :answer="2" explanation="뉴로-심볼릭 분리가 핵심이다. 모델은 각 축의 rawScore(0~100)만 만들고, 서버 ProfileScoreCalculator가 직무군별 가중치로 가중합해 총점을 낸다. 이 계산기를 규칙엔진과 검증기가 공유해 재현성을 보장한다." />

<QuizBox question="API 키가 주입되지 않은 운영 기본 상태에서 /profile/ai/summary를 호출하면?" :choices="['500 에러를 반환한다', 'RuleBasedProfileAiService가 동작하고 status=SUCCESS, model=profile-rule-v2로 결정론적 결과가 내려간다', '빈 응답을 반환한다', 'AI_DATA 동의가 자동으로 철회된다']" :answer="1" explanation="openAiClient.configured()가 false면 즉시 규칙엔진으로 평가하며 status=SUCCESS, model=profile-rule-v2다. 호출 실패로 인한 폴백(status=FALLBACK)과 구분된다. 운영 기본값은 규칙엔진이다." />

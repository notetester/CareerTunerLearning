# AI 프로필 완성도 진단 [#5]

> 프로필을 6개 평가축으로 채점하고, "지금 무엇을 어떤 순서로 보강해야 하는지"를 직무군 가중치로 우선순위화하는 기능. 점수는 LLM이 아니라 서버가 계산한다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

프로필 완성도 진단(`PROFILE_COMPLETENESS`)은 사용자의 `user_profile` 1행을 입력받아, **6개 평가 기준(criterion)별 원점수(0~100)** 를 매기고, 직무군별 가중치로 합산해 **단일 완성도 점수**와 **완료/보강 필요 항목 분류**, **보강 추천 문장**을 돌려주는 기능이다.

이 페이지가 답하는 면접 질문:

- "프로필 완성도를 어떻게 점수화했나? 그 점수를 LLM이 만들었나, 서버가 만들었나?"
- "누락 항목과 근거가 약한 항목을 어떻게 구분하고, 무엇을 먼저 보강하라고 안내하나?"
- "AI 키가 없거나 모델 응답이 깨졌을 때 분석 품질이 어떻게 보호되나?"
- "동의 상태나 최근 프로필 수정이 진단에 어떻게 반영되나?"

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

완성도 진단의 핵심 설계 결정은 **"점수 계산 책임을 LLM에서 빼앗아 서버가 소유한다"** 는 것이다. 이를 뉴로-심볼릭 분리라고 부른다.

| 책임 | 담당 | 이유 |
| --- | --- | --- |
| 직무군 분류 | 서버 (`JobFamily.classify`) | 키워드 매칭, 결정론적 |
| 축별 가중치 | 서버 (`JobFamilyWeightPolicy`) | 직무 공정성을 정책으로 고정 |
| 원점수(rawScore) 산출 | LLM **또는** 규칙엔진 | 텍스트 해석은 모델/규칙이 |
| 가중합·총점 | 서버 (`ProfileScoreCalculator`) | 모델이 총점을 못 흔들게 |

:::tip 왜 점수를 서버가 계산하나
LLM에 "최종 완성도 점수를 매겨라"라고 시키면, 같은 프로필인데도 호출마다 총점이 흔들리고(재현성 붕괴), 개발 직무에 점수를 후하게 주는 편향이 생긴다. 그래서 SYSTEM_PROMPT는 LLM에게 **각 기준의 원점수만** 요구하고, 가중합은 서버가 `ProfileScoreCalculator`로 다시 계산한다. 모델을 규칙엔진으로 교체해도 같은 계산기를 공유하므로 점수 의미가 일관된다.
:::

진단 성공 결과는 `profile_ai_analysis`에 `PROFILE_COMPLETENESS` 최신 1행으로 저장된다. 점수·기준별 채점·모델·품질 경고와 `profile_version_id`가 함께 남아 새로고침 후에도 조회할 수 있다. 다만 기능별 upsert이므로 모든 실행 결과를 append하는 점수 시계열은 아니다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

엔드포인트는 `ProfileController`의 `POST /api/profile/ai/completeness` 하나이고, 별도 요청 바디 없이 `@AuthenticationPrincipal`만 받는다. 진입 후 `ProfileServiceImpl.diagnoseCompleteness(authUser)`로 들어간다.

핵심 클래스(`backend/.../profile/ai/`):

| 클래스 | 역할 |
| --- | --- |
| `ProfileAiService` | 인터페이스. 단일 진입점 `evaluate(UserProfile, featureType)` |
| `OpenAiProfileAiService` (`@Primary`) | LLM 경로 + 폴백. 키 없으면 즉시 규칙엔진 |
| `RuleBasedProfileAiService` | 외부 provider가 모두 실패해도 가능한 결정론적 최종 안전망 |
| `JobFamily` | 8종 직무군 enum, `classify` |
| `JobFamilyWeightPolicy` | 8×6 가중치 매트릭스(`switch` 고정) |
| `ScoreCriterion` | 6종 평가축 enum(label·description 포함) |
| `ProfileScoreCalculator` | 가중합·총점 계산(규칙엔진·검증기 공유) |
| `ProfileAiJsonValidator` | LLM JSON 2차 방어 |
| `ProfilePromptCatalog` | SYSTEM_PROMPT·schema 상수 카탈로그 |

6개 평가축(`ScoreCriterion`), label은 화면에 그대로 노출된다:

| enum | label | 무엇을 보나 |
| --- | --- | --- |
| `GOAL_CLARITY` | 목표 명확성 | 희망 직무·산업·근무 조건의 구체성 |
| `EXPERIENCE_SPECIFICITY` | 경험 구체성 | 학력·경력·프로젝트·활동의 역할/업무 중심 기술 |
| `ACHIEVEMENT_EVIDENCE` | 성과 근거 | 수치·결과·개선 사례 같은 확인 가능한 근거 |
| `JOB_SKILL_ALIGNMENT` | 직무 역량 적합성 | 보유 역량이 희망 직무군 요구와 맞는지 |
| `DOCUMENT_CONSISTENCY` | 문서 완성도 | 이력서·자소서·포트폴리오·자격이 연결되는지 |
| `IMPROVEMENT_READINESS` | 개선 실행성 | 부족 항목을 보완하기 쉬운 형태로 정보가 남았는지 |

저장은 `ai_usage_log`에만 한다. `recordAi`가 `featureType=PROFILE_COMPLETENESS`, `status`, `model`, 토큰, `creditUsed=0`(무료 고정), `errorMessage`(500자 truncate)를 insert한다. 진단 점수 자체는 저장하지 않는다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 전체 흐름

```text
POST /profile/ai/completeness
  └─ ProfileServiceImpl.diagnoseCompleteness
       └─ evaluateWithConsent("PROFILE_COMPLETENESS")
            1. requireUser          인증 확인
            2. requireAiConsent     consentService.hasCurrentConsent(userId,"AI_DATA") 없으면 FORBIDDEN
            3. profileAiService.evaluate(profile, featureType)
                 ├─ JobFamily.classify(profile)        직무군 결정
                 ├─ weightPolicy.weightsFor(family)    6축 가중치(합 100)
                 ├─ openAiClient.configured()?         아니오 → 규칙엔진
                 ├─ 예 → Responses API(json_schema strict:true)
                 └─ ProfileAiJsonValidator.validate    2차 검증
            4. recordAi             ai_usage_log 기록
       └─ toCompletenessResponse    completed/missing 분할
```

### 4-2. 누락 항목과 근거 약함 항목을 어떻게 나누나

완성도 진단의 응답(`ProfileCompletenessResponse`)은 6개 축을 **70점 경계로 두 묶음으로 가른다**. 이게 "완료" 대 "보강 필요"의 기준이다.

```java
// ProfileServiceImpl.toCompletenessResponse
List<String> completed = criteria.stream()
        .filter(row -> row.rawScore() >= 70)      // 70점 이상 = 완료
        .map(row -> row.criterion().label()).toList();
List<String> missing = criteria.stream()
        .filter(row -> row.rawScore() < 70)       // 70점 미만 = 보강 필요
        .map(row -> row.criterion().label()).toList();
```

여기서 중요한 점: **"누락"과 "근거 약함"이 같은 `missing` 묶음에 들어간다**. 70점 미만이면 입력이 아예 비었든(누락), 입력은 있지만 근거가 약하든(예: 경력은 적었지만 수치가 없어 성과 근거 점수가 낮음) 모두 보강 필요로 분류된다. 둘을 구분하는 신호는 **점수 자체(rawScore)와 근거 문구(evidence)** 에 담긴다.

규칙엔진의 `evidence`는 이 두 경우를 다른 문장으로 표현한다.

```text
성과 근거(ACHIEVEMENT_EVIDENCE)
  근거 있음 → "수치 또는 기간처럼 확인 가능한 근거가 포함되어 있습니다."
  근거 약함 → "성과를 증명할 수치와 결과 표현이 부족합니다."
직무 역량(JOB_SKILL_ALIGNMENT)
  추출됨   → "추출된 직무 역량: React, TypeScript, ..."
  비었음   → "추출 가능한 직무 역량 키워드가 부족합니다."
```

즉 화면은 점수 막대(rawScore)와 evidence 문구를 함께 보여주어, 사용자가 "이건 안 채운 거" 대 "이건 채웠는데 약한 거"를 구별할 수 있게 한다.

### 4-3. 보강 우선순위는 어떻게 정하나

추천(`recommendations`)은 단순히 부족 항목을 나열하지 않는다. **직무군 가중치가 큰 축을 먼저** 보강하라고 정렬한다.

```java
// RuleBasedProfileAiService
List<String> recommendations = criteria.stream()
        .filter(row -> !row.improvement().isBlank())
        .sorted((l, r) -> Integer.compare(r.weight(), l.weight()))  // 가중치 내림차순
        .limit(4)                                                   // 상위 4개만
        .map(ProfileCriterionScore::improvement)
        .toList();
```

핵심 통찰: **같은 60점짜리 부족 항목이라도 직무군에 따라 보강 우선순위가 다르다.** 가중치 매트릭스(합 100)를 보면 직무군마다 "가장 중요한 축"이 다르기 때문이다.

| 직무군 | 목표 | 경험 | 성과 | 역량 | 문서 | 개선 | 최고 가중 축 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 개발/데이터 | 10 | 15 | 20 | **30** | 15 | 10 | 직무 역량 적합성 |
| 영업/마케팅 | 15 | 20 | **25** | 20 | 10 | 10 | 성과 근거 |
| 생산/물류 | 10 | 25 | 25 | 20 | 10 | 10 | 경험·성과(동률) |
| 의료/서비스 | 15 | **25** | 20 | 20 | 10 | 10 | 경험 구체성 |
| 공통 직무 | 15 | 20 | 20 | 20 | 15 | 10 | 균형 |

예: 같은 프로필이라도 개발 직무로 분류되면 역량 보강(가중 30)이 최우선 추천으로 올라오고, 영업으로 분류되면 성과 근거(가중 25)가 먼저 올라온다.

### 4-4. 가중합 계산 (작은 코드)

```java
// ProfileScoreCalculator.applyWeights / totalScore
double weightedScore = Math.round(rawScore * weight) / 100.0;  // 축별 환산
// 총점 = 6축 weightedScore 합 (0~100 clamp)
```

원점수 0~100과 가중치 합 100을 곱해 100으로 나누므로, 모든 축이 만점이면 총점도 100이 된다. 이 계산기를 **규칙엔진과 LLM 검증기가 똑같이 공유**하기에, 어느 경로로 채점하든 총점의 의미가 동일하다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

:::warning 추측을 사실로 적지 말 것 — 실제 상태
- **구현됨:** `PROFILE_COMPLETENESS` 엔드포인트, 6축 채점, 직무군 가중치 8×6 매트릭스, 70점 경계 완료/보강 분류, 가중치 우선 추천 정렬, 규칙엔진 폴백, `ai_usage_log` 기록.
- **provider 선택과 폴백:** 자체 모델이 설정되면 1차로 시도하고, 그렇지 않거나 실패하면 Claude→OpenAI→규칙엔진으로 내려간다. 사용자는 지원되는 tier를 명시 선택할 수 있다.
- **결과 영속:** 성공 결과는 `profile_ai_analysis`에 기능별 최신본으로 upsert되고 입력 `user_profile_version`을 가리킨다.
- **자체 모델 근거:** Qwen3 4B Profile LoRA v4 학습·비교 기록은 있으나 runtime 기본 활성과 새 clone 재현 가능성은 별도다. [모델 근거 매트릭스](/ai/model-evidence-matrix) 기준으로 말한다.
- **점수 시계열 한계:** 프로필 버전 이력은 있지만 완성도 실행 결과 전체를 append하는 테이블은 아니다.
:::

## 6. 면접 답변 3단계

**1단계(한 줄):** "프로필 완성도 진단은 6개 평가축으로 원점수를 매기고, 직무군 가중치로 합산해 단일 완성도 점수와 보강 우선순위를 주는 기능입니다. 핵심은 점수를 LLM이 아니라 서버가 계산한다는 점입니다."

**2단계(설계 의도):** "텍스트 해석(원점수·근거 문장)은 LLM이나 규칙엔진이 하되, 가중합과 총점은 `ProfileScoreCalculator`가 소유하는 뉴로-심볼릭 분리를 썼습니다. 모델이 총점을 흔들거나 개발 직무에 편향되는 걸 막고, 규칙엔진으로 폴백해도 점수 의미가 일관되게 유지됩니다. 70점을 경계로 완료/보강 필요를 나누고, 보강 추천은 직무군 가중치가 큰 축부터 정렬해 '무엇을 먼저 채워야 하는지'를 안내합니다."

**3단계(트레이드오프·정직):** "동의(AI_DATA)가 없으면 진단을 막고, 실제 평가 입력을 불변 프로필 버전으로 고정합니다. 성공 결과는 기능별 최신본으로 저장되지만 모든 실행의 점수 시계열을 쌓지는 않습니다. provider가 없어도 규칙엔진이 최종 안전망입니다."

## 7. 꼬리질문 + 모범답안

:::details 점수를 LLM이 매기게 하면 안 됐나?
안 된다. LLM이 총점을 직접 내면 (1) 같은 프로필인데 호출마다 점수가 흔들려 재현성이 깨지고, (2) 직무 편향이 점수에 스며든다. 그래서 SYSTEM_PROMPT가 "최종 점수는 서버가 다시 계산한다"고 명시하고 LLM에게는 축별 원점수(0~100 정수)만 요구한다. 가중합은 `ProfileScoreCalculator`가 직무군 정책으로 계산한다.
:::

:::details "누락"과 "근거가 약함"을 화면에서 어떻게 구별하나?
점수 경계상으로는 둘 다 70점 미만 `missing` 묶음에 들어간다. 구별 신호는 두 가지다. 첫째 rawScore 막대의 높낮이(아예 0에 가까우면 누락, 40~60이면 근거 약함), 둘째 evidence 문구다. 예컨대 성과 근거 축은 근거가 있으면 "확인 가능한 근거가 포함되어 있습니다", 약하면 "수치와 결과 표현이 부족합니다"로 다른 문장을 내려준다. 화면은 막대와 evidence를 함께 보여 사용자가 구분하게 한다.
:::

:::details 보강 우선순위를 가중치로 정렬하는 게 왜 중요한가?
같은 60점 부족 항목이라도 직무군마다 영향이 다르기 때문이다. 개발 직무는 직무 역량 가중치가 30으로 가장 높아 역량 보강이 1순위가 되고, 영업은 성과 근거가 25라 성과 보강이 먼저 올라온다. 단순히 "부족한 거 다 채워라"가 아니라 "당신 직무에선 이걸 먼저 채워야 점수가 가장 많이 오른다"를 알려주는 게 핵심이다. 추천은 상위 4개로 제한한다.
:::

:::details 분석 품질이 떨어지는 상황은 어떻게 완화하나?
2단 폴백으로 막는다. (1) 키 미발급이면 `configured()`가 false라 즉시 규칙엔진으로 가고 `status="SUCCESS"`, `model="profile-rule-v2"`. (2) LLM 호출이 실패하거나 JSON이 깨지면 예외를 잡아 규칙엔진 결과로 폴백하되 `status="FALLBACK"`, `model="profile-rule-fallback"`, errorMessage에 원인을 남긴다. status가 응답과 `ai_usage_log`에 그대로 노출돼 운영자가 폴백 발생을 추적할 수 있다. 또 LLM 응답은 `ProfileAiJsonValidator`가 2차 검증해, 점수 범위(0~100)나 누락 기준이 있으면 예외를 던져 폴백을 유도한다.
:::

:::details 동의 상태와 최근 수정은 진단에 어떻게 반영되나?
동의는 실행 전제 조건이다. `requireAiConsent`가 `AI_DATA` 현재 동의를 확인하고 없으면 FORBIDDEN으로 진단을 막는다. 평가는 현재 프로필을 읽은 뒤 같은 객체를 `user_profile_version`으로 고정하고, 저장 결과도 그 version ID를 가리킨다. 조회 화면은 최신 성공본을 보여주되 입력 버전 번호와 분석 시각을 함께 대조할 수 있다.
:::

:::details 같은 프로필인데 직무군이 잘못 분류되면 점수가 왜곡되지 않나?
가능성은 있다. `JobFamily.classify`는 희망 직무·산업·역량·경력·프로젝트·이력서·자소서를 합친 텍스트에 직무군별 키워드를 매칭해 점수 최댓값을 고르고, 0이면 GENERAL로 떨어진다. 키워드가 약하면 GENERAL(균형 가중치 15/20/20/20/15/10)로 분류돼 특정 직무 강점이 덜 반영될 수 있다. 이를 완화하려고 프롬프트가 개발 직무 편중을 금지하고, KNOWN_SKILLS와 8개 직무군 키워드에 비개발 역량(영업·간호·물류 등)을 폭넓게 넣어 분류 편향을 줄였다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있는지 점검하라.

1. 완성도 점수를 LLM이 아니라 서버가 계산하는 이유 두 가지(재현성·직무 편향).
2. 70점 경계가 무엇을 나누는지, 그리고 "누락"과 "근거 약함"이 어떻게 구별되는지.
3. 같은 부족 항목이 개발 직무와 영업 직무에서 보강 우선순위가 달라지는 이유(가중치 매트릭스).
4. 키 미발급(폴백 SUCCESS)과 호출 실패(폴백 FALLBACK)의 status·model 차이.
5. 동의 게이트, 입력 버전 고정, 기능별 최신 결과 upsert가 각각 맡는 역할.

관련 페이지: [AI 이력서 요약](/area-a/ai-resume-summary) · [AI 역량 추출](/area-a/ai-skill-extraction) · [동의 게이팅](/area-a/consent-gating) · [공통 구조화 출력](/ai/openai-structured-output)

## 퀴즈

<QuizBox question="프로필 완성도 진단에서 최종 완성도 점수(총점)를 계산하는 주체는?" :choices="['LLM이 응답으로 직접 총점을 내려준다', '서버의 ProfileScoreCalculator가 가중합으로 계산한다', '프론트엔드가 criteria를 받아 합산한다', 'ai_usage_log에 저장된 이전 점수를 평균낸다']" :answer="1" explanation="뉴로-심볼릭 분리: LLM(또는 규칙엔진)은 축별 rawScore만 산출하고, 가중합·총점은 서버의 ProfileScoreCalculator가 직무군 가중치로 계산한다. 재현성과 직무 편향 방지를 위한 설계다." />

<QuizBox question="toCompletenessResponse에서 완료(completed)와 보강 필요(missing)를 가르는 기준은?" :choices="['rawScore 50점', 'rawScore 70점 (이상=완료, 미만=보강 필요)', 'weightedScore 평균', '입력값이 비었는지 여부만으로 판단']" :answer="1" explanation="criteria를 rawScore 70점 경계로 분할한다. 70 이상은 completed, 미만은 missing이다. 입력이 비었든 근거가 약하든 70 미만이면 모두 보강 필요로 묶이고, 둘의 구별은 점수 막대와 evidence 문구로 한다." />

<QuizBox question="OpenAI 키가 미발급된 운영 기본 상태에서 완성도 진단의 status와 model 값은?" :choices="['status=FALLBACK, model=profile-rule-fallback', 'status=ERROR, model=null', 'status=SUCCESS, model=profile-rule-v2', 'status=SUCCESS, model=gpt-5']" :answer="2" explanation="configured()가 false면 예외 없이 곧장 RuleBasedProfileAiService로 가므로 정상 처리로 간주되어 status=SUCCESS, model=profile-rule-v2다. status=FALLBACK은 LLM 호출이 실패해 예외를 잡고 폴백한 경우(model=profile-rule-fallback)에만 나온다." />

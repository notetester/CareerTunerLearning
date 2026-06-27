# 가드레일 & 그라운딩 가드 — LLM 오류 차단

> LLM은 그럴듯한 말을 잘하는 거지 맞는 말을 보장하지 않는다. 그래서 영역 C는 모델 출력을 그대로 화면에 내보내지 않는다. 점수·판단은 규칙엔진이 확정하고, 모델 텍스트는 두 개의 가드(`guardApplyDecision`, grounding guard)를 통과해야만 사용자에게 도달한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

가드레일은 **LLM 출력이 규칙엔진의 결정값과 모순되거나, 입력에 없는 사실을 지어내면 자동으로 차단·강등·재호출하는 결정적 후처리 계층**이다.

이 페이지로 답할 수 있어야 하는 면접 질문:

- "LLM이 헛소리를 하면 어떻게 막나요?"
- "AI가 '지원하세요(APPLY)'라고 했는데 사실 필수 역량이 빠져 있으면요?"
- "모델이 부족한 역량을 '보유하고 있다'고 설명하면 그게 그대로 화면에 나가나요?"
- "왜 LLM 출력을 그대로 신뢰하지 못하나요?"

핵심 한 문장: **모델은 설명만 쓰고, 판단은 규칙이 한다. 그 둘이 어긋나는 순간을 잡아내는 게 가드레일이다.**

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 왜 LLM 출력을 그대로 신뢰 못 하나

LLM은 다음 토큰을 **확률로** 예측하는 모델이다. "그럴듯함(plausibility)"을 최적화할 뿐 "사실성(truthfulness)"을 보장하지 않는다. 취업 의사결정 도구에서 이게 그대로 나가면:

| 위험 | 구체 예 |
| --- | --- |
| 없는 사실 생성 | 프로필에 없는 `Kubernetes`를 "보유"로 서술 |
| 판단-점수 모순 | 점수는 45점인데 판단은 `APPLY` |
| 수치 날조 | "합격률 87%" 같은 근거 없는 단정 |
| 책임 소재 불명 | 잘못된 판정의 근거를 사후에 설명 못 함 |

취업은 사용자가 시간·돈·기회비용을 거는 의사결정이다. 한 번이라도 "필수 역량 빠졌는데 지원하세요"가 나가면 제품 신뢰가 무너진다.

### 설계 선택: 뉴로-심볼릭 + 가드

영역 C의 철학은 **판단값(symbolic)은 규칙엔진이 소유, 설명(neural)은 LLM이 생성**이다. 가드레일은 이 경계를 강제하는 장치다.

| 대안 | 트레이드오프 | C의 선택 |
| --- | --- | --- |
| LLM이 점수·판단까지 다 출력 | 재현성·책임성 없음, 비싸고 불안정 | 채택 안 함 |
| 프롬프트로만 "거짓말하지 마" 지시 | best-effort, 검증 없음 → 결국 새 나감 | 1차 방어선으로만 사용 |
| 출력 후 **결정적 코드로 재검증** | 프롬프트가 실패해도 코드가 잡음 | **채택** (`guardApplyDecision`, grounding guard) |

핵심 트레이드오프 인식: **프롬프트 지시는 "부탁"이고 코드 검증은 "강제"다.** 프롬프트에 "합격 보장 금지"라고 써도 모델이 어기면 그만이라, 코드 가드를 추가로 둔다. 이 가드들은 전부 **결정적(deterministic)** 이라 같은 입력이면 항상 같은 결과 → 재현·감사 가능.

:::tip 가드는 "거름망"이지 "교정기"가 아니다
가드레일은 모델 텍스트를 다시 쓰지 않는다. 점수·판단을 **만들지도 바꾸지도** 않는다. 다만 (1) 판단이 규칙과 모순되면 **강등**하고, (2) 설명이 근거를 벗어나면 **재호출**한다. 값의 권위는 끝까지 규칙엔진에 있다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블 근거)

두 개의 가드가 폴백 체인의 서로 다른 단계에 박혀 있다.

| 가드 | 위치 (클래스 · 메서드) | 작동 단계 | 차단 대상 |
| --- | --- | --- | --- |
| `guardApplyDecision` | `OpenAiFitAnalysisAiService#guardApplyDecision(int, List<FitConditionMatch>, FitApplyDecision)` | 2차 OpenAI 응답 후 | 판단-점수 모순 (`APPLY` 오발) |
| grounding guard | `OssFitAnalysisAiService#groundingViolation(...)` + `generate()`의 재호출 루프 | 1차 자체 OSS 응답 후 | 부족 역량을 "보유"로 서술 |
| 프롬프트 금칙 | `FitAnalysisPromptCatalog.FIT_EXPLAIN_SYSTEM_PROMPT` | 호출 전(지시) | "합격 보장·합격률 단정", 입력 외 회사·기술·자격증·수치 추가 |
| 화이트리스트 병합 | `OssFitAnalysisAiService#generate()` (금지키 미독해) | OSS 병합 시 | 모델이 `fitScore`/`applyDecision` 키를 내도 무시 |

규칙엔진(권위)은 `MockFitAnalysisAiService#applyDecision(...)`이 `APPLY = (fitScore>=70 && requiredMissing==0)`로 판단을 확정한다. 두 가드는 같은 규칙을 **사후 재검증**한다.

관리자 측 연계: 모순 판정의 흔적은 `analysis_quality_flag`(품질 플래그)와 `admin_fit_analysis_memo`(운영 메모)로 검수 가능하다. `guardApplyDecision`의 주석은 자신을 "관리자 `REQUIRED_GAP_APPLY` 검수 플래그의 **예방 단계**"로 규정한다 — 즉 사후 검수에 의존하기 전에 코드가 먼저 막는다.

## 4. 동작 원리 (데이터 흐름 · 단계 · 표 / 작은 코드)

### 4-1. `guardApplyDecision` — 판단-점수 모순 강등

LLM이 `applyDecision.decision`을 `APPLY`로 내면, 규칙엔진과 똑같은 기준으로 재검증한다.

```java
// OpenAiFitAnalysisAiService (학습용 축약)
FitApplyDecision guard(int fitScore, List<FitConditionMatch> matrix, FitApplyDecision d) {
    if (!"APPLY".equals(d.decision())) return d;            // APPLY 아니면 통과
    long requiredUnmet = matrix.stream()                   // condition_matrix에서 직접 집계
        .filter(r -> "REQUIRED".equals(r.conditionType())
                  && "UNMET".equals(r.matchStatus()))
        .count();
    if (fitScore >= 70 && requiredUnmet == 0) return d;     // 기준 충족 → APPLY 유지
    // 모순 → COMPLEMENT로 강등 + 보정 사유 추가(AI reasons는 유지)
    var reasons = new ArrayList<>(d.reasons());
    reasons.add("자동 보정: 적합도 %d점·필수 미충족 %d개 기준에 따라 '보완 후 지원'으로 조정했습니다."
        .formatted(fitScore, requiredUnmet));
    return new FitApplyDecision("COMPLEMENT", reasons, d.actions());
}
```

설계 디테일 3가지:

1. **강등(COMPLEMENT)만 한다 — 승격은 절대 안 한다.** `HOLD`/`COMPLEMENT`를 `APPLY`로 올리는 경로는 없다. 가드는 항상 보수적인 방향(덜 낙관적)으로만 움직인다.
2. **점수가 아니라 `condition_matrix`를 본다.** `requiredUnmet`을 별도 필드가 아니라 모델이 채운 매트릭스의 `REQUIRED`+`UNMET` 행을 세서 구한다. 점수와 매트릭스가 따로 놀아도 매트릭스 기준으로 강등된다.
3. **AI의 `reasons`는 지우지 않고 보정 사유를 덧붙인다.** 사용자에겐 "AI가 왜 그랬는지 + 우리가 왜 조정했는지"가 둘 다 보인다. 설명가능성 유지.

흐름 표:

| 입력 (모델 출력) | fitScore | requiredUnmet | 가드 결과 |
| --- | --- | --- | --- |
| `APPLY` | 85 | 0 | `APPLY` 유지 |
| `APPLY` | 65 | 0 | `COMPLEMENT` 강등 (점수 미달) |
| `APPLY` | 90 | 1 | `COMPLEMENT` 강등 (필수 미충족) |
| `COMPLEMENT` | 40 | 2 | 그대로 통과 (강등 대상 아님) |

### 4-2. grounding guard — 부족 역량을 "보유"로 서술하면 재호출

자체 OSS 모델은 설명(`fitSummary`/`strengths` 등)만 쓴다. 그런데 모델이 **부족(missing) 역량을 보유한 강점처럼** 서술하면 사실 왜곡이다. 이걸 문장 단위로 검사한다.

```java
// OssFitAnalysisAiService#groundingViolation (학습용 축약)
// missing 리스트의 스킬이, '보유' 표현이 있고 '부족/없/않' 같은 부정이 없는 문장에 등장하면 위반
for (String sentence : fitSummary.split("[.!?。\\n]")) {
    String possess = firstContaining(sentence, POSSESSION);  // 보유/강점/숙련/능숙...
    if (possess == null) continue;                           // 보유 표현 없으면 패스
    if (firstContaining(sentence, LACK) != null) continue;   // '부족/없/않' 있으면 정상
    for (String skill : missing)
        if (sentence.toLowerCase().contains(skill.toLowerCase()))
            return "missingSkill=" + skill + " phrase=" + possess;  // 위반!
}
```

재호출 루프 (`generate()` 안):

```text
attempt = 0, groundingRetries = 1 (기본)
┌─ 모델 호출 → fitSummary/strengths 받음
│   ├─ fitSummary 비었으면 → throw (상위 폴백)
│   ├─ groundingViolation == null → 통과, 루프 탈출
│   └─ 위반 발견 →
│        ├─ attempt < retries → attempt++, 다시 호출 (★재호출)
│        └─ attempt >= retries → throw "grounding 위반" → 상위 폴백(OpenAI→Mock)
```

보수적 판정으로 **오탐(false positive)을 강하게 억제**한다:

| 문장 | 판정 | 이유 |
| --- | --- | --- |
| "Spring 보유로 즉시 투입 가능" (Spring이 missing) | 위반 | 보유 표현 + 부정 없음 + missing 스킬 |
| "Spring 경험이 **부족**합니다" | 정상 | `LACK`("부족") 문맥 |
| "Spring을 **보유하지 않**았습니다" | 정상 | `LACK`("않") 문맥 |
| "Java를 보유" (Java는 matched) | 정상 | missing이 아님 |
| "**정보처리기사 보유**" (보유 자격증) | 정상 | 보유 cert는 missing에서 사전 제거 |

마지막 행이 중요한 실전 버그 수정이다. 규칙엔진은 자격증을 스킬로 치지 않아 **보유한 자격증이 `missing`에 남는다.** 안 빼면 모델이 사실("정보처리기사 보유")을 말해도 오탐 → 과도 폴백(라이브 회귀에서 한 케이스가 100% 폴백). 그래서 `generate()`는 `profileCertificates`를 `missing`에서 먼저 제거한 뒤 검사한다.

### 4-3. 프롬프트 금칙 + 화이트리스트 병합 (두 겹 더)

- **프롬프트(`FIT_EXPLAIN_SYSTEM_PROMPT`)**: "점수나 판단을 새로 만들거나 바꾸지 않는다 / 입력에 없는 회사명·기술·자격증·수치를 추가하지 않는다 / **합격 보장·합격률 단정 같은 표현을 쓰지 않는다**"를 명시. 이건 1차 방어(부탁)다.
- **화이트리스트 병합**: OSS 병합 시 모델이 `fitScore`/`score`/`applyDecision`/`decision` 같은 금지키를 출력해도 **그 키를 아예 읽지 않는다.** 코드가 `fitSummary`/`strategyActions`/`learningTaskReasons`만 꺼내 쓰므로, 금지키는 구조적으로 결과에 못 들어온다. (테스트: `ignoresForbiddenScoreKeysFromModel` — 모델이 `fitScore:999, decision:APPLY`를 내도 결과는 규칙엔진 값 45·`HOLD`.)

## 5. 구현 상태 (됨 vs 향후) — 정직 구분

| 항목 | 상태 |
| --- | --- |
| `guardApplyDecision` 강등 로직 + 보정 사유 | **구현됨** (단위 테스트 통과) |
| grounding guard 위반 탐지(`groundingViolation`) | **구현됨** |
| grounding 재호출 루프 + 소진 시 폴백 | **구현됨** (`retriesOnGroundingViolationThenFallsBack` 등) |
| 보유 자격증 오탐 제거 | **구현됨** (`heldCertificateNotFlaggedEvenIfRuleEngineMissing`) |
| 재호출 후 회복 | **구현됨** (`recoversWhenRetryReturnsGroundedExplanation`) |
| 화이트리스트 병합(금지키 무시) | **구현됨** |
| 프롬프트 금칙(합격 보장/수치 금지) | **구현됨** (시스템 프롬프트) |
| 관리자 `analysis_quality_flag` / `admin_fit_analysis_memo` 검수 | **구현됨** (스키마·연계) |
| 실제 OpenAI 키로 `guardApplyDecision` 라이브 작동 | **향후** (키 발급 후 활성화 — 코드·계약은 완성) |
| 실제 파인튜닝 OSS 모델 서빙으로 grounding 라이브 검증 | **향후** (Ollama 통합 코드는 완성, 모델 학습·서빙은 진행) |

:::warning 면접에서의 정직한 표현
"**가드 아키텍처는 완성**돼 있고 단위 테스트로 강등·재호출·오탐 억제를 검증했습니다. 실제 LLM 응답에 대한 라이브 작동은 **키 발급/모델 서빙 후 활성화**되며, 화면·계약은 mock 규칙엔진 기준으로 실제와 동일하게 동작합니다."
:::

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단 (10초)**
"LLM은 그럴듯한 말은 해도 맞는 말은 보장 못 합니다. 그래서 모델은 설명만 쓰고, 점수·판단은 규칙엔진이 확정합니다. 둘이 어긋나면 가드가 강등하거나 모델을 다시 부릅니다."

**기본 (30초)**
"가드가 두 개입니다. 하나는 `guardApplyDecision` — 모델이 `APPLY`를 내도 적합도 70점 이상이고 필수 미충족이 0개가 아니면 `COMPLEMENT`로 강등하고 보정 사유를 붙입니다. 다른 하나는 grounding guard — 모델이 부족한 역량을 '보유'로 서술하면 위반으로 잡아 재호출하고, 재시도 소진 시 폴백합니다. 둘 다 결정적이라 재현·감사가 됩니다."

**꼬리질문 대응 (핵심 포인트)**
"강등만 하고 승격은 절대 안 합니다(보수적). AI의 `reasons`는 지우지 않고 보정 사유를 덧붙여 설명가능성을 유지합니다. grounding은 오탐을 강하게 억제하도록 '보유 표현 + 부정 없음 + missing 스킬' 세 조건이 동시에 맞을 때만 위반으로 봅니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 프롬프트에 '거짓말하지 마'라고 쓰면 되는 거 아닌가요? 왜 코드 가드까지?**
프롬프트 지시는 best-effort라 모델이 어기면 그대로 새 나갑니다. 프롬프트는 1차 방어(부탁), 코드 가드는 2차 강제(검증)입니다. `guardApplyDecision`은 모델이 `APPLY`를 어떻게 내든 코드가 규칙으로 재검증하므로 프롬프트 실패에 영향받지 않습니다.

**Q2. `guardApplyDecision`은 왜 점수 대신 `condition_matrix`를 보고 `requiredUnmet`을 세나요?**
점수와 매트릭스가 따로 놀 수 있기 때문입니다. 점수만 보면 "85점인데 필수 1개 빠짐"을 못 잡습니다. 필수 미충족은 매트릭스의 `REQUIRED`+`UNMET` 행을 직접 세는 게 정확하고, 사용자에게 보여주는 근거(condition_matrix)와도 일치합니다.

**Q3. grounding guard가 정상 문장을 위반으로 오판하면요? (false positive)**
오탐을 1순위로 막도록 설계했습니다. "보유" 류 표현이 있고, 같은 문장에 "부족/없/않" 같은 부정이 **없고**, missing 스킬이 등장할 때만 위반입니다. "Spring 경험이 부족"은 정상, "보유하지 않았다"도 정상입니다. 또 보유 자격증은 missing에서 미리 빼 "정보처리기사 보유"가 오탐 나던 라이브 회귀(한 케이스 100% 폴백)를 수정했습니다.

**Q4. 재호출해도 또 위반하면 화면이 깨지나요?**
안 깨집니다. grounding 재시도(기본 1회)를 소진하면 `BusinessException`을 던지고, 상위 `FallbackFitAnalysisAiService`가 OpenAI → Mock으로 폴백합니다. Mock(규칙엔진)은 항상 성공하므로 어떤 경로가 실패해도 사용자에겐 결과가 나갑니다.

**Q5. 강등하면 점수도 같이 내리나요?**
아니요. 가드는 점수를 만들거나 바꾸지 않습니다. `decision`만 `COMPLEMENT`로 바꾸고 보정 사유를 추가합니다. 점수의 권위는 끝까지 규칙엔진에 있고, 가드는 판단과 점수의 **정합성**만 강제합니다.

**Q6. '합격 보장'·'합격률 87%' 같은 표현은 어디서 막나요?**
1차로 `FIT_EXPLAIN_SYSTEM_PROMPT`가 "합격 보장·합격률 단정 금지", "입력에 없는 수치 추가 금지"를 명시합니다. 입력 외 수치를 지어내는 건 grounding의 정신과 같은 맥락이며, 점수 같은 수치는 모델이 아니라 규칙엔진이 0~100으로 클램핑해 확정하므로 모델이 임의 수치를 내도 결과에 반영되지 않습니다.

## 8. 직접 말해보기

다음을 막힘없이 30초 안에 말할 수 있으면 이 페이지를 이해한 것이다.

1. "왜 LLM 출력을 그대로 신뢰 못 하나"를 확률 모델 관점으로 한 문장.
2. `guardApplyDecision`의 강등 조건과 "왜 승격은 안 하는가".
3. grounding guard의 위반 3조건과 false positive를 막는 장치 2개(부정 문맥, 보유 자격증 제외).
4. 재시도 소진 시 화면이 안 깨지는 이유(폴백 체인 + Mock 항상 성공).

관련 페이지: [3단 폴백 체인](/area-c/fallback-chain) · [뉴로-심볼릭 설계](/area-c/neuro-symbolic) · [구조화 출력](/ai/openai-structured-output) · [적합도 분석 개요](/area-c/fit-analysis)

## 퀴즈

<QuizBox
  question="모델이 applyDecision을 'APPLY'로 냈고 fitScore=90, condition_matrix의 REQUIRED+UNMET 행이 1개다. guardApplyDecision의 결과는?"
  :choices="['APPLY 유지 (점수가 70 이상이므로)', 'COMPLEMENT로 강등 (필수 미충족이 0개가 아니므로)', 'HOLD로 강등', '예외를 던져 폴백']"
  :answer="1"
  explanation="APPLY 유지 조건은 'fitScore>=70 AND requiredUnmet==0' 둘 다 충족이다. 필수 미충족이 1개라 두 번째 조건이 깨지므로 COMPLEMENT로 강등되고 보정 사유가 추가된다. 가드는 점수가 높아도 필수 미충족이 있으면 보수적으로 강등하며, HOLD까지 내리지는 않는다."
/>

<QuizBox
  question="grounding guard가 다음 문장을 위반으로 판정하지 않는 경우는? (missing 역량에 'Spring' 포함)"
  :choices="['Spring 보유로 즉시 투입 가능', 'Spring은 강점입니다', 'Spring 경험이 부족합니다', 'Spring 숙련도가 높습니다']"
  :answer="2"
  explanation="위반은 '보유 표현 + 부정 없음 + missing 스킬'이 동시에 맞을 때만 성립한다. '부족'은 LACK(결핍·부정) 표현이라 같은 문장에 있으면 정상으로 본다. 이는 '부족합니다' 같은 정상 서술을 오탐하지 않으려는 보수적 설계다."
/>

<QuizBox
  question="grounding 재시도(기본 1회)를 소진해도 모델이 계속 위반하면 사용자 화면은 어떻게 되나?"
  :choices="['에러 페이지가 뜬다', '빈 결과가 나간다', 'BusinessException으로 상위 폴백이 작동해 OpenAI→Mock 규칙엔진 결과가 나간다', '모델 출력을 그대로 내보낸다']"
  :answer="2"
  explanation="grounding 위반이 재시도를 소진하면 BusinessException을 던지고, 상위 FallbackFitAnalysisAiService가 OpenAI→Mock으로 폴백한다. Mock(규칙엔진)은 항상 성공하므로 어느 경로가 실패해도 화면은 깨지지 않는다. 위반한 모델 출력은 절대 그대로 나가지 않는다."
/>

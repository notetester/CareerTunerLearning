# 점수 산출 규칙엔진 — 왜 AI가 점수를 정하지 않나

> 적합도 점수와 지원 판단은 **결정적 규칙엔진**이 소유한다. LLM은 그 숫자를 사람 말로 풀어 설명만 한다. 같은 입력은 언제나 같은 점수다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

이 페이지는 영역 C의 심장인 **점수 산출 규칙엔진**(`MockFitAnalysisAiService`)을 깊게 다룬다. "이 공고에 지원해도 되나"라는 질문에 숫자(0~100점)와 판단(APPLY/COMPLEMENT/HOLD)으로 답하는 부분이다.

면접에서 반드시 받게 될 질문은 이것이다.

> "AI 적합도 분석이라면서 왜 점수를 GPT가 안 내고 직접 짠 규칙으로 계산했나요?"

이 한 문장에 막힘없이 답하는 것이 이 페이지의 목표다. 핵심 답: **점수는 평가 결과이고, 평가 결과는 재현 가능하고 책임질 수 있어야 하기 때문**이다. LLM은 같은 입력에도 매번 다른 숫자를 낼 수 있는데, 사용자 인생이 걸린 "지원해도 되나"를 그런 분산성 위에 올릴 수 없다.

:::tip 핵심 한 문장
"채점은 규칙엔진이 확정하고, LLM은 그 채점 결과를 설명만 한다 — 뉴로-심볼릭(neuro-symbolic) 분업."
:::

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 대안 A — LLM이 점수까지 직접 산출

가장 흔한 방식이다. 공고와 프로필을 통째로 프롬프트에 넣고 "적합도 몇 점?"을 물어본다. 빠르게 데모는 되지만 제품으로는 무너진다.

| 문제 | 구체적 증상 |
| --- | --- |
| 재현성 없음 | 같은 사용자가 같은 공고를 두 번 분석하면 72점 → 68점. "왜 떨어졌냐"에 답 불가 |
| 책임성 없음 | 점수의 근거가 모델 가중치 안에 숨어 있어 감사·이의제기 불가 |
| 비용·가용성 | 점수 한 줄 받으려고 매 조회마다 토큰 소모, 모델 다운 시 화면 전체가 빈 값 |
| 환각(hallucination) | 입력에 없는 자격증·수치를 점수 근거로 지어냄 |

### 대안 B (채택) — 규칙엔진이 점수를 소유, LLM은 설명만

점수·판단·신뢰도는 결정적 코드가 확정하고, LLM은 그 확정된 숫자를 받아 자연어 코칭 텍스트만 생성한다. 이 분업의 다섯 가지 이유를 머리글자로 외운다.

- **Credibility(신뢰)** — "왜 72점인가"를 `score = 10 + 필수충족비율*70 + 우대충족비율*20`으로 한 줄에 설명한다.
- **Consistency(재현성)** — 같은 입력 = 같은 점수. `source_snapshot`까지 동결해 시점 재현도 보장.
- **Accountability(책임)** — `condition_matrix`로 어떤 조건이 MET/UNMET이라 이 점수인지 행 단위로 추적.
- **Cost(비용)** — 점수 계산에 외부 토큰 0. LLM은 설명에만 쓰고 그마저 캐시한다.
- **Reliability(가용성)** — 모델이 죽어도 규칙엔진(Mock)은 항상 성공하므로 화면이 안 깨진다.

:::warning 트레이드오프 — 정직하게
규칙엔진은 "사람이 정의한 규칙만큼만 똑똑하다." 미묘한 문맥(예: "Kotlin 경험 → Java 직무 적합")은 못 잡는다. 그래서 LLM을 버린 게 아니라 **역할을 나눴다**: 정량 채점은 규칙, 정성 설명·맥락 코칭은 LLM. 분산성이 위험한 곳(점수)에서만 분산성을 제거했다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블 근거)

규칙엔진의 실체는 전략(Strategy)+폴백 패턴 위의 한 구현체다.

```text
FitAnalysisAiService (인터페이스)
 ├─ FallbackFitAnalysisAiService  @Primary  ← 폴백 디스패처
 ├─ OssFitAnalysisAiService                 ← 1차 자체 OSS(Ollama)
 ├─ OpenAiFitAnalysisAiService              ← 2차 OpenAI(키 발급 후)
 └─ MockFitAnalysisAiService                ← 3차 규칙엔진(★이 페이지, 항상 성공)
```

이 페이지가 다루는 채점 로직의 실제 위치는 아래와 같다.

| 책임 | 클래스 · 메서드 |
| --- | --- |
| 점수 공식 | `MockFitAnalysisAiService.score(required, preferred, profileLower, profileEmpty)` |
| 조건 매트릭스 | `MockFitAnalysisAiService.conditionMatrix(...)` → `FitConditionMatch(skill, conditionType, matchStatus, evidence)` |
| 5카테고리 분해 | `FitAnalysisServiceImpl.scoreBreakdown(score, rows)` + `weightedConditionScore(rows, type, max)` |
| 지원 판단 | `MockFitAnalysisAiService.applyDecision(fitScore, matched, gaps)` → `FitApplyDecision` |
| 신뢰도(점수와 별개) | `FitAnalysisConfidence.evaluate(command)` |
| 가드레일(LLM 경로) | `OpenAiFitAnalysisAiService.guardApplyDecision(fitScore, conditionMatrix, decision)` |

저장은 불변(immutable) 테이블에 한다. 재분석할 때마다 UPDATE가 아니라 **새 행을 INSERT**한다.

| 테이블 | 역할 | 주요 컬럼 |
| --- | --- | --- |
| `fit_analysis` | 분석 1건(불변) | `fit_score`, `condition_matrix`(JSON), `apply_decision`(JSON), `source_snapshot`(JSON), `model`, `prompt_version`, `status` |
| `fit_analysis_condition_match` | 매트릭스 정규화 | `condition_type`, `match_status`, `evidence` → 관리자 집계·검색용 |
| `fit_analysis_history` | 점수 변화 추적 | `previous_score`, `new_score`, `diff`(gained/resolved/new gaps) |

`condition_matrix`는 `fit_analysis`에 JSON으로 한 번, `fit_analysis_condition_match`에 행으로 한 번 — **이중 저장**한다. JSON은 화면 재현용, 정규화 테이블은 관리자 통계("자주 미충족되는 조건 Top N")용이다.

## 4. 동작 원리 (데이터 흐름 · 단계 · 표 / 작은 코드)

### 4-1. 점수 공식

```java
// MockFitAnalysisAiService.score (축약)
if (required.isEmpty())  return 0;   // 공고 분석 전 → 채점 불가
if (profileEmpty)        return 10;  // 프로필 비면 보유 추정 금지 → 바닥점

double requiredRatio  = matchedRequired  / (double) required.size();
double preferredRatio = preferred.isEmpty() ? 0 : matchedPreferred / (double) preferred.size();
int score = (int) Math.round(10 + requiredRatio * 70 + preferredRatio * 20);
return Math.max(0, Math.min(100, score));   // 0~100 클램핑
```

읽는 법: **기본 10점 + 필수충족비율×70 + 우대충족비율×20.** 가중치가 70 대 20인 이유는 명확하다. "필수"는 점수의 지배 변수여야 하고, "우대"는 가산점이어야 한다. 필수를 다 채워도(70) 기본 10점과 합쳐 80점이고, 우대까지 다 채워야 100점에 닿는다.

:::details 왜 프로필이 비면 10점인가 (과대평가 방지)
프로필에 기술이 하나도 없으면 "보유했다고 추정"하는 순간 점수가 부풀려진다. 그래서 `profileEmpty`일 땐 필수를 전부 UNMET으로 두고 바닥점 10점을 준다. 0점이 아니라 10점인 건 "분석은 돌았지만 입력이 없다"와 "공고 분석조차 안 됨(0점)"을 구분하기 위해서다. 동시에 `FitAnalysisConfidence`가 신뢰도를 -35 깎아 "이 10점은 못 믿는 점수"라고 별도 신호를 보낸다.
:::

### 4-2. 매칭 단계 — `condition_matrix`

각 요구조건을 한 행으로 만들어 보유 여부를 3-값으로 판정한다.

| 판정 | 조건 | 가중 기여 | evidence 예시 |
| --- | --- | --- | --- |
| `MET` | 프로필에 동일 항목 존재 | 1.0 | "프로필 보유 기술에서 동일 항목이 확인됩니다." |
| `PARTIAL` | 유사·포함 관계(예: "AWS EC2" 보유, 조건 "AWS") | 0.5 | "유사/연관 기술이 있어 부분 충족" |
| `UNMET` | 확인 안 됨 | 0.0 | "프로필 보유 기술에서 확인되지 않습니다." |

이 매트릭스는 점수의 **원천 데이터**다. 점수만 보여주면 "왜?"에 답할 수 없지만, 매트릭스가 있으면 "필수 5개 중 3.5 충족이라 이 점수"라고 행으로 짚을 수 있다.

### 4-3. 5카테고리 점수 분해 — `scoreBreakdown`

총점을 카테고리별로 쪼개 진행률 바로 보여준다. 가중 상한은 `45 / 25 / 15 / 10 / 5`(합 100).

| 카테고리 | 상한 | 계산 근거 |
| --- | --- | --- |
| `REQUIRED` 필수 충족도 | 45 | `45 × Σ(MET=1.0, PARTIAL=0.5, UNMET=0.0) / 필수개수` |
| `PREFERRED` 우대 충족도 | 25 | 우대 행에 같은 가중 평균 |
| `PROJECT` 프로젝트 연관성 | 15 | 총점 잔여분에서 배분 |
| `EXPERIENCE` 경력 신뢰도 | 10 | 잔여분 배분 |
| `PROFILE` 완성도 보정 | 5 | 잔여분 배분 |

```java
// weightedConditionScore (축약) — MET=1.0, PARTIAL=0.5, UNMET=0.0
double matched = typed.stream().mapToDouble(row ->
    "MET".equals(row.matchStatus()) ? 1.0
  : "PARTIAL".equals(row.matchStatus()) ? 0.5 : 0.0).sum();
return (int) Math.round(maximum * matched / typed.size());
```

REQUIRED·PREFERRED는 매트릭스에서 직접 가중 평균하고, 나머지 3개(PROJECT/EXPERIENCE/PROFILE)는 총점에서 두 값을 뺀 잔여분을 상한 순서대로 채운다. 이렇게 해야 **막대 합이 항상 총점과 일치**한다(화면에서 "점수는 72인데 막대 합은 75" 같은 모순이 안 생긴다).

### 4-4. 지원 판단 — `applyDecision`

점수 + 필수 미충족 개수로 3-값 판단을 낸다.

| 판단 | 조건 | 의미 |
| --- | --- | --- |
| `APPLY` | `fitScore ≥ 70` **AND** 필수 미충족 = 0 | 지원 가능 |
| `COMPLEMENT` | `fitScore ≥ 50` 또는 (필수미충족 ≥ 2 AND ≥ 40) | 보완 후 지원 |
| `HOLD` | 그 외 | 지원 보류 |

핵심은 **AND 조건**이다. 점수가 90이어도 필수 한 개가 비면 APPLY가 안 나온다. "필수는 충족이 전제"라는 원칙을 점수보다 우선시킨 것이다.

### 4-5. 가드레일 — LLM이 점수를 우회하지 못하게

LLM 경로(OpenAI)에서는 모델이 매트릭스와 모순되게 APPLY를 낼 수 있다. `guardApplyDecision`이 이를 사후 재검증한다.

```java
// OpenAiFitAnalysisAiService.guardApplyDecision (축약)
long requiredUnmet = conditionMatrix.stream()
    .filter(r -> "REQUIRED".equals(r.conditionType()) && "UNMET".equals(r.matchStatus()))
    .count();
if (fitScore >= 70 && requiredUnmet == 0) return decision;   // 통과
// 아니면 강등 + 자동 보정 사유 추가 (AI 원래 reasons 는 유지)
return new FitApplyDecision("COMPLEMENT", reasons + "자동 보정: ...", decision.actions());
```

즉 LLM이 무슨 말을 하든 **최종 APPLY 자격은 규칙엔진과 동일한 게이트**(`score≥70 AND requiredUnmet==0`)를 통과해야 한다. 모델은 설명을 바꿀 수 있어도 판단을 멋대로 부풀릴 수 없다.

### 4-6. 신뢰도 — 점수와 직교(orthogonal)하는 두 번째 축

`FitAnalysisConfidence.evaluate`는 점수가 아니라 **입력 충실도**를 본다. 100점에서 빠진 입력만큼 감점한다.

| 빠진 입력 | 감점 |
| --- | --- |
| 공고 요구 역량 비어있음 | -40 |
| 프로필 기술 비어있음 | -35 |
| 담당 업무 없음 | -10 |
| 자격증 없음 | -8 |
| 희망 직무 없음 | -7 |

레벨은 점수에서 파생: `≥80 HIGH / 50~79 MEDIUM / <50 LOW`. 화면은 "신뢰도 보통 · 72점"처럼 두 축을 함께 찍는다. **점수("얼마나 맞나")와 신뢰도("그 점수를 얼마나 믿나")를 분리**한 게 핵심 — 입력이 부실한 72점과 충실한 72점은 같은 숫자라도 다른 의미다.

## 5. 구현 상태 (됨 vs 향후) — 정직 구분

| 항목 | 상태 |
| --- | --- |
| 점수 공식 `10 + 필수×70 + 우대×20` | ✅ 구현 (`MockFitAnalysisAiService.score`) |
| `condition_matrix` MET/PARTIAL/UNMET 판정 | ✅ 구현 |
| 5카테고리 `scoreBreakdown`(45/25/15/10/5) | ✅ 구현 |
| `applyDecision` 3-값 + AND 게이트 | ✅ 구현 |
| `FitAnalysisConfidence` 결정적 감점 | ✅ 구현 |
| `guardApplyDecision` 사후 재검증 | ✅ 구현 (LLM 경로) |
| 불변 저장 + history + 정규화 매트릭스 | ✅ 구현 (4테이블) |
| 3단 폴백 배선 | ✅ 구현 |
| 실제 OSS 파인튜닝 모델 서빙 | ⏳ 향후 (통합 코드는 됨) |
| OpenAI 키 연동 활성화 | ⏳ 향후 (키 발급 시) |

:::tip 정직한 한 줄
"규칙엔진·매트릭스·5분해·판단·신뢰도·가드·불변저장은 전부 구현돼 결정론적으로 동작합니다. 실제 LLM 설명 생성만 키 발급 후 켜면 되고, 화면 계약은 그때도 동일합니다."
:::

현재 `VITE_USE_MOCK` 토글 기준 규칙엔진이 데모를 돌린다. 중요한 건 **규칙엔진이 임시 대체물이 아니라 영구 채점기**라는 점이다. LLM이 붙어도 점수는 계속 규칙엔진이 낸다.

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단(10초)**
> "점수는 제가 짠 규칙엔진이 결정적으로 계산하고, AI는 그 점수를 설명만 합니다. 재현성과 책임성 때문입니다."

**기본(40초)**
> "`score = 10 + 필수충족비율×70 + 우대충족비율×20`으로 계산합니다. 각 요구조건을 MET/PARTIAL/UNMET로 판정한 `condition_matrix`가 점수의 근거 데이터고, 이걸 다시 필수45·우대25·프로젝트15·경력10·프로필5 다섯 카테고리로 분해해 보여줍니다. LLM이 점수를 내면 같은 입력에 매번 다른 값이 나와 '왜 어제는 72인데 오늘 68이냐'에 답할 수 없습니다. 사용자 인생이 걸린 판단을 분산성 위에 올릴 수 없어 채점을 결정론으로 고정했습니다."

**꼬리질문 대응(요지)**
> "신뢰도는 점수와 별개 축으로, 입력이 부실하면 감점해 '이 점수 못 믿음'을 따로 신호합니다. LLM 경로에서도 `guardApplyDecision`이 모델의 APPLY를 매트릭스로 사후 재검증해, 모델이 판단을 부풀리지 못하게 막습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 가중치 70/20, 카테고리 45/25/15/10/5는 어떻게 정했나? 근거가 있나?**
> 통계 학습으로 뽑은 게 아니라 도메인 규칙으로 정한 가중치입니다. 필수가 점수를 지배하고 우대는 가산점이어야 한다는 원칙을 70/20으로, 채용 평가의 일반적 비중을 5카테고리로 표현했습니다. 핵심은 **값이 투명하고 한 곳에서 바뀐다**는 점입니다. 데이터가 쌓이면 이 상수만 교체하거나 회귀로 보정할 수 있고, 그동안의 모든 점수가 어떤 가중치로 났는지 `prompt_version`으로 추적됩니다.

**Q2. 그럼 AI가 거의 안 쓰이는 거 아닌가? AI 플랫폼 맞나?**
> 점수는 규칙이 내지만, "이 갭을 어떻게 메우라"는 코칭, 톤 전략, 부족역량 학습 로드맵 설명 같은 **정성 영역은 LLM이 생성**합니다. 정량은 규칙, 정성은 LLM이라는 뉴로-심볼릭 분업이고, 신뢰가 필요한 곳에서만 결정론을 씁니다. 오히려 "AI에 점수까지 맡기는" 설계가 제품으로는 더 위험합니다.

**Q3. PARTIAL을 0.5로 둔 게 자의적이지 않나?**
> 부분 일치를 0(무시)이나 1(완전 인정)로 두는 두 극단보다 중간값이 합리적이라는 판단입니다. "AWS EC2 경험"을 "AWS" 조건에 0으로 깎으면 과소평가, 1로 주면 과대평가입니다. 0.5는 보수적 기본값이고, 이 값도 상수 한 곳에 있어 정책이 바뀌면 한 줄로 조정됩니다.

**Q4. 같은 입력은 같은 점수라는데, 공고나 프로필이 나중에 바뀌면?**
> 그래서 분석 시점의 프로필과 공고 revision을 `source_snapshot`에 동결합니다. 이후 원본이 바뀌어도 "그때 그 기준"으로 점수를 재현할 수 있어 감사와 이의제기에 답할 수 있습니다. 재분석은 UPDATE가 아니라 새 행 INSERT라 이력이 보존되고, `fit_analysis_history`가 이전/현재 점수 차이까지 기록합니다.

**Q5. 점수 90인데 지원 보류가 나올 수 있나?**
> `APPLY`는 `점수 ≥ 70 AND 필수 미충족 = 0`의 AND 조건입니다. 점수가 높아도 필수 한 개가 비면 APPLY가 안 나오고 COMPLEMENT로 떨어집니다. "필수는 충족이 전제"라는 원칙을 점수보다 우선시킨 의도된 설계입니다.

**Q6. 신뢰도와 점수를 왜 굳이 둘로 나눴나?**
> 한 숫자로 합치면 "입력이 부실해서 낮은 건지, 정말 안 맞아서 낮은 건지" 구분이 사라집니다. 점수는 적합 정도, 신뢰도는 그 점수의 근거 충실도라는 직교하는 두 질문이라 분리했습니다. 신뢰도는 입력 항목별 결정적 감점(-40/-35/-10/-8/-7)이라 mock·실 AI 어느 경로든 똑같이 산정됩니다.

## 8. 직접 말해보기

아래를 막힘없이 소리 내어 설명할 수 있으면 이 페이지는 통과다.

1. `score = 10 + 필수×70 + 우대×20`을 화이트보드에 적고, 필수 5개 중 3 MET·1 PARTIAL일 때 점수를 계산해 보라.
2. "왜 점수를 LLM이 안 내나"를 credibility/consistency/accountability/cost/reliability 다섯 단어로 1분 안에.
3. `condition_matrix` → `scoreBreakdown` → `applyDecision`으로 이어지는 데이터 흐름을 한 호흡에.
4. 신뢰도와 점수가 직교한다는 말을 "부실한 72점 vs 충실한 72점" 예로 설명.
5. `guardApplyDecision`이 LLM의 무엇을 막는지 한 문장으로.

이어서 볼 페이지: [뉴로-심볼릭 분업](/area-c/neuro-symbolic) · [가드레일](/area-c/guardrails) · [3단 폴백 체인](/area-c/fallback-chain) · [데이터 모델](/area-c/data-model) · [구조화 출력](/ai/openai-structured-output)

## 퀴즈

<QuizBox question="Mock 규칙엔진의 적합도 점수 공식은?" :choices="['필수충족비율 × 100', '10 + 필수충족비율×70 + 우대충족비율×20', '필수×50 + 우대×50', 'AI가 산출한 점수를 0~100으로 정규화']" :answer="1" explanation="기본 10점에 필수충족비율×70, 우대충족비율×20을 더하고 0~100으로 클램핑한다. 필수가 점수를 지배하고 우대는 가산점이 되도록 70/20 가중을 뒀다." />

<QuizBox question="condition_matrix에서 PARTIAL 판정의 가중 기여값은?" :choices="['0.0', '0.5', '0.75', '1.0']" :answer="1" explanation="MET=1.0, PARTIAL=0.5, UNMET=0.0. 유사·포함 관계(예: AWS EC2 보유, 조건 AWS)를 0이나 1의 극단 대신 보수적 중간값 0.5로 둔다." />

<QuizBox question="APPLY(지원 가능) 판단이 나오는 조건으로 옳은 것은?" :choices="['점수가 70점 이상이면 무조건', '필수 미충족이 0개이면 점수와 무관하게', '점수 ≥ 70 AND 필수 미충족 = 0 (둘 다)', '신뢰도가 HIGH이면']" :answer="2" explanation="AND 조건이라 점수가 90이어도 필수가 하나라도 비면 APPLY가 안 나오고 COMPLEMENT로 강등된다. 필수는 충족이 전제라는 원칙을 점수보다 우선한다." />

<QuizBox question="FitAnalysisConfidence(신뢰도)가 점수와 별개로 측정하는 것은?" :choices="['모델의 응답 속도', '입력 데이터의 충실도(공고·프로필 등이 채워졌는지)', '사용자의 합격 확률', 'LLM이 환각을 낸 확률']" :answer="1" explanation="신뢰도는 입력 충실도 기반 결정적 계산이다. 공고 역량 비면 -40, 프로필 기술 비면 -35 식으로 감점해 '그 점수를 얼마나 믿을지'를 점수와 직교하는 축으로 표기한다." />

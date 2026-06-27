# 지원 전략 — apply_decision과 액션 플랜 [영역 C·구현됨]

> "이 공고에 지원해도 되나?"를 `APPLY / COMPLEMENT / HOLD` 한 단어로 확정하고, 그 판단을 즉시 판단 → 지원 전 보완 → 면접 대비 3단계 실행 계획으로 펼쳐 보여주는 기능입니다. 핵심은 **판단도 액션도 LLM의 자유 서술이 아니라 점수·매칭·갭에서 결정적으로 파생**된다는 점입니다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

하나의 지원 건에 대한 적합도 분석 결과(점수, 매칭 역량, 부족 역량)를 입력으로 받아, **지원 판단 카드** `FitApplyDecision(decision, reasons, actions)` 를 만들고, 프런트 `StrategyPanel`에서 이를 **3단계 액션 플랜 + 24시간 액션 + 톤 전략 3종 + 자소서 포인트 + 면접 주제**로 결정적으로 펼치는 기능입니다.

이 페이지로 다음 면접 질문에 막힘없이 답할 수 있어야 합니다.

- "적합도 점수가 70점인데 왜 APPLY가 아니라 COMPLEMENT가 나오나요?"
- "LLM이 '지원하세요'라고 했는데 어떻게 그걸 막죠?"
- "전략 텍스트(3단계 액션)는 AI가 쓰나요, 코드가 쓰나요?"
- "단일 공고 전략과 장기 취업경향은 어떻게 연결되나요?"

:::tip 한 줄로 외우기
**판단(decision)은 규칙엔진이 확정하고, 설명(reasons)은 AI가 거들고, 실행 계획(actions/phases)은 결정적으로 파생한다.** 세 가지 모두 점수·`condition_matrix`·갭이라는 같은 사실에서 나온다.
:::

## 2. 왜 이렇게 설계했나 — 설계 의도와 트레이드오프

지원 판단은 사용자에게 **가장 무게 있는 한마디**입니다. "지원하세요"가 틀리면 사용자는 떨어질 공고에 시간을 쓰고, "보류하세요"가 틀리면 붙을 기회를 놓칩니다. 그래서 이 판단만큼은 환각을 허용할 수 없었습니다.

대안을 비교해 보면 설계 이유가 분명해집니다.

| 대안 | 방식 | 문제 |
| --- | --- | --- |
| (A) LLM이 판단·이유·액션을 모두 자유 생성 | 프롬프트 한 방 | 점수 70점인데 "보류"라 답하는 **모순**, 매번 문구가 달라지는 **비재현성**, "합격 보장" 같은 **과장** |
| (B) 규칙엔진이 전부 생성 | 템플릿 문자열 | 안전하지만 설명이 기계적이고 맥락(회사·직무)을 못 살림 |
| (C·채택) 규칙이 판단을 확정, LLM은 설명만, 액션은 결정적 파생 | 뉴로-심볼릭 | 모순 0·재현 가능·안전. 단 표현 다양성은 톤 전략으로 별도 보완 |

채택한 (C)의 트레이드오프는 명확합니다. **표현의 다양성을 일부 포기하는 대신, 판단의 신뢰성과 재현성을 얻었습니다.** 다양성은 "냉정/격려/실행" 톤 전략 3종으로 사용자가 직접 고르게 해서 보완했습니다.

또 한 가지 의도는 **책임 분리**입니다. 전략 패널은 "무엇을 보완할지, 어떤 주제를 면접에서 다룰지"까지만 제안합니다. 자소서 문장 첨삭은 E 담당 기능, 면접 질문 생성은 D 담당 기능으로 넘깁니다(코드 주석에도 명시). 영역 C는 **판단과 우선순위**를 소유하고, 산출물 생성은 각 도메인에 위임합니다.

## 3. 어떤 기술로 구현했나 — 실제 클래스·메서드·테이블 근거

판단 카드 자체는 단순한 레코드입니다.

```java
// FitApplyDecision.java — 지원 판단 카드 (불변 record)
public record FitApplyDecision(
    String decision,        // APPLY / COMPLEMENT / HOLD
    List<String> reasons,   // 왜 이 판단인지 (사람이 읽는 근거)
    List<String> actions    // 지원 전 실행할 행동
) {}
```

실제 판단 로직과 펼침 로직은 백엔드·프런트에 나뉘어 있습니다.

| 단계 | 위치 | 메서드 / 함수 | 역할 |
| --- | --- | --- | --- |
| 판단 생성 | `MockFitAnalysisAiService` | `applyDecision(fitScore, matched, gaps)` | 점수·필수 미충족 수로 `APPLY/COMPLEMENT/HOLD` 결정 |
| 판단 가드 | `OpenAiFitAnalysisAiService` | `guardApplyDecision(...)` | LLM이 낸 APPLY를 `condition_matrix`로 재검증, 모순이면 COMPLEMENT 강등 |
| 24시간 액션 | `FitAnalysisServiceImpl` | `next24HourActions(actions, gaps)` | 최우선 갭 기반 60분 실습 + 마감 확인 파생 |
| 톤 전략 3종 | `FitAnalysisServiceImpl` | `toneStrategies(score, gaps)` | DIRECT/ENCOURAGING/ACTION 문구 결정적 생성 |
| 불리한 조건 대응 | `FitAnalysisServiceImpl` | `adverseStrategies(gaps)` | 부족 역량을 "숨기지 말고 학습 진행으로 설명" 문구화 |
| 액션 보드 | `FitAnalysisServiceImpl` | `actionBoard(actions, tasks)` | 학습 과제 완료 여부로 todo/진행/완료 칸 분류 |
| 3단계 펼침 | `StrategyPanel.tsx` | `strategyPhases(...)` | 즉시 판단/지원 전 보완/면접 대비 3단계 구성 |
| 자소서·면접 주제 | `StrategyPanel.tsx` | `essaySuggestions` / `interviewSuggestions` | 매칭·갭에서 포인트·주제 파생 |

판단 카드는 `fit_analysis` 테이블의 `apply_decision` JSON 컬럼에 동결 저장됩니다. 재분석 때마다 INSERT되는 불변 테이블이라, 당시 판단을 그대로 재현·감사할 수 있습니다. 전략 텍스트는 `strategy`·`strategy_actions` 컬럼에 들어가고, 24시간/톤/보드 등 파생 항목은 조회 시 `FitAnalysisServiceImpl`이 갭·과제로부터 다시 계산해 응답에 채웁니다(`FitAnalysisDetailResponse`).

## 4. 동작 원리 — 데이터 흐름과 판단 규칙

### 4-1. 판단(decision)을 정하는 결정적 규칙

`applyDecision`의 분기는 점수와 **필수 미충족 개수** 두 축으로 결정됩니다. 필수 미충족은 갭 목록에서 `category == "REQUIRED_MISSING"` 인 항목 수입니다.

```text
requiredMissing = REQUIRED_MISSING 갭 개수

if  fitScore >= 70  AND  requiredMissing == 0   → APPLY
elif fitScore >= 50  OR (requiredMissing >= 2 AND fitScore >= 40) → COMPLEMENT
else                                            → HOLD
```

핵심은 **APPLY의 진입 조건이 가장 엄격**하다는 것입니다. 점수가 아무리 높아도 필수 조건이 하나라도 미충족이면 APPLY가 될 수 없습니다. "필수"는 충족이 전제라는 도메인 정의를 규칙으로 박아 넣은 것입니다.

| decision | 의미 | 진입 조건 | 사용자에게 주는 메시지 |
| --- | --- | --- | --- |
| `APPLY` | 지원 가능 | `점수 >= 70` **그리고** 필수 미충족 0 | 마감 전 지원 + 면접 준비 병행 |
| `COMPLEMENT` | 보완 후 지원 | `점수 >= 50` 또는 (미충족 2개 이상 & 40점 이상) | 상위 갭 보완 → 재분석 |
| `HOLD` | 지원 보류 | 위 조건에 모두 미달 | 핵심 역량 보완 + 더 맞는 공고 탐색 |

### 4-2. 가드레일 — LLM의 APPLY를 재검증

실제 LLM 경로(`OpenAiFitAnalysisAiService`)에서는 모델이 `applyDecision`을 응답으로 내놓습니다. 하지만 그대로 믿지 않고 `guardApplyDecision`이 한 번 더 거릅니다.

```java
// guardApplyDecision — LLM이 APPLY를 냈을 때만 재검증
if (!"APPLY".equals(decision.decision())) return decision;   // APPLY 아니면 통과

long requiredUnmet = conditionMatrix.stream()
    .filter(r -> "REQUIRED".equals(r.conditionType()) && "UNMET".equals(r.matchStatus()))
    .count();

if (fitScore >= 70 && requiredUnmet == 0) return decision;   // 근거와 일치 → 인정

// 모순 → COMPLEMENT로 강등, AI의 reasons는 유지하고 보정 사유만 추가
reasons.add("자동 보정: 적합도 %d점·필수 미충족 %d개 기준에 따라 '보완 후 지원'으로 조정했습니다."
    .formatted(fitScore, requiredUnmet));
return new FitApplyDecision("COMPLEMENT", reasons, decision.actions());
```

여기서 검증의 근거가 LLM의 다른 출력이 아니라 **`condition_matrix`(요구조건 매트릭스)의 REQUIRED·UNMET 행 수**라는 점이 중요합니다. 모델이 점수와 매트릭스를 모순되게 채워도, 매트릭스라는 객관 사실로 판단을 보정합니다. AI가 쓴 `reasons`는 지우지 않고 **보정 사유 한 줄만 덧붙여** 투명하게 남깁니다.

:::warning APPLY 강등이 mock과 실제에서 동일하다
`MockFitAnalysisAiService`는 처음부터 `점수 >= 70 AND 필수 미충족 0` 일 때만 APPLY를 만듭니다. `OpenAiFitAnalysisAiService`는 사후에 같은 규칙으로 강등합니다. 즉 **어느 경로든 사용자에게 노출되는 APPLY의 의미는 정확히 동일**합니다. 이것이 폴백 체인 전체에서 판단의 일관성을 보장하는 장치입니다.
:::

### 4-3. 판단 → 3단계 액션 플랜으로 펼치기 (프런트)

판단 카드와 점수·매칭·갭이 프런트로 내려오면, `StrategyPanel`의 `strategyPhases`가 이를 3단계로 재구성합니다. **백엔드가 준 `strategyActions`를 우선 쓰되, 없으면 갭으로 대체**하는 점진적 파생입니다.

| 단계 | 무엇을 보여주나 | 파생 규칙(요약) |
| --- | --- | --- |
| **즉시 판단** | 오늘 결정할 지원 방향 | `점수 >= 70` → "지원 일정 확정", 미만 → "지원 여부 재검토" + 대표 강점 고정 |
| **지원 전 보완** | 제출 전 완료할 항목 | `strategyActions` 상위 3개, 없으면 HIGH 갭의 보완 결과물 |
| **면접 대비** | 면접에서 검증될 주제 | 매칭 역량 검증 + HIGH 갭 보완 계획을 STAR 구조로 |

같은 패널에서 함께 그려지는 결정적 파생 산출물들:

- **24시간 액션**(`next24HourActions`): `strategyActions` 상위 2개 + HIGH 갭별 "60분 실습 시작" + "마감일·제출 자료 확인" → 최대 3개로 압축.
- **톤 전략 3종**(`toneStrategies`): 같은 사실(점수, HIGH 갭 수)을 `DIRECT`(냉정)·`ENCOURAGING`(격려)·`ACTION`(실행) 세 어조로 표현. 사용자가 칩을 눌러 골라 봅니다.
- **자소서 포인트**(`essaySuggestions`): 매칭 역량은 "정량 성과로 구체화", `REQUIRED_MISSING` 갭은 "유사 경험·학습 계획 언급으로 공백 보완".
- **면접 주제**(`interviewSuggestions`): 매칭 역량은 "선택 이유·문제 해결 사례", HIGH 갭은 "보완 계획·진행 상황".

전체 흐름을 한 줄로 잇자면:

```text
적합도 분석 (점수·matched·gaps 확정)
   └→ applyDecision(): APPLY/COMPLEMENT/HOLD + reasons + actions  ── fit_analysis.apply_decision 저장
        └→ (LLM 경로면) guardApplyDecision() 재검증·강등
             └→ 조회 시 FitAnalysisServiceImpl: 24h·톤·adverse·보드 파생
                  └→ StrategyPanel: 3단계 + 자소서·면접 주제로 화면 구성
```

## 5. 구현 상태 — 됨 vs 향후, 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| `applyDecision` 규칙(APPLY/COMPLEMENT/HOLD) | 구현됨 | `MockFitAnalysisAiService`, 결정적 |
| `guardApplyDecision` 가드레일·강등 | 구현됨 | `OpenAiFitAnalysisAiService`, 테스트 존재 |
| `apply_decision` JSON 동결 저장 | 구현됨 | `fit_analysis` 불변 INSERT |
| 3단계 액션 플랜·24시간·톤·자소서·면접 주제 | 구현됨 | 모두 결정적 파생 (프런트+서비스) |
| 액션 보드(todo/진행/완료) | 구현됨 | 학습 과제 완료 상태 연동 |
| OSS(Ollama) grounding guard 통합 | 구현됨(배선) | 실제 파인튜닝 모델 학습·서빙은 향후 과제 |
| OpenAI 실 LLM 판단 + 가드 | 구현됨(코드)·비활성 | **API 키 발급 후 활성화**, 현재는 규칙엔진 데모 |
| 톤 칩 → 자소서/면접 실제 산출물 연결 | 향후 과제 | 톤은 표현만 조절, 문장 생성은 E·D 도메인 |

:::tip 면접에서의 정직한 한마디
"판단·가드·3단계 파생·동결 저장은 모두 구현되어 있고, 현재는 규칙엔진(`VITE_USE_MOCK`) 기준으로 결정론적으로 동작합니다. 화면과 계약은 실제 LLM과 동일하며, **OpenAI 키가 발급되면 `guardApplyDecision`이 사후 검증을 맡는 구조**입니다."
:::

## 6. 면접 답변 3단계

**초간단(10초):** "지원 판단은 AI가 아니라 규칙엔진이 확정합니다. 점수 70 이상이고 필수 조건을 모두 채웠을 때만 APPLY, 그 외엔 보완(COMPLEMENT)이나 보류(HOLD)입니다. AI는 이유 문장만 거듭니다."

**기본(40초):** "`FitApplyDecision`은 decision·reasons·actions 세 필드입니다. decision은 점수와 필수 미충족 개수 두 축으로 결정적으로 정해집니다. 실제 LLM이 APPLY를 내면 `guardApplyDecision`이 요구조건 매트릭스의 REQUIRED·UNMET 행으로 재검증해서, 모순이면 COMPLEMENT로 강등하고 보정 사유를 남깁니다. 이 판단을 프런트 `StrategyPanel`이 즉시 판단·지원 전 보완·면접 대비 3단계로 펼치고, 24시간 액션과 냉정/격려/실행 톤 3종도 같은 사실에서 결정적으로 파생합니다."

**꼬리질문 대응:** "다양성을 포기한 대신 신뢰성을 얻은 트레이드오프이고, 표현 다양성은 톤 전략 3종으로 사용자가 직접 고르게 보완했습니다. 자소서 문장 첨삭과 면접 질문 생성은 각각 E·D 도메인으로 위임하고, C는 무엇을·어떤 우선순위로만 제안합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 점수가 75점인데 APPLY가 아니라 COMPLEMENT가 나왔습니다. 버그인가요?**
A. 버그가 아니라 의도된 동작입니다. APPLY는 `점수 >= 70` **그리고** 필수 미충족 0을 동시에 만족해야 합니다. 75점이어도 필수 조건이 하나 비어 있으면 COMPLEMENT로 내려갑니다. "필수는 충족이 전제"라는 도메인 정의를 규칙에 반영한 것입니다.

**Q2. LLM이 APPLY를 냈는데 강등하면, 사용자에겐 AI가 틀렸다고 보이지 않나요?**
A. 그래서 강등 시 AI의 `reasons`를 지우지 않고 **보정 사유 한 줄만 추가**합니다. "자동 보정: 적합도 X점·필수 미충족 Y개 기준으로 조정" 형태로 남겨, 무엇을 왜 바꿨는지 투명하게 보여줍니다. 결과 카드엔 "AI 제안·확인 필요" 배지도 함께 붙습니다.

**Q3. 가드레일은 어떤 데이터를 근거로 검증하나요? 또 다른 LLM 출력 아닌가요?**
A. LLM의 다른 출력이 아니라 `condition_matrix`의 `REQUIRED` 행 중 `UNMET` 개수입니다. 매트릭스는 공고 요구조건을 행으로, 충족 여부(MET/PARTIAL/UNMET)와 근거를 담은 객관 표입니다. 점수와 매트릭스가 서로 모순될 때 매트릭스를 신뢰해 판단을 보정합니다.

**Q4. 3단계 액션 플랜 문구는 매번 AI가 새로 쓰나요?**
A. 아닙니다. `strategyPhases`가 점수·매칭·갭에서 결정적으로 구성합니다. 백엔드가 준 `strategyActions`가 있으면 그걸 "지원 전 보완" 단계에 쓰고, 없으면 HIGH 갭으로 대체합니다. 같은 입력이면 같은 플랜이 나와 재현 가능합니다.

**Q5. 톤 전략 3종은 LLM이 세 번 호출되는 건가요?**
A. 아닙니다. `toneStrategies` 하나가 같은 점수·HIGH 갭 수를 받아 DIRECT/ENCOURAGING/ACTION 세 문구를 한 번에 만듭니다. AI 호출은 없고, 사용자는 칩으로 어조만 바꿔 봅니다. 비용 0, 모순 0입니다.

**Q6. 단일 공고 전략과 장기 취업경향(/analysis)은 어떻게 연결되나요?**
A. 단일 공고의 `apply_decision`·갭은 정규화되어 `fit_analysis_condition_match`에 쌓이고, 장기경향 분석(`AnalysisServiceImpl`)이 이를 집계해 "자주 부족한 역량"·"추천 지원방향"을 만듭니다. 즉 공고 하나의 판단이 모이면 "다음 어디로 지원할지"라는 전략으로 올라갑니다. 자세한 연결은 [장기 취업경향](/area-c/career-trend)·[추천 지원방향](/area-c/career-trend)에서 다룹니다.

## 8. 직접 말해보기

아래를 막힘없이 소리 내어 설명할 수 있으면 이 페이지는 합격입니다.

1. APPLY/COMPLEMENT/HOLD를 가르는 두 축과 APPLY의 정확한 진입 조건을 한 문장으로.
2. `guardApplyDecision`이 무엇을 근거로, 어떻게, 무엇을 보존하며 강등하는지.
3. 3단계 액션 플랜·24시간 액션·톤 3종이 "결정적 파생"이라는 말의 뜻과, 그 트레이드오프.
4. 단일 공고 전략이 장기 취업경향으로 올라가는 데이터 경로.

관련 페이지: [적합도 분석 본체](/area-c/fit-analysis) · [점수 규칙엔진](/area-c/score-engine) · [가드레일](/area-c/guardrails) · [뉴로-심볼릭 철학](/area-c/neuro-symbolic) · [구조화 출력](/ai/openai-structured-output)

## 퀴즈

<QuizBox question="적합도 점수가 78점인데도 apply_decision이 COMPLEMENT로 나올 수 있는 조건은?" :choices="['절대 그럴 수 없다 — 70점 이상이면 무조건 APPLY다', '필수(REQUIRED) 조건 중 미충족(UNMET) 항목이 1개라도 있을 때', 'reasons 배열이 비어 있을 때', '우대 역량을 모두 충족하지 못했을 때']" :answer="1" explanation="APPLY는 '점수 >= 70 AND 필수 미충족 0'을 동시에 만족해야 한다. 78점이어도 REQUIRED_MISSING 갭이 하나라도 있으면 COMPLEMENT로 내려간다. '필수는 충족이 전제'라는 도메인 규칙이다." />

<QuizBox question="OpenAiFitAnalysisAiService의 guardApplyDecision이 LLM의 APPLY를 강등할 때 무엇을 근거로 판단하고, AI가 쓴 reasons는 어떻게 처리하는가?" :choices="['LLM에게 다시 물어보고 reasons를 새로 받는다', 'condition_matrix의 REQUIRED·UNMET 행 수로 판단하고, AI reasons는 유지한 채 보정 사유만 추가한다', 'fitScore만 보고 reasons를 전부 지운다', '관리자 메모를 조회해 결정한다']" :answer="1" explanation="가드는 또 다른 LLM 출력이 아니라 객관 표인 condition_matrix의 REQUIRED·UNMET 개수를 근거로 한다. 모순이면 COMPLEMENT로 강등하되 AI의 reasons는 보존하고 '자동 보정' 한 줄만 덧붙여 투명성을 지킨다." />

<QuizBox question="StrategyPanel의 3단계 액션 플랜·24시간 액션·톤 전략 3종은 어떻게 생성되는가?" :choices="['공고마다 LLM을 3~4번 추가 호출해 생성한다', '점수·매칭 역량·부족 역량에서 결정적으로 파생되며 AI 추가 호출이 없다', '사용자가 직접 입력한다', 'MySQL 트리거가 생성한다']" :answer="1" explanation="strategyPhases, next24HourActions, toneStrategies 모두 이미 확정된 점수·matched·gaps라는 같은 사실에서 결정적으로 파생한다. AI 추가 호출이 없어 비용 0·재현 가능하며, 표현 다양성은 톤 칩 선택으로 보완한다." />

# 적합도 분석 [영역 C·구현됨]

> 채용 공고의 요구 조건과 지원자 프로필을 비교해 적합도 점수, 매칭/부족 역량, 학습 로드맵, 지원 전략을 만드는 기능입니다. 핵심은 "AI가 점수를 마음대로 매기지 않고, 서버 규칙·검증으로 확정한다"는 설명가능성입니다.

## 1. 한 줄 정의

특정 **지원 건(Application Case)** 하나에 대해, B가 만든 공고 분석 결과와 A가 가진 사용자 프로필을 비교하여 `0~100점` 적합도와 매칭/부족 역량, 추천 학습/자격증, 지원 판단(지원/보완/보류)을 산출하고 `fit_analysis` 테이블에 저장하는 AI 기능입니다.

## 2. 단어 뜻

| 용어 | 뜻 |
| --- | --- |
| Fit (적합도) | 공고가 원하는 것과 내가 가진 것이 얼마나 겹치는가 |
| Condition Matrix (요구조건 매트릭스) | 공고의 필수/우대 조건을 한 줄씩 나열하고 충족 여부를 판정한 표 |
| MET / PARTIAL / UNMET | 충족 / 부분 충족 / 미충족 (조건별 판정값) |
| Apply Decision (지원 판단) | APPLY(지원 가능) / COMPLEMENT(보완 후 지원) / HOLD(보류) |
| 뉴로-심볼릭 | 신경망(LLM)과 규칙엔진(symbolic)을 결합 — 설명은 AI, 확정은 규칙 |

## 3. 왜 필요한가

이 기능이 없으면 사용자는 "이 공고에 지원해도 될까?"를 감으로만 판단합니다. AI에게 점수만 물으면 두 가지 문제가 생깁니다.

- **설명 불가:** LLM이 "72점"이라고 하면 *왜* 72점인지 근거가 없습니다. 면접에서도, 제품에서도 신뢰할 수 없습니다.
- **모순 노출:** LLM이 필수 조건을 다 못 채웠는데도 "지원하세요(APPLY)"라고 답하는 일이 생깁니다.

그래서 CareerTuner는 **AI에게는 설명·후보를 맡기고, 점수 구성과 최종 판단은 서버 규칙으로 확정**합니다. 이것이 이 기능의 정체성입니다.

## 4. CareerTuner에서 어디에 썼나 [영역 C]

백엔드 패키지 `backend/src/main/java/com/careertuner/fitanalysis` 전체가 이 기능입니다.

| 계층 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| Controller | `FitAnalysisController` (`/api/fit-analyses/**`) | 생성·조회·히스토리·학습과제 토글 엔드포인트 |
| Service | `FitAnalysisServiceImpl` | 입력 조립 → AI 호출 → 규칙 계산 → 저장 → 알림 |
| AI 진입점 | `FitAnalysisAiService` (인터페이스) | `generate(command)` 단일 메서드 |
| 폴백 디스패처 | `FallbackFitAnalysisAiService` (`@Primary`) | OSS 자체모델 → OpenAI → Mock 순서 |
| OpenAI 구현 | `OpenAiFitAnalysisAiService` | structured output 호출 + 가드레일 |
| 입력/출력 DTO | `FitAnalysisAiCommand` / `FitAnalysisAiResult` | A 프로필 + B 공고 입력 / AI 출력 묶음 |
| 프롬프트 | `FitAnalysisPromptCatalog` | 시스템/사용자 프롬프트, 버전 `v0.2` |
| 신뢰도 | `FitAnalysisConfidence` | 입력 부족 기반 결정적 신뢰도 계산 |
| 테이블 | `fit_analysis`, `fit_analysis_learning_task`, `fit_analysis_condition_match`, `fit_analysis_history` | 결과·체크리스트·매트릭스·재분석 이력 |
| 프론트 | `FitAnalysisPanel.tsx`, `useApplicationFitAnalysis.ts`, `fitAnalysisApi.ts` | 패널 UI / 상태 훅 / API 레이어 |

:::tip 영역 경계
입력 데이터(프로필·공고 분석)는 A·B 담당 영역이라 C는 **읽기만** 합니다. `FitAnalysisAiCommand` 주석에도 "원본은 수정하지 않는다"가 명시돼 있습니다.
:::

## 5. 핵심 동작 원리

### 5-1. 전체 흐름 (구현됨)

```text
POST /api/fit-analyses/application-cases/{id}
  → FitAnalysisServiceImpl.generate()
    1) findGenerationSource()  : A 프로필 + B 공고 분석을 한 번에 읽어옴
    2) FitAnalysisAiCommand 조립
    3) fitAnalysisAiService.generate(command)   ← AI/Mock
    4) FitAnalysisConfidence.evaluate(command)  ← 규칙(입력 상태)
    5) fit_analysis insert + 학습과제/매트릭스/히스토리 insert
    6) ai_usage_log 기록(크레딧 차감), 완료 알림 발송
```

### 5-2. 폴백 체인 (구현됨)

`FallbackFitAnalysisAiService`가 항상 답을 주도록 3단을 둡니다. 자체모델이 죽어도, API 키가 없어도 화면은 깨지지 않습니다.

```text
OSS 자체모델(설정 시) → OpenAI(키 있으면 실호출) → 결정적 Mock
```

키가 없으면 `OpenAiFitAnalysisAiService` 내부에서 `MockFitAnalysisAiService`로 폴백하므로, 키 미발급 상태에서도 전체 흐름을 그대로 시연할 수 있습니다.

### 5-3. AI는 설명, 규칙은 확정 (이 기능의 핵심)

LLM은 `OpenAiResponsesClient`의 structured output(JSON 스키마 강제)으로 호출합니다. 하지만 LLM 출력을 그대로 믿지 않고 서버가 **가드레일**을 겁니다.

- 점수는 `Math.max(0, Math.min(100, fitScore))`로 강제 클램프.
- `guardApplyDecision()`: LLM이 `APPLY`라고 해도 **점수 70점 미만이거나 필수 조건 미충족(UNMET)이 1개라도 있으면 `COMPLEMENT`(보완 후 지원)로 강등**하고 보정 사유를 덧붙입니다.

```java
// OpenAiFitAnalysisAiService.guardApplyDecision()
if (fitScore >= 70 && requiredUnmet == 0) {
    return decision;           // 규칙 통과 → APPLY 유지
}
// 모순 → COMPLEMENT 로 강등 + "자동 보정" 사유 추가
```

또한 점수 막대그래프(`scoreBreakdown`)는 LLM 숫자가 아니라 매트릭스 판정에서 가중치(필수 45 / 우대 25 / 프로젝트 15 / 경력 10 / 프로필 5)로 **서버가 재구성**합니다. MET=1.0, PARTIAL=0.5, UNMET=0.0으로 환산합니다.

### 5-4. 신뢰도는 점수와 별개

`FitAnalysisConfidence`는 AI가 아니라 입력 상태로 계산합니다. 100점에서 공고 역량 없음(-40), 프로필 기술 없음(-35) 등을 감점하고, 점수 구간으로 `HIGH/MEDIUM/LOW` 레벨을 파생합니다. "점수는 높지만 입력이 부실하면 신뢰도는 낮다"를 표현하기 위함입니다.

:::warning 자체 LLM은 설계 단계
`FitAnalysisPromptCatalog`에 `FIT_EXPLAIN_SYSTEM_PROMPT`(자체 파인튜닝 모델 `C_FIT_EXPLAIN`용)가 준비돼 있지만, 학습 데이터(`ml/career-strategy-llm`)와 자체모델 서빙은 **미구현·설계 단계**입니다. 현재 운영 경로는 OpenAI + Mock + 규칙엔진입니다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "공고 요구사항과 제 프로필을 비교해 적합도 점수와 부족 역량, 지원 전략을 뽑되, 점수와 지원 판단은 AI가 아니라 서버 규칙으로 확정하는 기능을 만들었습니다."
- **기본:** "LLM에는 structured output으로 매칭/부족 역량과 설명을 시키고, 최종 점수 클램프와 지원 판단은 규칙엔진이 검증합니다. 예를 들어 LLM이 필수 미충족인데도 '지원하라'고 하면 서버가 '보완 후 지원'으로 강등해 모순을 차단합니다."
- **꼬리질문 대응:** "이게 뉴로-심볼릭 패턴입니다. 설명은 신경망이 잘하고, 일관성·검증은 규칙이 잘합니다. 덕분에 점수 막대 구성, 신뢰도, 지원 판단이 모두 근거를 가지고 재현 가능해집니다. API 키가 없어도 같은 규칙으로 Mock이 동작해 데모와 테스트가 안정적입니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. AI가 준 점수를 왜 그대로 안 쓰나요?
LLM은 호출마다 점수가 흔들리고 근거를 보장하지 못합니다. 그래서 점수는 0~100 클램프하고, 화면 점수 막대는 요구조건 매트릭스(MET/PARTIAL/UNMET) 판정에 가중치를 곱해 서버가 재구성합니다. 같은 입력이면 같은 막대가 나와 설명·재현이 됩니다.
:::

:::details Q2. LLM이 모순된 답을 내면 어떻게 되나요?
`guardApplyDecision`이 막습니다. APPLY 판단은 점수 70점 이상이고 필수 미충족이 0개일 때만 통과합니다. 조건에 안 맞으면 COMPLEMENT로 강등하고 "자동 보정: 적합도 N점·필수 미충족 M개" 사유를 붙입니다. 관리자 검수 플래그의 예방 단계 역할입니다.
:::

:::details Q3. API 키가 없는데 어떻게 개발/시연했나요?
`FallbackFitAnalysisAiService`가 OSS → OpenAI → Mock 순으로 폴백합니다. 키가 없으면 `MockFitAnalysisAiService`가 결정적 결과를 주고, 점수·신뢰도 규칙은 동일하게 돌기 때문에 UI 흐름과 테스트(`OpenAiFitAnalysisAiServiceTest`)가 그대로 검증됩니다.
:::

:::details Q4. 재분석하면 무엇이 달라지나요?
프로필을 보완하고 다시 호출하면 새 `fit_analysis` 행이 쌓이고 `fit_analysis_history`에 직전 대비 점수 변화, 새로 매칭된 역량(gained), 해결된 부족(resolved), 새 부족(added)을 계산해 보여줍니다. 첫 분석은 비교 대상이 없어 변화 항목을 비워 노이즈를 막습니다.
:::

:::details Q5. 입력 데이터(프로필·공고)는 누가 관리하나요?
A(프로필)와 B(공고 분석) 담당입니다. C는 `findGenerationSource`로 읽기만 하고, 어떤 입력을 썼는지 시점·식별자를 `source_snapshot`(JSON)에 스냅샷으로 박아둡니다. 원본이 나중에 바뀌어도 그때의 근거가 남습니다.
:::

## 8. 직접 말해보기

1. "적합도 점수가 왜 신뢰할 만한가?"라는 질문에, AI와 규칙엔진의 역할 분담을 30초 안에 설명해 보세요.
2. 면접관이 "LLM이 틀린 점수를 주면요?"라고 물었다고 가정하고, `guardApplyDecision`과 score breakdown 재구성을 예로 들어 답해 보세요.

## 퀴즈

<QuizBox question="적합도 분석에서 최종 fitScore와 지원 판단(APPLY 등)을 확정하는 주체는?" :choices="['LLM이 단독으로 결정한다', '서버 규칙·검증 로직이 확정한다', '사용자가 직접 입력한다', '프론트엔드 패널이 계산한다']" :answer="1" explanation="LLM에는 매칭/부족 역량과 설명을 맡기지만, 점수 클램프와 지원 판단 강등(guardApplyDecision), 점수 막대 재구성은 서버 규칙이 합니다. 설명가능성과 일관성을 위한 뉴로-심볼릭 설계입니다." />

<QuizBox question="LLM이 APPLY로 응답했을 때 guardApplyDecision이 COMPLEMENT로 강등하는 조건은?" :choices="['점수가 90점을 넘을 때', '필수 미충족이 없을 때', '점수 70점 미만이거나 필수 미충족이 1개 이상일 때', '항상 강등한다']" :answer="2" explanation="APPLY는 fitScore 70점 이상이고 필수 조건 UNMET이 0개일 때만 유지됩니다. 그 외에는 COMPLEMENT(보완 후 지원)로 강등하고 자동 보정 사유를 덧붙입니다." />

<QuizBox question="자체 파인튜닝 모델 C_FIT_EXPLAIN의 현재 구현 상태를 정직하게 설명해 보세요." explanation="프롬프트 카탈로그에 FIT_EXPLAIN_SYSTEM_PROMPT가 준비돼 있고 train/serve 정합을 위한 입력 빌더도 설계돼 있지만, 학습 데이터(ml/career-strategy-llm)와 자체모델 서빙은 미구현 설계 단계입니다. 현재 실제 운영 경로는 폴백 체인의 OpenAI structured output과 Mock이며, 점수·신뢰도·지원 판단 확정은 서버 규칙엔진이 담당합니다." />

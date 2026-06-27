# 영역 C 심화 개요 — 취업 전략 분석·대시보드

> 영역 C는 "이 공고에 **지원해도 되나** / **무엇을 보완하나** / **다음 어디로** 가야 하나"를 하나의 흐름으로 답하는 취업 전략 엔진이다. 핵심 철학은 **뉴로-심볼릭**: 점수와 판단은 결정적 규칙엔진이 소유하고, LLM은 설명 텍스트만 만든다.

---

## 1. 영역 C의 정체성 — 한 문장으로

영역 C는 **지원 건(Application Case)** 하나하나에 대해 다음 세 질문을 끊김 없이 이어서 답하는 영역이다.

| 질문 | 산출물 | 담당 화면 |
| --- | --- | --- |
| **지원해도 되나?** | 적합도 점수 + 지원 판단(APPLY/COMPLEMENT/HOLD) + 신뢰도 | `FitAnalysisPanel` |
| **무엇을 보완하나?** | 부족역량 3단계 + 학습 로드맵 + 자격증 추천 | `LearningRecommendationPanel` |
| **다음 어디로?** | 지원 전략 3단계 액션 + 장기 경향 + 다음 지원방향 | `StrategyPanel`, `/analysis` |

C가 다른 영역과 결정적으로 다른 점: **AI가 점수를 정하지 않는다.** 점수·판단·신뢰도는 코드(규칙엔진)가 확정하고, LLM은 그 결과를 사람이 읽을 문장으로 풀어쓸 뿐이다. 이 한 줄이 영역 C의 모든 설계 결정을 지배한다.

:::tip 이 페이지가 답하는 면접 질문
"영역 C가 정확히 뭘 하는 거예요?" / "왜 AI 점수를 안 믿는 구조로 만들었어요?" / "전체 흐름을 한 번 설명해 주세요."
이 개요만 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

---

## 2. 핵심 철학 — 뉴로-심볼릭 (Neuro-Symbolic)

### 한 줄 정의

> **숫자·판단 = 심볼릭(규칙엔진), 설명 = 뉴럴(LLM).** 둘의 역할을 칼같이 분리한다.

LLM에게 "이 사람 몇 점이야?"라고 묻고 그 숫자를 그대로 쓰면, 같은 입력에도 점수가 흔들리고(재현 불가), 근거를 못 대고(설명 불가), 비싸고(매 호출 과금), 모델이 죽으면 화면도 죽는다. 그래서 C는 점수를 LLM에서 빼앗았다.

### 역할 분담 표

| 책임 | 소유자 | 구현 |
| --- | --- | --- |
| 적합도 점수 계산 | 규칙엔진 | `MockFitAnalysisAiService.score()` |
| 지원 판단(APPLY/COMPLEMENT/HOLD) | 규칙엔진 + 가드레일 | `applyDecision()` + `guardApplyDecision` |
| 신뢰도(점수를 얼마나 믿을지) | 결정적 산식 | `FitAnalysisConfidence` |
| 조건 충족 매트릭스 | 규칙엔진 | `conditionMatrix()` |
| **설명 텍스트만** | LLM(OSS/OpenAI) | `OssFitAnalysisAiService` / `OpenAiFitAnalysisAiService` |

### 왜 이렇게 했나 — 5가지 근거

- **Credibility(신뢰):** 점수가 산식으로 설명되니 "왜 73점인지" 답할 수 있다.
- **Consistency(재현성):** 같은 입력 → 항상 같은 점수. 결정적(deterministic).
- **Accountability(책임):** 판단 주체가 코드라 감사·교정이 가능하다(가드레일이 강제 보정).
- **Cost(비용):** 매 조회마다 LLM을 부르지 않는다(캐시 + 점수는 무료 계산).
- **Reliability(가용성):** LLM이 죽어도 규칙엔진(Mock)이 항상 점수를 낸다.

:::warning 면접 핵심 한 줄
"LLM은 점수를 정하지 않습니다. 점수는 규칙엔진이 확정하고, LLM은 그 점수를 사람이 읽을 문장으로 풀어쓸 뿐입니다."
이 문장이 C 면접의 중심 메시지다.
:::

자세히: [뉴로-심볼릭 설계](/area-c/neuro-symbolic) · [점수 규칙엔진](/area-c/score-engine) · [가드레일](/area-c/guardrails)

---

## 3. 담당 AI 기능 7종

영역 C는 7개의 AI 기능을 소유한다. 모두 "규칙엔진이 골격, LLM이 설명" 원칙을 공유한다.

| # | 기능 | 한 줄 설명 | 주요 산출물 |
| --- | --- | --- | --- |
| 12 | 공고-스펙 적합도 | 공고 요구조건 vs 내 프로필 매칭 점수화 | `fitScore`, `conditionMatrix`, `applyDecision` |
| 13 | 부족역량 추천 | 미충족 역량을 3단계로 분류 | `REQUIRED_MISSING` / `PREFERRED_GAP` / `LONG_TERM_GROWTH` |
| 14 | 학습 로드맵 | 부족역량별 3단계 학습 경로 | `learningRoadmap`, `fit_analysis_learning_task` |
| 15 | 자격증 추천 | catalog 기반, 과도추천 억제 | `certificateRecommendations` |
| 16 | 장기 취업경향 | 25종 결정적 집계 → 추세 요약 | `trendSummary`, `recommendedDirections` |
| 17 | 다음 지원방향 | 경향 기반 추천 지원방향 | `recommendedDirections` |
| 18 | 대시보드 요약 | 핵심 지표 1줄 요약 | `dashboard_insight.summary` |

세부 페이지: [적합도 분석](/area-c/fit-analysis) · [부족역량·학습](/area-c/gap-and-learning) · [지원 전략](/area-c/application-strategy) · [장기 경향](/area-c/career-trend) · [대시보드 인사이트](/area-c/dashboard-insight)

---

## 4. 사용자 여정 — 한 흐름으로

C의 화면들은 따로 노는 게 아니라 **하나의 의사결정 루프**를 이룬다.

```text
[홈 /]  ──  대시보드 요약 + 오늘의 할 일(dashboard_todo)
   │        "지금 뭘 봐야 하지?"
   ▼
[대시보드 /dashboard]  ──  전체 지원 현황 + 인사이트 요약
   │
   ▼
[지원건 상세 /applications/{id}/fit]
   ├─ FitAnalysisPanel       → 지원해도 되나? (점수·판단·신뢰도·조건매트릭스)
   ├─ LearningRecommendationPanel → 무엇을 보완하나? (부족역량·로드맵·자격증)
   └─ StrategyPanel          → 어떻게 지원하나? (3단계 액션플랜)
   │
   ▼
[학습/자격증]  ──  로드맵 체크리스트 완료(단건 PATCH)
   │                스펙 보완 시뮬레이터로 예상점수 미리보기
   ▼
[취업분석 /analysis]  ──  5탭 장기 경향
   │   내 지원경향 · 자주 부족한 역량 · 직무별 준비도 · 적합도 점수변화 · 추천 지원방향
   ▼
[다음 지원방향]  ──  "그래서 다음엔 어디로?"
   │
   └──────────────  다시 새 공고를 분석하며 루프 환류
```

핵심: 적합도 결과는 **불변(immutable)**이라 매 재분석마다 새 행을 `INSERT`한다. 그래서 "지난번보다 점수가 올랐다/내렸다"를 `fit_analysis_history`로 추적할 수 있고, 보완 → 재분석 → 개선 확인이 닫힌 루프가 된다.

자세히: [프론트엔드 UI](/area-c/frontend-ui) · [데이터 모델](/area-c/data-model)

---

## 5. 3단 폴백 체인 — 화면은 절대 안 깨진다

C는 LLM 한 곳에 운명을 걸지 않는다. 진입점 `FallbackFitAnalysisAiService`(`@Primary`)가 디스패처가 되어 3단계로 폴백한다.

| 단계 | 구현 | 역할 | 보호장치 |
| --- | --- | --- | --- |
| 1차 자체 OSS | `OssFitAnalysisAiService` (Ollama) | 규칙엔진 골격 + 모델은 설명만 | grounding guard |
| 2차 OpenAI | `OpenAiFitAnalysisAiService` | Responses API json_schema strict | `guardApplyDecision` 재검증 |
| 3차 Mock | `MockFitAnalysisAiService` | 순수 규칙엔진, **항상 성공** | (실패 불가) |

```java
// FallbackFitAnalysisAiService.generate() 골격 (축약)
if (properties.isOss() && ossClient.available()) {
    try { return ossService.generate(command); }
    catch (RuntimeException ex) { log.warn("OSS 실패 → 폴백"); }
}
return openAiService.generate(command); // 키 없으면 내부에서 Mock 폴백
```

- 결과에 `status`(SUCCESS/FALLBACK/FAILED)와 `retryable`을 기록한다.
- 어느 경로가 실패해도 마지막 Mock이 결정적 결과를 보장하므로 **화면이 깨지지 않는다.**
- 패턴: **Strategy + Fallback** (인터페이스 `FitAnalysisAiService` + 4구현).

자세히: [폴백 체인](/area-c/fallback-chain) · [구조화 출력](/area-c/structured-output) · [클래스 설계](/area-c/class-design)

---

## 6. 신뢰성을 떠받치는 4개 기둥

영역 C가 "데모용 장난감"이 아니라 운영 가능한 시스템인 이유는 다음 네 가지다.

### 6.1 가드레일 (사후 보정)
AI가 `APPLY`를 내도, `(fitScore >= 70 AND requiredUnmet == 0)`이 아니면 `guardApplyDecision`이 **COMPLEMENT로 강등**하고 자동보정 사유를 덧붙인다(AI의 원래 reasons는 유지). "합격 보장" 같은 단정 표현은 금지. → [가드레일](/area-c/guardrails)

### 6.2 신뢰도 (점수와 별개)
`FitAnalysisConfidence`는 **입력 충실도**로 결정적 감점한다(공고 역량 비어있음 −40, 프로필 기술 비어있음 −35 등). HIGH≥80 / MEDIUM 50~79 / LOW&lt;50. mock·실제 동일 산정 → "점수를 얼마나 믿을지"를 투명화. → [점수 엔진](/area-c/score-engine)

### 6.3 설명가능성 (감사 가능)
`source_snapshot`이 분석 시점의 프로필·공고 revision을 **동결**해, 나중에 입력이 바뀌어도 당시 기준을 재현·감사할 수 있다. 모든 분석에 `model`/`prompt_version`/`status`를 기록. → [데이터 모델](/area-c/data-model)

### 6.4 캐시 (비용 절감)
`career_analysis_run.input_fingerprint = SHA-256(canonical JSON)`. 장기경향·대시보드는 fingerprint가 같으면 저장 결과를 재사용해 매 조회 AI 재실행을 막는다. 초기 로드는 무료, 명시적 재생성만 크레딧 1 차감. → [캐시·지문](/area-c/caching-fingerprint)

---

## 7. 권장 학습 순서

처음부터 끝까지 한 흐름으로 읽으면 면접 답변이 자연스럽게 이어진다.

**1단계 — 철학과 점수의 뼈대**
1. [뉴로-심볼릭 설계](/area-c/neuro-symbolic) — 왜 점수를 LLM에서 뺐나
2. [점수 규칙엔진](/area-c/score-engine) — `10 + 필수*70 + 우대*20`, 신뢰도 산식
3. [적합도 분석 전체](/area-c/fit-analysis) — condition_matrix, apply_decision

**2단계 — 신뢰성 장치**
4. [가드레일](/area-c/guardrails) — guardApplyDecision, grounding guard
5. [폴백 체인](/area-c/fallback-chain) — OSS → OpenAI → Mock
6. [구조화 출력](/area-c/structured-output) — json_schema strict, 클램핑
7. [캐시·지문](/area-c/caching-fingerprint) — SHA-256 fingerprint

**3단계 — 보완·전략·경향**
8. [부족역량·학습 로드맵](/area-c/gap-and-learning) — 3단계 갭, 체크리스트
9. [지원 전략](/area-c/application-strategy) — APPLY/COMPLEMENT/HOLD 액션
10. [장기 경향](/area-c/career-trend) — 25종 집계, 추천 방향
11. [대시보드 인사이트](/area-c/dashboard-insight) — 홈 재투영

**4단계 — 시스템 구조와 화면**
12. [오케스트레이터 FIT](/area-c/orchestrator-fit) — SseEmitter, 의존 병렬
13. [데이터 모델](/area-c/data-model) — 소유 테이블 13종
14. [클래스 설계](/area-c/class-design) — 4계층 + 폴백체인
15. [프론트엔드 UI](/area-c/frontend-ui) — 훅, 시뮬레이터, Recharts
16. [관리자 화면](/area-c/admin) — 처리 큐, 분석통계, 운영메모
17. [면접 플레이북](/area-c/interview-playbook) — 종합 정리

연관: [구조화 출력 기초](/ai/openai-structured-output) · [JWT 보안](/backend/jwt-security) · [스토리보드 파이프라인](/project/storyboard-pipeline)

---

## 8. 구현 상태 — 정직하게

면접에서 과장은 가장 위험하다. C의 상태는 다음과 같이 정직하게 구분한다.

| 구현 완료 (현재 동작) | 향후 과제 (키/모델 발급 후) |
| --- | --- |
| 규칙엔진 점수·판단·신뢰도·가드레일 | 자체 OSS **파인튜닝 모델 학습·서빙** |
| 캐시·3단 폴백 배선 | OpenAI **실 키 연동** 활성화 |
| 4테이블 저장·히스토리·학습과제·조건매트릭스 | (배선·계약은 이미 완성, 키만 꽂으면 동작) |
| 오케스트레이터 SSE·프론트·관리자 화면 | |
| OSS 통합 코드·grounding guard·폴백 배선 | |

:::tip 정직한 한 줄
"**아키텍처는 완성**돼 있고, 현재는 `VITE_USE_MOCK` 규칙엔진 기준으로 결정론적 데모가 돌아갑니다. 화면과 계약은 실제 LLM과 동일하며, **실 LLM 연동만 키 발급 후 활성화**하면 됩니다."
:::

---

## 9. C 면접 단골질문 5개 (요약 답안)

1. **왜 AI에게 점수를 안 맡겼나요?**
   재현성·설명가능성·책임·비용·가용성 때문입니다. 점수는 규칙엔진이 결정적으로 계산하고, LLM은 설명만 합니다(뉴로-심볼릭).

2. **AI가 틀린 판단을 내면요?**
   `guardApplyDecision`이 사후 검증합니다. `fitScore<70` 이거나 필수 미충족이 있으면 APPLY를 COMPLEMENT로 강등하고 보정 사유를 남깁니다.

3. **LLM이 죽으면 서비스가 멈추나요?**
   아니요. OSS → OpenAI → Mock 3단 폴백이고, 마지막 Mock은 순수 규칙엔진이라 항상 성공합니다. 화면은 안 깨집니다.

4. **매번 AI를 부르면 비싸지 않나요?**
   `input_fingerprint`(SHA-256) read-through 캐시로 같은 입력은 저장 결과를 재사용합니다. 초기 로드는 무료, 명시적 재생성만 크레딧을 씁니다.

5. **나중에 점수 근거를 어떻게 증명하죠?**
   `source_snapshot`이 분석 시점 입력을 동결하고, `score_basis`/`condition_matrix`/`apply_decision`/`analysis_confidence`와 `model`/`prompt_version`을 함께 저장해 그때 기준으로 재현·감사할 수 있습니다.

---

## 10. 직접 말해보기

다음을 보지 않고 60초 안에 말할 수 있으면 C 개요는 합격이다.

- 영역 C가 답하는 **세 질문**과 각각의 산출물·화면
- **뉴로-심볼릭**을 한 문장으로 (점수=규칙엔진, 설명=LLM) + 5가지 근거 중 3개
- **3단 폴백** 순서와 "왜 화면이 안 깨지는가"
- **신뢰성 4기둥** (가드레일·신뢰도·설명가능성·캐시) 이름과 각 한 줄
- 구현 **완료 vs 향후 과제** 경계

---

## 퀴즈

<QuizBox question="영역 C의 뉴로-심볼릭 철학에서 적합도 '점수'를 최종 확정하는 주체는?" :choices="['LLM(OSS 또는 OpenAI)이 직접 점수를 생성', '결정적 규칙엔진(MockFitAnalysisAiService)이 산식으로 계산', '사용자가 수동 입력', '관리자가 운영메모로 지정']" :answer="1" explanation="점수·판단·신뢰도는 규칙엔진이 결정적으로 소유하고, LLM은 그 결과를 설명하는 텍스트만 만든다. 이것이 재현성·설명가능성·비용·가용성을 보장하는 뉴로-심볼릭의 핵심이다." />

<QuizBox question="LLM 호출이 모두 실패해도 적합도 화면이 깨지지 않는 이유로 가장 정확한 것은?" :choices="['프론트가 에러 화면을 띄워서', 'OSS→OpenAI→Mock 3단 폴백의 마지막 Mock 규칙엔진이 항상 성공해서', '캐시에 항상 이전 결과가 있어서', 'AutoPrep 오케스트레이터가 재시도를 무한 반복해서']" :answer="1" explanation="FallbackFitAnalysisAiService가 OSS→OpenAI 순으로 시도하고, 최종 단계 MockFitAnalysisAiService는 외부 호출 없는 순수 규칙엔진이라 항상 결정적 결과를 반환한다. 그래서 어느 경로가 실패해도 화면이 깨지지 않는다." />

<QuizBox question="AI가 APPLY를 냈지만 fitScore가 65점이고 필수 미충족이 1개 있을 때, guardApplyDecision의 동작은?" :choices="['APPLY를 그대로 유지', 'HOLD로 강등', 'COMPLEMENT로 강등하고 자동보정 사유를 추가', '분석 자체를 FAILED 처리']" :answer="2" explanation="가드레일은 (fitScore>=70 AND requiredUnmet==0)을 만족하지 못하면 APPLY를 COMPLEMENT로 강등하고 자동보정 사유를 덧붙인다. 단, AI가 작성한 원래 reasons는 유지한다." />

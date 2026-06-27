# 부족 역량 · 학습 로드맵 · 자격증 추천

> 적합도 점수가 "지원해도 되나"를 답한다면, 이 기능은 "그럼 무엇을, 어떤 순서로 보완하나"를 답한다. 핵심은 **부족 역량을 3단계로 분류하고, 각 부족 역량을 실행 가능한 학습 과제로 변환해 체크리스트로 관리**하는 것이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

부족 역량(gap) 분석은 공고 요구조건과 내 프로필을 비교해 미충족 역량을 추려낸 뒤, 각 역량을 **분류(category) → 우선순위(priority) → 학습 로드맵(3단계) → 자격증 추천**으로 펼치는 결정적 파생 로직이다. 점수와 마찬가지로 **판단값은 규칙엔진(`MockFitAnalysisAiService`)이 소유**하고, LLM은 설명 텍스트만 붙인다.

이 페이지가 막힘없이 답할 수 있게 해주는 면접 질문:

- "부족 역량을 어떻게 우선순위 매겼나요? 왜 그렇게 나눴죠?"
- "학습 추천을 단순 텍스트가 아니라 체크리스트로 만든 이유는?"
- "체크리스트를 왜 JSON 컬럼이 아니라 별도 정규화 테이블로 뺐나요?"
- "자격증을 LLM이 추천하면 과도하게 추천하지 않나요? 어떻게 억제했죠?"

:::tip 먼저 읽으면 좋은 페이지
점수 산출과 조건 매트릭스는 [점수 규칙엔진](/area-c/score-engine), 분류의 신뢰 근거가 되는 뉴로-심볼릭 철학은 [뉴로-심볼릭 설계](/area-c/neuro-symbolic)에서 다룬다. 이 페이지는 그 점수·조건 판정 **이후**의 "보완 흐름"에 집중한다.
:::

## 2. 왜 이렇게 설계했나 (설계 의도와 트레이드오프)

### 2-1. 왜 부족 역량을 3단계로 쪼갰나

"부족한 기술 목록"을 한 덩어리로 주면 사용자는 **무엇부터 해야 할지** 모른다. 필수로 빠진 것과, 있으면 좋은 우대 항목과, 장기 성장용 항목은 **시급성과 의사결정 영향이 완전히 다르다.** 그래서 3개의 `category`로 분리한다.

| category | 의미 | priority | 의사결정 영향 |
| --- | --- | --- | --- |
| `REQUIRED_MISSING` | 공고 **필수** 역량인데 프로필에 없음 | `HIGH` | 지원 가능 여부를 좌우(지원 전 필수 보완) |
| `PREFERRED_GAP` | **우대** 조건이라 보완 시 경쟁력 상승 | `MEDIUM` | 합격 확률 가산점 |
| `LONG_TERM_GROWTH` | 희망 직무 장기 경쟁력 | `LOW` | 당장 지원과 무관, 커리어 투자 |

이 분류는 [가드레일](/area-c/guardrails)의 지원 판단과 직접 맞물린다. `REQUIRED_MISSING`이 1개라도 있으면 `guardApplyDecision`이 `APPLY`를 `COMPLEMENT`로 강등한다. 즉 **분류 자체가 "지원해도 되나"의 입력**이다.

### 2-2. 대안과 트레이드오프

- **대안 A: LLM이 직접 "이거 공부하세요"를 자유 텍스트로 출력.** 폐기. 같은 입력에 매번 다른 추천이 나오고(재현성 0), 입력에 없던 회사·자격증을 지어낼 위험이 있다. 우리는 분류·우선순위를 규칙으로 확정하고 LLM은 설명만 입힌다.
- **대안 B: 부족 역량을 점수 안에 녹여 숫자만 보여주기.** 폐기. "왜 보완해야 하는지"가 사라져 행동으로 이어지지 않는다. 우리는 점수와 별개로 `reason`을 붙여 설명가능성을 확보한다.
- **선택: 결정적 분류 + 텍스트만 LLM.** 트레이드오프는 "추천 문구의 표현 다양성"을 일부 포기하는 것. 대신 신뢰·재현성·책임을 얻는다. C 영역에서 이 교환은 항상 후자가 이긴다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3-1. 데이터 모델 (record)

규칙엔진이 생성하는 세 종류의 도메인 객체. 모두 Java `record`다.

```java
// 부족 역량 한 줄: 분류 + 우선순위 + 사유
record FitGapRecommendation(String skill, String category, String priority, String reason)

// 학습 로드맵 한 단계: 실습 과제 + 예상 기간 + 정렬순서
record FitLearningRoadmapItem(
    String skill, String title, String practiceTask,
    String expectedDuration, String priority, int sortOrder)

// 자격증 한 줄: 이름 + 우선순위 + 사유
record FitCertificateRecommendation(String name, String priority, String reason)
```

### 3-2. 영속 테이블 — `fit_analysis_learning_task`

학습 로드맵 항목은 **체크리스트로 상태가 바뀌므로** `fit_analysis`의 JSON 컬럼에 묻지 않고 별도 정규화 테이블로 뺐다(자세한 이유는 4-3).

| 컬럼 | 타입 | 비고 |
| --- | --- | --- |
| `id` | BIGINT PK AI | |
| `fit_analysis_id` | BIGINT FK | `fit_analysis(id)` `ON DELETE CASCADE` |
| `skill` | VARCHAR(255) | 어떤 부족 역량에서 파생됐는지 |
| `title` | VARCHAR(500) | "Docker 1단계 · 핵심 개념 정리" |
| `practice_task` | VARCHAR(1000) | 실제로 손으로 할 과제 |
| `expected_duration` | VARCHAR(100) | "3~5일", "1주" |
| `priority` | VARCHAR(20) | 부모 gap의 priority 상속(기본 `MEDIUM`) |
| `sort_order` | INT | 우선순위 + 단계 순서 |
| `completed` / `completed_at` | TINYINT / DATETIME | 체크 상태와 완료 시각 |

인덱스 `idx_fit_learning_task_analysis(fit_analysis_id)`. `fit_analysis` 자체는 **불변(재분석마다 INSERT)** 이지만, 이 자식 테이블의 `completed`만은 사용자가 갱신한다 — 분석 결과는 동결, 진척 상태는 가변이라는 경계가 테이블 분리로 명확해진다.

### 3-3. API 표면

| 동작 | 엔드포인트 |
| --- | --- |
| 적합도(+로드맵·자격증) 생성/재생성 | `POST /api/fit-analyses/application-cases/{applicationCaseId}` |
| 학습 과제 단건 체크 토글 | `PATCH /api/fit-analyses/{fitAnalysisId}/learning-tasks/{taskId}` |

PATCH 본문은 `record UpdateLearningTaskRequest(boolean completed)` 단 하나의 필드다. 컨트롤러는 `FitAnalysisController`, 서비스는 `FitAnalysisServiceImpl.updateLearningTask(...)`.

## 4. 동작 원리 (데이터 흐름과 코드)

### 4-1. 부족 역량 → 3단계 분류

`gapRecommendations()`는 미충족 역량 리스트를 받아 출처에 따라 분류한다(실제 로직 축약):

```java
for (String skill : missing) {
    if (containsIgnoreCase(required, skill))
        new FitGapRecommendation(skill, "REQUIRED_MISSING", "HIGH",  "공고 필수 역량이지만 프로필에서 확인되지 않습니다.");
    else if (containsIgnoreCase(preferred, skill))
        new FitGapRecommendation(skill, "PREFERRED_GAP",   "MEDIUM","우대 조건 경쟁력을 높이기 위해 보완을 권장합니다.");
    else
        new FitGapRecommendation(skill, "LONG_TERM_GROWTH","LOW",   "희망 직무의 장기 경쟁력을 위해 학습할 가치가 있습니다.");
}
```

핵심: **분류 기준은 "이 역량이 공고의 required였나 preferred였나"** 라는 입력 출처다. LLM이 "이건 중요해 보여요"로 판단하지 않는다. 그래서 같은 공고·프로필이면 분류가 100% 재현된다.

### 4-2. 학습 로드맵 3단계 (핵심개념 → 실습 → 포트폴리오)

`learningRoadmap()`은 우선순위 상위 **최대 3개** 부족 역량을 골라(`gaps.stream().limit(3)`) 각각을 동일한 3단 학습 사이클로 펼친다. `sortOrder`는 1부터 증가해 "역량 순서 × 단계 순서"를 한 줄로 직렬화한다.

| 단계 | title 패턴 | practiceTask 의도 | expectedDuration |
| --- | --- | --- | --- |
| 1단계 | `{skill} 1단계 · 핵심 개념 정리` | 핵심 개념 + 실무 패턴을 예제와 정리 | 3~5일 |
| 2단계 | `{skill} 2단계 · 적용 실습` | 작은 기능 구현 + 동작 테스트 | 1주 |
| 3단계 | `{skill} 3단계 · 포트폴리오 근거화` | README에 선택 이유·문제 해결·검증을 정리해 **면접에서 설명할 근거** 생성 | 2~3일 |

3단계의 설계 철학이 중요하다 — 학습이 "공부했다"로 끝나지 않고 **"지원서·면접에서 말할 수 있는 근거"** 로 수렴한다. 이것이 C 영역의 정체성(보완 → 설명 가능한 자산화)과 맞닿는다.

:::warning 왜 3개로 제한했나
부족 역량이 8개여도 8 × 3 = 24개 체크리스트를 던지면 사람은 포기한다. 상위 3개만 펼쳐 "이번 주에 끝낼 수 있는 분량"으로 줄인다. 프론트는 여기서 다시 미완료 항목을 priority(HIGH→LOW)·sortOrder로 정렬해 **이번 주 목표 3개**만 뽑는다(`WeeklyPlanCard`).
:::

### 4-3. 왜 JSON 컬럼이 아니라 정규화 테이블인가 (꼭 외울 답)

`fit_analysis`에는 `matchedSkills`, `gapRecommendations`, `conditionMatrix` 등 다수 JSON 컬럼이 있다. 그런데 학습 과제만 별도 테이블이다. 이유는 **읽기 전용 분석 결과 vs 사용자가 갱신하는 진척 상태**의 차이다.

- `fit_analysis`는 불변이다. 재분석하면 새 행을 INSERT하고 과거 행은 그대로 둔다(감사·재현). 여기에 `completed`를 넣으면 "분석 결과를 사후 수정"하는 셈이라 불변성이 깨진다.
- 체크 토글은 **단건 부분 갱신**이다. JSON 배열 안의 한 원소를 바꾸려면 전체 JSON을 읽어 파싱→수정→직렬화→통째 UPDATE해야 하고, 동시 토글 시 lost update가 생긴다. 정규화 테이블이면 `WHERE id = ?` 한 줄 UPDATE로 끝난다.
- 소유권 검증을 SQL로 직접 건다. PATCH는 다음처럼 조인으로 **그 과제가 정말 이 사용자 것인지**를 보장한다:

```sql
UPDATE fit_analysis_learning_task task
JOIN fit_analysis fa ON fa.id = task.fit_analysis_id
JOIN application_case ac ON ac.id = fa.application_case_id
SET task.completed = #{completed},
    task.completed_at = IF(#{completed}, CURRENT_TIMESTAMP, NULL)
WHERE task.id = #{taskId} AND task.fit_analysis_id = #{fitAnalysisId}
  AND ac.user_id = #{userId} AND ac.deleted_at IS NULL
```

`updateLearningTaskCompleted`가 0행을 반환하면 서비스가 `NOT_FOUND`를 던진다 — 남의 과제를 토글하려는 시도가 자연스럽게 차단된다.

### 4-4. 자격증 추천과 과도추천 억제

자격증은 자유 추론이 아니라 **희망 직무 키워드 기반 카탈로그 매핑**이다. `recommendCertificates(desiredJob)`는 직무에 "데이터/data/ml/ai"가 있으면 SQLD·ADsP·빅데이터분석기사, "클라우드/cloud/devops/인프라"면 AWS SAA·정보처리기사·리눅스마스터 식으로 **사전 큐레이션된 목록**만 반환한다. LLM이 존재하지 않는 자격증을 지어낼 여지가 없다.

우선순위는 목록 순서대로 첫 항목 `HIGH`, 둘째 `MEDIUM`, 나머지 `LOW`로 매겨 **무한정 강조하지 않는다**. 더 중요한 억제는 프론트에 있다 — `LearningRecommendationPanel`은 자격증이 2개 이상이고 동시에 `HIGH`(필수 부족) gap이 남아 있으면 경고 박스를 띄운다:

```ts
const certificateCaution =
  detailedCertificates.length >= 2 && gaps.some(g => g.priority === "HIGH");
// → "자격증 준비보다 필수 부족 역량 보완을 우선하세요"
```

기획 원칙(자격증 과도추천 억제)을 **UI 레이어의 결정적 규칙**으로 구현한 것이다. "딸 수 있는 자격증을 다 따라"가 아니라 "지금은 실무 보완이 먼저"라고 사용자를 말린다.

### 4-5. 부족 역량 → 포트폴리오 과제 변환

`PortfolioTaskCard`는 `HIGH` 우선순위거나 `PREFERRED_GAP`인 gap을 골라 "작은 기능 구현 + README에 선택 이유·문제 해결·검증 결과 정리" 과제로 바꾼다. 이력서 문장 첨삭(B/D 영역 경계)이 아니라 **결과물 과제**라는 점이 C의 책임 경계를 지킨다.

### 4-6. 준비율과 80% 재분석 유도

패널은 과제 완료 비율을 계산한다.

```ts
const completionRate = tasks.length === 0 ? 0
  : Math.round(tasks.filter(t => t.completed).length / tasks.length * 100);
```

`completionRate >= 80`이면 **"적합도 재분석"** 버튼이 뜬다. 학습을 끝낸 뒤 점수가 얼마나 올랐는지 확인하는 폐루프를 만든다. 재분석은 `POST`로 새 `fit_analysis` 행을 INSERT하고, [점수 변화 히스토리](/area-c/score-engine)에 diff(gained/resolved/new gaps)가 기록된다 — "보완 → 재분석 → 점수 상승 확인"이 한 흐름으로 닫힌다.

## 5. 구현 상태 (됨 vs 향후) — 정직 구분

| 항목 | 상태 |
| --- | --- |
| 3단계 gap 분류(REQUIRED_MISSING/PREFERRED_GAP/LONG_TERM_GROWTH) | 구현됨 (규칙엔진 결정적) |
| 학습 로드맵 3단계 생성 + `fit_analysis_learning_task` 저장 | 구현됨 |
| 단건 PATCH 체크 토글 + 소유권 SQL 검증 | 구현됨 |
| 자격증 카탈로그 매핑 + 과도추천 억제(UI 경고) | 구현됨 |
| 준비율·이번 주 목표·80% 재분석 유도·포트폴리오 과제 | 구현됨 (프론트) |
| OSS 모델의 설명 텍스트 생성 + grounding guard(부족을 보유로 서술하면 재호출) | 통합 코드 구현됨, **실제 파인튜닝 모델 서빙은 향후** |
| OpenAI 구조화 출력으로 로드맵·자격증 사유 생성 | 코드 배선됨, **키 발급 후 활성화** |

:::tip 면접 정직 표현
"분류·우선순위·로드맵 골격·자격증 카탈로그·체크리스트 영속화는 전부 규칙엔진으로 **완성**됐고 현재 결정론적으로 동작합니다. LLM은 사유 문장만 입히는 자리이고, 실제 모델 연동은 키 발급 후 활성화입니다. 화면과 계약은 실 LLM과 동일합니다."
:::

## 6. 면접 답변 3단계

- **초간단(15초):** "부족 역량을 필수미충족·우대보완·장기성장 3단계로 나누고, 상위 3개를 핵심개념→실습→포트폴리오 3단 로드맵으로 펼쳐 체크리스트로 관리합니다. 분류와 우선순위는 규칙엔진이 확정하고 LLM은 설명만 답니다."
- **기본(1분):** 여기에 "체크리스트는 분석 결과(불변)와 진척 상태(가변)를 분리하려고 `fit_analysis_learning_task` 정규화 테이블로 빼서 단건 PATCH로 토글하고, UPDATE에 조인으로 사용자 소유권을 검증합니다. 자격증은 카탈로그 기반이라 환각이 없고, 필수 부족이 남으면 UI가 자격증보다 실무 보완을 우선하라고 경고합니다."
- **꼬리질문 대응:** "80% 완료 시 재분석을 유도해 점수 변화를 확인하는 폐루프를 만들고, 그 변화는 히스토리 diff로 기록됩니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 부족 역량 우선순위를 LLM이 매기면 더 똑똑하지 않나요?**
표현은 다양해지지만 재현성과 책임이 깨집니다. 같은 공고에 매번 다른 우선순위가 나오면 사용자가 신뢰하지 못하고, "왜 이걸 HIGH로 봤냐"에 답할 수 없습니다. 우리 분류 기준은 "공고의 required였나 preferred였나"라는 입력 출처라 100% 설명·재현됩니다.

**Q2. 체크리스트를 JSON 컬럼에 넣지 않은 이유를 한 문장으로?**
분석 결과는 불변·재현 대상이라 동결하는데 체크 상태는 사용자가 계속 바꾸는 가변 데이터라, 둘을 한 행에 섞으면 부분 갱신 시 lost update와 불변성 위반이 생기기 때문입니다. 정규화 테이블이면 `WHERE id=?` 한 줄로 토글하고 조인으로 소유권까지 검증합니다.

**Q3. 자격증 환각은 어떻게 막나요?**
LLM 자유 추론이 아니라 희망 직무 키워드로 사전 큐레이션된 카탈로그를 매핑합니다. 존재하지 않는 자격증이 나올 수 없습니다. OSS 경로에선 입력에 없는 자격증·수치를 추가하면 grounding guard가 재호출하고 소진 시 폴백합니다.

**Q4. 자격증을 많이 추천할수록 좋지 않나요?**
아니요. 필수 부족 역량이 남아 있는데 자격증 공부에 시간을 쓰면 정작 지원 가능 여부가 안 바뀝니다. 그래서 자격증 2개 이상 + HIGH gap 잔존이면 "실무 보완 우선" 경고를 띄워 사용자를 말립니다 — 추천 억제도 결정적 규칙입니다.

**Q5. 로드맵을 왜 상위 3개로 제한했나요?**
부족 역량이 많을 때 전부 펼치면 체크리스트가 폭발해 사람이 포기합니다. 우선순위 상위 3개만 펼쳐 "이번 주에 끝낼 분량"으로 줄이고, 프론트는 그중 미완료를 다시 정렬해 이번 주 목표 3개만 강조합니다.

**Q6. 학습이 끝났는지 시스템이 어떻게 아나요?**
사용자가 PATCH로 토글한 `completed` 비율을 계산합니다. 80% 이상이면 재분석을 유도하고, 새 분석 점수와 직전 점수의 diff(해결된 gap, 새 gap)를 히스토리에 남겨 보완 효과를 수치로 보여줍니다.

## 8. 직접 말해보기

다음을 막힘없이 30초씩 설명할 수 있으면 이 페이지는 통과다.

1. 부족 역량 3분류와 각 priority, 그리고 그게 지원 판단과 어떻게 연결되는지
2. 학습 로드맵 3단계(핵심개념→실습→포트폴리오)와 마지막 단계가 "면접 근거"인 이유
3. 체크리스트를 정규화 테이블로 뺀 이유 + PATCH가 소유권을 검증하는 방법
4. 자격증 카탈로그 매핑과 과도추천 억제(UI 경고) 로직
5. 준비율 80% 재분석 유도로 만드는 보완-검증 폐루프

## 퀴즈

<QuizBox question="학습 과제 체크리스트를 fit_analysis의 JSON 컬럼이 아니라 별도 fit_analysis_learning_task 테이블로 분리한 핵심 이유는?" :choices="['JSON 파싱이 느려서', '분석 결과는 불변인데 completed 상태는 사용자가 갱신하는 가변 데이터라 단건 부분 갱신과 소유권 검증이 필요해서', 'MyBatis가 JSON을 지원하지 않아서', '관리자 통계에서만 쓰는 테이블이라서']" :answer="1" explanation="fit_analysis는 재분석마다 INSERT되는 불변 행이라 감사·재현 대상입니다. 반면 completed는 사용자가 계속 토글하는 가변 상태라, 한 행에 섞으면 부분 갱신 시 lost update와 불변성 위반이 생깁니다. 정규화 테이블이면 WHERE id=? 단건 UPDATE로 토글하고 조인으로 사용자 소유권까지 검증할 수 있습니다." />

<QuizBox question="부족 역량이 미충족인 required 출처일 때 부여되는 category와 priority의 조합으로 옳은 것은?" :choices="['PREFERRED_GAP / MEDIUM', 'LONG_TERM_GROWTH / LOW', 'REQUIRED_MISSING / HIGH', 'REQUIRED_MISSING / MEDIUM']" :answer="2" explanation="gapRecommendations()는 missing 역량이 공고 required에 속하면 REQUIRED_MISSING·HIGH, preferred면 PREFERRED_GAP·MEDIUM, 둘 다 아니면 LONG_TERM_GROWTH·LOW로 분류합니다. REQUIRED_MISSING이 1개라도 있으면 가드레일이 APPLY를 COMPLEMENT로 강등합니다." />

<QuizBox question="프론트엔드 LearningRecommendationPanel이 자격증 과도추천 경고(certificateCaution)를 띄우는 조건은?" :choices="['자격증이 1개 이상일 때 항상', '준비율이 80% 이상일 때', '자격증 추천이 2개 이상이고 동시에 HIGH 우선순위 부족 역량이 남아 있을 때', '적합도 점수가 50점 미만일 때']" :answer="2" explanation="detailedCertificates.length >= 2 && gaps.some(g => g.priority === 'HIGH') 조건입니다. 필수 부족 역량이 남았는데 자격증이 여럿 추천되면, 자격증보다 실무 보완을 우선하라고 사용자를 말립니다. 기획의 자격증 과도추천 억제 원칙을 UI의 결정적 규칙으로 구현한 것입니다." />

# 적합도 분석 — 전체 파이프라인

> 영역 C의 플래그십. "이 공고에 지원해도 되나"라는 한 질문에, 점수 하나가 아니라 **근거·판단·다음 행동**을 한 번에 답하는 파이프라인이다. 점수와 판단은 서버 규칙엔진이 확정하고, LLM은 설명만 붙인다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

특정 **지원 건(Application Case)** 하나를 대상으로, B가 만든 공고 분석(`job_analysis`)과 A가 가진 사용자 프로필(`user_profile`)을 비교해 `0~100` 적합도, 매칭/부족 역량, 요구조건 매트릭스, 지원 판단(APPLY/COMPLEMENT/HOLD), 학습 로드맵을 한 번에 산출하고, 그 결과를 `fit_analysis` 외 4개 테이블에 불변 기록으로 저장하는 기능이다.

이 페이지가 면접에서 답해야 하는 질문은 이것이다.

- "적합도 기능 전체 흐름을 처음부터 끝까지 설명해 보세요."
- "왜 그냥 LLM에 점수만 물어보지 않았나요?"
- "재분석하면 데이터가 어떻게 쌓이나요? 과거 분석은 왜 안 지우나요?"
- "응답에 들어가는 `scoreBreakdown`·`actionBoard`·`toneStrategies`는 어디서 나오나요?"

핵심 메서드는 `FitAnalysisServiceImpl.generate(userId, applicationCaseId)` 하나다. 이 페이지는 그 메서드를 한 줄씩 따라가며 전체 그림을 그린다.

:::tip 한 문장 요약
`generate()`는 **입력 조립 → 규칙엔진 점수·판단 → LLM 설명 → 가드 재검증 → 5테이블 저장 → 응답 파생**의 6단계 오케스트레이션이다. 어느 AI 경로가 죽어도 화면은 안 깨진다.
:::

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 대안 A — "LLM에 점수까지 다 맡긴다" (채택 안 함)

가장 쉬운 길이다. 공고와 프로필을 프롬프트에 넣고 "적합도 몇 점, 지원해도 되는지 알려줘"라고 한 번에 묻는다. 하지만 C 도메인에서는 이게 치명적이다.

| 문제 | 구체적 증상 | 채용 도메인에서의 위험 |
| --- | --- | --- |
| 설명 불가(credibility) | "72점"의 *근거*가 없다 | 사용자가 인생 결정(지원 여부)을 감으로 내림 |
| 재현성 없음(consistency) | 같은 입력에 매번 다른 점수 | 관리자 통계·점수 변화 추적이 의미 없어짐 |
| 모순 노출(accountability) | 필수 조건 미충족인데 "지원하세요" | 잘못된 권유의 책임 소재가 불명확 |
| 비용·가용성(cost/reliability) | 매 조회마다 토큰 소모, 모델 다운 시 화면 깨짐 | 무료 데모·면접 시연이 불가능 |

### 대안 B — "전부 규칙으로만 한다" (채택 안 함)

점수·판단은 결정적이라 좋지만, 설명 텍스트가 기계적이고 딱딱하다. "AWS 부족은 숨기지 말고 학습 결과와 함께 설명하세요" 같은 사람 말투의 코칭을 규칙만으로 자연스럽게 쓰기 어렵다.

### 채택 — 뉴로-심볼릭 분담

그래서 둘을 쪼갰다. **판단값(점수·매칭·부족·지원판단·조건매트릭스)은 규칙엔진이 소유·확정**하고, **LLM은 그 확정값을 입력으로 받아 한국어 설명 텍스트만 생성**한다. 점수는 결정적이라 신뢰·재현·감사가 되고, 설명은 LLM이라 자연스럽다. 자세한 원리는 [뉴로-심볼릭 아키텍처](/area-c/neuro-symbolic)에서 다룬다.

:::warning 면접에서 자주 찌르는 지점
"그럼 LLM이 점수를 틀리게 내면요?"라는 질문이 반드시 온다. 답: **LLM이 낸 점수는 애초에 읽지 않는다.** OSS 경로는 모델 출력의 `fitScore`/`decision` 같은 키를 화이트리스트(`fitSummary`/`strategyActions`/`learningTaskReasons`)로 막아 구조적으로 무시하고, OpenAI 경로는 점수를 `0~100`으로 클램핑한 뒤 `guardApplyDecision`으로 판단을 재검증한다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블)

| 계층 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| Controller | `FitAnalysisController` (`/api/fit-analyses/**`) | 생성(POST)·조회(GET)·히스토리·학습과제 PATCH |
| Service | `FitAnalysisServiceImpl.generate` | 6단계 오케스트레이션의 본체 |
| AI 진입점 | `FitAnalysisAiService` (인터페이스) | `generate(command)` 단일 메서드 |
| 폴백 디스패처 | `FallbackFitAnalysisAiService` (`@Primary`) | OSS → OpenAI → Mock 순서 결정 |
| 규칙엔진 | `MockFitAnalysisAiService` | 점수·판단·매칭·조건매트릭스 결정적 계산 |
| OSS 조립 | `OssFitAnalysisAiService` | 규칙 골격 + 모델 설명 병합 + grounding guard |
| OpenAI | `OpenAiFitAnalysisAiService` | structured output 호출 + `guardApplyDecision` |
| 신뢰도 | `FitAnalysisConfidence.evaluate` | 입력 충실도 기반 결정적 신뢰도 |
| 입력 DTO | `FitAnalysisAiCommand` | A 프로필 + B 공고를 묶은 AI 입력 |
| 출력 DTO | `FitAnalysisAiResult` | AI 단계가 돌려주는 16필드 결과 묶음 |
| 응답 DTO | `FitAnalysisDetailResponse` | 화면용 최종 응답(파생 필드 포함) |
| 매퍼 | `FitAnalysisMapper` (+ `FitAnalysisMapper.xml`) | 입력 조인 조회 · INSERT · 히스토리 |

저장 테이블(C 소유, 패치 `db/patches/20260609_c_fit_analysis_detail.sql`):

| 테이블 | 성격 | 핵심 컬럼 |
| --- | --- | --- |
| `fit_analysis` | 불변, 분석마다 1행 INSERT | `fit_score`, `source_snapshot`, `score_basis`, `gap_recommendations`, `condition_matrix`, `apply_decision`, `analysis_confidence`(모두 JSON), `model`, `prompt_version`, `status` |
| `fit_analysis_history` | 분석당 1행 (`UNIQUE fit_analysis_id`) | `previous_score`, `new_score`, `diff`(gained/resolved/new gaps) |
| `fit_analysis_condition_match` | 조건매트릭스 정규화 | 조건별 행 + `severity` + `sort_order` |
| `fit_analysis_learning_task` | 학습 체크리스트 | `skill`, `title`, `practice_task`, `priority`, `sort_order`, `completed` |
| `ai_usage_log` | 공통 사용량 기록 | `status`, `model`, 토큰, `credit_used` |

읽기 전용 입력: `user_profile`(A), `job_analysis`·`application_case`(B). C는 이들을 `findGenerationSource`로 **조인 조회만** 하고 절대 쓰지 않는다.

## 4. 동작 원리 (`generate()` 6단계 데이터 흐름)

`FitAnalysisServiceImpl.generate`를 단계별로 본다.

### 단계 0 — 입력 조립 (`findGenerationSource`)

`FitAnalysisMapper.findGenerationSource`가 `application_case` + 최신 `job_analysis` + `user_profile`을 한 쿼리로 조인하고, `user_id`로 소유권을 검증한다. 결과 `FitAnalysisGenerationSource`에서 회사명·직무·필수/우대 역량·담당업무·프로필 기술·자격증·희망직무를 꺼내 `FitAnalysisAiCommand`로 묶는다. 지원 건이 없으면 `NOT_FOUND`로 끝낸다.

```text
application_case(B) ─┐
job_analysis(B)    ─┼─► FitAnalysisGenerationSource ─► FitAnalysisAiCommand
user_profile(A)    ─┘     (읽기 전용 조인, user_id 검증)
```

### 단계 1 — 직전 분석 조회 + 규칙엔진 호출

`previous = findLatestByUserIdAndApplicationCaseId(...)`로 직전 행을 잡아 둔다(나중 히스토리 diff용). 그다음 `fitAnalysisAiService.generate(command)`를 호출한다. 이 한 줄이 폴백 체인 전체를 트리거한다 — 자세한 순서는 [3단 폴백 체인](/area-c/fallback-chain).

점수는 규칙엔진이 확정한다. 핵심 공식:

```text
fitScore = 10 + (필수충족비율 × 70) + (우대충족비율 × 20)   // 0~100 클램핑
```

프로필이 비어 있으면 `10`점, 공고 역량이 비어 있으면 `0`점으로 떨어뜨려 **추정에 의한 과대평가**를 막는다(`MockFitAnalysisAiService.score`).

### 단계 2 — 신뢰도 산정 (`FitAnalysisConfidence.evaluate`)

점수와 **별개로** 입력 충실도를 본다. `100`에서 부족분만큼 감점한다.

| 입력 부족 | 감점 |
| --- | --- |
| 공고 요구 역량 비어 있음 | -40 |
| 프로필 기술 비어 있음 | -35 |
| 담당 업무 없음 | -10 |
| 보유 자격증 없음 | -8 |
| 희망 직무 없음 | -7 |

`>=80 HIGH / 50~79 MEDIUM / <50 LOW`. 이건 AI 판단이 아니라 결정적 계산이라 mock/실 AI 어느 쪽이든 똑같이 나온다. 화면은 "신뢰도 보통 · 72점"처럼 점수를 *얼마나 믿을지*를 따로 보여 준다.

### 단계 3 — 행 빌드 + INSERT (불변)

`FitAnalysisResult.builder()`로 16개 필드를 채워 `insertFitAnalysis(row)`. 여기서 두 가지가 중요하다.

1. **`source_snapshot` 동결** — `sourceSnapshot(source)`가 분석 시점의 `jobAnalysisId`/`jobPostingRevision`/`profileUpdatedAt`과 그때의 역량 목록을 JSON으로 박아 넣는다. 이후 공고나 프로필이 바뀌어도 *당시 기준*으로 재현·감사가 된다.
2. **`model`/`prompt_version`/`status` 기록** — 어느 모델·프롬프트 버전·성공 여부로 만든 결과인지 모든 행에 남긴다.

### 단계 4 — 파생 테이블 다중 저장

같은 트랜잭션 안에서 4개 테이블에 더 쓴다.

```text
insertHistory(...)        → fit_analysis_history (previous/new score + diff)
insertConditionMatch(...) → fit_analysis_condition_match (조건 1줄당 1행 + severity)
insertLearningTask(...)   → fit_analysis_learning_task (로드맵 항목당 1행)
insertAiUsageLog(...)     → ai_usage_log (status/model/token/credit)
```

severity는 규칙으로 파생한다: 필수(REQUIRED) + 미충족(UNMET)이면 `HIGH`, 미충족이지만 우대면 `MEDIUM`, 나머지는 `LOW`. 이렇게 정규화해 두면 관리자 통계(반복 부족 역량 집계)와 검색이 가능하다.

### 단계 5 — 알림 + 응답 재조회

`status == SUCCESS`면 `FIT_ANALYSIS_COMPLETE` 알림을 남기고, `getByApplicationCase(...)`로 방금 저장한 행을 **다시 읽어** 응답을 만든다. 이때 파생 필드가 계산된다.

| 응답 필드 | 어디서 파생되나 |
| --- | --- |
| `scoreBreakdown` | `condition_matrix`를 5카테고리(REQUIRED 45 / PREFERRED 25 / PROJECT 15 / EXPERIENCE 10 / PROFILE 5) 가중으로 재구성 |
| `actionBoard` | `strategy_actions` + 학습 과제의 completed 여부를 todo/진행/완료 칸반으로 |
| `adverseStrategies` | gap별 "숨기지 말고 학습 결과와 함께 설명" 코칭 |
| `next24HourActions` | 상위 액션 + HIGH 우선순위 gap 실습 |
| `toneStrategies` | 점수·gap 개수로 냉정형/격려형/실행형 3종 |

`scoreBreakdown`은 LLM이 준 게 아니라 **조건매트릭스에서 결정적으로 역산**한다. MET=1.0, PARTIAL=0.5, UNMET=0.0에 카테고리 가중을 곱해 막대를 채운다(자세히는 [점수 산출 규칙엔진](/area-c/score-engine)).

## 5. 구현 상태 (됨 vs 향후) — 정직 구분

:::tip 됨 (현재 동작)
- `generate()` 6단계 오케스트레이션, 5테이블 저장, 트랜잭션 묶음
- 규칙엔진 점수/판단/조건매트릭스/신뢰도 — 결정적, 테스트(`FitAnalysisServiceImplTest`, `MockFitAnalysisAiServiceTest`)로 검증
- 불변 INSERT + `source_snapshot` 동결 + `fit_analysis_history` diff
- 3단 폴백 **배선**(OSS/OpenAI/Mock 디스패치) + `guardApplyDecision` + grounding guard 코드
- 응답 파생(scoreBreakdown/actionBoard/toneStrategies) + 프론트 패널 3종 + 관리자 화면
- 현재 기본 경로는 규칙엔진(mock) 기준의 결정론적 데모. **화면·API 계약은 실 LLM과 동일**.
:::

:::warning 향후 (키/모델 발급 후 활성화)
- 자체 OSS 파인튜닝 모델의 **실제 학습·서빙** (통합 코드 `OssFitAnalysisAiService`/grounding guard/프롬프트 카탈로그는 이미 있음, 모델 가중치만 없음)
- OpenAI 키 연동 — 키 발급 시 `OpenAiFitAnalysisAiService`가 자동 활성(`configured()` 분기)
- 정직한 면접 표현: **"아키텍처·계약·폴백은 완성, 실 LLM 연동은 키 발급 후 토글"**
:::

핵심: 점수·판단·저장·히스토리·신뢰도·가드는 *지금* 동작하고, 바뀌는 건 설명 텍스트를 누가 쓰느냐(규칙 문장 → 자체모델/OpenAI)뿐이다. 그래서 화면이 깨지지 않는다.

## 6. 면접 답변 3단계

**초간단(10초):**
> "적합도 분석은 공고와 프로필을 비교해 점수·판단·학습계획을 한 번에 주는 C의 핵심 기능입니다. 점수와 지원 판단은 서버 규칙엔진이 확정하고, LLM은 설명만 붙입니다."

**기본(40초):**
> "`FitAnalysisServiceImpl.generate`가 6단계로 돕니다. 먼저 `findGenerationSource`로 A 프로필과 B 공고를 읽기 전용 조인해 입력을 만들고, 규칙엔진이 `10 + 필수×70 + 우대×20` 공식으로 점수를 확정합니다. 신뢰도는 입력 충실도로 따로 계산하고요. 그다음 `fit_analysis`에 불변 INSERT하면서 그 시점의 공고 revision·프로필을 `source_snapshot`으로 동결하고, 히스토리·조건매트릭스·학습과제·사용량로그까지 한 트랜잭션에 저장합니다. 마지막에 조건매트릭스를 5카테고리 가중으로 역산해 점수 막대를 만들어 응답합니다."

**꼬리질문 대응(필요 시):**
> "LLM은 점수를 못 바꿉니다. OSS 경로는 모델이 낸 점수 키를 화이트리스트로 무시하고, OpenAI 경로는 `0~100` 클램핑 후 `guardApplyDecision`으로 APPLY를 재검증합니다. 그래서 같은 입력은 항상 같은 점수가 나오고, 모델이 죽어도 Mock으로 폴백돼 화면은 안 깨집니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 재분석마다 UPDATE가 아니라 새 행을 INSERT하나요?
`fit_analysis`는 불변(append-only)입니다. 분석은 "그 시점의 판단"이고, 나중에 공고나 프로필이 바뀌어도 당시 근거가 남아야 감사·재현이 됩니다. 그래서 재분석은 새 행을 쌓고, `findLatestByUserIdAndApplicationCaseId`가 최신 행을 보여 줍니다. 직전 행과 비교해 `fit_analysis_history`에 점수 변화·gained/resolved/new gaps를 기록합니다.
:::

:::details Q2. `source_snapshot`은 정확히 무엇을 동결하나요? 왜 필요한가요?
분석 입력의 식별자와 시점입니다 — `jobAnalysisId`, `jobPostingId`, `jobPostingRevision`, `jobAnalysisCreatedAt`, `userProfileId`, `profileUpdatedAt`, 그리고 그때의 필수/우대 역량·프로필 기술·자격증 목록. 원본은 B·A가 소유하고 언제든 바뀌므로, "이 72점은 그때 어떤 입력으로 나왔나"를 나중에 증명하려면 스냅샷이 필요합니다. 책임(accountability)과 디버깅의 핵심입니다.
:::

:::details Q3. 응답의 `scoreBreakdown` 막대는 LLM이 채우나요?
아니요. `FitAnalysisServiceImpl.scoreBreakdown`이 `condition_matrix`를 읽어 결정적으로 역산합니다. REQUIRED max 45 / PREFERRED 25 / PROJECT 15 / EXPERIENCE 10 / PROFILE 5 가중에 MET=1.0·PARTIAL=0.5·UNMET=0.0을 곱하고, 총점과 안 맞으면 잔여를 우선순위대로 재배분해 막대 합이 `fitScore`와 일치하게 맞춥니다. 그래서 "왜 72점인지"가 막대로 설명됩니다.
:::

:::details Q4. 트랜잭션 도중 일부 저장이 실패하면요?
`generate`는 `@Transactional`이라 `fit_analysis` INSERT부터 히스토리·조건매트릭스·학습과제·사용량로그·알림까지 한 묶음으로 커밋됩니다. 중간에 예외가 나면 전부 롤백돼 반쪽짜리 분석이 남지 않습니다. AI 단계 자체의 실패는 다른 층위입니다 — 그건 폴백 체인이 처리해 `status`를 FALLBACK/FAILED로 남기고, FAILED여도 행은 일관되게 저장됩니다.
:::

:::details Q5. 첫 분석은 왜 변화 항목(gained/resolved)이 비어 있나요?
비교 대상(직전 분석)이 없기 때문입니다. 첫 분석에서 전체 매칭 역량을 "새로 얻은 역량"으로 잡으면 전부 변화로 잡혀 노이즈가 됩니다. 그래서 `previous == null`이면 diff를 명시적으로 빈 리스트로 둡니다. 두 번째 분석부터 대소문자 무시 차집합으로 gained/resolved/added를 계산합니다.
:::

:::details Q6. credit(크레딧)은 언제 차감되나요? mock인데 토큰은요?
`status == SUCCESS`일 때만 크레딧 2를 차감하고, FALLBACK/FAILED는 0입니다. mock 성공일 때는 실제 토큰이 없으므로 `estimateTokens`로 입력 크기 기반 추정치를 `ai_usage_log`에 남겨 통계 흐름을 유지합니다. 실 LLM이면 응답의 실제 토큰을 그대로 기록합니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이 `generate()` 6단계를 순서대로 말해 보세요(입력 조립 → 규칙엔진 → 신뢰도 → 불변 INSERT+스냅샷 → 파생 4테이블 → 파생 응답).
2. "LLM이 80점이라고 했는데 필수가 미충족이면?"이라는 질문에, OSS 화이트리스트와 OpenAI `guardApplyDecision`을 각각 들어 30초로 답해 보세요.
3. `source_snapshot`이 없다고 가정하고, 어떤 버그·감사 실패가 생길지 한 가지 시나리오로 설명해 보세요.

## 퀴즈

<QuizBox question="FitAnalysisServiceImpl.generate가 재분석 시 기존 fit_analysis 행을 처리하는 방식은?" :choices="['기존 행을 UPDATE한다', '기존 행을 지우고 새로 만든다', '새 행을 INSERT하고 직전 행과 비교해 history를 남긴다', '최신 1건만 남기고 나머지는 삭제한다']" :answer="2" explanation="fit_analysis는 불변(append-only)입니다. 재분석마다 새 행을 INSERT하고, 직전 행과 비교해 fit_analysis_history에 점수 변화와 gained/resolved/new gaps를 기록합니다. 그래야 당시 근거가 보존돼 감사·재현이 됩니다." />

<QuizBox question="응답의 scoreBreakdown(점수 막대)는 어디서 만들어지나요?" :choices="['LLM이 직접 생성한 값을 그대로 쓴다', '프론트엔드가 임의 비율로 그린다', 'condition_matrix를 5카테고리 가중으로 서버가 결정적으로 역산한다', 'fit_analysis_history에서 가져온다']" :answer="2" explanation="FitAnalysisServiceImpl.scoreBreakdown이 condition_matrix를 REQUIRED45/PREFERRED25/PROJECT15/EXPERIENCE10/PROFILE5 가중과 MET=1.0·PARTIAL=0.5·UNMET=0.0으로 역산합니다. 막대 합이 fitScore와 일치하도록 잔여를 재배분합니다." />

<QuizBox question="source_snapshot이 동결하는 것과 그 목적을 설명해 보세요." explanation="분석 시점의 입력 식별자·시점(jobAnalysisId, jobPostingRevision, profileUpdatedAt 등)과 그때의 역량·자격증 목록을 JSON으로 박아 둡니다. 원본 공고·프로필은 B·A가 소유해 언제든 바뀌므로, '이 점수가 그때 어떤 입력으로 나왔는지'를 나중에 재현·감사하기 위함입니다. 책임(accountability)과 디버깅의 근거가 됩니다." />

# 장기 취업경향 분석

> 단일 공고의 적합도는 "이 한 건"을 답하지만, 장기 경향은 여러 지원 건을 가로질러 "나는 지금 어디로 가고 있나"를 답한다. 핵심은 **결정적 집계 25종이 진실을 만들고, AI는 그 집계를 2~3문장으로 통역만 한다**는 것이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

장기 취업경향 분석은 한 사용자의 **모든 지원 건 분석 이력을 누적 집계**해서, 반복되는 부족 역량 · 직무 선택 패턴 · 적합도 추세를 한 화면(`/analysis`, 5탭)으로 보여주고, 그 위에서 AI가 `trendSummary`(경향 요약)와 `recommendedDirections`(다음 지원 방향)를 생성하는 기능이다. 영역 C의 AI 기능 #16(장기 취업경향) · #17(다음 지원 방향)에 해당한다.

이 페이지가 답하는 면접 질문:

- "단일 공고 적합도 분석이 이미 있는데, 왜 굳이 장기 경향 분석을 따로 만들었나?"
- "AI에 넘기는 입력을 어떻게 설계했고, 그게 캐시·비용과 어떻게 연결되나?"
- "다른 사람(D 영역)이 소유한 면접 데이터를 어떻게 안전하게 가져다 쓰나?"

:::tip 한 문장 요약
"적합도 분석은 점(point), 장기 경향은 선(line)이다. 점을 모아 추세를 만들고, 그 추세를 결정적으로 계산한 다음, AI는 그 결과를 사람 말로 요약만 한다."
:::

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 왜 누적 분석이 단일 공고보다 가치 있나

단일 적합도 분석은 "이 공고에 지원해도 되나"까지만 답한다. 하지만 구직자가 진짜 알아야 하는 건 그 위의 메타 질문이다.

| 단일 공고 적합도 ([적합도 분석](/area-c/fit-analysis)) | 장기 취업경향 (이 페이지) |
| --- | --- |
| "이 공고, 지원 가능?" | "내가 **반복적으로** 막히는 역량은?" |
| 한 건의 `fitScore` | 여러 건의 평균 · 추세 · 분포 |
| 지금 이 순간 | 시간순 점수 변화, 월별 흐름 |
| 공고 하나의 부족 역량 | 분석 N건 중 몇 건에서 같은 역량이 부족한지 |

예를 들어 한 공고에서 "Kubernetes 부족"이 떴다면 그냥 그 공고가 까다로운 것일 수 있다. 그러나 **최근 분석 8건 중 6건(75%)에서 Kubernetes가 부족**으로 잡히면, 그건 우연이 아니라 **학습 우선순위 1순위 신호**다. 단일 분석에서는 절대 볼 수 없는 정보이고, 이게 장기 경향이 존재하는 이유다.

### 핵심 트레이드오프: AI는 어디까지 일하나

영역 C 공통 철학(뉴로-심볼릭)을 그대로 따른다. **수치 · 패턴 · 순위는 전부 결정적 규칙엔진이 계산하고, AI는 그 결과를 자연어로 요약만 한다.**

- 대안 A — AI가 원본 데이터를 다 받아 알아서 추세까지 계산: 거부. 매 조회마다 결과가 흔들리고(consistency 붕괴), 토큰 비용이 폭증하며, "75%"같은 수치를 AI가 환각할 위험이 있다.
- 대안 B(채택) — 결정적 집계 25종을 먼저 계산하고, 그중 **핵심 6개만** AI 입력으로 넘긴다. 수치는 코드가 보증하고 AI는 문장만 만든다.

이 분리가 만드는 이득은 [뉴로-심볼릭 설계](/area-c/neuro-symbolic) 페이지와 동일하다: 신뢰(credibility), 재현성(consistency), 비용(cost), 가용성(reliability).

### 왜 입력을 6개로 좁혔나 (캐시 안정성)

`AnalysisServiceImpl.buildSummary()`는 25종을 모두 계산하지만, AI에는 `CareerTrendAiCommand`로 **6개 필드만** 넘긴다. 이건 [캐시 지문(fingerprint)](/area-c/caching-fingerprint) 설계와 직결된다 — 부가 집계(예: 주간 변화, 기업 유형별 적합도)가 흔들려도 6개 핵심 입력이 그대로면 fingerprint가 안 깨지고, 저장된 AI 요약을 그대로 재사용해 토큰을 아낀다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블)

데이터 흐름의 4계층을 실제 이름으로 짚으면:

| 계층 | 실제 타입/메서드 | 역할 |
| --- | --- | --- |
| Controller | `AnalysisController` (`GET /api/analysis/summary`, `POST /api/analysis/summary/refresh`) | 조회 / 명시적 재생성 |
| Service | `AnalysisServiceImpl.buildSummary(userId, forceRefresh)` | 25종 결정적 집계 + 캐시 코디네이션 |
| AI 진입점 | `CareerTrendAiService` 인터페이스 → `MockCareerTrendAiService`(현재 활성) / `OpenAiCareerTrendAiService`(`@Primary`, 키 주입 시) | 6개 입력 → `{trendSummary, recommendedDirections}` |
| 캐시 | `CareerAnalysisRunService.findFreshRun()` / `record()` | read-through 캐시 + 실행 이력 + 사용량 로그 |
| Mapper | `AnalysisMapper` + `mapper/analysis/AnalysisMapper.xml` | 집계용 read-only 조회 |

AI 입력/출력 계약:

```text
입력  CareerTrendAiCommand(
        stats,           // AnalysisStatResponse  (전체/분석/평균/70점이상/준비완료)
        skillGaps,       // List<SkillGapResponse> (반복 부족 역량 상위 8)
        jobReadiness,    // List<JobReadinessResponse> (직무별 평균 적합도)
        scoreHistory,    // List<AnalysisScorePointResponse> (시간순 점수)
        interviewTrend,  // InterviewTrendResponse (누적 면접 통계 — D 읽기전용)
        bestStrategy)    // String (적합도 최고 건의 전략 텍스트)

출력  CareerTrendAiResult(
        trendSummary,           // 2~3문장 경향 요약
        recommendedDirections,  // 3~5개 다음 방향
        usage, status, errorMessage, retryable)
```

프롬프트는 코드와 분리해 `CareerTrendPromptCatalog`(`VERSION="v0.2"`, `SYSTEM_PROMPT`, `userPrompt()`)에 카탈로그로 둔다. 실행 이력에는 항상 `model` · `promptVersion` · `status`가 기록되어 "어떤 버전 프롬프트로 만든 결과인지" 추적된다.

:::warning 면접 정직 포인트
현재 활성 구현은 `MockCareerTrendAiService`다. 이건 가짜 화면용 더미가 아니라, **집계만으로 결정적 요약/추천을 만드는 규칙엔진**이다. 화면 · API 계약 · 캐시 흐름은 실 LLM과 100% 동일하고, OpenAI 키가 주입되면 `OpenAiCareerTrendAiService`가 `@Primary`로 잡혀 같은 인터페이스로 교체된다. "아키텍처는 완성, 실 LLM 연동은 키 발급 후 활성화"가 정확한 표현이다.
:::

## 4. 동작 원리 (데이터 흐름 · 25종 집계 · 캐시)

### 4-1. 전체 흐름

```text
GET /api/analysis/summary
  └ AnalysisServiceImpl.buildSummary(userId, forceRefresh=false)
      1) AnalysisMapper.findSourcesByUserId  → 지원 건 + 최신 적합도 + 면접 통계(read-only)
         findFitScoreHistoryByUserId         → 재분석 포함 전체 점수 이력
         findAnswerSourcesByUserId           → 면접 답변(질문유형/점수/피드백, D 읽기전용)
      2) 결정적 집계 25종 계산 (stats, skillGaps, jobReadiness, scoreHistory ... threeLineSummary)
      3) CareerTrendAiCommand(6개) 조립 → fingerprint = SHA-256(canonical JSON)
      4) forceRefresh=false 면:
           findFreshRun(userId, "CAREER_TREND", fingerprint)
             ├ 같은 fingerprint의 최신 성공 실행 있음 → 저장된 trend 재사용 (AI 미실행, 무료)
             └ 없음(데이터 변경/최초)           → careerTrendAiService.generate() 1회 실행
         forceRefresh=true(재분석 버튼):
             항상 generate() 실행 + creditUsed=1 차감
      5) AnalysisSummaryResponse 반환 (25종 + AI trend + run 메타)
```

### 4-2. 결정적 집계 25종 (대표 묶음)

`buildSummary()` 안에서 한 번에 계산되는 25종을 성격별로 묶으면:

| 묶음 | 대표 메서드 | 무엇을 답하나 |
| --- | --- | --- |
| 핵심 통계 | `stats`, `period`, `weeklyChange` | 평균 적합도, 분석 기간, 지난주 대비 변화 |
| 반복 역량 | `skillGaps`, `strengthTrends`, `skillFitAverages`, `avoidJobTypes` | 자주 부족/강한 역량, 기술별 평균 적합도 |
| 직무 패턴 | `jobReadiness`, `jobDistribution`, `applicationTiers`, `companyTypeFits` | 직무별 준비도, 지원 쏠림, 안전/적정/상향 분류 |
| 추세 | `scoreHistory`, `monthlyFitTrend` | 시간순 · 월별 적합도 흐름 |
| 면접 연계(D) | `interviewTrend`, `answerThemes`, `fitInterviewBands`, `correctionCorrelation` | 누적 면접 통계, 답변 공통 약점, 적합도-면접 상관 |
| 행동 제안 | `applicationPriorities`, `careerRisks`, `next24HourActions`, `toneStrategies`, `threeLineSummary` | 지원 순서, 리스크, 24시간 액션, 톤 전략 |

이 중 핵심 6개(`stats`/`skillGaps`/`jobReadiness`/`scoreHistory`/`interviewTrend`/`bestStrategy`)만 AI 입력이 되고, 나머지 19종은 화면이 직접 그린다.

집계 로직은 전부 순수 함수다. 예를 들어 반복 부족 역량은 단순한 카운트·정렬이다.

```java
// skillGaps(): 분석된 건들의 missing_skills를 모아 빈도순 상위 8개
for (AnalysisSource s : analyzed)
    for (String skill : parseList(s.getMissingSkills()))
        counts.merge(skill, 1, Integer::sum);
// → SkillGapResponse(skill, count, total, percentage)  // percentage = count/total
```

`careerRisks()`도 "분석 커버리지 60% 미만" · "같은 부족 역량이 50% 이상 반복" · "직무 4개 이상 분산" · "면접 기록 0" 같은 **명시적 임계값 규칙**이라, 같은 데이터면 항상 같은 경고가 나온다.

### 4-3. interview_*(D 영역)는 읽기 전용 입력

장기 경향은 면접 데이터까지 섞어야 의미가 커진다(적합도는 높은데 면접 연습이 0이면 경고). 면접 테이블(`interview_session` · `interview_question` · `interview_answer`)은 **D 영역 소유**라, C는 절대 쓰지 않고 **읽기 전용으로만 조회**한다.

```sql
-- AnalysisMapper.xml: 면접 답변 공통 약점 집계 (D 테이블 read-only)
SELECT iq.question_type, ia.score, ia.feedback
FROM interview_answer ia
  JOIN interview_question iq ON iq.id = ia.question_id
  JOIN interview_session  s ON s.id  = iq.interview_session_id
  JOIN application_case   ac ON ac.id = s.application_case_id
WHERE ac.user_id = #{userId} AND ia.score IS NOT NULL
ORDER BY ia.score ASC   -- 첫 행이 최저점 → 대표 개선 포인트
```

`findSourcesByUserId`의 면접 카운트/평균도 전부 상관 서브쿼리로 읽기만 한다. 이게 [작업 범위 규칙](/area-c/data-model)에서 말하는 "타인 소유 테이블은 읽기 전용 참조"의 실제 적용이다.

## 5. 구현 상태 (됨 vs 향후)

| 구현됨 | 향후 과제 |
| --- | --- |
| 결정적 집계 25종(`AnalysisServiceImpl`) | 실제 OpenAI 키 연동(`OpenAiCareerTrendAiService` 활성화) |
| `CareerTrendAiCommand` 6개 입력 조립 | 자체 OSS 파인튜닝 모델의 실 서빙(현재는 Mock 규칙엔진) |
| read-through 캐시(`CareerAnalysisRunService` + `input_fingerprint`) | 추세 예측(다음 달 적합도 전망 등) |
| 명시적 재생성 크레딧 차감(`creditUsed`) | 동종 사용자 대비 벤치마크 |
| 실행 이력 / 사용량 로그(`ai_usage_log`) 기록 | |
| 5탭 `AnalysisPage` 프론트 + AI 리포트 배너 | |
| interview_*(D) 읽기 전용 입력 | |

핵심: **데이터 흐름 · 집계 · 캐시 · 폴백 배선 · 화면은 전부 동작한다.** 현재는 `MockCareerTrendAiService`가 결정적으로 요약을 만들어 데모가 재현 가능하다. 바뀌는 건 "문장을 누가 쓰느냐"(Mock 규칙엔진 → 실 LLM)뿐, 계약은 그대로다.

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단 (15초)**
"여러 지원 건의 분석 이력을 누적 집계해서 반복 부족 역량·직무 패턴·적합도 추세를 보여줍니다. 수치는 규칙엔진이 다 계산하고, AI는 그 결과를 요약 문장으로만 만듭니다."

**기본 (45초)**
"`AnalysisServiceImpl`이 한 사용자의 모든 적합도 분석을 모아 25종의 결정적 집계를 계산합니다. 그중 핵심 6개만 `CareerTrendAiCommand`로 AI에 넘겨서 `trendSummary`와 `recommendedDirections`를 받습니다. AI 호출은 비싸니까 입력을 SHA-256으로 지문 떠서 read-through 캐시를 두고, 같은 입력이면 저장된 요약을 재사용합니다. 명시적 재분석만 크레딧을 차감하고요. 면접 데이터는 D 영역 소유라 읽기 전용으로만 가져옵니다."

**꼬리질문 대응 (핵심 방어선)**
"왜 입력을 6개로 줄였냐고 물으면 — 부가 집계가 흔들려도 캐시 지문이 안 깨지게 하기 위해서다, 라고 답합니다. 즉 입력 최소화가 곧 캐시 적중률이자 비용 절감입니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 단일 적합도 분석이 있는데 왜 장기 경향이 또 필요한가?**
단일 분석은 "이 공고"만 답합니다. 한 공고에서 부족이 뜨면 그 공고가 까다로운 건지, 내 구조적 약점인지 알 수 없습니다. 장기 경향은 "분석 8건 중 6건에서 같은 역량 부족"처럼 **반복성**을 정량화해, 학습 우선순위라는 단일 분석엔 없는 정보를 만듭니다.

**Q2. 그 추세 수치를 왜 AI가 안 만들고 코드가 만드나?**
재현성과 신뢰 때문입니다. "75%" 같은 수치를 LLM이 만들면 매 호출마다 흔들리고 환각할 수 있습니다. 수치는 코드가 보증해야 책임(accountability)이 서고, AI는 그 보증된 수치를 사람이 읽을 문장으로 통역하는 역할만 맡습니다.

**Q3. AI 입력을 25종 다 안 주고 6개만 준 이유는?**
캐시 안정성입니다. fingerprint가 6개 핵심 입력만으로 계산되니, 주간 변화·기업 유형별 적합도 같은 부가 집계가 매일 흔들려도 지문이 안 깨집니다. 그래서 저장된 AI 요약을 그대로 재사용해 토큰을 아낍니다. 입력 최소화 = 캐시 적중률입니다.

**Q4. 매번 조회할 때마다 AI를 부르면 비싸지 않나?**
안 부릅니다. `findFreshRun`이 같은 fingerprint의 최신 성공 실행을 찾으면 저장된 결과를 반환하고 AI를 건너뜁니다. 데이터가 바뀌어 지문이 달라지거나 사용자가 명시적으로 재분석을 누를 때만 실행하고, 후자만 크레딧 1을 차감합니다. 실패(`FAILED`)는 캐시하지 않아 다음 조회에서 다시 시도합니다.

**Q5. 면접 데이터는 D 영역 소유인데 어떻게 쓰나?**
읽기 전용으로만 조회합니다. `interview_session`/`question`/`answer`를 `AnalysisMapper.xml`의 SELECT로만 읽고, INSERT/UPDATE는 일절 안 합니다. 적합도가 높은데 면접 기록이 0이면 "면접 연습 없음" 리스크 경고를 띄우는 식으로, 두 영역 데이터를 교차해 가치를 만듭니다.

**Q6. 결과가 결정적이라는 걸 어떻게 보장하나?**
집계가 전부 순수 함수입니다. 같은 입력 데이터면 같은 `skillGaps`/`careerRisks`가 나오도록 카운트·정렬·임계값 규칙으로만 짰습니다. 실행 이력에 `model`·`promptVersion`·`status`를 같이 남겨 "어떤 버전으로 만든 결과인지"도 추적됩니다.

## 8. 직접 말해보기

아래 질문에 막힘없이 답할 수 있으면 이 페이지는 통과한 것이다.

1. 단일 적합도와 장기 경향의 차이를 "점과 선" 비유로 30초 안에 설명해 보라.
2. `AnalysisServiceImpl`에서 25종을 다 계산하는데, AI에는 왜 6개만 넘기는지 캐시와 연결해 설명하라.
3. `findFreshRun`이 캐시 미스를 판정하는 조건 3가지(없음/FAILED/지문 불일치)를 말해 보라.
4. 면접 테이블이 D 소유인데 C가 쓰는 방식과, 그게 작업 범위 규칙과 어떻게 맞는지 설명하라.
5. "추세 수치를 AI가 만들면 안 되는 이유"를 신뢰·재현성·비용 관점에서 각각 한 문장씩 말해 보라.

## 퀴즈

<QuizBox question="장기 취업경향 분석에서 AI(CareerTrendAiService)가 맡는 역할로 가장 정확한 것은?" :choices="['적합도 점수와 반복 부족 역량 비율을 직접 계산한다', '결정적으로 집계된 핵심 6개 입력을 받아 요약 문장과 다음 방향만 생성한다', '면접 세션 데이터를 직접 수정해 점수를 보정한다', '25종 집계를 매 조회마다 새로 만든다']" :answer="1" explanation="수치·패턴·순위는 AnalysisServiceImpl의 결정적 집계가 소유하고, AI는 CareerTrendAiCommand(6개)를 받아 trendSummary와 recommendedDirections만 생성한다. 뉴로-심볼릭 분리의 핵심이다." />

<QuizBox question="AnalysisServiceImpl이 25종을 모두 계산하면서도 CareerTrendAiCommand에는 6개 필드만 넣는 주된 이유는?" :choices="['AI 토큰 한도를 넘기지 않으려고', '부가 집계가 흔들려도 캐시 fingerprint가 깨지지 않게 하려고', '6개가 화면에 표시되는 전부라서', 'OpenAI 스키마가 6개만 허용해서']" :answer="1" explanation="fingerprint는 6개 핵심 입력의 canonical JSON을 SHA-256으로 떠서 만든다. 주간 변화 등 부가 집계가 매일 바뀌어도 핵심 6개가 그대로면 지문이 유지되어 저장된 AI 요약을 재사용할 수 있다." />

<QuizBox question="면접 관련 테이블(interview_session/question/answer)을 장기 경향 분석에서 다루는 방식으로 옳은 것은?" :choices="['C가 소유하므로 자유롭게 INSERT/UPDATE한다', 'D 영역 소유라 AnalysisMapper에서 읽기 전용 SELECT로만 조회한다', '실시간으로 D의 API를 호출해 가져온다', '분석할 때마다 복제본 테이블로 복사한다']" :answer="1" explanation="interview_* 테이블은 D 영역 소유다. C는 AnalysisMapper.xml의 SELECT(상관 서브쿼리/JOIN)로만 읽고 쓰지 않는다. 적합도-면접 상관, 면접 없음 리스크 등 교차 신호를 읽기 전용으로 만든다." />

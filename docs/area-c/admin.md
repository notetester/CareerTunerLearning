# C 관리자 화면 & 운영

> 사용자 기능을 "완료"라고 부르려면 운영자가 그 결과를 감시·교정할 수 있어야 한다. 영역 C의 관리자 화면은 적합도/장기/대시보드 분석을 **AI를 다시 부르지 않고** 결정적으로 점검·기록하는 운영 레이어다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 C 관리자 화면 = "분석이 실패했거나 이상하게 나온 건을 운영자가 **찾아내고(큐)**, **들여다보고(상세)**, **기록을 남기는(운영 메모/품질 플래그)** 운영 콘솔". 사용자 측 결과는 그대로 두고, 사람이 개입할 지점만 표면화한다.

이 페이지로 답할 수 있어야 하는 면접 질문:

- "사용자 기능만 만들면 되지, 관리자 화면은 왜 같이 만들었나요?"
- "AI 결과가 이상하게 나오면 운영자가 어떻게 알 수 있나요? 어떻게 대응하나요?"
- "프롬프트를 관리자가 직접 수정하게 하지 않은 이유는?"
- "품질 검수를 LLM으로 다시 채점하지 않고 어떻게 했나요?"
- "운영 메모랑 품질 플래그는 뭐가 다른가요?"

:::tip 한 문장 요약
**관리자 화면의 모든 점검은 "저장된 분석 결과 + 결정적 규칙"으로만 한다. AI를 다시 호출하지 않는다.** 이게 비용·재현성·책임 측면에서 [뉴로-심볼릭 철학](/area-c/neuro-symbolic)을 운영 레이어까지 일관되게 끌고 간 결과다.
:::

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 2.1 "사용자 기능 완료 = 관리자도 포함" 원칙

팀 규칙(AGENTS.md)에 "사용자 기능을 완료할 때 관련 관리자 화면과 관리자 API도 같은 릴리스의 완료 기준에 포함한다"가 명시돼 있다. 이건 단순한 행정 규칙이 아니라 **AI 기능의 운영 리스크** 때문이다.

C가 만드는 7개 AI 기능은 전부 사용자에게 점수·판단·추천을 노출한다. 그런데:

- 적합도 분석은 불변 테이블(`fit_analysis`)에 INSERT만 한다 → 한 번 잘못 나간 결과를 운영자가 추적할 방법이 없으면 안 된다.
- 3단 폴백([폴백 체인](/area-c/fallback-chain)) 때문에 `FALLBACK`/`FAILED` 상태 결과가 사용자에게 노출될 수 있다 → 누가 이걸 보고 재분석을 유도하나?
- 자격증 과도 추천, "합격 보장" 같은 표현은 LLM 환각의 전형 → 사람이 표본을 봐야 한다.

따라서 관리자 화면은 "있으면 좋은 것"이 아니라 **AI 결과를 책임지기 위한 필수 구성요소**다.

### 2.2 핵심 결정: 관리자 화면도 AI를 다시 부르지 않는다

가장 중요한 설계 트레이드오프다.

| 대안 | 장점 | 왜 안 썼나 |
| --- | --- | --- |
| 관리자 검수 시 LLM으로 재채점 | "AI가 AI를 감시" 그럴듯함 | 비용 발생, 재현 불가(같은 건 매번 다른 결과), 검수 자체가 또 환각 위험 |
| **저장된 결과 + 결정적 규칙(채택)** | 0원, 100% 재현, 감사 가능 | 휴리스틱이 잡는 패턴만 검출 |
| 운영자 수동 전수 확인 | 정확 | 분석 건수 늘면 불가능, 놓침 |

C는 **결정적 규칙**을 택했다. 품질 검수 큐(`listQualityFlags()`)는 이미 저장된 `fit_analysis` 행을 읽어, "점수 85↑인데 부족역량 5개↑", "APPLY인데 필수조건 UNMET 존재" 같은 **모순 패턴**을 규칙으로 잡는다. AI 호출 0회.

### 2.3 프롬프트는 "읽기 전용 카탈로그"로

관리자 프롬프트 운영 화면(`/admin/prompts/fit-analysis`)은 **편집 기능이 없다.** 의도적이다.

- AGENTS.md상 AI 프롬프트 공통 엔진은 **팀장 소유**. 운영자가 화면에서 즉석 수정하면 가드레일·스키마 계약이 깨질 수 있다.
- 대신 운영자에게 필요한 건 "이 프롬프트가 뭘 하고, 어떤 위험을 막도록 설계됐나"를 **확인**하는 것. 그래서 목적·입력·출력·품질체크·위험노트를 카드로 보여만 준다.
- 실제 프롬프트 변경은 코드 PR로 처리 → 버전·리뷰 추적 가능.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블 근거)

4계층(controller → service → mapper → DB)에 운영 전용 패키지 `admin.*`를 두고, 사용자용 도메인 테이블을 **읽기 전용으로 재조회**한다.

| 화면 | 컨트롤러 | 핵심 서비스 메서드 | 주요 테이블 |
| --- | --- | --- | --- |
| 관리자 홈 처리대기 큐 | `AdminHomeController` (`/api/admin/home/summary`) | `AdminHomeService.getSummary()` | `AdminHomeMapper` 6개 COUNT 쿼리 |
| 분석 통계 | `AdminAnalyticsController` (`/api/admin/analytics/summary`) | `AdminAnalyticsServiceImpl.getSummary()` | `fit_analysis` 집계 |
| 분석 실패 큐 | 〃 `/failures` | `listFailures()` | `ai_usage_log` |
| 품질 검수 큐 | 〃 `/quality-flags` | `listQualityFlags()` / `resolveQualityFlag()` | `analysis_quality_flag` |
| 적합도 관리 | `AdminFitAnalysisController` (`/api/admin/fit-analyses`) | `AdminFitAnalysisServiceImpl.list()/get()` + 메모 CRUD | `fit_analysis`, `admin_fit_analysis_memo` |
| 장기/대시보드 실행 메모 | `AdminAnalyticsController` `/runs/{runId}/memos` | `createMemo()/updateMemo()/deleteMemo()` | `career_analysis_run`, `admin_career_run_memo` |
| 프롬프트 운영 | `AdminFitAnalysisPromptController` (`/api/admin/prompts/fit-analysis`) | `AdminFitAnalysisPromptServiceImpl.list()` | (코드 상수 `TEMPLATES`) |

권한은 모든 엔드포인트가 `AdminAccess.requireAdmin(authUser)` 한 줄로 게이트한다.

:::details 운영 메모 두 종류 (대칭 설계)
적합도와 장기/대시보드 분석은 저장 단위가 다르다(전자=`fit_analysis`, 후자=`career_analysis_run`). 그래서 운영 메모 테이블도 **두 개를 같은 패턴으로** 만들었다.

- `admin_fit_analysis_memo` (FK → `fit_analysis`)
- `admin_career_run_memo` (FK → `career_analysis_run`)

둘 다 `memo_type` `VARCHAR(30)` (`GENERAL`/`QUALITY`/`USER_INQUIRY`/`REANALYSIS` 등) + `content` + `admin_user_id` + 타임스탬프. 서비스 로직(`normalizeMemoType` → 대문자화, `ensure...Exists` 가드)도 거울처럼 동일하다. 패턴을 통일해 운영자가 "어느 화면이든 메모는 똑같이 단다"고 느끼게 했다.
:::

## 4. 동작 원리 (데이터 흐름 · 단계 · 표 / 작은 코드)

### 4.1 관리자 홈 처리대기 큐 — 6개 결정적 COUNT

`AdminHomeMapper.xml`은 운영자가 "지금 처리할 것"만 숫자로 집계한다. 각 카운트의 **소스와 의미**:

| 큐 항목 | 쿼리 근거 | 의미 |
| --- | --- | --- |
| 적합도 분석 실패 | `ai_usage_log WHERE feature_type='FIT_ANALYSIS' AND status='FAILED'` | AI 호출 자체가 실패한 로그 |
| 미분석 지원 건 | `application_case`에 대응 `fit_analysis`가 `NOT EXISTS` | 아직 적합도 미실행 |
| 강등 결과 노출 | 지원 건별 `MAX(id)` 최신 분석의 `status != 'SUCCESS'` | FALLBACK/FAILED가 사용자에게 노출 중 |
| 재분석 요청 | `COUNT(DISTINCT fit_analysis_id)` of `admin_fit_analysis_memo WHERE memo_type='REANALYSIS'` | 운영자가 "재분석 필요" 메모를 단 건 |
| 장기 분석 실패 | `career_analysis_run WHERE status != 'SUCCESS'` | 장기/대시보드 실행 실패 |
| 최근 7일 신규 | `fit_analysis WHERE created_at >= CURRENT_DATE - INTERVAL 7 DAY` | 최근 생성량(맥락용) |

"강등 결과 노출" 쿼리가 핵심이다. `fit_analysis`는 재분석마다 INSERT라 한 지원 건에 여러 행이 쌓인다. **지원 건별 최신 행만** 보고 그게 비정상이면 카운트한다 — 옛날 실패가 이미 성공으로 덮였으면 큐에 안 잡힌다.

### 4.2 품질 검수 큐 — 모순 패턴 8종

`listQualityFlags()`는 최신 분석 목록을 돌며 결정적 휴리스틱을 적용한다. AI 재호출 없이 JSON 컬럼만 파싱한다.

| flag_type | severity | 조건 | 막으려는 것 |
| --- | --- | --- | --- |
| `SCORE_GAP_MISMATCH` | HIGH | 점수≥85 AND 부족역량≥5 | 점수 근거 모순 |
| `LOW_SCORE_NO_GAPS` | MEDIUM | 점수&lt;40 AND 부족역량=0 | 입력 누락 의심 |
| `EXCESSIVE_CERTS` | MEDIUM | 자격증 추천 >3 | 자격증 과도 추천 |
| `EMPTY_STRATEGY` | LOW | SUCCESS인데 전략 비어있음 | 빈 결과 노출 |
| `LOW_CONFIDENCE` | MEDIUM | `analysis_confidence.level == LOW` | 신뢰도 낮은 결과 |
| `REQUIRED_GAP_APPLY` | HIGH | `apply_decision==APPLY` AND 필수 UNMET 존재 | 가드레일 누수 |
| `EMPTY_CONDITION_MATRIX` | LOW | SUCCESS인데 매트릭스 비어있음 | 근거 결손 |
| `DEGRADED_RESULT` | HIGH | status != SUCCESS | 비정상 결과 노출 |

흐름은 "계산 → upsert → 미해결만 반환"이다.

```text
findLatestAnalyses()                # 최신 분석들 읽기 (AI 호출 X)
  └ for each: 8개 규칙 평가 → flag 생성
upsertQualityFlag(...)              # analysis_quality_flag 테이블에 멱등 기록
                                    #   UNIQUE(target_type,target_id,flag_type)
filter(!isQualityFlagResolved(...)) # resolved=1 처리된 건 큐에서 제외
```

`REQUIRED_GAP_APPLY`가 특히 중요하다. 이건 [가드레일 `guardApplyDecision`](/area-c/guardrails)이 정상 동작했으면 절대 안 나와야 하는 패턴이다. 즉 품질 검수 큐는 **가드레일의 사후 감사 장치** 역할도 한다.

:::warning 품질 플래그는 사용자 원본을 수정하지 않는다
`listQualityFlags()` 주석에 명시: "사용자 원본은 수정하지 않으며, 조치는 적합도 운영 메모(REANALYSIS/QUALITY)로 남긴다." 검수는 **읽기 + 별도 플래그 테이블 기록**이지, 분석 결과를 덮어쓰는 게 아니다. 운영자가 본 뒤 `resolveQualityFlag()`로 해당 플래그만 `resolved=1` 처리하거나, 운영 메모로 후속 조치를 남긴다.
:::

### 4.3 적합도 관리 — 필터 + 상세 + 운영 메모

`AdminFitAnalysis.tsx`는 좌측 목록 / 우측 상세 2단 레이아웃이다.

- **필터(클라이언트)**: 검색어 + 점수 구간(80↑/70-79/50-69/50미만) + 상태(성공/실패·Fallback) + "메모 있는 항목만" + "재분석 필요만". 서버 재호출 없이 즉시 필터링.
- **상세**: `get(id)`가 매칭/부족 역량, 추천 학습/자격증, 점수 근거, 전략, 그리고 `source_snapshot`·`condition_matrix`·`analysis_confidence`·`apply_decision` 같은 **구조화 JSON 원본**과 학습 체크리스트, model/promptVersion/status까지 다 펼친다. 운영자가 "왜 이 점수가 나왔는지"를 [설명가능성 컬럼](/area-c/structured-output)으로 추적.
- **운영 메모 CRUD**: `memo_type` 8종(일반/품질 확인/문의 대응/재분석 필요/프롬프트 이슈/데이터 이슈/점수 이의/자격증 추천 이슈). `REANALYSIS` 타입을 달면 그 즉시 홈 큐의 "재분석 요청" 카운트에 반영된다(§4.1 쿼리). 화면 간 루프가 닫힌다.

### 4.4 프롬프트 운영 — 읽기 전용 카드

`AdminFitAnalysisPromptServiceImpl`의 `TEMPLATES` 상수 3종을 카드로 노출한다.

| key | 목적 | 대표 위험 노트(riskNotes) |
| --- | --- | --- |
| `FIT_SCORE_COMPARISON` | 적합도 점수 산정 | 경력 과장 금지 / 학력·나이·성별을 점수에 반영 금지 |
| `LEARNING_RECOMMENDATION` | 부족역량 학습·자격증 추천 | 특정 유료 강의·기관을 필수처럼 표현 금지 / 취득 기간 보장 금지 |
| `APPLICATION_STRATEGY` | 지원 전략 문장 생성 | 불합격 가능성 단정 금지 / 개인 신상 기반 조언 금지 |

각 카드는 목적·입력·출력·품질체크·위험노트 + version(`v0.1`)·status(`DRAFT`)·검토일을 보여준다. 위험노트는 "거짓 경력 유도 금지 / 과도 추천 억제 / 환각(없는 기관·수치) 금지" 같은 **C의 가드레일 철학을 운영자가 읽을 수 있게 문서화한 것**이다.

## 5. 구현 상태 (됨 vs 향후) 정직 구분

| 항목 | 상태 |
| --- | --- |
| 관리자 홈 6개 처리대기 큐 (실패/강등/재분석/미분석/장기실패/신규) | 구현됨 |
| 분석 통계 (점수 구간 분포 · 반복 부족역량 빈도 Top10) | 구현됨 |
| 품질 검수 큐 8종 규칙 + upsert + resolve | 구현됨 |
| 적합도 관리 (필터·상세·구조화 JSON 노출·운영 메모 CRUD) | 구현됨 |
| 장기/대시보드 실행 메모 (`admin_career_run_memo` 대칭 CRUD) | 구현됨 |
| 프롬프트 운영 읽기 전용 카드 3종 | 구현됨 |
| 모든 엔드포인트 `requireAdmin` 권한 게이트 | 구현됨 |
| 프롬프트 **편집** 기능 | 의도적 미구현(코드 PR로 변경) |
| 품질 플래그 → 자동 재분석 트리거 | 향후 과제(현재는 운영자 수동 판단) |
| 통계의 일부 카운트(현재 mock 규칙엔진 기준 데이터) | 화면·계약은 실 LLM과 동일, 데이터만 데모용 |

:::tip 면접에서 정직하게
"품질 검수와 운영 큐는 **결정적 규칙으로 완성**돼 있고, AI를 다시 부르지 않아 비용 0·재현 100%입니다. 프롬프트 편집은 가드레일 무결성 때문에 **의도적으로 읽기 전용**으로 두고 코드 PR로 변경합니다. 자동 재분석 트리거는 향후 과제로, 지금은 플래그를 띄우고 운영자가 판단하는 휴먼 인 더 루프입니다."
:::

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단**: "AI 분석이 이상하면 운영자가 찾고·보고·기록하는 콘솔입니다. 검수는 저장된 결과에 결정적 규칙만 적용해서 AI를 다시 안 부릅니다."

**기본**: "관리자 홈이 처리대기 큐 6종을 결정적 COUNT로 띄우고요 — 실패·강등 노출·재분석 요청·미분석·장기 실패. 적합도 관리에서 필터로 좁혀 상세를 보고, `source_snapshot`·`condition_matrix` 같은 설명가능성 컬럼으로 점수 근거를 추적합니다. 이상하면 운영 메모를 다는데, `REANALYSIS` 타입을 달면 즉시 홈 큐 카운트에 반영돼 루프가 닫힙니다. 품질 검수 큐는 '점수 85인데 부족역량 5개', 'APPLY인데 필수 미충족' 같은 모순 8종을 규칙으로 잡아 `analysis_quality_flag`에 멱등 기록합니다."

**꼬리질문 대응**: "AI로 재검수하지 않은 건 비용·재현성·책임 때문입니다. 검수 자체가 또 환각하면 안 되니까요. 그래서 모순 패턴을 사람이 정의한 규칙으로 잡고, 특히 `REQUIRED_GAP_APPLY`는 가드레일이 정상이면 안 나와야 하는 패턴이라 **가드레일의 사후 감사** 역할도 합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 사용자 화면만 있으면 되지 관리자 화면을 왜 같이?**
A. AI 결과는 점수·판단을 사람에게 노출하고 불변 테이블에 쌓입니다. 잘못 나간 결과를 추적·교정할 운영 경로가 없으면 그 기능은 "완료"가 아닙니다. 팀 규칙도 사용자 기능 완료 기준에 관리자 화면·API를 포함시킵니다.

**Q2. 품질 검수에 LLM을 안 쓴 게 약점 아닌가요?**
A. 오히려 강점입니다. LLM 재검수는 매번 결과가 달라 감사가 안 되고 비용이 들며 검수가 또 환각합니다. 모순 패턴(점수-갭 불일치, APPLY-필수미충족 등)은 결정적 규칙으로 충분히 잡히고, 0원·100% 재현됩니다. 규칙이 못 잡는 미묘한 건 운영 메모로 사람이 보강합니다.

**Q3. 운영 메모랑 품질 플래그는 뭐가 다른가요?**
A. 품질 플래그(`analysis_quality_flag`)는 **시스템이 자동으로** 모순을 감지해 띄우는 것이고, `UNIQUE(target_type,target_id,flag_type)`로 멱등하며 `resolve`로 닫습니다. 운영 메모(`admin_fit_analysis_memo`)는 **사람이 직접** 다는 자유 기록이고, `memo_type`으로 분류합니다. 플래그=자동 탐지, 메모=수동 조치 기록입니다.

**Q4. "재분석 필요" 메모를 달면 실제로 재분석이 도나요?**
A. 자동으로 돌지는 않습니다(향후 과제). 지금은 그 메모가 홈 큐의 "재분석 요청" 카운트에 즉시 반영돼 운영자에게 보이고, 운영자가 판단해 사용자에게 안내하거나 재실행을 유도하는 휴먼 인 더 루프입니다. 자동 트리거는 과도 실행·비용 폭주를 막기 위해 일부러 사람을 끼웠습니다.

**Q5. 프롬프트를 관리자가 화면에서 수정 못 하게 한 이유는?**
A. 프롬프트는 가드레일·구조화 스키마 계약과 한 몸입니다. 화면에서 즉석 수정하면 strict 스키마나 가드 로직과 어긋날 수 있고, AI 프롬프트 공통 엔진은 팀장 소유입니다. 그래서 운영자에겐 목적·위험노트를 **확인**시키고, 실제 변경은 버전·리뷰가 남는 코드 PR로 합니다.

**Q6. `fit_analysis`가 재분석마다 INSERT인데 관리자 화면이 옛날 행에 헷갈리지 않나요?**
A. 강등 노출 같은 운영 판단은 지원 건별 `MAX(id)` 최신 행만 봅니다. 옛 실패가 이후 성공으로 덮였으면 큐에 안 잡힙니다. 반대로 상세에서는 이력 전체와 `source_snapshot`(분석 시점 입력 동결)을 볼 수 있어 "당시 왜 그랬는지"를 재현할 수 있습니다.

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명할 수 있으면 합격선이다.

1. 관리자 홈 처리대기 큐 6종을 각각 어떤 테이블/조건으로 셌는지.
2. 품질 검수 큐가 AI를 다시 안 부르고 모순을 잡는 방법과, `REQUIRED_GAP_APPLY`가 왜 특별한지.
3. 운영 메모(수동)와 품질 플래그(자동)의 차이, 그리고 `REANALYSIS` 메모가 홈 큐로 닫는 루프.
4. 프롬프트 화면을 읽기 전용으로 둔 이유와 위험노트가 무엇을 막는지.
5. `fit_analysis`가 INSERT-only인데 "최신 강등 건"을 어떻게 정확히 집계하는지.

## 퀴즈

<QuizBox question="영역 C 관리자의 품질 검수 큐(listQualityFlags)가 모순을 잡는 방식으로 옳은 것은?" :choices="['매 검수마다 LLM으로 분석 결과를 다시 채점한다', '저장된 분석 결과에 결정적 휴리스틱 규칙만 적용하고 AI는 호출하지 않는다', '사용자에게 설문을 보내 만족도를 집계한다', '분석 결과를 자동으로 덮어써 수정한다']" :answer="1" explanation="품질 검수는 이미 저장된 fit_analysis 행을 읽어 점수-갭 모순, APPLY-필수미충족 같은 패턴을 결정적 규칙으로 잡는다. AI 재호출이 없어 비용 0·재현 100%이고, 사용자 원본은 수정하지 않으며 조치는 운영 메모로 남긴다." />

<QuizBox question="관리자 적합도 화면에서 메모 타입을 'REANALYSIS'로 달면 일어나는 일은?" :choices="['해당 분석이 즉시 자동으로 재실행된다', '사용자에게 알림이 발송된다', '관리자 홈의 재분석 요청 큐 카운트(memo_type=REANALYSIS DISTINCT)에 반영된다', '프롬프트 버전이 올라간다']" :answer="2" explanation="AdminHomeMapper의 countReanalysisRequests가 admin_fit_analysis_memo에서 memo_type='REANALYSIS'인 fit_analysis_id를 DISTINCT로 세므로, 메모를 다는 즉시 홈 큐에 잡힌다. 자동 재실행은 향후 과제이고 현재는 운영자가 판단하는 휴먼 인 더 루프다." />

<QuizBox question="프롬프트 운영 화면(AdminFitAnalysisPrompts)을 읽기 전용으로 둔 가장 큰 이유는?" :choices="['프론트엔드 구현이 어려워서', '프롬프트는 가드레일·구조화 스키마 계약과 한 몸이라 즉석 수정 시 무결성이 깨지고, 공통 엔진은 팀장 소유라 변경은 버전·리뷰가 남는 코드 PR로 해야 하기 때문', '운영자가 글을 못 써서', 'OpenAI 정책상 금지되어서']" :answer="1" explanation="화면에서 프롬프트를 즉석 수정하면 strict json_schema·guardApplyDecision 같은 계약과 어긋날 수 있다. 그래서 운영자에겐 목적·위험노트를 확인만 시키고, 실제 변경은 버전·리뷰가 추적되는 코드 PR로 처리한다." />

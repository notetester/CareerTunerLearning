# C 데이터 모델 — 테이블 설계와 의도

> 점수는 결정적 규칙엔진이 소유하고, DB는 그 판단의 "근거·시점·이력"을 잃지 않게 동결한다. C 테이블은 결과 저장소가 아니라 **설명가능성·재현·감사의 인프라**다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

C 영역(취업 전략 분석·대시보드)이 소유하는 테이블군의 설계서다. 핵심은 세 가지다. (1) `fit_analysis`는 **불변(immutable)** 이라 재분석할 때마다 UPDATE가 아니라 INSERT한다. (2) 분석에 쓴 입력을 `source_snapshot`으로 **동결**해 원본이 바뀌어도 당시 기준을 재현한다. (3) JSON 컬럼으로 결과를 통째 보관하면서, 집계·검색이 필요한 조각만 정규화 테이블로 한 번 더 둔다.

이 페이지는 면접에서 자주 나오는 다음 질문에 답한다.

- "왜 `fit_analysis`를 UPDATE 안 하고 매번 INSERT 하나요?"
- "`source_snapshot`은 뭐고 왜 굳이 입력을 복사해 저장하나요?"
- "`condition_matrix`를 이미 JSON으로 들고 있는데 왜 `fit_analysis_condition_match` 테이블을 또 만들었나요?"
- "캐시 키(`input_fingerprint`)는 어떻게 만들고 무엇으로 캐시 적중을 판단하나요?"
- "남(A/B/D)의 데이터를 쓰는데 어떻게 침범 없이 분석하나요?"

:::tip 먼저 보면 좋은 페이지
- 점수·판단 규칙: [점수 엔진](/area-c/score-engine), [뉴로-심볼릭 철학](/area-c/neuro-symbolic)
- 캐시 메커니즘 상세: [핑거프린트 캐시](/area-c/caching-fingerprint)
- 가드레일·신뢰도: [가드레일](/area-c/guardrails)
:::

## 2. 왜 이렇게 설계했나 — 설계 의도와 트레이드오프

### 의도 1: 불변 이벤트 로그 vs 가변 현재 상태

적합도 분석은 "한 번 계산하고 끝"이 아니라, 사용자가 스펙을 보완하면 **다시 돌린다**. 두 가지 모델 중 하나를 골라야 했다.

| 방식 | 동작 | 문제 |
| --- | --- | --- |
| 가변(UPDATE) | 한 지원 건당 1행, 재분석 때 덮어씀 | 과거 점수·근거가 사라져 "성장"을 보여줄 수 없음, 감사 불가 |
| 불변(INSERT) | 재분석마다 새 행, 최신 행이 현재 | 행이 쌓임(조회 시 최신만 SELECT), 약간의 저장 비용 |

C는 **불변(append-only)** 을 택했다. 이유는 제품 가치 자체가 "점수가 어떻게 올라가는지 보여주기"이기 때문이다. 과거 분석을 지우면 `fit_analysis_history`의 `previous_score → new_score` 비교 자체가 성립하지 않는다. 트레이드오프(행 증가)는 `idx_fit_analysis_case (application_case_id)`로 최신 행만 빠르게 집어오고, 오래된 행은 이력·감사 자산으로 남겨 흡수한다.

### 의도 2: 입력을 동결한다 (source_snapshot)

분석 입력은 전부 **남의 테이블**이다 — A의 `user_profile`(스킬·경력·자격), B의 `job_analysis`/`job_posting`(요구조건). 이들은 C와 무관하게 계속 바뀐다. 만약 입력을 참조(FK)로만 두면, 6개월 뒤 프로필이 바뀌었을 때 "그때 70점은 무슨 근거였나?"를 **재현할 수 없다**. 그래서 분석 시점의 입력 핵심을 `fit_analysis.source_snapshot`(JSON)에 복사해 동결한다. `job_posting`은 `jobPostingRevision`까지 박아 어느 버전 공고였는지 못 박는다.

:::warning 정규화 원칙과의 충돌을 의도적으로 깬다
스냅샷은 "원본을 참조로 두라"는 정규화 교과서를 일부러 위반한 결정이다. 근거: 이 데이터는 **분석 시점의 사실(historical fact)** 이지, 갱신되어야 할 현재 상태가 아니다. 변하면 안 되는 값을 변하는 원본에 묶어두는 게 오히려 버그다.
:::

### 의도 3: JSON 1차 + 정규화 2차 (이중 저장)

`condition_matrix`(요구조건 매트릭스)는 사용자 화면에선 통째로 보여주면 되지만, 관리자는 "MET이 가장 적은 조건이 뭐냐", "특정 기술이 자주 UNMET이냐"를 **집계·검색**해야 한다. JSON 안을 매번 `JSON_TABLE`로 파싱해 집계하면 인덱스가 안 먹고 느리다. 그래서 같은 데이터를 두 곳에 둔다.

- `fit_analysis.condition_matrix` (JSON): 한 번에 읽어 화면에 뿌리는 **읽기 최적화** 사본
- `fit_analysis_condition_match` (정규화 행): 조건 1개 = 1행, `condition_type`/`match_status`에 인덱스 → 집계·관리자 검색

비정규화 사본 2개를 동기화하는 비용은 있지만, **둘 다 같은 분석 트랜잭션에서 한 번에 쓰고 불변**이라 동기화 깨질 여지가 없다. 읽기 패턴이 둘로 갈리는 데이터에서 흔한 정석(CQRS-lite)이다.

## 3. 어떤 기술로 구현했나 — 실제 테이블·컬럼 근거

스택: MySQL 8 + MyBatis(XML 매퍼), `ENGINE=InnoDB`, `CHARSET=utf8mb4`, `COLLATE=utf8mb4_0900_ai_ci`. PK는 전부 `BIGINT AUTO_INCREMENT id`. 운영 DB는 `db/patches/*c*.sql`로 멱등 점진 적용(`ALTER ... ADD COLUMN`은 `information_schema` 확인 후 조건부, `CREATE TABLE IF NOT EXISTS`).

C 소유 테이블 한눈에:

| 테이블 | 용도 | 핵심 키 | 특이 설계 |
| --- | --- | --- | --- |
| `fit_analysis` | 지원 건별 적합도 결과 | FK `application_case_id` | 불변·INSERT, JSON 컬럼 다수 + `source_snapshot` |
| `fit_analysis_history` | 재분석 점수 변화 이력 | UNIQUE `fit_analysis_id` | 1분석=1행, `diff_summary` JSON |
| `fit_analysis_condition_match` | 조건-스펙 매트릭스(정규화) | `(fit_analysis_id, sort_order)` | JSON의 정규화 사본, `created_at` 없음 |
| `fit_analysis_learning_task` | 학습 체크리스트 | FK `fit_analysis_id` | `completed`/`sort_order`, 단건 PATCH |
| `career_analysis_run` | 장기경향·대시보드 AI 실행 이력 | `input_fingerprint` | read-through 캐시 키 |
| `dashboard_insight` | 대시보드 요약 캐시 | FK `career_analysis_run_id`(SET NULL) | 실행 지워져도 인사이트 보존 |
| `dashboard_todo` | 오늘의 할 일 | UNIQUE `(user_id, derived_key)` | 파생 오버라이드 + 사용자 추가 혼합 |
| `admin_fit_analysis_memo` / `admin_career_run_memo` | 관리자 운영 메모 | FK 결과 + `admin_user_id` | 동일 `memo_type` 패턴 |
| `analysis_quality_flag` | 품질 플래그(과추천 등) | UNIQUE `(target_type, target_id, flag_type)` | **다형 참조, FK 없음** |
| `career_goal` / `learning_plan` / `learning_plan_task` | 경력 목표·학습 계획 | `career_goal` user당 1행(UNIQUE) | 사용자 입력 영역 |

`fit_analysis`의 설명가능성 JSON 컬럼들(각각 별도 컬럼인 이유 = 근거를 점수와 분리 저장):

| 컬럼 | 담는 것 |
| --- | --- |
| `source_snapshot` | 분석 입력 식별·시점·요약(동결) |
| `score_basis` | 점수 산정 근거(카테고리 가중 등) |
| `condition_matrix` | 요구조건/유형/판정(MET·PARTIAL·UNMET)/근거 |
| `gap_recommendations` | 필수미충족 / 우대보완 / 장기성장 분류 |
| `certificate_recommendations` | 자격증 우선순위·추천 이유 |
| `strategy_actions` | 지원/보완/면접 준비 과제 |
| `analysis_confidence` | 신뢰도 level + 입력 부족 사유 |
| `apply_decision` | APPLY/COMPLEMENT/HOLD + 이유·행동 |
| `model` / `prompt_version` / `status` | 어느 모델·프롬프트·경로(SUCCESS/FALLBACK/FAILED)로 나왔는지 |

## 4. 동작 원리 — 데이터 흐름·핵심 코드

### 4.1 적합도 분석 1회 쓰기

```text
[POST /applications/{id}/fit]
  1) A user_profile + B job_analysis 읽기(읽기 전용)
  2) 규칙엔진(MockFitAnalysisAiService)이 점수·판정·신뢰도 확정
  3) source_snapshot 빌드 → 입력 동결
  4) fit_analysis INSERT (새 행, 기존 행은 그대로 둠)
  5) condition_matrix(JSON) + fit_analysis_condition_match(정규화 행) 동시 INSERT
  6) 직전 분석과 비교 → fit_analysis_history INSERT (diff_summary)
  7) gap → fit_analysis_learning_task 체크리스트 생성
```

`source_snapshot`은 입력의 식별자와 시점, 핵심 리스트만 담는다(전체 원본 복사가 아니라 "재현 가능한 최소 집합"):

```java
// FitAnalysisServiceImpl#sourceSnapshot (요지)
snapshot.put("jobAnalysisId", source.getJobAnalysisId());
snapshot.put("jobPostingRevision", source.getJobPostingRevision()); // 어느 공고 버전인지
snapshot.put("profileUpdatedAt", source.getProfileUpdatedAt());     // 언제의 프로필인지
snapshot.put("requiredSkills",  parseList(source.getRequiredSkills()));
snapshot.put("preferredSkills", parseList(source.getPreferredSkills()));
snapshot.put("profileSkills",   parseList(source.getProfileSkills()));
snapshot.put("profileCertificates", parseList(source.getProfileCertificates()));
```

### 4.2 이력 diff (fit_analysis_history)

재분석 시 직전 최신 분석과 비교해 `diff_summary`(JSON)에 변화를 남긴다. 키는 결정적으로 집합 차집합으로 계산한다.

| diff 키 | 계산 | 의미 |
| --- | --- | --- |
| `gainedSkills` | now.matched − prev.matched | 새로 충족된 스킬 |
| `resolvedGaps` | prev.missing − now.missing | 해소된 부족역량 |
| `newGaps` | now.missing − prev.missing | 새로 생긴 부족역량 |

`UNIQUE (fit_analysis_id)`라 분석 1건당 이력은 정확히 1행 — "이 분석이 직전 대비 얼마 올랐나"는 단 하나뿐이라는 불변식을 DB가 보증한다.

### 4.3 read-through 캐시 (career_analysis_run)

장기경향·대시보드 요약은 매 조회마다 AI를 돌리면 비용·지연이 크다. 그래서 입력의 SHA-256 지문으로 캐시한다.

```java
// CareerAnalysisRunService#fingerprint
MessageDigest digest = MessageDigest.getInstance("SHA-256");
byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8)); // hex 64자
```

적중 판단은 "같은 유저·같은 analysisType의 **최신 실행**의 fingerprint가 지금 입력과 같고, FAILED가 아닐 것":

```java
// findFreshRun (요지)
if (latest == null
        || "FAILED".equals(latest.getStatus())   // 실패는 캐시 안 함
        || !fingerprint.equals(latest.getInputFingerprint()))
    return Optional.empty();                       // miss → AI 재실행
return Optional.of(latest);                        // hit → 저장된 result 재사용
```

핵심 트릭: fingerprint의 입력(`canonical`)은 **핵심 6개**(stats/skillGaps/jobReadiness/scoreHistory/interviewTrend/bestStrategy)만 정규 JSON으로 직렬화한다. 부가 집계가 흔들려도 지문이 안 깨져 불필요한 재실행을 막는다. 초기 로드는 캐시(무료), 명시적 재생성(`creditUsed > 0`)만 크레딧 1 차감 + `ai_usage_log` 기록. `DASHBOARD_SUMMARY`면 같은 record에서 `dashboard_insight`도 함께 INSERT한다.

### 4.4 derived_key — 파생과 사용자 추가의 동거

`dashboard_todo`는 두 종류 할 일을 한 테이블에 담는다.

- `derived_key`가 NULL → 사용자가 직접 추가한 할 일
- `derived_key`에 값 → 자동 파생 할 일의 **완료 오버라이드**(파생 항목 본문은 코드가 매번 다시 계산하고, DB엔 "이건 끝냈다"는 상태만 둔다)

`UNIQUE (user_id, derived_key)`라 같은 파생 할 일에 오버라이드가 중복으로 안 생긴다. 파생 데이터를 통째로 저장하지 않으니, 파생 규칙이 바뀌어도 stale 레코드가 안 남는다.

## 5. 구현 상태 — 됨 vs 향후 (정직 구분)

| 항목 | 상태 |
| --- | --- |
| 13개 C 테이블 DDL·인덱스·FK·CASCADE/SET NULL | 구현됨 |
| 멱등 점진 패치(`db/patches/*c*.sql`) | 구현됨 |
| `fit_analysis` 불변 INSERT + `source_snapshot` 동결 | 구현됨 |
| `fit_analysis_history` diff(gained/resolved/new) | 구현됨 |
| JSON 1차 + `fit_analysis_condition_match` 정규화 2차 | 구현됨 |
| `career_analysis_run` SHA-256 핑거프린트 read-through 캐시 | 구현됨 |
| `dashboard_todo` derived_key 오버라이드/추가 혼합 | 구현됨 |
| 관리자 메모·`analysis_quality_flag` 다형 플래그 | 구현됨 |
| 위 모든 흐름의 데이터 = 현재 규칙엔진(Mock) 기준 결정론적 생성 | 구현됨(데모 동작) |
| 실제 LLM이 채우는 설명 텍스트 컬럼 | 계약·컬럼은 동일, 실 LLM 연동은 키 발급 후 |

:::tip 면접용 한 줄 정리
"스키마와 저장·캐시·이력 로직은 완성돼 있고, JSON 설명 컬럼을 누가 채우느냐(규칙엔진 Mock이냐 실 LLM이냐)만 폴백 체인 뒤에서 갈립니다. 테이블 계약은 동일합니다."
:::

## 6. 면접 답변 3단계

**초간단(15초):** "C 테이블은 점수 저장소가 아니라 근거·시점·이력을 동결하는 인프라예요. `fit_analysis`는 불변이라 재분석마다 INSERT하고, 입력은 `source_snapshot`으로 동결해 나중에 재현·감사할 수 있게 합니다."

**기본(1분):** 위에 더해 — 결과는 JSON으로 통째 저장(읽기 최적화)하되 집계·관리자 검색이 필요한 `condition_matrix`만 `fit_analysis_condition_match`로 정규화해 인덱스를 태웁니다. 장기경향·대시보드 요약은 입력의 SHA-256 지문(`input_fingerprint`)을 캐시 키로 써서, 데이터가 안 바뀌면 저장된 결과를 재사용하고 명시적 재생성 때만 AI를 돌립니다. A/B/D 원본 테이블은 절대 수정하지 않고 읽기 전용 입력으로만 받습니다.

**꼬리질문 대응:** "왜 불변이냐"는 성장 추적·감사 가치, "왜 JSON+정규화 둘 다냐"는 읽기 패턴이 화면(통째)과 관리자(집계)로 갈려서, "캐시 적중을 뭘로 보냐"는 최신 실행의 fingerprint 일치 + FAILED 제외로 답합니다.

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. `fit_analysis`가 계속 INSERT되면 테이블이 무한히 커지지 않나요?**
A. 조회는 `idx_fit_analysis_case`로 지원 건당 최신 1행만 집어옵니다. 과거 행은 `fit_analysis_history`/감사용 자산이라 삭제 대상이 아니고, 필요하면 보존정책(아카이빙)으로 분리할 수 있습니다. 행 수보다 "이력을 잃지 않는 것"의 가치가 큰 도메인이라 의도된 트레이드오프입니다.

**Q2. `source_snapshot`이 원본과 달라질 수 있는데 그게 버그 아닌가요?**
A. 반대로 그게 목적입니다. 스냅샷은 "분석 시점의 사실"이라 현재 원본과 달라지는 게 정상입니다. 사용자가 프로필을 바꿔도 "그때 70점은 이 입력 기준"이 재현돼야 신뢰·감사가 됩니다. 현재 상태가 필요하면 원본을 읽으면 되고, 둘은 역할이 다릅니다.

**Q3. JSON과 정규화 테이블이 어긋나면(불일치) 어떻게 하나요?**
A. 둘 다 같은 분석 트랜잭션에서 한 번에 쓰고 그 후 둘 다 불변입니다. 갱신이 없으니 드리프트할 경로 자체가 없습니다. 만약 재분석하면 새 `fit_analysis` 행과 그에 딸린 새 정규화 행이 통째로 생기지, 기존 행을 부분 수정하지 않습니다.

**Q4. 캐시가 오래된 결과를 줄 위험은요?**
A. 캐시 키가 입력 자체의 지문이라, 입력이 바뀌면 지문이 바뀌어 자동 miss → 재실행됩니다. 즉 "데이터가 같으면 결과도 같다"가 보장되는 범위에서만 재사용합니다. FAILED는 캐시하지 않아 실패가 굳지 않습니다.

**Q5. `analysis_quality_flag`는 왜 FK가 없나요?**
A. `fit_analysis`와 `career_analysis_run` 두 종류를 같은 테이블로 플래그하는 다형 참조(`target_type` + `target_id`)라 단일 FK로 묶을 수 없습니다. 대신 `UNIQUE (target_type, target_id, flag_type)`로 같은 대상에 같은 플래그가 중복되지 않게 보장합니다. FK 무결성을 포기한 대신 한 테이블로 품질 운영을 통합한 선택입니다.

**Q6. 소유자(유저/지원 건)가 삭제되면 C 데이터는요?**
A. `fit_analysis`·`career_analysis_run` 등은 `ON DELETE CASCADE`로 함께 정리됩니다. 단 실행 이력에서 파생된 `dashboard_insight`는 `career_analysis_run` 삭제 시 `SET NULL`로 인사이트 본문은 보존합니다 — 실행 로그는 휘발성, 사용자에게 보여준 요약은 더 오래 남기는 차등 정책입니다.

## 8. 직접 말해보기

- 화이트보드에 `application_case → fit_analysis → {history, condition_match, learning_task}` 관계를 그리고, 어느 선이 1:1(UNIQUE)이고 어느 선이 1:N인지 말로 설명해 보라.
- "왜 입력을 동결하나"를 정규화 교과서를 어기는 이유까지 포함해 30초로 말해 보라.
- `career_analysis_run`에서 캐시 hit/miss 분기를 fingerprint·status 두 조건으로 설명하고, 왜 입력을 핵심 6개로만 지문화하는지 덧붙여 보라.

## 퀴즈

<QuizBox question="재분석이 일어나면 fit_analysis 테이블에서 무슨 일이 벌어지나?" :choices="['기존 행을 UPDATE해 점수를 덮어쓴다', '새 행을 INSERT하고 기존 행은 이력으로 남긴다', '기존 행을 DELETE 후 새로 INSERT한다', 'condition_matrix만 갱신한다']" :answer="1" explanation="fit_analysis는 불변(append-only)이다. 재분석마다 새 행을 INSERT하고 조회는 최신 행만 SELECT한다. 과거 행이 남아야 fit_analysis_history의 점수 변화 추적과 감사가 가능하다." />

<QuizBox question="condition_matrix를 JSON 컬럼으로 이미 저장하는데 fit_analysis_condition_match 정규화 테이블을 추가로 둔 가장 큰 이유는?" :choices="['JSON 저장 용량을 줄이려고', '관리자 화면의 집계·검색에 인덱스를 태우려고', 'JSON을 MySQL이 지원하지 않아서', 'AI 응답을 검증하려고']" :answer="1" explanation="화면은 JSON을 통째로 읽으면 되지만, 관리자는 조건별 MET/UNMET을 집계·검색해야 한다. JSON 내부 파싱은 인덱스가 안 먹으므로 조건 1개=1행으로 정규화해 (condition_type, match_status) 인덱스를 활용한다. 읽기 패턴이 둘로 갈리는 데이터의 정석." />

<QuizBox question="career_analysis_run의 read-through 캐시가 저장된 결과를 재사용(hit)하는 조건이 아닌 것은?" :choices="['최신 실행의 input_fingerprint가 현재 입력과 같다', '최신 실행의 status가 FAILED가 아니다', '같은 user_id·analysis_type이다', '최신 실행이 24시간 이내에 생성됐다']" :answer="3" explanation="캐시 적중은 시간 기반이 아니라 입력 동일성(fingerprint 일치) + 실패 제외(FAILED 아님) + 같은 유저·타입으로 판단한다. 입력이 안 바뀌면 아무리 오래돼도 재사용하고, 입력이 바뀌면 지문이 달라져 즉시 miss된다." />

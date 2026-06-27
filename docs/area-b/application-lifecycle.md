# 지원 건 생명주기 (Application Case Lifecycle)

> CareerTuner의 핵심 단위는 "공고"가 아니라 **지원 건(Application Case)**이다. 모든 공고 원문·분석·추출은 하나의 지원 건에 매달리고, 지원 건은 `DRAFT → ANALYZING → READY → APPLIED → CLOSED`의 상태머신으로 살아 움직인다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

**지원 건(`application_case`)**은 "한 사용자가 한 채용공고에 지원하는 한 건"을 표현하는 도메인 루트다. 공고 원문(`job_posting`), 공고 분석(`job_analysis`), 기업 분석(`company_analysis`), 비동기 추출 잡(`application_case_extraction`), 적합도(`fit_analysis`)가 전부 이 루트의 자식이다.

이 페이지가 답하는 면접 질문:

- "왜 공고가 아니라 지원 건을 핵심 단위로 잡았나?"
- "지원 건은 어떤 상태를 거치고, 상태 전이는 누가/어떻게 일으키나?"
- "AI 분석이 5분 걸리는데 그동안 상태와 동시성은 어떻게 안전하게 관리하나?"
- "즐겨찾기/보관/삭제는 상태와 어떻게 다른 축으로 설계했나?"

:::tip 핵심 한 문장
지원 건은 **상태(status)** 축과 **수명(archive/delete)** 축이 직교한다. status는 "분석·지원 진행도", archive/delete는 "목록에서의 가시성·보관"이라 서로 섞이지 않게 컬럼을 분리했다.
:::

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 2.1 왜 "공고"가 아니라 "지원 건"인가

같은 회사·같은 직무 공고라도 **지원하는 사람·시점·전략이 다르면 완전히 별개의 작업 단위**다. 공고를 1급 엔티티로 두면 "내 분석/내 적합도/내 면접 준비"를 공고에 직접 붙일 수 없거나 사용자별로 또 쪼개야 한다. 그래서 사용자 소유의 **지원 건을 루트로 두고**, 공고·분석·추출을 전부 그 아래에 트리로 매단다.

이 선택의 직접적 귀결:

| 결정 | 효과 |
| --- | --- |
| 모든 자식 테이블에 `application_case_id` FK + `ON DELETE CASCADE` | 지원 건 하나를 지우면 공고·분석·추출이 정합성 깨짐 없이 함께 정리 |
| `application_case`에 `user_id` FK | 소유권 검사가 루트 한 곳에서 끝남(`requireOwned`) |
| status를 루트에만 둠 | "이 지원이 어디까지 왔나"를 한 행으로 표현 |

### 2.2 status 축과 archive/delete 축을 분리한 이유

흔한 실수는 `DELETED`/`ARCHIVED`를 status enum에 끼워 넣는 것이다. 그러면 "분석이 READY인데 보관됨" 같은 **두 축의 조합**을 표현할 수 없다. CareerTuner는 두 축을 컬럼으로 분리했다.

- **진행 축**: `status` = `DRAFT/ANALYZING/READY/APPLIED/CLOSED`
- **가시성 축**: `archived_at`(보관), `deleted_at`(삭제함) — 둘 다 nullable timestamp, 둘 다 NULL이면 활성

이렇게 하면 "보관된 READY 지원 건", "삭제함에 있는 APPLIED 지원 건"이 자연스럽게 표현되고, 목록 쿼리는 두 축을 독립적으로 필터한다.

### 2.3 트레이드오프

- **soft delete를 택함** → 즉시 물리 삭제 대신 `deleted_at`만 찍어 30일 복원을 허용. 대신 자식 데이터가 디스크에 남고, 활성 쿼리마다 `deleted_at IS NULL` 조건이 붙는다.
- **status 전이를 DB UPDATE 가드에 박음** → 애플리케이션 레벨 락 없이 동시성을 막는 대신, 전이 로직이 SQL `WHERE`에 흩어진다(§4 참조).

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3.1 도메인과 테이블

```text
ApplicationCase.java        // 도메인 (status, favorite, archivedAt, deletedAt ...)
application_case            // 루트 테이블 (schema.sql:177)
application_case_status_history  // 상태 전이 감사 이력 (schema.sql:297)
```

`ApplicationCase` 도메인 핵심 필드(근거: `applicationcase/domain/ApplicationCase.java`):

| 필드 | 컬럼 | 의미 |
| --- | --- | --- |
| `status` | `status VARCHAR(20) DEFAULT 'DRAFT'` | 진행 상태 5종 |
| `favorite` | `is_favorite TINYINT(1)` | 즐겨찾기(도메인은 `favorite`, 컬럼은 `is_favorite`) |
| `archivedAt` | `archived_at DATETIME NULL` | 보관 시점(있으면 보관됨) |
| `deletedAt` | `deleted_at DATETIME NULL` | 삭제함 이동 시점(있으면 휴지통) |
| `sourceType` | `source_type` | 입력 출처 `TEXT/PDF/IMAGE/URL/MANUAL` |
| `deadlineDate` | `deadline_date` | 마감일 |

DDL(`schema.sql:177-194`) 요점: `PK BIGINT AUTO_INCREMENT`, `fk_application_case_user ... ON DELETE CASCADE`, `updated_at`은 `ON UPDATE CURRENT_TIMESTAMP`로 자동 갱신. InnoDB / utf8mb4.

### 3.2 서비스·매퍼 계층

`controller → service → mapper → domain` 4계층 + **MyBatis만**(JPA 금지). status·수명 관리 책임이 두 서비스로 나뉜다.

| 클래스 | 책임 |
| --- | --- |
| `ApplicationCaseServiceImpl` | 생성/조회/수정/삭제, 즐겨찾기·보관·마감일, status enum 검증, 상태 변경 시 이력 적재 |
| `ApplicationCaseAnalysisStatusService` | 분석 전이 전용(`markAnalyzing`/`markReadyAfterAnalysis`/`restorePreviousStatus`), `REQUIRES_NEW` 트랜잭션 |
| `ApplicationCaseMapper(.xml)` | 상태 전이 = **조건부 UPDATE SQL** |
| `ApplicationCaseAccessService` | `requireOwned`(소유권 단일 게이트) |

전이 메서드는 전부 매퍼에 **조건부 UPDATE**로 존재한다(`ApplicationCaseMapper.java`): `markAnalysisStarted`, `markReadyAfterAnalysis`, `restoreAnalysisStatus`, `softDeleteApplicationCase`, `restoreDeletedApplicationCase`, `insertStatusHistory`.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 상태머신 다이어그램

```text
            (생성)
              │
              ▼
          ┌───────┐  분석 시작        ┌───────────┐  분석 완료   ┌───────┐
          │ DRAFT │ ───────────────▶ │ ANALYZING │ ──────────▶ │ READY │
          └───────┘                  └───────────┘             └───────┘
              ▲   재분석 시작              │  실패 시                 │
              └──────────(READY)◀─────────┘  restore             사용자 수동
                                                                   │ 전이
                                          ┌──────────┐   ┌─────────┴──┐
                                          │ APPLIED  │   │  CLOSED    │
                                          └──────────┘   └────────────┘

  ※ archived_at / deleted_at 은 위 상태와 직교하는 별도 축(어느 상태에서도 가능)
```

- `DRAFT`: 지원 건이 막 생겼고 아직 분석되지 않음(기본값).
- `ANALYZING`: 자동 파이프라인 또는 단건 재생성이 LLM 분석을 도는 중.
- `READY`: 분석 산출물이 준비됨.
- `APPLIED` / `CLOSED`: 사용자가 실제 지원 완료/마감 처리(사용자 수동 전이).

### 4.2 상태 전이의 핵심 패턴 — "가드를 WHERE에 박는다"

상태머신을 코드 `if`로 검사하지 않고 **SQL UPDATE의 `WHERE`에 전이 조건을 박는다**. 영향받은 행이 0이면 동시성 충돌로 간주한다. 분석 시작 전이(`markAnalysisStarted`, `ApplicationCaseMapper.xml`)를 보면:

```sql
UPDATE application_case
SET status = 'ANALYZING'
WHERE id = #{id} AND user_id = #{userId}
  AND deleted_at IS NULL
  AND status = #{previousStatus}
  AND #{previousStatus} IN ('DRAFT', 'READY')
```

완료 전이(`markReadyAfterAnalysis`)는 `WHERE ... status = 'ANALYZING'`일 때만 `READY`로 바꾼다. 즉 **DRAFT/READY에서만 분석을 시작**할 수 있고, **ANALYZING에서만 완료**될 수 있다. 두 요청이 동시에 들어와도 한쪽만 1행을 갱신하고 나머지는 `updated != 1`로 떨어져 `CONFLICT` 예외가 난다.

```java
// ApplicationCaseAnalysisStatusService
int updated = applicationCaseMapper.markAnalysisStarted(id, userId, previousStatus);
if (updated != 1) {
    throw new BusinessException(ErrorCode.CONFLICT, "분석 상태를 시작 상태로 변경하지 못했습니다.");
}
```

### 4.3 "AI는 트랜잭션 밖" + REQUIRES_NEW 격리

LLM 호출은 최대 5분이 걸릴 수 있다. 그동안 DB 커넥션을 잡으면 풀이 고갈된다. 그래서 두 가지를 분리했다.

1. **`markAnalyzing`을 `@Transactional(REQUIRES_NEW)`로** 본 흐름과 분리해 먼저 커밋 → 다른 요청이 "이미 ANALYZING"임을 즉시 본다.
2. **LLM 호출은 트랜잭션 밖**에서 실행하고, **payload를 받은 뒤에만** INSERT + 상태 전이 + 로그를 한 트랜잭션에 묶는다.

자동 파이프라인(`ApplicationCaseAutoPipelineService.runAfterExtractionPass`)의 골격:

```java
String previousStatus = applicationCase.getStatus();
boolean started = markAnalyzingIfRunnable(userId, caseId, previousStatus); // DRAFT/READY만
try {
    // ↓ 트랜잭션 밖: 느린 LLM 호출 (공고분석 + 기업분석)
    var job = bAnalysisGenerationService.generateJobAnalysis(applicationCase, postingText);
    createJobAnalysis(...);                 // payload 수령 후 DB 쓰기
    var company = bAnalysisGenerationService.generateCompanyAnalysis(...);
    createCompanyAnalysis(...);
    createFitAnalysis(...);                 // C
    createInterviewPrep(...);               // D
    if (started) markReadyAfterAnalysis(caseId, userId, previousStatus); // → READY
} catch (RuntimeException ex) {
    if (started) restoreAnalysisStatus(caseId, userId, previousStatus);  // 롤백
    recordFailure(...);                     // ai_usage_log 에 FAILED 기록
}
```

`markAnalyzingIfRunnable`은 `previousStatus`가 `DRAFT`/`READY`일 때만 전이하고, 실패하면 `restoreAnalysisStatus`로 **이전 상태로 되돌린다**(ANALYZING에 영원히 끼는 것 방지).

### 4.4 두 진입 경로, 같은 전이 엔진

분석 전이를 일으키는 경로는 둘이고, 둘 다 같은 매퍼 전이를 쓴다.

| 경로 | 트리거 | 클래스 |
| --- | --- | --- |
| 비동기 자동 파이프라인(주 경로) | 공고 추출 PASS 또는 사용자 검수 확정 | `ApplicationCaseAutoPipelineService.runAfterExtractionPass` |
| 동기 단건 재생성 | `POST /{id}/job-analysis` 등 | `JobAnalysisService`/`CompanyAnalysisService` → `markAnalyzing` |

자동 파이프라인은 추출 통과 후 `applyConfirmedPosting`/추출 워커를 통해 호출된다(상세: [공고 OCR·텍스트 추출](/area-b/text-extraction-ocr)).

### 4.5 수명 축 — 즐겨찾기 / 보관 / 삭제함

| 동작 | 매퍼 | 효과 |
| --- | --- | --- |
| 즐겨찾기 토글 | `updateApplicationCase`(`is_favorite`) | 정렬·필터용 플래그. 목록 정렬은 `ORDER BY is_favorite DESC, updated_at DESC` |
| 보관 | `update`에서 `archived_at` set/null | 활성 목록에서 숨김, status는 유지 |
| 삭제함 이동 | `softDeleteApplicationCase` → `deleted_at = NOW()` | 활성에서 숨김, 30일 복원 가능, 자식 즉시 물리삭제 안 함 |
| 복원 | `restoreDeletedApplicationCase` → `deleted_at = NULL, archived_at = NULL` | 휴지통에서 활성으로(보관도 함께 해제) |

목록 쿼리(`findApplicationCasesByUserId`)는 `view`(`ACTIVE/ARCHIVED/DELETED`)로 분기한다:

- `DELETED`: `deleted_at IS NOT NULL AND deleted_at >= NOW() - INTERVAL 30 DAY` → **30일 지난 건은 휴지통에서도 사라진다**.
- `ACTIVE`: `deleted_at IS NULL AND archived_at IS NULL`
- `ARCHIVED`: `deleted_at IS NULL AND archived_at IS NOT NULL`

:::warning 삭제함의 의미
"삭제함 이동"은 물리 삭제가 아니다. UI도 명시한다 — 30일 동안 복원 가능하고 연결된 공고문·분석 결과는 즉시 물리 삭제되지 않는다. 실제 물리 삭제는 `ON DELETE CASCADE`가 걸린 hard delete 경로(`deleteApplicationCase`)에서만 일어난다.
:::

### 4.6 상태 전이 감사 이력

사용자가 status를 수동으로 바꾸면(`update`) 이전/이후 상태가 다를 때만 `insertStatusHistory`로 `application_case_status_history`에 한 행을 남긴다(`previous_status`, `new_status`, `changed_by_user_id`, `memo='USER_STATUS_UPDATE'`). 이 테이블은 `ON DELETE CASCADE`(케이스)와 `ON DELETE SET NULL`(변경자)로 정리된다. patch: `20260608_b_v1_application_case_history.sql`.

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| status 5종 + 조건부 UPDATE 전이 | **구현** | `ApplicationCaseMapper.xml`(`markAnalysisStarted`/`markReadyAfterAnalysis`/`restoreAnalysisStatus`) |
| "AI는 트랜잭션 밖" + REQUIRES_NEW | **구현** | `ApplicationCaseAnalysisStatusService`, `runAfterExtractionPass` |
| 즐겨찾기 / 보관 / 삭제함(soft delete) / 복원 | **구현** | `ApplicationCaseServiceImpl.update/delete/restore`, 매퍼 |
| 30일 휴지통 만료(목록에서 숨김) | **구현(쿼리 레벨)** | `findApplicationCasesByUserId`의 `INTERVAL 30 DAY` |
| 상태 전이 감사 이력 | **구현(사용자 수동 전이 한정)** | `insertStatusHistory`는 `update`에서만 호출 |
| `APPLIED`/`CLOSED` 전이 | **구현(사용자 수동)** | enum 허용값에 포함, `update`로 전환. 자동 전이 로직은 없음 |
| 30일 지난 삭제 건의 **물리 정리(배치)** | **미확인/계획성** | 쿼리는 30일 이후를 숨기지만, 자동 hard-delete 스케줄러는 이 영역 코드에서 확인되지 않음 |

:::warning 정직 포인트
"30일 후 삭제"는 **쿼리가 숨기는 것**이지, 현재 영역 B 코드에서 30일 경과 건을 물리적으로 `DELETE`하는 스케줄러는 확인되지 않았다. 면접에서 "soft delete + 30일 가시성 만료"까지만 단정하고, 물리 정리 배치는 "별도 정리 작업의 영역"이라고 구분해 말하는 것이 정확하다.
:::

## 6. 면접 답변 3단계

1. **무엇**: "CareerTuner의 핵심 단위는 지원 건입니다. 공고·분석·추출이 전부 지원 건 하위에 트리로 매달리고, 지원 건은 `DRAFT→ANALYZING→READY→APPLIED→CLOSED` 상태머신으로 관리됩니다."
2. **어떻게**: "상태 전이를 코드 `if`가 아니라 SQL UPDATE의 `WHERE` 가드로 구현해, 영향 행이 0이면 동시성 충돌로 처리합니다. 그리고 5분 걸리는 LLM 호출이 DB 커넥션을 잡지 않도록 분석 시작 전이는 `REQUIRES_NEW`로 먼저 커밋하고, LLM 응답을 받은 뒤에만 INSERT·완료 전이를 한 트랜잭션에 묶습니다. 실패하면 이전 상태로 롤백합니다."
3. **왜**: "진행 상태(status)와 가시성(보관/삭제)을 직교한 두 축으로 분리해서, '보관된 READY' 같은 조합을 자연스럽게 표현하고, soft delete로 30일 복원 안전망을 둡니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. status에 DELETED/ARCHIVED를 넣지 않은 이유는?
진행 상태와 가시성은 **직교하는 두 축**입니다. 보관은 "분석 진행도와 무관하게 목록에서 숨기는 것"이라 status에 넣으면 '보관된 READY'를 표현할 수 없습니다. 그래서 `archived_at`/`deleted_at`을 별도 nullable timestamp로 두고, 둘 다 NULL이면 활성으로 봅니다.
:::

::: details Q2. 두 사용자(또는 두 탭)가 동시에 "재분석"을 누르면?
상태 전이가 조건부 UPDATE라 안전합니다. `markAnalysisStarted`는 `WHERE status IN ('DRAFT','READY')`일 때만 ANALYZING으로 바꾸므로, 먼저 도착한 요청만 1행을 갱신합니다. 두 번째 요청은 status가 이미 ANALYZING이라 `updated != 1`이 되어 `CONFLICT`로 거부됩니다. 애플리케이션 락 없이 DB 한 행이 직렬화 지점이 됩니다.
:::

::: details Q3. 분석 도중 LLM 호출이 예외로 죽으면 지원 건이 ANALYZING에 영원히 끼지 않나?
끼지 않습니다. `runAfterExtractionPass`의 `catch`에서 `restoreAnalysisStatus`로 이전 상태(DRAFT/READY)로 되돌리고, `ai_usage_log`에 FAILED를 남깁니다. 또 추출 큐 워커 쪽에는 30분 넘게 RUNNING인 잡을 타임아웃 실패시키는 별도 가드도 있습니다. status 복구와 분석 잡 타임아웃은 다른 레이어라는 점을 구분합니다.
:::

::: details Q4. 왜 분석 시작 전이만 REQUIRES_NEW인가? 본 트랜잭션에 넣으면 안 되나?
본 트랜잭션에 넣으면, 5분짜리 LLM 호출이 끝나 커밋될 때까지 ANALYZING 전이가 다른 요청에게 보이지 않습니다. 그러면 "이미 분석 중"이라는 동시성 가드가 무력화됩니다. `REQUIRES_NEW`로 전이를 먼저 독립 커밋해야 다른 요청이 즉시 충돌을 감지합니다.
:::

::: details Q5. 삭제함 이동과 hard delete의 차이는?
삭제함 이동(`softDeleteApplicationCase`)은 `deleted_at`만 찍어 활성 목록에서 숨기고 30일 복원을 허용합니다. 자식 데이터는 그대로 남습니다. hard delete(`deleteApplicationCase`)는 실제 `DELETE`라 `ON DELETE CASCADE`로 공고·분석·추출이 함께 물리 삭제됩니다. 일반 사용자 흐름은 soft delete만 노출합니다.
:::

::: details Q6. 지원 건을 지우면 ai_usage_log도 사라지나?
아닙니다. 대부분의 자식은 `application_case` FK에 CASCADE라 함께 정리되지만, `ai_usage_log`는 케이스 FK가 `ON DELETE SET NULL`이라 **감사 로그는 케이스가 사라져도 남습니다**(과금·실패 추적용). 무엇을 CASCADE로, 무엇을 SET NULL로 둘지를 "정합성이 필요한 데이터 vs 감사가 필요한 데이터"로 나눈 설계입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 말할 수 있는지 점검하세요.

1. status 5종을 순서대로 말하고, 각 전이를 누가 일으키는지(자동 파이프라인 vs 사용자) 설명한다.
2. "상태 전이를 SQL `WHERE`에 박는다"가 동시성 안전을 어떻게 보장하는지, 영향 행수 0의 의미를 설명한다.
3. `REQUIRES_NEW` + "AI는 트랜잭션 밖" 조합이 왜 필요한지, 본 트랜잭션에 넣었을 때의 문제를 말한다.
4. status 축과 archive/delete 축이 직교한다는 것을, "보관된 READY"·"삭제함의 APPLIED" 예로 설명한다.
5. soft delete의 30일 만료가 "쿼리가 숨기는 것"이지 물리 삭제 보장이 아니라는 점을 구분한다.

관련 페이지: [공고 원문 저장·revision](/area-b/job-posting-storage) · [공고 OCR·텍스트 추출](/area-b/text-extraction-ocr) · [데이터 모델](/area-b/data-model) · [영역 B 개요](/area-b/) · [적합도 분석(C)](/area-c/fit-analysis)

## 퀴즈

<QuizBox question="지원 건의 status 전이를 코드 if가 아니라 SQL UPDATE의 WHERE 가드로 구현한 가장 큰 이유는?" :choices="['SQL이 Java보다 빠르기 때문', '애플리케이션 락 없이 동시성 충돌을 영향 행수 0으로 감지하기 위해', 'MyBatis가 if 문을 지원하지 않아서', 'JPA를 쓸 수 없어서']" :answer="1" explanation="markAnalysisStarted는 status가 DRAFT/READY일 때만 1행을 갱신한다. 동시 요청 중 한쪽만 성공하고 나머지는 updated != 1이 되어 CONFLICT로 떨어진다. DB 한 행이 직렬화 지점이 된다." />

<QuizBox question="분석 시작 전이(markAnalyzing)에 @Transactional(REQUIRES_NEW)를 쓴 이유로 가장 정확한 것은?" :choices="['트랜잭션을 빨리 끝내려고', '5분짜리 LLM 호출이 끝나기 전에 ANALYZING 전이를 먼저 독립 커밋해 다른 요청이 즉시 충돌을 감지하게 하려고', '롤백을 막으려고', '로그를 남기려고']" :answer="1" explanation="본 트랜잭션에 넣으면 LLM 호출이 커밋될 때까지 ANALYZING이 다른 요청에 보이지 않아 동시성 가드가 무력화된다. REQUIRES_NEW로 전이를 먼저 커밋해야 한다." />

<QuizBox question="application_case에서 status 축과 archived_at/deleted_at 축을 별도 컬럼으로 분리한 이유는?" :choices="['컬럼 수를 늘리려고', '진행 상태와 가시성은 직교하므로 보관된 READY 같은 조합을 표현하기 위해', 'enum이 5개를 넘으면 안 되기 때문', '인덱스 성능 때문']" :answer="1" explanation="status(진행)와 archive/delete(가시성)는 서로 독립적인 두 축이다. 한 enum에 섞으면 '보관된 READY'처럼 두 축의 조합을 표현할 수 없다." />

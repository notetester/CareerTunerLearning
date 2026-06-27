# B 데이터 모델 · revision 정합성

> 지원 건(`application_case`)을 루트로 한 트리, 공고 원문의 append-only revision, 그리고 "이 분석이 어느 공고 버전 기준인지"를 동결해 C/D/E의 읽기 전용 참조가 깨지지 않게 하는 정합성 설계.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 B의 데이터 모델은 **핵심 도메인 루트인 지원 건(`application_case`)** 아래에 공고 원문(`job_posting`)·공고 분석(`job_analysis`)·기업 분석(`company_analysis`)·추출 잡(`application_case_extraction`)을 매단 트리다. 모든 자식은 `application_case`를 FK로 잡고 `ON DELETE CASCADE`로 함께 정리된다.

이 페이지가 답하는 면접 질문은 다음과 같다.

- "공고가 수정되면 이전 분석은 어떻게 되나요? 덮어쓰나요, 보존하나요?"
- "분석 결과가 '어느 시점의 공고를 본 것'인지 어떻게 추적하나요?"
- "C(적합도)나 D(면접)가 B 데이터를 읽는데, 공고가 바뀌면 그 참조가 깨지지 않나요?"
- "공고 원문을 삭제하면 그 원문으로 만든 분석도 같이 사라지나요?"

핵심 키워드는 세 가지다. **(1) 지원 건 중심 트리 + CASCADE**, **(2) 공고 revision append-only(불변)**, **(3) 분석 시점에 `job_posting_id` + `job_posting_revision`을 동결**.

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 2.1 왜 "공고"가 아니라 "지원 건"이 루트인가

CareerTuner의 단위는 채용공고 그 자체가 아니라 **"내가 이 회사에 지원하는 한 건(Application Case)"** 이다. 같은 공고라도 사람마다, 시점마다 분석·전략·면접 준비가 다르다. 그래서 공고·분석·추출이 전부 **하나의 지원 건에 매달려 함께 생성되고 함께 삭제**되어야 정합성이 유지된다. 이걸 DB로 강제한 게 모든 자식 테이블의 `application_case_id` FK + `ON DELETE CASCADE`다.

### 2.2 왜 공고를 덮어쓰지 않고 revision으로 쌓는가

공고문은 사용자가 여러 번 다시 올릴 수 있다(텍스트 수정, PDF 재업로드, URL 재추출). 만약 한 행을 UPDATE로 덮어쓰면:

- 과거 분석이 "어떤 원문을 보고 나온 건지" 추적 불가능 → **재현성 상실**.
- 공고가 바뀌었는데 분석은 그대로 → 사용자가 그 사실을 알 수 없음 → **stale(낡음) 판정 불가능**.

그래서 `job_posting`은 **append-only**다. 새 공고가 들어오면 같은 케이스 안에서 `revision`을 1씩 올려 **새 행으로 INSERT**하고, 기존 행은 그대로 둔다. `UNIQUE(application_case_id, revision)`이 같은 케이스에 같은 revision이 두 개 생기는 것을 막는다.

:::tip 트레이드오프
append-only는 저장 공간을 더 쓰고(원문이 `MEDIUMTEXT`라 큼) "최신 한 건"을 매번 `ORDER BY revision DESC LIMIT 1`로 골라야 하는 비용이 있다. 하지만 감사 가능성·재현성·stale 판정을 얻는 대가로는 싸다. 토이 프로젝트의 "그냥 UPDATE"와 명확히 갈리는 지점이다.
:::

### 2.3 왜 분석에 revision을 박아 두는가 (이 페이지의 핵심)

`job_analysis`/`company_analysis`는 생성 시점에 자기가 본 공고의 `job_posting_id`와 `job_posting_revision`을 **함께 저장**한다. 이게 정합성의 심장이다. 이 두 컬럼이 있으면:

1. **재현성** — "이 분석은 공고 rev 2 기준"이라고 못 박힌다.
2. **stale 판정** — 최신 공고 revision과 비교해 다르면 "이전 공고 기준 분석"이라고 경고할 수 있다.
3. **읽기 참조 안정성** — C/D/E가 B를 읽을 때 "어느 버전을 근거로 했는지"를 스냅샷으로 가져갈 수 있다.

## 3. 어떤 기술로 구현했나 (실제 테이블·클래스 근거)

전부 MySQL 8 / InnoDB / utf8mb4, MyBatis 매퍼로 접근한다(JPA 금지). DDL은 `backend/src/main/resources/db/schema.sql`, 점진 적용 패치는 `db/patches/*b*.sql`(멱등)이다.

### 3.1 B 소유 테이블 6종 요점

| 테이블 | 역할 | 정합성 핵심 |
|---|---|---|
| `application_case` | 루트 | `status`(DRAFT/ANALYZING/READY/APPLIED/CLOSED), `source_type`, `is_favorite`, soft delete `deleted_at` + 보관 `archived_at`(둘 다 NULL이면 활성) |
| `job_posting` | 공고 원문 | `revision` append-only, `UNIQUE(application_case_id, revision)`, **UPDATE 메서드 없음(불변)** |
| `application_case_extraction` | 비동기 OCR 큐 | 가상 컬럼 `active_status_marker` + `UNIQUE(application_case_id, active_status_marker)`로 동시 진행 1건 강제 |
| `job_analysis` | 공고 분석(#6~9) | `job_posting_id` + `job_posting_revision`(분석 시점 동결), JSON 4종(`required_skills`/`preferred_skills`/`evidence`/`ambiguous_conditions`) |
| `company_analysis` | 기업 분석(#10~11) | `job_posting_id` + `job_posting_revision`, `verified_facts` vs `ai_inferences` 별 컬럼 분리, 신선도 `checked_at`/`refresh_recommended_at` |
| `application_case_status_history` | 상태 전이 감사 | 이전/이후 상태·변경자·메모(patch `20260608_b_v1_application_case_history.sql`) |

(공통 로그 `ai_usage_log`, 런타임 토글 `ai_runtime_setting`은 B가 기록하지만 공통 소유다.)

### 3.2 schema.sql에서 확인되는 FK·삭제 정책 (정합성의 실체)

```sql
-- 공고: 같은 케이스에 같은 revision 금지(append-only 보증)
UNIQUE KEY uk_job_posting_case_revision (application_case_id, revision),
CONSTRAINT fk_job_posting_case FOREIGN KEY (application_case_id)
    REFERENCES application_case (id) ON DELETE CASCADE

-- 공고 분석: 케이스로는 CASCADE, 원본 공고로는 SET NULL
CONSTRAINT fk_job_analysis_case FOREIGN KEY (application_case_id)
    REFERENCES application_case (id) ON DELETE CASCADE,
CONSTRAINT fk_job_analysis_posting FOREIGN KEY (job_posting_id)
    REFERENCES job_posting (id) ON DELETE SET NULL
```

**두 종류의 삭제 정책이 일부러 다르다는 게 면접 포인트다.**

- `application_case_id` → `ON DELETE CASCADE`: 지원 건을 지우면 그 아래 분석도 같이 정리(트리 정합성).
- `job_posting_id` → `ON DELETE SET NULL`: 원본 공고 행이 사라져도 **분석 결과 자체는 보존**하고 FK만 NULL로 끊는다. "공고는 없어졌지만 그때 만든 분석은 남긴다." `job_posting_revision`은 일반 INT 컬럼이라 그대로 남으므로, FK가 끊겨도 "rev 몇 기준이었는지"는 여전히 읽힌다.

`company_analysis`도 동일한 짝(`...case ... CASCADE` + `...posting ... SET NULL`)이다.

### 3.3 revision을 할당·동결하는 코드

- 공고 저장: `JobPostingService.replaceJobPosting()` (이름은 replace지만 실제로는 INSERT)
- 분석 생성 시 동결: `JobAnalysisService.createJobAnalysis()` → `JobAnalysis.builder()...jobPostingRevision(jobPosting.getRevision())`
- C 쪽 스냅샷: `FitAnalysisServiceImpl.sourceSnapshot()`이 `jobPostingRevision`을 `source_snapshot` JSON에 박음

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 공고 revision 번호 매기기 (낙관적 동시성)

새 공고가 들어오면 `replaceJobPosting`이 "현재 최대 revision + 1"을 계산해 INSERT한다. `JobPostingMapper.xml`:

```sql
<!-- nextRevisionForCase -->
SELECT COALESCE(MAX(revision), 0) + 1
FROM job_posting
WHERE application_case_id = #{applicationCaseId}
```

두 요청이 동시에 같은 번호를 계산하면 `UNIQUE(application_case_id, revision)`이 두 번째 INSERT를 거부한다. 코드는 이를 `DuplicateKeyException`으로 받아 **최대 3회 재시도**하고, 소진되면 `CONFLICT`를 던진다. 트랜잭션 격리는 `READ_COMMITTED`.

```java
// JobPostingService.replaceJobPosting (요지)
for (int attempt = 0; attempt < MAX_REVISION_INSERT_ATTEMPTS; attempt++) {
    jobPosting.setRevision(jobPostingMapper.nextRevisionForCase(applicationCaseId));
    try {
        jobPostingMapper.insertJobPosting(jobPosting);   // UNIQUE 충돌 가능
        return ...;                                       // 성공
    } catch (DuplicateKeyException ex) {
        // 마지막 시도였으면 CONFLICT, 아니면 번호 다시 계산해 재시도
    }
}
```

:::warning 락이 아니라 유니크 제약으로 동시성을 막는 이유
`SELECT ... FOR UPDATE`로 케이스 행을 잠그는 대신, **유니크 제약 충돌 + 재시도**를 택했다. 락은 LLM/추출 같은 긴 작업과 엮이면 커넥션을 오래 잡고, 멀티 인스턴스 환경에서 다루기 까다롭다. "충돌나면 번호 다시 따서 다시 넣어"가 더 단순하고 멀티 인스턴스에 안전하다.
:::

### 4.2 분석 시점에 revision 동결

```text
createJobAnalysis(userId, caseId)
  └ latestPostingRequired(caseId)        # 최신 job_posting 1건 (없으면 분석 불가)
  └ generateJobAnalysis(...)             # LLM/규칙 (트랜잭션 밖)
  └ INSERT job_analysis
       job_posting_id       = jobPosting.id
       job_posting_revision = jobPosting.revision   # ← 여기서 "동결"
```

분석은 항상 **그 순간의 최신 공고**를 기준으로 만들어지고, 그 공고의 id·revision이 분석 행에 새겨진다. 이후 사용자가 공고를 또 수정해 rev가 올라가도 **이미 만든 분석 행은 건드리지 않는다**(분석도 사실상 append-only로 누적).

### 4.3 stale(낡음) 판정 — 동결된 revision이 쓰이는 자리

프런트는 분석에 박힌 revision과 "현재 최신 공고 revision"을 비교해 낡았는지 표시한다. `JobAnalysisPanel.tsx`:

```ts
const isStale = Boolean(
  analysis &&
  latestJobPostingRevision !== null &&
  analysis.jobPostingRevision !== latestJobPostingRevision,
);
```

`isStale`이면 "이전 공고 rev 기준" 배지와 "최신 공고 rev N 기준으로 다시 분석" 배너를 띄운다. 관리자 화면도 같은 개념을 `staleAgainstLatestPosting`("공고 변경됨" 배지)로 보여준다. **동결된 숫자가 없으면 이 경고 자체가 불가능**하다 — 이게 revision을 박아 둔 직접적 이유다.

### 4.4 표: revision이 만드는 정합성 보장

| 상황 | revision이 없다면 | revision을 박아 두면 |
|---|---|---|
| 공고를 다시 올림 | 분석이 어떤 원문 기준인지 모름 | 분석은 rev 2, 최신 공고는 rev 3 → 차이로 stale 표시 |
| 원본 공고 행 삭제 | 분석이 떠버리거나 같이 삭제 | FK는 SET NULL, `job_posting_revision`은 남아 추적 유지 |
| C가 적합도 산출 | 어느 공고를 본 분석인지 불명 | `source_snapshot`에 revision 담아 근거 고정 |

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
|---|---|---|
| 지원 건 중심 트리 + CASCADE | 구현 | `schema.sql` 전 자식 FK |
| 공고 revision append-only + UNIQUE | 구현 | `JobPostingService.replaceJobPosting`, `uk_job_posting_case_revision`, patch `20260610_b_job_posting_revision_unique.sql` |
| 분석 시점 revision 동결 | 구현 | `JobAnalysisService` / `CompanyAnalysisService`의 `jobPostingRevision(jobPosting.getRevision())` |
| 원본 공고 삭제 시 분석 보존 | 구현 | `fk_job_analysis_posting ... ON DELETE SET NULL` |
| 프런트/관리자 stale 경고 | 구현 | `JobAnalysisPanel.isStale`, 관리자 `staleAgainstLatestPosting` |
| C의 revision 스냅샷 | 구현 | `FitAnalysisServiceImpl.sourceSnapshot()` → `source_snapshot` JSON |
| 추출 동시 진행 1건 강제 | 구현 | 가상 컬럼 + `uk_case_extraction_active` |
| `job_posting`에 UPDATE 경로 | 의도적으로 없음 | 매퍼에 update 메서드 부재(불변 보장) |

:::warning 혼동 주의
`job_posting`은 **불변**이다. "공고 수정"은 기존 행 UPDATE가 아니라 **새 revision INSERT**다. 분석도 새 분석 행으로 누적되므로, "최신"을 항상 `revision DESC` 정렬로 골라야 한다(`findLatestJobPostingByCaseId`).
:::

## 6. 면접 답변 3단계

1. **한 문장 요약**: "지원 건을 루트로 한 트리에서, 공고 원문은 덮어쓰지 않고 revision으로 쌓고, 분석은 생성 시점에 자기가 본 공고의 id와 revision을 같이 저장해 재현성과 stale 판정을 보장합니다."
2. **왜 그렇게**: "공고가 여러 번 바뀌어도 '이 분석이 어느 버전 기준인지'를 못 박아야 사용자에게 '분석이 낡았다'고 알릴 수 있고, C·D·E가 B를 읽을 때 참조가 흔들리지 않기 때문입니다."
3. **어떻게 구현**: "`UNIQUE(application_case_id, revision)`로 append-only를 보장하고 충돌 시 3회 재시도합니다. 자식의 케이스 FK는 CASCADE, 공고 FK는 SET NULL로 분리해서, 케이스를 지우면 함께 정리되지만 공고만 사라지면 분석은 보존됩니다. 프런트는 동결된 revision과 최신 revision을 비교해 stale 배지를 띄웁니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 왜 케이스 FK는 CASCADE인데 공고 FK는 SET NULL인가요?
삭제의 의미가 다르기 때문입니다. 지원 건을 지우는 건 "이 지원 자체를 폐기"하는 것이라 그 아래 공고·분석이 살아 있을 이유가 없어 CASCADE로 전부 정리합니다. 반면 특정 공고 행만 사라지는 경우(예: 정리·재구성)에 그걸로 만든 분석까지 날리면 사용자가 쌓아 둔 결과물을 잃습니다. 그래서 SET NULL로 FK만 끊고 분석은 보존하며, `job_posting_revision`은 일반 컬럼이라 남아 추적이 유지됩니다.
:::

:::details Q2. revision 충돌을 락 대신 유니크 제약 + 재시도로 처리한 이유는?
공고 저장은 OCR/URL 추출 같은 느린 작업과 인접해 있어, 비관적 락으로 케이스 행을 오래 잡으면 커넥션을 묶고 멀티 인스턴스에서 교착 위험이 커집니다. `UNIQUE(application_case_id, revision)`은 DB가 충돌을 원자적으로 막아 주고, 코드는 `DuplicateKeyException`을 받아 번호를 다시 계산해 최대 3회 재시도하면 됩니다. 단순하고 멀티 인스턴스에 안전한 낙관적 동시성 패턴입니다.
:::

:::details Q3. 분석에 revision을 안 박고 "최신 공고를 그때그때 다시 읽으면" 안 되나요?
그러면 "이 분석이 무엇을 근거로 나왔는지"가 시간에 따라 흔들립니다. 공고가 바뀌면 과거 분석의 근거(`evidence`의 인용 구절)가 더 이상 원문에 없을 수 있고, stale 여부도 판단할 기준이 사라집니다. id·revision을 동결해 두면 분석은 "그 시점의 그 원문"에 고정되어 재현 가능하고, 최신 revision과의 단순 비교로 낡음을 즉시 알 수 있습니다.
:::

:::details Q4. C(적합도)가 B를 읽는데 공고가 바뀌면 C의 결과는 깨지지 않나요?
C는 B를 읽기만 하고 수정하지 않습니다. C는 적합도를 산출할 때 자신이 사용한 입력의 식별자·시점을 `fit_analysis.source_snapshot` JSON에 스냅샷으로 남기는데, 여기 `jobAnalysisId`·`jobPostingId`·`jobPostingRevision`이 포함됩니다(`FitAnalysisServiceImpl.sourceSnapshot`). 그래서 이후 공고가 바뀌어도 "이 적합도는 공고 rev 몇, 분석 몇 번을 본 결과"라는 근거가 C 안에 고정되어 참조가 깨지지 않습니다.
:::

:::details Q5. `verified_facts`와 `ai_inferences`를 왜 별도 JSON 컬럼으로 나눴나요? (데이터 모델 관점)
기업 분석에서 "공고에서 직접 확인된 사실"과 "모델의 추론"을 데이터 레벨에서 분리하기 위해서입니다. 둘을 한 필드에 섞으면 UI에서 사실과 추측을 구분해 보여줄 수 없고, 환각이 "검증된 사실"로 노출될 위험이 큽니다. 길이·구조가 가변인 근거 배열(`[{fact, source}]`, `[{inference, basis}]`)이라 정규화 테이블로 쪼개지 않고 JSON 컬럼으로 두되, 검수 시 키 스키마만 검증합니다.
:::

:::details Q6. "활성/보관/삭제" 상태를 어떻게 데이터로 구분하나요?
`application_case`에 `archived_at`(보관)과 `deleted_at`(소프트 삭제)를 두고, **둘 다 NULL이면 활성**입니다. 휴지통은 `deleted_at`이 있는 행, 보관함은 `archived_at`이 있는 행을 거릅니다. 물리 삭제 대신 소프트 삭제라 "30일 복원" 같은 UX가 가능하고, 실제 행 삭제가 일어날 때만 CASCADE가 발동합니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 페이지를 이해한 것이다.

- `application_case`를 루트로 한 트리에서 자식들이 어떻게 함께 정리되는가(CASCADE)와, 왜 공고 FK만 SET NULL인가.
- 공고가 왜 불변(append-only)이고, 새 공고 저장이 어떻게 `MAX(revision)+1`로 번호를 따며 충돌을 재시도로 푸는가.
- 분석이 `job_posting_id`+`job_posting_revision`을 동결하는 한 줄이 stale 판정·재현성·C의 스냅샷을 어떻게 가능하게 하는가.
- 공고 원본 행이 삭제돼도 분석이 보존되는 이유(SET NULL + 일반 INT 컬럼).

연관 학습: 같은 영역의 [공고 저장과 revision](/area-b/job-posting-storage), [공고 분석](/area-b/job-analysis), [기업 분석](/area-b/company-analysis), [지원 건 라이프사이클](/area-b/application-lifecycle). 공통 개념은 [MyBatis](/backend/mybatis), [MySQL 스키마](/backend/mysql-schema), [트랜잭션](/glossary/transaction), [영역 C 적합도](/area-c/).

## 퀴즈

<QuizBox question="job_analysis 행에 job_posting_revision을 함께 저장하는 가장 핵심적인 목적은?" :choices="['저장 공간을 줄이려고', '분석이 어느 공고 버전 기준인지 동결해 재현성과 stale 판정을 가능케 하려고', 'LLM 호출 비용을 줄이려고', '공고 원문을 압축 저장하려고']" :answer="1" explanation="분석 시점의 job_posting_id와 job_posting_revision을 박아 두면, 최신 revision과 비교해 낡음(stale)을 판정할 수 있고 '이 분석이 어떤 원문 기준인지'가 재현 가능하게 고정됩니다." />

<QuizBox question="job_analysis의 FK 삭제 정책으로 옳은 것은?" :choices="['application_case는 SET NULL, job_posting은 CASCADE', '둘 다 CASCADE', 'application_case는 CASCADE, job_posting은 SET NULL', '둘 다 제약 없음']" :answer="2" explanation="케이스를 지우면 분석도 함께 정리(CASCADE), 원본 공고만 사라지면 FK만 끊고 분석은 보존(SET NULL)합니다. 그래서 공고가 없어져도 job_posting_revision으로 추적이 유지됩니다." />

<QuizBox question="새 공고 저장 시 revision 번호 충돌(같은 application_case_id에 같은 revision)을 막는 메커니즘은?" :choices="['SELECT ... FOR UPDATE 비관적 락', 'UNIQUE(application_case_id, revision) 제약 + DuplicateKeyException 재시도', '애플리케이션 전역 synchronized 블록', 'Redis 분산 락']" :answer="1" explanation="유니크 제약이 동시 INSERT 중 하나를 거부하면, 코드가 DuplicateKeyException을 받아 MAX(revision)+1을 다시 계산해 최대 3회 재시도하는 낙관적 동시성 패턴입니다." />

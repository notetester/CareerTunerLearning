# 공고 원문 저장 · revision

> 공고문은 덮어쓰지 않고 **버전을 쌓는다(append-only)**. 같은 지원 건에 공고가 바뀌면 새 revision이 생기고, 분석은 "어느 revision을 봤는지"를 동결해 참조 안정성을 지킨다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

**`job_posting`은 한 지원 건(Application Case)에 매달린 공고 원문의 버전 이력 테이블이다.** 텍스트/PDF/이미지/URL 등 5가지 입력으로 들어온 공고를, 사용자가 적은 **원문(original)**과 시스템이 추출한 **추출 텍스트(extracted)**로 분리해 저장하고, 공고가 갱신될 때마다 새 **revision**을 append한다.

이 페이지는 면접에서 다음 질문에 답하기 위한 것이다.

- "공고가 수정되면 기존 데이터를 덮어쓰나요, 새로 쌓나요? 왜 그렇게 했나요?"
- "PDF/이미지에서 글자를 뽑는 거랑 사용자가 붙여넣은 원문을 같은 칸에 넣지 않은 이유는?"
- "한 지원 건에 공고 버전이 여러 개면, 그걸 참조하는 적합도(C)·면접(D) 분석은 어떤 버전을 보고 판단하나요?"
- "여러 사용자/탭이 동시에 공고를 저장하면 revision 번호가 충돌하지 않나요?"

핵심 클래스는 `JobPostingService`, `JobPostingTextExtractor`, 도메인 `JobPosting`, 매퍼 `JobPostingMapper(.xml)`, 테이블은 `job_posting`이다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 덮어쓰기 대신 append-only를 택한 이유

CareerTuner의 핵심 단위는 공고가 아니라 **지원 건**이고, 한 지원 건의 공고는 시간이 지나며 바뀔 수 있다. 사용자가 URL을 다시 긁거나, PDF를 다시 올리거나, 본문을 손으로 고친다. 만약 공고문을 하나의 행으로 두고 매번 UPDATE 했다면 다음 문제가 생긴다.

- **재현성 상실** — "이 공고 분석은 어느 원문을 보고 만든 거지?"에 답할 수 없다. 원문이 이미 갱신됐으니까.
- **stale(노후) 판정 불가** — 공고가 바뀌었는데 분석이 옛날 그대로인지 알 길이 없다.
- **감사 불가** — 무엇이 언제 어떻게 바뀌었는지 추적할 수 없다.

그래서 공고문은 **불변(immutable) + append-only**로 설계했다. 한 번 들어간 행은 절대 UPDATE 하지 않고, 변경은 항상 `revision`을 +1 한 새 행을 추가한다. 이 결정의 흔적은 매퍼에도 남아 있다 — `JobPostingMapper`에는 INSERT/SELECT/DELETE는 있어도 **UPDATE 메서드가 아예 없다.**

:::tip 설계 트레이드오프
append-only는 저장 공간을 더 쓰고(과거 원문이 계속 남음), "최신 공고"를 매번 `ORDER BY revision DESC LIMIT 1`로 골라야 하는 약간의 복잡도를 진다. 대신 **재현성·stale 판정·감사 가능성**을 얻는다. 취업 의사결정처럼 "왜 그 결론이 나왔는지"를 설명해야 하는 도메인에서는 이 교환이 명백히 이득이다.
:::

### 2.2 원문(original) vs 추출 텍스트(extracted)를 한 칸에 안 넣은 이유

같은 공고라도 두 종류의 텍스트가 있다.

- **사용자가 직접 입력/붙여넣은 원문** (`original_text`)
- **PDF/이미지/URL에서 시스템이 뽑아낸 텍스트** (`extracted_text`)

이 둘을 분리하지 않으면, "이 글자가 사람이 적은 건지 OCR이 만든 건지"를 구분할 수 없다. OCR은 오인식이 섞이므로 **신뢰도가 다르다.** 분리해 두면 화면에서 `extractedText ?? originalText` 우선순위로 본문을 보여주면서도, 추출 품질이 의심되면 원문과 비교하거나 사용자에게 검수를 요청할 수 있다. 즉 **OCR/추출은 입력 텍스트를 확보하는 별도 단계**일 뿐이고, 그 산출물을 사람 입력과 같은 자리에 섞지 않는 것이 B 영역의 일관된 원칙이다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3.1 테이블 `job_posting` (schema.sql)

```sql
CREATE TABLE IF NOT EXISTS job_posting (
    id                  BIGINT NOT NULL AUTO_INCREMENT,
    application_case_id BIGINT NOT NULL,
    revision            INT NOT NULL DEFAULT 1,
    original_text       MEDIUMTEXT NULL,   -- 사용자 입력 원문
    uploaded_file_url   VARCHAR(512) NULL, -- 파일/URL 참조
    extracted_text      MEDIUMTEXT NULL,   -- OCR/추출 결과
    source_type         VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_job_posting_case_revision (application_case_id, revision),
    KEY idx_job_posting_case (application_case_id),
    CONSTRAINT fk_job_posting_case
        FOREIGN KEY (application_case_id) REFERENCES application_case (id) ON DELETE CASCADE
);
```

면접에서 짚을 컬럼·제약:

| 요소 | 의미 / 왜 |
| --- | --- |
| `UNIQUE(application_case_id, revision)` | "같은 케이스에 같은 revision 두 개" 금지. 동시 INSERT 충돌을 **DB 레벨에서** 막는 동시성 가드(§4.3). |
| `original_text` / `extracted_text` 분리 | 사람 입력 vs OCR 추출을 명시적으로 구분(§2.2). 둘 다 `MEDIUMTEXT`(최대 약 16MB)라 긴 공고도 수용. |
| `uploaded_file_url` | 파일 참조 또는 정규화된 URL. 원문 대신 "어디서 왔는지" 출처를 보관. |
| `source_type` | `TEXT/PDF/IMAGE/URL/MANUAL` 5종. 어떤 입력 경로로 들어온 공고인지. |
| `ON DELETE CASCADE` | 지원 건이 삭제되면 그 공고 이력도 함께 정리(트리 정합성). |
| **UPDATE 없음** | 매퍼에 UPDATE가 없어 행은 불변. 변경은 새 revision append로만. |

### 3.2 핵심 클래스 (절대경로)

| 클래스 | 책임 |
| --- | --- |
| `D:\dev\CareerTuner\backend\src\main\java\com\careertuner\jobposting\service\JobPostingService.java` | 저장 오케스트레이션, revision 부여, 재시도 |
| `...\jobposting\service\JobPostingTextExtractor.java` | PDF(PDFBox)/OCR/URL(SSRF 방어) 추출 |
| `...\jobposting\domain\JobPosting.java` | 도메인 모델(`revision`, `originalText`, `extractedText`, `sourceType`) |
| `...\jobposting\mapper\JobPostingMapper.java` + `...\resources\mapper\jobposting\JobPostingMapper.xml` | append-only SQL (INSERT/SELECT/DELETE, **UPDATE 없음**) |
| `...\jobposting\dto\JobPostingResponse.java` | API 응답 DTO(revision 포함) |

영속성은 프로젝트 규칙대로 **MyBatis만** 사용한다(JPA 금지). 입력 경로별 분기(텍스트 직접 저장, 파일 업로드 후 추출, URL 긁기, 추출 큐 경유)는 모두 `JobPostingService`의 여러 진입 메서드로 갈라지지만, 마지막에는 전부 **`replaceJobPosting(...)`** 한 곳으로 수렴해 revision을 부여하고 INSERT 한다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 입력 5종 → 어디에 무엇이 채워지나

```text
source_type   원문(original_text)   추출(extracted_text)   파일/URL(uploaded_file_url)
-----------   -------------------   --------------------   ---------------------------
TEXT          사용자 입력            (없음/선택)              -
MANUAL        사용자 입력            -                       -
PDF           -                     PDFBox로 추출            저장된 파일 참조
IMAGE         -                     OCR로 추출               저장된 파일 참조
URL           - (null 처리)          페이지 본문 추출          정규화된 URL
```

`JobPostingService.saveJobPosting`은 `source_type`이 `URL`이면 원문을 null로 두고, 본문이 비어 있으면 `textExtractor.extractUrl(...)`로 페이지를 긁어 `extracted_text`에 넣는다. PDF/IMAGE는 `uploadJobPostingFile` 경로에서 파일을 저장한 뒤 `textExtractor.extractFile(...)`로 추출한다.

### 4.2 새 revision을 만드는 핵심 코드 (축약)

저장의 심장은 `replaceJobPosting`이다. 이름은 "replace"지만 실제로는 **새 revision을 append**한다.

```java
private JobPostingResponse replaceJobPosting(Long caseId, JobPosting jobPosting) {
    for (int attempt = 0; attempt < MAX_REVISION_INSERT_ATTEMPTS; attempt++) { // 최대 3회
        jobPosting.setId(null);
        jobPosting.setRevision(jobPostingMapper.nextRevisionForCase(caseId)); // COALESCE(MAX(revision),0)+1
        try {
            jobPostingMapper.insertJobPosting(jobPosting);
            return JobPostingResponse.from(/* 방금 INSERT한 행 재조회 */);
        } catch (DuplicateKeyException ex) {
            // 다른 트랜잭션이 같은 revision을 선점 → 마지막 시도면 CONFLICT, 아니면 재계산 후 재시도
            if (attempt == MAX_REVISION_INSERT_ATTEMPTS - 1) {
                throw new BusinessException(ErrorCode.CONFLICT, "공고문 버전 충돌이 반복되었습니다...");
            }
        }
    }
    throw new BusinessException(ErrorCode.CONFLICT, "...");
}
```

`nextRevisionForCase`는 SQL 한 줄이다.

```sql
SELECT COALESCE(MAX(revision), 0) + 1 FROM job_posting WHERE application_case_id = #{applicationCaseId}
```

### 4.3 "MAX+1"의 race condition을 어떻게 막나

`MAX(revision)+1`은 그 자체로는 동시성에 취약하다. 두 트랜잭션이 동시에 같은 `MAX`를 읽으면 둘 다 같은 revision을 만들려 한다. 이 설계는 **두 겹**으로 막는다.

1. **DB 제약이 최후 방어선** — `UNIQUE(application_case_id, revision)`이 있으므로 둘 중 하나는 반드시 INSERT에 실패하고 `DuplicateKeyException`이 난다. 잘못된 중복 revision이 테이블에 들어갈 수 없다.
2. **애플리케이션이 우아하게 복구** — 예외가 나면 revision을 다시 계산해 **최대 3회** 재시도한다. 그래도 계속 충돌하면 `CONFLICT` 비즈니스 예외로 사용자에게 알린다.

트랜잭션 격리는 `READ_COMMITTED`다. 즉 "MAX를 읽는 시점"이 절대 안전하다고 가정하지 않고, **유니크 제약 + 재시도**로 정확성을 보장하는 패턴이다. 락을 길게 잡지 않아 동시성도 좋다.

:::tip 면접 한 줄 요약
"낙관적 동시성입니다. revision은 `MAX+1`로 낙관적으로 부여하고, 충돌은 유니크 제약이 잡아 예외로 만들며, 그 예외를 3회까지 재시도로 흡수합니다. 비관적 락을 안 써서 동시성과 정확성을 둘 다 잡았습니다."
:::

### 4.4 "최신 공고"와 "전체 revision 목록"을 읽는 법

매퍼는 읽기를 두 가지로 나눈다.

- `findLatestJobPostingByCaseId` → `ORDER BY revision DESC, id DESC LIMIT 1` (현재 공고)
- `findJobPostingRevisionsByCaseId` → `ORDER BY revision DESC, id DESC` (이력 테이블 전체)

프런트 `JobPostingPanel`은 이 두 번째 쿼리로 **revision 이력 테이블**을 그린다. 사용자가 과거 버전을 눈으로 확인할 수 있다.

## 5. 같은 케이스 여러 revision → C/D 참조 안정성 (이 페이지의 핵심)

공고가 여러 revision이 되면, 그걸 분석한 결과(적합도 C, 면접 D)는 "어느 버전을 봤는지"가 흔들리면 안 된다. 이 안정성은 **공고 쪽이 아니라 분석 쪽에서 revision을 동결**하는 방식으로 보장된다.

`job_analysis` 테이블에는 분석이 참조한 공고를 못 박는 두 컬럼이 있다.

```sql
job_posting_id       BIGINT NULL,
job_posting_revision INT NULL,
```

분석을 만들 때 **그 시점의 `job_posting_id`와 `revision`을 함께 박아 동결한다.** 이후 사용자가 공고를 새 revision으로 갱신해도, 기존 분석이 가리키는 revision은 바뀌지 않는다. 따라서 다음이 가능해진다.

| 보장 | 메커니즘 |
| --- | --- |
| **재현성** | "이 적합도 분석은 공고 rev N 기준"이 데이터로 남음 |
| **stale 판정** | `job_analysis.job_posting_revision !== 최신 revision` 이면 "공고가 그 사이 바뀜"으로 판정. 프런트는 "이전 공고 rev" 배지 + 재분석 배너, 관리자 화면은 `staleAgainstLatestPosting` 배지로 경고 |
| **원문 삭제에도 분석 보존** | 추출/분석 → `job_posting` FK가 `ON DELETE SET NULL`. 원문 행이 사라져도 분석 자체는 살아남고, 참조만 끊긴다 |

즉 **공고는 append-only로 과거를 보존하고, 분석은 본 revision을 동결**한다. 두 규칙이 맞물려 "여러 revision이 공존해도 어떤 분석이 어떤 공고를 봤는지 항상 추적 가능"이라는 참조 안정성이 나온다. C/D는 이 동결된 스냅샷 위에서 판단하므로, 공고가 갱신돼도 과거 결론이 소급해서 깨지지 않는다.

:::warning 흔한 오해
"여러 revision이 있으면 C/D가 헷갈리지 않나?"가 아니라, **C/D는 분석 생성 시점에 본 revision을 기록하므로 절대 헷갈리지 않는다.** 헷갈릴 수 있는 건 사람이고, 그래서 stale 배지로 "공고가 그 뒤 바뀌었다"를 명시적으로 알린다.
:::

## 6. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 공고 revision append-only + 유니크 제약 | **구현** | `job_posting` UNIQUE, `JobPostingService.replaceJobPosting` |
| `MAX+1` + DuplicateKey 3회 재시도 | **구현** | `MAX_REVISION_INSERT_ATTEMPTS=3`, `READ_COMMITTED` |
| 원문/추출 텍스트 분리 저장 | **구현** | `original_text` / `extracted_text` 별 컬럼 |
| PDF 텍스트 추출(PDFBox) | **구현** | `JobPostingTextExtractor.extractTextPdf`, `PDFTextStripper` |
| URL 추출 + SSRF 방어 | **구현(견고)** | loopback/사설/link-local/메타데이터(169.254.169.254)/CGNAT/IPv6 ULA 차단, 리다이렉트 5회 재검증, body 1MB·헤더 64KB 상한 |
| 분석 시 revision 동결 + stale 판정 | **구현** | `job_analysis.job_posting_revision`, 프런트/관리자 stale 배지 |
| 이미지/스캔 PDF의 자체 OCR | **선택·기본 OFF** | Python 워커(`ml/job-posting-worker`, PaddleOCR) 미가동 시, OpenAI OCR 폴백도 기본 OFF면 해당 단계는 `FAILED` 처리 |
| OpenAI OCR 폴백 | **구현됐으나 기본 OFF** | `JobPostingFallbackPolicy`(allowlist + DB 영속 토글), 전역 토글과 단계 allowlist가 둘 다 켜져야 동작 |

추출 텍스트는 최대 `120,000`자에서 절단된다(`MAX_EXTRACTED_TEXT_LENGTH`). URL 본문은 `<script>/<style>/<noscript>/<svg>`를 제거한 뒤 제목+본문 텍스트만 남긴다.

:::warning OCR 경로 정직하게
PDF에서 **텍스트가 정상 추출되면** PDFBox만으로 끝난다(외부 호출 없음). 텍스트가 비는 **스캔/이미지 PDF**나 IMAGE 소스일 때만 OCR이 필요한데, 자체 Python 워커도 OpenAI 폴백도 둘 다 기본 OFF다. 그래서 기본 구성에서 이미지 OCR은 "구현돼 있으나 비활성"이고, 비면 해당 추출은 `FAILED`로 떨어진다. "이미지에서 글자를 항상 뽑는다"고 단정하면 안 된다.
:::

## 7. 면접 답변 3단계

**1단계 (한 문장).** "공고 원문은 지원 건에 매달린 버전 이력입니다. 덮어쓰지 않고 revision을 쌓는 append-only 구조라, 분석이 어느 공고 버전을 봤는지 항상 추적할 수 있습니다."

**2단계 (왜 + 어떻게).** "취업 의사결정 도메인이라 재현성과 감사 가능성이 중요합니다. 그래서 `job_posting`은 UPDATE를 안 하고, 변경 때마다 `MAX(revision)+1`로 새 행을 INSERT 합니다. 사용자 입력 원문과 OCR 추출 텍스트는 신뢰도가 달라 별 컬럼으로 분리했고요. 동시 저장은 `UNIQUE(case_id, revision)` 제약이 막고, 충돌 시 3회까지 재시도합니다."

**3단계 (연동·트레이드오프).** "여러 revision이 공존해도 적합도(C)·면접(D) 분석은 생성 시점의 `job_posting_revision`을 동결해 기록하므로 참조가 흔들리지 않습니다. 최신 revision과 다르면 stale 배지로 재분석을 유도하고요. 원문이 지워져도 FK가 `ON DELETE SET NULL`이라 분석은 보존됩니다. append-only는 저장 공간을 더 쓰지만, 그 대가로 재현성·stale 판정·감사를 얻는 의도적 교환입니다."

## 8. 꼬리질문 + 모범답안

:::details Q1. revision을 DB AUTO_INCREMENT나 시퀀스로 안 쓰고 `MAX+1`로 직접 계산한 이유는?
revision은 **케이스 범위 안에서 1부터 시작하는 번호**라야 한다(케이스 A의 rev 1, 케이스 B의 rev 1이 따로 존재). 전역 AUTO_INCREMENT는 케이스별로 1,2,3…을 만들 수 없다. 그래서 `application_case_id` 범위에서 `MAX(revision)+1`을 계산하고, 동시성은 `UNIQUE(case_id, revision)` + 재시도로 잡는다. id는 전역 PK로 따로 AUTO_INCREMENT를 쓰되, revision은 케이스 로컬 카운터다.
:::

:::details Q2. `MAX+1` 재계산을 3번이나 하면 비효율 아닌가요? 비관적 락이 낫지 않나요?
같은 지원 건에 동시에 공고를 저장하는 일은 매우 드물다(보통 한 사용자가 자기 케이스를 다룬다). 드문 충돌을 위해 매 저장마다 행/테이블 락을 잡으면 일반 경로가 느려진다. 낙관적 재시도는 충돌이 없을 때 비용이 0이고, 충돌해도 보통 1~2회 안에 성공한다. `READ_COMMITTED`로 락을 짧게 가져가는 것과 일관된 선택이다.
:::

:::details Q3. URL로 공고를 긁을 때 보안 위험은? 어떻게 막았나요?
대표 위험은 **SSRF**다. 사용자가 `http://169.254.169.254`(클라우드 메타데이터) 같은 내부 주소를 넣으면 서버가 대신 내부망을 찌를 수 있다. `JobPostingTextExtractor`는 호스트를 DNS로 resolve한 뒤 **모든 결과 IP**를 검사해 loopback·사설(10/172.16/192.168)·link-local·메타데이터·CGNAT(100.64/10)·IPv6 ULA를 차단한다. 리다이렉트는 5회까지 따라가되 **매 홉마다 다시 검증**(리다이렉트로 내부 주소 우회 방지)하고, 응답 body는 1MB·헤더는 64KB로 상한을 둔다. DNS rebinding을 줄이려 검증된 IP로 직접 소켓 연결한다.
:::

:::details Q4. 공고를 새 revision으로 갱신하면 기존 분석은 어떻게 되나요?
기존 분석은 **그대로 남는다.** 분석은 생성 시점의 `job_posting_id`/`job_posting_revision`을 동결해 가지고 있어서, 공고가 갱신돼도 그 값은 안 바뀐다. 다만 최신 revision과 다르므로 **stale 상태**가 되고, 프런트는 "이전 공고 rev" 배지와 재분석 배너를 띄운다. 사용자가 재분석을 누르면 새 revision 기준의 새 분석이 만들어진다. 자동으로 옛 분석을 지우지 않는 이유는 과거 결론의 감사 가능성을 지키기 위해서다.
:::

:::details Q5. `original_text`와 `extracted_text`가 둘 다 있을 수 있나요? 화면엔 뭘 보여주나요?
가능하다(예: 사용자가 원문을 붙여넣고 추가로 파일도 올린 경우). 표시 우선순위는 **추출 텍스트 우선**(`extractedText ?? originalText`)이다. 추출이 있으면 그게 더 구조화된/정제된 본문일 가능성이 높기 때문이다. 단 추출이 없거나 비면 사용자가 적은 원문으로 폴백한다. 둘을 분리해 둔 덕분에 이 우선순위를 자유롭게 줄 수 있다.
:::

:::details Q6. 원문(job_posting 행)을 삭제하면 그 행을 가리키던 분석이 깨지지 않나요?
안 깨진다. `job_analysis`(와 `application_case_extraction`)에서 `job_posting`으로 향하는 FK는 `ON DELETE SET NULL`이다. 즉 공고 행이 삭제되면 분석의 `job_posting_id`가 NULL이 될 뿐, 분석 데이터(필수/우대 스킬, 요약 등)는 보존된다. 반대로 **지원 건 전체**가 삭제되면 그 하위 공고는 `ON DELETE CASCADE`로 함께 정리된다. "참조 끊김(SET NULL)"과 "트리 정리(CASCADE)"를 상황에 맞게 다르게 건 것이다.
:::

## 9. 직접 말해보기

아래를 소리 내어 30초 안에 설명해 보자. 막히면 §5와 §4.3을 다시 본다.

1. `job_posting`이 왜 UPDATE 없이 append-only인지, 그래서 무엇을 얻는지.
2. `original_text`와 `extracted_text`를 나눈 이유 한 가지.
3. 두 트랜잭션이 동시에 같은 케이스에 공고를 저장할 때 revision이 어떻게 정해지고, 충돌이 어떻게 처리되는지.
4. 한 케이스에 공고 rev가 1·2·3으로 늘었을 때, rev 1 기준으로 만든 적합도 분석이 어떻게 "이 분석은 rev 1을 봤다"를 증명하는지.

## 퀴즈

<QuizBox question="공고문이 갱신될 때 job_posting 테이블에서 일어나는 일은?" :choices="['기존 행을 UPDATE해 내용을 덮어쓴다', 'revision을 +1 한 새 행을 INSERT하고 기존 행은 그대로 둔다', '기존 행을 DELETE하고 새로 INSERT한다', '같은 행에 추출 텍스트만 추가한다']" :answer="1" explanation="job_posting은 append-only다. 매퍼에 UPDATE가 없고, replaceJobPosting이 MAX(revision)+1로 새 행을 INSERT한다. 과거 revision은 보존돼 재현성·stale 판정·감사가 가능하다." />

<QuizBox question="두 트랜잭션이 같은 지원 건에 동시에 공고를 저장해 같은 revision 번호를 만들려 할 때, 잘못된 중복을 막는 최종 방어선은?" :choices="['READ_COMMITTED 격리 수준', 'UNIQUE(application_case_id, revision) 제약', '비관적 SELECT FOR UPDATE 락', 'application 단의 synchronized 블록']" :answer="1" explanation="MAX+1은 낙관적이라 race가 가능하지만, UNIQUE(application_case_id, revision)가 중복 INSERT를 거부해 DuplicateKeyException을 발생시킨다. 애플리케이션은 이를 최대 3회 재시도로 흡수하고, 그래도 실패하면 CONFLICT로 알린다." />

<QuizBox question="한 케이스에 공고 revision이 여러 개 있어도 적합도(C)·면접(D) 분석의 참조가 안정적인 이유는?" :choices="['분석은 항상 최신 revision만 보도록 강제되기 때문', '분석이 생성 시점의 job_posting_revision을 동결해 기록하기 때문', 'revision이 바뀌면 옛 분석을 자동 삭제하기 때문', '공고가 단 하나의 행으로 관리되기 때문']" :answer="1" explanation="job_analysis는 job_posting_id와 job_posting_revision을 분석 시점에 박아 동결한다. 공고가 새 revision으로 갱신돼도 그 값은 안 바뀌어 '이 분석은 rev N 기준'을 증명한다. 최신과 다르면 stale 배지로 재분석을 유도하고, 원문이 지워져도 FK가 ON DELETE SET NULL이라 분석은 보존된다." />

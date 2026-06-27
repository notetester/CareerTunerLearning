# MySQL 스키마 설계

> CareerTuner의 모든 데이터는 "지원 건(application_case)"을 중심으로 PK/FK로 묶이고, 모든 테이블은 InnoDB + utf8mb4(이모지·다국어 안전)로 만든다. 분석 결과는 `application_case`에 외래키로 매달려 사용자 탈퇴 시 함께 정리된다.

## 1. 한 줄 정의

스키마 설계는 "어떤 테이블을, 어떤 컬럼·키·제약으로, 어떻게 관계 맺어 만들 것인가"를 정하는 작업이다. 핵심 도구는 **PK(기본키)·FK(외래키)·인덱스·정규화·문자셋(utf8mb4)** 다섯 가지다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 | 한 줄 의미 |
| --- | --- | --- |
| PK | Primary Key | 행을 유일하게 식별하는 키. 보통 `id BIGINT AUTO_INCREMENT` |
| FK | Foreign Key | 다른 테이블의 PK를 가리키는 참조. 관계와 무결성을 강제 |
| Unique Key | UK | 중복을 막는 키. `email`, `(provider, provider_user_id)` 등 |
| Index | 색인 | 조회를 빠르게 하는 보조 자료구조. `KEY idx_...` |
| 정규화 | Normalization | 중복을 줄이려 데이터를 여러 테이블로 분해하는 원칙 |
| utf8mb4 | UTF-8 max 4 byte | 글자당 최대 4바이트. 이모지·CJK 보조문자까지 안전 |
| InnoDB | MySQL 스토리지 엔진 | 트랜잭션·FK·행 잠금을 지원하는 기본 엔진 |
| DDL | Data Definition Language | `CREATE`, `ALTER` 등 구조를 정의하는 SQL |

:::tip utf8 vs utf8mb4
MySQL의 `utf8`은 사실 글자당 최대 3바이트만 저장하는 반쪽짜리라 이모지(4바이트)가 깨진다. 그래서 진짜 UTF-8은 **`utf8mb4`** 다. CareerTuner는 전 테이블 `DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci`로 통일했다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **PK가 없으면** 같은 행을 특정해 수정·삭제·참조할 수 없고, 중복 행이 쌓인다.
- **FK가 없으면** "존재하지 않는 회원의 분석 결과" 같은 고아 데이터(orphan)가 생기고, 회원 탈퇴 시 잔여 데이터를 일일이 지워야 한다.
- **인덱스가 없으면** `WHERE user_id = ?` 조회가 풀 스캔이 되어 데이터가 늘수록 느려진다.
- **정규화를 안 하면** 회사명·직무 같은 정보가 테이블마다 복붙되어 수정 누락(이상 현상, anomaly)이 발생한다.
- **utf8mb4가 아니면** 자기소개서의 이모지나 일부 한자가 `?`로 깨지거나 INSERT가 실패한다.

## 4. CareerTuner에서 어디에 썼나 (실제 테이블, 영역 표시)

소스: `backend/src/main/resources/db/schema.sql` (전체 스키마), `backend/src/main/resources/db/patches/` (운영 패치).

핵심 관계는 `users (1) -- (N) application_case (1) -- (N) 분석 결과` 구조다.

| 영역 | 테이블 | 역할 | PK/FK·키 포인트 |
| --- | --- | --- | --- |
| 공통(A) | `users` | 회원·권한·상태 | PK `id`, `UNIQUE uk_users_email`, 자기참조 FK `status_changed_by → users(id)` |
| 공통(A) | `refresh_token` | JWT refresh 저장 | FK→users, `UNIQUE uk_refresh_token_token` |
| 공통(B) | `application_case` | **핵심 단위(지원 건)** | FK→users `ON DELETE CASCADE`, `idx_application_case_user` |
| 공통(B) | `job_posting` | 공고 원문·추출본(리비전) | FK→application_case, `UNIQUE uk_job_posting_case_revision(case, revision)` |
| 공통(B) | `job_analysis` `company_analysis` | 공고·기업 분석 | FK→application_case |
| **C** | `fit_analysis` | 적합도 분석 결과 | FK→application_case, 점수·매칭/부족 스킬·근거를 JSON으로 |
| **C** | `fit_analysis_learning_task` | 학습 로드맵 체크리스트 | FK→fit_analysis (정규화로 분리) |
| **C** | `career_analysis_run` | 장기 경향/대시보드 실행 이력 | FK→users, `input_fingerprint`(캐시 키), 복합 인덱스 |
| **C** | `dashboard_insight` `dashboard_todo` | 대시보드 요약·할 일 | FK→users, `dashboard_insight`는 `career_analysis_run` 참조 |
| 공통 | `ai_usage_log` | AI 사용량·크레딧 차감 로그 | FK→users CASCADE, FK→application_case **SET NULL** |
| D/E | `interview_session/question/answer` | 가상 면접 | session→case, question→session, answer→question 계층 FK |

:::tip C 영역 설계 원칙 — "원본은 읽기만"
패치 주석에 명시돼 있다: *"A 프로필, B 공고/지원 건, D 면접 원본 테이블은 수정하지 않는다."* C가 만든 테이블(`fit_analysis*`, `career_analysis_run`, `dashboard_*`)만 소유·변경하고, 타 영역 데이터는 `input_snapshot` JSON에 "시점 스냅샷"으로만 복사해 둔다. 수직 분담제가 DB 레벨에서 지켜지는 방식이다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 테이블 한 장의 표준 골격

CareerTuner의 모든 테이블은 같은 관용구를 따른다.

```sql
CREATE TABLE IF NOT EXISTS fit_analysis (
    id                  BIGINT NOT NULL AUTO_INCREMENT,   -- PK
    application_case_id BIGINT NOT NULL,                  -- FK 대상
    fit_score           INT NULL,                          -- 0~100, 점수는 서버 규칙으로 확정
    matched_skills      JSON NULL,                         -- 가변 목록은 JSON
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fit_analysis_case (application_case_id),       -- 조회 인덱스
    CONSTRAINT fk_fit_analysis_case FOREIGN KEY (application_case_id)
        REFERENCES application_case (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
```

읽는 순서: 컬럼 정의 → PK → 인덱스(`KEY`) → 제약(`CONSTRAINT FK`) → 엔진/문자셋.

### 5-2. ON DELETE 동작 — 무엇을 같이 지우나

| 옵션 | 의미 | CareerTuner 예시 |
| --- | --- | --- |
| `CASCADE` | 부모 삭제 시 자식도 삭제 | `application_case → fit_analysis`: 지원 건 지우면 분석도 삭제 |
| `SET NULL` | 부모 삭제 시 FK를 NULL로 | `ai_usage_log.application_case_id`: 건은 지워도 **사용량 로그는 남김** |
| (자기참조) | 같은 테이블을 가리킴 | `users.status_changed_by → users(id) SET NULL`: 처리한 관리자 추적 |

핵심 판단: **종속 데이터는 CASCADE, 감사·통계 로그는 SET NULL**. 로그는 사용자보다 오래 살아야 하기 때문이다. (면접 학습 데이터 `interview_training_sample`은 아예 FK를 두지 않아 세션이 지워져도 보존된다.)

### 5-3. UNIQUE로 비즈니스 규칙 강제

코드 검증만 믿지 않고 DB가 마지막 방어선을 친다.

```sql
UNIQUE KEY uk_users_email (email)                          -- 이메일 중복 가입 차단
UNIQUE KEY uk_user_social_provider (provider, provider_user_id) -- 소셜계정 1회 연동
UNIQUE KEY uk_job_posting_case_revision (application_case_id, revision) -- 리비전 충돌 방지
```

### 5-4. 정규화 vs JSON — 둘을 섞어 쓴다

- **정규화**: 행 단위로 갱신·조회·체크하는 데이터는 별도 테이블. 예) `fit_analysis_learning_task`는 학습 항목마다 `completed` 토글이 필요해 `fit_analysis`에서 떼어냈다.
- **JSON 컬럼**: 통째로 읽고 쓰는 가변 구조(매칭 스킬, 점수 근거, 입력 스냅샷)는 `JSON` 타입. 예) `fit_analysis.matched_skills`, `career_analysis_run.input_snapshot`.

:::warning JSON은 만능이 아니다
JSON 컬럼은 스키마 강제가 약하고 내부 값으로 인덱싱·조인하기 까다롭다. "WHERE/JOIN/정렬 대상"이면 정규화 컬럼, "표시용 덩어리"면 JSON으로 가른다. CareerTuner도 점수(`fit_score`)는 컬럼, 근거(`score_basis`)는 JSON이다.
:::

### 5-5. 생성 컬럼으로 "동시에 하나만" 보장

`application_case_extraction`은 한 지원 건에 진행 중 추출이 동시에 둘 생기지 않게, 생성 컬럼(generated column) + UNIQUE 조합으로 막는다.

```sql
active_status_marker TINYINT GENERATED ALWAYS AS (
    CASE WHEN status IN ('QUEUED','RUNNING') THEN 1 ELSE NULL END
) STORED,
UNIQUE KEY uk_case_extraction_active (application_case_id, active_status_marker)
```

NULL은 UNIQUE 제약에서 중복 취급되지 않으므로, 진행 중(=1)일 때만 "건당 1개"가 강제된다.

## 6. 면접 답변 3단계

- **1문장**: "지원 건(application_case)을 중심으로 모든 분석 테이블을 FK로 묶고, InnoDB + utf8mb4로 무결성과 다국어를 보장하도록 설계했습니다."
- **기본**: "회원·지원 건·분석 결과를 1:N으로 정규화하고, 종속 데이터는 `ON DELETE CASCADE`, 감사 로그는 `SET NULL`로 라이프사이클을 구분했습니다. 중복 가입·리비전 충돌은 UNIQUE 키로 DB가 직접 막고, 가변 목록은 JSON, 행 단위로 다뤄야 하는 건 별도 테이블로 분리했습니다."
- **꼬리질문 대응**: "운영 DB에는 `schema.sql`을 매번 새로 적용할 수 없어서, `db/patches/`에 날짜+담당자 접두 파일로 idempotent ALTER를 쌓는 방식으로 점진 적용합니다. `information_schema`를 조회해 컬럼이 없을 때만 ALTER를 PREPARE/EXECUTE 하므로 여러 번 돌려도 안전합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 JPA가 아니라 MyBatis인가요? 스키마 설계에 영향은?
프로젝트 규칙상 영속성은 MyBatis만 씁니다(JPA 금지). 즉 엔티티가 스키마를 자동 생성(`ddl-auto`)하지 않고, **`schema.sql`이 곧 진실의 원천**입니다. 테이블·컬럼·키를 사람이 직접 SQL로 정의하고, 매퍼 XML이 그 컬럼을 명시적으로 매핑합니다. `map-underscore-to-camel-case` 설정으로 `application_case_id`(DB) ↔ `applicationCaseId`(자바)를 자동 변환합니다.
:::

:::details Q2. 운영 DB에 컬럼을 추가해야 하면 어떻게 하나요?
`schema.sql`을 다시 돌리면 기존 데이터가 위험하므로, `db/patches/`에 `20260609_c_fit_analysis_detail.sql` 같은 **날짜_담당자_설명.sql** 파일을 만듭니다. 각 ALTER는 `information_schema.columns`를 먼저 조회해 컬럼이 없을 때만 실행하도록 PREPARE/EXECUTE로 감싸 idempotent하게 작성합니다. 같은 변경을 `schema.sql`에도 반영해 신규 환경과 일치시킵니다. (로컬은 `backend/tools/ApplySqlPatch.java`로 JDBC 적용.)
:::

:::details Q3. 왜 PK를 BIGINT AUTO_INCREMENT로 잡았나요? UUID는요?
조인·인덱스가 좁고 빠르며 InnoDB 클러스터 인덱스에서 순차 삽입이라 페이지 분할이 적습니다. 회원·로그가 수백만 행까지 커질 수 있어 INT(약 21억) 대신 BIGINT를 택했습니다. UUID는 외부 노출·분산 환경에 유리하지만 16바이트 랜덤이라 인덱스 효율이 떨어져, 내부 PK로는 BIGINT가 적합하다고 판단했습니다.
:::

:::details Q4. 인덱스는 어떤 기준으로 추가했나요?
"자주 거는 WHERE·JOIN·ORDER BY 컬럼"에 답니다. FK 컬럼은 거의 항상 조회 키라 `idx_fit_analysis_case(application_case_id)`처럼 인덱스를 붙입니다. 두 조건을 함께 거는 경우는 복합 인덱스로, 예를 들어 `career_analysis_run`은 `(user_id, analysis_type, created_at)` 순서로 묶어 "특정 사용자의 특정 분석 유형을 최신순"으로 뽑는 쿼리를 커버합니다. 컬럼 순서는 선택도(좁히는 힘)가 높은 것부터입니다.
:::

:::details Q5. 회원이 탈퇴하면 데이터가 어떻게 처리되나요?
FK의 `ON DELETE` 정책으로 갈립니다. 프로필·지원 건·그 하위 분석은 `CASCADE`로 함께 삭제되고, `users` 삭제가 `application_case`를 지우면 `fit_analysis`까지 연쇄 삭제됩니다. 반면 `ai_usage_log`처럼 정산·통계가 필요한 로그는 `application_case_id`를 `SET NULL`로 두어 집계는 보존합니다. `users.status='DELETED'` + `deleted_at`으로 소프트 삭제를 먼저 거치는 흐름도 함께 둡니다.
:::

## 8. 직접 말해보기

1. 화이트보드에 `users → application_case → fit_analysis` 세 테이블을 그리고, 각 FK의 `ON DELETE` 옵션을 왜 그렇게 정했는지 30초 안에 설명해 보라.
2. "운영 DB에 `fit_analysis`에 컬럼 하나를 무중단으로 추가하라"는 요청을 받았다고 가정하고, 패치 파일을 어떻게 작성·적용할지 말로 풀어 보라.

## 퀴즈

<QuizBox question="MySQL에서 이모지·CJK 보조문자까지 안전하게 저장하려면 어떤 문자셋을 써야 하나?" :choices="['utf8', 'latin1', 'utf8mb4', 'ascii']" :answer="2" explanation="MySQL의 utf8은 글자당 최대 3바이트라 4바이트 이모지가 깨진다. CareerTuner는 전 테이블 utf8mb4 + utf8mb4_0900_ai_ci 콜레이션을 쓴다." />

<QuizBox question="지원 건(application_case)을 삭제하면 그 적합도 분석(fit_analysis)도 함께 삭제되게 하는 FK 옵션은?" :choices="['ON DELETE SET NULL', 'ON DELETE CASCADE', 'ON DELETE RESTRICT', 'ON DELETE NO ACTION']" :answer="1" explanation="종속 데이터는 CASCADE로 부모와 함께 삭제한다. 반대로 ai_usage_log 같은 감사·통계 로그는 SET NULL로 두어 사용자/건이 사라져도 집계를 보존한다." />

<QuizBox question="운영 DB에 컬럼을 추가하는 패치를 idempotent(여러 번 실행해도 안전)하게 만들려면 어떻게 작성해야 하는지 한 문단으로 설명하라." explanation="db/patches/ 아래에 날짜_담당자_설명.sql 파일을 만들고, 각 ALTER 전에 information_schema.columns를 조회해 해당 컬럼이 아직 없을 때만 ALTER 문을 PREPARE/EXECUTE 하도록 조건 분기한다. CREATE는 IF NOT EXISTS를 쓴다. 이렇게 하면 같은 패치를 재실행해도 이미 적용된 변경은 건너뛰므로 운영 데이터를 손상시키지 않고, 동일 변경을 schema.sql에도 반영해 신규 환경과 운영 환경의 구조를 일치시킨다." />

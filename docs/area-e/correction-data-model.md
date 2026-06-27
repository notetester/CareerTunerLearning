# 첨삭 데이터 모델 (`correction_request`)

> 첨삭 4종(면접답변·자소서·이력서·포트폴리오)은 **하나의 테이블 `correction_request`** 에 유형 컬럼으로 구분돼 append-only로 쌓인다. 원문은 절대 덮어쓰지 않고, A의 원본·D의 질문은 "읽기 전용 참조"로만 끌어온다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 E의 첨삭 기능이 만들어내는 모든 결과물 — 사용자 원문, AI 개선안, 변경 근거, 상태, 연결된 지원 건 — 을 **한 테이블 `correction_request` 하나로** 저장하는 방식이 이 페이지의 주제다.

이 페이지로 답할 수 있어야 하는 면접 질문:

- "첨삭 결과를 어떤 스키마에 저장했고, 왜 그렇게 설계했나?"
- "첨삭 유형이 4종인데 테이블도 4개인가?"
- "첨삭이 자소서(A)나 면접 답변(D) 원본을 건드리는가? 어떻게 분리했나?"
- "원문과 개선안을 어떻게 같이 보관하고, AI가 만든 근거(이유)는 어디에 두나?"

:::tip 핵심 한 문장
`correction_request`는 **불변(append-only) 결과 원장**이다. 재첨삭할 때마다 새 행을 만들고, 외부 데이터(지원 건·원본 글)는 ID로만 약하게 연결해 삭제·변경에 본문이 휘둘리지 않게 했다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 첨삭 4종을 단일 테이블 + 유형 컬럼으로

면접답변(`INTERVIEW_ANSWER`)·자소서(`SELF_INTRO`)·이력서(`RESUME`)·포트폴리오(`PORTFOLIO`) 4종은 입력 형태·출력 형태·검증·과금 흐름이 사실상 동일하다. 그래서 테이블을 4개로 쪼개지 않고 `correction_request` 하나에 `correction_type VARCHAR(40)` 한 컬럼으로 구분한다.

| 대안 | 장점 | 단점 | 채택 |
| --- | --- | --- | --- |
| 유형별 테이블 4개 | 각 유형 컬럼 최적화 | 조회·통계·과금 정책 4중 중복, 신규 유형마다 DDL | ✗ |
| **단일 테이블 + type 컬럼** | 목록/통계/과금 정책 1벌, 유형 추가가 enum 값 추가로 끝남 | 유형별 특화 컬럼을 못 둠(→ `result_json`으로 흡수) | ✓ |

도메인·서비스·AI 클라이언트도 같은 이유로 1벌만 둔다. `CorrectionService`는 `correctionType`만 보고 분기하고, AI 호출 키도 `"CORRECTION_" + correctionType`(예: `CORRECTION_SELF_INTRO`)으로 합성한다.

### 2-2. 원장(append-only) — 원문을 절대 덮어쓰지 않는다

첨삭은 사용자의 글을 "수정"하는 게 아니라 **개선안을 제안**하는 기능이다. 그래서:

- 같은 글을 다시 첨삭하면 기존 행을 UPDATE하지 않고 **새 행을 INSERT**한다(`CorrectionMapper.insert`만 존재, update 없음).
- 사용자의 자소서/이력서 원본(A 소유)도 첨삭이 직접 고치지 않는다. 반영 여부는 **사용자가 결과를 보고 직접 선택**한다.

트레이드오프: 행이 계속 쌓이지만, 그 대가로 "어떤 원문이 어떤 개선안으로 바뀌었는지" 이력이 통째로 남아 감사·롤백·비교가 가능하다.

### 2-3. 외부 데이터는 "약한 참조"로만 연결

`correction_request`는 지원 건(`application_case`)과 AI 사용량 로그(`ai_usage_log`)를 외래키로 연결하되, 둘 다 `ON DELETE SET NULL`이다. 즉 지원 건이 지워져도 첨삭 본문은 살아남고 연결만 끊긴다. 사용자 행만 `ON DELETE CASCADE`(계정이 사라지면 그 사람 첨삭도 함께 정리).

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

영역 E의 백엔드 표준 4계층(`controller → service → mapper → domain`)을 그대로 따른다.

| 계층 | 클래스 / 파일 | 역할 |
| --- | --- | --- |
| Controller | `CorrectionController` (`@RequestMapping("/api/corrections")`) | POST `/`(생성), GET `/`(목록), GET `/{id}`(단건) |
| Service | `CorrectionService.create / list / get` | 정규화·검증 → AI 호출 → 사용량 로그 → 저장 오케스트레이션 |
| Mapper | `CorrectionMapper` + `correction/CorrectionMapper.xml` | `insert`, `findByIdAndUserId`, `findByUserId` |
| Domain | `CorrectionRequest` (Lombok `@Data @Builder`) | 테이블 1:1 매핑 모델 |
| DTO | `CorrectionCreateRequest`, `CorrectionResponse`, `CorrectionResultPayload` | 요청/응답/JSON 페이로드 |

영속성은 **MyBatis만** 사용(JPA 금지). 도메인 `CorrectionRequest`는 테이블 컬럼과 1:1로 대응한다.

```java
// CorrectionRequest.java — 테이블과 1:1 매핑 모델 (필드 요약)
Long   id;                 // PK (auto-increment)
Long   userId;             // 소유자 (FK CASCADE)
Long   applicationCaseId;  // 연결 지원 건 (FK SET NULL, nullable)
String correctionType;     // SELF_INTRO / INTERVIEW_ANSWER / RESUME / PORTFOLIO
String sourceType;         // 원문 출처 종류 (기본 DIRECT_INPUT)
Long   sourceRefId;        // 원문 출처 행 ID (약한 참조, FK 아님)
String originalText;       // 사용자 원문 (MEDIUMTEXT)
String improvedText;       // AI 개선안 (MEDIUMTEXT)
String resultJson;         // summary/issues/changeReasons/suggestions (JSON)
String status;             // 기본 SUCCESS
Long   aiUsageLogId;       // 사용량 로그 연결 (FK SET NULL)
LocalDateTime createdAt;
```

### 테이블 DDL 요점 (`schema.sql:1078`, 패치 `20260616_e_correction_request.sql`)

```sql
CREATE TABLE correction_request (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT      NOT NULL,
  application_case_id BIGINT      NULL,
  correction_type     VARCHAR(40) NOT NULL,
  source_type         VARCHAR(40) NOT NULL DEFAULT 'DIRECT_INPUT',
  source_ref_id       BIGINT      NULL,
  original_text       MEDIUMTEXT  NOT NULL,
  improved_text       MEDIUMTEXT  NULL,
  result_json         JSON        NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  ai_usage_log_id     BIGINT      NULL,
  created_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 인덱스: user / case / type / ai_usage
  CONSTRAINT fk_..._user     FOREIGN KEY (user_id)             REFERENCES users(id)            ON DELETE CASCADE,
  CONSTRAINT fk_..._case     FOREIGN KEY (application_case_id) REFERENCES application_case(id)  ON DELETE SET NULL,
  CONSTRAINT fk_..._ai_usage FOREIGN KEY (ai_usage_log_id)     REFERENCES ai_usage_log(id)      ON DELETE SET NULL
);
```

조회 인덱스 4개(`user`, `application_case`, `correction_type`, `ai_usage_log`)는 그대로 화면 조회 패턴 — "내 첨삭 목록", "이 지원 건의 첨삭", "유형별 필터" — 에 대응한다.

## 4. 컬럼별 의미와 동작 흐름

### 4-1. 컬럼 의미표

| 컬럼 | 의미 | 채워지는 위치 |
| --- | --- | --- |
| `correction_type` | 첨삭 4종 구분. 서비스에서 화이트리스트 검증(위반 시 `INVALID_INPUT`) | 요청값 정규화(`trim().toUpperCase()`) |
| `source_type` | 원문 출처 종류. 비면 기본 `DIRECT_INPUT`, 최대 40자 | 요청값 정규화 |
| `source_ref_id` | 원문이 다른 테이블 행에서 왔을 때 그 행 ID(예: A의 자소서 행). **FK가 아닌 약한 참조** | 요청값 그대로 |
| `original_text` | 사용자 원문. 필수, **최대 12000자**, MEDIUMTEXT | 요청값 검증 후 저장 |
| `improved_text` | AI 개선안. 공백이면 AI 단계에서 `INTERNAL_ERROR` | AI 출력 |
| `result_json` | 개선의 **근거 묶음** — `summary`, `issues`, `changeReasons`, `suggestions` 4필드를 JSON으로 | AI 출력 직렬화 |
| `status` | 결과 상태. 저장되는 행은 기본 `SUCCESS` | 서비스에서 고정 |
| `ai_usage_log_id` | 이 첨삭이 쓴 토큰·과금 근거 로그 연결 | 사용량 로그 후 주입 |

:::tip `original_text` / `improved_text` / `result_json` 3분할
원문과 개선안을 **나란히** 별도 컬럼에 보관해 "before/after" 비교가 바로 가능하고, AI가 만든 메타(요약·문제점·변경 이유·추가 제안)는 컬럼을 늘리지 않고 `result_json` 하나에 흡수한다. 유형별로 메타 모양이 조금 달라져도 스키마를 안 바꿔도 된다.
:::

### 4-2. 생성 흐름 (`CorrectionService.create`)

```text
요청 → 정규화·검증(type 화이트리스트 / originalText ≤ 12000 / sourceType ≤ 40)
     → applicationCaseId 있으면 소유권 검증(타 영역 공통 서비스에 위임)
     → AI 호출(correct) ─실패→ 실패 로그(REQUIRES_NEW) 기록 후 throw
     → 성공: 사용량 로그 기록 → aiUsageLogId 확보
     → CorrectionRequest 빌드(status=SUCCESS) → INSERT
     → CorrectionResponse 반환
```

핵심은 **소유권을 직접 판단하지 않는다**는 점이다. 지원 건 연결이 있으면 `applicationCaseAccessService.requireOwned(userId, id)`로 **A/공통 영역 서비스에 위임**해 검증한다. E는 "이 지원 건이 이 사용자 것인가"를 스스로 결정하지 않는다.

### 4-3. 읽기 전용 참조 — A 원문 · D 질문은 어떻게 들어오나 (★집중 포인트)

`correction_request`가 외부 도메인을 건드리는 방식은 **세 가지뿐이고 모두 단방향 읽기**다.

1. **지원 건(A/공통):** `applicationCaseId`로 연결만 하고, AI 프롬프트에는 지원 건에서 **회사명·직무명만** 컨텍스트로 넘긴다. 원본 자소서/이력서를 끌어와 덮어쓰는 일은 없다.

   ```java
   // CorrectionAiClient.userPrompt — 지원 건은 '맥락'으로만 읽음
   String caseContext = applicationCase == null
       ? "No application case was selected."
       : "Company: %s\nJob title: %s".formatted(
             applicationCase.getCompanyName(),
             applicationCase.getJobTitle());
   ```

2. **원문 출처(A 자소서/이력서 등):** 원문 자체는 요청 본문 `originalText`로 받아 `original_text`에 **복사 저장**한다. "어디서 온 글인지"는 `source_type` + `source_ref_id`로만 기록한다. 즉 원본 테이블과 조인하지 않고, **그 시점의 텍스트를 스냅샷처럼 박제**한다. 원본이 나중에 바뀌어도 첨삭 행의 원문은 그대로다.

3. **면접 질문/답변(D):** 면접답변 첨삭의 질문 맥락은 요청의 `questionText`(`@Size(max=1000)`)로 들어온다. D는 면접 도메인에서 첨삭 **진입 탭(소개)** 만 제공하고, 실제 첨삭 실행은 E의 `/correction`으로 위임한다. 코드 주석에도 "면접 답변 첨삭(개선 답변)만 면접 도메인(D) 범위, 자소서/이력서/포트폴리오는 첨삭 도메인(E)으로 연결"이라고 명시돼 있다.

:::warning 경계의 핵심
`correction_request`는 **A·D의 데이터를 소유하지 않는다.** A 원문은 값으로 복사해 박제하고, D 질문은 입력 파라미터로 받는다. 외래키로 강하게 묶는 대상은 `users`(CASCADE)뿐이고, 지원 건·사용량 로그는 모두 `SET NULL`이라 외부 삭제가 첨삭 본문을 파괴하지 못한다.
:::

### 4-4. 조회

- `findByIdAndUserId(id, userId)` — 단건은 **항상 소유자 조건**이 붙는다. 남의 첨삭 id를 찍어도 `NOT_FOUND`로 떨어진다.
- `findByUserId(userId, applicationCaseId?, correctionType?, limit)` — 목록은 `user_id` 고정 + 선택 필터, `ORDER BY id DESC`, 기본 20건·최대 100건.
- 조회 시 `result_json`을 `CorrectionResultPayload`로 역직렬화한다. 파싱이 깨지면 예외를 던지지 않고 **빈 페이로드**로 폴백(과거 행 호환·견고성).

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

| 항목 | 상태 |
| --- | --- |
| `correction_request` 테이블·인덱스·FK | ✅ 구현 (schema.sql + 패치 20260616) |
| 생성/목록/단건 API + 소유권 검증 + result_json 저장 | ✅ 구현 (`/api/corrections` 실재) |
| 원문 박제(append-only), 재첨삭 시 새 행 | ✅ 구현 (update 경로 없음) |
| 실패도 별도 트랜잭션으로 사용량 로그 보존 | ✅ 구현 (`REQUIRES_NEW`) |
| `ai_usage_log_id` 연결 | ✅ 구현 (성공 시 주입) |
| **첨삭 프론트(`Correction.tsx`)와 백엔드 연결** | ⚠️ 미연결 — 화면은 정적 플레이스홀더("첨삭 API 준비 중"), `api()` 호출 0건. 백엔드는 실재하지만 프론트만 미배선 |
| **첨삭 실행 ↔ 실제 크레딧/사용권 차감** | ⚠️ 미배선 — 첨삭 시 `ai_usage_log`·`correction_request`만 쌓이고 잔액은 차감되지 않음(차감 엔진 자체는 완성·테스트 통과) |
| `status` 다중 상태 활용 | ⚠️ 저장되는 성공 행은 사실상 `SUCCESS` 고정. 실패는 `correction_request`가 아니라 사용량 로그에 `FAILED`로 남음 |
| 출력 필드 계약 | ⚠️ 운영안 설계 6필드(`corrected_text/changes/...`)와 **코드 출력 5필드**(`improvedText/summary/issues/changeReasons/suggestions`)가 다름 — 이 페이지는 **코드 출력 기준** |

:::warning 면접에서 절대 헷갈리지 말 것
"첨삭하면 크레딧이 깎인다"는 **설계 목표이지 현재 동작이 아니다.** 현재는 결과 행과 사용량 로그만 적재된다. 같은 맥락으로 첨삭 프론트는 아직 입력 흐름 샘플(정적)이고, 백엔드 API는 따로 살아 있다. 이 둘을 구분해 말하면 신뢰를 얻는다.
:::

## 6. 면접 답변 3단계

1. **무엇:** "첨삭 결과는 `correction_request` 단일 테이블에 저장합니다. 면접답변·자소서·이력서·포트폴리오 4종을 `correction_type` 한 컬럼으로 구분하고, 한 행에 원문(`original_text`)·개선안(`improved_text`)·변경 근거(`result_json`)를 함께 담습니다."
2. **왜:** "4종의 입력·출력·과금 흐름이 같아서 테이블을 쪼개지 않았고, 첨삭은 제안이지 수정이 아니라서 원문을 덮어쓰지 않고 **append-only 원장**으로 설계했습니다. 외부 데이터인 지원 건과 사용량 로그는 `SET NULL` 외래키로 약하게 연결해, 그쪽이 지워져도 첨삭 본문은 보존됩니다."
3. **어떻게:** "A의 원본 글은 `original_text`에 값으로 복사해 그 시점 상태로 박제하고, 출처만 `source_type`/`source_ref_id`로 기록합니다. 면접(D) 질문은 `questionText` 파라미터로 받습니다. 즉 A·D 데이터를 소유·조인하지 않고 읽기 전용으로만 참조합니다. 지원 건 소유권 검증은 공통 서비스(`requireOwned`)에 위임합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 첨삭 유형이 4종인데 왜 테이블을 1개로 했나? 유형별 컬럼이 다르면?
입력·출력·검증·과금 흐름이 동일해 모델·서비스·AI 클라이언트를 1벌로 유지하기 위해서다. 목록·통계·과금 정책(`benefit_code=CORRECTION` 한 풀 공유)이 중복 없이 한 번에 처리된다. 유형마다 메타가 조금씩 달라지는 부분은 컬럼을 늘리는 대신 `result_json`(JSON)으로 흡수해 스키마 변경 없이 대응한다. 신규 유형이 생겨도 화이트리스트 값만 추가하면 된다.
:::

:::details Q2. 재첨삭하면 기존 행을 UPDATE하나?
아니다. 매퍼에 update가 없고 `insert`만 있다. 재첨삭은 새 행을 추가한다(append-only). 덕분에 "어떤 원문이 어떤 개선안으로 갔는지" 이력이 전부 남아 비교·감사가 가능하다. `application_case` FK가 `SET NULL`이라 지원 건이 삭제돼도 과거 첨삭 본문은 보존된다.
:::

:::details Q3. 첨삭이 자소서 원본(A)을 수정하나? 면접 답변(D)은?
둘 다 수정하지 않는다. A 원문은 요청의 `originalText`로 받아 `original_text`에 **복사 저장**(스냅샷)하고, 출처는 `source_type`/`source_ref_id`로만 표시한다. AI 프롬프트에는 지원 건에서 회사명·직무명만 맥락으로 넘긴다. D는 면접 도메인에서 첨삭 진입 탭(소개)만 두고 실제 실행은 E의 `/correction`에 위임하며, 질문 맥락은 `questionText`로 전달된다. 원본 반영 여부는 사용자가 결과를 보고 직접 선택한다.
:::

:::details Q4. 남의 첨삭을 id로 조회할 수 있나?
없다. 단건 조회 `findByIdAndUserId`가 `id`와 `user_id`를 함께 조건으로 건다. 소유자가 아니면 `NOT_FOUND`로 떨어진다. 목록도 항상 `user_id` 고정에 선택 필터(지원 건·유형)만 얹는다. 지원 건 필터를 줄 때는 그 지원 건 소유권도 `requireOwned`로 먼저 검증한다.
:::

:::details Q5. AI가 만든 '변경 이유'는 어디 저장되나? 왜 본문과 분리했나?
`result_json` 컬럼에 `summary`·`issues`·`changeReasons`·`suggestions` 4필드를 JSON으로 묶어 저장한다. 본문(개선안)과 근거(메타)를 분리한 이유는 두 가지다 — (1) 사용자가 변경 이유를 검증한 뒤 선택 반영할 수 있게 하고, (2) 유형별로 메타 모양이 달라져도 스키마를 안 바꾸려는 것. 조회 시 역직렬화가 실패하면 예외 대신 빈 페이로드로 폴백해 과거 행과 호환된다.
:::

:::details Q6. 첨삭하면 크레딧이 깎이나?
지금은 깎이지 않는다. 첨삭 실행은 `correction_request` 결과 행과 `ai_usage_log`(토큰·환산 크레딧 기록)만 적재하고, 실제 차감(`users.credit` / `user_benefit_balance`)은 일어나지 않는다. 차감 엔진(원자적·멱등) 자체는 완성돼 테스트를 통과하지만 AI 실행 경로에 아직 배선되지 않았다. `ai_usage_log_id` FK가 이미 있어, 차감을 붙일 때 사용량 로그를 단일 근거로 삼는 연결 고리는 준비돼 있다.
:::

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명해보라:

1. `correction_request`의 핵심 컬럼 5개(`correction_type`, `original_text`, `improved_text`, `result_json`, `ai_usage_log_id`)를 한 문장씩.
2. "원문을 덮어쓰지 않는다"가 스키마·매퍼 차원에서 어떻게 보장되는지(append-only, update 없음, `SET NULL` FK).
3. A 원문과 D 질문이 각각 어떤 경로로 들어오고, 왜 그게 "읽기 전용 참조"인지.
4. 현재 구현된 것(생성/조회 API, result_json 저장)과 아직 안 된 것(프론트 연결, 실제 크레딧 차감)을 정직하게.

관련 학습: [공통 구조화 출력](/ai/openai-structured-output) · [MySQL 스키마 규약](/backend/mysql-schema) · [MyBatis](/backend/mybatis) · [영역 D — 면접](/area-d/) · [영역 A — 프로필](/area-a/)

## 퀴즈

<QuizBox question="첨삭 4종(면접답변/자소서/이력서/포트폴리오)은 데이터를 어떻게 저장하는가?" :choices="['유형별로 4개의 테이블에 나눠 저장', '단일 correction_request 테이블에 correction_type 컬럼으로 구분', 'ai_usage_log 한 테이블에만 저장', '유형별로 별도 데이터베이스를 둔다']" :answer="1" explanation="입력·출력·검증·과금 흐름이 동일해 모델·서비스·AI 클라이언트를 1벌로 두고, correction_request 단일 테이블에 correction_type(SELF_INTRO/INTERVIEW_ANSWER/RESUME/PORTFOLIO) 컬럼으로만 분기한다." />

<QuizBox question="application_case가 삭제될 때 그 지원 건에 연결된 첨삭 행은 어떻게 되는가?" :choices="['첨삭 행도 함께 삭제(CASCADE)', '삭제가 차단된다(RESTRICT)', 'application_case_id만 NULL이 되고 첨삭 본문은 보존(SET NULL)', '첨삭 행이 다른 사용자에게 이전된다']" :answer="2" explanation="fk_correction_request_case는 ON DELETE SET NULL이다. 지원 건이 사라져도 연결만 끊기고 원문·개선안 등 첨삭 본문은 그대로 남는다(append-only 원장 원칙). 사용자(users) FK만 CASCADE다." />

<QuizBox question="AI가 만든 변경 요약·문제점·변경 이유·추가 제안은 어디에 저장되는가?" :choices="['각각 별도 컬럼 4개', 'result_json 컬럼에 JSON으로 묶어서', 'improved_text 안에 합쳐서', '저장하지 않고 응답으로만 반환']" :answer="1" explanation="summary/issues/changeReasons/suggestions 4필드를 result_json(JSON 컬럼) 하나에 직렬화해 저장한다. 본문(improved_text)과 근거(메타)를 분리해 사용자 검증·선택 반영을 돕고, 유형별 메타 변화에도 스키마를 바꾸지 않는다." />

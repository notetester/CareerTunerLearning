# 기업 현황 AI 요약 [#10]

> 채용공고 한 장만 입력으로 받아, 회사의 사업·산업·경쟁사·이슈를 요약하되 **"검증된 사실"과 "AI 추론"을 컬럼 단위로 분리 저장**하고, 출처·확인시점·재조회 권장일을 함께 관리하는 기능. 환각이 "사실"로 보이는 것을 데이터 모델·프롬프트·검증 세 층에서 막는 것이 핵심.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

기업 현황 AI 요약(#10)은 지원 건에 등록된 공고문을 입력으로 **`company_analysis` 한 행을 생성**하는 AI 기능이다. 출력은 회사 요약(`company_summary`), 산업(`industry`), 최근 이슈(`recent_issues`), 경쟁사(`competitors`), 면접 포인트(`interview_points`)와 **두 종류의 근거 배열** — `verified_facts`(검증된 사실)와 `ai_inferences`(AI 추론) — 그리고 출처/확인시점 메타데이터다.

이 페이지가 답하는 면접 질문:

- "LLM이 회사 정보를 그럴듯하게 지어내면(환각) 어떻게 막았나요?"
- "왜 '검증된 사실'과 'AI 추론'을 따로 저장했나요? 그냥 요약 텍스트 하나면 안 되나요?"
- "외부 웹 검색도 안 하면서 어떻게 기업 분석을 하나요?"
- "확인시점(`checked_at`)과 재조회 권장일(`refresh_recommended_at`)은 왜 필요한가요?"

:::tip 핵심 한 문장
이 기능의 본질은 "회사를 잘 설명하는 것"이 아니라 **"모르는 걸 모른다고 표시하면서, 아는 것만 출처와 함께 분리해 보여주는 것"**이다. 취업이라는 의사결정에 환각이 섞이면 안 되기 때문이다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 가장 큰 위험: "환각이 사실로 보이는 것"

LLM은 "이 회사 대표는 OOO고 작년 매출은 OO억"처럼 **입력에 전혀 없는 정보**를 매우 자연스럽게 만들어낸다. 일반 챗봇이라면 사소한 오류지만, 사용자가 이 요약을 보고 **지원 여부와 면접 준비 방향을 정하는** 취업 플랫폼에서는 잘못된 "사실"이 의사결정을 왜곡한다. 그래서 #10의 설계 목표는 "더 풍부한 요약"이 아니라 **"검증 불가능한 내용을 사실처럼 내보내지 않는 것"**이다.

### 2.2 트레이드오프: 외부 웹 검색을 의도적으로 하지 않는다

기업 분석이라면 보통 뉴스·재무·채용 사이트를 크롤링하는 그림을 떠올린다. 이 기능은 **의도적으로 외부 조회를 하지 않는다**. 입력은 오직 회사명·직무명·공고문뿐이다.

| 선택 | 얻는 것 | 잃는 것 |
| --- | --- | --- |
| 외부 웹 검색 안 함 (현재) | 환각·오래된 정보·법적/SSRF 리스크 차단, 무비용, 오프라인 | 실시간 뉴스·최신 이슈 없음 |
| 외부 웹 검색 함 (미구현) | 풍부한 최신 정보 | 출처 신뢰성·환각·비용·차단 위험 |

대신 "최신 이슈는 사용자가 직접 확인하라"는 신호를 데이터에 남긴다 — 그게 `recent_issues` 폴백 문구와 `refresh_recommended_at`(재조회 권장일)의 존재 이유다.

### 2.3 트레이드오프: 요약 텍스트 1개 대신 "사실/추론 2분할"

가장 쉬운 구현은 `summary TEXT` 한 컬럼이다. 그러나 그러면 사용자는 어디까지가 공고에서 확인된 사실이고 어디부터가 모델의 추측인지 구별할 수 없다. 그래서 스키마 자체를 `verified_facts`(JSON)와 `ai_inferences`(JSON) **별도 컬럼**으로 쪼갰다. 데이터 모델이 곧 "사실 vs 추론" 경계를 강제한다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3.1 호출 체인

| 계층 | 클래스/파일 | 역할 |
| --- | --- | --- |
| 컨트롤러 | `ApplicationCaseController` (`/api/application-cases`) | 단건 재생성 엔드포인트 진입 |
| 서비스(B) | `CompanyAnalysisService` | 소유권/상태 가드 → 엔진 호출 → 트랜잭션 INSERT |
| 엔진 | `BAnalysisGenerationService.generateCompanyAnalysis` | LLM 호출 + 폴백 + 검증 |
| LLM 클라이언트 | `BLocalLlmClient.chat` | Ollama `/api/chat`, JSON Schema 강제 |
| 프롬프트 | `CompanyAnalysisPromptCatalog.SYSTEM_PROMPT` | 환각 차단 시스템 프롬프트 (`VERSION = "b-v1"`) |
| 도메인 | `CompanyAnalysis` | `company_analysis` 행 매핑 |
| 검수 검증 | `BAnalysisJsonValidator` | 사용자 수정 시 JSON 키스키마 검증 |

`CompanyAnalysisService`와 자동 파이프라인(`ApplicationCaseAutoPipelineService`)이 **같은 `generateCompanyAnalysis` 한 메서드로 수렴**한다. 진입 경로는 둘(비동기 자동 / 동기 단건 재생성)이지만 엔진은 하나다.

### 3.2 테이블 `company_analysis` (실제 DDL 발췌)

```sql
CREATE TABLE company_analysis (
    id                     BIGINT AUTO_INCREMENT,
    application_case_id    BIGINT NOT NULL,            -- 지원 건 FK, ON DELETE CASCADE
    job_posting_id         BIGINT NULL,                -- 분석 시점 공고, ON DELETE SET NULL
    job_posting_revision   INT NULL,                   -- 어느 공고 revision 기준인지 동결
    company_summary        MEDIUMTEXT,                 -- 회사 요약
    recent_issues          MEDIUMTEXT,                 -- 최근 이슈
    industry               VARCHAR(100),               -- 산업
    competitors            JSON,                       -- 경쟁사 배열
    interview_points       MEDIUMTEXT,                 -- 면접 포인트 (#11)
    sources                JSON,                       -- 출처 [{type,label}]
    verified_facts         JSON,                       -- ★ 검증된 사실 [{fact,source}]
    ai_inferences          JSON,                       -- ★ AI 추론 [{inference,basis}]
    source_type            VARCHAR(30) DEFAULT 'JOB_POSTING',
    checked_at             DATETIME,                   -- 확인 시점
    refresh_recommended_at DATETIME,                   -- 재조회 권장일
    confirmed_at           DATETIME,                   -- 사용자 확정 시점
    admin_memo             VARCHAR(2000)               -- 운영 메모
);
```

설계가 드러나는 지점:

- **`verified_facts` vs `ai_inferences`가 별 컬럼**이다. "사실/추론 분리"가 DB 레벨에 박혀 있다.
- `industry`만 `VARCHAR(100)`로 길이 제한, 나머지 요약류는 `MEDIUMTEXT`로 길이 가변.
- `job_posting_id`가 `ON DELETE SET NULL` — 공고 원문이 지워져도 **분석 결과는 보존**된다(어느 revision 기준이었는지는 `job_posting_revision`에 동결).
- 가변·비정형인 근거 배열(`verified_facts`/`ai_inferences`/`sources`/`competitors`)은 정규화 테이블로 쪼개지 않고 **JSON 컬럼**으로 보관한다. 길이·구조가 행마다 다른 "인용 배열"이라 그게 더 단순하다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 전체 흐름

```text
공고문 텍스트
  │
  ├─ BJobSentenceClassifier.classify  (문장 11라벨 분류, COMPANY_INFO 라벨 추출)
  │
  ├─ companyPrompt()  회사명/직무명 + COMPANY_INFO 문장 + 공고 원문(12k자 절단)
  │
  ▼
BLocalLlmClient.chat(SYSTEM_PROMPT, prompt, companyAnalysisSchema)
  │   (Ollama /api/chat, temperature=0, think=false, format=JSON Schema 강제)
  ▼
parseLocalCompanyPayload()  →  validateCompanyPayload()
  │                                      │
  │  검증 통과                            │ 실패(예외)
  ▼                                      ▼
LLM 결과 사용                      selfRulesCompanyAnalysis() 폴백 (결정론)
  │                                      │
  └──────────────┬───────────────────────┘
                 ▼
CompanyAnalysisService: TransactionTemplate으로
  insert + checkedAt=now + refreshRecommendedAt=now+30일 + 상태전이 + 로그
```

### 4.2 환각 차단 — 시스템 프롬프트 (불변식 명문화)

`CompanyAnalysisPromptCatalog.SYSTEM_PROMPT`는 안전 규칙을 자연어로 못 박는다. 핵심만 요약하면:

- 외부 웹 검색 금지.
- 모델이 알고 있는 회사 정보·일반 지식·기억을 **검증된 사실로 쓰지 말 것**.
- `verifiedFacts`에는 **입력(회사명/직무명/공고문)에서 직접 확인되는 사실만**.
- 대표자·설립일·직원 수·매출·투자·최근 뉴스처럼 입력에 없는 정보는 작성 금지.
- `source`는 "회사명/직무명/채용공고" 중 하나로.
- `aiInferences`는 추론만 쓰고, 확인 안 된 건 "추론" 또는 "확인 필요"로 구분.

### 4.3 출력 스키마 강제 — `companyAnalysisSchema()`

LLM에게 자유 텍스트가 아니라 **JSON Schema를 직접 전달**해 구조를 강제한다(`BLocalLlmClient`가 Ollama `format` 파라미터로 넘김). 사실/추론이 각각 객체 배열이라는 점이 스키마 자체에 들어 있다:

```java
properties.put("verifiedFacts",
    objectArraySchema(Map.of("fact", stringSchema(), "source", stringSchema()),
                      List.of("fact", "source")));
properties.put("aiInferences",
    objectArraySchema(Map.of("inference", stringSchema(), "basis", stringSchema()),
                      List.of("inference", "basis")));
```

즉 `verifiedFacts`는 `[{fact, source}]`, `aiInferences`는 `[{inference, basis}]` 형태로만 나올 수 있다. "추론에는 근거(basis)를 붙여라"가 스키마 강제다.

### 4.4 검증 — `validateCompanyPayload()`

LLM이 스키마를 지켜도 내용이 비면 안 된다. 파싱 직후 최소 품질을 검증하고, 실패하면 예외 → 폴백으로 떨어진다:

```java
private void validateCompanyPayload(CompanyAnalysisPayload payload, ApplicationCase ac) {
    if (isBlank(payload.companySummary()) || payload.companySummary().length() < 20)
        throw new IllegalStateException("회사 요약이 너무 짧음");
    if (isBlank(payload.interviewPoints()))
        throw new IllegalStateException("면접 포인트 누락");
    if (!hasArrayItems(payload.verifiedFacts()) && isBlank(ac.getCompanyName()))
        throw new IllegalStateException("검증 가능한 회사 사실이 하나도 없음");
}
```

마지막 조건이 의미심장하다 — **검증된 사실이 하나도 없고 회사명조차 없으면** "사실 기반"을 보증할 수 없으므로 LLM 결과를 버리고 규칙 폴백으로 간다.

이 프롬프트(외부조회 금지) + 스키마(사실/추론 분리) + 검증(빈 사실 거부)이 **환각 차단 3중 방어**다. 같은 패턴이 공고 분석(#6~9)에서는 [grounding 검증](/area-b/job-analysis)으로 나타난다.

### 4.5 사실 vs 추론 — 실제로 무엇이 들어가나

규칙 폴백(`selfRulesCompanyAnalysis` + `verifiedFacts` 헬퍼)이 만드는 사실 배열을 보면 "검증된 사실"의 보수적 정의가 드러난다. 직무명·회사명·"공고 텍스트는 추출·품질게이트를 통과했다" 정도만 사실로 인정하고, 출처는 `application_case`나 원문 인용으로 못 박는다. 입력으로 직접 확인 안 되는 건 전부 추론(`ai_inferences`)이나 "확인 필요"로 분류된다.

### 4.6 메타데이터 — 확인시점과 재조회 권장일

INSERT 시 `CompanyAnalysisService`가 시간 메타를 채운다:

```java
LocalDateTime checkedAt = LocalDateTime.now();
... .checkedAt(checkedAt)
    .refreshRecommendedAt(checkedAt.plusDays(30))   // 신선도: 30일 뒤 재조회 권장
    .sourceType("JOB_POSTING")                       // 이 분석의 출처 유형
```

- `checked_at`: "이 시점의 정보"임을 못 박는다.
- `refresh_recommended_at = checked_at + 30일`: 정보 노후를 추적하는 신호. 관리자/사용자 화면이 이 날짜를 넘으면 "갱신 필요(refreshDue)"로 표시한다.
- `source_type`: 기본 `JOB_POSTING`. 출처 유형은 `WEB/JOB_POSTING/MANUAL/API`를 상정하며, 외부 조회를 안 하므로 자동 생성분은 항상 `JOB_POSTING`이다.

### 4.7 트랜잭션 경계 — "AI는 트랜잭션 밖"

최대 수 분 걸릴 수 있는 LLM 호출이 DB 커넥션을 잡지 않도록, **payload를 받은 뒤에만** `TransactionTemplate`으로 INSERT·상태전이·로그를 한 트랜잭션에 묶는다. 실패하면 `restorePreviousStatus`로 상태를 롤백하고, `userFacingFailureMessage`가 SQL/스택트레이스(`com.mysql`, `org.springframework`, `TimeoutException`)를 사용자 메시지로 노출하지 않게 마스킹한다.

### 4.8 사용량 로깅 — 무과금

자체 LLM은 무과금이라 `recordLocalSuccess(... COMPANY_RESEARCH ...)`로 **크레딧 0**을 기록한다. 폴백이 발생하면 "시도한 모델 + 폴백 사유"를 `recordFailure`로 함께 남겨 운영자가 폴백 비율을 추적할 수 있다.

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 로컬 LLM 기업 분석(Ollama R1) | **구현·기본 ON** | `generateCompanyAnalysis`, `application.yaml`의 `local-llm.enabled` 실행 기본값 `true` |
| 사실/추론 별 컬럼 분리 저장 | **구현** | `company_analysis.verified_facts` / `ai_inferences` |
| 환각 차단 프롬프트 + 스키마 + 검증 3중 | **구현** | `CompanyAnalysisPromptCatalog`, `companyAnalysisSchema`, `validateCompanyPayload` |
| `self-rules-v1` 규칙 폴백 | **구현** | `selfRulesCompanyAnalysis` |
| 확인시점·재조회 권장일(30일) | **구현** | `checkedAt`, `refreshRecommendedAt = checkedAt + 30일` |
| 출처 메타 편집(관리자) | **구현** | `AdminCompanyAnalysisPage` MetadataEditor, PATCH `/admin/company-analysis/{id}/metadata` |
| 검증된 사실 vs AI 추론 2분할 UI | **구현** | `CompanyAnalysisPanel`(`verifiedFacts`/`aiInferences` 행 편집) |
| 외부 뉴스·이슈 실시간 조회 | **미구현(의도적)** | 프롬프트 "외부검색 금지", `recent_issues` 폴백 "외부 미조사" |
| `source_type = WEB/API` 자동 생성 | **미사용** | 자동 생성분은 항상 `JOB_POSTING`(외부 조회 없음) |

:::warning 인용 시 주의
프롬프트 버전은 런타임 코드 기준 **`b-v1`**이 정답이다(`CompanyAnalysisPromptCatalog.VERSION = "b-v1"`). 스토리보드/데모에 보이는 `b-v3.2` 같은 값은 mock 빌드 화면이므로 면접에서 인용하지 말 것.
:::

## 6. 면접 답변 3단계

**1단계 — 무엇 (10초):**
"기업 현황 AI 요약은 채용공고 한 장만 입력으로 받아 회사 요약·산업·경쟁사·이슈와 면접 포인트를 만드는 기능입니다. 핵심은 출력을 `company_analysis` 테이블에 저장할 때 **검증된 사실과 AI 추론을 별도 JSON 컬럼으로 분리**한다는 점입니다."

**2단계 — 왜 (20초):**
"취업 의사결정에 LLM 환각이 섞이면 사용자가 잘못된 정보로 지원을 결정합니다. 그래서 '풍부한 요약'보다 '모르는 걸 모른다고 표시하는 것'을 우선했습니다. 외부 웹 검색을 의도적으로 끄고 입력에서 확인되는 사실만 `verified_facts`에, 모델 추측은 근거(basis)와 함께 `ai_inferences`에 넣습니다."

**3단계 — 어떻게 (30초):**
"환각을 세 층에서 막습니다. 프롬프트가 '외부 조회 금지, 입력에 없는 회사 정보 작성 금지'를 명문화하고, JSON Schema로 `verifiedFacts=[{fact,source}]`·`aiInferences=[{inference,basis}]` 형태를 강제하며, `validateCompanyPayload`가 검증 가능한 사실이 하나도 없으면 LLM 결과를 버리고 규칙 폴백으로 떨어집니다. 또 `checked_at`과 `refresh_recommended_at`으로 정보 신선도를 추적해 30일 뒤 재조회를 권장합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 외부 검색을 안 하면 "최근 이슈" 같은 건 어떻게 채우나요?
자동 생성에서는 채우지 않습니다. 폴백 경로의 `recent_issues`에는 "기본 파이프라인에서 외부 미조사, 사용자 검토 시 최신 회사 뉴스를 확인하라"는 취지의 문구가 들어가고, `refresh_recommended_at`으로 재확인 시점을 남깁니다. 즉 "비워두되 비웠다는 사실과 다시 볼 시점을 데이터로 남기는" 방식입니다. 실시간 뉴스 조회는 의도적 미구현이며, SSRF·환각·비용 리스크를 피하기 위한 선택입니다.
:::

:::details Q2. 그냥 요약 텍스트 한 컬럼이면 안 되나요? 왜 `verified_facts`와 `ai_inferences`를 나눴나요?
한 컬럼이면 사용자가 어디까지 사실이고 어디부터 추측인지 구별할 수 없습니다. 취업 플랫폼에서 그 경계는 의사결정 품질에 직결됩니다. 그래서 데이터 모델 자체를 둘로 쪼개 경계를 강제했고, 프런트도 "검증된 사실"과 "AI 추론"을 2분할로 렌더링합니다. 추론 항목은 반드시 `basis`(근거)를 동반하게 스키마로 묶어, 추측에도 출처를 요구합니다.
:::

:::details Q3. LLM이 스키마를 지키면서도 사실 칸에 거짓말을 넣으면요?
세 가지로 대응합니다. (1) 프롬프트가 `verifiedFacts`의 `source`를 "회사명/직무명/채용공고"로 제한해 입력 밖 출처를 못 쓰게 합니다. (2) `validateCompanyPayload`가 검증 가능한 사실이 하나도 없으면 결과를 폐기하고 규칙 폴백으로 갑니다. (3) 규칙 폴백은 직무명·회사명·"품질게이트 통과" 같은 입력에서 100% 확인되는 항목만 사실로 인정합니다. 다만 LLM이 "입력에 있는 것처럼 보이는 거짓 사실"을 넣는 정밀 환각까지 토큰 단위로 완전 차단하지는 못하며, 그래서 사용자 검수(`confirmed_at`)와 관리자 검토 단계를 남겨 둡니다.
:::

:::details Q4. `checked_at`과 `refresh_recommended_at`의 차이는?
`checked_at`은 "이 분석이 만들어진(=정보를 확인한) 시점"이고, `refresh_recommended_at`은 "언제 다시 보는 게 좋은가"입니다. 코드에서 후자는 단순히 `checked_at + 30일`로 설정합니다. 회사 정보는 시간이 지나면 낡으므로, 이 두 값으로 신선도를 추적하고 관리자 화면에서 "갱신 필요"를 필터링합니다. 외부 자동 갱신은 없고, 사람이 검토할 시점을 알려주는 신호입니다.
:::

:::details Q5. LLM 호출이 5분 걸리는데 DB는 괜찮나요?
LLM 호출을 트랜잭션 밖에서 합니다. payload를 받은 뒤에만 `TransactionTemplate`으로 INSERT·상태전이·로그를 묶어, 느린 외부 호출이 DB 커넥션 풀을 잡지 않게 합니다. 실패 시 `restorePreviousStatus`로 상태를 되돌리고, 에러 메시지는 `userFacingFailureMessage`로 SQL/스택트레이스를 마스킹해 사용자에게 내부 구현이 노출되지 않게 합니다.
:::

:::details Q6. 사용자가 분석 결과를 직접 고칠 수 있나요? 그때 JSON은 어떻게 검증하죠?
`reviewCompanyAnalysis`로 필드별 부분 수정이 가능합니다. null로 보내면 기존값을 유지하고, `verified_facts`/`ai_inferences` 같은 JSON 필드는 `BAnalysisJsonValidator`(`validateVerifiedFacts`/`validateAiInferences`)로 키 스키마를 검증한 뒤에만 저장합니다. `confirmed=true`면 `confirmed_at`에 확정 시점을 기록합니다. 즉 자유 입력이 아니라 "정해진 키 구조를 지키는 수정"만 허용합니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제를 이해한 것이다.

1. "검증된 사실 vs AI 추론" 분리가 **데이터 모델·프롬프트·검증** 세 곳에 어떻게 각각 박혀 있는지 한 문장씩.
2. `validateCompanyPayload`의 세 조건과, 검증 실패 시 어디로 떨어지는지(폴백).
3. 외부 웹 검색을 안 하는데도 "최근 이슈"와 신선도를 어떻게 다루는지(`refresh_recommended_at`).
4. LLM 호출과 DB 트랜잭션의 경계를 왜·어떻게 분리했는지.

관련 페이지: [공고문 AI 분석(#6~9)](/area-b/job-analysis) · [데이터 모델](/area-b/data-model) · [구조화 출력 강제](/ai/openai-structured-output) · [영역 B 개요](/area-b/)

## 퀴즈

<QuizBox question="company_analysis 테이블에서 '검증된 사실'과 'AI 추론'을 어떻게 저장하는가?" :choices="['하나의 summary 텍스트 컬럼에 합쳐 저장한다', 'verified_facts와 ai_inferences 두 개의 JSON 컬럼으로 분리 저장한다', '별도 정규화 테이블 두 개로 쪼갠다', '저장하지 않고 매번 재생성한다']" :answer="1" explanation="사실/추론 경계를 데이터 모델에 강제하기 위해 verified_facts([{fact,source}])와 ai_inferences([{inference,basis}])를 별도 JSON 컬럼으로 분리해 저장한다." />

<QuizBox question="기업 현황 요약(#10)의 환각 차단 '3중 방어'에 해당하지 않는 것은?" :choices="['외부 조회 금지를 명문화한 시스템 프롬프트', 'verifiedFacts/aiInferences 형태를 강제하는 JSON Schema', '검증 가능한 사실이 없으면 폴백시키는 validateCompanyPayload', '실시간 뉴스 크롤링으로 사실을 교차검증']" :answer="3" explanation="이 기능은 의도적으로 외부 웹 검색을 하지 않는다. 방어는 프롬프트, JSON Schema, validateCompanyPayload 세 층이며 크롤링은 포함되지 않는다." />

<QuizBox question="refresh_recommended_at 값은 어떻게 결정되는가?" :choices="['외부 API가 회사 뉴스 빈도를 보고 동적으로 정한다', 'checked_at에 30일을 더한 값으로 설정한다', '사용자가 항상 직접 입력한다', '공고 마감일과 동일하게 맞춘다']" :answer="1" explanation="CompanyAnalysisService가 INSERT 시 refreshRecommendedAt = checkedAt.plusDays(30)으로 설정한다. 정보 노후를 추적하는 신선도 신호다." />

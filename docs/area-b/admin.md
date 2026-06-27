# B 관리자 화면 & 운영

> B 영역의 관리자 콘솔은 "생성"이 아니라 **읽기·검수·메타 보정·운영 감사**에 집중한다. AI 산출물은 사용자 파이프라인이 만들고, 관리자는 그 결과의 품질·신선도·실패를 추적하며 좁은 범위로만 손을 댄다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

B 관리자 화면은 **지원 건 · 공고 분석 · 기업 분석 · AI 사용량**을 운영자가 모니터링하고, 정해진 좁은 필드(상태, 운영 메모, 기업 분석 메타데이터)만 보정하는 백오피스다. AI 분석을 새로 돌리는 "생성" 버튼은 없다.

면접에서 이 페이지가 답해야 하는 질문:

- "관리자 화면에서 무엇을 할 수 있고, **무엇을 일부러 못 하게 막았나**?"
- "관리자가 잘못된 분석 결과를 봤을 때 **재분석을 어떻게 트리거**하나? (사실은 직접 못 한다)"
- "프롬프트는 관리자 화면에서 **수정**할 수 있나? (아니다, 읽기 전용 노출이다)"
- "관리자 API의 보안·SQL 인젝션 방어는 어떻게 했나?"

핵심 결론을 미리 못 박으면: **관리자는 운영 가시성(observability) 도구이지 콘텐츠 생성 도구가 아니다.** 이 경계가 B 운영 설계의 의도다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 "관리자는 생성하지 않는다"는 의도적 경계

분석 산출물의 **단일 진실원(single source of truth)은 사용자 측 자동 파이프라인**이다. 공고 추출이 품질 게이트를 통과하면 `ApplicationCaseAutoPipelineService`가 B(공고+기업 분석)·C(적합도)·D(면접 질문)를 한 번에 생성하고, 사용자가 직접 단건 재생성(`POST /job-analysis`, `POST /company-analysis`)도 할 수 있다. 관리자가 별도 경로로 분석을 또 만들면 **"누가 만든 결과가 정답인지"가 흐려지고**, 소유권(사용자 데이터) 경계가 무너진다.

그래서 관리자 컨트롤러에는 `@PostMapping`/`@PutMapping`/`@DeleteMapping`이 사실상 없고, 쓰기는 전부 좁은 `@PatchMapping` 몇 개로 제한된다.

| 관리자가 쓸 수 있는 것 | 관리자가 못 하는 것 (의도적) |
| --- | --- |
| 지원 건 `status` 강제 변경 + 이력 기록 | 분석 신규 생성 / 재분석 트리거 |
| 공고 분석 운영 메모(`admin_memo`) | 분석 본문(스킬/요약/근거) 편집 |
| 기업 분석 운영 메모 | 프롬프트 텍스트 수정 |
| 기업 분석 메타데이터(출처유형·확인일·재조회 권장일) | 공고 원문(`job_posting`) 수정 (불변) |

:::tip 트레이드오프
관리자가 재분석을 못 누르는 건 "불편"이 아니라 "안전"이다. 분석은 비싼 LLM 호출 + 상태머신 전이를 동반하는데, 운영자가 임의로 트리거하면 사용자 케이스의 상태가 꼬일 수 있다. 대신 관리자에게는 **stale 배지·품질 배지·실패 로그** 같은 "신호"를 풍부하게 주고, 실제 재실행은 사용자/파이프라인에 맡긴다.
:::

### 2.2 왜 "검수 메모 + 메타 보정"만 열어줬나

운영 중 정말 필요한 손길은 두 가지다. ① **운영자 코멘트**("이 분석은 공고가 모호해서 수동 확인 필요" 같은 메모)와 ② **정보 신선도 관리**(기업 분석이 언제 확인됐고, 언제 다시 봐야 하는지). 둘 다 *원본 산출물을 바꾸지 않으면서* 운영 맥락만 덧붙이는 작업이라 안전하게 열어줄 수 있다. 메모는 별도 메모 테이블을 만들지 않고 **사용자 도메인 매퍼(`updateAdminMemo`)를 재사용**해 `admin_memo` 컬럼에 직접 쓴다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

### 3.1 백엔드 컨트롤러 (4개 + 프롬프트 노출 1개)

| 콘솔 | 컨트롤러 / 베이스 경로 | 서비스 |
| --- | --- | --- |
| 지원 건 | `AdminApplicationCaseController` · `/api/admin/application-cases` | `AdminApplicationCaseService` |
| 공고 분석 | `AdminJobAnalysisController` · `/api/admin/job-analysis` | `AdminJobAnalysisService` |
| 기업 분석 | `AdminCompanyAnalysisController` · `/api/admin/company-analysis` | `AdminCompanyAnalysisService` |
| AI 사용량(B) | `AdminAiUsageController` · `/api/admin/ai-usage/b` | `AdminAiUsageService` |
| 프롬프트 노출 | `AdminPromptController` · `/api/admin/prompts` | `AdminPromptService` |

각 서비스는 모든 메서드 첫 줄에서 `AdminAccess.requireAdmin(authUser)`를 호출한다. `AdminAccess.isAdmin`은 `role`이 `"ADMIN"` 또는 `"SUPER_ADMIN"`일 때만 통과시키고, 아니면 `ErrorCode.FORBIDDEN`을 던진다. 즉 권한 검사는 URL 시큐리티 외에 **서비스 레이어에서 한 번 더 수동으로** 막는 이중 방어다.

### 3.2 엔드포인트 표 (HTTP 메서드로 "읽기 vs 쓰기"가 한눈에)

| 메서드 | 경로 | 동작 | 쓰기 대상 |
| --- | --- | --- | --- |
| GET | `/admin/application-cases` (+`/summary`, `/{id}`) | 목록·요약·상세 | 없음(읽기) |
| PATCH | `/admin/application-cases/{id}/status` | 상태 강제 변경 + 이력 | `application_case.status` |
| GET | `/admin/job-analysis` (+`/summary`) | 공고 분석 목록·요약 | 없음(읽기) |
| PATCH | `/admin/job-analysis/{analysisId}/memo` | 운영 메모 | `job_analysis.admin_memo` |
| GET | `/admin/company-analysis` (+`/summary`) | 기업 분석 목록·요약 | 없음(읽기) |
| PATCH | `/admin/company-analysis/{analysisId}/memo` | 운영 메모 | `company_analysis.admin_memo` |
| PATCH | `/admin/company-analysis/{analysisId}/metadata` | 출처유형·확인일·재조회권장일 | `company_analysis` 메타 |
| GET | `/admin/ai-usage/b` (+`/b/summary`) | B AI 사용/실패 로그 | 없음(읽기) |
| GET | `/admin/prompts/{job-analysis|company-analysis}` | 프롬프트 **읽기 전용** 조회 | 없음(읽기) |

쓰기 엔드포인트는 단 4개(`status`, jobAnalysis `memo`, companyAnalysis `memo`, companyAnalysis `metadata`)뿐이고, 전부 **PATCH(부분 갱신)**라는 점이 이 콘솔의 성격을 그대로 보여준다.

### 3.3 소유 테이블과 쓰는 컬럼

```text
application_case        → status (강제 변경) + status 전이 이력
application_case_status_history → 변경자/이전상태/이후상태/메모 (감사)
job_analysis            → admin_memo (운영 메모만)
company_analysis        → admin_memo + source_type/checked_at/refresh_recommended_at (메타)
ai_usage_log            → (읽기만, append-only 감사 로그)
```

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 지원 건 상태 강제 변경 (유일하게 루트를 건드리는 쓰기)

`AdminApplicationCaseService.updateStatus`의 흐름:

```text
1) requireAdmin(authUser)                      // 권한
2) findApplicationCase(id)  → 없으면 NOT_FOUND  // 존재 확인 + 이전 상태 확보
3) normalizeStatus(request.status, required=true)
   → DRAFT/ANALYZING/READY/APPLIED/CLOSED 화이트리스트 밖이면 INVALID_INPUT
4) mapper.updateStatus(id, nextStatus)         // 실제 UPDATE
5) insertStatusHistory(id, 변경자, 이전상태, 다음상태, 메모)  // 감사 이력
6) findApplicationCase(id) 재조회 후 반환
```

여기서 핵심은 **3번의 화이트리스트 검증**과 **5번의 이력 기록**이다. 운영자가 임의 문자열을 status로 넣지 못하고, 누가 언제 어떤 상태로 바꿨는지가 `application_case_status_history`에 남는다.

### 4.2 검색·정렬 파라미터의 SQL 인젝션 방어 (관통 패턴)

세 콘솔 모두 정렬·필터 토큰을 **switch 화이트리스트**로만 받는다. 사용자가 보낸 `sort` 문자열을 SQL에 직접 끼우지 않고, 정해진 enum 상수로 매핑한 뒤 매핑 실패면 예외를 던진다.

```java
// AdminJobAnalysisService.normalizeSort (요지)
return switch (compactKey(sort)) {            // 영숫자만 남긴 키
    case "CREATEDATDESC", "CREATEDDESC" -> "CREATED_AT_DESC";
    case "DIFFICULTYDESC"               -> "DIFFICULTY_DESC";
    case "COMPANYNAMEASC", "COMPANYASC" -> "COMPANY_NAME_ASC";
    default -> throw new BusinessException(ErrorCode.INVALID_INPUT, "sort is not allowed.");
};
```

`difficulty`·`sourceType`·`status` 같은 enum 필터도 같은 방식이다(`SOURCE_TYPES = List.of("WEB","JOB_POSTING","MANUAL","API")`처럼 허용 집합 검사). `limit`은 `Math.min(limit, 200)`으로 상한을 박아 과도한 조회를 막는다.

### 4.3 분석 상태 필터 — 운영자가 "빈 분석"을 찾는 법

지원 건 콘솔의 `analysisState` 필터는 자연어 토큰을 정규화해 5개 상태로 환원한다.

| 정규화 결과 | 의미 |
| --- | --- |
| `NO_ANALYSIS` | 공고·기업 분석 모두 없음 |
| `MISSING_JOB_ANALYSIS` | 공고 분석 누락 |
| `MISSING_COMPANY_ANALYSIS` | 기업 분석 누락 |
| `MISSING_ANY_ANALYSIS` | 둘 중 하나라도 누락(=불완전) |
| `COMPLETE_ANALYSIS` | 둘 다 완료 |

운영자가 "분석이 안 만들어진 케이스"를 잡아내는 핵심 도구다. 단, 잡아낸 뒤 **재분석은 콘솔에서 직접 못 누른다** — 이 케이스를 사용자가 다시 돌리거나 파이프라인이 재처리하도록 유도하는 진단용이다.

### 4.4 공고 분석 stale 추적 (재현성 설계가 운영으로 드러나는 지점)

`AdminJobAnalysisRow`에는 `jobPostingRevision`, `latestJobPostingRevision`, `staleAgainstLatestPosting` 필드가 있다. 분석은 **생성 시점의 공고 revision을 동결**해 저장하므로, 그 사이 공고가 새 revision으로 갱신되면 분석이 "옛 원문 기준"임을 매퍼가 비교해 `staleAgainstLatestPosting=true`로 계산한다. 프런트(`AdminJobAnalysisPage`)는 이 값으로 "공고 변경됨" 배지를 띄운다.

### 4.5 기업 분석 메타데이터 보정 — 신선도 운영

`updateMetadata`는 `source_type`(필수, 화이트리스트), `checked_at`, `refresh_recommended_at`을 갱신하되, **명시적 clear 플래그**(`clearCheckedAt`/`clearRefreshRecommendedAt`)로 "값을 비우기"와 "그대로 두기"를 구분한다. null을 보냈을 때 "지우라는 건지 안 건드리는 건지" 모호한 문제를 플래그로 푼 것이다. 프런트는 `datetime-local` 입력을 ISO로 변환해 보낸다.

```text
PATCH /admin/company-analysis/{id}/metadata
{ sourceType:"JOB_POSTING", checkedAt:"...", refreshRecommendedAt:"...",
  clearCheckedAt:false, clearRefreshRecommendedAt:false }
```

### 4.6 프롬프트 운영 — "읽기 전용 카탈로그"

`AdminPromptController`는 `GET /admin/prompts/job-analysis`, `GET /admin/prompts/company-analysis`를 노출한다. 반환 타입 `AdminPromptView`는 `feature/name/version/purpose/systemPrompt/schemaSummary`를 담는다. 그런데 이 데이터의 **출처는 DB가 아니라 코드 상수**다.

```java
// JobAnalysisPromptCatalog
public static final String VERSION = "b-v1";
public static final String SYSTEM_PROMPT = """...""";
public static AdminPromptView view() { return new AdminPromptView(FEATURE, "공고 분석 프롬프트", VERSION, ...); }

// AdminPromptService
public AdminPromptView jobAnalysis(AuthUser u) { requireAdmin(u); return JobAnalysisPromptCatalog.view(); }
```

즉 "프롬프트 운영"은 **현재 프롬프트가 무엇인지 운영자에게 투명하게 보여주는 것**이지, 화면에서 편집·배포하는 기능이 아니다. 프롬프트를 바꾸려면 카탈로그 상수를 수정하고 재배포해야 한다. 두 B 프롬프트의 운영 버전은 모두 코드 기준 `b-v1`이다.

:::warning 인용 주의
스토리보드/데모 캡처에 보이는 `b-v3.2` 같은 버전 문자열은 `VITE_USE_MOCK` 빌드의 목(mock) 값이다. **런타임 정답은 코드 상수 `b-v1`**이다. 면접에서 버전을 말할 땐 `b-v1`을 근거로 든다.
:::

### 4.7 AI 사용량/실패 콘솔

`GET /admin/ai-usage/b`는 `ai_usage_log`를 `featureType`(`JOB_ANALYSIS`/`COMPANY_RESEARCH`/`JOB_POSTING_OCR`/`JOB_POSTING_METADATA`), `status`(SUCCESS/FAILED), model, 케이스/유저로 필터해 보여준다. 여기서 **폴백이 발생한 케이스가 어떻게 보이는지**가 운영적으로 중요하다. 자체 LLM이 실패해 규칙엔진으로 떨어지면 로그에 "LLM 시도(FAILED) + 규칙엔진(SUCCESS)"이 동시에 남고, 자체 LLM 성공 단계는 크레딧 0(`recordLocalSuccess`)으로 무과금 기록된다. 운영자는 이 콘솔로 "어떤 기능에서 폴백이 잦은지", "토큰/크레딧이 어디서 쓰이는지"를 본다.

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 지원 건 목록/요약/상세 + 상태 변경(이력 포함) | **구현** | `AdminApplicationCaseService.updateStatus` + `insertStatusHistory` |
| 공고 분석 목록/요약 + 운영 메모 | **구현** | `AdminJobAnalysisService.updateMemo` |
| 기업 분석 목록/요약 + 메모 + 메타데이터 보정 | **구현** | `AdminCompanyAnalysisService.updateMetadata` |
| stale 배지(공고 revision 비교) | **구현** | `AdminJobAnalysisRow.staleAgainstLatestPosting` |
| `analysisState` 5단계 필터 | **구현** | `normalizeAnalysisState` |
| AI 사용량/실패 콘솔(B) | **구현** | `AdminAiUsageController` `/b`, `/b/summary` |
| 프롬프트 **조회**(읽기 전용) | **구현** | `AdminPromptController` GET 2종, 출처는 코드 상수 |
| 프롬프트 **편집/버전 배포** 화면 | **미구현(의도적)** | 편집 엔드포인트 없음, 프롬프트는 코드 상수(`b-v1`) |
| 관리자발 **재분석 트리거** | **미구현(의도적)** | 관리자 컨트롤러에 분석 생성 POST 없음 |
| 분석 본문(스킬/요약/근거) 관리자 편집 | **미구현(의도적)** | admin 쓰기는 memo/metadata/status로 한정 |
| 공고 원문(`job_posting`) 관리자 수정 | **미구현(불변 설계)** | revision append-only, UPDATE 메서드 없음 |

:::details 흔한 오해 — "관리자가 재분석 버튼을 누른다"
관리자 콘솔에는 재분석 트리거가 없다. 재분석(단건 재생성)은 **사용자 측** `POST /application-cases/{id}/job-analysis` 등으로 이뤄지고, 자동 재처리는 추출 품질 게이트 통과 시 파이프라인이 수행한다. 관리자는 stale 배지·실패 로그로 "재분석이 필요해 보인다"는 신호만 본다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "B 관리자 콘솔은 지원 건·공고 분석·기업 분석·AI 사용량을 모니터링하고, 상태·운영 메모·기업 분석 메타데이터처럼 *원본을 바꾸지 않는* 좁은 필드만 보정하는 백오피스입니다. 분석을 새로 만드는 기능은 일부러 두지 않았습니다."
2. **왜** — "분석 산출물의 진실원은 사용자 자동 파이프라인입니다. 관리자가 별도로 생성하면 소유권·상태가 꼬이므로, 관리자는 *관측(observability)* 역할로 한정하고 쓰기는 PATCH 4개로 제한했습니다."
3. **어떻게** — "권한은 서비스마다 `AdminAccess.requireAdmin`로 ADMIN/SUPER_ADMIN을 이중 검사하고, 정렬·필터는 switch 화이트리스트로 SQL 인젝션을 막고, 상태 변경은 이력 테이블에 감사 로그를 남깁니다. stale 배지·`analysisState` 필터·실패 로그로 운영자에게 신호를 줍니다."

## 7. 꼬리질문 + 모범답안

**Q1. 관리자가 잘못된 공고 분석을 발견하면 직접 고칠 수 있나요?**
A. 본문(스킬/요약/근거)은 못 고칩니다. 관리자가 쓸 수 있는 건 운영 메모(`admin_memo`)뿐입니다. 본문 검수·수정은 사용자 측 `reviewJobAnalysis`/`reviewCompanyAnalysis`(부분 필드 갱신, JSON 키 스키마 검증) 경로의 책임이고, 관리자는 "이 분석 검토 필요" 같은 운영 코멘트만 답니다.

**Q2. 프롬프트를 화면에서 수정해 배포하나요?**
A. 아닙니다. `GET /admin/prompts/job-analysis|company-analysis`는 현재 프롬프트를 **읽기 전용으로 투명하게 노출**할 뿐이고, 데이터 출처는 DB가 아니라 코드 상수(`JobAnalysisPromptCatalog`/`CompanyAnalysisPromptCatalog`, 버전 `b-v1`)입니다. 변경하려면 상수를 수정하고 재배포합니다. 데모에 보이는 `b-v3.2`는 목 값이라 인용하면 안 됩니다.

**Q3. 정렬/필터 파라미터로 SQL 인젝션이 가능한가요?**
A. 불가능하게 설계했습니다. `sort`·`difficulty`·`sourceType`·`status`는 전부 화이트리스트 switch/Set으로만 매핑하고, 매핑 실패면 `INVALID_INPUT`을 던집니다. `limit`도 200으로 상한이 박혀 있어 사용자 입력이 SQL에 직접 들어가지 않습니다.

**Q4. 관리자가 상태를 바꾸면 추적이 되나요?**
A. 됩니다. `updateStatus`는 화이트리스트(DRAFT/ANALYZING/READY/APPLIED/CLOSED) 검증 후 UPDATE하고, 곧바로 `insertStatusHistory`로 변경자·이전 상태·다음 상태·메모를 `application_case_status_history`에 남깁니다. 누가 언제 무엇을 바꿨는지가 감사 가능합니다.

**Q5. 권한 검사는 어디서 하나요? URL 시큐리티만으로 충분하지 않나요?**
A. URL 레벨 SecurityConfig에 더해 **서비스 레이어 진입마다 `AdminAccess.requireAdmin`을 수동 호출**하는 이중 방어입니다. ADMIN과 SUPER_ADMIN을 통과시키고, 더 민감한 운영(권한/정책)은 `requireSuperAdmin`으로 한 단계 더 좁힙니다. 컨트롤러 매핑 실수가 있어도 서비스에서 한 번 더 막힙니다.

**Q6. 기업 분석 메타데이터를 "비우기"와 "안 건드리기"를 어떻게 구분하나요?**
A. null 한 가지로는 둘을 구분할 수 없어, `clearCheckedAt`/`clearRefreshRecommendedAt` 같은 **명시적 clear 불리언 플래그**를 둡니다. 값이 오면 갱신, clear 플래그가 true면 비우기, 둘 다 아니면 기존값 유지로 분기합니다. 이 신선도 메타(`checked_at`/`refresh_recommended_at`)가 운영자가 "재조회 권장" 시점을 관리하는 핵심입니다.

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명해 보라.

- 관리자 콘솔의 **쓰기 엔드포인트 4개**를 대고, 각각 어떤 컬럼을 건드리는지.
- "관리자가 재분석을 못 누른다"는 결정의 **이유**와, 그 대신 운영자에게 주는 **신호**(stale 배지·analysisState·실패 로그).
- 프롬프트 운영이 "읽기 전용"인 이유와, 런타임 버전이 `b-v1`인 근거.
- 정렬/필터에서 **SQL 인젝션을 어떻게 차단**했는지를 코드 패턴(화이트리스트 switch)으로.

## 퀴즈

<QuizBox question="B 관리자 콘솔에서 관리자가 직접 할 수 없는 것은?" :choices="['지원 건 상태 강제 변경', '공고 분석 운영 메모 작성', '공고 분석을 새로 생성(재분석 트리거)', '기업 분석 메타데이터(확인일/재조회권장일) 보정']" :answer="2" explanation="관리자 컨트롤러에는 분석 생성 POST가 없다. 분석의 진실원은 사용자 자동 파이프라인이며, 관리자는 상태·메모·메타데이터 같은 좁은 PATCH 쓰기와 읽기/감사만 한다." />

<QuizBox question="GET /api/admin/prompts/job-analysis 의 성격으로 옳은 것은?" :choices="['DB에서 프롬프트를 읽어 화면에서 편집·배포한다', '코드 상수(b-v1)인 현재 프롬프트를 읽기 전용으로 노출한다', '프롬프트 버전을 b-v3.2로 자동 승급한다', '슈퍼관리자만 호출 가능한 프롬프트 삭제 API다']" :answer="1" explanation="프롬프트는 PromptCatalog의 코드 상수에서 나오며(버전 b-v1), 이 엔드포인트는 운영 투명성을 위한 읽기 전용 조회다. b-v3.2는 mock 데모 값이라 인용 금지." />

<QuizBox question="관리자 검색 API에서 sort/difficulty/sourceType 같은 파라미터의 SQL 인젝션을 막는 방식은?" :choices="['파라미터를 그대로 ORDER BY에 문자열 연결한다', '정규식으로 따옴표만 제거한다', '화이트리스트 switch/Set으로만 허용 토큰에 매핑하고 실패 시 INVALID_INPUT', 'PreparedStatement 없이 이스케이프 함수로 처리한다']" :answer="2" explanation="normalizeSort/normalizeAllowedToken 등이 정해진 상수 집합에만 매핑하고, 매핑 실패하면 BusinessException(INVALID_INPUT)을 던진다. limit도 200으로 상한이 박혀 있다." />

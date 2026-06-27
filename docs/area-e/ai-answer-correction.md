# 면접 답변 AI 첨삭 [#24]

> 면접 질문·내 답변·AI 평가·공고 요구역량을 입력으로 받아, 답변의 구조·근거·STAR 형식·표현을 다듬어 주는 기능. 핵심은 "원문을 날조하지 않고 다듬는" 가드레일과 첨삭 4종을 하나의 도메인으로 통합한 설계다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

면접 답변 첨삭(#24)은 영역 E의 첨삭 4종(면접답변 / 자소서 / 이력서 / 포트폴리오) 중 하나다. 그런데 코드상으로는 4종이 **별도 기능이 아니라 하나의 `correction` 도메인**으로 통합되어 있고, `correctionType` 값(`INTERVIEW_ANSWER` / `SELF_INTRO` / `RESUME` / `PORTFOLIO`)으로만 분기한다. 따라서 "면접 답변 첨삭을 설명하라"는 질문은 실제로는 "통합 첨삭 파이프라인이 어떻게 동작하고, 면접 답변이라는 입력이 그 안에서 어떻게 흐르는가"를 설명하는 것이다.

이 페이지가 답하는 면접 질문:

- "면접 답변 첨삭은 D(면접) 도메인 기능인가요, E(첨삭) 도메인 기능인가요?" — 경계가 교차하는 부분
- "AI가 없는 경험을 지어내서 답변을 부풀이면 어떻게 막나요?" — 가드레일 설계
- "첨삭 4종을 어떻게 하나의 코드로 처리하나요?" — 통합 도메인 트레이드오프
- "AI 호출이 실패하면 사용량 기록은 어떻게 되나요?" — 트랜잭션 분리

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 2-1. 첨삭 4종을 단일 도메인으로 통합

면접답변·자소서·이력서·포트폴리오는 도메인 의미는 다르지만 **입력→AI 호출→구조화 출력→로그→저장이라는 흐름이 완전히 동일**하다. 그래서 모델·서비스·AI 클라이언트를 각각 1개만 두고 `correctionType`으로만 분기한다.

| 선택지 | 장점 | 단점 |
| --- | --- | --- |
| 4종 각각 별도 서비스/클라이언트 | 종류별 커스터마이즈 자유 | 중복 코드 4배, 과금/로그 정책 분산 |
| **단일 도메인 + type 분기 (채택)** | 유지보수·과금 정책 공유(혜택코드 `CORRECTION` 한 풀), 일관성 | 종류별 세밀 분기는 프롬프트로만 가능 |

이는 운영안의 "E 전용 통합 첨삭 모델 1개" 원칙을 코드가 그대로 따른 결과다.

### 2-2. 원문 보존형 개선 (날조 금지)

채용 맥락에서 AI가 없는 성과·수치·회사·프로젝트를 지어내면 곧바로 **허위 기재 리스크**가 된다. 그래서 첨삭은 원문을 덮어쓰지 않고, "근거 없는 강한 문장"은 본문에 넣지 않고 **제안(suggestion)으로만** 분리한다. 시스템 프롬프트에 이 가드레일이 못 박혀 있다(3절).

### 2-3. 첨삭에는 mock/룰베이스 폴백을 두지 않음

다른 영역(예: 적합도 분석, 프로필)에는 OpenAI 키가 없을 때 동작하는 Mock/룰베이스 폴백이 있다. 그러나 correction은 **"사실 생성" 책임이 무거워** 룰베이스 더미 응답이 오히려 위험하다. 그래서 키가 없으면 그냥 실패시키고, 대신 `CorrectionAiClient`를 **향후 자체 LLM 폴백 디스패처가 들어갈 단일 진입점**으로만 준비해 두었다(5절).

### 2-4. 기록과 차감의 분리

AI 사용량 로그(감사 목적)는 **항상 별도 트랜잭션으로** 남기고, 실제 과금(크레딧/사용권 차감)은 그 로그를 단일 근거로 별도 경로에서 처리하도록 설계했다. 그래서 본 트랜잭션이 롤백되어도 "실패했다"는 흔적은 보존된다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

면접 답변 첨삭의 실제 호출 경로는 다음 클래스들로 구성된다.

| 계층 | 클래스 | 역할 |
| --- | --- | --- |
| Controller | `CorrectionController` (`@RequestMapping("/api/corrections")`) | POST `/`(생성), GET `/`(목록 기본 20·최대 100), GET `/{id}`(단건·소유자 한정) |
| Service | `CorrectionService` | 오케스트레이션: 정규화·검증 → AI 호출 → 로그 → 저장 |
| AI 클라이언트 | `CorrectionAiClient` | OpenAI Responses API 호출 + structured output 파싱 + 재시도 |
| 프롬프트 | `CorrectionPromptCatalog` | `VERSION="e-correction-v1"`, 시스템 프롬프트(가드레일) |
| 로그 | `CorrectionAiUsageLogService` | `ai_usage_log` 기록(별도 트랜잭션) |

:::tip 클래스명 주의
설계 문서에 따라 "`CorrectionAiService`"라는 이름으로 불리기도 하지만, 실제 코드에서 OpenAI를 호출하는 클래스는 `CorrectionAiClient`이고, 오케스트레이션은 `CorrectionService`가 담당한다. 면접에서는 실제 클래스명으로 말하는 편이 정확하다.
:::

**입력 DTO** — `CorrectionCreateRequest(correctionType, applicationCaseId, originalText, sourceType, sourceRefId, questionText)`. 어노테이션 검증은 `questionText`의 `@Size(max=1000)`만 걸려 있고, 나머지 검증은 서비스 레이어에서 한다.

**소유권 위임** — `applicationCaseId`가 있으면 E가 직접 판단하지 않고 공통 서비스에 위임한다:

```java
ApplicationCase applicationCase = applicationCaseId == null
        ? null
        : applicationCaseAccessService.requireOwned(userId, applicationCaseId);
```

**저장 테이블** — `correction_request`. 핵심 컬럼: `correction_type`, `source_type`(기본 `DIRECT_INPUT`), `source_ref_id`, `original_text`·`improved_text`(MEDIUMTEXT), **`result_json`**(summary/issues/changeReasons/suggestions를 JSON으로), `status`(기본 `SUCCESS`), `ai_usage_log_id`. FK는 user→CASCADE, application_case→SET NULL, ai_usage_log→SET NULL로 설계되어 **지원 건이 삭제되어도 첨삭 본문은 보존**된다(append-only 불변 설계).

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 면접 답변이 입력으로 들어오는 모양

면접 답변 첨삭의 입력 설계는 D(면접) 도메인에서 나온 재료를 모은다: **질문 텍스트·내 답변·AI 평가 결과·공고 요구역량**. 코드상으로는 이 재료가 `questionText`(질문)와 `originalText`(답변)로 들어오고, 지원 건(`applicationCaseId`)을 통해 회사·직무 맥락이 프롬프트에 붙는다.

```text
사용자 입력
  correctionType = "INTERVIEW_ANSWER"
  questionText   = "React에서 성능 최적화를 어떻게 하시나요?"   (D의 질문)
  originalText   = "useMemo와 useCallback을 사용합니다..."      (내 답변)
  applicationCaseId = 42                                        (회사·직무 맥락)
        │
        ▼  userPrompt() 가 조립
  Correction type / Source type / Company / Job title / Question / Original text
        │
        ▼  OpenAI Responses API (json_schema strict)
  { improvedText, summary, issues[], changeReasons[], suggestions[] }
```

### 4-2. `CorrectionService.create` 의 단계

1. **정규화·검증** — `correctionType` 화이트리스트 위반 시 `INVALID_INPUT`. `originalText` 필수·최대 12000자. `sourceType` 기본 `DIRECT_INPUT`·최대 40자.
2. **featureType 산정** — `"CORRECTION_" + correctionType` → 면접 답변은 `CORRECTION_INTERVIEW_ANSWER`. 이 값이 사용량 로그/과금 정책 매칭 키다.
3. **AI 호출** — `aiClient.correct(...)`. 예외 시 `recordFailure(...)` 후 다시 throw → 실패도 로그에 남는다.
4. **성공 로그** — `recordSuccess(...)` → `aiUsageLogId` 반환.
5. **저장·응답** — `correction_request`에 insert 후 `CorrectionResponse`로 응답.

### 4-3. STAR·구조·근거 개선은 어디서 일어나는가

"STAR 형식으로 다듬는다", "근거를 보강한다"는 별도 알고리즘이 아니라 **프롬프트 + 구조화 출력 스키마**로 달성된다. 시스템 프롬프트가 "한국어 취업 글쓰기 코치"로서 의도를 보존하며 실무용 한국어를 만들라고 지시하고, 출력 스키마가 항상 같은 5개 필드를 강제한다:

| 출력 필드 | 의미 | 면접 답변에서의 역할 |
| --- | --- | --- |
| `improvedText` | 개선된 본문 | STAR·구체성·논리가 보강된 답변 |
| `summary` | 한 줄 요약 | 무엇이 바뀌었는지 개요 |
| `issues[]` | 원답변의 문제점 | "너무 짧고 피상적" 같은 진단 |
| `changeReasons[]` | 변경 이유 | 사용자가 검증·선택 반영하도록 |
| `suggestions[]` | 근거 없이는 못 넣은 보강 제안 | "이런 수치가 있으면 더 강함" |

핵심은 `changeReasons`와 `suggestions`가 분리되어 있다는 점이다. AI가 임의로 수치를 박아 넣는 대신, "근거가 있으면 이렇게 강화하라"는 제안만 던진다.

### 4-4. 구조화 출력 강제

```java
// CorrectionAiClient — Responses API에 json_schema strict 강제
body.put("text", Map.of("format", Map.of(
        "type", "json_schema",
        "strict", true,
        "schema", correctionSchema())));   // 5필드 전부 required + additionalProperties:false
```

`improvedText`가 공백이면 `INTERNAL_ERROR "AI correction result is empty."`로 처리하고, 코드펜스(```` ```json ````)가 섞여 오면 제거한다. 자세한 구조화 출력 원리는 [공통 구조화 출력](/ai/openai-structured-output) 참고.

### 4-5. 재시도와 실패 처리

- 모델 기본 `gpt-5`, timeout 300초(공통 `OpenAiProperties`, E 전용 키가 아니라 공통 OpenAI 설정 공유).
- `MAX_ATTEMPTS=3`, 지수 백오프 `300ms × attempt`.
- 재시도 대상: HTTP 408/409/429/5xx + "timeout"/"temporarily" 메시지. 단 **타임아웃은 재시도 없이 즉시 실패**.
- 키 미설정 시 즉시 `INTERNAL_ERROR "OpenAI API key is not configured."` (폴백 없음).

### 4-6. 사용량 로그의 트랜잭션 분리

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public Long recordSuccess(...) { ... }   // recordFailure 도 동일
```

`REQUIRES_NEW`라서 AI 호출 실패로 본 트랜잭션이 롤백되어도 실패 로그(`status=FAILED`, `credit_used=0`)는 독립 커밋된다. 크레딧 환산식은 `creditUsed = max(1, ceil(totalTokens / 1000.0))` — 1000토큰당 1크레딧, 최소 1. 다만 이 값은 로그에 기록만 되고 실제 차감과는 아직 배선되지 않았다(5절).

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

면접에서 가장 신뢰를 얻는 부분은 "무엇이 안 되어 있는지를 정확히 아는 것"이다.

### 됨 (코드 실재)

- **백엔드 첨삭 파이프라인 전체**: `/api/corrections` POST/GET/단건. OpenAI Responses structured output + 3회 재시도 + 날조 방지 프롬프트 + `result_json` 저장 + 사용량 로그(별도 트랜잭션).
- **소유권 검증 위임**, **append-only 저장**, **실패 로그 보존**.

### 계획·미연결 (근거 있는 갭)

| 갭 | 현재 상태 |
| --- | --- |
| **첨삭 프론트 미연결** | `Correction.tsx`는 정적 플레이스홀더. "첨삭 API 준비 중" 배너, 버튼 전부 disabled, `api()` 호출 0건. 면접 답변 탭의 크레딧 단가(`1`)도 클라이언트 상수로 하드코딩. **백엔드는 실재하므로 프론트만 연결하면 됨.** |
| **과금 미배선** | AI 실행 시 `ai_usage_log`·`correction_request`만 쌓이고 실제 크레딧/사용권은 차감되지 않음. 차감 엔진 자체는 완성·테스트 통과 상태지만 운영 경로에 배선 안 됨. 자세히는 [AI 사용량·크레딧](/ai/ai-usage-credit). |
| **자체 LLM 폴백 미연동** | 설계는 5단 폴백이지만 현 코드는 OpenAI Responses 단일 경로 + 3회 재시도. `CorrectionAiClient`는 폴백 진입점으로만 준비. |
| **출력 계약 격차** | 운영안 JSON(`corrected_text`/`changes`/`risk_flags`/`preserved_meaning`/`added_facts`/`confidence`)과 코드 출력 5필드가 다름. **코드 출력 5필드가 실제 기준**, 운영안 6필드는 설계 목표 계약. |

## 6. D 도메인과의 경계 (면접 답변 첨삭의 특이점)

면접 답변 첨삭은 4종 중 유일하게 **다른 영역(D, 면접)과 경계가 교차**한다. 프론트 코드 주석이 경계를 명시한다(`CorrectionInfoTab.tsx`):

> 면접 답변 첨삭(개선 답변)만 면접 도메인(D) 범위. 자소서/이력서/포트폴리오 첨삭은 첨삭 도메인(correction, E 담당)으로 연결한다.

즉 역할 분담은 이렇다:

- **D(면접)** — 면접 답변 첨삭의 **소개/진입 탭**을 면접 화면 안에 둔다. "원답변 vs AI 개선 답변" 예시를 보여주고 `/correction`으로 보낸다. 실제 첨삭 실행은 하지 않는다.
- **E(첨삭)** — 실제 첨삭 API(`/api/corrections`)와 저장·로그를 책임진다.

면접 답변 첨삭의 입력 재료(질문·답변·평가)는 D에서 나온다. 답변 평가가 어떻게 생성되는지는 [면접 답변 평가](/area-d/answer-evaluation), 면접 도메인 전체는 [영역 D](/area-d/)를 참고.

:::warning 왜 굳이 나눴나
"면접 답변도 첨삭이니 다 E에 두면 되지 않나?"라는 질문이 자연스럽다. 답은 **데이터 소유권**이다. 질문·답변·평가는 면접 세션(D)의 데이터이므로 D가 진입과 맥락을 소유하고, "글을 다듬는다"는 공통 행위만 E의 통합 첨삭 파이프라인으로 위임한다. 덕분에 E는 4종을 동일 코드로 처리하고, D는 자기 세션 데이터의 소유권을 유지한다.
:::

## 7. 면접 답변 3단계

면접에서 이 주제가 나오면 다음 3단계로 답하면 막힘이 없다.

1. **무엇** — "면접 답변 첨삭은 질문·내 답변·AI 평가·공고 요구역량을 받아 답변의 구조·근거·STAR·표현을 개선합니다. 코드상으로는 자소서·이력서·포트폴리오 첨삭과 함께 단일 `correction` 도메인으로 통합되어 있고, `correctionType`이 `INTERVIEW_ANSWER`인 경우입니다."
2. **어떻게** — "흐름은 `CorrectionController` → `CorrectionService`(정규화·검증·로그·저장) → `CorrectionAiClient`(OpenAI Responses, json_schema strict)입니다. 출력은 항상 improvedText·summary·issues·changeReasons·suggestions 5필드로 강제되고, `correction_request` 테이블에 append-only로 저장됩니다."
3. **왜·한계** — "핵심 설계 의도는 날조 방지입니다. 시스템 프롬프트로 없는 성과를 못 만들게 하고, 근거 없는 강화는 본문이 아니라 suggestions로만 분리합니다. 다만 현재는 프론트가 플레이스홀더라 백엔드 API와 미연결이고, 크레딧 실차감도 아직 배선 전입니다. 차감 엔진 자체는 완성·테스트는 통과한 상태입니다."

## 8. 꼬리질문 + 모범답안

::: details Q1. 면접 답변 첨삭은 D 기능인가요 E 기능인가요?
실행은 E(첨삭 도메인)입니다. D(면접)는 면접 화면 안에 "원답변 vs 개선 답변" 소개 탭만 두고 `/correction`으로 위임합니다. 입력 재료(질문·답변·평가)는 D 데이터지만, "글을 다듬는" 공통 행위는 E의 통합 첨삭 파이프라인이 처리합니다. 코드 주석에도 "면접 답변 첨삭만 D 범위, 나머지 3종은 E로 연결"이라고 명시돼 있습니다.
:::

::: details Q2. AI가 없는 경험·수치를 지어내는 건 어떻게 막나요?
두 가지 장치입니다. 첫째, 시스템 프롬프트(`CorrectionPromptCatalog`)에 "achievements, metrics, employers, projects, experiences를 invent하지 말라"고 명시합니다. 둘째, 출력 스키마에서 `changeReasons`(실제 변경 이유)와 `suggestions`(근거 있으면 강화하라는 제안)를 분리합니다. 근거가 없는 강화는 본문(`improvedText`)에 들어가지 못하고 제안으로만 남습니다. 사용자가 검증 후 직접 반영하는 구조라 허위 기재 리스크를 낮춥니다.
:::

::: details Q3. 첨삭 4종을 어떻게 하나의 코드로 처리하나요? 단점은요?
입력→AI→구조화출력→로그→저장 흐름이 4종 모두 동일하기 때문에 모델·서비스·클라이언트를 1개만 두고 `correctionType`으로만 분기합니다. featureType은 `"CORRECTION_" + type`으로 생성되고, 과금 혜택코드는 4종이 `CORRECTION` 한 풀을 공유합니다. 단점은 종류별 세밀한 차이를 코드 분기가 아니라 프롬프트로만 표현해야 한다는 점입니다. 현재는 프롬프트가 4종 공통이라 종류별 특화가 약한 편입니다.
:::

::: details Q4. AI 호출이 실패하면 사용량 로그는 어떻게 되나요?
`CorrectionService.create`가 `aiClient.correct`를 try로 감싸고, 예외가 나면 `recordFailure(...)`로 실패 로그를 남긴 뒤 다시 throw합니다. 이 로그 메서드는 `@Transactional(propagation = REQUIRES_NEW)`라서 본 트랜잭션이 롤백되어도 실패 로그(`status=FAILED`, `credit_used=0`)는 독립적으로 커밋됩니다. 감사·추적을 위해 실패도 흔적을 남긴다는 설계입니다.
:::

::: details Q5. 왜 다른 영역과 달리 첨삭에는 mock 폴백이 없나요?
correction은 "사실을 생성하는" 책임이 무겁기 때문입니다. 적합도 분석 같은 기능은 룰베이스 더미 응답이 그럴듯하게 동작할 수 있지만, 첨삭에서 룰베이스 더미가 잘못된 표현을 만들면 사용자가 그대로 지원서에 쓸 위험이 있습니다. 그래서 키가 없으면 그냥 실패시키고, 대신 `CorrectionAiClient`를 향후 자체 LLM 폴백 디스패처가 들어갈 단일 진입점으로 설계해 두었습니다.
:::

::: details Q6. AI 호출은 3번 재시도하는데, 왜 타임아웃은 재시도하지 않나요?
타임아웃은 모델이 응답을 만드는 데 300초를 다 썼다는 뜻이라, 재시도해도 같은 무거운 요청이 또 타임아웃될 가능성이 높고 사용자 대기만 길어집니다. 그래서 408/409/429/5xx 같은 일시적 오류는 지수 백오프로 재시도하되, 타임아웃은 즉시 실패로 처리합니다. 참고로 결제(Toss) 쪽은 정반대로 멱등성을 위해 아예 재시도를 배제하는데, 두 클라이언트의 재시도 정책이 반대인 건 각 작업의 멱등성 성격이 다르기 때문입니다.
:::

## 9. 직접 말해보기

아래 질문에 소리 내어 답해 보고, 막히는 지점을 위 섹션에서 다시 확인하라.

- 면접 답변 첨삭의 호출 경로를 컨트롤러부터 테이블까지 한 문장으로 말해 보라.
- `changeReasons`와 `suggestions`를 분리한 이유를 30초로 설명해 보라.
- "면접 답변 첨삭은 D인가 E인가"에 대해, 소유권 관점으로 답해 보라.
- 현재 구현에서 "안 되어 있는 것" 3가지를 근거와 함께 말해 보라.

## 퀴즈

<QuizBox question="면접 답변 첨삭(#24)의 실제 코드 구조로 옳은 것은?" :choices="['면접답변 전용 모델·서비스·클라이언트가 독립적으로 존재한다', '자소서/이력서/포트폴리오 첨삭과 함께 단일 correction 도메인으로 통합되고 correctionType으로 분기한다', '면접 도메인(D)이 첨삭 API를 직접 호출해 처리한다', '크레딧 차감 후에만 AI를 호출하는 선결제 구조다']" :answer="1" explanation="첨삭 4종은 입력→AI→출력→로그→저장 흐름이 동일하여 단일 correction 도메인 + 단일 CorrectionAiClient로 통합되고, correctionType(INTERVIEW_ANSWER 등)으로만 분기합니다." />

<QuizBox question="AI가 없는 성과·수치를 본문에 지어내지 못하게 하는 설계로 옳은 것은?" :choices="['출력에서 changeReasons와 suggestions를 분리해 근거 없는 강화는 제안으로만 남긴다', 'improvedText를 사용자가 입력한 원문으로 그대로 되돌린다', 'AI 응답을 정규식으로 검사해 숫자를 모두 제거한다', '관리자가 모든 첨삭 결과를 수동 승인한다']" :answer="0" explanation="시스템 프롬프트로 날조를 금지하고, 출력 스키마에서 실제 변경 이유(changeReasons)와 근거 있을 때의 강화 제안(suggestions)을 분리해 근거 없는 강화는 본문에 들어가지 못하게 합니다." />

<QuizBox question="AI 사용량 로그(recordSuccess/recordFailure)에 @Transactional(propagation = REQUIRES_NEW)를 쓴 이유는?" :choices="['로그 저장 속도를 높이기 위해', '본 트랜잭션이 롤백돼도 사용량/실패 흔적을 독립 커밋으로 보존하기 위해', '여러 사용자의 로그를 한 트랜잭션에 모으기 위해', '크레딧을 즉시 차감하기 위해']" :answer="1" explanation="REQUIRES_NEW로 별도 트랜잭션을 열어, AI 호출 실패로 본 트랜잭션이 롤백되어도 실패 로그(status=FAILED, credit_used=0)가 독립적으로 커밋되어 감사·추적이 보존됩니다." />

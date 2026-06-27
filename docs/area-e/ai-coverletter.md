# 자기소개서 AI 첨삭 [#25]

> 사용자가 쓴 자기소개서 원문을, A 영역의 키워드와 지원 건(공고) 맥락에 맞춰 **문장 흐름 · 직무 연관성 · 강점 표현 · 중복 제거** 관점으로 다듬는다. 핵심은 "원문을 덮어쓰지 않고, 근거 없는 성과를 날조하지 않으며, 변경 이유까지 함께 돌려준다"는 것 — 이걸 단일 `correction` 도메인 + OpenAI 구조화 출력으로 구현했다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

자기소개서 첨삭(#25)은 AI 기능 #24~27 중 하나로, **별도 모델이 아니라 첨삭 4종이 공유하는 단일 도메인**에서 `correctionType=SELF_INTRO`로만 분기되어 처리된다. 입력은 자소서 원문, 지원 건(회사·직무) 맥락, 문항 텍스트이고, 출력은 개선된 글과 그 글을 그렇게 고친 **이유·이슈·추가 제안**이다.

이 페이지가 막힘없이 답하게 하려는 면접 질문:

- "자소서 첨삭을 면접답변/이력서/포트폴리오 첨삭과 어떻게 구분했나요? 모델이 4개인가요?"
- "AI가 없는 경력을 지어내면 어쩌죠? 어떻게 막았나요?"
- "원문을 AI가 통째로 바꿔버리면 사용자가 검증을 못 하잖아요. 어떻게 설계했나요?"
- "자소서 첨삭에 A(프로필) 데이터를 쓴다는데, 데이터 경계는 어떻게 잡았나요?"

:::tip 한 문장 요약
"자소서 첨삭은 4종 통합 `correction` 도메인의 한 분기로, OpenAI Responses의 `json_schema strict` 출력으로 개선문과 변경 이유를 함께 받아 `correction_request`에 append-only로 저장한다. 시스템 프롬프트가 허위 사실 생성을 막고, 원문은 절대 덮어쓰지 않는다."
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2-1. 첨삭 4종을 모델 1개로 합친 이유

면접답변(#24)·자소서(#25)·이력서(#26)·포트폴리오(#27)는 **입력 형태·출력 형태·검증 규칙·과금 흐름이 거의 동일**하다. 전부 "사용자가 쓴 한국어 글을 직무 맥락에 맞춰 다듬어 달라"는 같은 작업이다. 그래서 모델·서비스·AI 클라이언트를 종류별로 4개 만들지 않고, 하나의 `correction` 도메인에서 `correctionType` enum(`SELF_INTRO` / `INTERVIEW_ANSWER` / `RESUME` / `PORTFOLIO`)으로만 분기했다.

| 선택지 | 장점 | 단점 | 채택 |
| --- | --- | --- | --- |
| 종류별 모델·서비스 4벌 | 종류별 커스터마이즈 자유도 높음 | 중복 코드 4배, 과금 정책 분산, 유지보수 부담 | ✗ |
| 단일 도메인 + 타입 분기 | 코드·과금·프롬프트 한 곳, 일관성 | 종류별 세밀한 분기는 프롬프트·featureType에 의존 | ✓ |

이 일관성 덕분에 자소서 첨삭은 **혜택 풀(`benefit_code=CORRECTION`)을 다른 3종과 공유**하고, 사용량 로그도 같은 테이블에 같은 모양으로 쌓인다.

### 2-2. 원문 보존 + 허위사실 방지 (가장 중요한 제품 결정)

자소서 첨삭의 가장 큰 리스크는 **AI가 없는 성과·경력·수치를 지어내는 것**이다. "매출 200% 성장" 같은 거짓을 자소서에 넣으면 채용 사기가 되고, 사용자에게 실질적 위험이 된다. 그래서 두 가지 가드레일을 걸었다.

1. **시스템 프롬프트에 명시적 금지** — `CorrectionPromptCatalog.SYSTEM_PROMPT`:
   - "Improve only the user's existing material" (기존 자료만 개선)
   - "Do not invent achievements, metrics, employers, projects, or experiences" (성과·수치·회사·프로젝트·경험 날조 금지)
   - "If a stronger sentence needs missing evidence, keep it as a suggestion" (근거 없으면 본문이 아니라 **제안**으로만)
2. **변경 이유를 별도 필드로 반환** — 개선문(`improvedText`)을 사용자가 그냥 받아쓰는 게 아니라, `changeReasons`(왜 고쳤는지)와 `suggestions`(추가로 보강하면 좋을 것)를 함께 줘서 **사용자가 검증 후 선택 반영**하게 한다. 원문(`originalText`)은 결과 행에 그대로 보존된다.

### 2-3. 트레이드오프: mock 폴백을 일부러 두지 않음

타 영역(적합도·프로필 분석)에는 OpenAI 키가 없을 때 룰베이스/Mock 더미 응답으로 폴백하는 경로가 있다. 그러나 **첨삭에는 의도적으로 mock 폴백을 두지 않았다.** 자소서 첨삭은 "사실에 가까운 글을 생성"하는 책임이 무겁기 때문에, 룰베이스 더미 응답이 오히려 위험하다(엉뚱한 개선문이 진짜처럼 보일 수 있음). 키가 없으면 그냥 `INTERNAL_ERROR "OpenAI API key is not configured."`로 멈춘다. 대신 `CorrectionAiClient`를 **향후 자체 LLM 폴백 디스패처가 들어갈 단일 진입점**으로 설계해 뒀다([자체 LLM 전략](/ai/self-llm-strategy) 참고).

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

### 3-1. 백엔드 4계층 (controller → service → ai → mapper → domain)

| 계층 | 클래스 | 역할 |
| --- | --- | --- |
| Controller | `CorrectionController` (`@RequestMapping("/api/corrections")`) | POST `/`(생성), GET `/`(목록 기본20·최대100), GET `/{id}`(소유자 단건) |
| DTO | `CorrectionCreateRequest` | `correctionType, applicationCaseId, originalText, sourceType, sourceRefId, questionText` — `questionText`만 `@Size(max=1000)` |
| Service | `CorrectionService.create` | 정규화·검증 → AI 호출 → 사용량 로그 → 저장 오케스트레이션 |
| AI Client | `CorrectionAiClient.correct` | OpenAI Responses 호출 + `json_schema strict` 파싱 + 3회 재시도 |
| Prompt | `CorrectionPromptCatalog` | `VERSION="e-correction-v1"`, `SYSTEM_PROMPT`(허위사실 방지 가드레일) |
| Log | `CorrectionAiUsageLogService` | 사용량 로그 기록 (별도 트랜잭션) |
| Mapper/Domain | `CorrectionMapper` / `CorrectionRequest` | `correction_request` 테이블 INSERT/조회 |

자소서 첨삭이라고 별도 컨트롤러·서비스가 있는 게 아니라, **위 클래스들이 `correctionType=SELF_INTRO`로 호출될 뿐**이다.

### 3-2. AI 호출 — OpenAI Responses 구조화 출력

`CorrectionAiClient`는 공통 `OpenAiProperties`(`careertuner.openai`, 모델 기본 `gpt-5`, timeout 300초)를 **재사용**한다. E 전용 키가 아니라 전사 공통 OpenAI 설정을 공유한다.

출력은 항상 같은 모양이도록 `json_schema` + `strict:true`로 강제한다. 스키마(`correctionSchema()`)는 5개 필드 전부 `required` + `additionalProperties:false`:

```text
{
  improvedText:   string   // 개선된 자소서 본문 (= 운영안 계약의 corrected_text)
  summary:        string   // 무엇을 어떻게 바꿨는지 요약
  issues:         string[] // 원문에서 발견한 문제점 (예: 중복 문장, 직무 무관 서술)
  changeReasons:  string[] // 각 변경의 근거 (= 운영안 계약의 changes)
  suggestions:    string[] // 근거가 없어 본문엔 못 넣은 보강 제안
}
```

이 구조화 출력 메커니즘 자체는 [공통 구조화 출력](/ai/openai-structured-output)과 같은 원리다. `improvedText`가 공백이면 `INTERNAL_ERROR "AI correction result is empty."`로 막고, 모델이 실수로 ```` ```json ````코드펜스를 붙여도 제거하고 파싱한다.

### 3-3. 자소서 맥락 주입 — A 데이터와의 경계

자소서 첨삭의 핵심은 **"A의 자소서 원문 + 키워드 + 지원 건(공고) 맥락"을 함께 넣는 것**이다. `CorrectionAiClient.userPrompt(command)`가 사용자 프롬프트를 조립하는데, 지원 건이 선택돼 있으면 회사명·직무명을 맥락으로 넣는다(추상화):

```text
Correction type: SELF_INTRO
Source type: DIRECT_INPUT

Application context:
Company: (지원 건의 회사명)
Job title: (지원 건의 직무명)

Question or prompt:
(자소서 문항 텍스트)

Original text:
(사용자 자소서 원문)
```

여기서 **데이터 경계가 중요**하다. 자소서 원문은 A 영역(프로필/자소서) 소유 데이터지만, 첨삭은 이를 **참조만** 하고 확정 반영하지 않는다 — 원문을 덮어쓰지 않는다. 지원 건(`applicationCaseId`)이 있으면 E가 소유권을 직접 판단하지 않고 공통 서비스 `applicationCaseAccessService.requireOwned(userId, id)`에 위임해 검증한다.

### 3-4. 저장 테이블 — `correction_request` (append-only)

| 컬럼 | 자소서 첨삭에서의 값 |
| --- | --- |
| `correction_type` | `SELF_INTRO` |
| `source_type` | 기본 `DIRECT_INPUT` (최대 40자) |
| `source_ref_id` | 원본 자소서 참조 id(선택) |
| `original_text` | 자소서 원문 (MEDIUMTEXT, **최대 12000자**) |
| `improved_text` | 개선문 (MEDIUMTEXT) |
| `result_json` | `summary/issues/changeReasons/suggestions`를 JSON으로 |
| `status` | 기본 `SUCCESS` |
| `ai_usage_log_id` | 사용량 로그 FK (`ON DELETE SET NULL`) |

FK는 `user→CASCADE`, `application_case→SET NULL`, `ai_usage_log→SET NULL`. 지원 건이 삭제돼도 첨삭 본문은 남는다(SET NULL). 그리고 **재첨삭할 때마다 새 행이 INSERT**되는 append-only 구조라, 첨삭 이력이 덮어써지지 않고 누적된다(MyBatis 기반, [MyBatis 설명](/backend/mybatis)).

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 자소서 첨삭 한 번의 전체 흐름

```text
POST /api/corrections  { correctionType:"SELF_INTRO", originalText, applicationCaseId, questionText }
        │
        ▼
CorrectionService.create
  1) 정규화·검증  correctionType 화이트리스트 / originalText 필수·≤12000자 / sourceType 기본 DIRECT_INPUT
  2) 소유권 검증  applicationCaseId 있으면 requireOwned (타 영역 공통 서비스에 위임)
  3) featureType  "CORRECTION_" + "SELF_INTRO" = "CORRECTION_SELF_INTRO"
  4) AI 호출      aiClient.correct(...)  ── 실패 시 recordFailure 후 재throw
  5) 사용량 로그  recordSuccess(...) → aiUsageLogId
  6) 저장         correction_request INSERT (original/improved/result_json)
        │
        ▼
CorrectionResponse { improvedText, summary, issues[], changeReasons[], suggestions[] }
```

`featureType`은 `CORRECTION_SELF_INTRO`가 되어 사용량 로그와 과금 정책(`ai_feature_benefit_policy`)의 매칭 키로 쓰인다.

### 4-2. 기록과 차감의 분리 (별도 트랜잭션)

사용량 로그를 남기는 `CorrectionAiUsageLogService`는 `@Transactional(propagation = REQUIRES_NEW)`다. 핵심 의도:

- AI 호출이 실패해 **본 트랜잭션이 롤백돼도, 실패 로그(`status=FAILED, credit_used=0`)는 독립 커밋**된다 → 감사 추적·사용 흔적 보존.
- 크레딧 환산식은 `creditUsed = max(1, ceil(totalTokens/1000.0))` (1000토큰당 1크레딧, 최소 1). 단 이 값은 `ai_usage_log.credit_used`에 **기록만 되고 실제 차감으로 연결되지 않는다**(5절 참조).

### 4-3. 재시도 정책

AI 호출은 일시적 오류에 강하도록 `MAX_ATTEMPTS=3`, 지수 백오프(`300ms*attempt`)로 재시도한다. 재시도 대상은 HTTP 408/409/429/5xx + "timeout"/"temporarily" 메시지. 단 **타임아웃은 재시도 없이 즉시 실패**(중복 호출 방지). 결제(`TossPaymentClient`)가 멱등성 때문에 재시도를 일부러 배제하는 것과 정반대인데, 이는 [작업의 멱등성 성격이 다르기 때문](/area-e/payment-flow)이다.

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

면접에서 가장 위험한 건 "다 됐다"고 말했다가 꼬리질문에 무너지는 것이다. 자소서 첨삭의 실제 상태:

:::warning 정직하게 구분할 것
**백엔드는 실재, 프론트는 정적 플레이스홀더, 과금은 미배선.**
:::

### ✅ 구현 완료 (코드 실재)

- **백엔드 `/api/corrections`** — 자소서 첨삭 생성/목록/단건 조회가 실제로 동작. OpenAI Responses 구조화 출력 + 3회 재시도 + 허위사실 방지 프롬프트 + `result_json` 저장 + 사용량 로그(별도 트랜잭션).
- **append-only `correction_request`** — 재첨삭 시 새 행, 원문 보존.

### ⚠️ 계획 / 미연결 (근거 있는 갭)

1. **프론트는 정적 샘플** — `Correction.tsx`의 "자기소개서 첨삭" 탭은 `api()` 호출이 **0건**이다. 상단에 "첨삭 API 준비 중 / 현재 화면은 입력 흐름 샘플입니다" 배너가 떠 있고, 버튼 3개(`준비 중`/`지원 건 연결`/`임시 저장`)는 모두 `disabled`다. 최근 기록은 `샘플 ·` prefix가 붙은 더미 3건. **백엔드는 실재하지만 프론트만 미연결**이다.
2. **크레딧 단가가 클라 하드코딩** — 자소서 탭 Badge의 "2 크레딧"은 `correctionMeta` 상수에 박힌 값이지 서버 정책과 동기화된 값이 아니다.
3. **AI 실행 ↔ 과금 미배선** — 차감 엔진(`AiChargeService.charge` 등)은 완성·테스트 통과지만 **운영 코드 어디서도 호출되지 않는다**(테스트 코드에만 호출처 존재). 자소서 첨삭을 실행해도 `ai_usage_log`와 `correction_request`만 쌓이고 `users.credit`은 **차감되지 않는다**([크레딧 시스템](/area-e/credit-system) 참고).
4. **자체 LLM 폴백 미연동** — 설계는 자체 파인튜닝 모델 + 규칙엔진 + OpenAI의 다단 폴백이나, 현 코드는 **OpenAI Responses 단일 경로 + 3회 재시도**다. `CorrectionAiClient`는 폴백 진입점으로만 준비돼 있다.
5. **출력 필드 계약 불일치** — 운영안의 JSON 계약(`corrected_text/changes/risk_flags/...`)과 실제 코드 출력 5필드(`improvedText/summary/issues/changeReasons/suggestions`)가 다르다. **코드 출력이 사실**이고, 운영안 6필드는 설계 목표 계약으로만 봐야 한다.

## 6. 면접 답변 3단계

**1단계 (한 줄):**
"자소서 첨삭은 면접답변·이력서·포트폴리오 첨삭과 통합된 단일 `correction` 도메인의 한 분기예요. `correctionType=SELF_INTRO`로만 구분되고, OpenAI Responses의 구조화 출력으로 개선문과 변경 이유를 함께 받습니다."

**2단계 (왜·어떻게):**
"입력은 자소서 원문 + 지원 건(회사·직무) 맥락 + 문항이고, 출력은 개선문·요약·이슈·변경이유·제안 5필드를 `json_schema strict`로 강제합니다. 가장 신경 쓴 건 허위사실 방지인데, 시스템 프롬프트에서 성과·수치·경력 날조를 금지하고, 근거 없는 개선은 본문이 아니라 `suggestions`로만 돌려줘서 사용자가 검증 후 선택 반영하게 했어요. 원문은 덮어쓰지 않고 `correction_request`에 append-only로 보존합니다."

**3단계 (한계 정직):**
"다만 백엔드는 실재하지만 프론트 화면은 아직 정적 플레이스홀더라 API 미연결 상태이고, AI 실행과 실제 크레딧 차감도 아직 배선이 안 됐습니다. 차감 엔진과 사용량 로그는 완성돼 있어서, 첨삭 실행 경로에 `AiChargeService` 호출만 끼우면 연결되는 구조입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 자소서·이력서·포트폴리오 첨삭이 모델이 다 따로인가요?
아니요. 네 종류가 입력·출력·검증·과금 흐름이 거의 같아서 **단일 `correction` 도메인 + 단일 AI 클라이언트**로 처리하고 `correctionType` enum으로만 분기합니다. 자소서는 `SELF_INTRO`, 그에 따라 `featureType`이 `CORRECTION_SELF_INTRO`가 되어 사용량 로그와 과금 정책 키로 쓰입니다. 종류별로 코드를 4벌 만들면 중복·정책 분산 비용이 커지기 때문에 의도적으로 합쳤습니다.
:::

:::details Q2. AI가 없는 경력이나 수치를 지어내면 어떻게 막나요?
두 겹으로 막습니다. (1) 시스템 프롬프트에 "기존 자료만 개선, 성과·수치·회사·프로젝트·경험을 날조하지 말 것, 근거가 부족하면 본문 대신 제안으로만"이라고 명시했습니다. (2) 출력 스키마를 `improvedText`(개선 본문)와 `suggestions`(보강 제안)로 분리해서, 근거 없는 강화는 본문에 못 들어가고 제안으로만 나옵니다. 게다가 `changeReasons`로 "왜 고쳤는지"를 함께 줘서 사용자가 검증하고 선택 반영하게 합니다.
:::

:::details Q3. 자소서 원문은 A 영역 데이터인데, 첨삭이 그걸 마음대로 고치나요?
아닙니다. 첨삭은 A의 자소서 원문을 **참조만** 하고 확정 반영하지 않습니다 — 원문을 덮어쓰지 않아요. 첨삭 결과는 별도 테이블 `correction_request`에 새 행으로 저장되고, 반영 여부는 사용자 선택입니다. 또 지원 건 소유권은 E가 직접 판단하지 않고 공통 서비스 `applicationCaseAccessService.requireOwned`에 위임해서 영역 경계를 지킵니다.
:::

:::details Q4. 첨삭이 실패하면 사용량 로그는 어떻게 되나요?
실패도 기록합니다. `CorrectionAiUsageLogService.recordFailure`가 `@Transactional(REQUIRES_NEW)`라서, AI 호출 실패로 본 트랜잭션이 롤백돼도 실패 로그(`status=FAILED, credit_used=0`)는 별도 트랜잭션으로 독립 커밋됩니다. 감사 추적과 사용 흔적을 보존하려는 의도이고, 실패한 호출은 크레딧 0으로 기록해 무료 처리 원칙을 명확히 합니다.
:::

:::details Q5. 출력이 항상 같은 JSON 모양이라는 보장은요?
OpenAI Responses에 `text.format.type="json_schema"`, `strict:true`로 스키마를 같이 보냅니다. 5개 필드 전부 `required`에 `additionalProperties:false`라서 모델이 필드를 빠뜨리거나 즉흥적으로 추가하지 못합니다. 그래도 방어적으로, `improvedText`가 공백이면 에러로 막고, 모델이 코드펜스를 붙여 보내도 제거하고 파싱합니다.
:::

:::details Q6. 그럼 지금 자소서 첨삭을 화면에서 실제로 쓸 수 있나요?
백엔드 `/api/corrections`는 실제로 동작합니다(curl/Postman으로 호출하면 결과가 나옵니다). 하지만 프론트 `Correction.tsx`의 자소서 탭은 아직 정적 플레이스홀더라 API를 호출하지 않습니다 — "첨삭 API 준비 중" 배너가 떠 있고 버튼이 disabled입니다. 그리고 실행과 크레딧 차감도 아직 배선되지 않아서, 첨삭을 돌려도 크레딧이 깎이지 않습니다. 차감 엔진 자체는 완성·테스트 통과 상태라 호출 지점만 연결하면 됩니다.
:::

## 8. 직접 말해보기

아래를 보지 않고 소리 내어 설명해 보라:

1. 자소서 첨삭이 나머지 3종 첨삭과 **무엇을 공유하고 무엇으로 분기**되는지 (도메인·`correctionType`·`featureType`).
2. AI가 경력을 지어내는 걸 막는 **두 가지 장치** (시스템 프롬프트 금지 + `improvedText`/`suggestions` 분리).
3. 입력 프롬프트에 들어가는 **세 가지 맥락** (원문 · 지원 건 회사/직무 · 문항).
4. 출력 5필드 이름과 각각의 의미.
5. "구현됨/안 됨"의 솔직한 경계 — 백엔드는 실재, 프론트는 정적, 과금은 미배선.

## 퀴즈

<QuizBox question="자기소개서 첨삭(#25)은 코드상 어떻게 구현되어 있나?" :choices="['전용 자소서 모델·서비스·클라이언트 세트로 분리 구현', '단일 correction 도메인에서 correctionType=SELF_INTRO 분기로 처리', 'A 영역(프로필) 서비스 안에 자소서 첨삭 로직이 포함됨', '프론트에서 OpenAI를 직접 호출']" :answer="1" explanation="첨삭 4종은 입력·출력·검증·과금 흐름이 동일하므로 단일 correction 도메인 + 단일 AI 클라이언트로 처리하고, correctionType enum(SELF_INTRO 등)으로만 분기한다. featureType은 'CORRECTION_' + correctionType이 된다." />

<QuizBox question="첨삭이 사용자의 없는 경력·수치를 날조하지 않도록 하는 설계는?" :choices="['모델을 매번 파인튜닝한다', '시스템 프롬프트로 날조를 금지하고, 근거 없는 강화는 본문(improvedText)이 아니라 suggestions로만 반환한다', '결과를 사람이 일일이 검수한 뒤 저장한다', 'originalText를 improvedText로 즉시 덮어쓴다']" :answer="1" explanation="CorrectionPromptCatalog.SYSTEM_PROMPT가 성과·수치·경력 날조를 금지하고, 근거가 부족한 개선은 본문이 아니라 suggestions/changeReasons로 분리해 사용자가 검증 후 선택 반영하게 한다. 원문은 절대 덮어쓰지 않는다." />

<QuizBox question="자소서 첨삭의 현재 구현 상태로 옳은 것은?" :choices="['백엔드·프론트·과금 차감까지 전부 완전 연동됨', '백엔드 /api/corrections는 실재하지만, 프론트 화면은 정적 플레이스홀더이고 실제 크레딧 차감은 미배선', '백엔드가 아직 없고 프론트만 mock으로 동작', '자체 LLM 5단 폴백이 운영에 연결되어 OpenAI를 거치지 않음']" :answer="1" explanation="백엔드 첨삭 API는 OpenAI 구조화 출력으로 실제 동작하지만, Correction.tsx는 api() 호출 0건의 정적 샘플이고, AiChargeService 등 차감 엔진은 완성·테스트 통과 상태이나 운영 경로에 배선되지 않아 크레딧이 차감되지 않는다. 현 코드는 OpenAI 단일 경로 + 3회 재시도다." />

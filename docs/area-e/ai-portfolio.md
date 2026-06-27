# 포트폴리오 설명 AI 개선 [#27]

> 포트폴리오의 "프로젝트 배경 · 내 역할 · 기술 선택 이유 · 문제 해결 · 결과"를 지원 직무 시선에 맞춰 다시 쓰는 첨삭 기능. 별도 모델이 아니라 첨삭 4종을 통합한 `correction` 도메인의 한 분기(`correctionType=PORTFOLIO`)다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

포트폴리오 설명 개선(#27)은 사용자가 직접 쓴 포트폴리오/프로젝트 설명 원문을 입력받아, **사실을 날조하지 않으면서** 채용 담당자가 읽기 좋은 형태(프로젝트 배경 → 내 역할 → 기술 선택 이유 → 문제 해결 과정 → 정량 결과)로 다듬어 개선안과 변경 근거를 돌려주는 AI 기능이다.

이 페이지는 면접에서 이런 질문에 답하기 위한 것이다.

- "포트폴리오 첨삭은 자소서/이력서 첨삭과 뭐가 다른가요? 모델을 4개 만들었나요?"
- "AI가 없는 성과를 지어내지 않게 어떻게 막았나요?"
- "포트폴리오 설명 같은 자유 텍스트에서 출력 형태가 깨지지 않게 어떻게 보장하나요?"
- "이 기능을 쓰면 크레딧이 깎이나요?"

결론부터: **모델은 1개(통합 `correction`), 차이는 `correctionType`과 프롬프트 컨텍스트뿐이고, 허위 사실은 시스템 프롬프트 가드레일 + 구조화 출력으로 억제하며, 백엔드는 완성됐지만 프론트는 정적 플레이스홀더이고 실제 크레딧 차감은 아직 배선되지 않았다.** 이 정직한 구분이 이 페이지의 핵심이다.

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

### 2-1. 왜 포트폴리오 전용 모델을 따로 두지 않았나

면접답변(#24)·자소서(#25)·이력서(#26)·포트폴리오(#27) 네 기능은 입력(원문 텍스트), 출력(개선안 + 근거), 검증(길이·소유권), 과금(`benefit_code=CORRECTION` 한 풀) 흐름이 **완전히 동일**하다. 다른 것은 "어떤 글을 어떤 관점으로 다듬느냐"뿐이다. 그래서 운영안의 "E 전용 통합 첨삭 모델 1개" 원칙대로, 모델·서비스·AI 클라이언트를 하나로 두고 `correctionType`(`SELF_INTRO` / `INTERVIEW_ANSWER` / `RESUME` / `PORTFOLIO`)으로만 분기한다.

| 선택지 | 장점 | 단점 | 결정 |
| --- | --- | --- | --- |
| 4종 각각 별도 도메인/클라이언트 | 기능별 자유로운 변형 | 코드 4배, 과금·로그·재시도 로직 중복 | 미채택 |
| 단일 도메인 + `correctionType` 분기 | 유지보수·일관성·과금 정책 공유 | 기능별 특수 로직 넣기 어려움 | **채택** |

트레이드오프: 포트폴리오만을 위한 특수 처리(예: 링크 크롤링, 이미지 OCR)를 넣기 어렵다. 하지만 현재 범위에서는 "텍스트 다듬기"가 공통이라 통합의 이점이 압도적이다.

### 2-2. 왜 원문 보존형(원문을 덮어쓰지 않는) 설계인가

포트폴리오는 채용에서 거짓이 가장 위험한 영역이다. "트래픽 3배 개선" 같은 숫자를 AI가 임의로 붙이면 면접에서 검증당해 탈락한다. 그래서 두 가지 원칙을 둔다.

1. **사실 날조 금지** — 시스템 프롬프트가 명시적으로 "성과·지표·고용주·프로젝트·경험을 지어내지 말 것, 근거가 없으면 제안(suggestion)으로만 남길 것"을 강제한다.
2. **append-only 보존** — 첨삭 결과는 원문을 덮어쓰지 않고 `correction_request` 테이블에 새 행으로 쌓인다. 사용자는 변경 근거(`changeReasons`)를 보고 **직접 검증한 뒤 반영 여부를 선택**한다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

포트폴리오 첨삭은 다음 실제 클래스/테이블로 동작한다.

| 계층 | 클래스/파일 | 역할 |
| --- | --- | --- |
| Controller | `CorrectionController` (`/api/corrections`) | POST `/`(생성), GET `/`(목록), GET `/{id}`(단건) |
| Service | `CorrectionService.create()` | 정규화 → 소유권 검증 → AI 호출 → 로그 → 저장 오케스트레이션 |
| AI Client | `CorrectionAiClient.correct()` | OpenAI Responses API 호출 + 구조화 출력 파싱 + 재시도 |
| Prompt | `CorrectionPromptCatalog` | `VERSION="e-correction-v1"`, `SYSTEM_PROMPT`(가드레일) |
| Log | `CorrectionAiUsageLogService` | 사용량 로그 별도 트랜잭션 기록 |
| Table | `correction_request` | 원문·개선안·`result_json` append-only 저장 |
| Seed | `ai_feature_benefit_policy` | `CORRECTION_PORTFOLIO` 행(아래) |

포트폴리오 분기의 `featureType`은 `CorrectionService.featureType()`가 만든다 — `"CORRECTION_" + correctionType` 이므로 **`CORRECTION_PORTFOLIO`**. 이 키가 사용량 로그와 과금 정책 매칭의 단일 기준이다. 스키마에 다음 seed 행이 실재한다.

```sql
-- ai_feature_benefit_policy (schema.sql:1033 / 패치 20260618:198)
-- feature_type,           benefit_code, charge_unit, included_in_ticket, default_credit_cost, ...
('CORRECTION_PORTFOLIO',  'CORRECTION', 'PER_REQUEST', 1,                  2,                  1)
```

즉 포트폴리오 첨삭은 **사용권 풀 `CORRECTION`(첨삭 4종 공유)** 에 속하고, 사용권이 없을 때의 크레딧 단가는 **2**다. (단, 차감 호출은 아직 배선 안 됨 — 5절 참조.)

:::tip OpenAI 설정은 E 전용이 아니다
`CorrectionAiClient`는 공통 `OpenAiProperties`(`careertuner.openai`)를 그대로 쓴다. model 기본값 `gpt-5`, timeout 300초. E만의 별도 키가 아니라 전사 OpenAI 설정을 공유한다. 키 자리표시자는 `OPENAI_API_KEY`로만 다룬다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 포트폴리오 첨삭 한 번의 전체 흐름

```text
사용자 포트폴리오 원문
  │  POST /api/corrections  { correctionType:"PORTFOLIO", originalText, applicationCaseId?, questionText? }
  ▼
CorrectionService.create()
  1) 정규화·검증   correctionType 화이트리스트, originalText 필수·≤12000자, sourceType 기본 DIRECT_INPUT
  2) 소유권 검증   applicationCaseId 있으면 applicationCaseAccessService.requireOwned(userId, id)
  3) featureType   "CORRECTION_PORTFOLIO"
  4) AI 호출       aiClient.correct(command)   ← 실패 시 recordFailure 후 재throw
  5) 사용량 로그   recordSuccess(...) → aiUsageLogId
  6) 저장          correction_request insert (result_json에 근거 4종 JSON 직렬화)
  ▼
CorrectionResponse (improvedText + summary/issues/changeReasons/suggestions)
```

### 4-2. 포트폴리오에서 "지원 직무에 맞춤"이 일어나는 지점

핵심 맞춤은 `CorrectionAiClient.userPrompt()`가 만드는 사용자 프롬프트에서 일어난다. `applicationCaseId`가 있으면 해당 지원 건의 **회사명·직무명**이 프롬프트 컨텍스트로 들어가, 같은 포트폴리오라도 지원 직무에 맞는 강조점으로 다듬어진다.

```text
Correction type: PORTFOLIO
Source type: DIRECT_INPUT

Application context:
Company: (지원 건의 회사명)
Job title: (지원 건의 직무명)

Question or prompt:
(questionText 있으면 — 예: "백엔드 직무 기준으로 정리해줘")

Original text:
(사용자 포트폴리오 설명 원문)
```

지원 건을 연결하지 않으면 컨텍스트는 `"No application case was selected."`로 채워지고, 직무 맞춤 없이 일반적 개선만 된다. 즉 **"지원 직무에 맞춘 정리"의 재료는 E가 직접 갖지 않고, 지원 건(공통 도메인)에서 소유권 검증과 함께 가져온다.** 이것이 다른 영역과의 데이터 경계다.

### 4-3. 출력 형태를 강제하는 구조화 출력

포트폴리오 설명은 자유도가 높아, 응답이 매번 다른 모양이면 프론트가 파싱할 수 없다. 그래서 OpenAI Responses API에 `text.format.type="json_schema"`, `strict:true`, `additionalProperties:false`로 스키마를 고정한다. 5개 필드 전부 required다.

| 출력 필드 | 의미 (포트폴리오 맥락) |
| --- | --- |
| `improvedText` | 다듬어진 포트폴리오 설명 본문(공백이면 `INTERNAL_ERROR`) |
| `summary` | 무엇을 어떻게 개선했는지 요약 |
| `issues` | 원문의 문제점(역할 불명확, 결과 누락 등) |
| `changeReasons` | 각 변경의 이유 — 사용자가 검증·선택할 근거 |
| `suggestions` | 근거가 없어 본문에 못 넣은 보강 제안(예: "이 프로젝트의 정량 지표를 추가하면 좋음") |

저장 시 `improvedText`는 `correction_request.improved_text`에, 나머지 4종(`summary/issues/changeReasons/suggestions`)은 `result_json` 한 컬럼에 JSON으로 직렬화된다.

:::warning 출력 필드 계약 격차 — 면접에서 정확히
운영안 설계 문서의 JSON 계약은 `corrected_text / changes / risk_flags / preserved_meaning / added_facts / confidence` 6필드지만, **실제 코드 출력은 위 5필드**다. 설계서가 매핑을 명시한다(`improvedText = corrected_text`, `changeReasons = changes`). 면접에서는 "코드가 실제로 내는 건 5필드, 6필드는 설계 목표 계약"이라고 구분해 말하는 것이 정직하다.
:::

### 4-4. 재시도와 실패 처리

`CorrectionAiClient`는 `MAX_ATTEMPTS=3`, 지수 백오프(`300ms * attempt`)로 재시도한다. 재시도 대상은 HTTP 408/409/429/5xx + "timeout"/"temporarily" 메시지. 단 **타임아웃은 재시도 없이 즉시 실패**다. AI 호출이 실패하면 `CorrectionService`가 `recordFailure(...)`로 실패 로그(별도 트랜잭션)를 남긴 뒤 예외를 다시 던진다.

```text
status >= 500, 408/409/429, "timeout"/"temporarily" → 최대 3회 재시도(백오프)
HttpTimeoutException                                → 즉시 실패 (재시도 없음)
OpenAI 키 미설정                                    → 즉시 INTERNAL_ERROR (mock 폴백 없음)
```

포트폴리오 첨삭에는 **mock/룰베이스 폴백이 없다.** 다른 영역(fitanalysis 등)에는 폴백이 있지만, 첨삭은 사실 생성 책임이 무거워 더미 응답이 오히려 위험하다고 보고 의도적으로 뺐다. 대신 `CorrectionAiClient`를 향후 자체 LLM 5단 폴백 디스패처가 들어갈 단일 진입점으로 설계해 두었다(미연동).

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

면접에서 가장 중요한 부분이다. "다 됐다"고 말하면 꼬리질문에서 무너진다.

### 됨 (코드 실재)

- **백엔드 포트폴리오 첨삭 전체**: `POST/GET /api/corrections`에서 `correctionType=PORTFOLIO`로 동작. OpenAI Responses 구조화 출력 + 3회 재시도 + 허위사실 방지 프롬프트 + `result_json` 저장 + 사용량 로그(별도 트랜잭션).
- **정책 seed**: `ai_feature_benefit_policy`에 `CORRECTION_PORTFOLIO`(`benefit_code=CORRECTION`, `default_credit_cost=2`) 실재.
- **크레딧/사용권 차감 엔진 자체**: 원자적·멱등 차감 로직 완성, 단위 테스트 통과.

### 계획/미연결 (근거 있는 갭)

1. **★프론트는 정적 플레이스홀더** — `Correction.tsx`의 포트폴리오 탭은 `api()` 호출이 0건이다. 상단에 "첨삭 API 준비 중" 배너, 버튼 3개 모두 `disabled`, "최근 첨삭 기록"은 `샘플 ·` 더미. 탭별 크레딧 단가(`portfolio: credit 2`)도 **클라 하드코딩 상수**라 서버 정책과 비동기화될 수 있다. 즉 백엔드는 실재하지만 화면이 아직 그것을 호출하지 않는다.
2. **★AI 실행 ↔ 과금 미배선** — 차감 진입점(`AiChargeService.charge` / `consumeByFeature` / `deductByAiUsageLog`)의 운영 호출처가 0건(단위 테스트에만 존재)이다. 따라서 포트폴리오 첨삭을 실행하면 `ai_usage_log`와 `correction_request`만 쌓이고 `users.credit`·`user_benefit_balance`는 **실제로 깎이지 않는다.** 단가 2는 정책에만 적혀 있고 차감 호출 지점이 없다.
3. **자체 LLM 5단 폴백 미연동** — 현 코드는 OpenAI Responses 단일 경로 + 3회 재시도다. Qwen3 계열 + 규칙엔진 폴백은 설계 단계.
4. **포트폴리오 특화 입력 부재** — 운영안의 "포트폴리오 링크/설명·프로젝트 키워드·희망 직무" 입력 설계 중, 현재 코드가 실제 받는 것은 `originalText`(+선택적 지원 건·questionText)뿐. 링크 크롤링이나 파일 파싱(PDF/DOCX)은 "지원할 예정" 상태.

## 6. 면접 답변 3단계

**1단계 (한 문장 정의):** "포트폴리오 설명 개선은 사용자가 쓴 프로젝트 설명을 사실 날조 없이 지원 직무 관점으로 다듬어 개선안과 변경 근거를 돌려주는 기능이고, 첨삭 4종을 통합한 단일 `correction` 도메인의 `PORTFOLIO` 분기로 구현했습니다."

**2단계 (설계 의도):** "포트폴리오는 거짓이 가장 위험한 영역이라, 시스템 프롬프트로 성과·지표 날조를 금지하고 원문을 덮어쓰지 않는 append-only 저장을 택했습니다. 출력은 OpenAI Responses의 json_schema strict로 5필드를 고정해 프론트 파싱을 안정화했고, 지원 직무 맞춤은 E가 직접 데이터를 갖지 않고 공통 지원 건 서비스에서 소유권 검증과 함께 회사·직무를 가져와 프롬프트에 주입하는 방식입니다."

**3단계 (구현 상태 정직히):** "백엔드는 생성·목록·조회가 다 동작하고 정책 seed도 있습니다. 다만 프론트는 아직 API를 호출하지 않는 정적 화면이고, 차감 엔진은 완성·테스트됐지만 AI 실행 경로와 배선되지 않아 현재는 사용량 로그만 쌓이고 크레딧은 실제로 깎이지 않습니다. 이건 의도적으로 분리해 둔 미연결 상태로 알고 있습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 포트폴리오 첨삭이 면접답변·자소서·이력서 첨삭과 코드상 어디서 갈라지나요?
거의 안 갈라집니다. 모델·서비스(`CorrectionService`)·AI 클라이언트(`CorrectionAiClient`)가 전부 공유되고, 분기점은 두 곳뿐입니다. (1) `CorrectionService.normalizeCorrectionType()`이 `PORTFOLIO`를 화이트리스트로 허용하고, (2) `featureType()`이 `CORRECTION_PORTFOLIO` 키를 만들어 사용량 로그·과금 정책에 매칭합니다. 그 외엔 프롬프트 컨텍스트(correctionType 문자열)만 다릅니다.
:::

:::details Q2. AI가 포트폴리오에 없는 성과 숫자를 지어내면 어떻게 되나요? 무엇으로 막나요?
1차 방어는 `CorrectionPromptCatalog.SYSTEM_PROMPT`의 가드레일입니다 — "Do not invent achievements, metrics, employers, projects, or experiences. 근거가 없으면 suggestion으로만 남겨라". 2차 방어는 구조화 출력 구조 자체입니다. 근거 없는 보강은 본문(`improvedText`)이 아니라 `suggestions` 배열로 분리되고, 본문 변경에는 `changeReasons`가 따라붙어 사용자가 검증 후 직접 반영을 선택합니다. 원문을 덮어쓰지 않고 새 행으로 쌓는 append-only 저장도 안전장치입니다.
:::

:::details Q3. 출력이 매번 다른 모양으로 오면 프론트가 깨질 텐데, 어떻게 보장하나요?
OpenAI Responses API에 `text.format.type="json_schema"`, `strict:true`, `additionalProperties:false`로 스키마를 박았고, 5개 필드를 모두 required로 지정했습니다. 모델이 스키마 밖 필드를 넣거나 필드를 빠뜨릴 수 없습니다. 추가로 응답이 코드펜스(```json)로 감싸여 와도 `parseOutputJson()`이 제거하고, `improvedText`가 공백이면 `INTERNAL_ERROR`로 막습니다.
:::

:::details Q4. 포트폴리오 첨삭 한 번에 크레딧이 얼마나 깎이나요?
정책상으론 `CORRECTION_PORTFOLIO`의 `default_credit_cost=2`이고, 첨삭 4종이 공유하는 `CORRECTION` 사용권 풀에서 먼저 차감되도록 설계돼 있습니다. 다만 정직하게 말하면 **지금은 실제로 깎이지 않습니다.** 차감 엔진(`AiChargeService` 등)은 완성·테스트됐지만 AI 실행 경로에서 호출되지 않아, 현재는 `ai_usage_log`에 사용 흔적만 기록됩니다. 크레딧 환산식도 코드엔 있습니다 — `max(1, ceil(totalTokens/1000))`, 1000토큰당 1크레딧. 이 값은 로그에 기록만 되고 차감엔 미연결입니다.
:::

:::details Q5. 지원 직무에 맞춘 정리는 어디서 일어나나요? 포트폴리오 도메인이 직무 정보를 갖고 있나요?
아니요, E는 직무 정보를 직접 소유하지 않습니다. `applicationCaseId`가 들어오면 `CorrectionService`가 공통 `applicationCaseAccessService.requireOwned()`로 소유권을 검증하며 지원 건을 가져오고, 그 회사명·직무명을 `CorrectionAiClient.userPrompt()`가 프롬프트의 Application context로 주입합니다. 이게 영역 경계 원칙입니다 — 지원 건 소유권 판단은 공통 서비스에 위임하고, E는 그 컨텍스트만 빌려 직무 맞춤을 수행합니다.
:::

:::details Q6. 첨삭에 mock 폴백이 없다고 했는데, OpenAI 키가 없으면 어떻게 되나요? 왜 폴백을 안 뒀나요?
키가 없으면 `CorrectionAiClient.post()`가 즉시 `INTERNAL_ERROR "OpenAI API key is not configured."`로 실패합니다. 폴백을 일부러 안 둔 이유는 포트폴리오 같은 첨삭은 사실을 생성·재구성하는 책임이 무거워, 룰베이스 더미 응답이 오히려 사용자에게 잘못된 신뢰를 줄 위험이 있기 때문입니다. 대신 `CorrectionAiClient`를 향후 자체 LLM 5단 폴백 디스패처가 들어갈 단일 진입점으로 설계해, 폴백을 넣을 자리는 비워뒀습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명할 수 있으면 이 주제를 이해한 것이다.

1. 포트폴리오 첨삭이 별도 모델이 아니라 통합 도메인의 한 분기인 이유와, 코드상 분기점 2곳.
2. 사실 날조를 막는 2단 방어(프롬프트 가드레일 + suggestions/changeReasons 분리)와 append-only 저장.
3. 구조화 출력 5필드(`improvedText/summary/issues/changeReasons/suggestions`)와, 운영안 6필드 계약과의 격차.
4. 지원 직무 맞춤이 공통 지원 건 서비스에서 소유권 검증과 함께 들어온다는 경계.
5. "백엔드 됨 / 프론트 정적 / 차감 미배선"의 3단 정직 구분.

관련 페이지: [공통 구조화 출력](/ai/openai-structured-output) · [AI 사용량·크레딧](/ai/ai-usage-credit) · [영역 E 개요](/area-e/) · [면접답변 첨삭 #24](/area-e/ai-answer-correction)

## 퀴즈

<QuizBox question="포트폴리오 첨삭(#27)이 면접답변/자소서/이력서 첨삭과 코드상 다른 점은 무엇인가?" :choices="['별도 AI 모델과 별도 서비스 클래스를 가진다', 'correctionType 분기와 featureType 키(CORRECTION_PORTFOLIO)만 다르고 모델·서비스·클라이언트는 공유한다', '포트폴리오만 OpenAI 대신 자체 LLM을 쓴다', '포트폴리오만 mock 폴백이 있다']" :answer="1" explanation="첨삭 4종은 단일 correction 도메인 + 단일 CorrectionAiClient를 공유하고, correctionType과 그로부터 만든 featureType(CORRECTION_PORTFOLIO) 키로만 갈린다. 별도 모델/서비스가 아니다." />

<QuizBox question="포트폴리오 원문에 없는 정량 성과를 AI가 본문에 넣지 못하게 하는 설계는?" :choices="['응답을 사람이 매번 수동 검수한다', '시스템 프롬프트로 날조를 금지하고, 근거 없는 보강은 suggestions로 분리하며 원문을 덮어쓰지 않는다', 'temperature를 0으로 고정한다', '숫자가 포함된 문장을 정규식으로 삭제한다']" :answer="1" explanation="CorrectionPromptCatalog 가드레일이 성과·지표 날조를 금지하고, 근거 없는 내용은 improvedText가 아닌 suggestions 배열로만 남으며, correction_request는 원문을 덮어쓰지 않는 append-only 저장이다." />

<QuizBox question="현재(이 시점) 포트폴리오 첨삭을 한 번 실행하면 실제로 일어나는 일은?" :choices="['users.credit에서 2크레딧이 즉시 차감된다', 'CORRECTION 사용권에서 1장이 차감된다', 'ai_usage_log와 correction_request에 기록만 남고 크레딧/사용권은 차감되지 않는다', '결제 화면으로 리다이렉트된다']" :answer="2" explanation="차감 엔진은 완성·테스트됐으나 AI 실행 경로에 배선되지 않아 운영 호출처가 0건이다. 따라서 사용량 로그와 결과 행만 쌓이고 users.credit·user_benefit_balance는 깎이지 않는다." />

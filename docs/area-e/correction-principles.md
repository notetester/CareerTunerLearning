# 첨삭의 원칙 — 원문 보존 · 허위검증

> 첨삭은 사용자의 글을 "고쳐쓰기"가 아니라 "개선안 제안"으로 다룬다. 원문을 덮어쓰지 않고, AI가 없는 경력·회사명·수치를 지어내지 못하게 막는 것이 이 영역의 가장 중요한 설계 가드레일이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

CareerTuner의 첨삭(영역 E, AI 기능 #24~27)은 자기소개서·면접답변·이력서·포트폴리오를 지원 맥락에 맞게 다듬는 기능이다. 이 페이지는 그 중에서도 **"첨삭이 어떻게 거짓말을 안 하게 만들었는가"** 라는 한 가지 축에 집중한다.

면접에서 이 페이지로 답할 수 있는 질문:

- "AI 첨삭이 없는 경력이나 수치를 지어내면 채용 사기가 됩니다. 그걸 어떻게 막았나요?"
- "원문을 바로 고쳐주지 않고 개선안과 변경 이유를 따로 주는 이유가 뭔가요?"
- "설계 문서의 JSON 계약(`corrected_text`/`risk_flags`/`added_facts`/`confidence`)과 실제 코드 출력이 다른데, 무엇이 진짜 구현된 건가요?"

핵심 한 줄: **개선 텍스트(`improvedText`)와 변경 이유(`changeReasons`)를 분리하고, 근거 없는 강화는 본문에 넣지 않고 제안(`suggestions`)으로만 내보낸다.**

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

첨삭의 본질적 위험은 **"그럴듯하게 더 좋아 보이는 글을 만들려다 사실을 날조하는 것"** 이다. LLM에게 "이 자소서를 더 강하게 고쳐줘"라고 시키면, 모델은 빈칸을 메우기 위해 흔히 다음을 한다.

- 없는 수치를 만든다 ("매출 30% 향상" 같은 구체적 숫자).
- 없는 회사·프로젝트·기술 스택을 추가한다.
- 직무에 유리해 보이는 경험을 통째로 발명한다.

이 글로 실제 지원·면접을 보면 **경력 위조**가 되어 합격이 취소되거나 법적 리스크가 된다. 그래서 E의 첨삭은 "글을 잘 쓰는 것"보다 **"사실을 보존하는 것"** 을 상위 목표로 둔다.

이 목표에서 두 가지 설계 결정이 따라온다.

| 결정 | 트레이드오프 |
| --- | --- |
| **원문을 덮어쓰지 않는다** — 개선안은 새 행으로만 쌓고, 반영은 사용자 선택 | 자동 적용의 편의를 포기하는 대신, 사용자가 사실을 검수할 권한을 항상 보유 |
| **근거 없는 강화는 본문 금지, 제안으로 격리** | "더 강한 한 문장"을 곧바로 못 주는 대신, 거짓 문장이 본문에 섞이는 걸 원천 차단 |
| **첨삭에는 mock/룰베이스 폴백을 두지 않음** | OpenAI 키가 없으면 첨삭 자체가 불가하지만, 룰베이스 더미가 사실을 생성하는 위험을 차단 |

:::tip 왜 "덮어쓰기"가 아니라 "제안"인가
첨삭 결과는 `correction_request` 테이블에 **append-only(불변)** 로 쌓인다. 재첨삭할 때마다 새 행이 생기고, A(프로필/자소서)나 D(면접)의 원본은 절대 자동으로 갱신되지 않는다. 사용자가 보고 골라서 반영하는 흐름이라, 잘못된 개선이 원본을 오염시키지 않는다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

원문 보존과 허위 검증은 세 군데에 코드로 박혀 있다.

**(1) 시스템 프롬프트 가드레일** — `CorrectionPromptCatalog.java`

프롬프트 카탈로그(`VERSION = "e-correction-v1"`)의 `SYSTEM_PROMPT`이 모델 행동을 1차로 제약한다. 핵심 문장(영문 원문 요약):

```text
Improve only the user's existing material for a real job application.
Do not invent achievements, metrics, employers, projects, or experiences.
If a stronger sentence needs missing evidence,
keep it as a suggestion instead of adding false facts.
```

즉 "성과·수치·회사·프로젝트·경험을 발명하지 마라. 더 강한 문장이 없는 근거를 필요로 하면, 거짓을 본문에 넣지 말고 **제안으로만** 둬라"가 프롬프트에 명시되어 있다.

**(2) 구조화 출력 강제** — `CorrectionAiClient.java`

출력을 항상 같은 JSON 모양으로 고정한다. OpenAI Responses API에 `text.format.type = "json_schema"`, `strict = true`로 스키마(`correctionSchema()`)를 넘긴다. 스키마는 5개 필드를 **전부 required**, `additionalProperties = false`로 잠근다.

```text
correctionSchema() 의 5필드 (전부 required, 추가 속성 금지)
  improvedText   : string   개선된 본문 (원문을 바꾼 결과)
  summary        : string   한 줄 요약
  issues         : string[] 발견한 문제점
  changeReasons  : string[] 각 변경의 이유  (= 설계 문서의 changes)
  suggestions    : string[] 근거 없어 본문에 못 넣은 제안
```

`improvedText`가 공백이면 `INTERNAL_ERROR "AI correction result is empty."` 로 거부한다. 이 분리 자체가 "본문(improvedText) vs 변경 이유(changeReasons) vs 미반영 제안(suggestions)"을 구조적으로 떼어 놓는 장치다.

**(3) 불변 저장** — `CorrectionService.java` + `correction_request` 테이블

`CorrectionService.create()`가 개선 본문은 `improved_text` 컬럼에, 나머지 메타(summary/issues/changeReasons/suggestions)는 `result_json` 컬럼에 직렬화해 새 행으로 insert한다(`resultJson()`). `original_text`는 그대로 보존된다. FK 정책이 보존을 강화한다.

| 컬럼/제약 | 보존 효과 |
| --- | --- |
| `original_text MEDIUMTEXT NOT NULL` | 원문을 항상 별도 컬럼에 그대로 보관 |
| `improved_text MEDIUMTEXT NULL` | 개선안은 원문과 분리된 컬럼 |
| `result_json JSON` | summary/issues/changeReasons/suggestions를 한 덩어리로 |
| `fk_correction_request_case ... ON DELETE SET NULL` | 지원 건이 삭제돼도 첨삭 본문은 남음 |
| append-only(매 첨삭마다 새 행) | 기존 첨삭이 덮어써지지 않음 |

## 4. 동작 원리 (흐름·표·작은 코드)

전체 흐름을 한 줄 코드 의사표현으로 압축하면 이렇다.

```text
create(userId, request):
  1. correctionType 화이트리스트 검증 (SELF_INTRO/INTERVIEW_ANSWER/RESUME/PORTFOLIO)
  2. originalText 필수 · 최대 12000자 검증
  3. applicationCaseId 있으면 소유권 위임 검증 (타 영역 서비스)
  4. aiClient.correct(...)  → 시스템 프롬프트 + json_schema strict 호출
  5. improvedText 공백이면 거부
  6. 사용량 로그 기록 (성공/실패 모두, 별도 트랜잭션)
  7. correction_request 새 행 insert (원문·개선안·result_json)
```

**"원문 보존"의 자료 흐름** — 입력의 `originalText`는 ① AI에게 "Original text"로 전달되고, ② 그대로 `original_text` 컬럼에 저장된다. AI는 `improvedText`라는 **새 문자열**을 만들고, 이것이 `improved_text`로 들어간다. 두 컬럼이 항상 공존하므로, 어떤 시점에도 "원래 무엇을 썼는지"와 "어떻게 바뀌었는지"를 둘 다 볼 수 있다.

**"근거 없는 강화"의 격리** — 프롬프트가 모델에게 "근거 부족한 강화는 `suggestions`로"라고 지시하므로, 이상적으로 거짓 사실은 본문(`improvedText`)이 아니라 제안 리스트로 빠진다. 사용자는 제안을 보고 "내가 실제로 그 수치를 갖고 있다면 직접 넣어라" 식으로 검증 후 반영한다.

:::warning 코드 출력 5필드 vs 설계 목표 6필드 — 정확히 구분
설계 문서(`TEAM_WORK_DISTRIBUTION.md`)는 E 모델 결과 JSON 계약을 `corrected_text`, `changes`, `risk_flags`, `preserved_meaning`, `added_facts`, `confidence` 6필드로 적었고, "서버가 허위 회사명·기술명·수치 추가 여부를 검증한 뒤 저장한다"고 명시한다. 하지만 **실제 코드 출력은 5필드** (`improvedText`/`summary`/`issues`/`changeReasons`/`suggestions`)다. 매핑은 `improvedText = corrected_text`, `changeReasons = changes` 정도이고, `risk_flags`·`added_facts`·`confidence`에 해당하는 **별도 출력 필드와 서버측 자동 검증 로직은 현재 코드에 없다.** 즉 "입력에 없던 회사명/기술/수치를 자동 감지해 플래그를 세우는" 메커니즘은 **설계 목표이지 구현이 아니다.** 현재 방어선은 프롬프트 가드레일 + 구조화 출력 + 원문 보존 저장이다.
:::

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 원문을 별도 컬럼에 보존, 개선안은 새 행 append-only | ✅ 구현 | `correction_request.original_text`/`improved_text`, `CorrectionService.create` |
| 시스템 프롬프트 허위사실 방지 가드레일 | ✅ 구현 | `CorrectionPromptCatalog.SYSTEM_PROMPT` |
| 본문 / 변경 이유 / 미반영 제안 3분리 | ✅ 구현 | 스키마 `improvedText`/`changeReasons`/`suggestions` |
| 구조화 출력 강제 (json_schema strict, 전 필드 required) | ✅ 구현 | `CorrectionAiClient.correctionSchema()` |
| `risk_flags`/`added_facts` 출력 필드 | ⚠️ 계획 | 설계 문서에만 존재, 코드 출력에 없음 |
| 입력에 없던 회사명/기술/수치 **자동 감지·플래그** (서버 검증) | ⚠️ 계획 | 문서에 검증 의도 명시, 검증 코드 부재 |
| `confidence` 점수 | ⚠️ 계획 | 운영안 JSON 계약에만 존재 |
| 첨삭 프론트(`Correction.tsx`)에서 결과 표시·반영 | ⚠️ 미연결 | 화면은 정적 플레이스홀더, `api()` 호출 0건 ("첨삭 API 준비 중" 배너) |

**정리:** 백엔드 `/api/corrections`는 실재하고, 원문 보존·허위 방지 프롬프트·구조화 출력은 모두 코드로 작동한다. 다만 "AI가 추가한 사실을 서버가 자동으로 잡아내는" 검증 단계는 **아직 프롬프트 신뢰 수준**이며, 프론트는 결과를 아직 화면에 붙이지 않았다.

## 6. 면접 답변 3단계

**1단계 (한 줄):** "첨삭은 글을 고쳐주는 게 아니라 개선안을 제안하는 기능이고, 핵심 설계는 AI가 없는 사실을 지어내지 못하게 막는 것입니다."

**2단계 (어떻게):** "원문은 `original_text` 컬럼에 그대로 보존하고 개선안은 `improved_text`로 분리 저장합니다. 매 첨삭은 새 행으로만 쌓이는 append-only라 원본을 덮어쓰지 않습니다. 시스템 프롬프트에 '성과·수치·회사·프로젝트를 발명하지 말고, 근거 없는 강화는 본문이 아니라 suggestions로만 내보내라'를 명시했고, 출력은 json_schema strict로 `improvedText`/`summary`/`issues`/`changeReasons`/`suggestions` 5필드를 강제합니다."

**3단계 (트레이드오프·정직):** "변경 이유(`changeReasons`)를 본문과 분리해 사용자가 검수 후 직접 반영하게 했습니다. 설계 문서에는 `risk_flags`/`added_facts`로 서버가 거짓 추가를 자동 감지하는 계약이 있지만, 현재 코드는 거기까지는 구현하지 않았고 방어선은 프롬프트와 원문 보존 저장입니다. 이건 의도적으로 정직하게 구분해서 말합니다."

## 7. 꼬리질문 + 모범답안

**Q1. 프롬프트만으로 LLM이 사실을 안 지어낸다는 보장이 있나요?**
없습니다. 프롬프트는 확률적 가드레일이라 100% 보장이 아닙니다. 그래서 두 겹을 더 둡니다 — (1) 본문/변경이유/제안을 구조적으로 분리해, 근거 없는 강화는 `suggestions`로 흘러가게 유도하고, (2) 원문을 보존하고 반영을 사용자 선택으로 둬서 사람이 마지막에 사실을 검수합니다. 설계 목표인 `risk_flags`/`added_facts` 서버 검증을 붙이면 자동 방어가 한 겹 더 생기지만, 그건 아직 미구현입니다.

**Q2. `changeReasons`와 `suggestions`의 차이가 뭔가요?**
`changeReasons`는 **실제로 본문(`improvedText`)에 적용한** 변경의 이유 목록입니다. `suggestions`는 **본문에 넣지 않은** 것 — 더 강하게 쓸 수 있지만 사용자에게 없는 근거가 필요해서 함부로 못 쓴 것을 "이런 근거가 있으면 이렇게 써보라"고 제안하는 목록입니다. 이 분리가 "거짓을 본문에 안 넣는다"의 구현체입니다.

**Q3. 원문을 덮어쓰면 안 되는 구체적 이유는?**
첨삭은 A(자소서/이력서)와 D(면접 답변) 도메인의 원본을 참조만 합니다. 자동 덮어쓰기는 (1) 잘못된 개선이 원본을 오염시키고, (2) 사용자의 검수 기회를 빼앗고, (3) 영역 간 소유권 경계를 침범합니다. 그래서 `correction_request`에 새 행으로만 쌓고, FK는 `ON DELETE SET NULL`이라 지원 건이 지워져도 첨삭 본문은 보존됩니다.

**Q4. 왜 첨삭에는 mock/룰베이스 폴백이 없나요? 다른 AI 기능엔 있는데.**
첨삭은 "사실 생성" 책임이 무겁기 때문입니다. fitanalysis나 profile 같은 분석성 기능은 룰베이스 더미가 그럴듯한 점수를 돌려줘도 비교적 안전하지만, 첨삭에서 더미가 문장을 만들면 그게 곧 거짓 경력이 됩니다. 그래서 OpenAI 키가 없으면 차라리 실패시키고, `CorrectionAiClient`는 향후 자체 LLM 폴백 디스패처가 들어갈 단일 진입점으로만 비워뒀습니다.

**Q5. 설계 문서엔 `confidence`가 있는데 코드엔 없습니다. 왜 안 넣었나요?**
현재 단일 OpenAI Responses 경로에서는 `confidence`를 신뢰성 있게 산출할 근거가 약합니다. `confidence`는 설계 목표인 자체 LLM 5단 폴백(여러 모델·규칙 엔진을 거치며 점수를 종합)이 들어올 때 의미가 생기는 필드라, 그 단계 전까지는 출력 스키마에서 의도적으로 뺐습니다. 지금 넣으면 모델이 만든 숫자를 그대로 믿는 가짜 신뢰도가 됩니다.

**Q6. `improvedText`가 비어 오면 어떻게 되나요?**
`CorrectionAiClient.correct()`가 `improvedText.isBlank()`를 검사해 `INTERNAL_ERROR "AI correction result is empty."`로 즉시 실패시킵니다. 그리고 `CorrectionService`가 그 실패를 잡아 `recordFailure`로 사용량 로그(status=FAILED, credit_used=0)를 **별도 트랜잭션**으로 남기므로, 실패해도 감사 추적은 보존됩니다.

## 8. 직접 말해보기

다음을 막힘없이 말할 수 있으면 이 페이지를 이해한 것이다.

- 첨삭이 "고쳐쓰기"가 아니라 "개선안 제안"인 이유를, 원문 보존 컬럼 두 개(`original_text`/`improved_text`)와 append-only로 설명하기
- 프롬프트 한 문장("Do not invent achievements, metrics, employers, projects")이 무엇을 막는지, 그리고 그게 왜 100% 보장이 아닌지
- `changeReasons`(적용한 변경) vs `suggestions`(미적용 제안)의 역할 차이
- 설계 목표 6필드(`corrected_text`/`changes`/`risk_flags`/`preserved_meaning`/`added_facts`/`confidence`)와 실제 코드 5필드(`improvedText`/`summary`/`issues`/`changeReasons`/`suggestions`)를 구분하고, 무엇이 계획이고 무엇이 구현인지

연결 읽기: [공통 구조화 출력](/ai/openai-structured-output), 같은 영역의 [AI 면접답변 첨삭](/area-e/ai-answer-correction)·[첨삭 데이터 모델](/area-e/correction-data-model)·[자체 LLM 첨삭 폴백](/area-e/self-llm-correction).

## 퀴즈

<QuizBox question="첨삭에서 '근거가 부족해 본문에 넣지 못한 더 강한 표현'은 출력의 어느 필드로 격리되는가?" :choices="['improvedText', 'changeReasons', 'suggestions', 'issues']" :answer="2" explanation="시스템 프롬프트가 '근거 없는 강화는 본문에 넣지 말고 제안으로만 둬라'고 지시하므로, 근거 부족한 강화는 본문(improvedText)이 아니라 suggestions 리스트로 분리된다. changeReasons는 실제로 본문에 적용한 변경의 이유다." />

<QuizBox question="설계 문서의 JSON 계약에는 있지만 실제 CorrectionAiClient의 출력 스키마(5필드)에는 없는 것은?" :choices="['improvedText', 'changeReasons', 'risk_flags / added_facts / confidence', 'summary']" :answer="2" explanation="코드 출력은 improvedText/summary/issues/changeReasons/suggestions 5필드다. risk_flags·added_facts·confidence와 그에 따른 서버측 허위 자동 검증은 설계 목표일 뿐 현재 코드에는 구현되어 있지 않다." />

<QuizBox question="첨삭이 원문을 자동으로 덮어쓰지 않고 새 행으로만 쌓는(append-only) 가장 큰 이유는?" :choices="['DB 용량을 줄이려고', '잘못된 개선이 원본을 오염시키지 않고 사용자가 사실을 검수·선택 반영하게 하려고', 'MyBatis가 UPDATE를 지원하지 않아서', '크레딧을 더 많이 차감하려고']" :answer="1" explanation="첨삭은 거짓 사실 생성 위험이 크므로, 원본을 보존하고 반영을 사용자 선택으로 둬서 사람이 마지막에 사실을 검수하게 한다. FK는 ON DELETE SET NULL이라 지원 건이 삭제돼도 첨삭 본문은 보존된다." />

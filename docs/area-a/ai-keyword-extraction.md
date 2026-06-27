# AI 자소서/경력 키워드 추출 [#3·#4]

> 계획서의 "자소서 키워드(#3)"와 "경력·프로젝트 키워드(#4)"는 **독립 기능이 아니다.** 프로필 요약 응답의 `strengths`·`gaps`·`criteria[].evidence` 필드에 흡수된 형태로만 노출된다 — 그래서 이 페이지의 절반은 "왜 통합됐고, 어디에 흡수됐는가"를 정직하게 설명하는 일이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

자소서/경력 키워드 추출은 **사용자가 자유 텍스트로 쓴 자기소개(self_intro)와 경력·프로젝트(career/projects)에서, 강점·가치관·역할·기술·성과 같은 "재사용 가능한 키워드"를 뽑아내려는 의도**의 기능이다. 뽑힌 키워드는 A 영역 자체보다 **E(첨삭)·C(적합도 전략)·D(면접 질문 생성)** 가 참조하는 입력으로 더 가치가 있다.

면접에서 이 페이지가 답해야 할 질문:

- "계획서엔 AI 기능이 5개라던데, 자소서 키워드(#3)랑 경력 키워드(#4)는 어떻게 구현했나요?"
- "그 두 기능에 전용 API가 있나요? 없다면 어디서 결과가 나오나요?"
- "추출한 키워드는 어디에 저장되고, 다른 영역은 어떻게 가져가나요?"

:::warning 집필·답변의 핵심 사실
`ProfileController.java`에는 AI 엔드포인트가 정확히 **3개**(`/ai/summary`, `/ai/skills`, `/ai/completeness`)뿐이다. **#3·#4 전용 엔드포인트·서비스·featureType은 존재하지 않는다.** "구현했다"가 아니라 "요약 응답 필드에 흡수해 부분 노출한다"가 정확한 표현이다. 이 구분을 흐리면 사실 오류다.
:::

## 2. 왜 이렇게 설계했나(의도·트레이드오프)

### 2-1. "5기능"을 "1엔진 + featureType 분기"로 통합한 이유

계획서는 AI를 #1 요약 · #2 기술스택 · #3 자소서 키워드 · #4 경력 키워드 · #5 완성도로 나눴다. 하지만 이 다섯은 **입력이 같다** — 전부 사용자의 `user_profile` 1행 전체를 본다. 별도 요청 바디도 없다(엔드포인트가 `@AuthenticationPrincipal`만 받는다). 입력이 같은데 출력 포맷만 다른 기능 다섯 개를, 서비스·프롬프트·검증기를 다섯 벌 만들면 중복과 train/serve 불일치만 늘어난다.

그래서 모든 기능을 단일 진입점 `ProfileAiService.evaluate(UserProfile, featureType)` 하나로 모았다. 차이는 `featureType` 문자열과 **출력 매핑**뿐이다. #3·#4는 이 통합에서 "전용 엔드포인트를 더 만들 만큼 독립적이지 않다"고 판단돼, 요약 응답에 흡수됐다.

| | 통합형(현재) | 기능별 분리형(계획 원안) |
| --- | --- | --- |
| 코드 표면 | 엔드포인트 3개, 서비스 1개 | 엔드포인트 5개, 서비스 5개 |
| 프롬프트/검증 | 1벌 공유 | 5벌 분산 |
| #3·#4 노출 | 요약 필드에 흡수 | 독립 응답 |
| 트레이드오프 | 단순·일관, 그러나 #3·#4가 "1급 기능"이 아님 | 명시적, 그러나 중복·불일치 위험 |

### 2-2. 키워드를 "결과 캐시"로 저장하지 않은 이유

추출된 키워드(강점/공백/근거)는 **DB에 저장하지 않는다.** `ai_usage_log`에는 호출 사실(featureType·status·model·token·creditUsed=0)만 남고, 키워드 자체는 응답으로만 내려간다. 결과 캐시 테이블이 없다. 이유: 프로필은 단일 행 upsert로 수시로 바뀌고, 키워드는 항상 "최신 프로필"에서 다시 뽑는 게 정확하다. 캐시를 두면 프로필이 바뀐 뒤 stale 키워드를 들고 있을 위험이 더 크다. (트레이드오프: 매 호출이 재계산이라 비용·지연이 발생하지만, 운영 기본은 규칙엔진이라 LLM 비용은 0이다.)

## 3. 어떤 기술로 구현했나(실제 클래스·테이블 근거)

### 3-1. 키워드가 실제로 담기는 필드

`evaluate(...)`가 반환하는 `ProfileAiResult` 레코드의 **어느 필드가 #3·#4 키워드를 운반하는지**가 이 페이지의 핵심이다.

```text
ProfileAiResult(
  summary,            // 한 줄 요약 (#1)
  extractedSkills[],  // 기술/역량 키워드 (#2 — 별도 페이지)
  strengths[],        // ← #3 자소서 강점/가치관 키워드가 여기 흡수
  gaps[],             // ← #4 경력·프로젝트의 빈 구멍(보완 키워드)
  recommendations[],  // 개선 문장
  completenessScore,  // 가중합 총점 (#5)
  jobFamily,          // 8직무군 분류
  criteria[ ... evidence, improvement ],  // ← #4 역할·기술·성과 근거가 여기 흡수
  usage, status, errorMessage
)
```

| 계획 기능 | 의도한 추출 대상 | 실제 흡수 위치 | 핵심 근거 |
| --- | --- | --- | --- |
| #3 자소서 키워드 | 강점·가치관·핵심 사례 | `strengths[]` | 자기소개·포트폴리오 유무로 강점 문장 생성 |
| #4 경력 키워드 | 역할·기술·성과 구조화 | `gaps[]` + `criteria[].evidence` | 경험 구체성·성과 근거 기준의 근거 텍스트 |

### 3-2. 규칙엔진이 자소서/경력에서 키워드를 만드는 방식 (운영 기본 경로)

운영 기본값은 API 키 미발급이라 `OpenAiProfileAiService`가 `openAiClient.configured()==false`로 즉시 `RuleBasedProfileAiService`에 위임한다. 즉 **지금 실제로 키워드를 뽑는 코드는 규칙엔진**이다.

**#3(자소서 강점) → `strengths(profile, skills)`** (`RuleBasedProfileAiService:206`):

```java
if (!skills.isEmpty())   strengths.add("직무 역량 키워드가 " + n + "개 정리되어 있습니다.");
if (hasText(projects))   strengths.add("경험/프로젝트/활동 기록이 입력되어 있습니다.");
if (hasText(selfIntro))  strengths.add("자기소개 문장이 있어 지원 방향을 해석할 수 있습니다.");
if (hasText(portfolio))  strengths.add("포트폴리오 또는 활동 링크가 연결되어 있습니다.");
```

자소서 본문을 토큰 단위로 파싱해 가치관·키워드를 뽑는 게 아니라, **자기소개의 "존재 여부"를 강점 신호로 변환**한다. 정직하게 말하면 #3의 규칙 경로는 "키워드 추출"이라기보다 "자소서 충실도 신호화"에 가깝다.

**#4(경력 역할·기술·성과) → 평가축 근거 텍스트** (`evidence(...)`, `:115`):

- 경험 구체성: `career` 또는 `projects`가 있으면 "경력/활동 기록이 입력되어 있습니다", 없으면 "부족합니다".
- 성과 근거: `NUMBER_EVIDENCE` 정규식(`\d+|%|명|건|회|만원|원|시간|개월|년`)으로 **수치성 성과 근거**를 탐지. 매칭되면 "확인 가능한 근거가 포함" 판정.
- 추가로 `achievementScore`는 `개선/증가/감소/달성/성과/수상/합격/매출/만족도` 같은 **성과 동사 키워드**를 탐지해 점수를 올린다.

즉 #4의 핵심은 "경력에서 역할·기술·성과를 **구조화된 객체로** 뽑는다"가 아니라, "수치·성과 키워드가 **있는지**를 정규식으로 판별해 근거 문장과 점수로 환산한다"이다.

### 3-3. LLM 경로(키 주입 시): 구조화 출력 스키마

키가 주입되면 같은 진입점이 OpenAI Responses API(`json_schema strict:true`)를 호출한다. 스키마는 `OpenAiProfileAiService.schema()`가 만든다.

```text
{ summary, extractedSkills[], strengths[], gaps[], recommendations[],
  criterionScores[{ criterion, rawScore(0~100), evidence, improvement }] }
```

여기서도 **#3·#4 전용 필드는 없다.** LLM이 자소서에서 뽑은 강점은 `strengths[]`로, 경력에서 읽은 역할·성과 근거는 `criterionScores[].evidence`로 들어온다. `SYSTEM_PROMPT`는 "개발 직무에만 치우치지 말고 영업·마케팅·디자인·사무·의료·교육·생산·물류 맥락을 반영"하고, "확인 불가능한 경력은 단정하지 말고 보완 필요 항목으로 분리"하라고 지시한다 — 자소서/경력을 과장·환각하지 않게 막는 장치다. 구조화 출력 일반은 [공통 구조화 출력](/ai/openai-structured-output) 참고.

### 3-4. 관련 테이블

- **`user_profile`** — 입력 원천. 자유 텍스트 2종 `resume_text`/`self_intro`(MEDIUMTEXT)와 JSON 8종(`career`/`projects` 포함)이 #3·#4의 원재료.
- **`ai_usage_log`** — 호출 기록만. featureType=`PROFILE_SUMMARY`로 남고, `application_case_id`는 NULL(프로필 분석), `credit_used=0`. **키워드 본문은 여기에 안 들어간다.**

## 4. 동작 원리(흐름·표·작은 코드)

요약 호출 한 번에서 #3·#4 키워드가 흘러나오는 경로:

```text
POST /api/profile/ai/summary  (바디 없음, 인증만)
  └ ProfileServiceImpl.evaluateWithConsent(authUser, "PROFILE_SUMMARY")
      1) requireUser            인증 확인
      2) requireAiConsent       hasCurrentConsent(userId,"AI_DATA") false → FORBIDDEN
      3) profileAiService.evaluate(profile,"PROFILE_SUMMARY")
           ├ JobFamily.classify(profile)            8직무군 분류
           ├ openAiClient.configured()?  no → RuleBasedProfileAiService
           │     strengths(...)  → #3 자소서 강점 키워드
           │     evidence(...)   → #4 경력·성과 근거
           └ status="SUCCESS", model="profile-rule-v2"
      4) recordAi → ai_usage_log insert (키워드 본문 제외)
  └ toAiResponse(result) → ProfileAiResponse(strengths[], gaps[], criteria[]...)
```

featureType별 출력 매핑(`ProfileServiceImpl`):

| featureType | 엔드포인트 | 응답 DTO | #3·#4 키워드 노출 |
| --- | --- | --- | --- |
| `PROFILE_SUMMARY` | `/ai/summary` | `ProfileAiResponse` | strengths(#3)·gaps(#4)·criteria.evidence(#4) 전부 노출 |
| `PROFILE_SKILL_EXTRACT` | `/ai/skills` | `ProfileAiResponse` | 같은 DTO지만 화면은 extractedSkills 중심 |
| `PROFILE_COMPLETENESS` | `/ai/completeness` | `ProfileCompletenessResponse` | criteria를 completed/missing으로 분할(근거 텍스트 유지) |

핵심: **세 featureType이 같은 엔진을 부르고 같은 `ProfileAiResult`를 만든다.** 차이는 DTO 변환뿐이다. 그래서 자소서/경력 키워드는 "요약을 누르면" 가장 풍부하게 나온다.

## 5. 구현 상태(됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 요약 응답에 strengths·gaps·evidence 노출 | **구현됨** | `ProfileAiResponse`, 규칙엔진 동작 |
| 자소서 충실도→강점 신호화(#3 규칙 경로) | **구현됨(축약형)** | `strengths(...)` 유무 판정 |
| 경력 수치·성과 키워드 정규식 탐지(#4 규칙 경로) | **구현됨** | `NUMBER_EVIDENCE`, 성과 동사 매칭 |
| #3·#4 전용 엔드포인트·서비스·featureType | **미구현** | 컨트롤러 엔드포인트 3개뿐 |
| 자소서 키워드 토큰 단위 추출(가치관·핵심 사례 객체화) | **미구현** | 규칙은 본문 파싱 아님, LLM은 `strengths[]`에 통합 |
| 경력 "역할·기술·성과" 구조화 객체 출력 | **미구현** | 구조화 필드 없이 evidence 텍스트로 흡수 |
| 키워드 결과 캐시 저장 | **미구현(의도된 선택)** | 캐시 테이블 없음, 응답으로만 |
| LLM 경로(`careertuner-a-profile-3b`/`gpt-5`) | **설계·코드 있음, 운영 비활성** | 키 미발급 → 규칙엔진 폴백 |

:::warning 면접에서 가장 위험한 과장
"자소서에서 가치관 키워드를 추출하는 NLP 파이프라인을 만들었다"는 **거짓**이다. 실제로는 (1) 규칙엔진이 자소서 유무·수치 근거 유무를 신호로 환산하고, (2) LLM 경로에선 모델이 `strengths`/`evidence` 자연어 문장으로 통합 생성한다. "전용 추출기"는 없다.
:::

## 6. 면접 답변 3단계

1. **한 줄 정의:** "자소서·경력 키워드 추출은 계획상 #3·#4였지만, 입력이 프로필 1행으로 동일해서 별도 기능 대신 요약 엔진의 출력 필드로 통합했습니다. 강점 키워드는 `strengths`, 경력의 역할·성과 근거는 `gaps`와 `criteria[].evidence`로 나옵니다."
2. **설계 근거:** "전용 엔드포인트·서비스를 5벌 만들면 입력이 같은데 중복만 늘어 train/serve 불일치 위험이 커집니다. 그래서 `ProfileAiService.evaluate(profile, featureType)` 단일 진입점에 featureType 분기 + 출력 매핑만 두는 통합형을 택했습니다."
3. **구현·한계:** "운영 기본은 API 키가 없어 규칙엔진이 동작합니다. 자소서는 충실도 신호로, 경력은 수치·성과 정규식으로 키워드화합니다. 키 주입 시엔 같은 진입점이 `strict:true` 구조화 출력으로 같은 필드를 채웁니다. 키워드는 캐시하지 않고 매번 최신 프로필에서 재계산합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. #3·#4 전용 API가 정말 없나요? 그럼 프론트는 뭘 누르나요?
없습니다. 프론트는 버튼 3개(요약/역량추출/완성도진단)만 노출하고, 자소서·경력 키워드는 "요약" 응답의 `strengths`·`gaps`·`criteria` 필드에서 화면에 그려집니다. 별도 "키워드 추출" 버튼이나 라우트는 없습니다.
:::

:::details Q2. 그럼 #3·#4를 "구현했다"고 말해도 되나요?
정확히는 "요약 기능에 흡수된 형태로 부분 노출된다"입니다. 독립 featureType·서비스가 없으므로 "독립 기능으로 구현"이라고 하면 사실과 다릅니다. 면접에선 이 구분을 먼저 밝히는 편이 오히려 신뢰를 줍니다.
:::

:::details Q3. 경력에서 성과를 어떻게 판별하나요? LLM이 다 하나요?
운영 기본은 규칙엔진입니다. `NUMBER_EVIDENCE` 정규식이 `숫자·%·명·건·회·만원·시간·개월·년`을, 그리고 `개선/증가/달성/매출/만족도` 같은 성과 동사를 탐지해 "확인 가능한 근거" 여부를 판정하고 성과 근거 점수를 올립니다. LLM 경로가 켜지면 모델이 `evidence` 문장으로 더 풍부하게 서술하지만, 점수 합산은 여전히 서버(`ProfileScoreCalculator`)가 합니다.
:::

:::details Q4. 추출한 키워드를 C·D·E는 어떻게 가져가나요?
A는 원본 프로필의 소유자이고, 다른 영역은 그 프로필을 **읽기 전용**으로 참조합니다. #3·#4 키워드 자체는 DB에 저장하지 않으므로, C(적합도)·D(질문)·E(첨삭)는 키워드 캐시를 읽는 게 아니라 같은 `user_profile`을 입력으로 자기 분석을 다시 수행합니다. A의 책임은 "신뢰할 수 있는 원천 데이터 제공"까지입니다.
:::

:::details Q5. 자소서를 토큰 단위로 NLP 파싱하지 않은 이유는?
운영 기본이 키 미발급 규칙엔진이라 형태소·임베딩 기반 키워드 추출기를 두면 유지비 대비 효용이 낮았습니다. 또 자소서는 자유 텍스트라 토큰 추출이 환각·오분류를 만들기 쉽습니다. 그래서 규칙은 "충실도 신호"로 단순화하고, 정교한 의미 추출은 LLM 경로에 위임하되 `strict:true` 스키마와 2차 검증기로 형식을 강제하는 방향을 택했습니다.
:::

:::details Q6. 키워드를 캐시하면 더 빠를 텐데 왜 안 했나요?
프로필은 단일 행 upsert로 자주 바뀝니다. 캐시를 두면 프로필 수정 후 stale 키워드를 보여줄 위험이 생기고, 무효화 로직까지 떠안아야 합니다. 운영 기본이 규칙엔진(LLM 비용 0)이라 재계산이 싸서, "항상 최신 프로필에서 재계산"이 정확성·단순성 모두에서 유리했습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제는 끝난 것이다.

- 계획서의 #3·#4가 코드에서 **어떤 엔드포인트·필드로** 귀결되는지 1분 안에 설명하기
- `ProfileAiResult`의 `strengths`/`gaps`/`criteria.evidence`가 각각 어느 계획 기능을 담는지 매핑하기
- 규칙엔진이 자소서·경력에서 키워드를 "추출"이 아니라 "신호화"한다는 점과 그 한계를 정직하게 말하기
- 키워드를 캐시하지 않는 결정의 트레이드오프를 한 문장으로 방어하기

## 퀴즈

<QuizBox question="계획서의 #3(자소서 키워드)·#4(경력 키워드)는 실제 백엔드에서 어떻게 구현되어 있나?" :choices="['각각 전용 엔드포인트와 featureType이 있다', '전용 엔드포인트 없이 요약 응답의 strengths·gaps·criteria.evidence 필드에 흡수돼 있다', 'application_case 테이블에 키워드로 저장된다', 'C 영역이 대신 구현했다']" :answer="1" explanation="ProfileController에는 AI 엔드포인트가 summary/skills/completeness 3개뿐이다. #3·#4 전용 엔드포인트·서비스·featureType은 없고, 요약 응답의 strengths(#3)·gaps와 criteria[].evidence(#4)에 통합 노출된다." />

<QuizBox question="운영 기본(키 미발급) 상태에서 경력의 성과 근거를 판별하는 실제 방식은?" :choices="['형태소 분석기로 명사를 추출한다', '임베딩 유사도로 군집화한다', 'NUMBER_EVIDENCE 정규식으로 수치·기간을, 성과 동사 키워드로 결과 표현을 탐지한다', 'LLM이 항상 호출되어 판단한다']" :answer="2" explanation="openAiClient.configured()가 false면 RuleBasedProfileAiService가 동작한다. NUMBER_EVIDENCE 정규식(숫자/%/명/건/회/만원/시간/개월/년)과 개선·증가·달성·매출 등 성과 동사 매칭으로 성과 근거를 신호화한다. LLM은 키가 주입돼야 동작한다." />

<QuizBox question="추출된 자소서/경력 키워드는 어디에 저장되는가?" :choices="['별도 키워드 캐시 테이블에 저장된다', 'ai_usage_log에 키워드 본문이 저장된다', '저장하지 않고 응답으로만 내려간다(결과 캐시 없음)', 'user_profile_version 스냅샷에 저장된다']" :answer="2" explanation="결과 캐시 테이블이 없다. ai_usage_log에는 호출 사실(featureType·status·model·token·creditUsed=0)만 남고 키워드 본문은 응답으로만 내려간다. user_profile_version은 schema.sql에 존재하지도 않는다." />

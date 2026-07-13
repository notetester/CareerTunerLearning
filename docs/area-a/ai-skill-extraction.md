# AI 기술스택 추출 [#2]

> 이력서·프로젝트·자기소개에서 직무 역량 후보를 뽑아 보여주되, **사용자가 확정한 값만** 프로필 데이터가 된다. 추출은 제안이고, 확정은 사람의 권한이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

기술스택 추출(`PROFILE_SKILL_EXTRACT`)은 A 영역 프로필 AI 3기능 중 하나로, 사용자가 입력한 프로필 텍스트에서 직무 역량 키워드 후보를 추출해 `extractedSkills[]`로 내려주는 기능이다. 백엔드 엔드포인트는 `POST /api/profile/ai/skills` 하나이며, 요약(`/ai/summary`)·완성도진단(`/ai/completeness`)과 **동일한 단일 진입점** `ProfileAiService.evaluate(profile, featureType)`를 공유하고 `featureType` 문자열로만 갈린다.

이 페이지가 면접에서 답해야 하는 질문:

- "AI가 추출한 스킬을 어떻게 사용자 입력과 합치고, 중복·표기 흔들림을 어떻게 정리하나?"
- "AI가 뽑은 값이 그대로 DB에 저장되나? 아니라면 누가 무엇을 확정하나?"
- "스킬 추출 전용 모델이나 테이블이 따로 있나?"

:::tip 핵심 결론 먼저
추출 결과는 **제안용 표시값**이고, 프로필에 저장되는 스킬은 사용자가 텍스트박스에서 직접 확정한 줄(`skillsText`)뿐이다. 추출 결과를 자동으로 프로필에 써넣는 경로는 코드에 **존재하지 않는다.** 이 분리가 이 기능의 설계 정체성이다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### "사용자 확정 값만 데이터로" 원칙

A 영역은 B(공고 분석)·C(적합도)·D(면접 질문)·E(첨삭)가 공통으로 읽는 **기반 신뢰 데이터의 소유자**다. 프로필이 흔들리면 그 위에 쌓이는 모든 분석이 흔들린다. 그래서 스킬 추출은 다음 두 책임을 의도적으로 갈라 둔다.

| 책임 | 주체 | 결과물 |
| --- | --- | --- |
| 후보를 **제안**한다 | AI / 규칙엔진 | `extractedSkills[]` (응답에만 존재, 저장 안 함) |
| 무엇이 내 스킬인지 **확정**한다 | 사용자 | `user_profile.skills` (PUT으로 저장) |

추출이 자동으로 프로필을 덮어쓰면 빠르지만, 오추출(예: 자기소개에 스쳐 지나간 단어를 역량으로 오인)이 곧바로 다른 영역의 적합도·면접 질문 입력으로 전파된다. 사람이 한 번 확정하게 만들면 한 단계 느려지는 대신 **데이터 신뢰도를 사용자에게 위임**한다. A의 데이터 경계(원본 프로필 쓰기 권한은 A에게만, 그것도 사용자 확정을 거쳐)와 같은 철학이다.

### 추출 결과는 분석 최신본으로 저장하되 프로필에는 자동 확정하지 않는다

성공한 `extractedSkills`는 `profile_ai_analysis`의 `PROFILE_SKILL_EXTRACT` 최신본에 저장되어 새로고침 뒤에도 보인다. 그러나 이 값은 **제안**이며 `user_profile.skills`를 자동 갱신하지 않는다. 사용자가 확인해 프로필 저장을 눌렀을 때만 확정값이 바뀐다. 분석 결과 저장과 원본 자동 반영을 분리해 오추출의 하류 전파를 막는다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 백엔드 클래스 (`backend/.../profile/ai/`)

| 클래스 | 역할 |
| --- | --- |
| `ProfileController` | `POST /api/profile/ai/skills` → `service.extractSkills(authUser)` |
| `ProfileServiceImpl` | 동의 게이트 → `evaluate(..., "PROFILE_SKILL_EXTRACT")` → `ai_usage_log` 기록 |
| `ProfileAiService` | 인터페이스, 단일 진입점 `evaluate(UserProfile, featureType)` |
| `OpenAiProfileAiService` | `@Primary`, LLM 경로 + 폴백. 추출은 LLM의 `extractedSkills` 사용 |
| `RuleBasedProfileAiService` | 외부 provider 전멸 시 결정론적 추출 `extractSkillNames(profile)` |
| `JobFamily` | 8직무군 분류, KNOWN_SKILLS·키워드에 비개발 역량 포함 |
| `ProfileAiJsonValidator` | LLM JSON 2차 검증 후 `extractedSkills` 추림 |

데이터는 `user_profile.skills`(JSON 컬럼) 한 곳에만 저장된다. **스킬 전용 테이블·전용 featureType은 없다.** `skills`는 `education/career/projects/...`와 같은 JSON 컬럼 8종 중 하나이고, MyBatis는 이를 `String`으로 다루며 직렬화/역직렬화는 서비스가 책임진다(JPA 금지 원칙).

### 두 가지 추출 경로 (전략 + 폴백)

`OpenAiProfileAiService.evaluate`는 먼저 `openAiClient.configured()`를 확인한다.

- **provider 미설정·실패:** 최종 `RuleBasedProfileAiService`로 위임. 정상 규칙 경로와 외부 호출 실패 폴백은 status/model로 구분한다.
- **키 있음:** OpenAI Responses API를 `json_schema strict:true`로 호출하고, 실패하면 RuleBased로 폴백하되 `status="FALLBACK"`, `model="profile-rule-fallback"`.

즉 **현재 운영에서 실제로 도는 추출기는 규칙엔진**이고, LLM 경로는 키 주입 시 활성화되는 1차 경로다. 어느 쪽이든 출력 모양(`ProfileAiResponse.extractedSkills`)은 같다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 전체 흐름

```text
POST /api/profile/ai/skills
  → requireUser           (인증 확인)
  → requireAiConsent       (AI_DATA 동의 없으면 403 FORBIDDEN)
  → evaluate(profile, "PROFILE_SKILL_EXTRACT")
        → JobFamily.classify(profile)         (직무군 결정)
        → openAiClient.configured()?
             아니오 → RuleBasedProfileAiService.extractSkillNames(...)
             예    → OpenAI 호출 → ProfileAiJsonValidator.validate(...)
  → recordAi  → ai_usage_log INSERT (creditUsed=0)
  → ProfileAiResponse { extractedSkills[], ... }
  → profile_ai_analysis 최신본 + profile_version_id 저장
```

### 규칙엔진의 추출·중복·표기 정리 (`extractSkillNames`)

면접에서 깊게 물리는 지점이다. `RuleBasedProfileAiService.extractSkillNames`는 세 단계로 후보를 모은다.

1. **직접 입력 우선 수집:** `collectJsonValues(profile.getSkills())` — `skills` JSON을 트리 순회(BFS)하며 모든 텍스트 노드를 꺼낸다. 배열이든 객체든 구조에 상관없이 값만 긁어낸다.
2. **사전 매칭(부분 포함):** 프로필 전체 텍스트(희망직무·산업·경력·프로젝트·이력서·자기소개 등 12필드 결합)를 소문자화한 뒤, `KNOWN_SKILLS` 사전의 각 항목이 텍스트에 포함되면 **사전의 정규 표기**로 추가한다. 예: 본문에 `react`라고 써도 결과는 `React`.
3. **토큰 단위 정확 매칭:** 텍스트를 `[,\n/|]` 기준으로 쪼개고, 길이 2~30이며 영숫자·`+#.- ` 패턴인 토큰만 `KNOWN_SKILLS`와 `equalsIgnoreCase`로 비교해 정규 표기로 추가한다.

세 단계 모두 결과를 `LinkedHashSet`에 담는다 — 이게 **중복·대소문자 흔들림을 잡는 핵심**이다.

```java
Set<String> result = new LinkedHashSet<>();   // 입력 순서 보존 + 중복 제거
// 1) skills JSON의 텍스트 노드를 그대로 수집
collectJsonValues(result, profile.getSkills());
// 2) 사전 부분 매칭 → 정규 표기로 통일
for (String skill : KNOWN_SKILLS) {
    if (lower.contains(skill.toLowerCase())) result.add(skill);
}
// 3) 토큰 정확 매칭 → 정규 표기로 통일
```

| 정리 대상 | 처리 방식 |
| --- | --- |
| 중복 키워드 | `LinkedHashSet`이 동일 문자열 자동 제거 |
| 대소문자 표기 흔들림(`react`/`React`) | 사전의 **정규 표기**로 add → 사실상 정규화 |
| 노이즈 토큰(긴 문장·기호) | 길이 2~30 + 허용 문자 패턴으로 필터 |
| 자유형/깨진 JSON | `collectJsonValues`가 예외를 삼키고 무시(레거시 내성) |

:::warning 정규화의 한계
정리는 `KNOWN_SKILLS` **사전에 등재된 항목에 한해서만** 정규 표기로 수렴한다. 사전 밖 단어는 `skills` JSON에서 긁어온 원문 그대로 통과한다. 즉 동의어 통합(`프론트엔드` vs `Frontend`)이나 오타 교정 같은 의미 기반 정규화는 하지 않는다 — 어디까지나 사전 기반·결정론적 정리다.
:::

### 추출과 직무군의 연결

`KNOWN_SKILLS`와 `JobFamily` 키워드에는 `Java/Spring/React` 같은 개발 역량뿐 아니라 `영업·마케팅·회계·간호·물류·상담` 등 비개발 역량이 대거 포함돼 있다. 이유는 직무 편향 방지다 — 프롬프트(`SYSTEM_PROMPT`)도 "개발 직무에만 치우치지 말라"고 명시한다. 추출된 스킬 개수는 완성도 점수의 `JOB_SKILL_ALIGNMENT` 축에도 반영된다(`skillScore = min(70, skills.size()*12) + ...`).

### LLM 경로일 때의 추출

LLM은 `json_schema strict:true`로 `extractedSkills` 배열을 직접 생성한다. `ProfileAiJsonValidator.strings(...)`가 각 항목을 `trim`하고 공백 항목을 버려 한 번 더 거른다(2차 방어). 단 LLM 경로에서는 규칙엔진의 `KNOWN_SKILLS` 정규화는 적용되지 않고, 스키마 형식 검증·공백 제거만 거친다.

### 프런트엔드: 추출은 표시, 확정은 사용자

프로필 화면(`app/pages/Profile.tsx`)에서 "역량추출" 버튼은 `extractProfileSkills()`를 호출해 `aiResult.extractedSkills`를 **AI 결과 탭의 읽기 전용 태그**(`추출 역량`)로 보여줄 뿐이다. 이 값이 자동으로 `skillsText`에 들어가지 않는다.

사용자가 실제로 스킬을 확정하는 경로는 별개다.

```text
[추출 역량] 태그(읽기 전용)  ──표시만──▶  사용자가 눈으로 보고 판단
                                            │ (직접 타이핑 or skillHints 칩 토글)
직무 역량 탭의 Textarea(skillsText) ◀────────┘
   │ 저장(PUT /profile) 시
   ▼
skills: linesToArray(form.skillsText)   ← 이 값만 DB에 저장
```

- `skillHints` 칩을 누르면 `toggleSkill`이 `skillsText`에 줄을 추가/제거한다(이미 있으면 토글 해제).
- 저장 시 `linesToArray(skillsText)` — 줄 단위로 쪼개고 `trim` 후 빈 줄 제거 — 만 `skills`로 PUT된다.
- 즉 **추출값과 저장값은 코드상 연결돼 있지 않다.** 사용자가 추출 결과를 보고 수동으로 옮겨 적어야만 데이터가 된다. 이것이 "사용자 확정 값만 데이터로" 원칙의 코드 근거다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 |
| --- | --- |
| `POST /profile/ai/skills` 엔드포인트 | 구현됨 |
| 규칙엔진 추출(`extractSkillNames`) | 구현됨, 최종 가용성 안전망 |
| 사전 기반 정규 표기 통일 + `LinkedHashSet` 중복 제거 | 구현됨 |
| 자체·Claude·OpenAI 추출 | 설정·사용자 선택에 따라 활성, strict 검증과 폴백 |
| `extractedSkills` → 프로필 자동 반영 | **미구현(의도적 부재)**. 표시 전용 |
| 추출 결과 저장 | `profile_ai_analysis` 기능별 최신본, 자동 프로필 반영은 안 함 |
| 의미 기반 동의어 통합·오타 교정 | **없음**. 사전·결정론적 정리만 |
| 자체 파인튜닝 추출 모델 | Qwen3 4B Profile LoRA 학습·비교 근거, runtime 활성은 설정 의존 |

:::warning 면접에서 절대 헷갈리면 안 되는 사실
"AI가 스킬을 추출해 자동으로 프로필에 채워준다"는 **사실이 아니다.** 자동 반영 경로는 코드에 없고, 추출은 제안·표시까지다. 또 스킬 추출 전용 테이블이나 전용 모델이 따로 있는 것이 아니라, 공용 `user_profile.skills` 컬럼과 공용 AI 파이프라인을 `featureType`으로 재사용한다.
:::

## 6. 면접 답변 3단계

1. **무엇:** "스킬 추출은 사용자가 입력한 프로필 텍스트에서 직무 역량 후보를 뽑아 `extractedSkills[]`로 보여주는 기능입니다. 요약·완성도진단과 같은 단일 진입점을 `featureType`으로 공유합니다."
2. **어떻게:** "운영 기본 경로는 결정론적 규칙엔진입니다. `skills` JSON을 트리 순회로 긁고, `KNOWN_SKILLS` 사전과 부분·토큰 매칭해 정규 표기로 통일하며, `LinkedHashSet`으로 순서를 보존하면서 중복과 대소문자 흔들림을 제거합니다. 키가 주입되면 LLM이 strict JSON으로 추출하고 검증기가 한 번 더 거릅니다."
3. **왜:** "추출 결과를 자동 저장하지 않고 표시만 한 뒤 사용자가 텍스트박스에서 확정한 값만 저장합니다. A 프로필은 다른 영역 분석의 입력 원천이라, 오추출이 그대로 전파되지 않도록 '확정은 사람'으로 데이터 신뢰를 사용자에게 위임한 설계입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 추출된 스킬은 어느 테이블에 저장되나요?
두 종류의 저장을 구분합니다. 추출 제안은 `profile_ai_analysis` 최신본에 저장되지만 `user_profile.skills`에는 자동 반영되지 않습니다. 사용자가 확정해 PUT한 값만 원본 스킬이 됩니다. 호출 메타데이터는 별도로 `ai_usage_log`에 남습니다.
:::

:::details Q2. 중복과 표기 흔들림은 구체적으로 어떻게 정리하나요?
규칙엔진 기준으로 세 가지입니다. (1) 모든 후보를 `LinkedHashSet`에 담아 동일 문자열을 자동 제거하고 입력 순서를 보존합니다. (2) `KNOWN_SKILLS` 사전과 매칭될 때 본문 표기가 `react`여도 사전의 정규 표기 `React`로 add하므로 대소문자가 통일됩니다. (3) 토큰을 길이 2~30·허용 문자 패턴으로 필터해 문장·기호 노이즈를 거릅니다. 단 사전 밖 단어의 동의어 통합이나 오타 교정은 하지 않습니다.
:::

:::details Q3. 사전에 없는 스킬을 입력하면 어떻게 되나요?
`skills` JSON에 직접 입력한 값은 `collectJsonValues`가 트리 순회로 그대로 수집하므로 추출 결과에 원문 그대로 포함됩니다. 다만 정규 표기 통일·정리는 사전 등재 항목에만 적용되므로, 사전 밖 단어는 사용자가 적은 표기 그대로 나갑니다. 깨진 JSON이면 예외를 삼키고 무시해 레거시 데이터에 내성을 둡니다.
:::

:::details Q4. LLM 경로와 규칙엔진 경로의 추출 결과가 다를 수 있나요?
네. 규칙엔진은 `KNOWN_SKILLS` 사전 안에서만 결정론적으로 뽑아 표기까지 통일합니다. LLM은 자유롭게 추출하되 strict 스키마와 검증기의 공백 제거만 거치고, 사전 정규화는 적용되지 않습니다. 그래서 LLM 경로가 더 넓게 뽑을 수 있습니다. 어느 경로든 응답 status(SUCCESS/FALLBACK)와 model 값이 그대로 노출돼 운영자가 어떤 경로였는지 추적할 수 있습니다.
:::

:::details Q5. 동의 없이 추출을 호출하면요?
`ProfileServiceImpl.evaluateWithConsent`가 `consentService.hasCurrentConsent(userId, "AI_DATA")`를 먼저 확인하고, false면 `FORBIDDEN`을 던져 평가 자체가 실행되지 않습니다. 동의는 모든 프로필 AI 실행의 전제 조건이고, 동의 철회 시 추출도 막힙니다. 프런트는 이때 "AI 데이터 동의 상태를 확인해 주세요" 안내를 띄웁니다.
:::

:::details Q6. 추출 결과를 사용자가 무시하고 직접 입력하면 데이터가 어떻게 되나요?
그게 정상 동작입니다. 추출 태그는 읽기 전용 표시일 뿐이고, 저장되는 건 `skillsText` 텍스트박스의 줄을 `linesToArray`로 정리한 값뿐입니다. 사용자가 추출 결과를 한 줄도 옮기지 않아도 자기가 적은 스킬이 그대로 데이터가 됩니다. "추출=제안, 확정=사용자"라는 분리를 코드가 강제합니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명할 수 있으면 이 주제를 이해한 것이다.

1. 스킬 추출이 요약·완성도진단과 무엇을 공유하고 무엇만 다른가? (진입점·`featureType`)
2. `LinkedHashSet`과 `KNOWN_SKILLS` 사전이 각각 무슨 문제를 푸는가? (중복/순서 vs 표기 통일·노이즈)
3. 추출 결과 최신본 저장과 사용자 프로필 자동 반영 금지를, A의 데이터 경계와 엮어서.
4. 키가 없을 때 실제로 도는 추출기는 무엇이고, 응답의 어떤 필드로 그걸 알 수 있는가? (`model`, `status`)

## 퀴즈

<QuizBox question="AI가 추출한 extractedSkills 값이 사용자 프로필(user_profile.skills)에 반영되는 방식으로 옳은 것은?" :choices="['추출 즉시 자동으로 skills 컬럼에 저장된다', '읽기 전용으로 표시되고, 사용자가 직접 확정한 값만 저장된다', 'ai_usage_log에 저장되어 다음 로그인 때 병합된다', '전용 스킬 테이블에 버전별로 누적된다']" :answer="1" explanation="extractedSkills는 AI 결과 탭에 읽기 전용 태그로 표시될 뿐 자동 반영 경로가 없다. 저장되는 것은 사용자가 skillsText에서 확정해 PUT한 값(user_profile.skills)뿐이다. ' 추출=제안, 확정=사용자' 원칙." />

<QuizBox question="규칙엔진 extractSkillNames에서 중복과 대소문자 표기 흔들림을 정리하는 핵심 메커니즘 조합은?" :choices="['HashMap + 정규식 치환', 'LinkedHashSet + KNOWN_SKILLS 사전의 정규 표기로 add', 'TreeSet + 형태소 분석기', 'LLM 재호출로 표기 통일']" :answer="1" explanation="LinkedHashSet이 순서 보존과 중복 제거를 담당하고, KNOWN_SKILLS 사전과 매칭될 때 본문 표기 대신 사전의 정규 표기로 add해 대소문자 흔들림을 통일한다. 의미 기반 동의어 통합은 하지 않는 사전·결정론적 정리다." />

<QuizBox question="스킬 추출 전용으로 별도 존재하는 것은 무엇인가?" :choices="['전용 엔드포인트와 featureType이 있고 공용 profile_ai_analysis·AI 파이프라인을 재사용한다', '아무것도 없고 요약 응답에만 있다', '별도 사용자 스킬 원본 테이블만 있다', '추출 즉시 user_profile.skills를 덮어쓴다']" :answer="0" explanation="POST /profile/ai/skills와 PROFILE_SKILL_EXTRACT가 분기점이며, 성공 결과는 공용 profile_ai_analysis에 저장한다. 사용자 원본 skills는 확인 후 별도 프로필 저장으로만 바뀐다." />

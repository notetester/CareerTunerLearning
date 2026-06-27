# 게시글 AI 태그 추천 [#30]

> 제목·본문을 로컬 LLM에 넘겨 직무·기술·기업·면접유형 같은 **검색/필터용 태그를 자동 생성**하고, 신뢰도가 높으면 자동 적용·낮으면 "추천"으로만 보여주는 기능.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

게시글이 작성/수정되면, 트랜잭션 커밋 후 **비동기로** 글의 카테고리·제목·본문을 로컬 LLM(gemma4)에 넘겨 태그 후보 2~5개와 `confidence`를 구조화(JSON)로 받아온다. 그 confidence가 임계값(기본 0.7) 이상이면 태그를 **본문 태그로 자동 적용**하고, 미만이면 화면에 **"✦ AI 추천 태그" 칩으로만** 노출한다.

이 페이지가 답하는 면접 질문:

- "사용자가 태그를 안 달아도 글이 검색·필터되도록 어떻게 만들었나요?"
- "LLM이 자동으로 분류한 결과를 **그대로 신뢰**하나요, 아니면 사람이 검토하나요?"
- "LLM 호출이 30초 걸릴 수도 있는데, 글 작성 응답을 막지 않게 어떻게 처리했나요?"
- "LLM이 엉뚱한 태그(환각)를 만들면 어떻게 막나요?"

핵심 클래스는 `PostModerationService.tag(Long postId)`(태깅 파이프라인)과 `applyAiTags(Long, List<String>)`(DB 반영)이다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

태그는 본질적으로 **검색·필터를 위한 메타데이터**다. 그런데 작성자에게 태그 입력을 강제하면 (1) 글쓰기 마찰이 커지고 (2) 사람마다 표기가 제각각이라("FE" vs "프엔" vs "프론트엔드") 검색 재현율이 떨어진다. 그래서 "사람이 안 달아도 일관된 태그가 붙는다"를 목표로 LLM 자동 태깅을 넣었다.

여기서 두 가지 큰 설계 결정이 깔려 있다.

| 결정 | 이유 / 트레이드오프 |
| --- | --- |
| **AFTER_COMMIT 비동기 실행** | LLM 호출은 최대 30초(read-timeout)다. 이를 글 작성 트랜잭션·응답에 묶으면 사용자가 30초 기다리고 DB 커넥션도 점유된다. 태그는 "있으면 좋은" 부가 정보라 본 흐름과 분리해도 안전 |
| **confidence 게이트(자동적용 vs 추천)** | LLM 분류는 틀릴 수 있다. 확신이 높을 때만 자동 적용하고, 애매하면 "추천"으로만 보여 사람이 판단하게 한다. 영역 F의 최우선 원칙인 **"AI는 운영자/사용자 보조이지 자동 처분이 아니다"** 와 정합 |
| **카테고리명 태그 금지** | 글은 이미 게시판 카테고리로 분류돼 있다. "면접후기" 같은 카테고리명을 태그로 또 달면 중복이라 검색에 무가치. 그래서 프롬프트(금지어 7종) + 코드(`CATEGORY_LABELS` 필터)로 이중 차단 |
| **프롬프트가 아니라 코드로 불변식 보증** | "글에 없는 내용은 태그로 만들지 마라"를 프롬프트로 지시하되, 카테고리명 제거·confidence 게이트·중복 카운트 방지는 **코드가 강제**한다. LLM 출력을 곧이곧대로 신뢰하지 않는 게 영역 F 전반의 패턴 |

:::tip 한 줄 요약
"마찰 없는 일관된 검색 메타데이터"가 목표였고, 그 대가로 "비동기 + 신뢰도 게이트 + 코드 검증"이라는 복잡도를 받아들였다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

| 레이어 | 구현체 | 역할 |
| --- | --- | --- |
| 트리거 | `CommunityPostServiceImpl`이 글 생성/수정 시 `PostTagRequiredEvent(postId)` 발행 | 본 트랜잭션과 AI를 이벤트로 디커플 |
| 리스너 | `PostTagListener.on(...)` — `@TransactionalEventListener(AFTER_COMMIT)` + `@Async("moderationExecutor")` | 커밋 후 전용 스레드풀에서 비동기 실행 |
| 파이프라인 | `PostModerationService.tag(Long postId)` | pending 기록 → LLM 호출 → 필터 → 게이트 → 저장 |
| DB 반영 | `PostModerationService.applyAiTags(Long, List<String>)` `@Transactional` | 태그 마스터/매핑/카운트/캐시 갱신 |
| LLM 클라이언트 | `community/moderation/client/OllamaClient.chat(system, user, schema)` | gemma4 호출, `format=schema`로 구조화 출력 강제 |
| 프롬프트 | `resources/prompts/tagging-system.txt` | 태그 추출 규칙(근거 기반·2~5개·2~6자·카테고리명 금지) |
| 설정 | `OllamaProperties`(baseUrl `http://localhost:11434`, model `gemma4`), `ai.tagging.confidence-threshold`(기본 0.7) | 엔드포인트·모델·임계값 |

LLM 백엔드는 **로컬 Ollama**가 코드 기본값이다(`OllamaProperties.baseUrl = http://localhost:11434`). 운영 시에는 설정으로 원격 GPU 서버 엔드포인트로 교체할 수 있지만, 코드 디폴트는 어디까지나 로컬이다.

관련 테이블:

| 테이블 | 용도 |
| --- | --- |
| `community_tag` | 태그 마스터. `usage_count`(사용 횟수), `is_ai` 구분 가능 |
| `community_post_tag` | 글↔태그 매핑. **`is_ai` 플래그**로 AI 태그/사용자 태그 구분 |
| `community_post.tags_json` | 글 행의 태그 캐시(사용자+AI 전체). 목록 조회 시 조인 없이 바로 표시 |
| `post_ai_result` | AI 작업 결과 감사 테이블. **`UNIQUE(post_id, task_type)`**, `task_type=TAG`, `attempt_count` |

:::warning 주의 — `ai_usage_log`는 안 쓴다
영역 F의 AI는 공통 `ai_usage_log`에 기록하지 않는다. 태깅 결과·메트릭은 전적으로 `post_ai_result(task_type=TAG)`에 남는다(`resultJson`에 `tags/confidence/applied/threshold` 스냅샷). 면접에서 "AI 사용 로그는?"이라고 물으면 이 자체 결과 테이블을 가리키면 된다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 전체 흐름

```text
글 작성/수정 (CommunityPostServiceImpl)
   └─ DB 저장 + PostTagRequiredEvent 발행
        └─ [트랜잭션 커밋]                          ← 여기까지가 사용자 응답
             └─ PostTagListener (AFTER_COMMIT, @Async moderationExecutor)
                  └─ PostModerationService.tag(postId)
                       ① upsertPending(TAG)         ← post_ai_result에 PENDING
                       ② OllamaClient.chat(...)      ← gemma4 structured output
                       ③ 카테고리명과 같은 태그 제거
                       ④ confidence >= 0.7 ?  자동적용 : 추천만
                       ⑤ applyAiTags(...)            ← (적용 시) DB 반영
                       ⑥ complete(TAG, resultJson)  ← 결과 스냅샷 저장
```

### 4-2. LLM 입력·출력 계약

입력 텍스트는 카테고리 라벨 + 제목 + 본문을 한 덩어리로 만들고, 8000자(`MAX_TEXT_LENGTH`)에서 절단한다.

```java
String text = "카테고리: " + categoryLabel
            + "\n제목: " + post.getTitle()
            + "\n본문: " + post.getContent();
```

출력은 `format=schema`로 강제한 JSON이다(스키마 `TAGGING_SCHEMA`):

```jsonc
{ "tags": ["백엔드", "스프링", "네이버", "신입"], "confidence": 0.82 }
```

`tagging-system.txt`가 LLM에 거는 핵심 규칙(환각 방어):

- 본문/제목에 **실제 언급된 것만** 태그로. 일반 상식으로 보충 금지("개발자 면접"이라고 '코딩테스트'를 임의 추가하지 마라).
- 핵심 주제 **2~5개**, 근거 부족하면 억지로 5개 채우지 말 것.
- 한국어 **2~6자**, 표기 통일("프엔"/"FE" 금지, "프론트엔드").
- **카테고리명 7종 금지**("취업후기", "면접후기", "직무질문" 등).
- `confidence`는 추출 확신도(명확하면 높게, 짧거나 모호하면 0.5 이하).

### 4-3. 게이트 판정 (자동적용 vs 추천)

```java
boolean applied = result.confidence() >= tagConfidenceThreshold; // 기본 0.7

if (applied && !filteredTags.isEmpty()) {
    self.applyAiTags(postId, filteredTags); // 프록시 경유로 @Transactional 적용
}
// applied=false면 DB에 태그를 붙이지 않고, 결과 JSON에만 남긴다(추천).
```

| confidence | applied | 동작 | 화면 |
| --- | --- | --- | --- |
| ≥ 0.7 | true | `community_post_tag(is_ai=1)` 삽입, 카운트·캐시 갱신 | 본문 태그에 섞여 표시 |
| &lt; 0.7 | false | DB 미반영, `post_ai_result.resultJson`에만 저장 | "✦ AI 추천 태그" 칩으로 별도 노출 |

`self.applyAiTags(...)`로 **자기 자신 프록시**(`@Lazy PostModerationService self`)를 호출하는 게 포인트다. `tag()` 안에서 직접 `applyAiTags()`를 부르면 self-invocation이라 `@Transactional`이 안 먹는데, 프록시를 거치면 `applyAiTags`만 짧은 트랜잭션으로 묶인다. (이미 끝난 LLM 호출은 트랜잭션 밖이라 커넥션 풀을 점유하지 않는다.)

### 4-4. `applyAiTags`의 멱등·드리프트 방지

`applyAiTags`는 매 호출마다 "기존 AI 태그를 깨끗이 지우고 새로 적용"하는 방식이라, 글 수정으로 재태깅돼도 AI 태그가 중첩되지 않는다.

1. 기존 AI 태그(`findAiTagIds`)의 `usage_count` 감소 → 삭제(`deleteAiPostTags`)
2. 새 태그를 `community_tag`에 `INSERT IGNORE`, id 조회
3. `community_post_tag` 삽입 — **신규 삽입(affected==1)일 때만** `usage_count++`
4. 사용자+AI 전체 태그를 `tags_json` 캐시에 직렬화 저장

3번이 중요하다. 동시 태깅 등으로 같은 `(post_id, tag_id)`가 이미 있으면 `ON DUPLICATE KEY UPDATE`라 `affected != 1`이 되고, 이때는 카운트를 다시 올리지 않는다 → **usage_count 이중 증가/드리프트 방지**.

### 4-5. 프론트 노출

프론트는 `communityApi.getAiTags(postId)`로 `post_ai_result`의 `resultJson`을 받아 파싱한다(`{ tags, confidence, applied, threshold }`). `PostDetailView`는 **`!aiTags.applied` 일 때만** 별도 섹션으로 추천 칩을 그린다.

```tsx
{aiTags && !aiTags.applied && aiTags.tags.length > 0 && (
  <div className="ct-ai-suggest">
    <Sparkles /> AI 추천 태그
    {aiTags.tags.map(tag => <span className="ct-detail__tag--ai">{tag}</span>)}
  </div>
)}
```

즉 자동 적용된(confidence≥0.7) 태그는 본문 태그로 자연스럽게 섞이고, 자동 적용 안 된 저신뢰 태그만 "AI가 제안하는데 적용은 안 했다"는 의미로 시각 구분된다.

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 비동기 태깅 파이프라인(`tag()`) | ✅ 구현됨 | AFTER_COMMIT + 전용 풀 |
| 구조화 출력(JSON 스키마) | ✅ 구현됨 | `OllamaClient.chat` `format=schema` |
| confidence 게이트(자동/추천 분리) | ✅ 구현됨 | 기본 0.7, 설정 가능 |
| 카테고리명 필터 + 환각 방어 프롬프트 | ✅ 구현됨 | 프롬프트 + 코드 이중 |
| `is_ai` 구분 + usage_count 드리프트 방지 | ✅ 구현됨 | affected==1 가드 |
| 프론트 "AI 추천 태그" 칩 노출 | ✅ 구현됨 | `PostDetailView`, 미적용분만 |
| 관리자 백필(과거 글 일괄 태깅) | ✅ 구현됨 | `AdminTaggingController` `POST /api/admin/ai/tagging/backfill`(dryRun/force), `POST /api/admin/ai/tagging/{postId}` |
| LLM 호출 폴백(외부 모델로 전환) | ⚠️ 없음 | F 챗봇/검열 계열은 Ollama 장애 시 폴백 미구현. 단 `tag()`는 실패해도 `fail()` 기록 후 다음 흐름에 영향 없음 |

태깅 자체는 **완성된 기능**이다. "OpenAI 같은 외부 모델로의 폴백"만 아직 없다는 점을 정직하게 구분하면 된다.

:::details 신뢰도 임계값(0.7)과 검열 임계값(0.8)을 헷갈리지 말 것
태그 게이트는 `ai.tagging.confidence-threshold`(기본 **0.7**)이고, 신고/검열의 자동 숨김 임계값은 `ai_moderation_setting.hide_threshold`(기본 **0.8**)로 **별개**다. 같은 `judge()`/structured output 인프라를 공유하지만 용도·기본값·부수효과가 다르다. 태깅은 자동 숨김 같은 처분이 없고, 최대 부수효과가 "태그 자동 부착"뿐이라 더 낮은 임계값을 쓴다.
:::

## 6. 면접 답변 3단계

1. **무엇** — "게시글이 작성되면 제목·본문을 로컬 LLM에 넘겨 직무·기술·기업·면접유형 같은 검색용 태그를 자동 생성합니다. 사용자가 태그를 안 달아도 일관된 메타데이터로 검색·필터가 됩니다."
2. **어떻게** — "글 저장 트랜잭션이 커밋된 뒤 `@TransactionalEventListener(AFTER_COMMIT)` + `@Async` 전용 풀에서 비동기로 돌립니다. LLM은 `format=schema`로 `{tags, confidence}` JSON을 강제 받고, confidence가 0.7 이상이면 자동 적용, 미만이면 '추천'으로만 보여줍니다."
3. **왜** — "LLM 호출이 최대 30초라 본 응답을 막지 않으려 비동기로 뺐고, LLM 분류가 틀릴 수 있으니 신뢰도 게이트로 자동 처분과 제안을 나눴습니다. 카테고리명 제거·중복 카운트 방지 같은 불변식은 프롬프트가 아니라 코드가 강제합니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. confidence가 0.7 미만이면 태그는 어디에 저장되나요?
DB의 `community_post_tag`에는 **붙지 않습니다.** 대신 `post_ai_result(task_type=TAG)`의 `resultJson`에 `{tags, confidence, applied:false, threshold}` 형태로만 남고, 프론트가 이걸 읽어 "✦ AI 추천 태그" 칩으로 보여줍니다. 즉 "DB 태그로는 확정 안 했지만 사람이 보고 판단하라"는 제안 상태입니다.
:::

::: details Q2. LLM 호출을 트랜잭션 안에서 하면 안 되는 이유는?
Ollama 호출은 read-timeout이 30초입니다. 이걸 글 작성 트랜잭션에 묶으면 그동안 DB 커넥션이 점유돼 커넥션 풀이 고갈될 수 있고, 사용자도 글 저장 응답을 30초 기다리게 됩니다. 그래서 커밋 후 비동기로 빼고, DB 반영부(`applyAiTags`)만 별도의 짧은 트랜잭션으로 묶습니다. 그래서 `tag()` 메서드 자체에는 `@Transactional`을 붙이지 않습니다.
:::

::: details Q3. `self.applyAiTags(...)`처럼 자기 자신을 주입한 이유는?
`@Transactional`은 스프링 프록시를 거쳐야 적용되는데, `tag()` 안에서 같은 클래스의 `applyAiTags()`를 직접 호출하면 self-invocation이라 프록시를 안 거쳐 트랜잭션이 안 먹습니다. 그래서 `@Lazy`로 자기 자신 프록시(`self`)를 주입받아 `self.applyAiTags(...)`로 부르면, 프록시 경유라 `applyAiTags`의 `@Transactional`이 정상 적용됩니다. `@Lazy`는 순환 의존을 끊기 위한 것입니다.
:::

::: details Q4. LLM이 글에 없는 태그(환각)를 만들면 어떻게 막나요?
세 겹으로 막습니다. (1) 프롬프트가 "본문/제목에 실제 언급된 것만, 일반 상식으로 보충 금지"라고 못박고, (2) 코드가 카테고리 라벨과 동일한 태그를 `CATEGORY_LABELS` 필터로 제거하고, (3) confidence 게이트로 애매한 결과는 자동 적용하지 않습니다. 핵심은 프롬프트만 믿지 않고 **코드가 불변식을 강제**한다는 점입니다.
:::

::: details Q5. 같은 글을 여러 번 수정하면 AI 태그가 계속 쌓이지 않나요?
안 쌓입니다. `applyAiTags`는 매번 "기존 AI 태그를 usage_count 감소시키고 삭제한 뒤 새로 적용"하는 방식이라 멱등합니다. 또 새 매핑 삽입이 신규(affected==1)일 때만 `usage_count`를 올리고, 이미 존재해 `ON DUPLICATE KEY UPDATE`로 처리되면(affected!=1) 카운트를 다시 올리지 않아 중복 증가/드리프트도 막습니다.
:::

::: details Q6. 과거에 쌓인 글들은 태그가 없을 텐데 어떻게 채우나요?
`AdminTaggingController`의 백필 API로 일괄 처리합니다. `POST /api/admin/ai/tagging/backfill`은 dryRun(미리보기)·force 옵션을 받아 배치 태깅하고, `POST /api/admin/ai/tagging/{postId}`로 특정 글만 재태깅할 수도 있습니다. 신규 글은 이벤트로 자동, 과거 글은 백필로 메우는 구조입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제는 통과다.

- 글 작성부터 태그가 화면에 뜨기까지의 흐름을 **이벤트 → 비동기 리스너 → tag() 6단계** 순으로.
- confidence 0.7을 기준으로 **자동 적용 vs 추천**이 어떻게 갈리고, 화면에서 어떻게 다르게 보이는지.
- LLM 호출을 왜 트랜잭션 밖으로 뺐고, 그럼에도 DB 반영은 어떻게 트랜잭션으로 묶는지(`self` 프록시).
- 환각 방어 3겹과 usage_count 드리프트 방지를 한 문장씩.

## 퀴즈

<QuizBox question="confidence가 임계값(기본 0.7) 미만으로 나온 AI 태그는 어떻게 처리되는가?" :choices="['community_post_tag에 is_ai=1로 자동 삽입된다', 'DB에는 안 붙고 post_ai_result의 resultJson에만 남아 추천 칩으로 노출된다', '즉시 폐기되어 어디에도 저장되지 않는다', '운영자 승인 큐에 들어간다']" :answer="1" explanation="applied=false면 applyAiTags를 호출하지 않아 community_post_tag에 붙지 않는다. 결과는 post_ai_result.resultJson에만 저장되고, 프론트가 !applied일 때만 'AI 추천 태그' 칩으로 보여준다." />

<QuizBox question="AI 태깅을 @TransactionalEventListener(AFTER_COMMIT) + @Async로 비동기 실행하는 가장 큰 이유는?" :choices="['LLM 정확도를 높이려고', '최대 30초 걸리는 LLM 호출이 글 작성 트랜잭션·응답과 DB 커넥션을 점유하지 않게 하려고', '태그를 알파벳 순으로 정렬하려고', '여러 글을 한 번에 묶어 호출하려고']" :answer="1" explanation="Ollama 호출은 read-timeout 30초다. 트랜잭션에 묶으면 커넥션 풀 점유·응답 지연이 생기므로 커밋 후 전용 풀(moderationExecutor)에서 비동기로 돌린다." />

<QuizBox question="tag() 내부에서 applyAiTags()를 self(@Lazy 프록시) 경유로 호출하는 이유는?" :choices="['멀티스레드 안전성 때문에', '같은 클래스 내 직접 호출(self-invocation)이면 프록시를 안 거쳐 @Transactional이 적용되지 않기 때문', '재시도 로직을 적용하려고', 'LLM 호출을 캐싱하려고']" :answer="1" explanation="스프링 @Transactional은 프록시를 거쳐야 동작한다. self-invocation은 프록시를 우회하므로, @Lazy로 주입한 자기 자신 프록시(self)로 호출해야 applyAiTags의 트랜잭션이 적용된다." />

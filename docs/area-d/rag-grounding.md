# 면접 RAG · 근거 주입

> 답변 채점이 "환각으로 만든 기준"이 아니라 "검색해 온 평가 근거"를 보도록, Qdrant 벡터 검색으로 지식베이스 스니펫을 평가 프롬프트에 주입한다. 단, 이 RAG는 코드상 **기본 비활성(`enabled=false`)** 이며 best-effort로 동작한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

면접 RAG(Retrieval-Augmented Generation)는 **채점/평가 전에 면접 지식베이스에서 질문·답변과 의미적으로 가까운 스니펫을 벡터 검색으로 가져와 평가 프롬프트에 근거로 끼워 넣는** 구조다. 목적은 LLM이 채점 기준(루브릭)을 즉석에서 지어내(환각) 점수가 흔들리는 것을 줄이는 것.

이 페이지가 답하려는 면접 질문:

- "면접 답변 채점에 RAG를 왜 붙였고, 무엇을 검색해서 어디에 주입하나요?"
- "벡터 DB는 뭘 썼고, 임베딩·검색·주입 파이프라인이 어떻게 흐르나요?"
- "RAG가 죽거나 꺼져 있으면 면접 평가가 멈추나요?"
- "지금 실제로 켜져 동작하나요, 아니면 코드만 준비된 상태인가요?"

정직하게 먼저 답하면: **코드는 완비, 기본값은 off.** `InterviewRagProperties.enabled = false`(`InterviewRagProperties.java:19`)가 기본이라, 평소 데모/개발 환경에서는 RAG가 빈 컨텍스트를 반환하고 평가는 RAG 없이 진행된다. Qdrant를 띄우고 토글을 켜야 실제 근거 주입이 일어난다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

채점은 영역 D에서 가장 신뢰가 중요한 단계다. 사용자가 받은 점수를 납득하려면 채점 기준이 일관돼야 한다. 그런데 LLM에게 "이 답변 채점해"만 던지면 모델이 매번 자기 머릿속 기준을 새로 만들어 같은 답변에도 점수가 출렁인다. RAG의 동기는 이 기준을 **외부에서 검색해 고정**하는 것이다.

| 설계 결정 | 이유 |
| --- | --- |
| RAG를 **best-effort**로 (실패·없음 → 빈 문자열) | Qdrant는 별도 인프라다. 미기동 환경에서 면접 평가가 통째로 멈추면 안 된다. 근거가 없으면 "근거 없이" 채점한다. |
| 기본값 `enabled=false` | 데모·로컬·CI에서 Qdrant 없이도 앱이 정상 동작해야 한다. 운영에서 Qdrant를 띄울 때만 켠다. |
| 자율 루프의 **첫 액션**으로 RETRIEVE 배치 | 채점(EVALUATE)이 항상 근거를 본 뒤에 일어나도록, 검색을 평가보다 먼저 시도한다. |
| 원본은 **MySQL**, 벡터는 **Qdrant** 분리 | 지식 원문·메타는 관계형 DB에 정본으로 두고(관리·삭제·재색인 용이), 검색용 벡터만 Qdrant에 둔다. 둘이 어긋나면 reindex로 정합성 회복. |
| 임베딩은 **OpenAI** 재사용 | 임베딩 모델(`text-embedding-3-small`)을 직접 서빙하지 않고 공용 OpenAI 키를 재사용해 인프라 부담을 줄였다. |

트레이드오프는 명확하다. best-effort라서 "RAG가 켜졌는데 Qdrant가 잠깐 죽으면 그 채점만 근거 없이 진행"된다 — 일관성보다 가용성을 택한 것. 그리고 임베딩에 OpenAI를 쓰므로 RAG를 켜면 채점 1건당 임베딩 호출 1회가 추가된다(과금·지연).

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

RAG는 `interview/rag` 패키지에 모여 있고, 부르는 쪽은 채점 오케스트레이터다.

| 구성요소 | 클래스/파일 | 역할 |
| --- | --- | --- |
| 설정 토글 | `InterviewRagProperties.java` | `careertuner.interview.rag.*` — `enabled`(기본 false), `qdrantUrl`, `collection`, `embeddingModel`, `dimension`(1536), `topK`(4) |
| 지식 서비스 | `InterviewKnowledgeService.java` | CRUD + 색인 + `retrieveContext(query)` 검색·주입문자열 생성 |
| 벡터 DB 클라이언트 | `QdrantClient.java` | Qdrant REST 직접 호출(의존성 추가 없이 `HttpClient`) — `ensureCollection`/`upsert`/`delete`/`search` |
| 임베딩 클라이언트 | `EmbeddingClient.java` | OpenAI `/embeddings`로 텍스트 → 1536차원 벡터 |
| 관리 API | `InterviewKnowledgeController.java` | `/api/admin/interview/knowledge`(관리자 전용 CRUD + `/reindex`) |
| 소비처 | `InterviewAgentOrchestrator.java` | 자율 루프의 `RETRIEVE` 액션에서 호출, `ragContext`를 평가에 전달 |
| 주입 지점 | `InterviewOpenAiClient.evaluateAnswer` / `OssAnswerEvaluator` | ragContext를 "참고 자료(평가 기준·지식베이스)"로 프롬프트 임베드 |

소유 테이블은 `interview_knowledge`(`schema.sql:574-584`):

| 컬럼 | 의미 |
| --- | --- |
| `kind` | 지식 종류 — `RUBRIC`(채점 기준) / `QUESTION_BANK`(질문 은행) / `COMPANY`(기업 정보) / `GENERAL`(일반). 4종은 `KINDS = Set.of(...)`로 강제(`InterviewKnowledgeService.java:24`) |
| `title` / `content` | 원문(MySQL이 정본) |
| `source` | 출처 메모 |
| `indexed` | Qdrant 색인 완료 여부 — 색인이 best-effort라 실패 시 `false`로 남아 나중에 reindex 대상이 됨 |

벡터 자체는 이 테이블에 저장하지 않는다. 원본은 MySQL, 벡터는 Qdrant 컬렉션(`interview_knowledge`, Cosine 거리)에 분리 저장하고, **문서 id를 Qdrant 포인트 id로 같이 써서** 둘을 묶는다(`upsert(doc.getId(), ...)`, `delete(id)`).

:::tip 1536차원 = `text-embedding-3-small`
`dimension=1536`은 OpenAI `text-embedding-3-small` 임베딩의 출력 차원이다. 컬렉션 생성 시 이 값으로 벡터 크기를 못박으므로(`ensureCollection`의 `"size": dimension`), 임베딩 모델을 바꾸면 컬렉션도 다시 만들어야(reindex) 차원이 맞는다.
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 색인(쓰기) 경로 — 관리자가 지식 문서를 넣을 때

```text
관리자 → POST /api/admin/interview/knowledge (kind/title/content)
  → MySQL INSERT (indexed=false)
  → enabled 이면:  textForEmbedding = title + "\n" + content
                  → EmbeddingClient.embed → 1536차원 벡터
                  → Qdrant upsert(docId, vector, {content,kind,title})
                  → markIndexed → indexed=true
  → enabled=false 또는 색인 실패: 본문은 저장, indexed=false 로 남음
```

핵심은 **본문 저장과 색인을 분리**한 점이다. 색인이 실패해도(`catch (RuntimeException)`) 본문 INSERT는 롤백되지 않고, `indexed=false`로 남아 `POST /reindex`로 나중에 일괄 재색인할 수 있다(`reindexAll`).

### 4.2 검색(읽기) 경로 — 채점 직전에 근거를 가져올 때

자율 평가 루프(`InterviewAgentOrchestrator`)의 첫 액션이 `RETRIEVE`다. 규칙 정책은 "아직 RAG를 시도 안 했으면 무조건 먼저 RETRIEVE"로 시작한다(`RulePolicy.decide` → `if (!ctx.ragAttempted) return RETRIEVE`).

```java
// runRetrieve — 질문 + 답변을 쿼리로 묶어 근거를 가져온다 (요약)
ctx.ragAttempted = true;
String context = knowledgeService.retrieveContext(question + "\n" + answerText);
ctx.ragContext = context;
if (context != null && !context.isBlank()) {
    ctx.hasRag = true;               // 근거가 실제로 잡혔을 때만 trace step 기록
    logStep(ctx, "RETRIEVER", "retrieve", DONE, "지식베이스 근거 주입", ...);
}
```

`retrieveContext` 내부는 이렇게 흐른다:

| 단계 | 내용 | 비활성/실패 시 |
| --- | --- | --- |
| 가드 | `enabled==false` 또는 쿼리 공백 | **즉시 빈 문자열 반환** |
| 임베딩 | `embeddingClient.embedAsList(query)` → 벡터 | 예외 → catch → 빈 문자열 |
| 검색 | `qdrantClient.search(vector, topK=4)` → 상위 4건 | 결과 0건 → 빈 문자열 |
| 조립 | 각 hit를 `"1. [제목] 본문"` 형태로 번호 매겨 합침 | — |

검색은 코사인 유사도 상위 `topK`(기본 4)건을 가져와, payload의 `title`/`content`만 골라 번호 붙은 한 덩어리 텍스트로 만든다. 점수(`score`)나 `kind`는 가져오긴 하지만 주입 문자열에는 제목·본문만 쓴다.

### 4.3 주입 지점 — 평가 프롬프트에 "참고 자료"로 박힌다

`ragContext`는 채점기(`InterviewOpenAiClient.evaluateAnswer`)와 OSS 평가기(`OssAnswerEvaluator`) **둘 다** userPrompt에 끼워진다. OpenAI 경로는 이렇게 조립한다(`InterviewOpenAiClient.java:82-98`, 요약):

```java
String reference = ragContext.isBlank() ? ""
        : "\n참고 자료(평가 기준·지식베이스):\n" + ragContext + "\n";
// userPrompt = 회사명/직무명 + reference(RAG) + 기준 모범답안 + 질문 + 지원자 답변
```

즉 RAG 근거는 **시스템 프롬프트(채점 규칙)와 별개로, userPrompt 안에 "참고 자료" 블록**으로 들어간다. 그래서 RAG가 비어 있으면 그 블록이 통째로 사라질 뿐, 채점 자체는 그대로 돌아간다.

### 4.4 RAG 사용 흔적은 trace와 학습 데이터에 남는다

- `ctx.hasRag`(근거가 실제로 잡혔는지)는 `interview_agent_step`의 RETRIEVER 단계로 사용자/관리자에게 보이고(주입됐을 때만 step 기록),
- `interview_training_sample.rag_used`(`schema.sql`, `InterviewTrainingSample.ragUsed`)에 `ctx.hasRag`가 그대로 적재된다 → 나중에 "RAG 켠 채점 vs 안 켠 채점" 품질을 학습 데이터에서 구분할 수 있다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

:::warning 가장 중요한 정직 포인트: 코드는 완비, 기본값은 off
RAG 파이프라인(임베딩·색인·검색·주입·관리 CRUD·reindex)은 **전부 구현되어 런타임에 동작 가능**하다. 하지만 `InterviewRagProperties.enabled` 기본값이 **`false`**(`InterviewRagProperties.java:19`)라, 토글을 켜고 Qdrant를 띄우지 않는 한 `retrieveContext`는 항상 빈 문자열을 반환한다. 즉 **평소 채점은 RAG 근거 없이 이뤄진다.**
:::

| 항목 | 상태 |
| --- | --- |
| 색인(임베딩→Qdrant upsert), best-effort 분리 | 구현됨 |
| 벡터 검색(코사인 topK) → 주입 문자열 생성 | 구현됨 |
| 평가 프롬프트에 RAG 근거 주입(OpenAI·OSS 양쪽) | 구현됨 |
| 자율 루프 첫 액션 RETRIEVE + trace·`rag_used` 기록 | 구현됨 |
| 관리자 CRUD + `/reindex` | 구현됨 |
| **운영 기본 활성화** | **계획 — 기본 off, Qdrant 띄우고 토글 켜야 동작** |
| 채점 외 단계(질문 생성 등)로 RAG 확대 | 계획/부분 — 현재 RAG 소비처는 **답변 평가 루프**(EVALUATE/REEVALUATE)뿐. 질문 생성은 RAG 미사용 |
| kind별 차등 검색(RUBRIC만 우선 등) | 미구현 — 현재 검색은 kind 필터 없이 유사도 top-K 전체에서 가져옴 |

핵심을 한 문장으로: **"RAG는 채점 신뢰를 높이려고 만든 환각 완화 장치이고, 코드는 다 됐지만 기본은 꺼져 있어 켜는 순간 근거 주입이 시작되는 구조"** 다. 면접에서 이걸 "다 돌아갑니다"라고만 말하면 과장이다. "구현 완비 + 기본 비활성 + best-effort"를 같이 말하는 게 정확하다.

## 6. 면접 답변 3단계

1. **무엇 (10초):** "면접 답변 채점에 RAG를 붙였습니다. 채점하기 전에 면접 지식베이스(채점 루브릭·질문은행·기업정보)에서 질문·답변과 의미적으로 가까운 스니펫을 Qdrant 벡터 검색으로 가져와, 평가 프롬프트에 '참고 자료'로 주입합니다. LLM이 채점 기준을 즉석에서 지어내는 환각을 줄이는 게 목적입니다."

2. **어떻게 (30초):** "원본은 MySQL `interview_knowledge`, 벡터는 Qdrant에 문서 id를 공유키로 분리 저장합니다. 임베딩은 OpenAI `text-embedding-3-small`(1536차원)을 재사용합니다. 채점 자율 루프의 첫 액션이 RETRIEVE라, EVALUATE 전에 항상 검색을 시도합니다. 검색은 코사인 유사도 상위 4건을 가져와 번호 붙인 텍스트로 만들고, OpenAI·자체모델 평가기 양쪽 userPrompt에 끼웁니다."

3. **트레이드오프·정직 (20초):** "전부 best-effort입니다. Qdrant가 꺼져 있거나 검색이 실패하면 `retrieveContext`가 빈 문자열을 돌려주고 채점은 근거 없이 그대로 진행됩니다 — 인프라 의존이 면접 흐름을 끊지 않게요. 그래서 기본값도 `enabled=false`입니다. 코드는 색인·검색·주입·재색인까지 다 구현돼 있지만, 운영에서 Qdrant를 띄우고 토글을 켜야 실제 근거 주입이 일어납니다. 지금 데모 기본 상태에서는 채점이 RAG 없이 돌고 있다는 게 정확한 표현입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. RAG가 꺼져 있거나 Qdrant가 죽으면 채점이 멈추나요?
안 멈춥니다. `retrieveContext`는 `enabled==false`, 쿼리 공백, 임베딩/검색 예외, 결과 0건 — 이 모든 경우에 **빈 문자열**을 반환합니다(`InterviewKnowledgeService.java:147-173`). 호출부 `runRetrieve`는 컨텍스트가 비면 `ctx.hasRag`를 안 세우고 trace step도 안 남긴 채 다음 액션(EVALUATE)으로 넘어갑니다. 평가 프롬프트에서는 "참고 자료" 블록이 통째로 사라질 뿐, 채점 로직은 동일하게 돌아갑니다. 가용성을 일관성보다 우선한 best-effort 설계입니다.
:::

:::details Q2. 검색 쿼리로 무엇을 임베딩하나요? 질문만? 답변만?
질문과 답변을 **함께** 묶습니다 — `retrieveContext(question + "\n" + answerText)`(`InterviewAgentOrchestrator.java:156`). 질문만 쓰면 일반적 루브릭만, 답변만 쓰면 맥락 없는 검색이 되니, 둘을 합쳐 "이 질문에 이렇게 답했을 때 어떤 평가 기준이 관련 있나"를 의미 검색하게 했습니다. 결과는 코사인 상위 `topK=4`건입니다.
:::

:::details Q3. 왜 원본을 MySQL에, 벡터를 Qdrant에 따로 두나요? 한 곳에 안 두고?
정본 관리와 검색을 분리하기 위해서입니다. 원문·메타·`indexed` 플래그는 관계형 DB가 다루기 좋고(CRUD·삭제·이력), 벡터 유사도 검색은 전용 벡터 DB가 빠릅니다. 둘은 **문서 id를 공유키**로 묶습니다 — `upsert(doc.getId(), ...)`, 삭제도 `qdrantClient.delete(id)`. 둘이 어긋나도(색인 실패 등) `indexed=false`로 표시되고 `POST /reindex`로 MySQL 원본을 다시 색인해 정합성을 회복합니다.
:::

:::details Q4. 임베딩 모델을 직접 서빙하지 않고 OpenAI를 쓴 이유는?
인프라 부담 때문입니다. 채점·생성용 자체 LLM은 별도로 연구 중이지만, 임베딩까지 자체 서빙하면 운영 복잡도가 커집니다. `EmbeddingClient`는 공용 OpenAI 키·baseUrl(`OpenAiProperties`)을 재사용해 `/embeddings`만 호출합니다. 대신 RAG를 켜면 채점 1건당 임베딩 호출 1회가 추가돼 과금·지연이 늘어나는 트레이드오프가 있습니다.
:::

:::details Q5. RAG 근거는 시스템 프롬프트에 넣나요, userPrompt에 넣나요? 차이가 뭔가요?
**userPrompt**에 "참고 자료(평가 기준·지식베이스)" 블록으로 넣습니다(`InterviewOpenAiClient.java:82-84`). 시스템 프롬프트(채점 규칙·출력 스키마)는 고정이고, RAG는 매 채점마다 달라지는 가변 입력이라 userPrompt가 맞습니다. 이렇게 분리해서, RAG가 비면 그 블록만 빠지고 채점 규칙은 그대로 유지됩니다. OpenAI 평가기와 OSS 평가기 양쪽이 같은 패턴으로 주입합니다.
:::

:::details Q6. RAG를 켰는지 안 켰는지 사후에 어떻게 구분하나요?
두 군데에 흔적이 남습니다. (1) 근거가 실제로 잡힌 채점은 `interview_agent_step`에 RETRIEVER "지식베이스 근거 주입" 단계가 기록돼 사용자/관리자 trace에 보입니다. (2) `interview_training_sample.rag_used`에 `ctx.hasRag` 값이 적재됩니다(`InterviewAgentOrchestrator.java:126`). 그래서 학습 데이터에서 "RAG 주입된 채점 샘플"을 따로 골라, RAG가 채점 품질에 미친 영향을 정량적으로 비교할 수 있게 설계했습니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 1분 안에 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 지식 문서 한 건이 MySQL과 Qdrant에 각각 어떻게 저장되고, 둘을 무엇으로 묶는지.
2. 채점 자율 루프에서 RETRIEVE가 EVALUATE보다 먼저 일어나도록 보장하는 규칙 정책의 조건.
3. Qdrant가 죽었을 때 채점이 멈추지 않는 이유를 코드 경로(`retrieveContext` → 빈 문자열 → `runRetrieve`)로.
4. "RAG가 잘 돌아갑니다"가 왜 부정확하고, 정확히는 어떻게 말해야 하는지(`enabled=false` 기본).
5. RAG 근거가 시스템 프롬프트가 아니라 userPrompt의 "참고 자료" 블록에 들어가는 이유.

## 퀴즈

<QuizBox question="면접 RAG가 켜져 있는데 Qdrant 검색이 예외를 던지면 어떻게 되나요?" :choices="['채점이 BusinessException으로 실패한다', 'retrieveContext가 빈 문자열을 반환하고 채점은 근거 없이 그대로 진행된다', '자동으로 Claude 폴백으로 전환된다', '재시도를 3회 한 뒤 사용자에게 에러를 보여준다']" :answer="1" explanation="retrieveContext는 비활성·쿼리공백·임베딩/검색 예외·결과0건 모두에서 빈 문자열을 반환하는 best-effort 설계다. 호출부 runRetrieve는 컨텍스트가 비면 ctx.hasRag를 세우지 않고 다음 액션(EVALUATE)으로 넘어가, 평가는 RAG 근거 없이 동일하게 돌아간다." />

<QuizBox question="면접 RAG의 코드 기준 기본 활성화 상태는?" :choices="['enabled=true — 항상 근거를 주입한다', 'enabled=false — 켜고 Qdrant를 띄워야 실제 주입이 일어난다', '환경에 따라 자동 감지된다', '관리자가 지식 문서를 1건이라도 넣으면 자동으로 켜진다']" :answer="1" explanation="InterviewRagProperties.enabled의 기본값은 false다. Qdrant 미기동 환경에서도 앱이 정상 동작하도록 한 결정이며, 운영에서 Qdrant를 띄우고 careertuner.interview.rag.enabled를 켜야 검색·주입이 실제로 동작한다. 코드는 완비, 기본은 off." />

<QuizBox question="RAG 근거(ragContext)는 채점 LLM 호출 시 어디에 들어가나요?" :choices="['시스템 프롬프트(채점 규칙) 안에 합쳐진다', 'userPrompt의 \'참고 자료(평가 기준·지식베이스)\' 블록으로 들어간다', '별도 function call 인자로 전달된다', 'JSON 스키마의 required 필드로 강제된다']" :answer="1" explanation="ragContext는 evaluateAnswer에서 userPrompt 안에 '참고 자료' 블록으로 임베드된다(OpenAI·OSS 평가기 공통). 시스템 프롬프트는 고정된 채점 규칙·출력 스키마이고, 매 채점마다 달라지는 가변 근거는 userPrompt가 맞다. 그래서 RAG가 비면 그 블록만 빠지고 채점 규칙은 유지된다." />

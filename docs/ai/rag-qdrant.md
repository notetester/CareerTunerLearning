# RAG와 벡터DB (Qdrant)

> RAG는 LLM이 답하기 직전에 외부 지식베이스에서 관련 문서를 검색해 프롬프트에 끼워 넣어, 모델이 자기 기억이 아니라 근거를 보고 답하게 만드는 기법입니다.

## 1. 한 줄 정의

RAG(검색 증강 생성)는 **"질문 → 관련 문서 검색 → 그 문서를 프롬프트에 주입 → LLM이 그 근거로 답변"** 순서로 동작하는 패턴이고, 그 "검색"을 의미 기반으로 빠르게 해주는 저장소가 **벡터DB(Qdrant)**입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| RAG | **R**etrieval-**A**ugmented **G**eneration. 생성(Generation)을 검색(Retrieval)으로 증강(Augmented). |
| 임베딩(Embedding) | 텍스트를 의미를 담은 숫자 벡터로 바꾸는 것. 예: 1536차원 실수 배열. 뜻이 비슷한 문장은 벡터 공간에서 가까워진다. |
| 벡터DB | 벡터를 저장하고 "가장 가까운 K개"를 빠르게 찾아주는 DB. CareerTuner는 **Qdrant** 사용. |
| 코사인 유사도 | 두 벡터가 이루는 각도로 유사도를 잰다. 길이 무시·방향만 봄. Qdrant 컬렉션 distance를 `Cosine`으로 생성. |
| topK | 검색에서 가장 유사한 상위 몇 개를 가져올지. CareerTuner 기본 `topK=4`. |
| 컨텍스트 주입 | 검색된 문서 조각을 LLM 프롬프트에 함께 넣는 행위. |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

LLM은 학습 시점까지의 일반 지식만 안다. 그래서 그냥 물어보면 세 가지 문제가 생긴다.

- **환각(Hallucination):** 모르는 걸 그럴듯하게 지어낸다. 면접 답변을 채점할 때 "이 회사 평가 기준"을 모델이 멋대로 상상하면 채점이 망가진다.
- **최신성/사내 지식 부재:** 모델은 우리 채점 루브릭, 회사별 인재상, 자체 질문 은행을 모른다. 파인튜닝으로 넣으려면 비싸고 느리다.
- **출처 없음:** 왜 그렇게 답했는지 근거를 댈 수 없다.

RAG는 모델 가중치를 건드리지 않고, **답변 직전에 우리 문서를 검색해 프롬프트에 넣어** 이 셋을 한 번에 완화한다. "기억으로 답하지 말고, 이 근거를 보고 답해"라고 강제하는 셈이다.

:::tip 핵심 직관
파인튜닝이 "모델을 다시 가르치기"라면, RAG는 "시험 볼 때 오픈북으로 우리 교재를 펴주기"다. CareerTuner는 채점/질문 생성에 오픈북 방식을 택했다.
:::

## 4. CareerTuner에서 어디에 썼나 (영역 D/E · 일부 C 공통)

면접 RAG는 가상 면접(영역 D/E)의 **답변 채점 근거 주입**에 쓴다. 코드는 `backend/.../interview/rag/` 패키지에 모여 있다.

| 구성요소 | 클래스/파일 | 역할 |
| --- | --- | --- |
| 설정 | `InterviewRagProperties` | `careertuner.interview.rag.*` 바인딩. `enabled`(기본 false), `qdrantUrl`, `collection=interview_knowledge`, `embeddingModel=text-embedding-3-small`, `dimension=1536`, `topK=4` |
| 임베딩 | `EmbeddingClient` | OpenAI `/embeddings` 호출. 텍스트 → 1536차원 벡터. 키/baseUrl은 공통 OpenAI 설정 재사용 |
| 벡터DB 클라 | `QdrantClient` | Qdrant REST를 의존성 없이 `HttpClient`로 직접 호출. `ensureCollection`(Cosine 생성)·`upsert`·`delete`·`search` |
| 지식베이스 서비스 | `InterviewKnowledgeService` | 원본은 MySQL, 벡터는 Qdrant. 문서 추가/수정/삭제·전체 재색인(`reindexAll`)·검색(`retrieveContext`) |
| 관리 API | `InterviewKnowledgeController` | 관리자만 지식 문서 CRUD·재색인 |
| 소비 지점 | `InterviewAgentOrchestrator`(RETRIEVER 단계) | 채점 직전에 근거를 검색해 Evaluator 프롬프트에 주입 |
| 인프라 | `docker-compose.yml`의 `qdrant` 서비스(`qdrant/qdrant`, REST 6333) | 환경변수 `QDRANT_URL`로 백엔드와 연결 |

지식 문서 종류(`kind`)는 `RUBRIC`(채점 기준), `QUESTION_BANK`(질문 은행), `COMPANY`(회사 정보), `GENERAL` 4가지다. 원본 텍스트는 `interview_knowledge` 테이블(MySQL)에, 그 임베딩 벡터는 Qdrant `interview_knowledge` 컬렉션에 들어간다.

:::warning 구현 상태 — 정직하게
면접 RAG 코드는 **구현되어 있지만 기본 비활성(`enabled=false`)**이다. Qdrant와 토글을 함께 켜야 근거가 주입된다. C는 별도의 RAG hard-case 실험 후 단순 주입의 이득이 충분하지 않다는 `KEEP_RAG_DISABLED` 결론을 유지한다. C 자체 모델은 학습·서비스 연결이 검증됐지만 기본 provider는 OpenAI다.
:::

## 5. 핵심 동작 원리 (색인 / 검색 2단계)

RAG는 항상 **(1) 색인(쓰기)** 과 **(2) 검색(읽기)** 두 흐름으로 나뉜다.

### (1) 색인 — 관리자가 지식 문서를 넣을 때

```text
관리자가 문서 추가
  → MySQL interview_knowledge 에 원본 저장 (indexed=false)
  → EmbeddingClient: (제목+본문) → 1536차원 벡터
  → QdrantClient.ensureCollection() (없으면 Cosine 컬렉션 생성)
  → QdrantClient.upsert(id, vector, payload{content,kind,title})
  → markIndexed (indexed=true)
```

`upsert`는 같은 id면 덮어쓰므로, 문서 수정 시 같은 id로 재색인하면 자동 갱신된다. `dimension`(1536)은 **임베딩 모델 출력 차원과 반드시 일치**해야 한다.

### (2) 검색 — 면접 답변을 채점할 때

`InterviewAgentOrchestrator`의 RETRIEVER 단계가 호출한다.

```java
// retrieveContext(question + "\n" + answer)
List<Float> vector = embeddingClient.embedAsList(query);          // 질의도 같은 모델로 임베딩
List<SearchHit> hits = qdrantClient.search(vector, topK);         // Cosine 상위 4개
// hits 의 title/text 를 번호 매겨 한 덩어리 문자열로 → Evaluator 프롬프트에 주입
```

그 결과 문자열(`ctx.ragContext`)이 `evaluator.evaluateAnswer(... ragContext ...)`로 들어가 채점 근거가 된다.

### best-effort 설계가 핵심 포인트

CareerTuner RAG는 **장애가 면접 흐름을 끊지 않도록** 설계됐다. 면접 답변 평가 같은 중요 기능을 부가 인프라(Qdrant)에 인질로 잡히지 않게 한 것이다.

| 상황 | 동작 |
| --- | --- |
| RAG 비활성/질의 빈 값 | `retrieveContext`가 빈 문자열 → 근거 없이 채점 진행 |
| Qdrant 다운·예외 | `try/catch`로 삼키고 빈 컨텍스트 반환, 색인은 `indexed=false`로 남김 |
| 색인 실패 | MySQL 원본은 유지, 나중에 `reindexAll`로 정합성 회복 |
| 결과 없음 | 빈 컨텍스트 → RETRIEVER 단계 기록도 남기지 않고 다음으로 |

## 6. 면접 답변 3단계

- **초간단 1문장:** "RAG는 LLM이 답하기 전에 우리 지식베이스에서 관련 문서를 의미 검색해 프롬프트에 넣어, 환각을 줄이고 근거 있게 답하게 하는 패턴입니다."
- **기본:** "텍스트를 임베딩으로 바꿔 벡터DB Qdrant에 저장해두고, 질문이 오면 질문도 같은 모델로 임베딩해서 코사인 유사도 상위 K개를 검색합니다. 그 문서 조각을 프롬프트에 주입하면 모델이 자기 기억이 아니라 그 근거를 보고 답합니다. 저희는 면접 답변 채점에 채점 루브릭·회사 정보 같은 지식을 RAG로 주입했습니다."
- **꼬리질문 대응:** "원본은 MySQL, 벡터는 Qdrant로 이원화했고, 색인과 검색을 모두 best-effort로 설계해 Qdrant가 죽어도 면접 평가 흐름은 빈 컨텍스트로 계속 진행됩니다. Qdrant 클라이언트는 의존성을 늘리지 않으려고 REST를 `HttpClient`로 직접 호출했고, 컬렉션 distance는 Cosine, 차원은 임베딩 모델(1536)에 맞췄습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 파인튜닝과 RAG 중 왜 RAG를 골랐나?
파인튜닝은 모델 가중치를 다시 학습해야 해서 비용·시간이 크고, 채점 루브릭이나 회사 정보가 바뀔 때마다 재학습이 필요합니다. RAG는 문서만 갱신하면 즉시 반영되고(우리는 `upsert`로 같은 id 덮어쓰기), 출처를 프롬프트에 남길 수 있습니다. 자주 바뀌는 지식·근거 추적이 필요한 채점에는 RAG가 적합합니다.
:::

:::details Q. 왜 그냥 키워드 검색(LIKE)이 아니라 벡터 검색인가?
키워드 검색은 글자가 겹쳐야 찾습니다. "협업 경험"과 "팀워크 사례"는 글자가 안 겹쳐도 의미는 같은데, 임베딩 벡터로 바꾸면 의미가 가까운 문장끼리 벡터 공간에서 가까워져 코사인 유사도로 잡힙니다. 면접 질문·답변처럼 표현이 제각각인 자연어에는 의미 검색이 유리합니다.
:::

:::details Q. 환각을 RAG가 완전히 없애나?
아닙니다. RAG는 "근거를 줄" 뿐, 모델이 그 근거를 무시하거나 잘못 해석할 수 있습니다. 그래서 CareerTuner는 채점에서 점수·판정을 모델 출력에만 맡기지 않고 서버 규칙·검증으로 보정하는 구조를 함께 둡니다. RAG는 환각을 줄이는 장치이지 보증이 아닙니다.
:::

:::details Q. 차원(dimension)을 왜 임베딩 모델과 맞춰야 하나?
Qdrant 컬렉션은 생성 시점에 벡터 크기(size)가 고정됩니다. 임베딩 모델 출력이 1536차원인데 컬렉션을 다른 크기로 만들면 upsert·search가 거부됩니다. 그래서 `dimension=1536`을 `text-embedding-3-small` 출력에 맞췄고, 모델을 바꾸면 컬렉션도 재생성·재색인해야 합니다.
:::

:::details Q. topK는 어떻게 정하나? 크게 하면 좋은가?
topK는 검색 상위 몇 개를 가져올지입니다. 너무 작으면 근거가 부족하고, 너무 크면 관련 없는 문서까지 들어와 프롬프트가 길어지고(토큰 비용↑) 노이즈로 오히려 답이 흐려집니다. CareerTuner는 기본 4로 두고, 필요하면 설정으로 조정합니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 화이트보드 없이 30초 안에 "사용자 질문이 들어와서 LLM이 답하기까지" RAG 파이프라인을 색인 단계와 검색 단계로 나눠 말해보세요. (임베딩 → Qdrant 코사인 검색 → 컨텍스트 주입이 다 나와야 함)
2. "Qdrant가 갑자기 죽으면 면접 채점은 어떻게 되나요?"에 대해, CareerTuner의 best-effort 설계와 MySQL/Qdrant 이원화를 근거로 1분간 설명해보세요.

관련 페이지: [임베딩과 벡터](/ai/embedding) · [환각(Hallucination)](/ai/hallucination) · [LLM 프롬프트 설계](/ai/prompt-catalog) · [Docker Compose](/infra/docker-compose)

## 퀴즈

<QuizBox question="RAG에서 벡터DB(Qdrant)가 담당하는 핵심 역할은?" :choices="['LLM 가중치를 재학습한다', '질의 벡터와 가장 유사한 상위 K개 문서를 빠르게 찾아준다', '프롬프트를 한국어로 번역한다', 'JWT 토큰을 검증한다']" :answer="1" explanation="벡터DB는 임베딩된 문서를 저장하고 코사인 유사도로 가장 가까운 topK를 빠르게 검색하는 저장소다. CareerTuner는 Qdrant 컬렉션을 Cosine distance로 생성한다." />

<QuizBox question="CareerTuner 면접 RAG에서 Qdrant가 다운되면 답변 채점 흐름은 어떻게 되는가?" :choices="['전체 면접이 500 에러로 중단된다', '근거 없이(빈 컨텍스트로) 채점을 계속 진행한다', '자동으로 파인튜닝 모드로 전환된다', 'MySQL 원본도 함께 삭제된다']" :answer="1" explanation="retrieveContext는 비활성/장애/결과없음일 때 빈 문자열을 반환하는 best-effort 설계다. 부가 인프라 장애가 면접 평가 같은 핵심 기능을 끊지 않게 한 것이 포인트다." />

<QuizBox question="임베딩 모델 출력 차원과 Qdrant 컬렉션의 벡터 size를 일치시켜야 하는 이유를 설명하라." explanation="Qdrant 컬렉션은 생성 시점에 벡터 크기가 고정되며, upsert와 search 모두 그 크기의 벡터만 받는다. CareerTuner는 text-embedding-3-small의 출력에 맞춰 dimension을 1536으로 두고 Cosine distance로 컬렉션을 생성한다. 임베딩 모델을 바꾸면 출력 차원이 달라지므로 컬렉션을 재생성하고 전체 문서를 reindexAll로 재색인해야 한다." />

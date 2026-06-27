# 임베딩과 벡터 검색 (Embedding)

> 텍스트를 "의미가 담긴 숫자 배열(벡터)"로 바꿔, 글자가 달라도 뜻이 비슷한 것을 코사인 유사도로 찾아내는 기술. RAG의 검색 단계를 떠받친다.

## 1. 한 줄 정의

임베딩은 텍스트·이미지 같은 데이터를 **의미가 보존된 고차원 실수 벡터**로 변환하는 것이고, 벡터 검색은 그 벡터들 사이의 **거리/유사도**로 "의미가 가까운 것"을 찾는 것이다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 풀이 | 한 줄 의미 |
| --- | --- | --- |
| Embedding | embed(끼워 넣다) | 의미를 좌표 공간 안에 끼워 넣는다 → 벡터 |
| Vector | 방향+크기를 가진 수의 배열 | `[0.013, -0.21, ..., 0.08]` (예: 1536개) |
| Dimension | 차원 = 벡터의 길이 | CareerTuner 면접 RAG는 `1536`차원 |
| Cosine similarity | 두 벡터가 이루는 각의 코사인 | 1에 가까울수록 같은 방향=의미 유사 |
| Vector DB | 벡터 저장·근접 검색 전용 DB | CareerTuner는 **Qdrant** |
| RAG | Retrieval-Augmented Generation | 검색으로 근거를 찾아 LLM에 주입 |

핵심 직관: **방향이 의미다.** 길이(크기)는 코사인에서 무시되고, 두 벡터가 같은 방향을 가리키면 의미가 비슷하다고 본다.

## 3. 왜 필요한가 (없으면 무슨 문제)

키워드 검색(LIKE, 전문검색)은 **글자가 겹쳐야** 찾는다. 면접 지식베이스에서 사용자가 "협업하다 갈등 났을 때 어떻게 했나요"라고 물으면, 정답 루브릭에 "갈등"이라는 단어가 없고 "팀 내 의견 충돌 조율"이라고 적혀 있으면 키워드 검색은 **놓친다.**

| 구분 | 키워드 검색 | 벡터(의미) 검색 |
| --- | --- | --- |
| 매칭 기준 | 글자 일치 | 의미 근접 |
| "갈등" vs "의견 충돌" | 못 찾음 | 찾음 |
| 동의어/말 바꿈 | 약함 | 강함 |
| 오타·구어체 | 약함 | 비교적 강함 |
| 정확한 코드/ID 검색 | 강함 | 오히려 약할 수 있음 |

:::tip
둘은 대체가 아니라 보완이다. 실무에선 키워드 검색과 벡터 검색을 합치는 **하이브리드 검색**도 흔하다. CareerTuner 면접 RAG는 현재 벡터 검색 단일 경로로 구현돼 있다.
:::

없으면 생기는 문제: LLM이 근거 없이 일반론만 답한다(환각 위험↑). 검색으로 **회사·직무 맞춤 근거**를 주입해야 면접 평가/질문이 구체화된다.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

면접(영역 D) RAG 파이프라인에 임베딩+벡터 검색이 실제로 구현돼 있다. 원본 텍스트는 MySQL, 벡터는 Qdrant에 둔다.

| 역할 | 클래스 / 위치 |
| --- | --- |
| 텍스트 → 벡터 (OpenAI 임베딩 API) | `interview/rag/EmbeddingClient.java` |
| Qdrant REST 클라이언트(컬렉션·업서트·검색) | `interview/rag/QdrantClient.java` |
| 색인/검색 오케스트레이션 | `interview/rag/InterviewKnowledgeService.java` |
| 설정값(enabled·url·차원·topK) | `interview/rag/InterviewRagProperties.java` |
| 컬렉션명 | Qdrant collection `interview_knowledge` |
| 원본 보관 테이블 | `interview_knowledge` (MySQL) |

설정 키 (`application.yaml` → `careertuner.interview.rag.*`, `ENV:기본값` 패턴):

| 키 | 기본값 | 의미 |
| --- | --- | --- |
| `INTERVIEW_RAG_ENABLED` | `true` | RAG 온/오프 |
| `QDRANT_URL` | `http://localhost:6333` | 벡터DB 주소 |
| `INTERVIEW_RAG_EMBEDDING_MODEL` | `text-embedding-3-small` | 임베딩 모델 |
| `INTERVIEW_RAG_DIMENSION` | `1536` | 벡터 차원(컬렉션과 일치 필수) |
| `INTERVIEW_RAG_TOPK` | `4` | 검색 상위 N개 |

다른 곳에도 임베딩이 쓰인다(영역 F 등): 지원 챗봇 FAQ 검색은 **Ollama 임베딩**(`support/chatbot/OllamaEmbeddingClient.java`, 모델 `bge-m3`)을 쓰고, 커뮤니티 글 의미 검색(`community/search/CommunityEmbeddingService.java`)도 존재한다. 즉 임베딩 공급자는 한 곳이 아니라 용도별로 OpenAI/Ollama가 섞여 있다.

:::warning 정직한 구분
면접 RAG의 임베딩 생성·Qdrant 업서트·코사인 검색·프롬프트 주입까지는 **구현됨**. 다만 `EmbeddingClient`는 OpenAI 키를 요구하므로, 키 미발급 환경에서는 색인이 best-effort로 실패하고 `indexed=false`로 남는다(본문 저장은 유지). 자체 LLM 기반 분석 경로 일부는 **계획** 단계다.
:::

## 5. 핵심 동작 원리 (표·작은 코드)

전체 흐름은 **색인(쓰기)** 과 **검색(읽기)** 두 갈래다.

```text
[색인] 지식 문서 ─embed→ 벡터 ─upsert(id,vector,payload)→ Qdrant
[검색] 질의문 ─embed→ 벡터 ─search(topK)→ 코사인 상위 N ─→ 프롬프트 주입
```

**(1) 텍스트 → 벡터.** `EmbeddingClient`가 OpenAI `/embeddings`를 호출해 `float[]`을 받는다. 모델이 1536개의 실수를 돌려준다.

```java
// EmbeddingClient.embed() 요지
body.put("model", ragProperties.getEmbeddingModel()); // text-embedding-3-small
body.put("input", text);
// 응답 data[0].embedding → float[1536]
```

**(2) 저장.** 컬렉션을 만들 때 거리 함수를 **Cosine**으로, 크기를 `dimension`으로 고정한다. 이후 문서 id를 키로 업서트.

```java
// QdrantClient.ensureCollection()
Map.of("vectors", Map.of("size", 1536, "distance", "Cosine"));
// upsert(id, vector, payload{content,kind,title})
```

**(3) 검색.** 질의문을 같은 모델로 임베딩한 뒤 `topK`개를 받아온다. Qdrant가 코사인 점수 내림차순으로 돌려준다.

```java
// QdrantClient.search(vector, topK) 응답 매핑
new SearchHit(payload.content, payload.kind, payload.title, item.score);
```

**(4) 주입.** `InterviewKnowledgeService.retrieveContext()`가 히트들을 번호 매긴 문자열로 합쳐 프롬프트에 넣는다. **점수/판정 같은 최종 결론은 검색 결과가 아니라 서버 로직이 확정**한다(검색은 근거 제공일 뿐).

코사인 유사도 한 줄 정의:

```text
cos(θ) = (A·B) / (|A| × |B|)    # 1=동일방향, 0=무관, -1=반대
```

설계상 중요한 두 가지:
- **차원 일치**: 임베딩 모델 차원과 컬렉션 `size`가 다르면 검색이 깨진다. 그래서 `dimension`과 모델을 한 묶음으로 관리한다.
- **best-effort**: Qdrant가 죽어 있어도 면접 흐름을 끊지 않는다. 색인 실패 시 `indexed=false`, 검색 실패 시 빈 컨텍스트로 진행한다.

자세한 검색 단계 전반은 [RAG와 Qdrant](/ai/rag-qdrant) 참고.

## 6. 면접 답변 3단계

**초간단(15초):** "임베딩은 텍스트를 의미가 담긴 숫자 벡터로 바꾸는 거고, 코사인 유사도로 의미가 비슷한 문서를 찾습니다. 키워드가 안 겹쳐도 뜻이 가까우면 검색됩니다."

**기본(40초):** "CareerTuner 면접 기능에서 관리자가 등록한 루브릭·질문은행을 OpenAI 임베딩으로 1536차원 벡터로 만들어 Qdrant에 코사인 거리로 저장합니다. 사용자 질의가 들어오면 같은 모델로 임베딩해 상위 4개를 검색하고, 그 근거를 LLM 프롬프트에 주입해 평가/질문을 구체화합니다. 원본은 MySQL, 벡터는 Qdrant로 책임을 나눴습니다."

**꼬리질문 대비(요지):** 차원/거리함수 일치의 중요성, best-effort 설계로 Qdrant 장애 시에도 흐름이 안 끊기는 점, 점수 같은 최종 판정은 검색이 아니라 서버 규칙이 확정한다는 점을 덧붙인다.

## 7. 꼬리질문 + 모범답안

:::details Q1. 키워드 검색이 아니라 벡터 검색을 쓴 이유는?
면접 답변과 루브릭은 같은 뜻을 다른 단어로 표현하는 경우가 많습니다("갈등" vs "의견 충돌"). 키워드 검색은 글자가 겹쳐야 맞지만 임베딩은 의미 근접으로 찾으므로 동의어·말 바꿈·구어체에 강합니다. 정확한 ID/코드 매칭이 필요하면 키워드가 낫고, 실무에선 하이브리드로 합치기도 합니다.
:::

:::details Q2. 코사인 유사도가 정확히 뭔가요? 유클리드 거리와 차이는?
코사인은 두 벡터의 **방향**이 얼마나 같은지를 봅니다(`A·B/(|A||B|)`). 크기는 무시하므로 문장 길이 차이의 영향을 덜 받습니다. 유클리드는 좌표상 **직선 거리**라 크기에 민감합니다. 텍스트 임베딩은 보통 정규화돼 방향이 의미를 결정하므로 코사인이 표준이고, CareerTuner도 컬렉션을 `distance: Cosine`으로 생성합니다.
:::

:::details Q3. 벡터 차원이 1536인데, 차원이 바뀌면 어떻게 되나요?
임베딩 모델이 정하는 출력 차원과 Qdrant 컬렉션의 `size`가 반드시 같아야 합니다. 다르면 업서트/검색이 실패합니다. 그래서 모델(`text-embedding-3-small`)과 `dimension`을 설정에서 한 쌍으로 묶어 관리하고, 모델을 바꾸면 컬렉션을 재생성하고 전체 reindex를 해야 합니다(`reindexAll`).
:::

:::details Q4. Qdrant가 다운되면 면접 기능이 멈추나요?
아니요. RAG는 best-effort로 설계했습니다. 색인은 실패해도 본문은 MySQL에 저장되고 `indexed=false`로 남아 나중에 reindex로 회복합니다. 검색이 실패하면 `retrieveContext`가 빈 문자열을 반환해, LLM이 근거 없이라도 평가를 이어갑니다. 검색 근거는 품질을 올리는 부가 정보지 필수 의존이 아닙니다.
:::

:::details Q5. 임베딩 모델을 OpenAI 말고 로컬로 바꿀 수 있나요?
가능합니다. 실제로 프로젝트 내에서도 용도별로 다릅니다. 면접 RAG는 OpenAI(`EmbeddingClient`)지만, 지원 챗봇 FAQ 검색은 Ollama 로컬 임베딩(`OllamaEmbeddingClient`, `bge-m3`)을 씁니다. 비용·프라이버시·오프라인 요구가 크면 로컬 모델로 바꾸되, 차원과 컬렉션을 맞추고 전부 재색인하면 됩니다.
:::

## 8. 직접 말해보기

아래를 막힘 없이 입으로 설명할 수 있으면 합격선이다.

1. 임베딩이 무엇이고, 왜 키워드 검색보다 의미 검색에 유리한지 한 문장으로.
2. CareerTuner 면접 RAG의 색인→검색 흐름을 클래스 이름과 함께(`EmbeddingClient` → `QdrantClient` → `retrieveContext`).
3. 코사인 유사도가 방향을 본다는 점과, 차원/거리함수 일치가 왜 중요한지.
4. Qdrant 장애 시 best-effort로 흐름이 안 끊기는 이유.

관련: [RAG와 Qdrant](/ai/rag-qdrant) · [LLM과 프롬프트](/ai/llm-and-prompt) · [환경변수와 시크릿](/infra/env-and-secrets)

## 퀴즈

<QuizBox question="임베딩 기반 의미 검색이 키워드 검색보다 분명히 유리한 경우는?" :choices="['정확한 주문번호 ID로 한 건을 찾을 때', '글자는 다르지만 뜻이 비슷한 문장을 찾을 때', '단순 문자열 prefix 자동완성', '대소문자만 무시한 완전 일치 검색']" :answer="1" explanation="임베딩은 의미 근접으로 찾으므로 동의어·말 바꿈에 강하다. 정확한 ID/완전 일치는 키워드 검색이 유리하다." />

<QuizBox question="CareerTuner 면접 RAG 컬렉션의 거리 함수와 벡터 차원 기본값은?" :choices="['Euclidean, 768', 'Dot, 1024', 'Cosine, 1536', 'Cosine, 384']" :answer="2" explanation="QdrantClient.ensureCollection()은 distance=Cosine, InterviewRagProperties.dimension 기본값은 1536(text-embedding-3-small)이다." />

<QuizBox question="Qdrant가 다운된 상태에서 면접 평가를 시작하면 CareerTuner는 어떻게 동작하도록 설계됐는지 설명하라." explanation="best-effort 설계. 색인은 실패해도 본문은 MySQL에 저장되고 indexed=false로 남아 나중에 reindex로 회복한다. 검색 단계는 retrieveContext가 빈 문자열을 반환해 LLM이 근거 없이라도 평가를 이어가므로 면접 흐름이 끊기지 않는다." />

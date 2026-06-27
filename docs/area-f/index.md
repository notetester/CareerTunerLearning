# 영역 F 개요 — 커뮤니티·고객센터·챗봇 (AI #29-34)

> 허브로 돌아가기: [영역별 심화 전체 개요](/areas/) · 인접 영역: [← 영역 E · 첨삭·결제·크레딧](/area-e/) · [전체 흐름](/flow/) · [AI #1-34 맵](/flow/ai-function-map)

영역 F는 CareerTuner에서 **사용자끼리 정보를 나누는 공간(커뮤니티)** 과 **운영이 사용자와 대화하는 창구(고객센터·공지·알림)** 를 하나로 묶고, 그 위에 **3종 챗봇**(FAQ-RAG · 커뮤니티 에이전트 · 인테이크 오케스트레이터 입구)을 얹은 영역이다. 모든 AI 기능을 관통하는 한 줄 원칙은 **"AI는 운영자 보조이지 자동 처분자가 아니다."**

---

## 1. 이 영역이 책임지는 것 — 정체성

CareerTuner의 핵심 단위는 공고가 아니라 **지원 건(Application Case)** 이다. A~F 6개 영역이 한 지원 건을 함께 채우는데, 그중 대부분은 "한 지원 건을 분석/생성"하는 데 집중한다. 영역 F는 결이 다르다 — **여러 사용자와 운영자가 모이는 공용 공간**을 다룬다. 그래서 F의 데이터 다수는 특정 지원 건이 아니라 `users`에만 묶인다.

범위를 한 줄씩 나누면 이렇다.

| 축 | 무엇 | 대표 테이블 |
| --- | --- | --- |
| **커뮤니티** | 게시글·댓글·반응·신고·태그·면접후기·가이드라인 | `community_post`, `community_comment`, `community_reaction`, `post_report` |
| **고객센터** | 1:1 문의 티켓, 공지, FAQ | `support_ticket`, `notice`, `faq` |
| **알림** | 인앱 알림 + Web Push + 환경설정 | `notification`, `push_subscription` |
| **챗봇** | FAQ-RAG · 커뮤니티 에이전트 · 인테이크 오케스트레이터 입구 | `chatbot_conversation_memory`, `chatbot_response_log` |

:::tip 이 페이지가 답하는 면접 질문
"영역 F가 정확히 뭘 하나요?" / "AI 기능이 6개라는데 각각 뭐죠?" / "챗봇이 왜 3개나 있어요?" / "신고를 AI가 자동으로 처리하나요?" / "인테이크 챗봇이 다른 영역이랑 어떻게 연결돼요?"
이 개요만 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

이 정체성을 코드로 강제하는 한 문장이 **"AI는 운영자 보조, 자동 처분 아님"** 이다. 게시글이 모이는 공용 공간에서 AI가 잘못 판단하면 무고한 사용자가 차단되거나 잘못된 답변이 확정 발송되기 때문에, F는 AI 출력을 "확정"이 아니라 "제안"으로 다룬다.

- **신고/부적절 분류**는 운영자 판단을 돕는 **제안**이며, 숨김·삭제는 운영자가 `takeAction()`으로 확정한다.
- **고객문의 답변**은 상담원이 검토하는 **초안**이고, 정책·환불·개인정보 이슈는 자동 발송하지 않는다.
- **게시글 추천**은 관심·행동 데이터를 쓰되, 민감 정보는 추천 근거로 노출하지 않는다.

---

## 2. 6개 영역 속 영역 F의 위치

CareerTuner는 6명 수직 분담(A~F)이 한 지원 건을 함께 채운다. 각 영역은 **자기 결과 테이블을 소유(쓰기)** 하고, 타 영역 원본은 **읽기전용으로만** 참조한다.

| 영역 | 책임 (한 줄) | AI 번호 | 대표 소유 데이터 |
| --- | --- | --- | --- |
| A · 회원·프로필·인증 | 계정·인증·스펙 원천 프로필 소유 | #1–5 | `users`, `user_profile`, `user_consent` |
| B · 지원건·공고·기업분석 | 공고를 구조화 추출해 공급 | #6–11 | `application_case`, `job_posting`, `job_analysis`, `company_analysis` |
| C · 적합도·전략·대시보드 | 지원 판단·보완·전략(뉴로심볼릭) | #12–18 | `fit_analysis`, `career_analysis_run`, `dashboard` |
| D · 가상 면접 | 모의 면접 한 라운드 전체 사이클 | #19–23 | `interview_session/question/answer`, `interview_knowledge` |
| E · 첨삭·결제·크레딧 | 원문 보존형 첨삭 + 과금 인프라 | #24–28 | `correction_request`, `payment`, `credit_transaction`, `plan` |
| **F · 커뮤니티·고객센터·챗봇 ★** | **공용 공간 + 운영 커뮤니케이션 + 챗봇** | **#29–34** | **`community_*`, `support_ticket`, `notice`, `faq`, `notification`** |

F로 들어오고 나가는 데이터를 화살표로 보면 이렇다.

```text
   [F가 읽기전용으로 참조하는 입력]            [F가 다른 영역에 제공]
   A user_profile  ─┐                          ┌─→ D interview_knowledge
   B job_analysis  ─┼─→  영역 F  ──────────────┤    (#31 추출 면접질문 적재)
   C 관심 직무      ─┘    커뮤니티·CS·챗봇      └─→ D AutoPrep 실행
   (노출 정책은 F 소유)                              (인테이크 슬롯 → D가 실행)
```

:::tip F의 위치를 한 문장으로
"F는 `application_case`에 FK가 없습니다. `users`에만 묶여서, 후기·실제질문 같은 산출물은 **특정 지원 건 바깥에서** 순환합니다 — 예: 'F 후기에서 뽑은 실제 면접질문'이 D 면접 준비의 참고 데이터가 됩니다."
:::

데이터 소유·참조 경계의 전체 그림은 [데이터 소유권 경계 맵](/flow/data-ownership)에서 6개 영역을 한 장으로 본다.

---

## 3. 담당 AI 기능 — #29 ~ #34

영역 F가 소유한 번호 AI 기능은 6개(#29~#34)다. 정직하게 말하면 **전부 동일 수준으로 구현된 것은 아니다.**

| # | 기능 | 핵심 클래스 | 상태 | 한 줄 |
| --- | --- | --- | --- | --- |
| 29 | 면접후기 요약 | (전용 경로 없음) | ⚠️ 미구현/계획 | enum·컬럼만 선언, #31 부산물·챗봇 런타임 요약이 대체 |
| 30 | 게시글 태그 추천 | `PostModerationService.tag()` | ✅ 구현됨 | 본문 근거 태그 2~5개, confidence 게이트로 자동적용/추천 분리 |
| 31 | 실제 면접질문 추출 | `extractInterviewQuestions()` | ✅ 구현됨 | 후기 글 → 질문 구조화 후 D의 RAG 지식(`interview_knowledge`)에 적재 |
| 32 | 관심기반 게시글 추천 | `CommunityPostSearchService.search()` | ◐ 부분 구현 | 자연어 의미검색(SQL 후보 + 코사인)까지. 개인화는 미구현 |
| 33 | 신고/부적절 분류 | `moderate()` / `classify()` / `judge()` | ✅ 구현됨 | 생성시점 자동검열 + 신고분류 분리, 런타임 엄격도 |
| 34 | 고객문의 답변 초안 | `TicketDraftAiClient.generateDraft()` | ✅ 구현됨 | 동기·미영속, 내부메모 제외, 초안↔답변 분리 |

코드 실측 규모는 docs의 "6개 기능" 나열보다 훨씬 넓다. **이벤트 기반 자동 검열, 챗봇 2종(FAQ-RAG·커뮤니티 에이전트), 인테이크 오케스트레이터 입구, 임베딩 의미검색, 사용자 자동제재, 운영 로그**까지가 실제 F의 표면적이다.

:::details #29가 "미구현/계획"인 정직한 근거
`AiTaskType.SUMMARY` enum과 `community_interview_review.ai_summary_json` 컬럼은 선언만 있고 채우는 서비스 호출이 0건이다. 알림 타입 `POST_SUMMARY_READY`만 남아 "요약 완료를 통지하려던 설계 흔적"이 보인다. 대신 #31 추출의 총평(`overallNote`)과 챗봇의 런타임 on-demand 요약(`CommunityTools.getPostContent`가 본문을 LLM에 넘겨 실시간 요약)이 그 자리를 메운다. 구현 vs 계획을 분명히 구분하는 것이 면접에서 신뢰를 만든다.
:::

세 챗봇은 사용자에게 **하나의 위젯**으로 보인다. 단일 진입점 `ChatbotController.ask()`(`POST /api/chatbot/ask`)의 `UnifiedChatRouter`가 임베딩 점수로 분기한다 — 명확구역은 argmax로 결정적으로 가르고(LLM 0회), 경계구역만 화행분류 LLM(qwen3:8b)을 1회 태운다.

| 챗봇 | 위치 | 모델 | 책임 |
| --- | --- | --- | --- |
| ① FAQ-RAG | `support/chatbot` | gemma + bge-m3 | 발행 FAQ 임베딩 코사인 → 답변 생성 |
| ② 커뮤니티 에이전트 | `ai/chat/CommunityChatAgent` | qwen3:8b | LangChain4j 툴 호출(검색·요약·FAQ) |
| ③ 인테이크 입구 | `ai/intake/IntakeChatAgent` | qwen3:8b | 슬롯 수집 후 D 실행 스트림으로 위임 |

번호 기준 전체 그림은 [AI #1-34 맵](/flow/ai-function-map), 공급자·폴백(자체OSS→Haiku→OpenAI→Mock)은 [AI 공급자·폴백 전략](/flow/ai-providers-fallback)에서 본다.

---

## 4. 권장 학습 순서

영역 F는 표면적이 넓어서, **데이터 모델 → AI 기능 → 챗봇 → 운영 화면 → 점검** 순으로 쌓으면 막힘이 적다.

**① 토대 — 데이터 모델**
- [커뮤니티 데이터 모델](/area-f/community-data-model) — 게시글·댓글·신고·태그·AI 결과 테이블. 이걸 알아야 AI 기능 설명이 붙는다.

**② 번호 AI 기능 6종 (#29~#34)**
- [게시글 태그 추천](/area-f/ai-tag-recommend) — confidence 게이트로 "자동 적용 vs 추천만"을 나누는 첫 사례 (#30).
- [실제 면접질문 추출](/area-f/ai-question-extract) — F→D RAG 적재, verbatim 보존·환각 방어 (#31).
- [관심기반 게시글 추천](/area-f/ai-post-recommend) — 2단계 의미검색(SQL 후보 + 코사인) (#32).
- [신고/부적절 분류](/area-f/ai-report-classify) — 자동검열 vs 신고분류 분리, 자동제재. F 설계가 응축된 곳 (#33).
- [고객문의 답변 초안](/area-f/ai-support-draft) — 동기·미영속, 초안↔답변 분리 (#34).
- [면접후기 AI 요약](/area-f/ai-review-summary) — 계획 상태와 대체물의 정직한 구분 (#29).

**③ 챗봇 3종과 통합 라우터**
- [LangChain4j 에이전트](/area-f/langchain4j-agent) — `@AiService`·`@Tool` 패턴.
- [인테이크 오케스트레이터 입구](/area-f/intake-chatbot) — 슬롯 접지(slot grounding)와 D 위임.
- [챗봇 세션 메모리 영속](/area-f/chat-memory) — `MyBatisChatMemoryStore`.

**④ 운영 표면**
- [고객센터·공지·FAQ](/area-f/support-notice-faq) · [프론트엔드 UI/UX](/area-f/frontend-ui) · [관리자 화면 & 운영](/area-f/admin)

**⑤ 마지막 점검**
- [영역 F 면접 플레이북](/area-f/interview-playbook) — 단골 질문 총정리.

곁들이면 좋은 공통 페이지: [LangChain4j + Ollama](/ai/langchain4j-ollama) · [임베딩](/ai/embedding) · [자체 LLM 전략](/ai/self-llm-strategy) · [AI 오케스트레이터 전체](/flow/ai-orchestrator).

---

## 5. 단골 면접 질문 5개 (빠른 답)

1. **"AI 기능이 몇 개고 어디까지 됐나요?"** — 번호 기준 #29~#34 6개다. 태그(#30)·추출(#31)·신고분류(#33)·문의초안(#34)은 구현됨, 후기요약(#29)은 미구현(대체물 존재), 추천(#32)은 의미검색까지만 부분 구현이다. 코드 실측은 챗봇 3종·자동제재·운영로그까지 더 넓다.
2. **"신고를 AI가 자동으로 처리하나요?"** — 아니요. **생성 시점 자동 검열**(toxic + 높은 confidence면 soft-hide)과 **사용자 신고 분류**는 다르다. 신고 분류는 판정 결과만 저장하고, 숨김·삭제는 운영자가 `takeAction()`으로 확정한다(DELETED는 불가역 종착).
3. **"챗봇이 왜 3개예요?"** — FAQ-RAG(결정적 즉답)·커뮤니티 에이전트(툴 호출)·인테이크(슬롯 수집)는 역할이 다르다. 사용자에겐 단일 위젯이고, `UnifiedChatRouter`가 임베딩 점수로 분기하며 경계구역에서만 LLM을 1회 태운다.
4. **"인테이크 챗봇이 면접 준비를 직접 실행하나요?"** — 아니요. F는 슬롯(지원 건·모드)을 모아 `AutoPrepRequest`를 조립하는 데까지만 하고, ready 판정과 실제 실행 스트림(`/api/auto-prep/run/stream`)은 영역 D가 소유한다. 의존 그래프를 F가 재구현하지 않고 위임으로 끊는다.
5. **"외부 API 키 없이 어떻게 LLM을 쓰나요?"** — 로컬 Ollama가 기본이고 원격 GPU 엔드포인트로 설정 교체가 가능하다. 검열/태깅/추출/답변에 gemma, 화행분류/에이전트에 qwen3:8b, 임베딩에 bge-m3(1024차원)로 역할을 나누며, 별도 벡터 DB 없이 앱 내 코사인으로 검색한다.

---

## 퀴즈

<QuizBox question="영역 F의 AI 설계를 관통하는 최우선 원칙은 무엇인가?" :choices="['AI가 신고를 자동으로 영구 삭제 처리한다', 'AI는 운영자 보조이며 자동 처분자가 아니다', '모든 답변을 사용자에게 즉시 확정 발송한다', 'LLM이 게시글 점수를 직접 정한다']" :answer="1" explanation="F의 AI는 제안/초안 수준이며, 신고 처분·답변 발송은 운영자가 확정한다. 생성 시점 자동 검열만 toxic과 높은 confidence에서 soft-hide로 즉시 차단하되, 이것도 불가역 삭제는 아니다." />

<QuizBox question="영역 F의 데이터가 다른 영역과 묶이는 방식으로 옳은 것은?" :choices="['모든 F 데이터가 application_case에 FK로 묶인다', 'F는 application_case에 FK가 없고 users에만 묶인다', 'F는 어떤 영역과도 데이터를 주고받지 않는다', 'F가 A의 user_profile 원본을 직접 수정한다']" :answer="1" explanation="F의 커뮤니티 데이터는 지원 건이 아니라 users에 묶여 여정 바깥에서 순환한다. 타 영역 원본(A 프로필·B 공고분석 등)은 읽기전용으로만 참조하고 수정하지 않는다." />

<QuizBox question="인테이크 챗봇과 영역 D의 책임 경계로 옳은 것은?" :choices="['F가 슬롯 수집과 실행 스트림을 모두 소유한다', 'D가 슬롯을 수집하고 F가 실행한다', 'F는 슬롯 수집까지, ready 판정·실행 스트림은 D가 소유한다', 'F와 D가 동일 코드를 각자 중복 구현한다']" :answer="2" explanation="F는 IntakeTools로 슬롯을 접지해 AutoPrepRequest를 조립하고, ready/nextAsk 판정은 D의 AutoPrepIntakeService.intake()에 위임하며, 실제 실행은 D의 /api/auto-prep/run/stream이 담당한다." />

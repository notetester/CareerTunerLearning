# 영역 F 개요 — 커뮤니티·고객센터·챗봇

> 영역 F는 "**사용자끼리 정보를 나누는 공간**(커뮤니티)"과 "**운영이 사용자와 대화하는 창구**(고객센터·공지·알림)"를 하나로 묶고, 그 위에 **3개의 챗봇**(FAQ-RAG · 커뮤니티 에이전트 · 인테이크 오케스트레이터 입구)을 얹은 영역이다. 모든 AI 기능을 관통하는 한 줄 원칙은 **"AI는 운영자 보조이지 자동 처분자가 아니다."**

---

## 1. 영역 F의 정체성 — 한 문장으로

영역 F는 **사용자 간 정보 공유 + 운영 커뮤니케이션**을 함께 책임지는 영역이다(`docs/TEAM_WORK_DISTRIBUTION.md` F 섹션). 다른 영역이 "지원 건 하나를 분석/생성"하는 데 집중한다면, F는 **여러 사용자와 운영자가 모이는 공용 공간**을 다룬다는 점에서 성격이 다르다.

범위를 한 줄씩 나누면 이렇다.

| 축 | 무엇 | 대표 테이블 |
| --- | --- | --- |
| **커뮤니티** | 게시글·댓글·반응·신고·태그·면접후기·가이드라인 | `community_post`, `community_comment`, `post_report` |
| **고객센터** | 1:1 문의 티켓, 공지, FAQ | `support_ticket`, `notice`, `faq` |
| **알림** | 인앱 알림 + Web Push + 환경설정 | `notification`, `push_subscription` |
| **챗봇** | FAQ-RAG · 커뮤니티 에이전트 · 인테이크 오케스트레이터 입구 | `chatbot_conversation_memory`, `chatbot_response_log` |
| **부수 정적 영역** | 회사/서비스 소개, 법적 문서(약관·개인정보) | `legal_*` |

:::tip 이 페이지가 답하는 면접 질문
"영역 F가 정확히 뭘 하나요?" / "AI 기능이 6개라는데 각각 뭐죠?" / "챗봇이 왜 3개나 있어요?" / "신고를 AI가 자동으로 처리하나요?" / "인테이크 챗봇이 다른 영역이랑 어떻게 연결돼요?"
이 개요만 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

---

## 2. 관통하는 설계 원칙 — "AI는 운영자 보조, 자동 처분 아님"

영역 F의 모든 AI 결정은 이 한 문장에서 갈린다. 게시글이 모이는 공용 공간에서 AI가 **잘못 판단하면 무고한 사용자가 차단되거나 잘못된 답변이 확정 발송**되기 때문이다. 그래서 F는 AI 출력을 "확정"이 아니라 "제안"으로 다룬다.

- **신고/부적절 분류**는 운영자 판단을 돕는 **제안**이며, 자동 제재로 끝내지 않는다(운영자가 `takeAction()`으로 확정).
- **고객문의 답변**은 상담원이 검토하는 **초안**이고, 정책·환불·개인정보 이슈는 확정 답변으로 자동 발송하지 않는다.
- **게시글 추천**은 관심·행동 데이터를 쓰되, **민감 정보는 추천 근거로 노출하지 않는다.**

:::warning 면접 핵심 한 줄
"F의 AI는 즉시 차단할 수 있는 자동 검열(생성 시점)과, 운영자가 확정해야 하는 신고 분류를 **task_type으로 분리**합니다. 같은 판정 두뇌(`judge()`)를 재사용하되, 부수효과만 다르게 둡니다."
:::

이 원칙이 코드에서 어떻게 강제되는지는 [신고/부적절 분류](/area-f/ai-report-classify)에서, 운영자 확정 흐름은 [관리자 화면](/area-f/admin)에서 다룬다.

---

## 3. 담당 AI 기능 — #29 ~ #34

영역 F가 소유한 번호 AI 기능은 6개다(#29~#34). 단, 정직하게 말하면 **전부 동일 수준으로 구현된 것은 아니다.**

| # | 기능 | 핵심 클래스 | 상태 | 한 줄 |
| --- | --- | --- | --- | --- |
| 29 | 면접후기 요약 | (전용 경로 없음) | ⚠️ **미구현/계획** | enum·컬럼만 선언, #31 부산물·챗봇 런타임 요약이 대체 |
| 30 | 게시글 태그 추천 | `PostModerationService.tag()` | ✅ 구현됨 | 본문 근거 태그 2~5개, confidence 0.7 게이트로 자동적용/추천 분리 |
| 31 | 실제 면접질문 추출 | `extractInterviewQuestions()` | ✅ 구현됨 | 후기 글→질문 구조화 후 **D의 RAG 지식(`interview_knowledge`)에 적재** |
| 32 | 관심기반 게시글 추천 | `CommunityPostSearchService.search()` | ◐ **부분 구현** | 자연어 의미검색(2단계 SQL+코사인)까지. 개인화는 미구현 |
| 33 | 신고/부적절 분류 | `moderate()` / `classify()` / `judge()` | ✅ 구현됨+초과 | 자동검열+신고분류 분리, 런타임 엄격도, 자동제재 |
| 34 | 고객문의 답변 초안 | `TicketDraftAiClient.generateDraft()` | ✅ 구현됨 | 동기·미영속, 내부메모 제외, 초안↔답변 분리 |

여기에 더해 코드 실측 규모는 docs의 "6개 기능" 나열보다 훨씬 크다. **이벤트 기반 자동 검열, 챗봇 2종(FAQ-RAG·커뮤니티 에이전트), 인테이크 오케스트레이터 입구, 임베딩 검색, 사용자 자동제재, 운영 로그**까지가 실제 F의 표면적이다.

:::details #29가 "미구현"인 정직한 근거
`AiTaskType.SUMMARY` enum과 `community_interview_review.ai_summary_json` 컬럼은 **선언만 있고 채우는 서비스 호출이 0건**이다(grep 확인). 프론트에도 summary 렌더 코드가 없고, 알림 타입 `POST_SUMMARY_READY`만 남아 "요약 완료를 알림으로 통지하려던 설계 흔적"이 보인다. 대신 #31 추출의 `overallNote`(면접 분위기/총평)와 챗봇의 런타임 on-demand 요약(`CommunityTools.getPostContent`가 본문을 LLM에 넘겨 실시간 요약)이 그 자리를 메운다.
:::

각 기능 심화는 [태그 추천](/area-f/ai-tag-recommend) · [질문 추출](/area-f/ai-question-extract) · [게시글 추천](/area-f/ai-post-recommend) · [신고 분류](/area-f/ai-report-classify) · [문의 초안](/area-f/ai-support-draft) · [후기 요약](/area-f/ai-review-summary)에서 다룬다.

---

## 4. 챗봇이 3개인 이유

"챗봇이 왜 3개냐"는 F의 단골 질문이다. **역할이 다르고, 진입점이 통합되어 있기 때문**이다.

| 챗봇 | 위치 | 모델 | 책임 | 상태 |
| --- | --- | --- | --- | --- |
| ① **FAQ-RAG** | `support/chatbot/ChatbotService` | gemma4 + bge-m3 | 발행 FAQ 임베딩 코사인 → 답변 생성 | ✅ (가장 오래됨) |
| ② **커뮤니티 에이전트** | `ai/chat/CommunityChatAgent` | qwen3:8b | LangChain4j 툴 호출(검색·요약·FAQ) | ✅ |
| ③ **인테이크 오케스트레이터 입구** | `ai/intake/IntakeChatAgent` | qwen3:8b | 슬롯 수집 후 D 실행 스트림으로 위임 | ◐ 일부 미연결 |

세 챗봇은 사용자에게 **하나의 위젯**으로 보인다. 단일 진입점 `ChatbotController.ask()`(`POST /api/chatbot/ask`)의 `UnifiedChatRouter`가 질문을 보고 어디로 보낼지 정한다.

```text
질문 입력
  └ sticky 모드 / 이탈신호("그만") / nav fast-path / 확인대기 소비 처리
      └ decide(question):
          faqScore(FAQ top-1 코사인)  vs  intakeScore(시드발화 max 코사인)
          ① 둘 다 weakGate(0.52) 미만  → FALLBACK (코퍼스밖 차단·되묻기)
          ② |diff| ≥ 0.10 (명확구역)    → argmax 결정적 (LLM 0회)
          ③ |diff| < 0.10 (경계구역)    → 화행분류 1회(qwen3:8b)
                                          → COMMAND면 INTAKE_CONFIRM, 아니면 FAQ
```

핵심은 **"경계구역에서만 LLM을 쓴다"**는 것. 명확구역은 임베딩 argmax로 결정적으로 가르고(LLM 비용·비결정성 제거), 애매한 표본(실측 약 42%)만 화행 분류 LLM을 1회 태운다. 자세히는 [LangChain4j 에이전트](/area-f/langchain4j-agent)와 [인테이크 챗봇](/area-f/intake-chatbot).

---

## 5. 인테이크 챗봇 = 오케스트레이터의 입구

영역 F에서 가장 중요한 **교차 영역 연결점**은 인테이크 챗봇이다. F는 **대화로 슬롯을 모으는 일까지만** 하고, **실제 자동 면접준비(AutoPrep) 실행 스트림은 영역 D가 소유**한다.

| 단계 | 누가 | 무엇 |
| --- | --- | --- |
| 슬롯 수집 | **F** (`IntakeTools`) | `listCases` / `chooseCase(caseId)` / `chooseMode(code)` 툴로 지원 건·모드 확정 |
| ready/nextAsk 판정 | **D** (`AutoPrepIntakeService.intake()`) | "지금 실행 가능한가, 아니면 뭘 더 물어야 하나"를 위임받아 판단 |
| 산출물 계약 | **F→D** (`AutoPrepRequest`) | `{query, applicationCaseId, mode, coverLetterText, attachmentFileIds}` 조립 |
| 실행 | **D** (`/api/auto-prep/run/stream`) | ready=true면 클라이언트가 D의 SSE 스트림을 **직접** 연결 |

핵심 설계는 **"슬롯 접지(slot grounding)"**다. LLM 출력을 그대로 믿지 않고, **코드 검증을 통과한 툴 호출 결과만 슬롯으로 확정**한다. 예를 들어 `chooseCase`는 `listCases` 화이트리스트 안의 `caseId`만 confirm한다. 의존 그래프(D의 6모드 실행 파이프라인)를 F가 재구현하지 않고 위임으로 끊는다는 점이 핵심이다.

:::warning 정직한 구분
인테이크는 슬롯 접지·툴·라우팅까지 구현됐지만, **슬롯 세션 DB 영속화는 미구현**(JVM 인메모리, D·C 합의 후 단계)이고 전용/관리자 인테이크 프론트도 일부 미연결이다.
:::

오케스트레이터 전체 그림은 [오케스트레이터·AutoPrep](/ai/orchestrator-autoprep), 인테이크 자체는 [인테이크 챗봇](/area-f/intake-chatbot)을 본다.

---

## 6. 다른 영역과의 경계

F가 자기 것으로 소유하는 것과, 빌려 쓰거나 넘겨주는 것을 구분하는 게 면접에서 중요하다.

| 경계 | 방향 | 무엇 |
| --- | --- | --- |
| **F → D** | F가 write, D가 소유 | #31이 추출한 실제 면접질문을 D의 `interview_knowledge`에 `kind=QUESTION_BANK`로 적재 |
| **F ↔ D** | F가 슬롯, D가 실행 | 인테이크가 슬롯 수집까지, ready/nextAsk·실행 스트림은 D |
| **C → F** | C가 입력, F가 정책 | 관심 직무를 추천 입력으로 받을 수 있으나 **노출 정책은 F가 소유** |
| **E → F** | E가 참고, F가 초안 | 환불·결제 문의는 답변 초안에 활용하되 최종 정책 판단은 E·운영자 |
| **A 인프라 재사용** | F가 호출 | 자동 제재 시 A의 `AdminUserMapper.updateStatus(BLOCKED)`·`AuthMapper.revokeAllForUser` 재사용 |

핵심: **커뮤니티 원문·신고 처리·노출 정책은 전적으로 F 소유**다. F가 추출한 질문은 D가 "참고 데이터"로 쓰지만, 원본 소유권은 F에 있다.

---

## 7. 권장 학습 순서

영역 F는 표면적이 넓어서, 데이터 모델 → AI 기능 → 챗봇 → 운영 화면 순으로 쌓는 것이 막힘이 적다.

1. [커뮤니티 데이터 모델](/area-f/community-data-model) — 게시글·댓글·신고·태그·AI 결과 테이블. 이걸 알아야 AI 기능 설명이 붙는다.
2. [게시글 태그 추천](/area-f/ai-tag-recommend) — confidence 게이트 패턴. AI 출력을 "자동 적용 vs 추천만"으로 나누는 첫 사례.
3. [실제 질문 추출](/area-f/ai-question-extract) — F→D RAG 적재, verbatim 보존·환각 방어.
4. [신고/부적절 분류](/area-f/ai-report-classify) — 자동검열 vs 신고분류 분리, 자동제재, 유실분 스케줄러. F의 핵심 설계가 응축된 곳.
5. [문의 답변 초안](/area-f/ai-support-draft) — 동기·미영속 초안↔답변 분리.
6. [게시글 추천](/area-f/ai-post-recommend) — 2단계 의미검색(SQL 후보 + 코사인).
7. [LangChain4j 에이전트](/area-f/langchain4j-agent) → [인테이크 챗봇](/area-f/intake-chatbot) → [챗봇 메모리 영속](/area-f/chat-memory) — 챗봇 3종과 통합 라우터.
8. [고객센터·공지·FAQ](/area-f/support-notice-faq) · [프론트엔드 UI/UX](/area-f/frontend-ui) · [관리자 화면](/area-f/admin) — 운영 표면.
9. [면접 플레이북](/area-f/interview-playbook) — 마지막 점검.

곁들이면 좋은 공통 페이지: [LangChain4j + Ollama](/ai/langchain4j-ollama) · [임베딩](/ai/embedding) · [자체 LLM 전략](/ai/self-llm-strategy).

---

## 8. 단골 질문 5개 (빠른 답)

1. **"AI 기능이 몇 개고 어디까지 됐나요?"** — 번호 기준 #29~#34 6개. 태그·추출·신고분류·문의초안은 구현됨, 후기요약(#29)은 미구현(대체물 존재), 추천(#32)은 의미검색까지만 부분 구현. 코드 실측은 챗봇 3종·자동제재·운영로그까지 더 넓다.
2. **"신고를 AI가 자동으로 처리하나요?"** — 아니요. **생성 시점 자동 검열**(toxic+confidence≥0.80이면 soft-hide)과 **사용자 신고 분류**는 다릅니다. 신고 분류는 판정 결과만 저장하고, 숨김·삭제는 운영자가 `takeAction()`으로 확정합니다(DELETED는 불가역 종착).
3. **"챗봇이 왜 3개예요?"** — FAQ-RAG(결정적 즉답), 커뮤니티 에이전트(툴 호출), 인테이크(슬롯 수집) 역할이 다릅니다. 사용자에겐 단일 위젯이고, `UnifiedChatRouter`가 임베딩 점수로 분기합니다.
4. **"외부 API 키 없이 어떻게 LLM을 쓰나요?"** — 로컬 Ollama가 기본(`localhost:11434`)이고 원격 4090 엔드포인트로 설정 교체가 가능합니다. 모델은 검열/태깅/추출/답변에 gemma4, 화행/에이전트에 qwen3:8b, 임베딩에 bge-m3(1024차원)로 역할을 나눕니다. 벡터 DB 없이 앱 내 코사인으로 검색합니다.
5. **"인테이크 챗봇은 면접 준비를 직접 실행하나요?"** — 아니요. F는 슬롯(지원 건·모드)을 모아 `AutoPrepRequest`를 조립하는 데까지만 하고, ready 판정과 실제 실행 스트림(`/api/auto-prep/run/stream`)은 영역 D가 소유합니다.

---

## 퀴즈

<QuizBox question="영역 F의 AI 설계를 관통하는 최우선 원칙은 무엇인가?" :choices="['AI가 신고를 자동으로 영구 삭제 처리한다', 'AI는 운영자 보조이며 자동 처분자가 아니다', '모든 답변을 사용자에게 즉시 확정 발송한다', 'LLM이 게시글 점수를 직접 정한다']" :answer="1" explanation="F의 모든 AI는 제안/초안 수준이며, 신고 처분·답변 발송은 운영자가 확정한다. 단 생성 시점 자동 검열만 toxic+confidence≥0.80에서 soft-hide로 즉시 차단하되 이것도 불가역 삭제는 아니다." />

<QuizBox question="인테이크 챗봇과 영역 D의 책임 경계로 옳은 것은?" :choices="['F가 슬롯 수집과 실행 스트림을 모두 소유한다', 'D가 슬롯을 수집하고 F가 실행한다', 'F는 슬롯 수집까지, ready 판정·실행 스트림은 D가 소유한다', 'F와 D가 동일 코드를 각자 중복 구현한다']" :answer="2" explanation="F는 IntakeTools로 슬롯을 접지해 AutoPrepRequest를 조립하고, ready/nextAsk 판정은 AutoPrepIntakeService.intake()에 위임하며, 실제 실행은 D의 /api/auto-prep/run/stream이 담당한다. 의존 그래프를 F가 재구현하지 않는다." />

<QuizBox question="UnifiedChatRouter가 '경계구역(|diff| < 0.10)'에서만 LLM(화행분류)을 호출하는 이유로 가장 적절한 것은?" :choices="['명확구역은 임베딩 argmax로 결정적으로 가를 수 있어 LLM의 비용·비결정성을 줄이려고', '경계구역에서는 항상 FALLBACK으로 끊어야 해서', 'gemma4가 화행 분류를 못 해서', '모든 질문에 LLM을 두 번씩 호출하려고']" :answer="0" explanation="명확구역은 두 점수 차가 충분히 커서 argmax만으로 결정적 라우팅이 가능하다. 애매한 경계구역(실측 약 42% 표본)만 qwen3:8b 화행분류를 1회 태워 비용과 비결정성을 최소화한다." />

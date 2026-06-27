# D 프론트엔드 UI/UX

> 가상 면접 화면은 "여러 페이지"가 아니라 **단일 `InterviewPage` + 8탭** 구조다. 답변 입력·평가·리포트·SSE 수신이 어떻게 React 상태와 API 계약 위에서 맞물리는지를 코드 근거로 본다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 D의 프론트엔드는 **지원 건(application_case) 하나에 대한 가상 면접의 전체 흐름**(모드 선택 → 예상 질문 → 답변·평가 → 복습 → 음성/아바타 → 리포트)을 한 화면 안에서 탭으로 묶은 React SPA 모듈이다. 위치는 `frontend/src/features/interview/`.

면접에서 자주 나오는 질문:

- "면접 화면이 여러 페이지인가, 한 페이지인가? 상태는 어떻게 공유하나?"
- "텍스트 답변·음성 답변·영상 답변이 입력 UI에서 어떻게 갈라지나?"
- "AI 채점이 진행 중일 때 사용자에게 무엇을 보여주나? 진행률을 어떻게 아나?"
- "AI가 어떤 판단을 했는지(멀티에이전트)를 화면에서 어떻게 투명하게 보여주나?"
- "SSE(자동 준비)는 어디서 받고, 왜 `EventSource`가 아니라 `fetch` 스트림인가?"

:::warning 명칭 주의 (조사 가정 vs 실제 코드)
이 영역을 설명할 때 흔히 `InterviewStartPage` / `InterviewSessionPage` / `InterviewReportPage`, `QuestionDisplay` / `AnswerInput` / `EvaluationPanel` / `ReportSummary`, 단수 `useInterviewSession` 같은 이름이 거론되지만 **그런 파일은 존재하지 않는다.** 실제는 단일 `InterviewPage.tsx` + 8개의 `*Tab.tsx` + 복수형 `useInterviewSessions`(목록 페이징 전용) 훅이다. 이 페이지는 그 가상의 이름들이 실제로 **어느 탭/컴포넌트에 매핑되는지**를 함께 짚는다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 단일 페이지 + 탭 (라우트 분리 대신)

면접의 5단계(질문 → 답변 → 복습 → 미디어 → 리포트)는 **같은 세션 한 건**을 공유한다. 만약 `/interview/start`, `/interview/session`, `/interview/report`로 라우트를 쪼개면, 단계마다 `selectedMode`·`activeSession` 같은 상태를 URL 파라미터나 전역 스토어로 넘겨야 한다. 대신 `InterviewPage` 하나가 그 상태를 `useState`로 보유하고, 탭 전환은 URL 쿼리(`?tab=`)로만 한다.

| 공유 상태 (`InterviewPage.tsx`) | 의미 |
| --- | --- |
| `selectedMode` | 사용자가 고른 면접 모드(6종) |
| `selectedCaseId` | 면접 대상 지원 건 |
| `activeSession` | 현재 진행 중인 `InterviewSession` |
| `sessionOrigin` (`"new"` / `"resumed"`) | 새 면접인지 과거 기록 복원(복습)인지 |
| `autoPrompt` | 홈 오케스트레이터 검색창에서 넘어온 자동 셋업 요청 |

탭 목록은 `INTERVIEW_TABS` 상수로 고정된다: `modes / questions / practice / live / avatar / evaluation / correction / report`. 잘못된 `?tab=` 값은 `modes`로 폴백한다.

트레이드오프: 페이지 분할의 장점(코드 스플리팅, 딥링크 단순함)을 일부 포기하는 대신 **단계 간 상태 전달이 사라진다.** 모든 탭이 같은 `session` prop을 받으므로 prop drilling은 1단계로 끝난다.

### 2.2 시간 기반 "가짜" 진행바 (LLM은 진행률을 못 준다)

LLM 호출은 `요청 → 블랙박스 → 응답`이라 실제 진행률(%)을 알 수 없다. 그래서 `InterviewProgressBar`는 **경과 시간 기반 점근 곡선**으로 0→90%까지 차오르다가, 응답이 도착하면(`active=false`) 100%를 채우고 사라진다. provider(OpenAI / Claude / 로컬 LLM)를 바꿔도 그대로 동작한다.

### 2.3 트레이스 투명화 (AgentTimeline)

채점은 멀티에이전트(채점 → 검증 → 재채점 …)로 이뤄지므로, "AI가 무슨 판단을 했는지"를 숨기면 신뢰가 안 생긴다. 그래서 백엔드가 저장한 `interview_agent_step[]`을 받아 **클라이언트에서 순차 재생**한다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 파일 근거)

```text
features/interview/
├─ pages/InterviewPage.tsx        # 8탭 셸 + 공유 상태(단일 페이지)
├─ api/interviewApi.ts            # /api/interview/** 계약 레이어 (ApiResponse 언랩)
├─ types/interview.ts            # 도메인 타입 + UI 상수(모드/채점 구간)
├─ components/
│   ├─ ModeSelectTab.tsx          # 모드 선택 + 지원 건 + 최근 기록
│   ├─ ExpectedQuestionsTab.tsx   # #19/#20 질문·꼬리·텍스트 답변·평가
│   ├─ PracticeTab.tsx            # 블라인드 복습 테스트(마지막 일괄 채점)
│   ├─ VoiceInterviewTab.tsx → RealtimeInterviewTab / LocalVoiceInterviewTab
│   ├─ AvatarInterviewTab.tsx → AvatarTab / LocalAvatarTab
│   ├─ InterviewReportTab.tsx     # #23 리포트 + 미디어 분석
│   ├─ AgentTimeline.tsx          # 멀티에이전트 trace 순차 재생
│   └─ InterviewProgressBar.tsx   # 시간 기반 진행바(공용)
├─ hooks/
│   ├─ useInterviewSessions.ts    # 최근 기록 더보기 페이징 (목록 전용)
│   ├─ voiceAnalysis.ts           # 온디바이스 음성 지표(Web Audio)
│   └─ visualAnalysis.ts          # 온디바이스 영상 지표(MediaPipe)
└─ tutorial/                      # zustand store + 더미 데이터(로그인 없이 체험)
```

가상의 명칭을 실제 매핑하면:

| 거론되는 이름 | 실제 구현 |
| --- | --- |
| `InterviewStartPage` | `ModeSelectTab` (`?tab=modes`) |
| `InterviewSessionPage` | `ExpectedQuestionsTab` / `PracticeTab` / 음성·아바타 탭 |
| `InterviewReportPage` | `InterviewReportTab` (`?tab=report`) |
| `QuestionDisplay` + `AnswerInput` | `ExpectedQuestionsTab`의 `QuestionItem` (질문 카드 + textarea) |
| `EvaluationPanel` | `QuestionItem` 결과 블록 + `AgentTimeline` |
| `ReportSummary` | `InterviewReportTab` 본문 |
| `useInterviewSession`(단수) | 존재 X. 세션 **목록**만 `useInterviewSessions`(복수) |

### 3.1 API 계약 레이어 — `api/interviewApi.ts`

모든 호출은 `/api/interview/**` 또는 `/api/file/**`이고, `api()` 래퍼가 `ApiResponse<T>` envelope에서 `data`만 풀어 반환한다. 핵심:

- 튜토리얼/데모(`isDataMockActive`)면 **백엔드 호출 없이 더미를 반환** → 로그인 없이 전체 흐름 시연.
- 바이너리 다운로드(`fetchFileObjectUrl`)는 envelope을 안 타므로 `api()`를 우회하고 수동 `Authorization` + `revokeObjectURL` 관리.
- 주요 함수: `listInterviewSessions`(#목록), `createInterviewSession`, `generateExpectedQuestions`(#19), `generateFollowUps`(#20), `createRealtimeSession`(#21 ephemeral key), `submitAnswer`(#22), `getInterviewReport`(#23), `getModelAnswer`, `getAgentSteps`, `getSessionReview`.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 답변 입력의 3갈래 (텍스트 / 음성 / 영상)

거론되는 단일 `AnswerInput`은 실제로 **입력 매체별로 다른 탭/컴포넌트**로 갈라진다. 매체가 다르면 캡처·점수화·프라이버시 정책이 전부 다르기 때문이다.

| 매체 | 컴포넌트 | 입력 캡처 | 채점 경로 |
| --- | --- | --- | --- |
| 텍스트 | `QuestionItem`의 `textarea` | 그냥 문자열 | `submitAnswer` → 멀티에이전트 채점 |
| 음성(프리미엄) | `RealtimeInterviewTab` | WebRTC mic + 온디바이스 지표 | OpenAI Realtime 대화 + 트랜스크립트 LLM 채점 |
| 음성(베이직) | `LocalVoiceInterviewTab` | MediaRecorder + 자체 STT | 외부 API 0, serve 전달력 + LLM 내용 채점 |
| 영상(아바타) | `AvatarTab` / `LocalAvatarTab` | MediaPipe + 카메라 | late fusion(내용 0.5 + 음성 0.25 + 영상 0.25) |

텍스트 답변 입력 자체는 단순하지만, **제출 시 모범답안 동봉**이 핵심 설계다:

```tsx
// ExpectedQuestionsTab.tsx — QuestionItem.handleSubmit (축약)
// 모범답안을 봤다면 그 답안을 "만점 기준(답안지)"으로 함께 보낸다.
const evaluated = await submitAnswer(question.id, { answerText: answer, modelAnswer });
setResult(evaluated);

// 압박 면접: 본질문에 답하면 반박(꼬리질문) 1개를 자동 생성(1회만)
if (isPressure && !isFollowUp && !rebuttalRequested) {
  setRebuttalRequested(true);
  await handleFollowUp();
}
```

`modelAnswer`는 사용자가 "모범답안 보기"를 눌렀을 때만 채워진다. 안 봤으면 `null`을 보내 백엔드가 자체 기준으로 채점한다. 이렇게 **사용자가 본 답안 = 채점 만점 기준**을 일치시킨다(자세한 백엔드 로직은 [답변 평가](/area-d/answer-evaluation) 참고).

### 4.2 압박 모드 자동 꼬리질문 (UI 측 중복 방지)

압박 모드에서만 답변 후 `handleFollowUp`이 자동 1회 실행된다. 재제출(복원 답변 다시 제출 등) 시 또 만들지 않도록 두 겹의 가드를 둔다:

- `rebuttalRequested` 로컬 플래그(1회 호출 보장)
- 마운트 시 `alreadyHasRebuttal = questions.some(x => x.parentQuestionId === q.id)` — 이미 자식 꼬리질문이 DB에 있으면 처음부터 막음

생성된 꼬리질문은 `FOLLOW_UP` 타입으로 들여쓰기 indigo 배지 카드로 렌더된다. ([꼬리 질문](/area-d/followup-questions) 참고)

### 4.3 답변 평가 결과 표시 (EvaluationPanel 역할)

채점 결과는 `QuestionItem` 내부에서 직접 렌더된다. 진행 중에는 진행바, 끝나면 점수·피드백·만점 안내가 나온다:

```tsx
// 채점 중: 시간 기반 진행바
<InterviewProgressBar active={submitting} estimatedMs={8000}
  label="AI가 답변을 채점·검증하고 있어요" />

// 완료: 점수 + 피드백 + 만점/개선 안내
{!submitting && result && (
  <>
    점수 <span className={getScoreColor(result.score)}>{result.score}점</span>
    {result.feedback && <p>{toSentenceLines(result.feedback)}</p>}
    {result.score === 100
      ? "만점이에요. 이대로 말하면 됩니다."
      : '위 "모범답안 보기"로 만점 기준 답안을 확인해 보세요.'}
  </>
)}
```

`getScoreColor`는 75/60 경계로 초록/주황/빨강을 매핑하고, `toSentenceLines`는 문장부호 뒤에 줄바꿈을 넣어 모범답안·피드백을 읽기 쉽게 만든다(둘 다 `types/interview.ts` 유틸).

### 4.4 복습 테스트의 phase 머신 (`PracticeTab`)

블라인드 복습은 명확한 상태 머신으로 흐른다:

```text
loading → empty | intro → answering → scoring → results
```

- `intro`: Fisher-Yates `shuffle`로 출제 순서 무작위화, 꼬리질문은 `questionType !== "FOLLOW_UP"`로 제외.
- `answering`: 모범답안·피드백 없이 `draft`만 모은다(`answers` 맵 누적).
- `scoring`: **마지막에 일괄 채점** — `for (const q of questions) await submitAnswer(...)` 순차 루프 후 `getAgentSteps`로 trace 일괄 조회.
- `results`: 문항별 점수/피드백/AI 개선답변 + 각 질문의 `AgentTimeline`.

순차 `await` 루프인 이유: 같은 세션의 채점을 동시에 던지면 멀티에이전트 trace가 섞이고 서버 부하가 튄다. UX상으로도 "마지막에 한 번 채점"이 시험처럼 느껴진다.

### 4.5 멀티에이전트 trace 순차 재생 (`AgentTimeline`)

채점이 끝난 뒤 저장된 `interview_agent_step[]`을 받아 **550ms 간격으로 한 단계씩** 노출한다. 마지막으로 등장한 단계는 "진행 중" 스피너로 보여, 실제로는 이미 끝난 작업이지만 "에이전트가 지금 일하는" 체감을 준다.

```tsx
// AgentTimeline.tsx (축약) — 저장된 step을 클라이언트가 순차 재생
useEffect(() => {
  setVisible(0);
  let i = 0;
  const timer = setInterval(() => {
    setVisible(++i);
    if (i >= steps.length) clearInterval(timer);
  }, 550);
  return () => clearInterval(timer);
}, [steps]);
```

각 step의 `agent`(RETRIEVER/EVALUATOR/CRITIC/PROBER/PLANNER/REPORTER)별로 아이콘·색이 매핑되고, `detail`(JSON 문자열)을 파싱해 점수/판정/근거/조정점수를 펼쳐 본다.

:::warning 실시간 스트리밍은 아직 아니다
`AgentTimeline`은 **이미 저장된** 단계를 재생할 뿐, 서버에서 실시간으로 밀어주는 SSE가 아니다. 컴포넌트 주석에 그대로 적혀 있다: "현재는 저장된 단계를 클라이언트에서 순차 재생한다. 서버 푸시(SSE) 실시간 스트리밍은 후속(EventSource의 인증 헤더 제약으로 fetch-stream 도입 필요 — 로드맵 6-1)."
:::

### 4.6 리포트 화면 (`InterviewReportTab`)

리포트(텍스트)와 미디어 분석(음성/영상)은 **독립적으로 병렬 로드**한다 — 한쪽이 없어도 다른 쪽을 보여준다:

```tsx
const [rep, med] = await Promise.all([
  getInterviewReport(session.id).catch(() => null),
  listMediaResults(session.id).catch(() => [] as MediaAnalysis[]),
]);
```

총점은 `previousScore`가 있으면 **직전 세션 대비 증감**을 함께 표시(`+8점` 식)해 성장 추적을 시각화한다. 카테고리는 `Progress` 바, 종합 피드백은 불릿으로 렌더한다.

## 5. SSE 수신 — `useAutoPrepRun` (왜 `fetch` 스트림인가)

면접 화면 자체는 일반 REST다. **SSE는 면접 화면이 아니라 홈의 자동 준비(AutoPrep) 오케스트레이터**의 것이다(D 코어가 소유). 한 줄 요청을 6파트(A~F)로 풀어 실행하며, 그중 D 파트가 "세션 생성 + 예상 질문 생성"이다.

### 5.1 왜 `EventSource`가 아니라 `fetch` 스트림인가

`EventSource`(표준 SSE 클라이언트)는 **커스텀 헤더를 못 붙인다.** 우리는 JWT를 `Authorization: Bearer ...`로 보내야 하므로, `fetch` + `ReadableStream`을 직접 읽어 SSE 프레임(`\n\n` 구분)을 손수 파싱한다(`autoPrepApi.ts`의 `runStream`):

```ts
// autoPrepApi.ts (축약) — SSE는 envelope을 안 타므로 api() 우회 + 수동 토큰
const res = await fetch(`${BASE}/auto-prep/run/stream`, {
  headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
  body: JSON.stringify(req), signal,
});
const reader = res.body.getReader();
// buffer.indexOf("\n\n")로 이벤트 경계를 잘라 event:/data: 라인을 파싱
```

### 5.2 이벤트 → 리듀서 → 화면

`useAutoPrepRun` 훅이 스트림을 구독하고, 6종 이벤트를 순수 리듀서로 누적한다:

| 이벤트 | 리듀서 동작 |
| --- | --- |
| `plan` | 계획의 `steps`를 받아 파트 카드를 `pending`으로 초기화 |
| `part-start` | 해당 파트를 `running`으로 |
| `substep` | 파트 안에 서브스텝을 append(진행 로그) |
| `part-done` | `DONE`/`SKIPPED`/`FAILED`로 마킹 |
| `done` | 전체 완료 메시지 |
| `error` | 에러 메시지 + 중단 |

```ts
// useAutoPrepRun.ts (축약) — AbortController로 취소 가능한 SSE 구독
const ac = new AbortController();
abortRef.current = ac;
setState({ ...INITIAL, running: true });
await runStream(req, (e) => setState((prev) => reduce(prev, e)), ac.signal);
```

`AbortController`로 컴포넌트 언마운트/재시작 시 스트림을 끊는다. `cancel`/`reset`이 모두 `abort()`를 부른다.

:::tip Hero 경유 자동 셋업은 SSE가 아니다
홈 검색창(`InterviewHero`)에서 면접으로 직접 넘어오는 `AutoSetupPanel`은 백엔드 SSE를 쓰지 않는다. 기존 면접 REST API 4스텝(요청 분석 → 모드 선정 키워드 규칙 → `createSession` → `generateQuestions`)을 **클라이언트에서 자율에이전트처럼 연출**할 뿐이다. SSE 6파트는 autoprep 채팅 모달 쪽이다.
:::

## 6. 구현 상태 (됨 vs 계획) 정직 구분

**구현되어 동작함:**

- 8탭 단일 페이지, 공유 상태 + URL 쿼리 탭, 모드 6종 선택, 최근 기록 더보기 페이징·복기 모달
- 텍스트 답변·평가(모범답안 동봉), 압박 자동 꼬리질문, 블라인드 복습 테스트(일괄 채점)
- `AgentTimeline` 순차 재생, 시간 기반 진행바, 리포트·미디어 병렬 로드, 이전 점수 대비 증감
- 음성(Realtime/베이직)·아바타(HeyGen/베이직) 탭, 온디바이스 음성/영상 지표
- 튜토리얼/데모 모드(로그인 없이 더미로 전체 흐름), autoprep SSE 수신·리듀서

**계획/진행 중 (정직히):**

- **에이전트 trace 실시간 SSE 스트리밍**: 현재는 저장된 step의 클라이언트 순차 재생. `EventSource` 인증 헤더 제약으로 fetch-stream 도입 필요(로드맵 6-1).
- **모드 6종만 실사용**: 스키마 주석의 `REAL`/`PORTFOLIO`는 프론트 타입에 없는 미사용 잔재.
- **개선답변(AI 첨삭)** 표시는 평가기 경로에 따라 채워짐이 갈린다 — OpenAI strict json_schema 경로에선 빈 문자열이 올 수 있다([답변 평가](/area-d/answer-evaluation)의 구조화 출력 불일치 참고).
- `useInterviewSessions`는 **목록 페이징 전용**이고, "활성 세션 진행"을 담는 단수 훅은 없다(상태는 `InterviewPage`가 직접 보유).

## 7. 면접 답변 3단계

1. **무엇 (한 문장):** "가상 면접 프론트는 라우트를 쪼개지 않고 단일 `InterviewPage` + 8탭으로 묶었습니다. 한 세션 상태를 페이지가 들고, 탭은 URL 쿼리로만 전환합니다."
2. **왜 (의도):** "면접 5단계가 같은 세션 한 건을 공유하기 때문에, 라우트를 나누면 단계 간 상태 전달 비용이 큽니다. 단일 페이지가 `activeSession`을 보유하면 prop 1단계로 끝나고, 진행률을 모르는 LLM 호출에는 시간 기반 진행바를, 멀티에이전트 채점에는 trace 순차 재생을 붙여 체감과 신뢰를 동시에 잡았습니다."
3. **어떻게 (근거):** "텍스트 답변은 `QuestionItem`의 textarea가 모범답안을 만점 기준으로 동봉해 `submitAnswer`로 보내고, 음성/영상은 매체별 탭으로 갈라 캡처·채점·프라이버시를 분리합니다. 자동 준비 SSE는 `EventSource`가 헤더를 못 붙여서 `fetch` 스트림을 직접 파싱하고, `useAutoPrepRun` 리듀서로 6파트 진행을 누적합니다."

## 8. 꼬리질문 + 모범답안

:::details Q1. 왜 면접을 라우트로 쪼개지 않고 한 페이지에 탭으로 넣었나요?
다섯 단계가 같은 세션 한 건을 공유하기 때문입니다. 라우트를 나누면 `selectedMode`·`activeSession` 같은 상태를 매 전환마다 전역 스토어나 URL로 넘겨야 하는데, 단일 `InterviewPage`가 그 상태를 `useState`로 들면 각 탭에 prop 한 번만 내려주면 됩니다. 탭 전환은 URL 쿼리(`?tab=`)로만 해서 새로고침·딥링크에서도 같은 탭이 열립니다. 잘못된 쿼리는 `modes`로 폴백합니다.
:::

:::details Q2. AI 채점은 응답이 언제 올지 모르는데 진행바를 어떻게 그리나요?
실제 진행률을 못 받으니 `InterviewProgressBar`가 경과 시간 기반 점근 곡선으로 0→90%까지 채우고, 응답이 도착해 `active`가 `false`가 되면 100%로 채운 뒤 사라집니다. `estimatedMs`만 단계별로 다르게 줍니다(질문 생성 13초, 채점 8초 등). 순수 타이머라 provider를 OpenAI에서 로컬 LLM으로 바꿔도 그대로 동작합니다. 정직히 말하면 이건 '체감용 가짜 진행바'입니다.
:::

:::details Q3. 멀티에이전트 채점 과정을 화면에서 어떻게 보여주나요? 실시간인가요?
백엔드가 `interview_agent_step`에 저장한 단계를 `getAgentSteps`로 받아, `AgentTimeline`이 550ms 간격으로 한 단계씩 등장시킵니다. 마지막 등장 단계는 스피너로 '진행 중'처럼 보이지만 실제로는 이미 끝난 작업의 재생입니다. 진짜 서버 푸시 SSE는 아직 아니고, `EventSource`가 인증 헤더를 못 붙이는 제약 때문에 fetch-stream 전환이 로드맵(6-1)에 있습니다.
:::

:::details Q4. 답변 제출할 때 모범답안을 같이 보낸다는 게 무슨 뜻인가요?
사용자가 '모범답안 보기'를 누른 경우에만 그 답안을 `submitAnswer`의 `modelAnswer`로 동봉합니다. 그러면 백엔드가 그 답안을 만점(100점) 기준 답안지로 삼아 채점하므로, '사용자가 본 답안'과 '채점 기준'이 어긋나지 않습니다. 안 봤으면 `null`을 보내 STAR·두괄식 같은 자체 기준으로 채점합니다. 복습 테스트는 블라인드라 모범답안을 안 보내고 전부 자체 기준으로 채점합니다.
:::

:::details Q5. 음성·영상 답변 입력은 왜 텍스트와 다른 컴포넌트인가요?
매체마다 캡처 방식(WebRTC mic, MediaRecorder, MediaPipe 카메라), 채점 경로(Realtime 대화, 자체 STT, late fusion), 프라이버시 정책(원본 미저장·동의 체크박스)이 전부 다르기 때문입니다. 텍스트는 `QuestionItem`의 textarea로 충분하지만, 음성은 `RealtimeInterviewTab`/`LocalVoiceInterviewTab`, 영상은 `AvatarTab`/`LocalAvatarTab`로 갈라 각자 상태 머신(`idle/connecting/live/analyzing/scored/error`)을 가집니다. 공통 `AnswerInput` 하나로 묶으면 분기가 너무 커집니다.
:::

:::details Q6. 자동 준비(autoprep) SSE는 왜 fetch로 직접 파싱하나요?
표준 `EventSource`는 `Authorization` 같은 커스텀 헤더를 붙일 수 없습니다. JWT를 헤더로 보내야 해서 `fetch` + `ReadableStream`을 직접 읽고, `\n\n`으로 SSE 프레임을 잘라 `event:`/`data:` 라인을 손수 파싱합니다(`runStream`). `useAutoPrepRun`이 이걸 구독해 `plan/part-start/substep/part-done/done/error` 6종 이벤트를 순수 리듀서로 누적하고, `AbortController`로 언마운트 시 스트림을 끊습니다. 참고로 이 SSE는 면접 화면이 아니라 홈의 6파트 오케스트레이터 것입니다.
:::

## 9. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 주제는 통과다.

- `InterviewPage`가 들고 있는 공유 상태 5개와, 탭 전환을 URL 쿼리로 한 이유.
- 텍스트 답변 제출 시 `modelAnswer`를 언제·왜 동봉하는가, 복습 테스트와 어떻게 다른가.
- `InterviewProgressBar`가 가짜 진행바인 이유와 점근 곡선의 동작.
- `AgentTimeline`이 "실시간"이 아니라 "재생"인 이유와, 진짜 SSE가 막힌 기술적 원인.
- `useAutoPrepRun`이 `EventSource` 대신 fetch-stream을 쓰는 이유, 6종 이벤트 리듀서.

## 퀴즈

<QuizBox question="가상 면접 프론트엔드의 실제 구조로 옳은 것은?" :choices="['Start/Session/Report 3개 라우트로 페이지가 분리되어 있다', '단일 InterviewPage + 8탭이고 탭은 URL 쿼리(?tab=)로 전환한다', '탭별로 별도 zustand 스토어가 세션 상태를 들고 있다', 'useInterviewSession(단수) 훅이 활성 세션을 관리한다']" :answer="1" explanation="실제는 단일 InterviewPage가 공유 상태(selectedMode/activeSession 등)를 useState로 들고, 8개 탭을 URL 쿼리로 전환한다. InterviewStartPage 등 분리 페이지나 단수 useInterviewSession 훅은 존재하지 않는다." />

<QuizBox question="InterviewProgressBar가 '시간 기반 가짜 진행바'인 이유는?" :choices="['백엔드가 진행률 SSE를 안 보내줘서', 'LLM 호출은 요청→블랙박스→응답이라 실제 진행률을 알 수 없어서', 'CSS 애니메이션이 더 부드러워서', 'provider별 진행률 포맷이 달라서 통일이 안 돼서']" :answer="1" explanation="LLM 응답은 진행률(%)을 주지 않으므로, 경과 시간 기반 점근 곡선으로 0→90%까지 채우고 응답 도착 시 100%를 채운다. 타이머 기반이라 provider를 바꿔도 동작한다." />

<QuizBox question="autoprep SSE 수신에서 EventSource 대신 fetch 스트림을 직접 파싱하는 핵심 이유는?" :choices="['EventSource는 POST를 못 보내고 커스텀 Authorization 헤더도 못 붙여서', 'fetch가 더 빠르기 때문에', 'SSE 표준을 브라우저가 지원하지 않아서', 'envelope(ApiResponse)을 자동으로 벗겨주기 때문에']" :answer="0" explanation="EventSource는 커스텀 헤더(JWT Authorization)를 붙일 수 없어, fetch + ReadableStream으로 직접 SSE 프레임을 파싱한다. AgentTimeline의 실시간 SSE가 아직 막힌 것도 같은 인증 헤더 제약 때문이다." />

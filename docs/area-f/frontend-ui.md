# F 프론트엔드 UI/UX

> 영역 F의 사용자 화면은 라우터를 거의 바꾸지 않는 "단일 페이지 상태 머신"과, Provider 없이 스스로 마운트하는 공용 토스트, 그리고 같은 챗봇 위젯 하나가 FAQ 답변·면접 준비 오케스트레이션을 모두 처리하는 구조로 묶여 있다. 핵심은 "낙관적 업데이트 + tombstone 보존 + 환각/오류에 안전한 폴백"이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

F 프론트엔드는 **커뮤니티(목록·상세·작성·댓글)**, **고객센터(FAQ·공지·문의)**, **알림**, 그리고 **인테이크 챗봇 모달**까지 사용자가 직접 만지는 화면 전부다. 백엔드 AI(검열·태그·추출·신고·초안)와 챗봇(FAQ-RAG·커뮤니티 에이전트·인테이크 오케스트레이터)이 만든 결과를 **어떤 UI 규칙으로 노출하고, 어떤 실패에도 화면이 안 깨지게 하는가**가 이 영역의 본질이다.

이 페이지가 답하는 면접 질문:

- "커뮤니티 상세에서 좋아요를 누르면 어떻게 즉시 반영되나? 실패하면?"
- "삭제된 댓글에 달린 답글은 어떻게 살아남나?"
- "알림은 왜 SSE가 아니라 폴링인가?"
- "챗봇 위젯 하나가 어떻게 FAQ와 면접 준비를 둘 다 하나?"
- "AI 추천 태그는 화면에서 어떻게 구분해 보여주나?"

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

이 영역의 UI 결정은 대부분 "백엔드가 비동기·AI라서 느리거나 실패할 수 있다"는 전제에서 나온다.

| 결정 | 의도 | 트레이드오프 |
| --- | --- | --- |
| **단일 페이지 viewMode 머신** (커뮤니티) | 목록↔상세↔작성을 라우터 교체 없이 전환해 상태(스크롤·필터)를 잃지 않음 | `pushState`/`popstate`를 수동 관리해야 하고 딥링크 복귀 로직이 복잡해짐 |
| **낙관적 업데이트** (좋아요·북마크·댓글) | 클릭 즉시 setState로 반응성 확보 | 실패 시 롤백 + 토스트로 정합성 회복 필요 |
| **tombstone 보존** (삭제 댓글) | 자식 답글이 부모 삭제에도 트리에서 유지 | "삭제된 댓글입니다" placeholder를 계속 렌더 |
| **알림 = Web Push + 폴링** | SSE 인프라 과투자 회피, 탭 숨김 시 폴링 중단으로 비용 절약 | 최대 30초 지연(`UNREAD_POLL_INTERVAL_MS`) |
| **자체 마운트 토스트 싱글턴** | App/Provider 수정 없이 어느 영역에서나 `toast.x()` 호출 | 전역 모듈 상태(싱글턴)라 테스트 격리가 까다로움 |
| **챗봇 단일 엔드포인트** (`/chatbot/ask`) | FAQ·에이전트·인테이크를 한 위젯에서 처리, 화면 분기 비용 절감 | 응답에 `inOrchestration`/`intake` 신호를 실어 클라가 모드를 분기해야 함 |
| **클라이언트 페이지네이션** | size 100으로 한 번 받아 `PER=8` 슬라이스 — 정렬/태그검색을 메모이즈로 즉시 처리 | 글 수가 폭증하면 한계(현재 규모 전제) |

핵심 철학은 **"AI/비동기 결과는 신뢰하되 검증하고, 실패해도 사용자는 막다른 길에 안 빠진다"**. 챗봇이 답을 못 찾으면(`not_found`) 상담사 연결·1:1 문의로 길을 열고, 연결이 끊기면(`disconnected`) 문의 양식으로 우회시킨다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 파일 근거)

- **스택**: React 18 + Vite 6 + TypeScript + Tailwind v4. 상태는 zustand store + 로컬 `useState` 혼합. 공통 API는 `@/app/lib/api`의 `api<T>()`(ApiResponse envelope 자동 해제), 오케스트레이터 SSE만 raw `fetch` + `TextDecoder`.
- **커뮤니티** (`features/community/`):
  - `pages/CommunityHomePage.tsx` — `ViewMode`(`list`/`detail`/`write`/`edit`/`guidelines`) 단일 머신.
  - `components/PostDetailView.tsx` — 자체 경량 마크다운 렌더러(`renderMarkdown`/`renderInline`), AI 추천 태그 칩(`getAiTags`).
  - `components/CommentSection.tsx` + `CommentItem.tsx` — 평면 목록→`parentId` 트리, `MAX_INDENT_DEPTH=5`, tombstone.
  - `components/PostEditorForm.tsx` — write/edit 겸용, 면접 카테고리 전용 블록, `TagInput`(최대 5개).
  - `components/ReactionButtons.tsx` / `ReportDialog.tsx` — 낙관적 토글 / 신고 입력(5사유, 익명).
  - `hooks/useLoginDialog.ts`의 `requireAuth(fn)` — 인증 게이팅 공통 진입점.
- **고객센터** (`features/support/`):
  - `pages/ContactPage.tsx` — 문의 접수 + `MyTicketItem` 스레드(USER/ADMIN 말풍선), CLOSED는 입력창 숨김, 파일첨부 "2차 구현 예정" 더미.
  - `pages/FaqPage.tsx` + `components/FaqAccordion.tsx` — 카테고리 필터 + 아코디언.
  - `components/ChatbotWidget.tsx` + `hooks/useChatbot.ts` — 위젯 두뇌.
- **알림** (`features/notification/`):
  - `components/NotificationBell.tsx` — visibility-aware 폴링.
  - `components/toast.tsx` — `createRoot`로 자체 마운트하는 싱글턴 토스트.
  - `types/notification.ts` — `TYPE_META`(타입 22종 → UI 메타 단일 소스), `relTime()`.
- **인테이크 모달** (`features/autoprep/`):
  - `components/AutoPrepChatModal.tsx` — 멀티턴 슬롯 채팅 팝업.
  - `hooks/useAutoPrepRun.ts` — SSE 6파트 진행 누적 reducer.

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 커뮤니티: 단일 페이지 viewMode 머신

`CommunityHomePage`는 라우터를 거의 바꾸지 않고 `viewMode` state로 화면을 전환한다. 대신 브라우저 뒤로가기를 직접 관리한다.

```tsx
// 상세로 진입: pushState 로 히스토리 한 칸 쌓고 스크롤 리셋
const handlePostClick = (post) => {
  setSelectedPost(post);
  setViewMode("detail");
  window.history.pushState({ view: "detail" }, "");
  window.scrollTo(0, 0);
};
// popstate(뒤로가기) → 목록 복귀
window.addEventListener("popstate", () => { setViewMode("list"); setSelectedPost(null); });
```

딥링크 `/community/posts/:id`(알림 클릭)와 `?view=guidelines`(쿼리)는 각각 `useEffect`로 감지해 `detail`/`guidelines`로 진입한다. 목록은 size 100으로 한 번 받고 `filteredPosts`를 `useMemo`로 정렬·태그 필터한 뒤 `PER=8`로 슬라이스 — 정렬/검색이 서버 왕복 없이 즉시 반영된다. 탭 뱃지 숫자는 `fetchCategoryCounts()`로 전체 글을 재집계한다.

### 4-2. 상세 뷰: 자체 마크다운 + AI 추천 태그 구분

본문은 외부 라이브러리 없이 `renderMarkdown`이 줄 단위로 헤딩/인용/리스트/코드펜스를 파싱하고, `renderInline`이 `**굵게**`·`` `코드` `` 만 처리한다(XSS 표면 최소화). AI 태그는 **자동 적용 안 된 추천만** 별도 칩으로 노출한다.

```tsx
// 자동 적용된 태그는 본문 태그(d.tags)에 섞이고,
// 미적용 추천만 "✦ AI 추천 태그"로 시각 분리
{aiTags && !aiTags.applied && aiTags.tags.length > 0 && (
  <div className="ct-ai-suggest"> /* Sparkles 아이콘 + ai 클래스 칩 */ </div>
)}
```

이 분기는 백엔드 #30 태그 추천의 `confidence ≥ 0.7` 게이트 결과(`applied` 플래그)를 그대로 UI에 반영한 것이다. 자세한 게이트는 [AI 태그 추천](/area-f/ai-tag-recommend).

### 4-3. 댓글: 평면→트리 + tombstone 보존

`CommentSection`이 평면 배열을 `parentId` 기준 `childrenMap`으로 묶고 `roots`를 최상위로 분리한다. `CommentItem`은 자기 자식을 재귀 렌더한다. 삭제 처리의 핵심:

```tsx
// 서버 tombstone(c.isDeleted) 또는 이번 세션 낙관적 자삭(deleted) 둘 다 삭제 표시
const isDeleted = deleted || !!c.isDeleted;
// 삭제돼도 자식 답글은 보존 → 본문만 "삭제된 댓글입니다"로 대체하고 트리는 유지
```

들여쓰기는 `MAX_INDENT_DEPTH=5`까지만, 이후는 `marginLeft: 0`으로 평탄화해 무한 들여쓰기를 막는다. 댓글 수 표시는 `!c.isDeleted`만 카운트한다.

### 4-4. 낙관적 업데이트 + 인증 게이팅

좋아요·북마크·댓글 좋아요는 모두 같은 패턴이다. `requireAuth`로 로그인 확인을 먼저 통과시키고, 즉시 setState 후 서버 호출이 실패하면 되돌린다.

```tsx
const handleLike = () => requireAuth(async () => {
  setLiked((v) => !v);                    // 1) 즉시 반영
  try { await toggleReaction("POST", postId, "LIKE"); }
  catch { setLiked((v) => !v); toast.error("좋아요 처리에 실패했습니다."); } // 2) 롤백 + 토스트
});
```

비로그인이면 `requireAuth`가 "로그인이 필요해요" `ConfirmDialog`를 띄운다.

### 4-5. 고객센터: 문의 스레드 상태 기반 입력 게이팅

`ContactPage`는 접수 폼 + `MyTicketItem` 스레드로 구성된다. 티켓 상태(`RECEIVED`/`IN_PROGRESS`/`ANSWERED`/`CLOSED`)에 따라 입력 동선이 달라진다.

```tsx
// CLOSED 는 백엔드가 추가 메시지를 400으로 거절 → 보내고 에러받는 동선을 아예 없앤다
{status === "CLOSED" ? (
  <p>종료된 문의입니다. … 위 양식으로 새 문의를 작성해 주세요.</p>
) : ( /* 추가 문의 textarea + 전송 */ )}
```

말풍선은 `senderType === "ADMIN"`이면 왼쪽 정렬·muted, 사용자면 오른쪽 정렬·primary로 그린다. 내부 메모(is_internal)는 백엔드 스레드 조회에서 제외돼 사용자 화면엔 안 나온다(#34 초안↔답변 분리 원칙의 프론트 귀결).

### 4-6. 알림: visibility-aware 폴링

`NotificationBell`은 SSE 대신 30초 폴링이지만, 탭이 숨겨지면 멈추고 복귀하면 즉시 1회 갱신 후 재개한다.

```tsx
const onVisibility = () => {
  if (document.hidden) stop();
  else { pollNotifications(); start(); }   // 복귀 즉시 갱신 + 재개
};
```

알림 타입 22종은 `TYPE_META`라는 **단일 소스**가 `{cat, icon, variant, cta, actor}`로 매핑한다. `actor: true`(COMMENT·LIKE·NEW_USER 등)는 주체 아바타 + 타입 배지를, 나머지는 카테고리 색 아이콘만 렌더한다. `relTime()`이 ISO 8601을 "방금/n분 전/어제"로 변환한다.

### 4-7. 토스트: Provider 없는 자체 마운트 싱글턴

`toast.tsx`는 모듈 레벨 `items` 배열 + `listeners` Set의 싱글턴이다. 최초 호출 시 `ensureMounted()`가 `document.body`에 컨테이너를 만들고 `createRoot`로 `ToastViewport`를 렌더한다. 그래서 `App.tsx`를 안 건드리고 전 영역이 `import { toast }` 한 줄로 쓴다.

```tsx
function ensureMounted() {
  if (root) return;
  const c = document.createElement("div"); c.id = "ct-toast-root";
  document.body.appendChild(c);
  root = createRoot(c); root.render(<ToastViewport />);
}
```

자동 소멸은 진행 바 CSS 애니메이션의 `onAnimationEnd`로 닫고(`setTimeout` 미사용), hover 시 일시정지한다. `toast.notify()`는 알림 `TYPE`을 받아 아이콘/카테고리 색을 입혀 푸시 알림처럼 표시한다.

### 4-8. 인테이크 챗봇: 슬롯 모달과 위젯 두 진입점

면접 준비 인테이크(슬롯: 지원 건 + 모드)는 **두 군데**에서 들어간다.

| 진입점 | 컴포넌트 | 동작 |
| --- | --- | --- |
| 명시적 모달 | `AutoPrepChatModal` | `intake(req)` 한 턴 호출 → `ready`면 같은 창에서 `run.start()`로 6파트 실행 |
| 통합 챗봇 위젯 | `useChatbot` + `ChatbotWidget` | `/chatbot/ask` 단일 호출, 응답의 `intake`/`inOrchestration`으로 모드 분기 |

`AutoPrepChatModal`의 한 턴 루프:

```tsx
async function step(req) {
  const res = await intake(req);            // D 의 인테이크 판정 위임
  if (res.ready) { setPhase("running"); void run.start(req); }      // 슬롯 다 참 → 실행
  else if (res.nextAsk === "CASE") /* 지원 건 칩 노출 */
  else if (res.nextAsk === "MODE") /* 모드 칩 노출 */
}
```

칩 클릭은 `pickCase`/`pickMode`가 슬롯에 값을 채워 다음 `step`을 호출한다. 중복 클릭은 `answered` 가드 + `disabled={i !== lastIdx}`(마지막 메시지의 칩만 활성)로 막는다. 모바일(`isAppContext()`)이면 전체화면 오버레이로 전환한다.

위젯 쪽 `useChatbot.sendMessage`는 응답을 받아 모드를 갱신하고, `intake.ready && autoPrepRequest`이면 D의 SSE 실행(`run.start`)으로 이어간다. 비로그인이면 실행 대신 로그인 안내 버블을 띄운다. 칩 선택은 자연어로 변환해 보낸다(`"{회사} {직무} 지원 건으로 진행할게요"`) — 백엔드의 슬롯 접지(코드 검증된 툴 호출만 신뢰)와 맞물리는 설계다. 라우터·게이트는 [인테이크 챗봇](/area-f/intake-chatbot).

### 4-9. SSE 6파트 진행: reducer로 누적

실행 화면(`AutoPrepWorkView`)은 `useAutoPrepRun`이 raw fetch SSE 이벤트(`plan`/`part-start`/`substep`/`part-done`/`done`/`error`)를 `reduce`로 part 배열에 누적한 상태를 그린다. envelope를 안 타고 `TextDecoder`로 직접 파싱하는 이유는 스트리밍이라서다.

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 커뮤니티 목록/상세/작성/댓글, 낙관적 업데이트, tombstone | ✅ 구현됨 | 실 API 연동 |
| AI 추천 태그 칩(미적용분), 면접 메타카드 | ✅ 구현됨 | `getAiTags` 연동 |
| 신고 다이얼로그(5사유·익명) | ✅ 구현됨 | 운영자 확정은 관리자 영역 |
| 고객센터 FAQ/공지/문의 스레드 | ✅ 구현됨 | legal도 실 DB API 전환 완료 |
| 알림 폴링·설정·토스트 싱글턴 | ✅ 구현됨 | |
| 챗봇 위젯(FAQ+에이전트+인테이크) | ✅ 구현됨 | 단일 `/chatbot/ask` |
| AutoPrepChatModal 멀티턴 슬롯 + SSE 실행 | ✅ 구현됨 | |
| **에디터 툴바**(`PostEditorForm`) | ⚠️ 더미 | 버튼만 있고 `onClick` 핸들러 없음(시각적 더미) |
| **파일 첨부**(문의·상세) | ⚠️ 미구현 | "2차 구현 예정" 라벨, 업로드 안 함 |
| **음성 STT/TTS**(챗봇) | ⚠️ 시뮬레이션 | `startVoice`가 `setTimeout`으로 상태만 흉내, 실제 인식 없음 |
| **EvidenceCards**(챗봇 근거 카드) | ⚠️ 데이터 미연결 | 컴포넌트는 있으나 evidence 항상 빈 배열 |
| **풀스크린 세션 목록** | ⚠️ mock | `MOCK_SESSIONS` 단일 항목 |
| **임시저장됨 · 방금** 표시 | ⚠️ 정적 문구 | 실제 임시저장 로직 없음 |

:::warning 면접에서 정직하게
"챗봇 음성과 EvidenceCards, 에디터 툴바, 파일 첨부는 UI 골격만 있고 데이터/핸들러가 미연결입니다. 의도적으로 2차 구현으로 분리해 둔 영역이라 말씀드릴 수 있습니다" — 이렇게 구분해 말하는 게 신뢰를 준다. 구현된 것처럼 포장하면 꼬리질문에서 무너진다.
:::

mock 파일 관련 주의: feature별 `data/mock*.ts`는 어디서도 import 안 되는 고아 파일이고, 실제 mock 토글은 `app/lib/mock`(`VITE_USE_MOCK`)에서 한다. 즉 F 프론트는 전부 실 API에 연동돼 있다.

## 6. 면접 답변 3단계

1. **한 문장 정의**: "F 프론트엔드는 커뮤니티·고객센터·알림·인테이크 챗봇 화면 전부이고, 비동기/AI 결과를 낙관적 업데이트와 안전한 폴백으로 노출하는 게 핵심입니다."
2. **설계 의도 한 겹**: "백엔드가 AI라 느리고 실패할 수 있어서, 좋아요는 즉시 반영 후 실패 롤백하고, 삭제 댓글은 tombstone으로 트리를 보존하고, 챗봇이 답을 못 찾으면 상담사로 길을 엽니다. 알림은 SSE 과투자를 피해 visibility-aware 폴링으로 했습니다."
3. **구현 근거 + 정직**: "커뮤니티는 라우터 대신 `viewMode` 머신과 수동 `pushState`로, 토스트는 Provider 없이 `createRoot` 싱글턴으로 했습니다. 다만 챗봇 음성·EvidenceCards·에디터 툴바·파일 첨부는 UI만 있고 데이터/핸들러는 2차 구현으로 남겨둔 상태입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 커뮤니티에서 왜 라우터를 안 바꾸고 viewMode state로 화면을 전환했나요?
목록의 스크롤 위치·정렬·태그 필터 같은 클라이언트 상태를 라우트 교체로 날리지 않기 위해서입니다. 대신 브라우저 뒤로가기를 지원해야 해서 `window.history.pushState`로 히스토리를 쌓고 `popstate`에서 목록으로 복귀시킵니다. 알림 클릭 같은 외부 진입은 딥링크 `/community/posts/:id`로 받아 `useEffect`에서 `detail`로 전환합니다. 트레이드오프는 수동 히스토리 관리가 복잡해진다는 점입니다.
:::

:::details Q2. 삭제된 댓글에 달린 답글은 어떻게 살아남나요?
댓글은 평면 배열을 `parentId` 기준 `childrenMap`으로 트리화하고, 삭제는 노드를 제거하는 게 아니라 본문만 "삭제된 댓글입니다" placeholder로 바꾸는 tombstone 방식입니다. `isDeleted`는 서버 tombstone(`c.isDeleted`)과 이번 세션 낙관적 자삭(`deleted`)을 OR로 합쳐 판정해서, 재조회·타 사용자·관리자 숨김 어느 경로에서도 자식 답글이 유지됩니다. 댓글 카운트는 `!isDeleted`만 셉니다.
:::

:::details Q3. 알림은 왜 SSE가 아니라 폴링인가요? 단점은?
실시간 알림 자체는 Web Push(VAPID/FCM)로 실발송하고, 앱이 열려 있는 동안의 배지 갱신만 30초 폴링이 담당합니다. SSE 연결을 상시 유지하는 인프라 비용 대비 효용이 낮다고 판단해 명시적으로 SSE를 뺐습니다. 단점은 최대 30초 지연인데, 탭이 보일 때만 폴링하고(`visibilitychange`) 복귀 즉시 1회 갱신해서 체감 지연을 줄였습니다.
:::

:::details Q4. 챗봇 위젯 하나가 FAQ와 면접 준비를 둘 다 어떻게 처리하나요?
`/chatbot/ask` 단일 엔드포인트가 응답에 `inOrchestration`(오케스트레이터 모드 유지 신호)과 `intake`(슬롯 진행 메타)를 실어 보냅니다. 위젯은 이 신호로 일반 FAQ 모드와 인테이크 모드를 분기하고, 인테이크면 모드 배너·보라 그라데이션·✦ 아바타로 시각 전환합니다. 슬롯이 다 차면(`intake.ready`) D의 SSE 실행(`run.start`)으로 이어가고, 비로그인이면 실행 대신 로그인 안내를 띄웁니다. 칩 선택은 자연어 문장으로 변환해 보내 백엔드 슬롯 접지와 맞춥니다.
:::

:::details Q5. AI 추천 태그는 화면에서 어떻게 구분해 보여주나요?
백엔드 #30 태그 추천은 `confidence ≥ 0.7`이면 자동 적용(`applied=true`)하고 미만이면 추천만 저장합니다. 상세 뷰는 `getAiTags`로 결과를 받아 `applied=true`인 태그는 본문 태그(`d.tags`)에 섞여 일반 칩으로 나오고, `applied=false`인 추천만 Sparkles 아이콘이 붙은 "✦ AI 추천 태그" 영역에 별도 칩으로 분리합니다. 즉 UI 분기는 백엔드 신뢰도 게이트 결과를 그대로 반영한 것입니다.
:::

:::details Q6. 낙관적 업데이트가 실패하면 정합성은 어떻게 맞추나요?
좋아요/북마크는 클릭 즉시 setState로 토글하고, 서버 호출이 throw하면 `catch`에서 같은 토글을 한 번 더 적용해 원래 값으로 롤백한 뒤 `toast.error`로 사용자에게 알립니다. 또 `ReactionButtons`는 상세 데이터의 `liked`/`bookmarked`를 `key`로 받아, 글이 재조회되면 컴포넌트가 리마운트되면서 서버 진실값으로 초기 상태가 다시 동기화됩니다.
:::

:::details Q7. 토스트를 Provider 없이 어떻게 전역에서 쓰나요?
`toast.tsx`가 모듈 레벨 싱글턴(`items` 배열 + `listeners` Set)이고, 최초 `toast.x()` 호출 시 `ensureMounted()`가 `document.body`에 컨테이너를 만들고 `createRoot`로 뷰포트를 렌더합니다. App.tsx나 Provider 트리를 안 건드려서 커뮤니티·고객센터·알림 어느 영역에서나 `import { toast }` 한 줄로 동일하게 씁니다. 자동 소멸은 진행 바 CSS 애니메이션의 `onAnimationEnd`로 처리해 타이머 드리프트를 피했습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 90초 안에 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 커뮤니티 `viewMode` 머신이 라우터를 안 바꾸는 이유와, 그 대가로 직접 관리하는 두 가지(`pushState`·`popstate`).
2. tombstone 보존이 필요한 이유와 `isDeleted`가 두 소스를 OR하는 까닭.
3. 알림이 Web Push + 폴링인 이유, 그리고 폴링이 탭 가시성에 반응하는 동작.
4. 챗봇 단일 엔드포인트가 모드를 분기하는 두 신호(`inOrchestration`·`intake`)와 `ready` 이후 SSE 전이.
5. 구현된 것과 2차 구현(음성·EvidenceCards·툴바·첨부)을 정직하게 나눠 말하기.

## 퀴즈

<QuizBox question="커뮤니티 상세에서 좋아요를 눌렀을 때의 동작 순서로 옳은 것은?" :choices="['서버 호출 성공 후에야 화면을 갱신한다', '즉시 setState로 토글하고, 실패하면 같은 토글을 한 번 더 적용해 롤백하고 토스트를 띄운다', 'SSE로 실시간 좋아요 수를 받아 갱신한다', '페이지를 새로고침해 서버 값을 다시 가져온다']" :answer="1" explanation="requireAuth 통과 후 즉시 setLiked로 낙관적 토글, catch에서 동일 토글로 롤백 + toast.error. ReactionButtons는 key로 서버 liked/bookmarked를 받아 재조회 시 리마운트로 재동기화된다." />

<QuizBox question="삭제된 댓글에 달린 답글이 트리에서 사라지지 않는 이유는?" :choices="['삭제 시 노드를 실제로 제거하지만 답글을 부모로 승격시킨다', 'tombstone 방식 — 본문만 placeholder로 바꾸고 노드는 트리에 유지하며 isDeleted는 서버/세션 두 소스를 OR한다', '삭제된 댓글은 클라이언트가 다시 fetch해서 복원한다', '답글이 있으면 삭제 자체를 막는다']" :answer="1" explanation="CommentItem은 isDeleted = deleted(세션 낙관적) || c.isDeleted(서버 tombstone)로 판정하고, 본문만 '삭제된 댓글입니다'로 대체한 채 childrenMap 기반 자식 답글을 그대로 재귀 렌더한다." />

<QuizBox question="통합 챗봇 위젯이 일반 FAQ 모드와 면접 준비(오케스트레이터) 모드를 분기하는 근거는?" :choices="['엔드포인트가 /faq/ask 와 /intake/ask 로 나뉜다', '단일 /chatbot/ask 응답의 inOrchestration·intake 신호로 분기하고, intake.ready면 D의 SSE 실행으로 이어간다', '사용자가 토글 버튼으로 직접 모드를 고른다', '브라우저 URL 파라미터로 결정된다']" :answer="1" explanation="useChatbot은 단일 /chatbot/ask를 호출하고 응답의 inOrchestration으로 모드를 유지/해제, intake로 슬롯 진행을 표시한다. intake.ready && autoPrepRequest면 run.start로 SSE 6파트 실행에 진입하며 비로그인은 로그인 안내로 대체한다." />

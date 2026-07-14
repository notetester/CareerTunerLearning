# F 프론트엔드 UI/UX

> 커뮤니티, 고객센터, 공통 챗봇이 실제 API와 연결돼 있다. 맞춤 피드, 음성 입력, 대화 history·삭제, 문의 파일 첨부까지 포함한다.

## 커뮤니티

커뮤니티 홈은 최신·좋아요·댓글·맞춤 정렬과 카테고리·태그 필터를 제공한다. 로그인 사용자는 맞춤 정렬을 선택할 수 있고 서버가 프로필·최근 반응 기반 7:3 피드를 반환한다. 카테고리 배지는 현재 페이지 건수가 아니라 `GET /api/community/posts/category-counts`의 서버 전수 집계를 사용한다.

게시글 상세는 본문, 정형 면접 메타, 댓글, 반응, 스크랩과 신고 흐름을 연결한다. 작성자·관리자 권한에 따라 수정·소프트 삭제·운영 액션을 다르게 노출한다.

차단·탈퇴 사용자의 게시글은 limit·pagination을 적용하기 전에 제외한다. 작성자 공개 범위는 목록·상세·활동에서 같은 규칙을 쓰며, 좋아요·스크랩 같은 관계 데이터는 물리 삭제 대신 soft delete와 재활성화를 사용한다. 커뮤니티의 옛 채용공고 카테고리는 제거했고 전용 `/jobs` 게시판으로 이동한다.

## 공통 챗봇

`ChatbotWidget`은 화면 구석의 작은 모드와 중앙 확장 모드를 전환한다. 공통 router가 빠른 내비게이션, FAQ, 커뮤니티 도구, 인테이크 흐름을 구분한다.

UI는 다음 상태를 명시적으로 보여 준다.

- 사용자/assistant 메시지
- 로딩과 중단
- FAQ 근거와 이동 링크
- 다음 선택 chip
- 지원 건·면접 모드 인테이크
- 파일 연결과 AutoPrep handoff
- 과거 대화 목록·복원·삭제
- AUTO/CAREERTUNER/CLAUDE/OPENAI 모델 선택

## 음성 입력

챗봇 마이크는 `SpeechRecognition`/`webkitSpeechRecognition`을 감싼 Web Speech API wrapper를 사용한다.

- Chrome/Edge 계열에서 사용 가능
- 지원하지 않는 브라우저는 마이크 UI를 안전하게 비활성/안내
- interim/final transcript를 입력창에 반영
- 브라우저 vendor 서버를 경유할 수 있어 완전 오프라인 STT라고 말하지 않음

D의 faster-whisper 경로와 F 챗봇의 Web Speech 입력은 다른 구현이다.

## 대화 history와 삭제

로그인 사용자는 과거 대화를 조회하고 다시 열 수 있다. DELETE는 본인 소유 대화만 허용하며 서버가 메시지 memory와 인테이크 슬롯을 함께 정리한다.

자동 TTL은 현재 없으므로 사용자가 명시적으로 삭제할 수 있다는 것과 자동 보존 기간 정책을 혼동하지 않는다.

## 고객센터 파일 첨부

`ContactPage`는 문의 생성과 추가 메시지에 파일을 업로드한다.

```text
파일 선택
  -> 공통 file API 업로드
  -> attachmentFileIds 수집
  -> 문의 생성 또는 메시지 추가
  -> 서버 소유권 검증·link
  -> thread 응답의 attachments 렌더링
```

서버 `TicketServiceImpl`은 사용자 소유 파일만 문의·메시지에 연결한다. 파일 이름·크기와 다운로드 링크를 thread에서 표시한다.

## 반응형·다크 모드

- 커뮤니티 목록과 상세는 좁은 화면에서 단일 열로 재배치한다.
- 글쓰기와 사이드바 없는 스크랩 상세는 flex 부모에서 fit-content로 수축하지 않도록 `width: 100%`, 최대 폭과 desktop/mobile padding을 함께 명시한다.
- 챗봇 expanded surface는 viewport 안에서 크기를 제한하고 작은 화면에서는 거의 전체 폭을 사용한다.
- 문의 작성과 thread는 긴 파일명·본문이 가로 overflow를 만들지 않게 줄바꿈한다.
- 상태는 색만 사용하지 않고 텍스트·아이콘을 함께 표시한다.
- dark theme에서 card, border, 입력·오류 대비를 공통 토큰으로 맞춘다.

## 구현 상태

| 항목 | 상태 |
| --- | --- |
| 커뮤니티 목록·상세·반응·스크랩 | 구현 |
| 전수 카테고리 집계·차단/탈퇴 필터 | 구현 |
| 전용 채용공고 게시판 `/jobs` 연결 | 구현 |
| 맞춤 7:3 피드 정렬 | 구현 |
| 챗봇 FAQ·커뮤니티·인테이크 | 구현 |
| Web Speech STT | 구현, 브라우저 지원 의존 |
| 대화 목록·복원·삭제 | 구현 |
| 문의 생성·thread | 구현 |
| 문의 파일 첨부 | 구현 |
| 대화 자동 TTL | 없음 |

## 면접 답변

> "F 프런트는 커뮤니티와 고객센터, 공통 챗봇을 실제 API에 연결합니다. 맞춤 피드는 프로필·최근 반응 70%와 신선·인기 30%를 섞고, 챗봇은 FAQ·커뮤니티·AutoPrep 인테이크를 한 widget에서 라우팅합니다. Web Speech 음성 입력과 DB 대화 history·삭제를 제공하며, 고객 문의는 공통 file 업로드 후 attachmentFileIds를 서버가 소유권 검증해 연결합니다. 반응형과 dark theme에서도 긴 본문·파일명이 레이아웃을 깨지 않게 구성했습니다."

<QuizBox question="F 챗봇 STT의 현재 방식은?" :choices="['미구현 버튼', 'Web Speech API wrapper', '항상 faster-whisper 서버', '텍스트를 임의 생성']" :answer="1" explanation="SpeechRecognition/webkitSpeechRecognition 지원 브라우저에서 입력을 받아온다." />

<QuizBox question="고객 문의 첨부의 흐름은?" :choices="['파일명을 텍스트로만 저장', '파일 업로드 후 ID를 문의·메시지에 소유권 검증해 연결', 'DB에 base64 직접 삽입', '관리자만 첨부 가능']" :answer="1" explanation="ContactPage와 TicketServiceImpl이 attachmentFileIds 계약을 사용한다." />

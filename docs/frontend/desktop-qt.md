# 데스크톱 앱: C++ · Qt · QML

> CareerTuner Desktop은 웹 화면을 감싼 단순 WebView가 아니다. 같은 Spring REST API를 소비하는 별도 Qt Quick 클라이언트이며, 면접 준비·실시간 진행·로컬 산출물 저장에 초점을 둔다.

## 왜 별도 데스크톱 앱인가

웹과 모바일은 이동 중 탐색·입력에 적합하지만, 긴 면접 연습·리포트 비교·파일 저장·트레이 알림은 데스크톱 작업 흐름이 편하다. 서버의 AI·권한·DB 로직을 다시 만들지 않고 클라이언트 책임만 분리했다.

```text
Qt/QML 화면
  └─ C++ core
       ├─ AuthService / ApiClient
       ├─ InterviewSession / VoiceRecorder
       ├─ AutoPrepRunner / SseClient
       ├─ CollaborationClient
       └─ SettingsStore / local export
              │
              └─ 기존 Spring /api/**
```

## 기술 선택

| 기술 | 역할 |
| --- | --- |
| Qt Quick / QML | 선언형 데스크톱 UI, 반응형 패널, 테마 |
| C++17 | 네트워크·인증·파일·미디어·SSE 상태 관리 |
| Qt Network | REST, multipart, 파일 다운로드 |
| Qt Multimedia | 마이크 녹음 |
| QSettings | 서버 주소·사용자 설정·자동 로그인 상태 영속 |
| CMake | 빌드와 테스트 |
| windeployqt + NSIS | Windows 런타임 수집, ZIP·설치형·포터블 패키징 |

## 핵심 기능

- access token 첨부와 refresh를 이용한 자동 로그인
- 면접 세션 목록, 질문→답변→채점→꼬리질문 타임라인
- m4a 음성 녹음, 전사·전달력 점수 API 연결
- 리포트 Markdown/HTML 저장과 세션 자료 일괄 내보내기
- AutoPrep POST-SSE 실행 단계 표시
- 친구·대화방·쪽지·공고·첨부 공유
- 알림 폴링과 시스템 트레이 알림
- 웹 기능을 여는 명시적 handoff
- 라이트·다크 테마와 접이식 폰 패널

## 웹·모바일과 공유하는 것과 공유하지 않는 것

| 공유 | 플랫폼별 구현 |
| --- | --- |
| REST API 계약과 `ApiResponse` | React 컴포넌트 vs QML 화면 |
| JWT/refresh 인증 흐름 | 브라우저 저장소 vs QSettings |
| 면접 세션·리포트 DB | 데스크톱 로컬 export |
| AutoPrep SSE 이벤트 의미 | C++ 스트림 파서 |
| 사용자·권한·지원 건 | 마이크·트레이·패키징 |

클라이언트가 셋이라고 비즈니스 로직을 세 벌 만들지 않는다. 서버가 권위 있는 상태를 갖고, 플랫폼은 입력 장치와 표시 방식을 달리한다.

## 로컬 데이터와 보안 경계

자동 로그인을 켜면 refresh 정보와 설정이 로컬 설정 저장소에 남는다. 따라서 OS 계정·파일 권한이 신뢰 경계다. 데모 PC에서는 공용 계정 사용을 피하고, 시연 뒤 로그아웃·설정 초기화·내보낸 개인정보 파일 삭제를 확인한다.

서버 주소는 설정 가능하지만 release 기본은 신뢰하는 HTTPS endpoint여야 한다. 임의 HTTP 주소를 운영 기본으로 두지 않는다.

## Windows 배포 형태

| 형태 | 사용성 |
| --- | --- |
| ZIP | 압축 해제 후 실행, 가장 단순한 배포 |
| NSIS 설치형 | 시작 메뉴·바탕화면·제거 항목 제공 |
| 단일 포터블 실행 파일 | 실행 시 Qt 런타임을 임시로 풀고 설정·문서를 옆 데이터 폴더에 저장 |

“단일 포터블”은 Qt를 정적으로 모두 링크한 한 파일이 아니라, 패키지 런처가 필요한 런타임을 펼쳐 실행하는 형태다.

## 검증 기준

검증 원장에는 Qt 6.11.1 Release 빌드, CTest, `windeployqt`, ZIP·NSIS 설치형·포터블 생성, 패키지 실행 후 로그인·세션·웹 handoff·설정·라이트/다크 확인이 기록되어 있다. 이 증거는 해당 기준 커밋에 대한 결과이며 이후 데스크톱 변경이 있으면 영향 항목만 다시 검증한다.

## 면접에서의 짧은 답변

> “데스크톱은 WebView가 아니라 C++/Qt Quick 별도 클라이언트입니다. 서버 API와 인증·면접 상태는 웹/모바일과 공유하고, 마이크 녹음·트레이 알림·리포트 로컬 저장·Windows 패키징만 데스크톱 책임으로 뒀습니다. 비즈니스 규칙을 복제하지 않아 세 플랫폼의 결과가 어긋나는 문제를 줄였습니다.”

## 근거 경로

- `desktop/README.md`
- `desktop/CMakeLists.txt`
- `desktop/core/`
- `desktop/qml/`
- `desktop/scripts/package-windows.ps1`
- `.github/workflows/desktop-release.yml`

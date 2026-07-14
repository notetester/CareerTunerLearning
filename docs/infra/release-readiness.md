# 시연·릴리스 준비도 원장

> “테스트를 통과했다”는 말은 기준 커밋·플랫폼·외부 조건과 함께 기록해야 한다. 이 페이지는 검증을 반복하지 않으면서도 새 변경의 영향만 다시 확인하는 방법을 설명한다.

## 왜 체크리스트를 원장으로 만들었나

A~F와 웹·Android·Desktop을 매번 처음부터 검사하면 시간이 오래 걸리고, 무엇을 실제로 확인했는지도 흐려진다. 반대로 “지난번에 됐다”만 믿으면 새 PR이 깨뜨린 회색지대를 놓친다.

CareerTuner는 다음 두 파일을 정본으로 둔다.

- `docs/verification/DEMO_READINESS_LEDGER.md`: 사람이 읽는 기준점·증거·상태
- `docs/verification/demo-readiness-checks.json`: 변경 파일과 재검증 항목의 기계적 매핑

selector는 기준 SHA 이후 변경 파일을 보고 필요한 체크만 고른다. 매핑되지 않은 파일이 있으면 조용히 건너뛰지 않고 strict mode에서 실패한다.

## 상태 의미

| 상태 | 의미 |
| --- | --- |
| `PASS` | 기록된 기준점에서 해당 전체 검증을 통과 |
| `PASS_TARGETED` | 이전 전체 검증 뒤 바뀐 영향 범위만 재검증 |
| `PASS_MANUAL` | 운영 계정·단말·유료 공급자 시나리오를 책임자가 직접 완주(민감 증거는 미저장) |
| `PENDING_LIVE` | 코드·로컬 검증은 됐지만 실제 배포 뒤 확인 필요 |
| `BLOCKED_EXTERNAL` | 공급자 콘솔·자격증명·서명 계정 같은 외부 조건 대기 |
| `DEFERRED` | 현재 시연 완료 조건과 분리해 명시적으로 미룬 후속 운영 항목 |

`BLOCKED_EXTERNAL`은 구현 실패와 다르다. mock 데모는 통과할 수 있어도 실 OAuth·SMS·유료 모델 호출은 공급자 설정 없이는 검증할 수 있다.

## 2026-07-14 최종 기록의 범위

검증 원장에는 다음 증거가 기록돼 있다.

- 백엔드 1,692개 테스트와 표적 실패 수정
- 프런트 typecheck, A~F demo, 관리자 접근, native OAuth/config/deep link, 모델 재시도 검사
- MySQL 8.4 빈 DB canonical schema·seed·패치 2회 적용
- 웹 390px 반응형, 라이트/다크, 고객센터·첨삭·관리자 권한 실브라우저 확인
- Android release-safe Capacitor 설정, Gradle task, 에뮬레이터 설치·화면 확인
- Qt Desktop Release 빌드, CTest, ZIP·설치형·포터블 패키지와 실행 확인
- 사용자 콘텐츠·관계의 소프트 삭제·재활성·orphan 방지 확인
- 웹·백엔드·DB·Android 배포 및 readiness 확인
- 운영 API 장애일 때만 독립 mock 백업으로 전환하는 경로 확인
- PR #448 필수 Frontend·Service·Documentation CI와 strict selector 통과
- `20260714_auto_prep_case_dedupe.sql` 운영 적용, backend/DB readiness `UP`
- backend·web·sanitized mock 배포와 Android `live-pr448` release 성공
- Google/Kakao/Naver OAuth, Claude Haiku/OpenAI GPT, SMS 수동 live 완주(`PASS_MANUAL`)

이 목록은 PR #448 merge `167f5feffa6f80b55b47333565a7d357821c1e5f`와 최종 원장 PR #449를 포함한 기록이다. Learning 기준 SHA `23bb4d22`까지의 이후 변경은 문서·서브모듈 pointer와 화면 설명 변경이며, 기능 변경이 생기면 selector가 고른 범위만 다시 검증한다.

## 플랫폼별 시연 핵심

| 플랫폼 | 반드시 확인할 경계 |
| --- | --- |
| 웹 | 인증·권한, 반응형, 라이트/다크, 실제 API 우선·장애 fallback |
| Android | release HTTPS 정책, verified App Link, 권한, 뒤로가기, 하단 탭, 실기기/에뮬레이터 |
| Desktop | login/refresh, SSE, 면접, 로컬 export, 웹 handoff, 패키지별 실행, 테마 |

“같은 API를 쓴다”는 것만으로 세 플랫폼 연동이 검증되는 것은 아니다. deep link, 토큰 저장, 파일·마이크, SSE 종료, 테마처럼 플랫폼별 입출력을 따로 확인한다.

## 외부 구성은 별도 게이트

공개 코드에는 자격증명을 넣지 않는다. 다음은 시연 전에 운영자가 별도로 확인해야 한다.

- Google/Kakao/Naver 공급자 콘솔의 client 설정과 HTTPS 반환 주소 — 2026-07-14 수동 live 완주
- iOS Universal Link에 필요한 Apple Team ID — 개발자 활성화·테스트 중이며 Team ID 발급과 운영 전환은 `DEFERRED`
- 실 유료 AI provider 자격증명과 실제 모델 허용 범위 — Claude Haiku·OpenAI GPT 수동 live 완주
- SMS 공급자 계약·발신자 등록·키 — 실제 단말 수신·인증 수동 live 완주
- Android release 인증서와 공개 App Link 지문 일치

mock 통과는 실 공급자 검증을 대체하지 않는다. 위 `PASS_MANUAL`은 CI 성공과 다른 증거이며 계정·토큰·응답 원문은 저장소에 남기지 않는다. Apple Team ID는 아직 발급하지 않았고 현재 시연 차단 사항이 아니다.

## 장애 백업 우선순위

독립 mock 사이트는 운영 서버가 정상인데도 먼저 쓰면 안 된다.

```text
운영 readiness 정상
  → 실제 API 사용

DB 연결 계열 readiness 실패
  → 사용자에게 장애 상태 표시
  → 독립 mock 데모로 전환 가능

일반 4xx/5xx 또는 클라이언트 오류
  → 무조건 mock으로 숨기지 않음
```

장애 분류를 하지 않고 모든 오류를 mock으로 덮으면 실제 권한·입력 버그를 성공처럼 보이게 만든다.

## PR별 재검증 절차

1. 기준 SHA와 head SHA를 정한다.
2. strict selector로 영향 체크를 고른다.
3. 선택된 테스트만 실행한다.
4. 실브라우저·기기 검사가 필요한 항목은 자동 테스트와 분리해 기록한다.
5. 원장의 증거 ID·PR·SHA·검증일을 갱신한다.
6. live 상태는 배포 후 readiness·deep link·공개 자산을 읽어 본 뒤에만 올린다.
7. 미매핑 변경은 체크 정의를 추가하기 전까지 merge하지 않는다.

## 시연 당일 짧은 체크

- 운영 web과 backend readiness
- 로그인할 시연 계정과 역할
- 지원 건→공고 분석→적합도→면접→첨삭의 연결
- 사용자 선택 모델과 재시도 모델 변경
- 관리자 권한별 탭·동작 노출
- Android verified link와 마이크/파일 권한
- Desktop 패키지 실행·로그인·리포트 저장
- 운영 장애를 가정한 mock fallback, 그리고 운영 복구 뒤 원복
- 외부 OAuth·SMS·유료 AI는 실제 구성 완료 항목만 시연

## 면접에서의 짧은 답변

> “전 영역을 매번 반복 검사하지 않도록 검증 원장과 파일-체크 매핑을 만들었습니다. PR 변경 파일로 영향 항목만 선택하고, 매핑되지 않은 파일은 CI에서 실패시킵니다. PASS와 targeted PASS, live 대기, 외부 차단을 구분해 mock 성공을 실 OAuth나 기기 검증으로 과장하지 않습니다.”

## 근거 경로

- `docs/verification/DEMO_READINESS_LEDGER.md`
- `docs/verification/demo-readiness-checks.json`
- `scripts/verification/select-demo-regression-scope.mjs`
- `.github/workflows/frontend-ci.yml`
- `.github/workflows/android-release.yml`
- `.github/workflows/desktop-release.yml`
- `.github/workflows/deploy-backend.yml`
- `.github/workflows/deploy-web.yml`

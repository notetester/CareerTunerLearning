# 영역 A 면접 플레이북: 회원·인증·프로필

> 영역 A는 “누구인지”와 “어떤 프로필 버전을 분석했는지”를 보증하는 신뢰 계층이다. 다른 영역은 A 원본을 읽되 수정하지 않는다.

## 30초 답변

> “영역 A는 회원·인증·프로필 원본과 동의를 소유합니다. access JWT는 짧게 검증하고 refresh는 DB에서 회전·폐기해 세션 감사와 강제 로그아웃을 지원합니다. 프로필은 현재 1행과 불변 버전을 분리하고, AI 성공 결과가 실제 입력 version ID를 가리키게 했습니다. 프로필 점수는 모델이 아니라 서버의 직무군별 가중치 계산기가 확정합니다.”

## 1분 답변

> “인증은 이메일·아이디·소셜 로그인을 지원하고, 상태·실패 횟수·MFA를 통과해야 토큰을 발급합니다. TOTP, backup code, push approval 같은 2차 인증 경로와 소셜 계정 연결·해제를 분리했습니다. 모바일 OAuth는 검증된 HTTPS App Link로 돌아옵니다.
>
> 프로필은 `user_profile`의 현재 1행을 저장할 때 `version_no`를 올리고 같은 transaction에서 `user_profile_version` 불변 이력을 만듭니다. AI 평가 직전에는 실제 입력 객체를 version으로 고정하고 결과를 `profile_ai_analysis`에 저장합니다. 자체·Claude·OpenAI와 규칙 안전망이 같은 계약을 쓰지만 완성도 최종 점수는 서버가 계산합니다. 외부 OAuth·SMS는 코드 구현과 운영 자격증명 설정을 구분합니다.”

## 핵심 데이터

| 데이터 | 책임 |
| --- | --- |
| `users` | 계정 상태·역할·로그인 식별자 |
| `refresh_token` | 회전형 세션·폐기·기기 감사 |
| `user_social` | 공급자 계정 연결 |
| `user_consent` | append-only 동의·철회 이력 |
| `user_profile` | 현재 프로필 1행 |
| `user_profile_version` | 저장·import·AI 평가 입력의 불변 버전 |
| `profile_ai_analysis` | 기능별 최신 성공 결과와 입력 version ID |
| MFA 관련 테이블 | TOTP·backup·push challenge 상태 |

## access와 refresh를 나눈 이유

| 토큰 | 형태 | 장점 | 한계·보완 |
| --- | --- | --- | --- |
| access | 서명 JWT | 매 요청 DB 조회 없이 빠른 검증 | 즉시 무효화가 어려워 짧은 수명 |
| refresh | DB opaque token | 회전·기기별 폐기·감사 | DB 접근 필요 |

관리자가 계정을 비활성화하거나 사용자가 전 기기 로그아웃하면 refresh를 모두 폐기한다. 이미 발급된 access는 짧은 만료 뒤 재발급되지 않는다. 즉시성이 더 필요한 환경이라면 token version/denylist가 추가 선택지지만 무상태 장점을 일부 포기한다.

## 로그인 보안 흐름

```text
identifier + password/social callback
  → 계정 상태 검사
  → credential 검증
  → 실패 횟수·위험 정책
  → MFA 필요 여부
  → access + rotated refresh
  → 로그인·보안 감사 기록
```

실패 카운트와 감사 이력은 비즈니스 예외 때문에 rollback되면 안 된다. 차단·휴면·삭제 계정은 credential이 맞아도 토큰을 받지 못한다.

## MFA를 역할과 분리한 이유

`ADMIN`/`SUPER_ADMIN` 역할은 무엇을 할 수 있는지에 대한 인가이고, MFA는 로그인 주체를 얼마나 강하게 확인했는지에 대한 인증 강도다. 슈퍼관리자라는 이유만으로 MFA 없이 관리자 API를 허용해서는 안 된다.

지원 경로는 다음을 구분한다.

- TOTP 등록·검증
- 일회용 backup code
- 등록 기기의 push approval challenge
- 정책에 따른 관리자 MFA 강제

backup code는 재사용할 수 없고, push challenge는 만료·승인·거절 terminal 상태를 가진다.

## 소셜 로그인과 계정 연결

로그인과 기존 계정에 공급자를 연결하는 동작은 callback 이후 목적이 다르다.

- 로그인: 계정을 찾거나 정책에 따라 신규 연결 후 인증 세션 생성
- 계정 연결: 이미 로그인한 사용자 소유권 확인 후 `user_social` 추가
- 연결 해제: 최소 한 개의 로그인 수단을 남기는 정책 확인
- 모바일 복귀: canonical HTTPS verified App Link만 인증 결과로 수용

공급자별 client 설정과 반환 주소는 운영 콘솔에 별도로 등록해야 한다. 코드에 provider adapter가 있다는 사실과 실 자격증명으로 live 검증됐다는 사실은 다르다.

## 프로필 버전과 동시성

```text
프로필 저장
  → user_profile upsert + version_no 증가
  → user_profile_version append

프로필 AI
  → 현재 객체 읽기
  → 같은 객체를 AI_ANALYSIS version으로 고정
  → provider 호출 + 서버 점수 확정
  → profile_ai_analysis 최신본에 profile_version_id 저장
```

AI 호출 직전에 DB를 다시 읽어 snapshot을 만들지 않고, 실제 모델 입력 객체를 복제한다. 평가 도중 다른 저장이 들어와도 provenance가 섞이지 않는다.

## AI provider와 결정권

사용자는 지원되는 모델 tier를 선택할 수 있고 AUTO는 자체 모델을 포함한 폴백을 사용한다.

```text
자체 프로필 모델(설정 시)
  → Claude(설정 시)
  → OpenAI(설정 시)
  → RuleBasedProfileAiService
```

모델은 요약·강점·gap·항목별 근거를 생성한다. 최종 완성도는 `ProfileScoreCalculator`가 직무군별 6축 가중치로 다시 계산한다. 그래서 provider가 달라도 점수 의미를 서버가 통제한다.

Qwen3 4B Profile LoRA v4의 학습·비교 기록은 확인되지만 기본 runtime 활성과 공개 clone 재현 범위는 별도다. “모든 요청이 자체 모델로 처리된다”고 말하지 않는다.

## 동의 게이트

프로필 원문을 AI provider에 보내는 기능은 `AI_DATA`와 이력서 분석 동의를 확인한다. 동의는 덮어쓰지 않고 새 이력으로 추가하여 동의·철회 시점을 재구성한다. 조회만 하는 저장 결과 화면과 새 외부 전송을 일으키는 분석 실행의 동의 요구가 다를 수 있다.

## 관리자 경계

관리자 화면은 역할만 보지 않고 exact CRUD permission을 사용한다. `USER_READ`가 없으면 회원·프로필 탭 자체가 보이지 않고, `USER_UPDATE`/`USER_DELETE`가 없으면 상태 변경·삭제 동작이 숨겨지고 API도 거부된다.

익명·일반 회원·권한 조회 실패는 `/admin/**`에서 fail-closed다. 상세는 [관리자 인증·세부 권한](/backend/admin-auth-permissions)을 본다.

## 구현 상태를 정확히 말하기

| 항목 | 상태 |
| --- | --- |
| 이메일/아이디 로그인·JWT/refresh 회전 | 구현 |
| Google/Kakao/Naver adapter와 계정 연결·해제 | 구현, live는 공급자 설정 필요 |
| TOTP·backup code·push approval | 구현 |
| 프로필 현재 행·불변 버전·사용자/관리자 조회 | 구현 |
| 포트폴리오 파일·문서 import·비동기 구조화 | 구현 |
| 프로필 AI 3개 엔드포인트·모델 선택·영속 | 구현 |
| 자소서/경력 키워드의 독립 엔드포인트 | 통합 응답 필드로 제공, 독립 API는 없음 |
| 프로필 AI 모든 실행 결과 append-only 시계열 | 기능별 최신 upsert만 제공 |
| 실 SMS 발송 | 공급자 발급·운영 설정과 분리 |

## 자주 받는 질문

:::details Q1. 왜 상태 검사를 비밀번호보다 먼저 하나요?
차단·휴면·삭제 계정은 credential이 맞아도 로그인할 수 없어야 한다. 토큰 발급 전 상태를 막아 비활성 계정에 새 세션이 생길 창을 없앤다. 단, 응답 문구와 timing이 계정 존재 여부를 과도하게 노출하지 않는지도 함께 본다.
:::

:::details Q2. 프로필 버전과 C source snapshot은 중복 아닌가요?
A 버전은 사용자 프로필 vN이라는 공통 입력 정본이고, C snapshot은 프로필·공고·규칙 결과를 조합한 특정 적합도 실행의 근거다. 서로 다른 감사 질문에 답한다.
:::

:::details Q3. AI 추출 스킬을 왜 프로필에 자동 저장하지 않나요?
AI 결과는 제안이다. 최신 분석본에는 저장하지만 사용자 원본을 자동 덮어쓰지 않고, 사용자가 확인해 저장한 값만 다른 영역의 확정 입력으로 쓴다.
:::

:::details Q4. OAuth 구현됐는데 왜 live 로그인은 별도 확인인가요?
코드 외에 공급자 console의 client id/secret, 허용 origin, 정확한 HTTPS 반환 주소가 모두 맞아야 한다. 공개 저장소에는 그 비밀값을 넣지 않으므로 배포 환경별 검증 항목이다.
:::

:::details Q5. 권한 조회 API가 장애면 관리자 화면을 열어 주나요?
아니다. ADMIN의 exact permission을 확인하지 못하면 403으로 닫는다. 가용성 장애를 권한 허용으로 바꾸지 않는 fail-closed 정책이다.
:::

<QuizBox question="프로필 AI 결과의 재현성을 가장 정확히 설명한 것은?" :choices="['updated_at만 보고 추정한다', '실제 입력 객체를 user_profile_version으로 고정하고 profile_ai_analysis가 그 ID를 가리킨다', '브라우저 캐시가 입력을 보존한다', 'LLM이 과거 값을 기억한다']" :answer="1" explanation="평가 입력과 저장 provenance를 같은 객체로 고정해 동시 수정이 있어도 어떤 프로필 버전을 분석했는지 대조할 수 있다." />

<QuizBox question="관리자 역할과 MFA 관계로 옳은 것은?" :choices="['SUPER_ADMIN이면 MFA가 필요 없다', '역할은 인가 범위, MFA는 인증 강도라 별도 정책으로 강제한다', 'MFA가 있으면 exact permission은 필요 없다', '일반 회원만 MFA를 쓴다']" :answer="1" explanation="관리자 역할과 2차 인증은 서로 다른 보안 층이며 둘 다 통과해야 보호된 관리 기능을 사용할 수 있다." />

## 근거 경로

- `backend/src/main/java/com/careertuner/auth/`
- `backend/src/main/java/com/careertuner/auth/service/MfaService.java`
- `backend/src/main/java/com/careertuner/profile/`
- `backend/src/main/resources/mapper/profile/`
- `frontend/src/features/profile/`
- `frontend/src/admin/auth/`

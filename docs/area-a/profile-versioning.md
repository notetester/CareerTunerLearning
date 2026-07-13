# 프로필 불변 버전과 AI provenance

> 프로필의 현재 값은 `user_profile` 한 행에 유지하고, 저장·문서 가져오기·AI 평가 시점은 `user_profile_version` 불변 행으로 남긴다. AI 결과는 실제로 읽은 버전 ID를 함께 저장한다.

## 왜 두 테이블인가

사용자는 프로필을 계속 수정하지만 과거 분석 결과의 근거는 바뀌면 안 된다. 현재 값과 과거 입력을 한 테이블에서 모두 해결하려 하면 조회와 수정이 복잡해진다.

| 테이블 | 책임 |
| --- | --- |
| `user_profile` | 현재 프로필, 사용자별 1행, 저장 시 `version_no` 증가 |
| `user_profile_version` | 특정 버전의 불변 스냅샷, `(user_id, version_no)` unique |
| `profile_ai_analysis` | 기능별 최신 AI 결과와 `profile_version_id` provenance |

현재 프로필은 빠르게 읽고, 과거 입력은 append-only 버전으로 설명한다.

## 저장 흐름

```text
PUT /api/profile
  → user_profile upsert
  → 기존 행이면 version_no + 1
  → 같은 transaction에서 현재 값을 user_profile_version에 INSERT
  → 저장된 현재 프로필 반환
```

`upsert`가 사용자 프로필 행 잠금을 잡은 상태에서 version insert가 이어지므로 동시 저장도 서로 다른 `version_no`를 얻는다. `INSERT IGNORE`와 unique key는 같은 버전을 중복 생성하는 재시도를 방어한다.

버전의 `source`는 생성 이유를 구분한다.

- `MANUAL_SAVE`: 사용자가 폼 저장
- `DOCUMENT_IMPORT`: 파일 텍스트 가져오기
- `AI_ANALYSIS`: AI가 실제로 읽은 객체 고정
- `MIGRATION`: 기존 데이터 백필

## AI 평가 동시성 경계

AI 평가 중 다른 요청이 프로필을 저장할 수 있다. 평가 직전에 DB를 다시 읽어 snapshot을 만들면 “모델이 읽은 값”과 “저장된 provenance”가 엇갈릴 수 있다.

`ProfileServiceImpl`은 이미 평가에 넘길 `UserProfile` 객체를 `insertVersionSnapshot`으로 직접 복제한다. 이후 해당 `version_no`의 ID를 찾고 AI 성공 결과와 함께 저장한다.

```text
평가 입력 객체 ──────────────┐
  ├─ user_profile_version 저장 │ 같은 값
  └─ ProfileAiService 호출 ────┘
             ↓
profile_ai_analysis.profile_version_id
```

따라서 프로필이 동시에 바뀌어도 저장된 AI 결과가 어느 입력을 읽었는지 대조할 수 있다.

## 프로필 AI 결과 영속

`profile_ai_analysis`는 다음 3개 `feature_type`별 최신 1행을 upsert한다.

- `PROFILE_SUMMARY`
- `PROFILE_SKILL_EXTRACT`
- `PROFILE_COMPLETENESS`

요약, 강점, gap, 추천, 추출 기술, 기준별 점수, 완성도, 모델, 품질 경고와 입력 버전 ID가 저장된다. `GET /api/profile/ai-analysis`는 이 결과들을 조합해 새로고침 후에도 보여준다.

중요한 한계도 있다. `(user_id, feature_type)` unique upsert이므로 AI 실행 결과 전체 시계열을 append하는 테이블은 아니다. 프로필 버전 이력은 보존되지만 각 기능의 AI 결과는 최신 성공본을 갱신한다.

## 사용자·관리자 조회

| API | 범위 |
| --- | --- |
| `GET /api/profile/versions` | 본인 버전 목록 |
| `GET /api/profile/versions/{versionId}` | 본인 특정 버전 |
| `GET /api/admin/profiles/{userId}/versions` | 권한 있는 관리자 버전 조회 |
| `GET /api/profile/ai-analysis` | 본인 최신 저장 AI 분석 |

모든 버전 조회는 `user_id` 소유권과 `deleted_at IS NULL`을 함께 검사한다. 관리자 화면도 버전 번호·source·생성 시각을 목록으로 보여준다.

## C 소비자 스냅샷과의 관계

A 버전 테이블이 생겼다고 C의 결과 snapshot이 불필요한 것은 아니다.

- A 버전: 전체 프로필 입력의 공통 정본
- C `source_snapshot`: 해당 적합도 실행에 필요한 프로필·공고·점수 근거 묶음
- `profile_ai_analysis.profile_version_id`: A 분석이 사용한 정확한 프로필 버전

공통 입력 버전과 도메인 실행 snapshot은 서로 다른 감사 질문에 답한다. 전자는 “사용자 프로필 v7이 무엇이었나”, 후자는 “이 적합도 실행이 어떤 조합을 사용했나”를 설명한다.

## 개인정보 삭제

불변 스냅샷은 감사에 유용하지만 탈퇴 뒤 개인정보를 무기한 보존해서는 안 된다. 계정 삭제 경로는 현재 프로필, 과거 버전, AI 분석에서 원문·구조화 개인정보를 제거하고 `deleted_at`을 기록한다. 버전 번호와 삭제 사실 같은 최소 운영 흔적만 남겨 lifecycle을 설명한다.

## 구현 상태

| 항목 | 상태 |
| --- | --- |
| 저장 시 `version_no` 증가 | 구현 |
| 수동 저장·문서 import 버전 생성 | 구현 |
| AI 평가 입력 객체 snapshot | 구현 |
| 사용자 버전 목록·상세 | 구현 |
| 관리자 버전 목록 | 구현 |
| 프로필 AI 최신 결과 영속·조회 | 구현 |
| 임의 과거 버전으로 현재 프로필 복원 | 별도 복원 API 없음 |
| 모든 AI 실행 결과의 append-only 시계열 | 제공하지 않음, 기능별 최신 upsert |

## 면접에서의 짧은 답변

> “현재 프로필은 사용자별 한 행으로 두고 저장할 때 version_no를 올린 뒤 같은 transaction에서 불변 버전 행을 추가합니다. AI 평가 직전에는 모델에 넘길 객체 자체를 snapshot으로 저장해 동시 수정이 있어도 provenance가 섞이지 않게 했습니다. 성공 결과는 profile_ai_analysis에 입력 version ID와 함께 기능별 최신본으로 저장합니다. C의 source_snapshot은 공통 프로필 버전이 아니라 그 분석 실행 전체 입력을 묶는 별도 책임입니다.”

## 질문 대비

:::details Q1. `updated_at`만으로는 왜 부족한가요?
마지막 수정 시각만 알 수 있고 당시 필드 값을 복원할 수 없다. 불변 버전 행이 있어야 과거 분석 입력을 실제 값으로 대조할 수 있다.
:::

:::details Q2. AI 결과도 모든 버전을 쌓나요?
아니다. 프로필 입력 버전은 append하지만 `profile_ai_analysis`는 사용자·기능별 최신 성공본을 upsert한다. 전체 AI 실행 이력은 usage log와 도메인 결과 정책을 별도로 본다.
:::

:::details Q3. 왜 AI 평가 때 현재 DB를 다시 SELECT하지 않나요?
모델에 넘긴 객체와 다시 읽은 DB 값 사이에 동시 저장이 끼면 provenance가 달라질 수 있다. 실제 평가 객체를 그대로 snapshot으로 복제해 같은 입력임을 보장한다.
:::

<QuizBox question="프로필 AI 결과와 입력 버전의 연결로 옳은 것은?" :choices="['updated_at 문자열만 저장한다', 'profile_ai_analysis.profile_version_id가 AI가 실제 사용한 user_profile_version 행을 가리킨다', 'C의 fit_analysis만 프로필 버전을 안다', '프런트 localStorage가 버전을 보관한다']" :answer="1" explanation="AI 평가 직전에 실제 입력 객체를 user_profile_version으로 고정하고, 성공한 profile_ai_analysis 행에 그 ID를 저장한다." />

## 근거 경로

- `backend/src/main/resources/mapper/profile/ProfileMapper.xml`
- `backend/src/main/resources/mapper/profile/ProfileAiAnalysisMapper.xml`
- `backend/src/main/java/com/careertuner/profile/service/ProfileServiceImpl.java`
- `backend/src/main/java/com/careertuner/profile/controller/ProfileController.java`
- `backend/src/main/resources/db/patches/20260712_user_profile_version.sql`

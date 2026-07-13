# 프로필 데이터 모델 — users · user_profile · 스냅샷

> 영역 A는 "기반 신뢰 데이터의 소유자"다. `users`(내가 누구인가)와 `user_profile`(나를 어떻게 설명하는가)이 그 두 축이며, B·C·D·E는 이 데이터를 **읽기만** 한다. 이 페이지는 그 데이터 모델의 실제 스키마·관계·JSON 컬럼, 그리고 "스냅샷 버전 테이블이 왜 핵심 설계인데 실제로는 어떻게 단순화됐는지"를 정직하게 짚는다.

---

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 A의 데이터 모델은 **`users`를 루트로 하는 트리**다. 회원 1명마다 인증/감사/동의 관련 자식 행이 1:N으로 붙고, 스펙 원천인 `user_profile`만 **1:1**로 매달린다.

:::tip 이 페이지가 답하는 면접 질문
- "회원·프로필 테이블 구조를 설명해 보세요. 왜 그렇게 나눴나요?"
- "프로필의 학력·경력·스킬을 어떻게 저장했나요? 정규화 안 했나요?"
- "분석 재현성을 위한 프로필 버전 스냅샷이 있다고 들었는데, 실제로 어떻게 구현됐나요?"
- "A가 데이터 원천인데 다른 영역이 프로필을 수정 못 하게 어떻게 막나요?"
:::

핵심 단위는 공고가 아니라 **지원 건(Application Case)**이지만, 그 모든 분석의 입력은 결국 `user_profile` 한 행이다. 그래서 A의 데이터 모델은 "전 영역의 입력 계약서"라고 보면 된다.

---

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2-1. users 중심 트리, 프로필만 1:1

회원의 **현재 상태**(권한·플랜·잠금)는 `users` 한 행에 모으고, 변하는 이벤트(로그인·상태변경·동의·토큰)는 전부 별도 자식 테이블로 뺐다. 이유는 단순하다 — "지금 이 회원이 어떤 상태인가"는 한 행 조회로 빠르게 답해야 하고, "언제 무슨 일이 있었나"는 append-only 이력으로 남아야 한다. 두 요구를 한 테이블에 욱여넣으면 둘 다 망가진다.

프로필만 1:1인 이유는 사람당 취업 준비 프로필이 본질적으로 하나이기 때문이다. `user_profile.user_id`에 `UNIQUE` 제약을 걸어 1:1을 **DB 레벨에서** 강제한다.

### 2-2. JSON 컬럼 vs 정규화 — 의도적으로 JSON을 골랐다

학력·경력·프로젝트·스킬·자격증은 자식 테이블로 정규화할 수도 있었다. 그러나 A는 8종을 **JSON 컬럼**으로 묶었다.

| 선택 | 장점 | 비용 |
| --- | --- | --- |
| JSON 컬럼 (채택) | 프로필 1행 upsert로 끝 · 스키마 변경 없이 필드 자유 · LLM에 통째로 전달하기 쉬움 | DB 레벨 집계/검색 불리 · 직렬화 책임이 앱으로 옴 |
| 자식 테이블 정규화 | SQL 집계·조인 강력 | 프로필 1번 저장에 N개 테이블 트랜잭션 · 자유형 데이터에 취약 |

선택의 핵심 근거: 이 데이터의 **유일한 주 소비자가 LLM**이다. 스킬 배열·경력 객체를 SQL로 GROUP BY 할 일은 거의 없고, "프로필 전체를 프롬프트에 넣어 분석"하는 게 주 사용처다. 그래서 조인 비용을 없애는 JSON이 합리적이다.

### 2-3. 읽기 전용 경계 — A만 프로필을 쓴다

B(공고 분석)·C(적합도)·D(질문 생성)·E(첨삭)는 프로필을 **입력으로 읽기만** 한다. 원본 수정 책임은 A에게만 있다. 이 경계가 깨지면 "어느 영역이 내 경력을 바꿔놨지?" 같은 추적 불가능한 상태가 생긴다. 경계는 코드 소유권(다른 영역에 프로필 쓰기 매퍼가 없음)으로 지켜진다.

---

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

영속성은 **MyBatis만**(JPA 금지). `ProfileMapper` 인터페이스 + `resources/mapper/profile/ProfileMapper.xml`이 짝이다. 핵심 테이블은 `backend/src/main/resources/db/schema.sql`에 정의돼 있다.

### users 테이블 (회원의 현재 상태 대표)

```sql
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,          -- 로그인 식별자, UNIQUE
  password VARCHAR(255) NULL,           -- BCrypt 해시. 소셜 전용 계정은 NULL
  password_enabled TINYINT(1) NOT NULL, -- 소셜 전용 계정은 0
  status VARCHAR(20) NOT NULL,          -- ACTIVE/DORMANT/BLOCKED/DELETED (인덱스)
  failed_login_count INT NOT NULL,      -- 5회 초과 시 자동 잠금
  deleted_at DATETIME NULL,             -- soft delete
  ...
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_status (status)
);
```

가입 기본값: `user_type=JOB_SEEKER`, `role=USER`, `status=ACTIVE`, `plan=FREE`, `credit=0`. 인증·잠금 동작은 [JWT 인증과 토큰 회전](/area-a/auth-jwt)에서 깊게 다룬다.

### user_profile 테이블 (스펙 원천, 1:1)

```sql
CREATE TABLE user_profile (
  id BIGINT AUTO_INCREMENT,
  user_id BIGINT NOT NULL,              -- UNIQUE → 1:1 강제
  desired_job VARCHAR(255), desired_industry VARCHAR(255),
  education JSON, career JSON, projects JSON, skills JSON,   -- JSON 4종
  certificates JSON, languages JSON, portfolio_links JSON, preferences JSON, -- JSON 4종
  resume_text MEDIUMTEXT, self_intro MEDIUMTEXT,            -- 원문 2종
  created_at DATETIME, updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_profile_user (user_id)
);
```

JSON 8종 · 원문 2종 · 텍스트 2종으로 정확히 12개 입력 필드. 이 한 행이 AI 프로필 진단([AI 프로필 완성도 진단](/area-a/ai-profile-completeness))과 C 적합도 분석([영역 C](/area-c/))의 **공통 입력**이다.

### user_social (소셜 연동, 1:N)

`(provider, provider_user_id)`에 `UNIQUE`. provider는 `KAKAO/NAVER/GOOGLE`. 한 회원이 여러 소셜을 연결할 수 있되 provider별 1개. 자세한 흐름은 [소셜 OAuth 로그인](/area-a/oauth-social).

### user_consent (동의 이력, append-only 1:N)

`consent_type`(`TERMS/PRIVACY/AI_DATA/MARKETING`), `agreed`, `revoked_at`, `source`. **현재값을 덮어쓰지 않고** 등록/철회 이벤트를 누적한다. "현재 동의"는 같은 type 최신 1행이 `agreed=true AND revoked_at IS NULL`인지로 판정. 개인정보보호 감사 요건 때문이며 [동의 게이팅](/area-a/consent-gating)에서 깊게 다룬다.

---

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. ERD 관계 — users 루트 트리

```text
users (1)
 ├─(1:N)─ user_social          소셜 연동
 ├─(1:N)─ refresh_token        세션/토큰 (IP·UA 감사)
 ├─(1:N)─ user_login_history   로그인 감사 (user_id NULL 허용)
 ├─(1:N)─ user_status_history  상태변경 이력 (actor=관리자)
 ├─(1:N)─ email_verification   메일 토큰 (VERIFY/RESET_PW/DORMANT_RELEASE)
 ├─(1:N)─ user_consent         동의 이력 (append-only)
 ├─(1:N)─ ai_usage_log         AI 호출 추적 (스키마 소유=A)
 └─(1:1)─ user_profile         스펙 원천  ← 유일한 1:1
```

핵심은 화살표 끝의 카디널리티다. **`user_profile`만 1:1**, 나머지는 전부 1:N(=이력/세션은 여러 개 쌓인다).

### 4-2. 프로필 저장 = 단일 행 upsert

프로필 저장은 INSERT/UPDATE 분기 없이 **upsert 한 방**이다. `ProfileMapper.xml`의 실제 구조(축약):

```sql
INSERT INTO user_profile (user_id, education, career, skills, ...)
VALUES (#{userId}, #{education}, #{career}, #{skills}, ...)
ON DUPLICATE KEY UPDATE
  education = VALUES(education),
  career    = VALUES(career),
  ...,
  updated_at = NOW();
```

`user_id`의 `UNIQUE`가 충돌 키다. 첫 저장은 INSERT, 이후는 같은 현재 행을 UPDATE하면서 `version_no`를 1 올린다. 같은 transaction에서 현재 값을 `user_profile_version`에 복제하므로 **현재 1행과 불변 버전 이력**을 함께 유지한다.

### 4-3. JSON은 앱이 직렬화한다 (양면 호환 방어)

MyBatis는 JSON 컬럼을 그냥 `String`으로 다룬다. 그래서 직렬화/역직렬화 책임이 **서비스 계층**으로 온다. 관리자 읽기 모델 `AdminUserProfileSnapshot`도 모든 JSON 필드를 `String` 타입으로 들고 있는 게 그 증거다.

```java
// AdminUserProfileSnapshot — JSON 컬럼이 전부 String으로 평면화돼 내려온다
private String education;
private String skills;       // ["React","Spring"] 가 String 한 덩어리로
private String certificates; // ["정보처리기사","SQLD"]
private LocalDateTime updatedAt; // 현재 프로필 읽기 모델의 마지막 수정 시각
```

깨진 JSON이 들어와도 예외로 화면을 죽이지 않고 **원문 문자열 그대로** 돌려준다(예외 삼킴). 레거시·자유형 데이터에 대한 내성 전략이다. 단, 이 양면 호환 방어가 사용자 Profile 화면과 관리자 Profiles 화면에 **독립 중복 구현**돼 있는 건 알려진 부채다.

---

## 5. 현재 값·버전·분석 결과의 역할 분리

분석 재현성에는 두 종류의 snapshot이 필요하다.

- `user_profile_version`: 사용자가 저장한 전체 프로필 vN
- 도메인 결과 snapshot: C의 프로필+공고처럼 한 실행이 조합한 입력

A의 프로필 버전은 공통 입력 정본이고, C의 `fit_analysis.source_snapshot`과 `career_analysis_run.input_snapshot`은 특정 실행의 자기완결 근거다. 둘은 중복이 아니라 감사 질문이 다르다. 자세한 동시성·provenance는 [프로필 불변 버전](/area-a/profile-versioning)에서 다룬다.

### 구현 상태 요약표

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| `users` / `user_profile`(1:1) | 됨 | schema.sql, `uk_user_profile_user` |
| 프로필 현재 행 upsert + `version_no` 증가 | 됨 | `ProfileMapper.xml` ON DUPLICATE KEY |
| JSON 8종 + 원문 2종 저장 | 됨 | `user_profile` 12개 필드 |
| 동의 append-only 이력 | 됨 | `user_consent` |
| 인증 감사 4종 분리 | 됨 | login/status/social/refresh 별도 테이블 |
| `user_profile_version` 불변 버전 | 됨 | 저장·문서 import·AI 평가 source 구분 |
| `profile_ai_analysis` 최신 결과 + 입력 version FK | 됨 | 기능별 upsert, 새로고침 조회와 C 입력 |
| 사용자·관리자 버전 이력 조회 | 됨 | `/profile/versions`, `/admin/profiles/{id}/versions` |
| 관리자 현재 프로필 읽기 모델 | 됨 | 현재 1행과 별도로 버전 목록 조회 |
| 가입 `user_type` 저장 | 부분 결함 | 프론트 UI는 받지만 register payload에 미전달 |

---

## 6. 면접 답변 3단계

1. **한 줄 정의:** "영역 A의 데이터 모델은 `users`를 루트로 한 트리입니다. 인증·감사·동의는 1:N 자식 테이블로 쌓고, 스펙 원천인 `user_profile`만 `user_id` UNIQUE로 1:1을 DB 레벨에서 강제합니다."
2. **설계 의도:** "학력·경력·스킬·자격증은 정규화 대신 JSON 8종으로 묶었습니다. 주 소비자가 LLM이라 SQL 집계보다 '프로필 1행을 통째로 프롬프트에 넣는' 사용이 핵심이고, 그래서 조인 비용을 없애는 JSON이 합리적이었습니다. 직렬화 책임은 앱으로 오고, 깨진 JSON은 예외 삼켜 내성을 둡니다."
3. **정직한 한계:** "프로필 입력 버전은 append하지만 `profile_ai_analysis`는 사용자·기능별 최신 성공본을 upsert합니다. 모든 AI 실행 결과를 시계열로 쌓는 구조는 아니며, C의 실행 snapshot과 AI usage log가 별도 provenance를 보완합니다."

---

## 7. 꼬리질문 + 모범답안

:::details Q1. 프로필을 왜 자식 테이블로 정규화하지 않고 JSON으로 넣었나요?
주 소비자가 LLM이기 때문입니다. 스킬 배열이나 경력 객체를 SQL로 GROUP BY 할 일은 거의 없고, "프로필 전체를 프롬프트에 통째로 전달"하는 게 주 사용처입니다. 정규화하면 프로필 1번 저장이 N개 테이블 트랜잭션이 되고 자유형 데이터에 취약해집니다. JSON은 단일 행 upsert로 끝나고 스키마 변경 없이 필드를 늘릴 수 있습니다. 대가는 DB 레벨 검색/집계가 약해지는 것인데, 이 도메인에선 그 비용이 거의 발생하지 않습니다.
:::

:::details Q2. JSON 컬럼인데 MyBatis가 어떻게 다루나요? 타입 핸들러를 썼나요?
복잡한 JSON 타입 핸들러 없이, MyBatis는 JSON 컬럼을 그냥 `String`으로 읽고 씁니다. 직렬화/역직렬화는 서비스 계층 책임입니다. `AdminUserProfileSnapshot`이 모든 JSON 필드를 `String`으로 들고 있는 게 그 증거입니다. 역파싱 시 깨진 JSON이면 예외를 삼키고 원문 문자열을 그대로 반환해 레거시·자유형 데이터에 내성을 둡니다.
:::

:::details Q3. 프로필 저장이 INSERT인지 UPDATE인지 코드가 어떻게 구분하나요?
호출 측이 구분하지 않습니다. `ProfileMapper`의 `upsert`가 `INSERT ... ON DUPLICATE KEY UPDATE` 한 문장입니다. 첫 저장이면 version 1, 이미 행이 있으면 같은 현재 행을 갱신하며 `version_no`를 올립니다. 이어서 그 현재 값을 불변 버전 행에 저장하므로 현재 프로필은 1개이고 이력은 여러 개입니다.
:::

:::details Q4. 그럼 분석 재현성은 어떻게 보장하나요? 프로필이 바뀌면 과거 분석이 깨지지 않나요?
A가 `user_profile_version`으로 저장 시점 전체 프로필을 보존하고, AI 분석은 `profile_version_id`로 실제 입력 버전을 가리킵니다. C도 실행에 참여한 프로필·공고 조합을 `source_snapshot`에 박제합니다. 원본이 바뀌어도 공통 입력 버전과 도메인 실행 snapshot 두 층으로 재현·해명할 수 있습니다.
:::

:::details Q5. 관리자 화면의 "프로필 스냅샷"은 버전 테이블 아닌가요?
현재 상세의 `AdminUserProfileSnapshot`은 여전히 `user_profile` 1행을 평면화한 읽기 모델입니다. 다만 관리자 프로필 페이지는 별도 API로 `user_profile_version` 목록도 함께 조회합니다. “현재 상세 객체”와 “버전 이력 목록”을 구분하면 됩니다.
:::

:::details Q6. A가 데이터 원천인데 B·C·D·E가 프로필을 못 고치게 어떻게 막나요?
코드 소유권으로 막습니다. 프로필 쓰기 매퍼(`ProfileMapper.upsert`)와 컨트롤러(`ProfileController` `/api/profile/**`)는 A에만 있고, 다른 영역에는 프로필 쓰기 경로가 없습니다. B·C·D·E는 프로필을 입력으로 SELECT만 합니다. "원본 수정 책임은 A에게만"이라는 경계가 매퍼 분리로 물리적으로 지켜지는 구조입니다.
:::

---

## 8. 직접 말해보기

아래 4개를 입으로 30초씩 설명할 수 있으면 이 페이지는 통과다.

1. `users` 트리에서 **1:1은 무엇이고 왜** 1:1인지 (UNIQUE 키까지)
2. JSON 8종을 정규화 대신 **왜 골랐는지**, 그 대가는 무엇인지
3. 현재 행 upsert와 불변 버전 insert를 왜 한 transaction에 묶는지
4. A의 공통 프로필 버전과 C의 실행 snapshot이 각각 답하는 감사 질문

---

## 퀴즈

<QuizBox question="user_profile 테이블이 users와 맺는 관계와 그 강제 방식으로 옳은 것은?" :choices="['1:N 관계이며 애플리케이션 코드로만 보장한다', '1:1 관계이며 user_id의 UNIQUE 제약으로 DB 레벨에서 강제한다', 'N:M 관계이며 매핑 테이블을 둔다', '1:1 관계이지만 별도 제약 없이 관례로만 유지한다']" :answer="1" explanation="user_profile.user_id에 UNIQUE 제약(uk_user_profile_user)을 걸어 회원당 프로필 1행을 DB 레벨에서 강제한다. 나머지 자식 테이블(소셜·동의·이력 등)은 1:N이다." />

<QuizBox question="user_profile_version에 대한 가장 정확한 설명은?" :choices="['현재 프로필을 대체하는 단일 행이다', '저장·문서 import·AI 평가 시점의 불변 프로필을 version_no와 source로 보존한다', 'C 영역만 쓰는 캐시다', '브라우저 localStorage 데이터다']" :answer="1" explanation="현재 값은 user_profile 1행에 두고, user_profile_version은 사용자별 버전 번호와 생성 source를 가진 불변 입력 이력으로 쌓는다." />

<QuizBox question="user_profile의 학력·경력·스킬·자격증을 JSON 컬럼으로 저장한 가장 핵심적인 설계 근거는?" :choices="['MySQL이 정규화를 지원하지 않아서', '주 소비자가 LLM이라 프로필 전체를 통째로 프롬프트에 전달하는 사용이 핵심이고 조인 비용을 없애기 위해', 'JSON이 SQL 집계·검색에 더 강력해서', 'JPA 사용을 강제하기 위해']" :answer="1" explanation="이 데이터의 주 소비자는 LLM이고, 프로필 1행을 통째로 프롬프트에 넣는 게 주 사용처다. SQL 집계 수요가 거의 없으므로 조인 비용을 없애는 JSON이 합리적이다. 대가로 DB 레벨 검색/집계는 약해지고 직렬화 책임이 앱으로 온다." />

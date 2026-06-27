# 프로필 스냅샷 · 버전 관리

> 분석 시점의 프로필을 "동결"해 C 적합도·D 면접의 재현성과 감사를 보장하려던 설계가, 실제 코드에서는 어떻게 단순화되어 있고 그 빈자리를 누가 메우고 있는지.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

**프로필 버전 관리란, "분석에 사용한 입력 프로필을 그 시점 그대로 보존해, 원본이 나중에 바뀌어도 과거 분석 결과를 재현·설명할 수 있게 만드는 것"이다.**

영역 A(회원·프로필·인증)는 모든 분석의 입력 원천인 `user_profile`을 소유한다. C(적합도), D(면접 질문)는 이 프로필을 읽어 분석한다. 그런데 사용자가 분석 후 프로필을 수정하면, "그때 그 분석은 어떤 입력으로 나온 결과인가?"라는 질문에 답할 수 없게 된다. 이 페이지는 다음 면접 질문에 답한다.

- "프로필이 바뀌면 과거 분석 결과는 어떻게 되나요? 재현성은 어떻게 보장하죠?"
- "버전 관리 테이블(`user_profile_version`)을 설계했다고 들었는데, 실제로 구현됐나요?"
- "관리자 화면의 '프로필 스냅샷'은 진짜 시점 스냅샷인가요, 아니면 현재 값인가요?"

:::warning 이 페이지의 핵심 정직성 포인트
계획 문서에는 분석 재현성을 위한 **`user_profile_version` 테이블**이 A 소유 테이블 목록에 들어 있다. 그러나 **실제 `schema.sql`에는 이 테이블이 존재하지 않는다.** 프로필은 단일 행을 덮어쓰는 upsert + `updated_at` 만 가진다. 이 페이지는 "왜 버전 테이블이 빠졌고, 그 재현성 책임을 실제로는 누가 어떻게 떠안고 있는가"를 정직하게 다룬다. "버전 관리가 구현됐다"고 말하면 사실 오류다.
:::

## 2. 왜 이렇게 설계하려 했나 (의도 · 트레이드오프)

### 풀려던 문제: "분석은 사진, 프로필은 동영상"

프로필은 계속 변한다(스킬 추가, 자기소개서 수정). 반면 분석 결과(C 적합도 점수, D 면접 질문)는 **특정 순간의 프로필을 찍은 사진**이다. 두 가지를 같은 행에 묶어두면 모순이 생긴다.

```text
[1월] 프로필: Java, Spring        → C 적합도 분석 = 72점 (Java 매칭 근거)
[3월] 프로필 수정: Java 삭제, Python 추가
[3월] 1월 분석 결과를 다시 봄 → "72점인데 Java가 어디서 나왔지?" → 근거 소실
```

이걸 막는 두 가지 길이 있다.

| 전략 | 방식 | 장점 | 단점 |
| --- | --- | --- | --- |
| (A) **A 소유 버전 테이블** | `user_profile_version`에 수정 때마다 스냅샷 행 추가, 분석은 `version_id` 참조 | 원천이 단일 진실. 모든 영역이 같은 버전을 공유 | A에 쓰기 부하·스토리지 누적, 모든 소비자가 버전 FK를 들고 다녀야 함 |
| (B) **소비자 측 입력 스냅샷** | 각 분석이 자기 결과 행에 "그때 쓴 입력"을 JSON으로 박제 | A는 단순(단일 행 upsert), 분석 결과가 자기완결적 | 같은 프로필이 여러 분석에 중복 저장, 영역마다 스냅샷 포맷 제각각 |

**실제 코드는 (B)를 택했고, (A)는 계획에만 남았다.** A의 프로필 테이블은 끝까지 단순한 단일 행으로 두고, 재현성 책임을 각 분석 소비자(특히 C)에게 위임한 것이다. 트레이드오프의 본질은 "원천에 복잡도를 둘 것인가, 소비자에 둘 것인가"이며, 팀은 **원천을 가볍게 유지**하는 쪽을 선택했다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

### 3-1. A 측: 버전 없는 단일 행 upsert

`user_profile` 테이블은 `user_id`에 `UNIQUE KEY`가 걸린 **1:1 단일 행**이다. 수정은 새 행 추가가 아니라 기존 행 덮어쓰기다.

```sql
-- ProfileMapper.xml : upsert (요점 축약)
INSERT INTO user_profile (user_id, desired_job, skills, resume_text, ...)
VALUES (#{userId}, ...)
ON DUPLICATE KEY UPDATE
    skills      = VALUES(skills),
    resume_text = VALUES(resume_text),
    ...
    updated_at  = NOW();   -- 이전 값은 보존되지 않고 사라진다
```

- 매퍼: `ProfileMapper.upsert(UserProfile)` (`backend/.../profile/mapper/ProfileMapper.java`)
- 핵심: `ON DUPLICATE KEY UPDATE` + `updated_at = NOW()`. **수정 이력 행이 쌓이지 않는다.** `updated_at`은 "마지막으로 바뀐 시각"일 뿐, "무엇이 어떻게 바뀌었는지"는 알 수 없다.

### 3-2. 관리자 "스냅샷"의 실체 — 시점 스냅샷이 아니라 현재 값 평면화

관리자 회원 상세 화면이 보여주는 "프로필 스냅샷"은 버전 테이블 조회가 아니다. `AdminUserProfileSnapshot`은 **현재 `user_profile` 1행을 평면 문자열로 펼친 읽기 모델**이다.

```java
// AdminUserProfileSnapshot.java (요점)
@Data
public class AdminUserProfileSnapshot {
    private Long id; private Long userId;
    private String desiredJob; private String skills; private String resumeText;
    // ... JSON 컬럼들을 모두 String 으로 평면화 ...
    private LocalDateTime updatedAt;   // version_id 도, snapshot_at 도 없다
}
```

`version`, `snapshotAt` 같은 필드가 **없다.** 즉 "스냅샷"이라는 이름과 달리, 관리자가 보는 건 그 회원의 **지금 프로필**이다. 어제 분석 시점의 프로필을 관리자 화면에서 되돌려 볼 방법은 A 영역에 존재하지 않는다.

### 3-3. 재현성을 실제로 떠안는 곳 — C 소비자 테이블의 입력 스냅샷

그렇다면 재현성은 어디로 갔나? **C 영역의 분석 결과 테이블이 자기 입력을 직접 박제한다.** 이것이 코드에 실재하는 (B) 전략이다.

```sql
-- fit_analysis (C 소유, schema.sql) — 적합도 분석 1건 = 1행
source_snapshot   JSON NULL,   -- C 분석에 사용한 A/B 입력 식별·시점·요약
score_basis       JSON NULL,   -- 설명 가능한 점수 산정 근거
prompt_version    VARCHAR(30), -- 어떤 프롬프트 버전으로 분석했는지
model             VARCHAR(80)  -- 어떤 모델로 분석했는지

-- career_analysis_run (C 소유) — 장기 경향/대시보드 실행 이력
input_snapshot    JSON NULL,
input_fingerprint VARCHAR(64) NULL,  -- C 캐시 키: 입력 동일하면 저장 결과 재사용
```

핵심 통찰: **재현성의 단위가 "프로필 버전"이 아니라 "분석 실행(run)"이다.** 분석할 때 쓴 입력 프로필을 `source_snapshot`/`input_snapshot`에 JSON으로 동봉하고, `input_fingerprint`(입력 해시)를 캐시 키로 써서 "같은 입력이면 재실행 없이 재사용"한다. 원본 프로필이 나중에 바뀌어도 이 분석 행의 입력 스냅샷은 그대로 남으므로, 그 시점 분석은 재현·설명할 수 있다.

:::tip 경계 메시지 (면접 포인트)
"A는 프로필 버전을 안 만든다. 대신 **각 분석 소비자가 자기 결과에 입력을 박제**한다. 재현성의 소유자가 A(원천)가 아니라 C(소비자)로 옮겨간 구조다." — 이 한 문장이 이 페이지의 정수다. 자세한 캐시·핑거프린트 동작은 [영역 C](/area-c/) 참고.
:::

## 4. 동작 원리 (흐름 · 표)

### 프로필이 수정될 때 무슨 일이 벌어지나

```text
사용자가 Profile 화면에서 스킬 수정
        │
        ▼
ProfileMapper.upsert ──► user_profile 단일 행 덮어쓰기 (이전 값 소멸, updated_at=NOW())
        │
        ├─ A 관점: 과거 프로필 흔적 없음. "마지막 수정 시각"만 남음
        │
        └─ 이미 끝난 분석들은? ──► 각자 자기 행에 박제한 source_snapshot 으로 과거 재현 가능
                                    (단, 그 분석을 "지금 프로필로 다시 돌리면" 다른 결과가 나옴)
```

### "버전"을 묻는 세 가지 질문, 세 가지 답

| 질문 | A 영역의 답 | 실제로 누가 답하나 |
| --- | --- | --- |
| "이 사용자의 현재 프로필은?" | `user_profile` 1행 (= `AdminUserProfileSnapshot`) | A |
| "이 분석은 어떤 입력으로 나왔나?" | A엔 없음 | C의 `fit_analysis.source_snapshot` / `career_analysis_run.input_snapshot` |
| "이 사용자의 3개월 전 프로필은?" | **아무도 못 답함** | (어디에도 저장 안 됨) |

세 번째 칸이 미구현의 정직한 결과다. **임의 과거 시점의 전체 프로필을 복원하는 기능은 시스템 어디에도 없다.** 재현 가능한 것은 "분석에 쓰인 입력의 요약 스냅샷"뿐이다.

### 프로필 AI 진단도 결과를 저장하지 않는다

A 자신의 프로필 AI(요약·역량추출·완성도진단)는 한술 더 뜬다. 진단 점수·기준 결과를 **DB에 저장조차 하지 않고** 응답으로만 내려준다. `ai_usage_log`에는 호출 사실(featureType·status·model·token)만 남고, 진단 결과 캐시 테이블이 없다. 즉 A 영역 내부에서도 "이 점수는 어떤 프로필로 나왔나"의 재현은 보장되지 않는다(매번 현재 프로필로 재계산). AI 동작 자체는 [AI 완성도 진단](/area-a/ai-profile-completeness) 참고.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 프로필 단일 행 upsert (`updated_at` 갱신) | **구현됨** | `ProfileMapper.xml` upsert |
| 관리자 "프로필 스냅샷"(현재 값 평면화) | **구현됨** | `AdminUserProfileSnapshot` (version 필드 없음) |
| C 분석의 입력 스냅샷 박제 | **구현됨(C 영역)** | `fit_analysis.source_snapshot`, `career_analysis_run.input_snapshot` |
| C 입력 핑거프린트 캐시 | **구현됨(C 영역)** | `career_analysis_run.input_fingerprint` |
| `user_profile_version` 테이블 | **★미구현 / 계획만** | `schema.sql`에 부재 |
| 프로필 수정 이력(diff) 조회 | **미구현** | 이력 행이 쌓이지 않음 |
| 임의 과거 시점 전체 프로필 복원 | **미구현** | 어떤 테이블에도 저장 안 됨 |
| A 프로필 AI 진단 결과 영속화 | **미구현(의도적)** | 결과 캐시 테이블 없음, 응답 only |

:::warning 면접에서 절대 하면 안 되는 말
"프로필 버전 관리를 구현해서 과거 프로필을 시점별로 복원할 수 있다"는 **사실이 아니다.** 정확히는 "버전 테이블은 계획에 있었지만 단일 행 upsert로 단순화됐고, 재현성은 C 소비자가 입력 스냅샷으로 부분적으로 떠안는다"가 맞다.
:::

## 6. 면접 답변 3단계

**1단계 (정의·결론 먼저):**
"A는 프로필 원천을 단일 행 upsert로 단순하게 유지하고, 별도 버전 테이블은 두지 않았습니다. 분석 재현성은 원천이 아니라 각 분석 소비자가 책임집니다."

**2단계 (왜·트레이드오프):**
"계획 단계엔 `user_profile_version`이 있었지만, 원천에 버전 부하를 주는 대신 분석 결과가 자기 입력을 박제하게 했습니다. C의 `fit_analysis.source_snapshot`, `career_analysis_run.input_snapshot`이 그 예입니다. 덕분에 A는 가볍게 유지하고, 재현 단위는 '프로필 버전'이 아니라 '분석 실행'이 됐죠. 캐시는 입력 핑거프린트로 같은 입력의 재실행을 막습니다."

**3단계 (한계 인정):**
"대신 임의 과거 시점의 전체 프로필을 복원하는 기능은 없고, 관리자가 보는 '스냅샷'도 실제로는 현재 값입니다. 진짜 시점 복원이 제품 요구가 되면 그때 `user_profile_version`을 도입하는 게 다음 단계입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 관리자 화면에 "프로필 스냅샷"이라는 이름이 있는데, 진짜 스냅샷이 아니라고요?
이름과 실체가 다릅니다. `AdminUserProfileSnapshot`은 `version`이나 `snapshotAt` 같은 시점 필드가 없고 `updatedAt` 하나만 있습니다. 현재 `user_profile` 1행을 JSON 컬럼까지 모두 `String`으로 평면화한 **읽기 모델**일 뿐, 시점 스냅샷 테이블 조회가 아닙니다. "스냅샷"은 어휘적 관성으로 남은 이름이라고 보는 게 정확합니다.
:::

:::details Q2. 그럼 재현성은 전혀 없나요?
부분적으로 있습니다. 단, A가 아니라 **소비자(C)** 측에 있습니다. C의 적합도 분석은 결과 행에 `source_snapshot`(쓴 입력 요약), `score_basis`(점수 근거), `prompt_version`, `model`을 함께 저장합니다. 그래서 "이 72점은 어떤 입력·어떤 프롬프트·어떤 모델로 나왔나"는 그 분석 행만으로 설명됩니다. 원본 프로필이 나중에 바뀌어도 이 스냅샷은 변하지 않습니다.
:::

:::details Q3. `input_fingerprint`는 왜 있나요? 재현성과 무슨 관계죠?
`career_analysis_run.input_fingerprint`는 입력을 해시한 캐시 키입니다. 매 조회마다 AI를 재실행하면 비용·지연이 큽니다. 입력이 동일(같은 핑거프린트)하면 저장된 결과를 재사용해 재실행을 막습니다. 재현성과의 연결: "같은 입력 → 같은 결과"를 보장하는 결정론적 캐시이고, `input_snapshot`은 그 입력의 사람이 읽을 수 있는 박제본입니다. 두 컬럼이 한 쌍으로 '입력→결과'의 추적·재사용을 만듭니다.
:::

:::details Q4. 단일 행 upsert의 가장 큰 위험은 뭔가요?
**무손실 이력의 부재**입니다. `ON DUPLICATE KEY UPDATE`로 덮어쓰는 순간 이전 값은 영구 소멸합니다. 그래서 "사용자가 언제 어떤 필드를 바꿨는가"를 추적할 수 없고, 잘못된 수정의 롤백이나 변경 감사가 불가능합니다. 인증 쪽이 `user_status_history`로 상태 변경을 append-only로 남기는 것과 대조적입니다 — 프로필은 그 패턴을 따르지 않았습니다.
:::

:::details Q5. 굳이 버전 테이블을 안 만든 게 잘한 선택인가요?
MVP 관점에선 합리적입니다. 버전 테이블은 (1) 모든 소비자가 `version_id`를 들고 다녀야 하고, (2) 스토리지가 무한 누적되며, (3) "어느 버전을 현재로 볼지" 정책이 필요합니다. 현재 제품에서 "임의 과거 프로필 복원"은 사용자 요구가 약하고, 정작 필요한 "분석 재현"은 소비자 스냅샷으로 충분히 커버됩니다. 다만 이건 **의식적 단순화**여야지, 계획을 구현으로 착각하면 안 됩니다.
:::

:::details Q6. 만약 진짜 `user_profile_version`을 지금 도입한다면 어떻게 설계하겠어요?
프로필 수정 트랜잭션에서 (1) `user_profile` 본 행을 upsert하기 직전, 기존 값을 `user_profile_version`에 append (immutable, `version_no`/`snapshot_at` 포함), (2) C·D 분석 시 참조한 `version_no`를 분석 결과 행에 FK로 기록. 이렇게 하면 재현 단위가 '실행'에서 '버전'으로 통일됩니다. 비용은 스토리지와 모든 소비자의 FK 추가이므로, 도입 전 "임의 시점 복원" 요구가 실제로 있는지부터 확인하는 게 순서입니다.
:::

## 8. 직접 말해보기

아래 질문에 입으로 30초씩 답해 보라. 막히면 해당 섹션으로 돌아간다.

1. "프로필 버전 관리, 구현됐어요?"에 **한 문장으로** 정직하게 답해 보라. (힌트: "계획엔 있었지만…")
2. 사용자가 프로필을 수정했을 때 `user_profile` 행에 일어나는 일을 SQL 키워드 하나(`ON DUPLICATE KEY UPDATE`)를 써서 설명해 보라.
3. "관리자가 보는 프로필 스냅샷"이 왜 진짜 스냅샷이 아닌지, `AdminUserProfileSnapshot`에 **없는 필드** 두 개를 들어 설명해 보라.
4. 재현성이 A가 아니라 C에 있다는 말을, `source_snapshot`과 `input_fingerprint` 두 컬럼으로 풀어 보라.
5. 단일 행 upsert가 `user_status_history`의 append-only 패턴과 어떻게 다른지 대조해 보라.

## 퀴즈

<QuizBox question="실제 schema.sql 기준으로, 프로필 버전 관리에 대한 설명으로 옳은 것은?" :choices="['user_profile_version 테이블에 수정마다 스냅샷이 쌓인다', 'user_profile은 단일 행 upsert이고 user_profile_version 테이블은 존재하지 않는다', '프로필 수정 시 이전 행이 archived 플래그로 보존된다', '버전은 ai_usage_log에 저장된다']" :answer="1" explanation="schema.sql에 user_profile_version은 없다. user_profile은 user_id UNIQUE 단일 행이고 ON DUPLICATE KEY UPDATE로 덮어쓴다. 버전 테이블은 계획 문서에만 있다." />

<QuizBox question="분석 재현성(그 시점 입력으로 결과 설명)을 실제로 가능하게 하는 코드 근거는?" :choices="['user_profile.updated_at 컬럼', '관리자의 AdminUserProfileSnapshot', 'C 소유 fit_analysis.source_snapshot / career_analysis_run.input_snapshot', 'ProfileAiResult를 DB에 캐시하는 테이블']" :answer="2" explanation="재현성은 A가 아니라 C 소비자 테이블이 떠안는다. 분석 결과 행이 그때 쓴 입력을 source_snapshot/input_snapshot에 박제한다. A의 updated_at은 마지막 수정 시각일 뿐이고, 프로필 AI 결과 캐시 테이블은 없다." />

<QuizBox question="관리자 화면의 AdminUserProfileSnapshot에 대해 옳은 것은?" :choices="['version_id와 snapshotAt을 가진 시점 스냅샷이다', '현재 user_profile 1행을 평면화한 읽기 모델이며 version 필드가 없다', '과거 모든 프로필 수정 이력을 리스트로 보여준다', 'C의 fit_analysis를 조인해 만든다']" :answer="1" explanation="AdminUserProfileSnapshot에는 version, snapshotAt 필드가 없고 updatedAt만 있다. 이름과 달리 '현재 프로필'을 펼친 읽기 모델이라, 과거 시점 복원은 불가능하다." />

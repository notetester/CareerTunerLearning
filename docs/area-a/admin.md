# A 관리자 화면 & 운영

> 영역 A의 관리자 콘솔은 "**거의 전부 읽기 전용 + 단 하나의 위험한 쓰기(회원 상태 변경)**"라는 비대칭 구조다. 회원 검색·상세는 조회만, 동의 이력은 감사용 조회만, 프로필 AI 프롬프트는 운영자가 정책을 눈으로 확인하는 읽기 전용 카탈로그다. 유일한 쓰기인 상태 변경에만 권한·이력·강제 로그아웃이 집중된다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 A의 관리자 기능은 세 화면으로 구성된다.

| 화면 | 백엔드 엔드포인트 베이스 | 성격 |
| --- | --- | --- |
| 회원 관리 (admin/users) | `/api/admin/users/**` | 조회 4개 + **상태 변경 쓰기 1개** |
| 동의 이력 (admin/consents) | `/api/admin/consents` | 조회 1개 (감사 전용) |
| 프로필 AI 프롬프트 (prompts/profile) | `/api/admin/prompts/profile` | 조회 1개 (읽기 전용 운영 콘솔) |

이 페이지가 답하는 면접 질문:

- "관리자 화면은 어떻게 구현했고, 왜 대부분 읽기 전용으로 두었나?"
- "관리자가 회원을 차단하면 내부적으로 무슨 일이 일어나나?" (단순 UPDATE 하나가 아니다)
- "관리자용 매퍼를 따로 만들었나, 아니면 사용자 도메인 서비스를 재사용했나?"
- "프롬프트를 DB에 두지 않고 코드 상수로 둔 운영 콘솔을 어떻게 보여주나?"

:::tip 핵심 한 문장
"A 관리자 콘솔의 설계 철학은 **최소 쓰기 표면(minimal write surface)**이다. 운영자가 데이터를 임의로 바꿀 수 있는 지점을 회원 상태 변경 하나로 좁히고, 그 한 지점에 권한 검사·감사 이력·세션 폐기를 모두 몰아넣었다."
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 쓰기 표면을 의도적으로 좁혔다

A의 데이터는 다른 모든 영역(B 공고분석, C 적합도, D 면접, E 첨삭)이 참조하는 **기반 신뢰 데이터**다. 관리자가 회원 프로필이나 동의 이력을 임의로 편집할 수 있으면, 그 변경이 하위 분석 결과의 무결성을 깨뜨린다. 그래서 관리자에게 준 쓰기 권한은 단 하나 — **회원 계정 상태 변경**뿐이다.

- 프로필: 관리자 상세에서 **읽기만**. 수정 책임은 본인(사용자 Profile 화면)에게만 있다.
- 동의 이력: append-only 이벤트 테이블이라 **수정·삭제 자체가 개념상 금지**. 관리자는 "언제 누가 동의/철회했는가"를 조회만 한다(개인정보 감사 요건).
- 프롬프트: 운영 정책이라 **읽기 전용 카탈로그**. 관리자 화면에서 프롬프트를 고치면 train/serve 정합과 점수 재현성이 깨진다.

트레이드오프: 운영 편의성(관리자가 즉석에서 데이터를 고치는 기능)을 포기하는 대신, **데이터 무결성과 감사 추적성**을 얻었다. 잘못된 프로필은 사용자가 직접 고치게 하고, 관리자는 "본다"에 집중한다.

### 2-2. 상세는 한 화면에 A 영역 전체를 집약한다

회원 상세 한 번 호출로 8종 데이터(`AdminUserDetail`)를 한꺼번에 내려준다. 이유: 회원 1명을 운영자가 판단할 때 필요한 컨텍스트(로그인 보안 이력 / 인증 이력 / 동의 / 세션 / AI 사용 / 프로필 상태)가 모두 흩어져 있으면 N번 호출과 화면 전환이 생긴다. 한 번에 모아 **"이 사람은 누구이고 어떤 보안 이벤트를 겪었나"를 단일 화면에서 판단**하게 했다.

### 2-3. 관리자 전용 매퍼를 최소화하고 사용자 서비스를 재사용했다

- 동의 관리자 조회: 별도 매퍼 없이 `ConsentServiceImpl.adminConsents`를 호출(사용자 동의 도메인 재사용 + `requireAdmin` 분기만 추가).
- 프롬프트: A 도메인의 `ProfilePromptCatalog.view()`를 그대로 노출.
- 회원 관리만 `AdminUserMapper`라는 전용 매퍼가 있다(여러 테이블을 join/aggregate해야 해서).

이유: 관리자 화면은 사용자 도메인의 "관리자 시점 뷰"일 뿐, 별도 비즈니스 로직이 아니다. 로직을 두 벌로 만들면 동의 판정 같은 규칙(`agreed && revoked_at IS NULL`)이 갈라질 위험이 있다. **단일 진실 원천(single source of truth)**을 위해 서비스를 공유했다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3-1. 권한 검사 — 수동 이중 방어

A 관리자 API는 `@PreAuthorize`를 쓰지 않는다. 두 겹으로 막는다.

1. **URL 레벨**: `SecurityConfig`에서 `/api/admin/**`를 `hasAnyRole("ADMIN","SUPER_ADMIN")`로 차단.
2. **서비스 진입부**: 각 서비스 메서드 첫 줄에서 `AdminAccess.requireAdmin(authUser)`를 수동 호출.

```java
// AdminAccess — 영역 A·전체 관리자 공통 권한 유틸
public static void requireAdmin(AuthUser authUser) {
    if (authUser == null || !isAdmin(authUser))   // ADMIN 또는 SUPER_ADMIN
        throw new BusinessException(ErrorCode.FORBIDDEN, "관리자 권한이 필요합니다.");
}
public static void requireSuperAdmin(AuthUser authUser) { ... } // SUPER_ADMIN 전용
```

A의 회원 상태 변경은 `requireAdmin`(ADMIN 이상)이면 충분하다. `requireSuperAdmin`(SUPER_ADMIN 전용)은 더 넓은 운영 권한이 필요한 기능에서 쓰는 별도 등급이다.

### 3-2. 회원 관리 컨트롤러·서비스·DTO

- 컨트롤러: `AdminUserController` (`/api/admin/users`)
- 서비스: `AdminUserService`
- 매퍼: `AdminUserMapper`(+ 세션 폐기에 `AuthMapper`)
- 상세 DTO: `AdminUserDetail`

`AdminUserController`의 엔드포인트 4개:

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | `/api/admin/users` | 목록(keyword/status/role/limit, 기본 50, 최대 200) |
| GET | `/api/admin/users/{id}` | 상세 8종 집약 |
| GET | `/api/admin/users/{id}/login-history` | 로그인 이력 더 보기(기본 100) |
| PATCH | `/api/admin/users/{id}/status` | **상태 변경 — 유일한 쓰기** |

`AdminUserDetail`이 한 번에 묶는 8종:

```java
record AdminUserDetail(
    AdminUserRow user,                         // 계정 현재 상태(users)
    List<AdminUserLoginHistoryRow> loginHistory,    // user_login_history
    List<AdminUserStatusHistoryRow> statusHistory,  // user_status_history
    List<AdminUserConsentRow> consents,             // user_consent
    List<AdminUserEmailVerificationRow> emailVerifications, // email_verification
    List<AdminUserRefreshTokenRow> refreshTokens,   // refresh_token(세션 감사)
    List<AdminUserAiUsageRow> aiUsage,              // ai_usage_log
    AdminUserProfileSnapshot profile) {}            // user_profile 1행 평면화
```

:::warning "프로필 스냅샷"은 버전 테이블이 아니다
`AdminUserProfileSnapshot`이라는 이름 때문에 버전 이력처럼 들리지만, 실제로는 **현재 `user_profile` 1행을 평면화한 읽기 모델**이다. `user_profile_version`(분석 재현성용 스냅샷) 테이블은 schema.sql에 존재하지 않는다. 프로필은 단일 행 upsert + `updated_at`만 있다. "버전 히스토리가 구현됐다"고 말하면 사실 오류다. 자세히는 [프로필 스냅샷·버전](/area-a/profile-versioning) 참고.
:::

### 3-3. 동의 관리자 조회 — 사용자 서비스 위임

`AdminConsentController`(`/api/admin/consents`)는 자체 서비스가 없다. `ConsentService`를 주입받아 `adminConsents(...)`를 호출한다.

```java
// AdminConsentController — GET 하나뿐
public ApiResponse<List<ConsentView>> consents(
        AuthUser authUser, String keyword, String consentType,
        String status, String source, String from, String to, int limit) {
    return ApiResponse.ok(service.adminConsents(authUser, keyword, consentType,
            status, source, from, to, limit));  // 사용자 동의 도메인 재사용
}
```

`ConsentServiceImpl.adminConsents`는 `requireAdmin` 후 `mapper.findAdminConsents(...)`로 빈 필터를 null로 정규화하고 limit을 **1~200으로 클램프**한다. 반환 타입 `ConsentView`도 사용자 동의 조회와 같은 DTO를 공유한다.

### 3-4. 프로필 AI 프롬프트 콘솔 — 코드 상수 노출

`AdminPromptController`(`/api/admin/prompts`)는 영역별 프롬프트를 모아 노출하며, A에 해당하는 것은 `GET /profile`이다.

```java
@GetMapping("/profile")
public ApiResponse<AdminPromptView> profile(AuthUser authUser) {
    return ApiResponse.ok(service.profile(authUser)); // ProfilePromptCatalog.view()
}
```

`AdminPromptService.profile`은 `requireAdmin` 후 **`ProfilePromptCatalog.view()`**(A 도메인 상수)를 그대로 반환한다. 즉 프롬프트는 DB가 아니라 코드 상수다. 운영 콘솔은 그 상수를 **읽기 전용으로 비춘다**.

`AdminPromptView`가 담는 것:

| 필드 | 값(프로필) |
| --- | --- |
| `feature` | `"profile"` |
| `version` | `"a-profile-v2"` |
| `systemPrompt` | 직무 편향 금지·"점수는 서버가 재계산" 등 SYSTEM_PROMPT 원문 |
| `schemaSummary` | `{ summary, extractedSkills[], strengths[], gaps[], recommendations[], criterionScores[...] }` |
| `evaluationCriteria` | 6평가축(`policy.adminCriteria()`) |
| `weightProfiles` | **8직무군 × 6축 가중치 매트릭스**(`policy.adminWeightProfiles()`) |

핵심: 운영자는 이 콘솔 하나로 "지금 프로필 AI가 어떤 프롬프트·어떤 직무군 가중치로 동작하는가"를 코드 배포 없이 확인한다. 가중치 매트릭스의 의미는 [프로필 완성도 진단](/area-a/ai-profile-completeness)에서 다룬다.

## 4. 동작 원리 — 상태 변경의 진짜 흐름

면접에서 가장 자주 파고드는 지점이다. "관리자가 차단 버튼을 누르면?"에 대한 답은 단순 `UPDATE users SET status=...`가 아니다. `AdminUserService.updateStatus` 한 트랜잭션 안에서 **5단계**가 일어난다.

```text
PATCH /api/admin/users/{id}/status
   │
   ├─ 1. requireAdmin(authUser)            권한 검사(ADMIN 이상)
   ├─ 2. findExisting(id)                  대상 존재 확인(없으면 NOT_FOUND)
   ├─ 3. normalize(status)                 화이트리스트 검증(ACTIVE/DORMANT/BLOCKED/DELETED)
   │      └ BLOCKED일 때만 blockedUntil 유지, 그 외 null
   ├─ 4. mapper.updateStatus(...)          users 상태 + 변경자(actor) 기록
   ├─ 5. mapper.insertStatusHistory(...)   user_status_history에 before→after 이력
   ├─ 6. actionLogService.record(...)      관리자 액션 로그(감사) 적재
   └─ 7. if (!"ACTIVE") authMapper.revokeAllForUser(id)   ★전 세션 강제 폐기
```

```java
// AdminUserService.updateStatus 요지
String nextStatus = normalize(request.status(), STATUSES, true);
LocalDateTime blockedUntil = "BLOCKED".equals(nextStatus) ? request.blockedUntil() : null;
int updated = mapper.updateStatus(id, nextStatus, reason, blockedUntil, authUser.id());
if (updated == 0) throw new BusinessException(ErrorCode.NOT_FOUND, ...);
mapper.insertStatusHistory(id, authUser.id(), existing.getStatus(), nextStatus, reason, memo, blockedUntil);
actionLogService.record(authUser, id, "USER_STATUS_UPDATED", "USER", beforeJson, afterJson, reason);
if (!"ACTIVE".equals(nextStatus)) authMapper.revokeAllForUser(id);   // 강제 로그아웃
```

### 4-1. 왜 강제 로그아웃(`revokeAllForUser`)이 핵심인가

access JWT는 **무상태**라 서버가 즉시 무효화할 수 없다(짧은 수명으로 자연 만료될 뿐). 그래서 차단/휴면/삭제로 바꾸는 순간 **refresh_token을 전부 폐기**한다. 그러면 access가 만료될 때 갱신이 막혀 사실상 강제 로그아웃이 된다. "무상태 토큰을 어떻게 즉시 끊나?"라는 꼬리질문의 정답이 바로 이 한 줄이다. (토큰 구조는 [JWT 인증 흐름](/area-a/auth-jwt) 참고.)

### 4-2. 변경자(actor)와 사유를 반드시 남긴다

`insertStatusHistory`에 `authUser.id()`(변경한 관리자), `previousStatus`, `newStatus`, `reason`, `memo`가 들어가고, 추가로 `actionLogService.record`가 before/after JSON을 별도 감사 로그에 남긴다. **"누가, 언제, 무엇을, 왜 바꿨는가"를 두 군데에 이중 기록**한다. 운영 분쟁·개인정보 감사에 대비한 설계다.

### 4-3. 프론트가 강제하는 입력 규칙

`AdminUsersPage.tsx`는 서버에 보내기 전 클라이언트에서 한 번 더 검증한다.

- 상태 변경 사유(`reason`) 미입력 → 차단
- 상태가 그대로면서 메모도 없으면 → "변경 없음" 차단
- **BLOCKED인데 차단 만료 시각(`blockedUntil`) 미입력 → 차단**(서버도 BLOCKED일 때만 `blockedUntil`을 유지)
- 확정 다이얼로그에서 "ACTIVE가 아닌 상태는 로그인/서비스 사용에 영향" 경고를 띄움

UI는 마스터-디테일 레이아웃이다: 좌측 검색/필터 + 회원 카드 목록(성공/실패/연속실패 로그인 카운트 노출), 우측 상세(계정 정보 12필드 + 상태 변경 폼 + 8종 이력 카드).

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

| 항목 | 상태 |
| --- | --- |
| 회원 목록/상세/로그인이력 조회 | 구현됨 |
| 회원 상태 변경(+이력+감사로그+세션폐기) | 구현됨 |
| 동의 이력 관리자 조회(필터/기간) | 구현됨 |
| 프로필 AI 프롬프트 읽기 전용 콘솔 | 구현됨 |
| 회원 상세의 프로필 표시 | 구현됨(현재 1행 평면화 = `AdminUserProfileSnapshot`) |
| 관리자의 프로필 **수정** | 미구현(설계상 읽기 전용 — 본인만 수정) |
| 관리자의 동의 **수정/철회 대행** | 미구현(append-only라 개념상 미제공) |
| 관리자의 프롬프트 **편집** | 미구현(코드 상수라 배포로만 변경) |
| `user_profile_version` 기반 스냅샷 비교 | 미구현(버전 테이블 자체가 없음) |

:::details 자주 헷갈리는 포인트 — "관리자 프로필 화면은 따로 있지 않나?"
프론트 `admin/features/profiles`에는 별도 프로필 관리 페이지가 존재한다(마스터-디테일 + JSON 방어 렌더링). 다만 그 화면도 **읽기 위주**이고, 출력 필드가 화면에 하드코딩(`PROFILE_OUTPUT_FIELDS`)이라 스키마 변경 시 수동 동기화가 필요한 알려진 부채가 있다. 이 페이지는 출제 범위(users/consents/prompts)에 집중하므로 profiles 화면은 [프론트엔드 UI/UX](/area-a/frontend-ui)에서 다룬다.
:::

## 6. 면접 답변 3단계 (한 호흡)

1. **무엇**: "A 관리자 콘솔은 회원 관리·동의 이력·프로필 AI 프롬프트 세 화면입니다. 회원 관리만 쓰기(상태 변경)가 있고 나머지는 읽기 전용입니다."
2. **왜**: "A 데이터는 모든 분석의 기반이라 무결성이 중요해서 관리자 쓰기 표면을 상태 변경 하나로 좁혔습니다. 동의는 append-only 감사 테이블, 프롬프트는 코드 상수라 둘 다 조회만 노출합니다."
3. **어떻게**: "상태 변경 한 트랜잭션에 권한 검사·상태 history·감사 로그·그리고 비활성으로 바뀌면 refresh_token 전체 폐기까지 묶었습니다. 무상태 JWT를 즉시 끊는 효과를 세션 폐기로 냈습니다. 관리자 동의/프롬프트는 별도 매퍼 없이 사용자 도메인 서비스를 `requireAdmin` 분기만 추가해 재사용했습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 관리자가 회원을 차단하면 이미 발급된 access 토큰은 어떻게 막나요?
access는 무상태 JWT라 서버가 즉시 무효화하지 못합니다. 대신 상태를 ACTIVE 이외로 바꾸는 순간 `authMapper.revokeAllForUser(id)`로 그 회원의 refresh_token을 전부 폐기합니다. access는 수명이 짧아 곧 만료되고, 만료되면 refresh가 없어 갱신이 막혀 사실상 강제 로그아웃됩니다. 또한 로그인 자체도 상태 검증을 비밀번호 검증보다 먼저 하므로 비활성 계정은 재로그인도 막힙니다.
:::

:::details Q2. 관리자 전용 매퍼/서비스를 따로 다 만들었나요?
회원 관리만 `AdminUserMapper`라는 전용 매퍼가 있습니다. 여러 테이블을 join·aggregate해 상세 8종을 한 번에 내려야 해서입니다. 반면 동의 관리자 조회와 프로필 AI 프롬프트는 자체 매퍼 없이 사용자 도메인의 `ConsentServiceImpl.adminConsents`와 `ProfilePromptCatalog.view()`를 `requireAdmin` 분기만 추가해 재사용합니다. 로직 이중화로 동의 판정 규칙이 갈라지는 걸 막기 위한 단일 진실 원천 전략입니다.
:::

:::details Q3. 권한 검사를 왜 @PreAuthorize 안 쓰고 수동으로 했나요?
URL 레벨(`SecurityConfig`의 `hasAnyRole("ADMIN","SUPER_ADMIN")`)과 서비스 진입부(`AdminAccess.requireAdmin`)의 이중 방어를 명시적으로 하기 위해서입니다. URL 라우팅이 잘못 설정돼도 서비스 첫 줄에서 한 번 더 막히고, 권한 등급(`requireAdmin` vs `requireSuperAdmin`)을 메서드마다 코드로 분명히 드러낼 수 있습니다. 트레이드오프로 보일러플레이트가 늘지만, 관리자 API에선 명시성이 더 중요하다고 봤습니다.
:::

:::details Q4. 프롬프트를 DB에 두면 관리자가 실시간 편집할 수 있을 텐데 왜 코드 상수인가요?
프로필 AI는 "서버가 점수를 계산한다"는 뉴로-심볼릭 구조라, 프롬프트·직무군 가중치가 점수 재현성의 일부입니다. 운영자가 즉석에서 프롬프트를 바꾸면 같은 프로필이 시점에 따라 다른 점수를 받아 train/serve 정합이 깨집니다. 그래서 프롬프트(`a-profile-v2`)와 가중치 매트릭스를 코드 상수로 고정하고, 관리자 콘솔은 그 상수를 읽기 전용으로 비추기만 합니다. 변경은 코드 리뷰·배포를 거치게 했습니다.
:::

:::details Q5. 상태 변경 시 왜 사유와 메모를 두 군데에 기록하나요?
`user_status_history`에는 변경자(actor)·이전/이후 상태·사유·메모를, 그리고 `actionLogService.record`로 관리자 액션 로그에 before/after JSON을 별도로 남깁니다. 회원 상태 변경은 로그인·결제·서비스 이용에 직접 영향을 주는 민감 작업이라, 운영 분쟁이나 개인정보 감사 요청이 왔을 때 "누가·언제·무엇을·왜" 바꿨는지 단일 로그 유실에도 복원 가능하도록 이중으로 남깁니다.
:::

:::details Q6. 회원 상세를 한 번에 8종이나 내려주면 무겁지 않나요?
무겁지 않게 각 컬렉션에 상한을 둡니다(로그인 100, 상태이력 100, 세션 50 등). 운영자가 회원 1명을 판단할 때 필요한 컨텍스트가 보안 이력·인증 이력·동의·세션·AI 사용·프로필로 흩어져 있어 N번 호출하면 화면 전환과 왕복이 늘어납니다. 단일 화면 단일 호출로 "이 사람은 어떤 보안 이벤트를 겪었나"를 즉시 판단하게 한 의도적 집약입니다. 더 많은 로그가 필요하면 `login-history` 별도 엔드포인트로 페치합니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 소리 내어 설명할 수 있으면 이 페이지를 이해한 것이다.

1. A 관리자 화면 3개를 들고, 각각 쓰기인지 읽기인지 한 문장으로 구분해 말하기.
2. 관리자가 회원을 BLOCKED로 바꿀 때 한 트랜잭션 안의 5~7단계를 순서대로 말하기. 특히 `revokeAllForUser`가 왜 핵심인지.
3. 동의 관리자 조회와 프롬프트 콘솔이 "별도 매퍼 없이 사용자 도메인을 재사용"하는 이유를 데이터 무결성 관점에서 설명하기.
4. "프로필 스냅샷"이 버전 테이블이 아니라 현재 1행 평면화라는 점을 정직하게 짚기.

## 퀴즈

<QuizBox question="관리자가 회원 상태를 ACTIVE에서 BLOCKED로 변경할 때, AdminUserService.updateStatus가 추가로 수행하는 핵심 보안 동작은?" :choices="['해당 회원의 access JWT를 블랙리스트에 등록한다', '해당 회원의 refresh_token을 전부 폐기(revokeAllForUser)해 강제 로그아웃 효과를 낸다', '비밀번호를 즉시 무효화한다', '프로필 데이터를 삭제한다']" :answer="1" explanation="access JWT는 무상태라 즉시 무효화가 불가능하다. 그래서 비활성 상태로 바뀌면 refresh_token을 전부 폐기해, access가 만료되면 갱신이 막히도록 한다. 이것이 무상태 토큰을 사실상 강제 로그아웃시키는 방식이다." />

<QuizBox question="영역 A 관리자 콘솔의 동의 이력 조회와 프로필 AI 프롬프트 조회의 공통점으로 옳은 것은?" :choices="['둘 다 관리자 전용 매퍼를 새로 만들어 구현했다', '둘 다 쓰기(수정) 기능을 제공한다', '둘 다 별도 매퍼 없이 사용자 도메인의 서비스/카탈로그를 requireAdmin 분기만 추가해 재사용한다', '둘 다 SUPER_ADMIN 전용이다']" :answer="2" explanation="동의는 ConsentServiceImpl.adminConsents를, 프롬프트는 ProfilePromptCatalog.view()를 재사용한다. 로직 이중화로 규칙이 갈라지는 것을 막기 위한 단일 진실 원천 전략이며, 둘 다 읽기 전용이고 requireAdmin(ADMIN 이상)이면 접근 가능하다." />

<QuizBox question="관리자 회원 상세 응답(AdminUserDetail)의 profile 필드(AdminUserProfileSnapshot)에 대한 설명으로 가장 정확한 것은?" :choices="['user_profile_version 테이블의 버전 이력 목록이다', '현재 user_profile 1행을 평면화한 읽기 모델이며 별도 버전 테이블은 존재하지 않는다', '관리자가 직접 수정 가능한 편집 폼 데이터다', 'AI가 생성한 프로필 요약 캐시다']" :answer="1" explanation="이름은 스냅샷이지만 실제로는 현재 user_profile 1행을 평면화한 읽기 모델이다. user_profile_version(분석 재현성용 스냅샷) 테이블은 schema.sql에 없고, 프로필은 단일 행 upsert + updated_at만 갖는다." />

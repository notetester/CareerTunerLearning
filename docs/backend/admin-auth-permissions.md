# 관리자 인증과 세부 권한

> 관리자 URL은 “메뉴를 숨기는 UI”만으로 보호하지 않는다. 서버 역할 검사, exact permission, 프런트 라우트 경계, 동작 버튼 권한을 겹쳐서 fail-closed로 막는다.

## 문제였던 경계

과거에는 `/admin/**` 화면을 직접 입력했을 때 비로그인·일반 회원이 관리자 셸을 볼 수 있고, 권한 조회가 실패해도 화면이 열릴 수 있는 회색지대가 있었다. 역할 이름도 `ADMIN`/`SUPER_ADMIN` 두 덩어리에 치우쳐 회원·결제·콘텐츠별 최소 권한을 표현하기 어려웠다.

현재는 다음 네 층으로 나눈다.

```text
요청
 ├─ Spring Security: /api/admin/** 역할 검사
 ├─ Controller/Interceptor: @RequireAdminPermission exact code 검사
 ├─ AdminRouteBoundary: 로그인·역할·route policy 검사
 └─ useAdminAuthorization: 메뉴·버튼 단위 노출/동작 검사
```

프런트는 UX와 불필요한 lazy import를 줄이고, 백엔드는 실제 데이터 접근 권한을 확정한다. 프런트만 통과해도 API 권한이 없으면 거부된다.

## exact CRUD 카탈로그

권한 코드는 도메인과 동작을 결합한다.

| 도메인 | 동작 | 예시 |
| --- | --- | --- |
| 회원 | READ / CREATE / UPDATE / DELETE | `USER_READ`, `USER_DELETE` |
| 보안 | READ / CREATE / UPDATE / DELETE | `SECURITY_READ` |
| 결제 | READ / CREATE / UPDATE / DELETE | `BILLING_UPDATE` |
| 콘텐츠 | READ / CREATE / UPDATE / DELETE | `CONTENT_CREATE` |
| AI | READ / CREATE / UPDATE / DELETE | `AI_READ` |
| 정책 | READ / CREATE / UPDATE / DELETE | `POLICY_READ` |
| 관리자 권한 | READ / CREATE / UPDATE / DELETE | `ADMIN_PERMISSION_UPDATE` |
| 감사 | READ | `AUDIT_READ` |

정본 카탈로그는 29개 exact permission이고, 그룹 템플릿은 회원·보안·결제·콘텐츠·AI·감사·정책·슈퍼관리자 범위로 나뉜다. 삭제 권한의 “삭제”도 제품 데이터에 대해서는 소프트 삭제를 뜻한다.

## 라우트와 메뉴가 같은 정책을 쓰는 방법

`ADMIN_ROUTE_POLICIES`가 경로별 요구 권한의 단일 표다.

- `/admin/users` → `USER_READ`
- `/admin/payments` → `BILLING_READ`
- `/admin/community` → `CONTENT_READ` 또는 `AI_READ`
- `/admin/policies` → `POLICY_READ`
- `/admin/super` → `ADMIN_PERMISSION_READ` + `superOnly`
- `/admin/audit/**` → `AUDIT_READ`

라우트를 만들 때 이 정책을 `AdminRouteBoundary`와 route metadata에 동시에 전달한다. 권한이 없는 사용자는 페이지 컴포넌트의 동적 import도 시작하지 않는다. 사이드바 역시 같은 authorization 결과로 그룹과 항목을 걸러 “클릭한 뒤 403”보다 먼저 불필요한 탭을 숨긴다.

## fail-closed 판정

`resolveAdminRouteAccess`의 중요한 분기는 다음과 같다.

| 상태 | 결과 |
| --- | --- |
| 인증 로딩 중 | 로딩 화면 |
| 비로그인 | 관리자 로그인으로 이동 |
| 일반 `USER` | 403 |
| `ADMIN` + 권한 조회 실패 | 403 |
| `ADMIN` + 요구 exact code 없음 | 403 |
| `SUPER_ADMIN` | 전체 정책 허용 |

권한 API 장애를 “권한 없음처럼 안전하게 차단”하는 것이 핵심이다. 네트워크 오류를 허용으로 해석하면 관리자 보안 경계가 가용성에 종속된다.

## 읽기와 쓰기 분리

페이지에 들어갈 수 있다고 모든 버튼이 허용되는 것은 아니다.

- `*_READ`가 없으면 메뉴·탭과 라우트 자체를 숨기거나 거부한다.
- 생성 버튼은 `*_CREATE`가 있어야 보인다.
- 상태 변경·편집은 `*_UPDATE`가 필요하다.
- 삭제 동작은 `*_DELETE`가 필요하고 서버에서도 다시 검사한다.
- 슈퍼관리자는 다른 관리자에게 그룹·직접 권한을 부여·회수할 수 있다.

이 구조 덕분에 “회원 조회만 가능한 관리자”와 “회원 정지까지 가능한 관리자”를 구분할 수 있다.

## DB 구조와 소프트 삭제

권한은 정책 카탈로그, 그룹, 그룹 항목, 사용자별 직접 권한으로 분리된다. 관계 행에는 `deleted_at`을 사용해 회수 이력을 보존하고, 재부여 시 기존 관계를 복원한다. 증분 패치는 기존 적용 파일을 수정하지 않고 새 파일로 추가하며 checksum 원장이 재실행을 막는다.

`ACTIVE SUPER_ADMIN` 시드 계정을 여러 개 두는 것은 개발·시연 편의를 위한 데이터 결정이다. 보안 설계의 핵심은 계정 수가 아니라 실제 운영 환경에서 자격증명 보호, 시드 교체, 감사 로그, 최소 권한을 적용하는 것이다.

## 검증해야 하는 회귀 사례

1. 익명 사용자가 `/admin/policies` 직접 입력 → 로그인 이동, 관리자 표시 없음
2. 일반 회원이 같은 URL 입력 → 403
3. `ADMIN`이 권한 조회 API 실패 → 403
4. `USER_READ`만 가진 관리자 → 회원 탭 보임, 삭제 버튼 없음
5. `CONTENT_CREATE` 없는 관리자 → 공지 작성 진입·API 모두 거부
6. `SUPER_ADMIN` → 권한 관리 화면 접근 및 부여·회수 가능
7. 삭제한 권한 관계 → 활성 조회에서 제외, 재부여 시 중복 행 대신 복원

## 면접에서의 짧은 답변

> “관리자 화면은 역할 두 개만 보는 방식에서 도메인별 exact CRUD 권한으로 바꿨습니다. 프런트의 route policy로 메뉴와 lazy import를 막고, 백엔드는 애너테이션과 interceptor로 같은 권한을 재검사합니다. 특히 권한 조회가 실패하면 허용하지 않고 403으로 닫는 fail-closed를 택했습니다. 그래서 URL 직접 입력이나 프런트 조작만으로 관리자 데이터에 접근할 수 없습니다.”

## 근거 경로

- `frontend/src/admin/auth/adminAccess.ts`
- `frontend/src/admin/auth/AdminRouteBoundary.tsx`
- `frontend/src/admin/auth/useAdminAuthorization.ts`
- `frontend/src/admin/routes.ts`
- `backend/src/main/java/com/careertuner/admin/permission/`
- `backend/src/main/resources/db/patches/20260711_admin_permission_crud_catalog.sql`

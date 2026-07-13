# 결제·크레딧 관리자 기능

영역 E의 운영 화면은 결제 현황, 환불 심사, 요금 정책 변경, 크레딧 원장 조회·조정을 한곳에서 다룬다. 사용자 결제 흐름과 분리되어 있지만 같은 원장과 정책을 읽으므로, 운영 작업도 사용자 잔액과 이력에 즉시 연결된다.

## 제공 기능

| 화면 | 조회 | 변경 |
| --- | --- | --- |
| 요금제 | 구독·크레딧 상품, 혜택 정책, 정책 변경 이력 | 정책 변경 예약, 예약 취소 |
| 결제 | 상태별 결제 목록, 결제 요약 | 조회 전용 |
| 환불 | 상태별 환불 요청 | 승인, 거절 |
| 크레딧 | 사용자별 잔액·거래 원장, 요약 | 사유를 포함한 증감 조정 |

## 권한과 안전장치

- 조회 API는 `BILLING_READ` 권한이 필요하다.
- 정책 변경 생성은 `BILLING_CREATE`, 취소·환불 심사·크레딧 조정은 `BILLING_UPDATE` 권한이 필요하다.
- 금융 상태를 바꾸는 API에는 `@SitesFinancialMutation`이 붙어 공개 데모 호스팅 환경에서 실제 원장을 변경하지 못하게 막는다.
- 메뉴 노출만으로 권한을 판단하지 않는다. 백엔드의 `@RequireAdminPermission` 검사가 최종 거부 지점이다.
- 크레딧 조정은 잔액 숫자만 덮어쓰지 않고 거래 원장에 조정 내역과 사유를 남긴다.

## API 경계

```text
GET  /api/admin/plans
GET  /api/admin/plans/policy-changes
POST /api/admin/plans/policy-changes
POST /api/admin/plans/policy-changes/{id}/cancel

GET  /api/admin/payments
GET  /api/admin/payments/summary
GET  /api/admin/refunds
POST /api/admin/refunds/{id}/approve
POST /api/admin/refunds/{id}/reject

GET  /api/admin/credits
GET  /api/admin/credits/summary
POST /api/admin/credits/adjust
```

관리자 공통 인증·세부 권한 설계는 [관리자 인증·권한](/backend/admin-auth-permissions)에서 이어서 볼 수 있다.

## 근거 경로

- `backend/src/main/java/com/careertuner/admin/billing/controller/`
- `backend/src/main/java/com/careertuner/admin/credit/`
- `frontend/src/admin/features/billing/`
- `frontend/src/admin/features/credits/`

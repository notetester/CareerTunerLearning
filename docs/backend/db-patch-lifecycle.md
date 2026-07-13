# DB 패치 생명주기와 checksum 원장

> `schema.sql`은 새 환경의 정본이고, 이미 운영 중인 DB는 append-only 증분 패치로 진화한다. 적용한 SQL을 나중에 고치는 대신 새 패치를 추가한다.

## 왜 `schema.sql`만 배포하지 않는가

빈 DB에는 전체 DDL을 한 번에 적용할 수 있지만, 운영 DB에는 사용자 데이터와 기존 인덱스·제약이 있다. 전체 스키마를 다시 밀어 넣으면 데이터 손실, 긴 잠금, 환경별 drift를 만들 수 있다.

CareerTuner는 두 경로를 구분한다.

| 상황 | 입력 |
| --- | --- |
| 새 개발·테스트 DB | canonical `schema.sql` + seed |
| 기존 배포 DB | 기준 커밋 뒤 새로 추가된 `db/patches/*.sql` |

## `schema_migration` 원장

```text
schema_migration
  migration_name  PK
  checksum        SHA-256
  applied_at
```

적용기는 패치마다 다음 순서를 지킨다.

1. 허용된 패치 경로와 실제 파일 존재를 검증한다.
2. 파일 SHA-256을 계산한다.
3. 같은 파일명이 원장에 있으면 checksum을 비교한다.
4. 같으면 이미 적용된 패치로 건너뛴다.
5. 다르면 과거 패치 변조로 보고 배포를 실패시킨다.
6. 신규 패치면 MySQL에 적용한 뒤 이름과 checksum을 기록한다.

이 방식은 “재실행해도 중복 적용하지 않음”과 “적용 뒤 내용을 몰래 바꾸지 못함”을 동시에 보장한다.

## append-only 규칙

자동화 기준점 이후 기존 패치의 수정은 CI에서 금지한다. 잘못된 패치를 고칠 때도 이전 파일을 덮어쓰지 않고 보정 패치를 새로 만든다.

```text
나쁜 예
20260711_add_column.sql 내용을 적용 후 수정

좋은 예
20260711_add_column.sql        그대로 보존
20260713_fix_column_index.sql  새 보정 패치
```

운영자가 어느 순서로 무엇을 적용했는지 감사할 수 있고, 다른 환경도 같은 이력을 재생할 수 있다.

## 멱등 SQL과 멱등 적용기는 다른 층이다

패치 자체도 가능한 한 다음 패턴을 사용한다.

- `CREATE TABLE IF NOT EXISTS`
- `information_schema`로 컬럼·인덱스 존재 확인
- `INSERT ... ON DUPLICATE KEY UPDATE`
- 기존 soft-delete 관계 복원
- 완료 후 기대 건수 검증 query

하지만 SQL이 멱등해 보여도 적용 원장 없이 무한 재실행하는 것은 위험하다. checksum 적용기가 1차로 재실행을 막고, SQL 내부 방어는 비정상 중단·부분 환경 차이를 흡수하는 2차 안전망이다.

## 배포 흐름

```text
변경 감지
  → 기존 patch 수정 여부 거부
  → 신규 patch 목록 생성
  → 서버로 필요한 파일만 전달
  → 기존 backend 컨테이너에서 DB 연결 설정 읽기
  → 일회성 MySQL 8.4 client로 patch 적용
  → application image 교체
  → readiness로 DB 왕복 확인
```

로그에는 패치 이름과 성공·건너뜀만 남기고 DB 비밀번호를 출력하지 않는다. 접속 정보는 실행 중인 backend 컨테이너 환경에서 읽어 일회성 client에만 전달한다.

## 새 패치 체크리스트

1. 파일명은 날짜와 목적이 드러나게 만든다.
2. 기존 패치 파일을 수정하지 않는다.
3. 운영 데이터 backfill은 재실행 안전성을 갖춘다.
4. 긴 table lock과 대량 update 범위를 검토한다.
5. soft delete·활성 필터·FK orphan 경계를 함께 확인한다.
6. 새 DB 전체 스키마에도 최종 상태를 반영한다.
7. MySQL 8 빈 DB 적용과 같은 패치 두 번 실행을 검증한다.
8. 실패·중단 뒤 재개 시나리오를 점검한다.

## 한계와 보완

현재 적용기는 SQL 파일 전체 실행과 원장 insert가 하나의 전역 트랜잭션이라고 가정하지 않는다. MySQL DDL은 암묵적 commit이 발생할 수 있다. 따라서 패치는 중간 실패 뒤 다시 실행해도 안전하도록 작성해야 한다. 더 복잡한 버전 의존·rollback이 필요해지면 Flyway 같은 migration tool 도입을 검토할 수 있다.

## 면접에서의 짧은 답변

> “신규 DB는 schema.sql, 기존 운영 DB는 append-only 패치로 분리했습니다. 배포기가 파일 SHA-256과 적용 시각을 schema_migration에 남겨 같은 패치는 건너뛰고, 적용된 파일 내용이 바뀌면 실패합니다. MySQL DDL의 부분 적용 가능성 때문에 패치 SQL 자체도 존재 확인과 upsert로 재실행 안전하게 작성합니다.”

## 근거 경로

- `backend/src/main/resources/db/schema.sql`
- `backend/src/main/resources/db/patches/`
- `.github/scripts/apply-db-patches.sh`
- `.github/workflows/deploy-backend.yml`

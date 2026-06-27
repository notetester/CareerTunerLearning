# 트랜잭션 (ACID)

> 여러 DB 작업을 "전부 성공 아니면 전부 취소"로 묶어 데이터가 어중간하게 깨지지 않게 보장하는 단위다.

## 1. 한 줄 정의

트랜잭션은 **하나의 논리적 작업으로 묶인 여러 DB 연산을 더 이상 쪼갤 수 없는 한 덩어리로 처리하는 단위**다. 도중에 하나라도 실패하면 이미 한 작업까지 전부 되돌린다(롤백).

CareerTuner에서는 Spring의 `@Transactional` 선언적 트랜잭션으로 service 계층 메서드 단위에 적용한다.

## 2. 단어 뜻 (약자/어원 풀이)

- **Transaction**: 원래 은행 "거래"에서 온 말. 계좌 A에서 빼고 B에 넣는 두 작업은 항상 같이 성공하거나 같이 실패해야 한다는 직관 그대로다.
- **ACID**: 트랜잭션이 지켜야 하는 4가지 성질의 머리글자.

| 글자 | 영어 | 뜻 | 한 줄 설명 |
| --- | --- | --- | --- |
| A | Atomicity | 원자성 | 전부 반영되거나 전부 안 되거나. 중간 상태 없음 |
| C | Consistency | 일관성 | 끝나면 DB 제약(PK/FK/잔액 음수 금지 등)이 항상 만족 |
| I | Isolation | 격리성 | 동시에 도는 트랜잭션끼리 서로의 중간 결과를 안 본다 |
| D | Durability | 지속성 | 커밋되면 장애가 나도 그 결과는 사라지지 않는다 |

:::tip 외우는 법
"원자(A)는 쪼갤 수 없고, 끝나면 규칙(C)을 지키고, 서로 안 보고(I), 한번 정하면 안 사라진다(D)."
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

트랜잭션이 없으면 **여러 번의 DB 쓰기 중간에 에러가 나면 데이터가 반쪽 상태로 남는다.**

CareerTuner의 크레딧 차감을 예로 들면 한 작업이 두 개의 쓰기로 이뤄진다.

1. 사용자 잔액에서 크레딧 차감
2. `credit_transaction` 에 차감 내역 기록

트랜잭션이 없을 때 1번만 성공하고 2번에서 죽으면 **잔액은 줄었는데 내역은 없는** 상태가 된다. 사용자는 "돈은 빠졌는데 왜 기록이 없냐"고 항의하고, 정산도 안 맞는다. 트랜잭션으로 묶으면 2번 실패 시 1번까지 롤백돼 잔액이 원래대로 돌아온다.

:::warning 가장 흔한 오해
"DB가 알아서 안전하게 처리하겠지"는 틀렸다. **개별 SQL은 각각 커밋된다.** 여러 SQL을 한 덩어리로 묶으려면 트랜잭션 경계를 명시적으로 선언해야 한다. CareerTuner에서는 그게 `@Transactional`이다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

선언적 트랜잭션을 service 계층 전반에 적용한다(백엔드 전체 75개 파일, 269곳).

| 위치 | 클래스 | 묶는 작업 | 영역 |
| --- | --- | --- | --- |
| 크레딧 차감 | `credit/service/CreditServiceImpl#deduct` | `users` 잔액 차감 + `credit_transaction` insert | 공통 |
| 적합도 분석 저장 | `fitanalysis/service/FitAnalysisServiceImpl#generate` | `fit_analysis` insert + 히스토리 insert | **C(본인)** |
| 적합도 학습과제 토글 | `FitAnalysisServiceImpl#updateLearningTask` | update 후 0건이면 `NOT_FOUND` 던져 롤백 | **C(본인)** |
| 회원가입/토큰 | `auth/service/AuthServiceImpl` | `users` + `refresh_token` 등 | A |
| 커뮤니티 | `community/service/CommunityPostServiceImpl` | 게시글 + 반응/카운트 | 타 영역 |

:::details C 영역(본인) 코드 — 적합도 분석 generate
`@Transactional` 한 줄로 메서드 전체가 한 트랜잭션이 된다. AI 호출 결과를 `fit_analysis` 행으로 만들고 히스토리까지 같이 insert한다. 둘 중 하나라도 실패하면 같이 롤백된다.

```java
@Override
@Transactional
public FitAnalysisDetailResponse generate(Long userId, Long applicationCaseId) {
    FitAnalysisResult row = /* AI 결과로 빌드 */ ...;
    fitAnalysisMapper.insertFitAnalysis(row);   // 쓰기 1
    fitAnalysisMapper.insertHistory(...);        // 쓰기 2
    // 둘 중 하나 실패하면 둘 다 롤백
}
```
:::

읽기 전용 메서드에는 `@Transactional(readOnly = true)`를 단다. 클래스 레벨에 `readOnly = true`를 걸고, 쓰기 메서드만 `@Transactional`로 덮어쓰는 패턴을 `FaqServiceImpl`, `CompanyAnalysisService`, `ReportServiceImpl` 등에서 쓴다.

## 5. 핵심 동작 원리 (선언적 트랜잭션)

`@Transactional`은 **AOP 프록시** 기반이다. Spring이 빈을 감싸는 대리 객체(프록시)를 만들고, 메서드 호출 전후로 트랜잭션을 열고 닫는다.

```text
호출 ─▶ [프록시] BEGIN
          └▶ 실제 service 메서드 실행 (여러 mapper 호출)
              ├─ 정상 반환 ────▶ COMMIT
              └─ 런타임 예외 ──▶ ROLLBACK
```

핵심 규칙 4가지.

- **기본 롤백 대상은 `RuntimeException`(과 `Error`)이다.** CareerTuner의 `BusinessException`은 `RuntimeException`이므로, 예를 들어 크레딧 부족 시 던지는 `INSUFFICIENT_CREDIT`이 자동 롤백을 일으킨다. 체크 예외는 기본적으로 롤백하지 **않는다**.
- **`readOnly = true`**: 쓰기 안 하는 조회 전용. 드라이버/DB에 "쓰기 없음" 힌트를 줘서 최적화 여지를 주고, 실수로 쓰기하는 걸 막는다.
- **롤백 커스터마이즈**: `AuthServiceImpl`은 `@Transactional(noRollbackFor = BusinessException.class)`를 쓴다. 로그인 실패 같은 비즈니스 예외가 떠도 로그인 시도 이력 같은 부수 기록은 **남기고 싶어서** 롤백을 끈 케이스다.
- **자기호출(self-invocation) 함정**: 같은 클래스 안에서 `this.다른메서드()`로 호출하면 프록시를 안 거쳐 `@Transactional`이 무시된다.

| 어노테이션 | 언제 | CareerTuner 예시 |
| --- | --- | --- |
| `@Transactional` | 쓰기(insert/update/delete) | `CreditServiceImpl#deductByAiUsageLog` |
| `@Transactional(readOnly = true)` | 조회 전용 | `FaqServiceImpl`, `FitAnalysisServiceImpl#get` |
| `@Transactional(noRollbackFor = ...)` | 예외 떠도 기록 유지 | `AuthServiceImpl` 로그인 |

## 6. 면접 답변 3단계

- **초간단(1문장)**: "트랜잭션은 여러 DB 작업을 전부 성공 아니면 전부 취소로 묶는 단위고, ACID로 데이터 무결성을 보장합니다."
- **기본**: "ACID는 원자성·일관성·격리성·지속성입니다. 저희는 Spring `@Transactional`로 service 계층 메서드에 선언적으로 걸었고, 조회는 `readOnly=true`로 분리했습니다. 예를 들어 크레딧 차감은 잔액 차감과 내역 기록을 한 트랜잭션으로 묶어서, 둘 중 하나라도 실패하면 잔액이 원복되게 했습니다."
- **꼬리질문 대응**: "롤백은 기본적으로 `RuntimeException`에서 일어나는데, 저희 `BusinessException`이 `RuntimeException`이라 `INSUFFICIENT_CREDIT` 같은 예외가 자동 롤백을 일으킵니다. 반대로 로그인 실패 이력처럼 예외가 떠도 남겨야 하는 경우엔 `noRollbackFor`로 롤백을 끕니다. `@Transactional`은 AOP 프록시 기반이라 같은 클래스 내부 호출에선 안 먹는 점도 주의합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. `@Transactional`은 어떻게 동작하나요? (마법이 아님)
Spring AOP가 해당 빈을 프록시로 감싸고, 프록시가 메서드 진입 시 `BEGIN`, 정상 반환 시 `COMMIT`, 런타임 예외 발생 시 `ROLLBACK`을 수행합니다. 그래서 메서드 안 코드는 트랜잭션을 직접 신경 쓸 필요가 없습니다. 단 프록시를 거쳐야 하므로 **같은 클래스 내부의 `this.method()` 호출에는 적용되지 않습니다.**
:::

:::details Q2. 기본적으로 어떤 예외에서 롤백되나요?
`RuntimeException`과 `Error`에서만 자동 롤백됩니다. 체크 예외(`Exception` 계열)는 기본적으로 롤백하지 않습니다. CareerTuner의 `BusinessException`은 `RuntimeException`을 상속해서 의도적으로 자동 롤백 대상이 되게 설계했습니다. 동작을 바꾸려면 `rollbackFor` / `noRollbackFor`를 씁니다.
:::

:::details Q3. readOnly=true는 왜 쓰나요?
조회 전용 트랜잭션임을 명시해 (1) JDBC/드라이버에 쓰기 없음 힌트를 주어 불필요한 플러시/락 비용을 줄이고, (2) 의도치 않은 쓰기를 방지하고, (3) 코드 의도를 분명히 합니다. CareerTuner는 클래스에 `readOnly=true`를 걸고 쓰기 메서드만 `@Transactional`로 덮는 패턴을 자주 씁니다.
:::

:::details Q4. ACID 중 격리성(Isolation)은 실무에서 어떻게 조절하나요?
격리 수준(READ COMMITTED, REPEATABLE READ 등)으로 동시 트랜잭션이 서로의 중간 결과를 얼마나 보는지를 정합니다. MySQL InnoDB 기본은 REPEATABLE READ입니다. 격리를 낮추면 동시성은 올라가지만 더티 리드/팬텀 리드 위험이 커지는 트레이드오프가 있습니다. CareerTuner는 기본 격리 수준을 사용하고, 동시 차감 같은 민감 연산은 잔액이 충분할 때만 차감하는 조건부 update(`deductUserCreditIfEnough`, 갱신 행 수로 성공 판정)로 경쟁 상황을 방어합니다.
:::

:::details Q5. 트랜잭션 안에서 외부 API(AI) 호출은 괜찮나요?
주의해야 합니다. 트랜잭션이 열린 동안 느린 외부 호출(OpenAI 등)을 하면 DB 커넥션/락을 그만큼 오래 잡습니다. 이상적으로는 무거운 외부 호출을 트랜잭션 밖으로 빼거나 결과만 짧은 트랜잭션으로 저장하는 식으로 경계를 좁힙니다. 이건 트랜잭션 경계를 어디에 그을지를 묻는 좋은 설계 질문입니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. CareerTuner의 크레딧 차감을 예로, 트랜잭션이 없으면 어떤 사고가 나는지와 ACID의 어떤 글자가 그걸 막는지 30초 안에 설명해 보라.
2. "`@Transactional`을 붙였는데 롤백이 안 됐다"는 상황에서 의심할 원인 2가지(예외 타입, 자기호출)를 소리 내어 짚어보라.

관련 개념: [DTO](/glossary/dto) · [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [JWT 인증/보안](/backend/jwt-security)

## 퀴즈

<QuizBox question="ACID에서 '전부 반영되거나 전부 안 되거나, 중간 상태가 없다'를 보장하는 성질은?" :choices="['원자성(Atomicity)','일관성(Consistency)','격리성(Isolation)','지속성(Durability)']" :answer="0" explanation="원자성(Atomicity)은 트랜잭션을 더 이상 쪼갤 수 없는 한 덩어리로 보아 전부 성공 또는 전부 취소를 보장한다. 도중 실패 시 이미 한 작업까지 롤백한다." />

<QuizBox question="Spring @Transactional이 기본 설정에서 자동으로 롤백을 일으키는 예외 종류는?" :choices="['모든 Exception','RuntimeException과 Error','체크 예외만','IOException만']" :answer="1" explanation="기본 롤백 대상은 RuntimeException과 Error다. 체크 예외는 기본적으로 롤백하지 않는다. CareerTuner의 BusinessException은 RuntimeException을 상속해 INSUFFICIENT_CREDIT 같은 예외가 자동 롤백되도록 했다." />

<QuizBox question="CareerTuner의 크레딧 차감(CreditServiceImpl)에서 트랜잭션으로 묶는 두 작업이 무엇이고, 트랜잭션이 없으면 어떤 문제가 생기는지 설명하라." explanation="잔액에서 크레딧을 차감하는 update와 credit_transaction 테이블에 차감 내역을 insert하는 두 쓰기를 한 트랜잭션으로 묶는다. 트랜잭션이 없으면 차감만 성공하고 내역 기록에서 실패할 경우 잔액은 줄었는데 기록은 없는 반쪽 상태가 되어 정산 불일치와 사용자 항의가 발생한다. @Transactional로 묶으면 둘 중 하나라도 실패할 때 잔액 차감까지 롤백되어 원자성이 보장된다." />

# 비밀번호 해싱 (BCrypt)

> 비밀번호는 절대 평문으로 저장하지 않고, 복호화가 불가능한 단방향 해시 함수 BCrypt로 변환해 저장합니다. 로그인 때는 입력값을 다시 해싱해 저장된 해시와 비교만 합니다.

## 1. 한 줄 정의

BCrypt는 **salt와 work factor(반복 강도)를 내장한 단방향 비밀번호 해시 알고리즘**으로, 같은 비밀번호라도 매번 다른 해시가 나오고 의도적으로 느리게 동작해 무차별 대입(brute force)을 어렵게 만듭니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| BCrypt | **B**lowfish 기반 **Crypt**. 1999년 발표, Blowfish 암호의 키 스케줄을 반복해 느리게 만든 해시 |
| Hash(해시) | 임의 입력을 고정 길이 값으로 바꾸는 단방향 함수. 입력으로 출력은 쉽지만, 출력으로 입력은 사실상 불가 |
| Salt(솔트) | 해싱 전에 비밀번호에 섞는 무작위 값. "소금을 친다"는 비유 |
| Work factor / cost | 해시 반복 횟수의 지수. BCrypt는 `2^cost` 번 반복. 기본 cost 10이면 1024회 |
| 단방향(one-way) | 결과만으로 원본을 되돌릴 수 없는 성질 |

:::tip 해시 vs 암호화 한 줄 구분
**암호화(encryption)** 는 키로 풀 수 있는 양방향 — 카드번호처럼 다시 봐야 하는 데이터용. **해시(hash)** 는 되돌릴 수 없는 단방향 — 비밀번호처럼 "맞는지만 확인"하면 되는 데이터용. 비밀번호는 우리도 알 필요가 없으므로 해시가 정답입니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

평문 저장이나 약한 해시를 쓰면 DB가 한 번 유출되는 순간 모든 계정이 즉시 털립니다.

- **평문 저장**: DB만 뚫리면 비밀번호가 그대로 노출. 사용자가 같은 비번을 다른 사이트에서도 쓰면 2차 피해.
- **단순 SHA-256 같은 빠른 해시**: salt가 없으면 같은 비번은 같은 해시 → **레인보우 테이블**(미리 계산된 해시 사전)로 즉시 역추적. 또 GPU로 초당 수십억 번 계산되어 무차별 대입에 약함.
- **salt 없는 해시**: 같은 비밀번호를 쓰는 사용자들의 해시가 동일 → DB에서 "같은 비번 쓰는 계정"이 한눈에 보임.

BCrypt는 이 셋을 한 번에 해결합니다: salt를 자동 생성·해시에 내장하고, work factor로 일부러 느리게 만들어 GPU 무차별 대입을 비현실적으로 만듭니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

> 영역: 백엔드 · 인증/보안 (Owner는 공통 영역이라 팀장 승인 대상)

| 위치 | 역할 |
| --- | --- |
| `common/config/SecurityConfig.java` | `PasswordEncoder` 빈 정의 — `new BCryptPasswordEncoder()` 한 줄로 등록 |
| `auth/service/AuthServiceImpl.java` | `PasswordEncoder`를 생성자 주입받아 회원가입·로그인·비번재설정에서 사용 |
| `user/domain/User.java` | `private String password;` 필드 = BCrypt 해시 (소셜 전용 계정은 null) |
| `db/schema.sql` `users.password` | `VARCHAR(255)` 컬럼, "BCrypt로 암호화한 비밀번호 해시" 주석 |

**실제 호출 지점(구현됨):**

```java
// 회원가입: 평문 비번을 해시로 변환해 저장
.password(passwordEncoder.encode(request.password()))

// 로그인: 입력 비번을 해시해 저장된 해시와 비교 (복호화 아님)
if (!passwordEncoder.matches(request.password(), user.getPassword())) {
    userMapper.increaseFailedLogin(user.getId());   // 실패 카운트 증가
    // ... 5회 초과 시 10분 계정 잠금
}

// 비밀번호 재설정: 새 비번을 다시 해시해 갱신
userMapper.updatePassword(user.getId(), passwordEncoder.encode(request.newPassword()));
```

:::details 소셜 전용 계정은 왜 password가 null인가
Kakao/Naver/Google OAuth로만 가입한 계정은 비밀번호 로그인을 안 하므로 `password`가 null이고 `password_enabled = 0`입니다. 로그인 로직에서 `user.getPassword() == null`이면 `matches`를 호출하기 전에 차단합니다.
:::

## 5. 핵심 동작 원리 (해시 구조 + 검증 흐름)

BCrypt 해시 한 줄에는 **알고리즘 버전 · cost · salt · 해시값**이 전부 들어 있습니다. 그래서 검증할 때 salt를 따로 저장·조회할 필요가 없습니다.

```text
$2b$10$N9qo8uLOickgx2ZMRZoMye  IjZAgcfl7p92ldGxad68LJZdL17lhWy
└┬┘ └┬┘ └──────── salt ───────┘ └─────────── 해시값 ──────────┘
 │   └ cost = 10 (2^10 = 1024회 반복)
 └ 알고리즘 버전(2b)
```

**저장(encode) — 회원가입/비번변경:**

1. 무작위 salt 16바이트 생성
2. `salt + 평문비번`을 BCrypt로 `2^cost`회 반복 해싱
3. `버전 + cost + salt + 해시값`을 한 문자열로 합쳐 `users.password`에 저장

**검증(matches) — 로그인:**

1. 저장된 해시에서 **버전·cost·salt를 파싱**
2. 같은 salt·cost로 입력 비번을 해싱
3. 결과가 저장된 해시값과 같으면 통과 (원본을 복호화하지 않음)

:::tip 같은 비번인데 해시가 매번 다른 이유
salt가 매번 무작위라서 `encode("1234!")`를 두 번 호출하면 결과 문자열이 다릅니다. 그래도 `matches`는 저장된 해시 안의 salt를 꺼내 쓰므로 둘 다 통과합니다. 그래서 비밀번호 비교는 `equals`가 아니라 반드시 `matches`로 해야 합니다.
:::

:::warning work factor는 "느린 게 기능"이다
일반 해시는 빠를수록 좋지만 비밀번호 해시는 **느릴수록 안전**합니다. cost를 1 올리면 연산량이 2배가 되어 공격자의 무차별 대입 비용도 2배가 됩니다. CareerTuner는 Spring 기본 cost(10)를 사용합니다. 하드웨어가 빨라지면 cost를 올려 강도를 유지할 수 있습니다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장):** "비밀번호는 평문으로 저장하지 않고 BCrypt라는 단방향 해시로 저장하고, 로그인 때는 입력값을 다시 해싱해서 비교합니다."
- **기본:** "BCrypt는 salt와 work factor를 해시 문자열 안에 함께 담는 단방향 알고리즘입니다. 같은 비번이라도 salt가 매번 달라 해시가 다르게 나오고, 일부러 느리게 동작해 GPU 무차별 대입을 어렵게 만듭니다. CareerTuner에서는 `SecurityConfig`에 `BCryptPasswordEncoder`를 빈으로 등록하고, `AuthServiceImpl`의 회원가입에서 `encode`, 로그인에서 `matches`를 호출합니다."
- **꼬리질문 대응:** "복호화가 불가능하기 때문에 비밀번호 찾기는 '재설정' 방식으로만 제공하고, 로그인 검증은 `equals`가 아니라 `matches`로 합니다. salt가 해시에 포함돼 있어 별도 컬럼이 필요 없고, 하드웨어 발전에 맞춰 cost를 올려 강도를 조절할 수 있습니다. 로그인 실패가 5회를 넘으면 10분 계정 잠금까지 함께 적용합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 해시와 암호화의 차이는?**
암호화는 키로 다시 풀 수 있는 양방향, 해시는 되돌릴 수 없는 단방향입니다. 비밀번호는 서버조차 원본을 알 필요가 없으므로 "맞는지만 확인"하는 단방향 해시가 적합합니다. 카드번호처럼 다시 봐야 하는 값은 암호화를 씁니다.

**Q2. salt는 왜 필요하고 어디에 저장하나요?**
salt는 같은 비밀번호가 같은 해시로 나오는 걸 막아 레인보우 테이블 공격을 무력화합니다. BCrypt는 salt를 해시 문자열 안에 함께 저장하기 때문에 별도 컬럼이 필요 없고, 검증 시 거기서 salt를 꺼내 다시 해싱합니다.

**Q3. SHA-256으로 해시하면 안 되나요?**
SHA-256은 너무 빨라서 GPU로 초당 수십억 번 대입이 가능하고, salt를 직접 챙기지 않으면 레인보우 테이블에도 취약합니다. BCrypt는 work factor로 의도적으로 느리고 salt가 내장돼 있어 비밀번호 저장에 더 적합합니다.

**Q4. cost(work factor)를 무한정 올리면 좋은가요?**
아니요. cost가 1 오를 때마다 연산량이 2배라 로그인 응답 시간도 늘어납니다. 사용자 체감 지연(보통 수십~수백 ms)과 보안 강도 사이에서 균형을 맞춰야 하며, 통상 10~12 범위를 씁니다.

**Q5. 로그인 비교를 `user.getPassword().equals(input)`로 하면 왜 안 되나요?**
저장된 값은 평문이 아니라 salt가 섞인 해시라서 단순 문자열 비교는 절대 일치하지 않습니다. 입력값을 같은 salt·cost로 다시 해싱해 비교해야 하며, 그 로직이 `passwordEncoder.matches(원본, 저장해시)`에 들어 있습니다.

## 8. 직접 말해보기

1. "우리 서비스 DB가 통째로 유출됐다고 가정하고, 그래도 사용자 비밀번호가 바로 털리지 않는 이유를 BCrypt의 salt와 work factor로 설명해보세요."
2. "회원가입부터 로그인까지, `encode`와 `matches`가 각각 어느 순간에 호출되고 무슨 일을 하는지 CareerTuner 코드 기준으로 말해보세요."

## 퀴즈

<QuizBox question="BCrypt가 같은 비밀번호인데도 호출할 때마다 다른 해시 문자열을 만드는 직접적인 이유는?" :choices="['매번 다른 무작위 salt를 생성해 함께 해싱하기 때문', 'cost 값이 매번 자동으로 바뀌기 때문', '서버 시간을 키로 암호화하기 때문', '해시 결과를 매번 Base64로 다르게 인코딩하기 때문']" :answer="0" explanation="BCrypt는 해싱 전에 무작위 salt를 생성해 비밀번호에 섞고, 그 salt를 해시 문자열 안에 함께 저장합니다. salt가 매번 달라 결과 해시도 달라지지만, 검증 시에는 저장된 해시에서 salt를 꺼내 다시 해싱하므로 matches가 정상 동작합니다." />

<QuizBox question="비밀번호 검증을 user.getPassword().equals(입력값) 으로 하면 안 되는 이유를 한 문장으로 설명하세요." explanation="저장된 값은 평문이 아니라 salt와 cost가 포함된 BCrypt 해시 문자열이므로 평문 입력과 단순 문자열 비교를 하면 절대 일치하지 않습니다. 반드시 passwordEncoder.matches(원본, 저장해시)로 입력값을 같은 salt·cost로 다시 해싱해 비교해야 합니다." />

<QuizBox question="BCrypt의 work factor(cost)를 1 올리면 어떤 일이 일어나는가?" :choices="['해시 연산량이 약 2배가 되어 무차별 대입 비용도 2배가 된다', '해시 길이가 절반으로 줄어든다', 'salt 길이가 2배가 된다', '검증 속도가 더 빨라진다']" :answer="0" explanation="BCrypt는 2^cost 번 반복하므로 cost가 1 오르면 연산 횟수가 2배가 됩니다. 일부러 느리게 만들어 GPU 무차별 대입 비용을 높이는 것이 핵심이며, 그만큼 로그인 응답 시간도 늘어나 균형을 맞춰야 합니다." />

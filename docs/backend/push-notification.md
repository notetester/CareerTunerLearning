# 푸시 알림 (Web Push · FCM)

> 알림 1건을 사용자 기기 화면에 띄우는 보조 채널이다. 웹/PWA는 Web Push(VAPID), 네이티브 앱은 FCM으로 보내고, 키가 없으면 발송 대신 로그로 남겨 본 흐름을 절대 끊지 않는다.

## 1. 한 줄 정의

서버가 사용자의 등록된 기기(브라우저·모바일 앱)로 알림을 **밀어 넣는(push)** 기능. CareerTuner에서는 채널이 두 갈래다 — PWA/브라우저는 **Web Push(VAPID)**, Capacitor 네이티브 앱은 **Firebase Admin FCM**.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| Push | 클라이언트가 요청해서 받는 Pull이 아니라, 서버가 먼저 보내는 방식 |
| Web Push | W3C 표준 브라우저 푸시. 서비스워커가 백그라운드에서 메시지를 수신해 알림을 띄움 |
| VAPID | Voluntary Application Server Identification. 푸시 서버가 "이 발신자가 맞다"고 식별하는 공개키/개인키 쌍 |
| p256dh / auth | 브라우저가 구독 시 만들어 주는 암호화 키. 페이로드를 ECDH로 암호화하는 데 씀 |
| FCM | Firebase Cloud Messaging. 구글의 디바이스 푸시 게이트웨이 (Android + iOS APNs 경유) |
| APNs | Apple Push Notification service. iOS 네이티브 푸시. CareerTuner는 FCM을 통해 우회 |
| 디바이스 토큰 | 기기가 푸시를 받을 주소. WEB은 endpoint URL, FCM/APNS는 토큰 문자열 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- AI 분석은 **수십 초~수 분** 걸리는 비동기 작업이다. 사용자가 화면을 떠나면 "적합도 분석 완료"를 알 길이 없다. 푸시는 앱이 꺼져 있어도 결과를 알린다.
- in-app 알림(종 아이콘)만 있으면 사용자가 다시 들어와야 본다. 재방문 유도(리텐션)가 약하다.
- 채널이 외부 인프라(VAPID 키, Firebase 서비스계정)에 의존하므로, **키가 없는 개발 환경에서 코드가 죽으면** 알림 생성·결제 같은 본 로직까지 같이 망가질 수 있다. 그래서 graceful fallback이 핵심 설계 포인트가 된다.

:::tip 핵심 한 줄
푸시는 **보조(best-effort) 채널**이다. 푸시가 실패해도 in-app 알림과 비즈니스 트랜잭션은 멀쩡해야 한다. 이 원칙이 코드 곳곳의 try/catch와 로깅 폴백으로 드러난다.
:::

## 4. CareerTuner에서 어디에 썼나

전부 백엔드 `com.careertuner.notification` 패키지. 영역 분담상 알림은 공통/플랫폼 영역이며, AI 완료 알림(FIT_ANALYSIS_COMPLETE 등)이 [C 영역 적합도 분석](/glossary/dto)과 직접 연결된다.

| 구성요소 | 파일 | 역할 |
| --- | --- | --- |
| 발송 경계 인터페이스 | `notification/push/PushSender.java` | `send(subscription, title, body, link)` 한 메서드 |
| 채널 라우터(`@Primary`) | `notification/push/DefaultPushSender.java` | 구독 kind로 WEB/FCM 분기, 실패 시 로깅 폴백 |
| Web Push 클라이언트 | `notification/push/VapidWebPushClient.java` | nl.martijndwars + BouncyCastle, VAPID 키 있을 때만 빈 생성 |
| FCM 클라이언트 | `notification/push/FcmPushClient.java` | Firebase Admin SDK, 서비스계정 있을 때만 `isReady()`=true |
| 로깅 폴백 | `notification/push/LoggingPushSender.java` | 발송기 미설정 시 의도만 로그로 |
| 디스패처 | `notification/push/PushDispatcher.java` | 설정 on/off·카테고리 필터 후 기기별 발송 |
| 비동기 트리거 | `event/NotificationPushListener.java` | 트랜잭션 커밋 후 별도 스레드풀에서 발송 |
| 구독 등록 API | `controller/NotificationController.java` | `POST/DELETE /api/notifications/push` |
| 구독 도메인 | `domain/PushSubscription.java` | id, userId, kind, token, p256dh, auth, userAgent |
| 카테고리 매핑 | `push/NotificationCategories.java` | 알림 type → ai_analysis/interview/billing 등 |

의존성(`build.gradle`): `nl.martijndwars:web-push:5.1.1`, `org.bouncycastle:bcprov-jdk15on:1.70`, `com.google.firebase:firebase-admin:9.4.3`.

:::warning 구현 상태
Web Push·FCM 클라이언트, 라우팅, 비동기 발송, 카테고리 필터까지 **구현 완료**. 단, 실제 발송은 **VAPID 키와 Firebase 서비스계정이 주입돼야** 동작한다. 키가 없는 기본 상태에서는 `LoggingPushSender`가 로그만 남기는 폴백으로 동작한다(설계 의도).
:::

## 5. 핵심 동작 원리

### 전체 흐름 (단계)

```text
1. 비즈니스 로직이 알림 insert (DB) + NotificationPushEvent 발행
2. NotificationPushListener (@TransactionalEventListener AFTER_COMMIT, @Async)
   → 트랜잭션 커밋 후, 전용 스레드풀에서 실행
3. PushDispatcher.dispatch()
   → 푸시 on/off 확인, 카테고리 off면 skip, 사용자 기기 목록 조회
4. PushSender(=DefaultPushSender).send() — 기기마다
   → kind=WEB  : VapidWebPushClient (없으면 폴백)
   → kind=FCM/APNS : FcmPushClient (없으면 폴백)
   → 둘 다 안되면 LoggingPushSender
```

### 채널 라우팅 — `DefaultPushSender`

`ObjectProvider`로 클라이언트 빈을 **있으면 쓰고 없으면 폴백**하는 게 골자다.

```java
String kind = subscription.getKind().toUpperCase();
if ("WEB".equals(kind)) {
    VapidWebPushClient client = webPushClient.getIfAvailable(); // 없으면 null
    if (client != null) { client.send(sub, buildPayload(...)); return; }
} else if ("FCM".equals(kind) || "APNS".equals(kind)) {
    FcmPushClient client = fcmPushClient.getIfAvailable();
    if (client != null && client.isReady()) { client.send(...); return; }
}
loggingPushSender.send(subscription, title, body, link); // 폴백
```

### 두 가지 graceful 패턴 — "키가 없어도 안 죽는다"

| 클라이언트 | 빈을 어떻게 막나 | 미설정 시 |
| --- | --- | --- |
| `VapidWebPushClient` | `@ConditionalOnProperty`로 키 없으면 **빈 자체를 안 만듦** | `getIfAvailable()`=null → 폴백 |
| `FcmPushClient` | 빈은 항상 생성, 서비스계정 로드 실패면 내부 `messaging=null` | `isReady()`=false → 폴백 |

같은 "graceful degrade"인데 방법이 다른 이유 — VAPID는 키가 곧 생성자 인자라 없으면 생성 자체가 불가능하니 `@ConditionalOnProperty`로 차단. FCM은 잘못된 파일 경로가 들어와도 컨텍스트가 깨지지 않도록 **생성은 시키되 내부에서 try/catch로 degrade**.

### 채널별 페이로드 차이

- **Web Push**: title/body/url을 JSON으로 직렬화해 **암호화 페이로드**로 전송. 서비스워커가 풀어서 알림 표시.
- **FCM**: `Message.builder()`에 `setNotification()` + `putData("url", ...)`. Android·웹뷰 양쪽이 클릭 시 url로 이동하도록 `AndroidConfig`/`WebpushConfig`에도 url을 심음.

## 6. 면접 답변 3단계

**초간단(1문장)**
"AI 분석이 끝나면 사용자 기기로 알림을 밀어 보내는데, 웹은 Web Push, 앱은 FCM으로 보내고 키가 없으면 로그로만 남겨 본 흐름이 안 끊기게 했습니다."

**기본**
"알림은 보조 채널이라 best-effort로 설계했습니다. 알림을 DB에 저장하고 이벤트를 발행하면, 트랜잭션 커밋 후 비동기 리스너가 디스패처를 호출합니다. 디스패처는 사용자 푸시 설정과 카테고리를 확인하고 기기별로 발송하는데, `DefaultPushSender`가 구독 종류(WEB/FCM)에 맞춰 라우팅합니다. 외부 인프라 키가 없는 환경에서도 죽지 않도록, 발송기가 없으면 `LoggingPushSender`가 발송 의도만 로그로 남깁니다."

**꼬리질문 대응(설계 의도 강조)**
"포인트는 '실패 격리'입니다. 푸시는 결제·분석 같은 본 트랜잭션에 절대 영향을 주면 안 되므로 세 겹으로 막았습니다. (1) AFTER_COMMIT으로 롤백된 알림은 푸시 안 함, (2) @Async 전용 스레드풀로 외부 HTTP가 웹 스레드를 물지 않게, (3) 디스패처와 발송기 모두 예외를 삼킴. 또 VAPID는 `@ConditionalOnProperty`로 빈을 아예 안 만들고, FCM은 빈은 만들되 `isReady()`로 degrade해서, 키 유무가 앱 부팅을 막지 않습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 왜 @TransactionalEventListener의 AFTER_COMMIT을 쓰나요? 그냥 메서드 안에서 바로 발송하면 안 되나요?
알림 insert가 같은 트랜잭션 안에서 롤백될 수 있기 때문입니다. 메서드 내부에서 바로 발송하면, 트랜잭션이 롤백돼 DB엔 알림이 없는데 사용자는 푸시를 받는 "유령 푸시"가 생깁니다. AFTER_COMMIT은 커밋이 확정된 뒤에만 실행되니 이 불일치를 막습니다. 단 트랜잭션 없이 호출된 경로에서는 AFTER_COMMIT이 발화하지 않아 푸시가 유실되므로, `fallbackExecution = true`로 그 경우에도 실행되게 했습니다.
:::

:::details Q. @Async를 안 쓰면 무슨 문제가 생기나요?
푸시는 외부 HTTP 호출이라 느리고 실패할 수 있습니다. 동기로 두면 결제나 분석 같은 호출자의 웹 스레드가 푸시 네트워크 I/O에 묶여 응답이 늦어집니다. `@Async("notificationExecutor")`로 `NotificationAsyncConfig`의 전용 스레드풀에서 돌려, 본 요청 응답과 분리했습니다. 전용 풀을 쓰는 이유는 푸시가 공용 풀을 고갈시켜 다른 비동기 작업을 굶기지 않게 하기 위함입니다.
:::

:::details Q. VAPID와 FCM의 degrade 방식이 다른데 왜죠?
키를 다루는 시점이 다릅니다. VAPID는 공개키/개인키가 생성자 인자라, 키가 없으면 객체 생성 자체가 불가능합니다. 그래서 `@ConditionalOnProperty`로 키가 있을 때만 빈을 만듭니다. FCM은 잘못된 파일 경로가 들어와도 스프링 컨텍스트 부팅을 깨면 안 되므로, 빈은 항상 생성하되 생성자 안에서 서비스계정 로드를 try/catch로 감싸 실패 시 `messaging`을 null로 두고 `isReady()`=false를 반환합니다. 결과는 둘 다 "폴백"으로 같습니다.
:::

:::details Q. p256dh, auth는 뭐고 FCM 토큰과 뭐가 다른가요?
Web Push 구독은 세 조각입니다 — endpoint(어디로 보낼지, token에 저장), p256dh와 auth(페이로드를 ECDH로 암호화할 키). 브라우저가 구독할 때 만들어 서버로 보냅니다. `PushSubscription`에 kind=WEB이면 셋 다 채워집니다. FCM은 디바이스 토큰 하나만 있으면 되고 암호화는 FCM 서버가 처리하므로 p256dh/auth가 비어 있습니다.
:::

:::details Q. 사용자가 알림을 끄면 어디서 걸러지나요?
`PushDispatcher`에서 두 단계로 거릅니다. 먼저 `NotificationPreference.pushEnabled()`가 false면 전체 skip, 그다음 알림 type을 `NotificationCategories.of()`로 카테고리(ai_analysis, interview, billing 등)에 매핑해 그 카테고리가 off면 skip합니다. 이 매핑 기준은 프런트의 notification.ts와 동일하게 맞춰 둬, 서버·클라이언트가 같은 카테고리 체계를 공유합니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "알림 한 건이 DB에 저장된 순간부터 사용자 폰에 뜨기까지"를 5단계로 소리 내어 설명해 보라. 각 단계에서 실패하면 어떻게 격리되는지 한 마디씩 붙여라.
2. "키가 하나도 설정 안 된 로컬 개발 환경에서 이 코드가 어떻게 동작하느냐"는 질문에, `@ConditionalOnProperty`와 `isReady()`라는 단어를 반드시 써서 30초로 답해 보라.

## 퀴즈

<QuizBox question="발송기(VAPID 키·FCM 서비스계정)가 하나도 설정되지 않은 환경에서 푸시 발송을 시도하면 어떻게 되나?" :choices="['예외가 발생해 알림 생성 트랜잭션이 롤백된다','LoggingPushSender가 발송 의도를 로그로만 남기고 흐름은 정상 진행된다','앱 부팅이 실패한다','in-app 알림도 함께 저장되지 않는다']" :answer="1" explanation="키가 없으면 VapidWebPushClient는 빈이 안 만들어지고 FcmPushClient는 isReady()=false라 DefaultPushSender가 LoggingPushSender로 폴백한다. 발송 의도만 로그로 남고 본 흐름은 끊기지 않는다." />

<QuizBox question="NotificationPushListener가 @TransactionalEventListener의 AFTER_COMMIT 단계를 쓰는 가장 큰 이유는?" :choices="['발송 속도를 높이려고','롤백된 알림을 푸시하는 유령 푸시를 막으려고','FCM 토큰을 갱신하려고','암호화 페이로드를 만들려고']" :answer="1" explanation="알림 insert가 롤백될 수 있으므로, 커밋이 확정된 뒤에만 발송해야 DB엔 없는 알림을 푸시하는 불일치를 막는다. 트랜잭션 없는 경로 대비로 fallbackExecution=true도 함께 둔다." />

<QuizBox question="VapidWebPushClient와 FcmPushClient가 모두 외부 키 없이도 앱이 죽지 않게 하지만, degrade 방식이 다른 이유를 설명하라." explanation="VAPID는 공개키/개인키가 생성자 인자라 키가 없으면 객체 생성 자체가 불가능하다. 그래서 @ConditionalOnProperty로 키가 있을 때만 빈을 생성한다. 반면 FcmPushClient는 잘못된 파일 경로가 들어와도 스프링 컨텍스트 부팅을 깨면 안 되므로, 빈은 항상 생성하되 생성자 내부에서 서비스계정 로드를 try/catch로 감싸 실패 시 messaging을 null로 두고 isReady()=false를 반환한다. 두 방식 모두 결과적으로 DefaultPushSender의 로깅 폴백으로 이어진다." />

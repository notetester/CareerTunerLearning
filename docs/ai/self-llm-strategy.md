# 자체 LLM 커리어전략 모델 [영역 C·일부 구현 / 모델은 설계·검증 단계]

> CareerTuner의 적합도 설명을 외부 OpenAI 대신 직접 파인튜닝한 소형 모델로 돌리려는 프로젝트입니다. 백엔드의 폴백 연동 골격과 학습 파이프라인은 실제로 구현했지만, 운영 기본 경로는 아직 OpenAI이고 자체 모델은 학습·검증 단계입니다.

:::warning 정직한 범위 표시 (면접에서 반드시 이렇게 말할 것)
"자체 모델로 전부 돌고 있다"고 말하면 거짓입니다. 정확히는:
- **구현 완료**: 백엔드 연동 골격(`FallbackFitAnalysisAiService`, `CareerAnalysisOssClient`, `OssFitAnalysisAiService`), provider 토글, grounding 가드, 단위 테스트, 학습 파이프라인 스크립트(`ml/career-strategy-llm`).
- **설계·검증 단계**: 학습된 모델을 **운영 기본 경로로 켜는 것**. 기본값은 `provider=openai`, `oss.base-url`은 비어 있어 자체 모델 비활성. 4090 PC 서빙·원격 호출 경로는 미확정.

즉 "스위치는 만들어 뒀지만 아직 OpenAI로 운영 중"이 정확한 한 줄입니다.
:::

## 1. 한 줄 정의

채용 공고와 지원자 프로필을 비교해 **적합도 설명을 생성하는 작업**을, 범용 외부 API(OpenAI) 대신 그 작업만 잘하도록 **직접 파인튜닝한 소형 오픈소스 LLM**으로 대체하려는 영역 C의 AI 자립화 프로젝트.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| 자체 LLM | 외부 API가 아니라 우리가 직접 가중치를 학습·소유·서빙하는 모델 |
| 파인튜닝(Fine-tuning) | 이미 학습된 베이스 모델을 우리 도메인 데이터로 추가 학습해 특화시키는 것 |
| LoRA / QLoRA | 전체 가중치 대신 작은 어댑터 행렬만 학습(메모리·시간 절감). Q=양자화 결합 |
| 베이스 모델 | 출발점이 되는 사전학습 모델. 여기서는 `Qwen2.5-3B-Instruct`(3B 우선, 7B 비교) |
| GGUF | llama.cpp/Ollama가 읽는 양자화 모델 파일 포맷 |
| Ollama | 로컬에서 모델을 OpenAI 호환 `/v1/chat/completions` API로 서빙하는 런타임 |
| 뉴로-심볼릭 | 규칙(symbolic)이 숫자·판단을 계산하고, 신경망(neural)은 설명 텍스트만 쓰는 분업 구조 |
| grounding | 모델이 입력에 없는 사실을 지어내지 않게(환각 방지) 제약하는 것 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

자체 모델을 도입하려는 이유는 명확합니다. 세 가지 모두 면접 답변의 핵심입니다.

| 이유 | OpenAI만 쓸 때의 문제 | 자체 모델로 얻는 것 |
| --- | --- | --- |
| **비용** | 적합도 분석은 요청마다 토큰 과금. 사용량 증가 시 비용 선형 증가 | 학습 1회 후 추론은 자체 GPU에서 무과금에 가깝게 운영 |
| **특화** | 범용 모델이라 한국어 커리어 설명 톤·JSON 스키마가 매번 흔들림 | 우리 출력 계약(`fitSummary`/`strengths`/`risks`...)에 고정 |
| **프라이버시** | 프로필·이력 데이터를 외부로 전송 | 데이터가 우리 인프라 밖으로 안 나감 |
| **증거 가치** | "API 호출만 했다" | "직접 학습해 붙였다"는 포트폴리오 차별점 |

다만 자체 모델은 **불안정**합니다(소형 모델은 같은 입력에도 JSON이 깨지거나 환각). 그래서 단독으로 쓰지 않고 폴백 체인 안에 넣어, 죽으면 OpenAI로 내려가게 설계했습니다. 이 안전망이 "켜 봐도 화면이 안 깨지는" 이유입니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 C)

### 백엔드 — 구현 완료 (현재 코드에 존재, 테스트 통과)

| 파일 | 역할 |
| --- | --- |
| `fitanalysis/ai/FallbackFitAnalysisAiService` | `@Primary` 진입점. **OSS → OpenAI → Mock** 폴백 디스패처 |
| `fitanalysis/ai/OssFitAnalysisAiService` | 자체 모델 기반 적합도(뉴로-심볼릭 조립). 규칙엔진 골격 + 모델 설명 병합 |
| `analysis/ai/provider/CareerAnalysisOssClient` | Ollama OpenAI 호환 호출 클라이언트. 재시도·JSON 보강·금지키 로깅 |
| `analysis/ai/provider/CareerAnalysisAiProviderProperties` | `provider`(openai/oss) 토글 + `oss.*` 설정(model/base-url/max-tokens...) |
| `fitanalysis/ai/prompt/FitAnalysisPromptCatalog` | `FIT_EXPLAIN_SYSTEM_PROMPT`(학습 데이터 system과 동일 = train/serve skew 방지) |
| `fitanalysis/ai/MockFitAnalysisAiService` | 점수·판단을 결정론적으로 계산하는 **규칙엔진**(자체 모델의 입력 + 최종 폴백) |
| `test/.../FallbackFitAnalysisAiServiceTest` | 폴백 4종 시나리오 검증(OSS 사용/실패 폴백/openai 기본/base-url 미설정) |

연동되는 테이블은 기존과 동일: `fit_analysis`(점수·매칭/부족 기술·로드맵·자격증·지원전략), `ai_usage_log`.

### ML 파이프라인 — 구현 완료 (별도 폴더, 학습 자산)

`ml/career-strategy-llm/` 에 시드 생성→합성→검증→필터→조립→LoRA 학습→GGUF 변환→Ollama 서빙까지 스크립트가 있습니다. 모델 alias는 `careertuner-c-career-strategy`(3B=`-3b`, 7B=`-7b`). task는 MVP 1순위 **`C_FIT_EXPLAIN`**(적합도 설명), 이후 `C_STRATEGY`/`C_LEARNING_ROADMAP`/`C_TREND_SUMMARY`는 Phase 2~3 확장.

### 설계·검증 단계 (아직 운영 기본값 아님)

- 운영 기본값은 `provider=openai`, `oss.base-url=""` → **자체 모델 OFF**. 켜려면 환경변수로 base-url 주입.
- 공유 4090 PC 서빙은 **수동 런북**(`reports/00_runbook_4090.md`)으로 검증 중이고, 원격 호출 경로(Tailscale/LAN)는 미확정.
- 학습 데이터(`data/`)는 git 추적 제외, 모델 산출물도 추적 금지.

## 5. 핵심 동작 원리 (표/코드/단계)

### 핵심 설계 ① 뉴로-심볼릭 분업

가장 중요한 설계 결정입니다. **점수와 판단은 모델이 만들지 않습니다.**

| | 규칙엔진(symbolic, `MockFitAnalysisAiService`) | 자체 모델(neural) |
| --- | --- | --- |
| 담당 | `fitScore`, `applyDecision`, matched/missing | 한국어 설명만(`fitSummary`/`strengths`/`risks`...) |
| 위치 | 모델의 **입력** | 모델의 **출력** |
| 성격 | 결정론적·재현 가능 | 확률적·매번 다름 |

이렇게 나눈 이유: 면접관이 "점수를 LLM이 매기면 신뢰할 수 있나?"라고 물으면 → "점수·지원판단은 서버 규칙으로 결정론적으로 계산하고, 모델은 그 결과를 설명만 합니다. 그래서 모델이 흔들려도 점수는 안 바뀝니다." 라고 답할 수 있습니다.

`OssFitAnalysisAiService`는 모델이 `fitScore` 같은 금지키를 출력해도 **화이트리스트(`fitSummary`/`strategyActions`/`learningTaskReasons`)만 읽어** 구조적으로 무시합니다.

### 핵심 설계 ② Fallback 체인 (캐시→규칙엔진→OpenAI→Mock 사상)

```text
요청 → [provider=oss + base-url 설정?]
        ├ 예 → 자체 모델 호출 ── 성공 → 규칙엔진 골격 + 모델 설명 병합 → 응답
        │                    └ 실패/환각 → 폴백 ↓
        └ 아니오(기본) ─────────────→ OpenAI 호출 ── 키 없거나 실패 → Mock(규칙엔진) 폴백 → 응답
```

```java
// FallbackFitAnalysisAiService — 자체 모델이 죽어도 화면은 안 깨진다
if (properties.isOss() && ossClient.available()) {
    try { return ossService.generate(command); }
    catch (RuntimeException ex) { log.warn("OSS 실패 → OpenAI/Mock 폴백"); }
}
return openAiService.generate(command); // 키 없으면 내부에서 Mock 폴백
```

### 핵심 설계 ③ grounding 가드 (환각 방지)

소형 모델은 "부족한 역량을 보유한 것처럼" 서술하는 환각을 일으킵니다. `OssFitAnalysisAiService.groundingViolation()`이 이를 보수적으로 검사합니다.

- 한 문장에 "보유/강점/숙련" 같은 표현이 있고, "부족/없/않" 같은 결핍 표현이 **없을 때만** 위반으로 판정(false-positive 회피).
- 위반 시 `groundingRetries`만큼 재호출, 소진하면 예외 → 폴백.
- 보유 자격증은 missing에서 제외(사실을 말해도 오탐 나는 과도 폴백 방지).

### 소형 모델 방어 (3B는 JSON이 잘 깨진다)

`CareerAnalysisOssClient`가 한 일:
- `response_format=json_object` + `extractJsonSpan()`으로 앞뒤 잡설 제거
- 5xx·네트워크·JSON 깨짐 = 일시적 실패로 보고 선형 백오프 재시도(`maxRetries`)
- `max-tokens` 하한 1024 강제(미만이면 설명 JSON이 truncate → 부팅 시 검증으로 차단)

## 6. 면접 답변 3단계

**초간단 (1문장)**
> 적합도 설명을 외부 API 대신 직접 파인튜닝한 소형 LLM으로 돌리려고, 백엔드 폴백 연동과 학습 파이프라인을 만들었고 현재는 OpenAI로 운영하며 자체 모델을 검증 중입니다.

**기본**
> 영역 C에서 비용·특화·프라이버시 때문에 자체 모델을 도입하려 했습니다. 핵심 설계는 뉴로-심볼릭으로, 점수와 지원판단은 서버 규칙엔진이 결정론적으로 계산하고 모델은 한국어 설명만 생성합니다. 모델은 불안정하니 OSS→OpenAI→Mock 폴백 체인에 넣어 죽어도 화면이 안 깨지게 했습니다. 베이스는 Qwen2.5-3B, LoRA로 학습하고 GGUF로 변환해 Ollama로 서빙합니다.

**꼬리질문 대응**
> 솔직히 말하면 학습된 모델을 운영 기본 경로로 켜는 건 아직 설계·검증 단계입니다. 기본값은 OpenAI이고, 자체 모델을 켜는 스위치(provider=oss + base-url)와 폴백·grounding 가드·테스트까지는 구현했지만 4090 서빙과 원격 호출 경로가 미확정이라 운영 기본값으로는 안 올렸습니다. 즉 안전하게 점진 도입하는 구조를 먼저 만든 것입니다.

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 OpenAI 두고 굳이 자체 모델을 만드나?
비용(추론 무과금화), 특화(우리 JSON 스키마·한국어 톤 고정), 프라이버시(프로필 데이터 외부 미전송) 세 가지입니다. 그리고 "API만 호출했다"가 아니라 "직접 학습해 붙였다"는 포트폴리오 차별점도 큽니다. 다만 성능 1등이 목표가 아니라 자립 가능성 증명이 목표라 소형(3B) 우선입니다.
:::

:::details Q2. 점수를 LLM이 매기면 신뢰할 수 있나?
LLM은 점수를 안 매깁니다. 뉴로-심볼릭 구조로 점수·지원판단(APPLY/COMPLEMENT/HOLD)·매칭/부족 역량은 서버 규칙엔진이 결정론적으로 계산하고, 모델은 그 값을 입력으로 받아 설명 텍스트만 씁니다. 코드도 모델 출력 중 화이트리스트(fitSummary 등)만 읽어서, 모델이 점수 키를 출력해도 무시됩니다.
:::

:::details Q3. 소형 모델이 거짓말(환각)하면?
두 겹으로 막습니다. 첫째 grounding 가드: 부족 역량을 보유한 것처럼 서술하면 재호출하고, 소진 시 폴백합니다. false-positive를 피하려고 "보유" 표현이 있고 결핍 표현이 없을 때만 위반으로 봅니다. 둘째 폴백: 모델이 실패하거나 JSON이 깨지면 OpenAI→Mock으로 자동 전환해 화면은 항상 정상 응답합니다.
:::

:::details Q4. 3B 모델이 JSON을 자꾸 깨뜨릴 텐데?
맞습니다. 그래서 클라이언트(CareerAnalysisOssClient)에서 response_format=json_object를 강제하고, 응답 앞뒤 잡설을 extractJsonSpan으로 잘라내고, 5xx·네트워크·JSON 파싱 실패는 일시적 실패로 보고 선형 백오프 재시도합니다. 또 출력이 길어 잘리는 걸 막으려 max-tokens 하한 1024를 부팅 시 검증으로 강제합니다.
:::

:::details Q5. 그래서 지금 운영에 자체 모델이 켜져 있나? (가장 중요)
아니요. 기본값은 provider=openai이고 oss.base-url이 비어 있어 자체 모델은 비활성입니다. 켜는 스위치·폴백·grounding·단위 테스트·학습 파이프라인까지는 구현했지만, 공유 4090 GPU 서빙과 원격 호출 경로가 미확정이라 운영 기본값으로는 안 올렸습니다. 안전하게 점진 도입할 수 있는 구조를 먼저 만든 단계라고 정직하게 말합니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이 30초로: "자체 모델을 왜 만들었고, 점수는 누가 계산하며, 모델이 죽으면 어떻게 되나?"를 한 호흡에 설명해 보세요.
2. 면접관이 "이거 다 구현된 거 맞아요?"라고 의심할 때, 구현 완료한 부분과 설계·검증 단계인 부분을 **거짓말 없이** 1분 안에 구분해 말해 보세요.

## 퀴즈

<QuizBox question="자체 LLM 커리어전략 모델에서 적합도 점수(fitScore)와 지원판단(applyDecision)을 계산하는 주체는?" :choices="['자체 파인튜닝 모델', '서버 규칙엔진(MockFitAnalysisAiService)', 'OpenAI API', '프론트엔드']" :answer="1" explanation="뉴로-심볼릭 설계로 점수·판단은 규칙엔진이 결정론적으로 계산해 모델에 입력으로 주고, 모델은 한국어 설명만 생성합니다. 모델이 점수 키를 출력해도 화이트리스트 병합으로 무시됩니다." />

<QuizBox question="현재 CareerTuner의 적합도 분석 운영 기본 경로는?" :choices="['자체 파인튜닝 3B 모델', 'OpenAI (provider 기본값 openai, oss 비활성)', 'Mock 전용', '7B 자체 모델']" :answer="1" explanation="기본값은 provider=openai이고 oss.base-url이 비어 있어 자체 모델은 비활성입니다. 자체 모델 연동 골격과 학습 파이프라인은 구현했지만 운영 기본 경로는 아직 OpenAI이며 모델은 검증 단계입니다." />

<QuizBox question="소형 자체 모델을 단독으로 쓰지 않고 OSS→OpenAI→Mock 폴백 체인에 넣은 핵심 이유를 한 문단으로 설명하라." explanation="소형(3B) 모델은 같은 입력에도 JSON이 깨지거나 환각(부족 역량을 보유로 서술)을 일으키는 등 불안정합니다. 단독으로 쓰면 화면이 깨질 위험이 큽니다. 그래서 FallbackFitAnalysisAiService가 자체 모델 실패·환각·JSON 깨짐을 감지하면 OpenAI로, OpenAI 키가 없거나 실패하면 Mock(규칙엔진)으로 자동 전환합니다. 덕분에 자체 모델을 점진적으로 도입하면서도 사용자에게는 항상 정상 응답을 보장할 수 있습니다." />

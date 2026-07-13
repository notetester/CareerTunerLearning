# E 자체 LLM 첨삭

> 첨삭은 Qwen2.5-3B Correction LoRA delivery-s를 실제 provider로 연결했다. `AUTO`는 CareerTuner 자체 모델 → Claude → OpenAI 순서이며, 사용자는 특정 tier부터 시작하도록 선택할 수 있다. 모두 실패하면 원문 복제를 성공으로 가장하지 않고 `AI_UNAVAILABLE`로 끝낸다.

## 왜 첨삭 전용 LoRA인가

면접 답변·자기소개서·이력서·포트폴리오는 문서 종류가 다르지만 입력과 출력 계약은 같다. 원문과 컨텍스트를 받아 다음 다섯 결과를 만든다.

- 개선문
- 요약
- 발견한 문제
- 변경 이유
- 사실 근거가 더 필요한 제안

따라서 유형별 모델 네 개 대신 하나의 첨삭 모델과 `correctionType` 분기를 선택했다. 데이터가 적은 상황에서 모델을 나누면 각 모델의 학습 신호가 더 약해지고 배포·평가 비용도 네 배가 된다.

## 모델 상태

| 항목 | 현재 상태 |
| --- | --- |
| 베이스 | Qwen2.5-3B 계열 |
| 방식 | LoRA/QLoRA SFT와 repair 평가 |
| 서비스 연결 | `SelfLlmCorrectionProvider` |
| AUTO 순서 | CareerTuner → Claude → OpenAI |
| 명시 선택 | 선택한 tier부터 하위 tier로 폴백 |
| 전부 실패 | `AI_UNAVAILABLE`, 저장·과금 없음 |
| Mock | 의도적으로 없음 |

Qwen3-8B 후보 실험도 있지만 최종 delivery와 비교 실험을 구분해야 한다. “E는 8B 모델만 운영한다”거나 “모든 첨삭이 자체 모델을 탄다”고 말하지 않는다.

## 런타임 디스패처

`CorrectionAiClient`가 공급자 선택의 단일 진입점이다.

```text
RequestedAiModel.AUTO
  -> CAREERTUNER
  -> CLAUDE
  -> OPENAI

RequestedAiModel.CLAUDE
  -> CLAUDE
  -> OPENAI
```

명시 `CAREERTUNER`는 전역 self 토글이 꺼져 있어도 endpoint가 설정돼 있으면 자체 모델을 시도한다. 사용자가 특정 모델을 검증하려는 의도를 존중하기 위해서다.

## 자체 모델 검증과 repair

작은 모델은 형식을 어길 수 있으므로 단순 재호출보다 오류 정보를 다음 시도에 전달하는 repair 흐름을 둔다.

1. 자체 모델 응답을 파싱한다.
2. 필수 필드·원문 보존·출력 제한을 검사한다.
3. 잘못된 출력이면 오류와 이전 출력을 repair context로 만든다.
4. 남은 시도와 전체 시간 예산 안에서 다시 호출한다.
5. 네트워크·모델 실패 또는 예산 소진이면 다음 provider로 이동한다.

per-attempt timeout은 남은 전체 시간 예산보다 길어지지 않게 자른다. 재시도가 사용자 요청을 무한히 붙잡지 않도록 하기 위한 경계다.

## warmup

첨삭 페이지 진입 시 `POST /api/corrections/warmup`을 best-effort로 호출한다. 자체 모델 cold start를 사용자 실행 전에 당겨 보지만 warmup 실패가 페이지 자체를 막지는 않는다. 실제 요청은 warmup 진행 중이면 설정한 범위 안에서 기다린 뒤 provider 체인을 수행한다.

## 왜 Mock을 두지 않았나

첨삭은 사실을 재구성하는 생성 작업이다. 규칙 기반 더미가 그럴듯한 성과나 경력을 만들어 성공 응답으로 보이면 사용자에게 더 위험하다. 그래서 모든 실 provider가 실패하면 다음을 지킨다.

- 성공 결과를 저장하지 않는다.
- 크레딧이나 사용권을 차감하지 않는다.
- 사용자는 일시적 이용 불가 오류를 받는다.
- 실패 사용량 로그는 운영 추적을 위해 남긴다.

가용성보다 거짓 성공 방지를 우선한 선택이다.

## 모델 선택 UX

프런트 `ModelPicker`는 `AUTO`, `CAREERTUNER`, `CLAUDE`, `OPENAI`를 제공한다. 기본값은 AUTO지만 사용자가 결과가 마음에 들지 않으면 다른 모델을 선택해 다시 실행할 수 있다.

재시도 시 최초 모델을 기본 선택으로 유지하는 것과 모델 변경을 금지하는 것은 다르다. UI는 선택권을 유지하며, 서버 멱등 계약은 **같은 요청 키**만 replay한다. 다른 모델로 새 결과를 원하면 새로운 실행 요청이 된다.

## 과금과 provider의 독립성

어느 provider를 타더라도 다음 계약은 같다.

- 실행 전 비용 고지와 preflight
- 유효한 payload만 성공으로 인정
- 실제 token usage를 기반으로 차감
- 결과·사용량 로그·과금을 한 트랜잭션에서 확정
- 요청 키 재전송은 기존 결과 replay

provider가 바뀌어도 과금 의미가 바뀌지 않게 모델 계층과 정책 계층을 분리했다.

## 면접 답변

> "E 첨삭은 Qwen2.5-3B LoRA를 학습해 `SelfLlmCorrectionProvider`로 연결했고, AUTO에서 자체 모델·Claude·OpenAI 순서로 폴백합니다. 사용자는 특정 모델부터 시작할 수도 있습니다. 작은 모델의 JSON 오류는 이전 출력과 오류를 넣은 repair 재시도로 교정하되 전체 시간 예산을 넘기지 않습니다. 전 provider 실패 시에는 거짓 개선문을 성공으로 저장하는 Mock을 쓰지 않고 오류로 끝내며 과금하지 않습니다."

## 꼬리질문

### 자체 모델을 왜 항상 강제하지 않습니까?

상시 endpoint 가용성과 품질은 배포 환경마다 다르다. AUTO는 설정된 자체 모델을 우선하되 장애 시 외부 provider로 연속성을 확보하고, 명시 선택은 사용자의 비교 의도를 반영한다.

### Claude를 선택했는데 실패하면 어떻게 됩니까?

선택 tier부터 하위 순서를 적용하므로 OpenAI로 폴백한다. CAREERTUNER로 되돌아가지는 않는다.

### 형식 오류도 바로 다음 provider로 넘깁니까?

자체 tier 안에서 허용된 횟수와 시간 예산 동안 repair를 먼저 시도한다. 복구하지 못하면 다음 tier로 넘어간다.

### 모델이 성과 숫자를 새로 만들면요?

프롬프트의 사실 보존 규칙, 출력 parser와 payload validation을 통과하지 못하게 한다. 근거가 필요한 강화는 개선문이 아니라 suggestion으로 분리한다.

<QuizBox question="현재 CorrectionAiClient의 AUTO 순서는?" :choices="['OpenAI만 호출', 'CareerTuner 자체 모델 → Claude → OpenAI', '규칙 Mock → OpenAI', 'Claude → CareerTuner → Mock']" :answer="1" explanation="DEFAULT_ORDER는 CAREERTUNER, CLAUDE, OPENAI이며 모든 tier 실패 시 AI_UNAVAILABLE로 끝난다." />

<QuizBox question="사용자가 Claude를 명시 선택한 경우로 맞는 것은?" :choices="['항상 자체 모델부터 다시 시작한다', 'Claude부터 시도하고 실패하면 OpenAI로 내려간다', '선택과 관계없이 Mock을 반환한다', '모델 선택은 프런트에만 있고 서버가 무시한다']" :answer="1" explanation="AiProviderChain.startingFrom이 명시 선택 tier부터 하위 tier를 순회한다." />

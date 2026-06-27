# 자체 LLM 파인튜닝 [면접 특화]

> 면접 답변 평가·질문 생성을 **직접 학습한 오픈 모델**로 대체하기 위한 D 영역의 LoRA 파인튜닝 파이프라인. "데이터 수집 → JSONL 추출 → LoRA 학습 → vLLM/Ollama 서빙 → 폴백 체인 연결"까지 골격은 완성됐고, 운영 기본 경로는 여전히 OpenAI다.

:::warning 면접에서 반드시 정직하게 말할 것
"자체 모델을 학습해 면접 평가에 붙이는 **파이프라인 전체**(데이터 적재 → JSONL → LoRA → 서빙 → 폴백 연결점)는 구현돼 있다. 다만 **운영 기본값은 OpenAI**다. 생성 task(질문/모범답안)는 자체 모델 화이트리스트(`OSS_GENERATION_TASKS`)가 **빈 집합**이라 사실상 Claude→OpenAI로 폴백되고, 채점용 자체 모델도 `eval.base-url`이 비면 OpenAI로 폴백된다. 목적은 '성능 1등'이 아니라 **'직접 학습해 서비스에 붙였다는 증거 확보'**(로드맵 5-4)다." — 이 한 단락을 그대로 말할 수 있으면 이 페이지를 이해한 것이다.
:::

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

이 페이지는 다음 질문에 답한다.

- "OpenAI/Claude 잘 쓰면 되는데 **왜 굳이 자체 LLM을 학습**했나?"
- "면접 도메인에서 자체 모델을 학습할 때 **데이터·베이스 모델·학습 기법**을 어떻게 골랐나?"
- "학습한 모델을 **백엔드 어디에 어떻게 연결**했고, 실패하면 어떻게 되나?"
- "지금 **실제로 가동 중인가**, 아니면 골격만 있는가?"

핵심 단위는 한 줄로: **면접 평가/생성 task의 학습 데이터를 `interview_training_sample`에 쌓고 → 관리자가 JSONL로 export → 오픈 모델(Qwen2.5 계열)을 LoRA로 파인튜닝 → vLLM(채점) 또는 Ollama(생성)로 서빙 → `OssAnswerEvaluator`/`OssLlmGateway`가 폴백 체인의 1차 후보로 호출**한다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2.1 왜 자체 모델인가 — 면접 특화의 이유

| 동기 | 설명 |
| --- | --- |
| 증거 확보 | 팀 프로젝트에서 "API만 호출했다"가 아니라 "모델을 직접 학습해 붙였다"는 차별점. `README.md:11` 명시: "목적은 최고 성능이 아니라 우리가 직접 학습해 서비스에 붙였다는 증거 확보다." |
| 비용/과금 | 채점은 매 답변마다 호출된다. 자체 서버 토큰은 과금 미집계(`usage=0`, `OssAnswerEvaluator.usage()`). 대량 채점일수록 OpenAI 대비 비용 우위. |
| 도메인 고정 | 면접 채점은 "기준 모범답안 대비 비교 채점"이라는 **좁고 반복적인 task**. 범용 모델의 추론력 전부가 필요 없다. 소형 모델 + 도메인 데이터로도 형식 안정성을 노릴 수 있다. |
| 데이터 선순환 | 채점할 때마다 `interview_training_sample`에 학습 데이터가 쌓인다(best-effort append). 쓸수록 학습 데이터가 늘어나는 구조. |

### 2.2 왜 면접(D)이 자체 LLM이 가장 활발한 영역인가

D의 채점 task는 **데이터가 가장 많이 쌓이는 task**다(답변마다 1샘플). 반면 질문 생성(QGEN)은 seed당 1샘플이라 데이터가 적다. 그래서 **task별로 자체 모델 교체 진척이 다르다**. 이 비대칭이 D의 핵심 설계 동인이고, 아래 "2축 분리"로 이어진다.

### 2.3 트레이드오프 — 소형 모델의 불안정성

소형(3B) 모델은 같은 입력에도 JSON이 깨지거나 환각(질문 대신 프로필을 뱉음)을 일으킨다. `TRAINING.md:87` 실측: "소형 3B 한계로 가끔 중국어 토큰 누출·JSON 깨짐." 이 위험을 **폴백 체인**으로 흡수한다(아래 4.4). 즉 자체 모델은 "있으면 1차로 쓰고, 깨지면 Claude/OpenAI로 자동 폴백"하는 **점진 도입 전략**으로만 들어간다.

## 3. 어떤 기술로 구현했나 (실제 클래스·파일 근거)

파이프라인은 **두 곳에 나뉘어** 산다. 학습 자산은 `ml/interview-finetune/`(Python), 런타임 연결은 `backend/.../interview/`(Java).

### 3.1 학습 자산 (`ml/interview-finetune/`)

| 파일 | 역할 |
| --- | --- |
| `synth_prompts.py` | task별 system 프롬프트(QGEN/MODEL_ANSWER/EVAL/PROBE/REPORT). **백엔드 `InterviewPromptCatalog`의 미러** — 학습 system = 운영 system 이어야 모델이 런타임에 같게 동작 |
| `briefing.py` | 회사·직무·공고 분석을 면접 브리핑 텍스트로 압축(코드, LLM 아님). 백엔드 `InterviewBriefingAssembler`의 Python 포팅 |
| `assemble_dataset.py` | 합성 워크플로우 raw 결과를 task별 `{"messages":[system,user,assistant]}` JSONL로 조립 |
| `prepare_data.py` | export JSONL을 train/val로 분리(기본 val-ratio 0.1, seed 42) |
| `finetune_lora.py` | **LoRA 파인튜닝 본체** (PEFT + TRL `SFTTrainer`) |
| `merge_and_export.py` | LoRA 어댑터를 베이스에 병합 + tokenizer 저장(GGUF 변환 전단계) |
| `serve_vllm.sh` | vLLM OpenAI 호환 서빙(`--enable-lora`) |

### 3.2 런타임 연결 (`backend/.../interview/`)

| 클래스 | 역할 |
| --- | --- |
| `training/InterviewTrainingService.java` | 관리자 학습 파이프라인: `stats`/`exportJsonl`/`runEvalHarness`/`startFineTune` |
| `service/OssAnswerEvaluator.java` | **채점용** 자체 모델 호출(vLLM/TGI `/v1/chat/completions`). `InterviewAnswerEvaluator` 구현 |
| `service/OssLlmGateway.java` | **생성용** 자체 모델 호출(Ollama 호환). `InterviewLlmGateway` 구현 |
| `service/InterviewEvalProperties.java` | `careertuner.interview.eval.*` 토글(provider/base-url/model/apiKey) |
| `service/FallbackInterviewLlmGateway.java` | 생성 task 폴백 디스패처. `OSS_GENERATION_TASKS` 화이트리스트 보유 |

## 4. 동작 원리 (흐름·표·작은 코드)

### 4.1 전체 파이프라인 (로컬 → GPU → 백엔드)

```text
[백엔드]  채점할 때마다 interview_training_sample 적재
   │  GET /api/admin/interview/training/export?limit=5000  (관리자 토큰)
   ▼
[로컬]   export.jsonl  →  prepare_data.py  →  data/{train,val}.jsonl
   │  (data/ 폴더를 GPU 머신으로 전송: OneDrive/scp/git-lfs)
   ▼
[GPU]    finetune_lora.py  →  out/interview-lora  (LoRA 어댑터)
   │      merge_and_export.py → GGUF 변환(llama.cpp) → Ollama 등록
   ▼
[GPU]    vLLM serve (채점)  /  Ollama serve (생성)  — OpenAI 호환 /v1
   ▼
[백엔드]  eval.provider=oss + eval.base-url 연결 → OssAnswerEvaluator/OssLlmGateway 1차 호출
```

### 4.2 학습 데이터 = JSONL `messages` 포맷 (한 줄 = 한 샘플)

`InterviewTrainingService.toJsonlLine`이 만드는 한 줄은 다음 모양이다(추상화):

```json
{"messages":[
  {"role":"system","content":"<EVALUATION_SYSTEM_PROMPT>"},
  {"role":"user","content":"질문:\n...\n\n지원자 답변:\n..."},
  {"role":"assistant","content":"{\"score\":82,\"feedback\":\"...\",\"improvedAnswer\":\"\"}"}
]}
```

이 포맷의 핵심 두 가지:

- **system은 운영 프롬프트와 동일** — `InterviewPromptCatalog.EVALUATION_SYSTEM_PROMPT`를 그대로 넣는다. 학습 때 본 system과 서빙 때 주입할 system이 같아야 파인튜닝 효과가 런타임에 그대로 산다(`synth_prompts.py` 주석이 "단일 소스"라 명시).
- **OpenAI 파인튜닝과 오픈모델 SFT가 같은 포맷을 공유** — `prepare_data.py` 주석: 이 JSONL은 "OpenAI 파인튜닝뿐 아니라 오픈모델 SFT(LLaMA-Factory/trl)에서도 그대로 쓴다." 즉 데이터 한 벌로 두 경로(OpenAI FT / 자체 LoRA)를 모두 지원한다.

### 4.3 베이스 모델 · LoRA 설정 (실제 코드값)

이 페이지 제목은 "Qwen3-8B/4B"로 표기됐지만, **실제 리포지토리 코드가 쓰는 베이스는 Qwen2.5 계열**이다. 정직하게 코드값으로 정리한다.

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 학습 베이스(4090 경로) | `Qwen/Qwen2.5-3B-Instruct` | `finetune_lora.py:23` `DEFAULT_BASE`, `TRAINING.md:3` |
| 서빙 베이스(vLLM 경로) | `Qwen/Qwen2.5-7B-Instruct` | `serve_vllm.sh:15` `BASE_MODEL` 기본값 |
| 학습 기법 | 4bit(nf4) 양자화 + LoRA | `BitsAndBytesConfig` + `LoraConfig` |
| LoRA rank / alpha | `r=16`, `lora_alpha=32`, dropout 0.05 | `finetune_lora.py:70-77` |
| target_modules | q/k/v/o + gate/up/down_proj | 어텐션+MLP 전부 |
| 하이퍼파라미터 | epochs 3 · batch 1 · grad_accum 8 · lr 2e-4 · max_seq 2048 | `finetune_lora.py:32-36` |
| VRAM | 3B 4bit+LoRA ≈ 6~8GB → RTX 4090 24GB 여유 | `TRAINING.md:40` |

:::tip 왜 3B(학습)와 7B(서빙)가 다른가
README/`serve_vllm.sh`는 7B vLLM 서빙 경로, `TRAINING.md`/`finetune_lora.py`는 **원격 RTX 4090에서 실제로 밟은 3B 경로**(merge→GGUF→Ollama, 2026-06-20 실행 완료)를 적은 것이다. 둘 다 같은 JSONL을 먹고, 같은 `--base-model` 인자로 갈아끼울 수 있게 설계됐다. 면접에서는 "베이스는 Qwen2.5 계열이고, GPU 사정(시간제 임대/공유 4090)에 따라 3B~7B를 바꿔 끼울 수 있게 베이스 모델을 인자화했다"고 답하면 된다.
:::

### 4.4 폴백 연결 — 두 갈래 (2축 분리)

자체 모델은 **생성(전송)**과 **채점(평가)** 두 축에 따로 연결된다. 이 분리가 D 설계의 척추다.

```text
생성 task (질문/꼬리/모범답안/리포트)
  FallbackInterviewLlmGateway
    1) provider=oss + OssLlmGateway.available() + OSS_GENERATION_TASKS.contains(schema)  → Oss(Ollama)
       (현재 OSS_GENERATION_TASKS = Set.of() 빈 집합 → 이 경로 비활성)
    2) Anthropic 키 → Claude(Haiku),  실패 시 → OpenAI
    3) 키 없으면 → OpenAI 직행

채점 task (평가/Critic)
  InterviewEvaluatorProvider
    eval.provider=oss + base-url 설정됨  → OssAnswerEvaluator(vLLM)
    아니면                               → OpenAI
```

두 경로를 **의도적으로 분리**한 이유: `FallbackInterviewLlmGateway:26-28` 주석이 직접 명시한다. "채점(EVAL)·Critic은 이 게이트웨이가 아니라 `InterviewEvaluatorProvider`가 `OssAnswerEvaluator`로 분기하므로 화이트리스트에 넣지 않는다(**이중 경로 방지**)." 생성과 채점은 자체 모델 교체 진척·폴백 정책·과금이 다르기 때문이다.

### 4.5 학습 품질 측정 — LLM-as-judge 평가 하니스

학습한 채점 모델이 "얼마나 사람/기준과 일치하는가"를 정량화하는 장치가 `runEvalHarness`다.

```text
runEvalHarness(sampleSize):
  for 샘플 in 저장된 학습데이터:
    judged = aiClient.judgeAnswerScore(질문, 답변)     # JUDGE 프롬프트로 재채점
    diff = |저장점수 - judged|
    if diff <= AGREEMENT_THRESHOLD(=10): agree++       # 일치로 간주
  → return { evaluated, meanAbsDiff, agreementRate }
```

`AGREEMENT_THRESHOLD=10`: 저장 점수와 재채점이 10점 이내면 일치. **평균 절대오차(meanAbsDiff)와 일치율(agreementRate)**로 채점 품질을 수치화한다(`InterviewTrainingService.java:63-83`). 이게 "우리 채점이 일관적인가"를 면접에서 보일 수 있는 정량 근거다.

### 4.6 OpenAI 파인튜닝 트리거 (또 다른 학습 경로)

`startFineTune`은 **OpenAI 자체 파인튜닝 API**를 쏘는 경로다(자체 GPU LoRA와 별개).

- 최소 `MIN_SAMPLES_FOR_FT=10`개 샘플 필요(미달 시 `INVALID_INPUT`).
- 전체 샘플 → JSONL → `/v1/files` 업로드 → `/v1/fine_tuning/jobs` 생성.
- 기본 base `gpt-4o-mini-2024-07-18`(`DEFAULT_BASE_MODEL`).

즉 **같은 `interview_training_sample` 데이터로 두 갈래 학습이 가능**하다: ① 자체 GPU에서 Qwen LoRA(`ml/interview-finetune/`), ② OpenAI 클라우드 파인튜닝(`startFineTune`). 데이터 포맷이 동일(`messages`)해서 가능한 일이다.

## 5. 구현 상태 — 됨 vs 진행중 (정직 구분)

### 5.1 구현됨 (코드/실행 확인)

- 학습 데이터 적재(채점마다 `interview_training_sample` append).
- 관리자 학습 API 4종: `stats`/`exportJsonl`/`runEvalHarness`/`startFineTune`.
- LoRA 학습 스크립트(`finetune_lora.py`) + 데이터 조립/분할/머지/서빙 스크립트 전부.
- **RTX 4090에서 LoRA 학습→merge→GGUF→Ollama 등록→질문 6개 생성 검증까지 실제 1회 실행 완료**(`TRAINING.md:59,87`, 2026-06-20).
- 백엔드 연결점 2개(`OssAnswerEvaluator`/`OssLlmGateway`)와 토글(`InterviewEvalProperties`) 완비.
- 폴백 체인(자체 실패 시 Claude/OpenAI 자동 전환).

### 5.2 진행중/계획 (정직히)

| 항목 | 현실 |
| --- | --- |
| 생성 자체 모델 가동 | **미가동.** `OSS_GENERATION_TASKS = Set.of()` 빈 집합(`FallbackInterviewLlmGateway:45`). QGEN 학습 데이터가 seed당 1개로 적어 형식 불안정 → 질문/꼬리/모범답안/리포트는 사실상 Claude→OpenAI 폴백 |
| 채점 자체 모델 운영 기본 | **OpenAI.** `InterviewEvalProperties.provider` 기본값 `"openai"`, `base-url` 기본 빈 문자열 → oss 미설정 시 OpenAI 폴백 |
| 완료 기준(로드맵 5-4) | "OpenAI vs 자체 모델 나란히 비교 1장"이 마지막 체크리스트(`README.md:63-68`). 학습/서빙은 됐고 라이브 비교·점진 화이트리스트 편입이 다음 트랙 |
| 베이스 모델 표기 | 제목의 "Qwen3-8B/4B"와 달리 코드 실제값은 **Qwen2.5-3B(학습)/7B(서빙)** |

핵심 한 줄: **"파이프라인은 완성됐고 1회 학습·서빙·검증까지 했다. 운영 기본은 OpenAI이고, 데이터가 충분히 쌓인 task부터 화이트리스트에 넣어 점진 교체한다."**

## 6. 면접 답변 3단계

**1단계(한 줄):** "면접 답변 평가/생성용 오픈 모델(Qwen2.5)을 LoRA로 직접 파인튜닝해 서비스에 붙이는 파이프라인을 만들었고, 운영은 OpenAI 폴백을 유지하며 점진 도입 중입니다."

**2단계(어떻게):** "채점할 때마다 `interview_training_sample`에 `{system, user(질문+답변), assistant(점수·피드백 JSON)}` 형식 데이터를 쌓고, 관리자 API로 JSONL을 export합니다. 그걸 RTX 4090에서 Qwen2.5-3B에 4bit 양자화 + LoRA(r=16)로 학습하고, merge→GGUF→Ollama 또는 vLLM으로 OpenAI 호환 서빙합니다. 백엔드는 `OssAnswerEvaluator`(채점)·`OssLlmGateway`(생성)로 연결하되, 자체 모델이 깨지거나 미서빙이면 Claude/OpenAI로 자동 폴백합니다."

**3단계(왜·트레이드오프):** "소형 모델은 JSON이 깨지고 환각이 나서 단독으로는 위험합니다. 그래서 자체 모델을 폴백 체인의 1차 후보로만 넣고, 학습 데이터가 많아 안정적인 채점 task부터 도입하는 점진 전략을 택했습니다. 목적은 성능 1등이 아니라 '직접 학습해 붙였다'는 검증이고, 품질은 LLM-as-judge 평가 하니스로 정량 측정합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 학습 데이터의 system 메시지를 운영 프롬프트와 똑같이 맞춘 이유는?
파인튜닝은 "이 system 아래에서 이 user면 이 assistant를 내라"를 학습한다. 학습 때 본 system과 서빙 때 주입하는 system이 다르면 모델이 학습한 패턴이 런타임에 발현되지 않는다. 그래서 `synth_prompts.py`가 백엔드 `InterviewPromptCatalog`의 미러이고, JSONL의 system도 `EVALUATION_SYSTEM_PROMPT`를 그대로 넣는다. "프롬프트 단일 소스"가 핵심.
:::

:::details Q2. 왜 7B나 70B가 아니라 3B를 학습했나?
GPU 제약 때문이다. 데스크탑 GPU 확보가 어려워 시간제 임대 또는 공유 RTX 4090을 쓴다. 3B + 4bit + LoRA면 VRAM 6~8GB로 24GB 4090에 여유가 크고, 1천 줄 × 3 epoch가 30분~1시간에 끝난다. 또 면접 채점은 좁고 반복적인 task라 거대 모델의 추론력이 다 필요하지 않다. 베이스는 `--base-model` 인자로 빼서 7B로 갈아끼울 수 있게 했다(`serve_vllm.sh`는 7B 기본).
:::

:::details Q3. 자체 모델이 JSON을 깨뜨리거나 환각을 내면?
두 겹으로 막는다. ① **응답 파싱 방어**: 소형 모델이 JSON 앞뒤에 붙이는 잡설을 `OssLlmGateway.extractJsonSpan`(첫 `{`~마지막 `}`만)으로 잘라낸다(`OssAnswerEvaluator`와 공용). ② **폴백 체인**: 그래도 깨지면 `BusinessException`을 던지고 상위 디스패처가 Claude/OpenAI로 자동 폴백한다. Ollama Modelfile에 `stop "<|im_end|>"`·`temperature 0.2`를 넣어 무한 반복·외국어 토큰 누출도 억제했다(`TRAINING.md:78`).
:::

:::details Q4. 생성(질문)은 왜 아직 자체 모델로 안 돌리나?
데이터 양 비대칭 때문이다. 채점(EVAL)은 답변마다 1샘플씩 쌓여 데이터가 많지만, 질문 생성(QGEN)은 seed당 1샘플이라 적다. 2026-06-20 외부 호출 검증에서 QGEN 자체 모델이 형식 불안정(질문 대신 프로필/환각)을 보였다(`FallbackInterviewLlmGateway:38-44`). 그래서 `OSS_GENERATION_TASKS`를 빈 집합으로 두고 생성은 전부 폴백, QGEN/MODEL_ANSWER 데이터를 seed당 여러 개로 보강·재학습한 뒤 단계적으로 화이트리스트에 넣을 계획이다.
:::

:::details Q5. 자체 GPU LoRA와 OpenAI 파인튜닝(startFineTune)은 뭐가 다른가?
둘 다 같은 `interview_training_sample`·같은 `messages` JSONL을 쓴다. 차이는 학습 위치와 산출물이다. **자체 LoRA**(`ml/interview-finetune/`)는 RTX 4090에서 Qwen2.5에 LoRA 어댑터를 얹어 vLLM/Ollama로 직접 서빙한다(과금 토큰 0). **OpenAI 파인튜닝**(`startFineTune`)은 `/v1/files`+`/v1/fine_tuning/jobs`로 클라우드에 `gpt-4o-mini`를 파인튜닝한다(최소 10샘플). 데이터 포맷을 통일해 두 갈래를 한 데이터로 모두 시도할 수 있게 한 게 설계 포인트다.
:::

:::details Q6. 채점 모델 품질은 어떻게 검증하나?
LLM-as-judge 방식의 `runEvalHarness`로 정량화한다. 저장된 학습 샘플을 JUDGE 프롬프트로 재채점해 저장 점수와의 절대오차를 잰다. 10점 이내면 일치로 보고 평균 절대오차(meanAbsDiff)와 일치율(agreementRate)을 낸다(`AGREEMENT_THRESHOLD=10`). 사람이 일일이 보지 않고도 "우리 채점이 자기 자신과/judge와 얼마나 일관적인가"를 수치로 보일 수 있다.
:::

## 8. 직접 말해보기

아래를 막힘없이 말할 수 있으면 이 페이지를 통과한 것이다.

1. "자체 모델 학습 데이터가 **어디서 어떻게 쌓이고**, JSONL 한 줄이 어떤 모양인지" 1분.
2. "베이스 모델·양자화·LoRA 설정과, 3B와 7B를 둘 다 두는 이유" 1분.
3. "학습한 모델이 **백엔드 어느 클래스 두 개**에 붙고, 실패하면 무슨 일이 일어나는지(폴백 2축)" 1분.
4. "지금 **실제 운영 경로**가 OpenAI인 이유와, 자체 모델로 점진 교체하는 조건(`OSS_GENERATION_TASKS` 화이트리스트)" 1분.

관련 페이지: [팀 공통 자체 LLM 전략](/ai/self-llm-strategy) · [폴백 체인](/ai/fallback) · [구조화 출력](/ai/openai-structured-output) · [면접 영역 개요](/area-d/) · [설정 프로퍼티 토글](/backend/configuration-properties)

## 퀴즈

<QuizBox question="면접 자체 모델 LoRA 파인튜닝의 실제 베이스 모델로 코드에 설정된 것은?" :choices="['Qwen3-8B-Instruct', 'Qwen2.5-3B-Instruct(학습)/7B-Instruct(서빙)', 'Llama-3-70B', 'gpt-4o-mini']" :answer="1" explanation="finetune_lora.py의 DEFAULT_BASE는 Qwen/Qwen2.5-3B-Instruct(4090 학습 경로)이고, serve_vllm.sh의 BASE_MODEL 기본값은 Qwen/Qwen2.5-7B-Instruct(vLLM 서빙 경로)입니다. 베이스는 --base-model 인자로 갈아끼웁니다." />

<QuizBox question="생성 task에서 자체 모델이 현재 사실상 가동되지 않는 직접적 코드 근거는?" :choices="['eval.provider 기본값이 oss라서', 'OSS_GENERATION_TASKS가 빈 집합(Set.of())이라서', 'OpenAI 키가 없어서', 'LoRA 어댑터가 없어서']" :answer="1" explanation="FallbackInterviewLlmGateway의 OSS_GENERATION_TASKS = Set.of()가 빈 집합이라, 자체 모델 1차 분기 조건(화이트리스트 포함)을 어떤 생성 schema도 만족하지 못합니다. QGEN 학습 데이터 부족(seed당 1개)이 명시적 이유이며, 데이터 보강·재학습 후 단계적으로 채울 계획입니다." />

<QuizBox question="채점용 자체 모델(OssAnswerEvaluator)이 JSON이 깨지거나 미서빙일 때 일어나는 일을 한 문장으로 설명하라. (주관식)" explanation="자체 모델 호출이 BusinessException을 던지고(파싱 실패·base-url 미설정 등), 상위 InterviewEvaluatorProvider/오케스트레이터가 OpenAI 채점으로 자동 폴백합니다. 또한 응답 파싱 단계에서 OssLlmGateway.extractJsonSpan으로 잡설을 잘라내 깨진 JSON을 최대한 복구한 뒤, 그래도 안 되면 폴백합니다. 덕분에 자체 모델을 점진 도입해도 사용자에게는 항상 정상 채점이 보장됩니다." />

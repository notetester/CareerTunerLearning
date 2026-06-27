# CareerTuner Learning

CareerTuner 프로젝트에서 **실제로 사용한 기술**을, 면접에서 내 입으로 막힘없이 설명하기 위해 만든 개인 학습 사이트입니다.
[VitePress](https://vitepress.dev) 기반 정적 문서 사이트이고, GitHub Pages로 배포합니다.

> 목표: "써봤어요"가 아니라 **"어디에, 왜, 어떻게 썼고, 무엇이 어려웠는지"** 까지 설명하기.

## 구성

| 영역 | 내용 |
| --- | --- |
| 가이드 | 학습/말하기 전략, 내 코드 기반 기술 지도 |
| 용어집 | API·DTO·트랜잭션·인증/인가 등 기초 용어 (30초 답변용) |
| 백엔드 | Spring Boot · MyBatis · JWT/Security · 검증 · 예외 처리 등 |
| 프론트엔드 | React · Vite · TypeScript · 상태관리 · API 레이어 · Capacitor 등 |
| AI | LLM·프롬프트·RAG·오케스트레이터 + 내 영역 C(적합도/취업경향/대시보드) |
| 인프라 | Gradle/Vite 빌드 · GitHub Actions · Docker · Git 협업 · 테스트 |
| 프로젝트 | 전체 아키텍처 · 내 역할 · 트러블슈팅 · 면접 스토리 |
| 퀴즈 | 영역별 객관식/주관식 자가 점검 |

각 페이지는 `단어 뜻 → 개념 → 왜 필요한가 → 내 코드 위치 → 동작 원리 → 면접 답변 3단계 → 꼬리질문 → 직접 말해보기 → 퀴즈` 순서로 구성됩니다.

## 로컬 실행

```bash
npm install
npm run docs:dev      # http://localhost:5173 (개발 서버)
npm run docs:build    # 정적 사이트 빌드
npm run docs:preview  # 빌드 결과 미리보기
```

Node.js 20 이상 필요.

## 배포 (GitHub Pages)

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`(GitHub Actions)이 빌드 후 Pages에 배포합니다.

최초 1회 GitHub 저장소 설정에서 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 지정해야 합니다.
배포 주소: `https://notetester.github.io/CareerTunerLearning/`

> `docs/.vitepress/config.ts` 의 `base` 값(`/CareerTunerLearning/`)은 저장소 이름과 일치해야 합니다.

## 퀴즈 컴포넌트

마크다운 어디서나 `<QuizBox>` 를 쓸 수 있습니다(전역 등록, `docs/.vitepress/theme/`).

```md
<!-- 객관식 (answer는 0부터 시작하는 인덱스) -->
<QuizBox
  question="REST에서 URI가 주로 표현하는 것은?"
  :choices="['서버의 물리적 위치', '자원', '컴포넌트', 'DB 비밀번호']"
  :answer="1"
  explanation="REST에서 URI는 자원을, HTTP 메서드는 행위를 표현한다."
/>

<!-- 주관식 (정답 보기형) -->
<QuizBox question="DTO를 왜 쓰나요?" explanation="계층 간 데이터 전달과 Entity 비노출을 위해..." />
```

## ⚠️ 공개 저장소 주의

이 저장소는 **공개(public)** 입니다. 실제 비밀번호·API 키·JWT 시크릿·DB 호스트/IP·내부 주소 등 **민감정보는 절대 넣지 않습니다.**
환경값은 `DB_HOST`, `OPENAI_API_KEY` 같은 자리표시자로만 표기하고, 회사 소스는 학습용으로 추상화/축약합니다.

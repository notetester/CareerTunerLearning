import { defineConfig } from 'vitepress'

// GitHub Pages 저장소 이름과 일치해야 한다: https://notetester.github.io/CareerTunerLearning/
export default defineConfig({
  lang: 'ko-KR',
  title: 'CareerTuner Learning',
  description: '내가 만든 CareerTuner 프로젝트의 기술을 면접에서 직접 설명하기 위한 학습 자료',
  base: '/CareerTunerLearning/',
  lastUpdated: true,
  cleanUrls: true,

  // 84개 페이지를 에이전트가 생성하므로 일부 상호 링크가 비어 있을 수 있다. 빌드 실패 대신 경고만.
  ignoreDeadLinks: true,

  head: [
    ['meta', { name: 'theme-color', content: '#5e6ad2' }],
    ['meta', { name: 'og:title', content: 'CareerTuner Learning' }],
    ['meta', { name: 'og:description', content: '프로젝트 기반 기술 면접 학습 자료' }],
  ],

  themeConfig: {
    outline: { level: [2, 3], label: '목차' },
    docFooter: { prev: '이전', next: '다음' },
    darkModeSwitchLabel: '테마',
    sidebarMenuLabel: '메뉴',
    returnToTopLabel: '맨 위로',
    lastUpdatedText: '마지막 수정',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '검색', buttonAriaLabel: '검색' },
          modal: {
            noResultsText: '결과 없음',
            resetButtonTitle: '지우기',
            footer: { selectText: '선택', navigateText: '이동', closeText: '닫기' },
          },
        },
      },
    },

    nav: [
      { text: '홈', link: '/' },
      { text: '학습법', link: '/guide/how-to-study' },
      { text: '용어집', link: '/glossary/' },
      { text: '백엔드', link: '/backend/' },
      { text: '프론트엔드', link: '/frontend/' },
      { text: 'AI', link: '/ai/' },
      { text: '⭐ 영역 C 심화', link: '/area-c/' },
      { text: '인프라', link: '/infra/' },
      { text: '프로젝트', link: '/project/overview' },
      { text: '퀴즈', link: '/quizzes/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '학습 가이드',
          items: [
            { text: '왜 아는데 말이 막히나 (학습법)', link: '/guide/how-to-study' },
            { text: '내 코드 기반 기술 지도', link: '/guide/tech-map' },
          ],
        },
      ],

      '/glossary/': [
        {
          text: '용어집 개요',
          items: [
            { text: '왜 단어부터 잡나', link: '/glossary/' },
          ],
        },
        {
          text: '웹 · API · 통신',
          items: [
            { text: 'API', link: '/glossary/api' },
            { text: 'REST API', link: '/glossary/rest-api' },
            { text: 'HTTP 메서드와 상태코드', link: '/glossary/http-methods' },
            { text: 'JSON', link: '/glossary/json' },
            { text: '직렬화 / 역직렬화', link: '/glossary/serialization' },
            { text: 'Request / Response', link: '/glossary/request-response' },
            { text: '무상태 (Stateless)', link: '/glossary/stateless' },
            { text: 'CORS', link: '/glossary/cors' },
            { text: '프록시 (Proxy)', link: '/glossary/proxy' },
            { text: 'ApiResponse 엔벨로프', link: '/glossary/api-response-envelope' },
          ],
        },
        {
          text: '백엔드 · 자바 / 스프링',
          items: [
            { text: '4계층 구조', link: '/glossary/layered-architecture' },
            { text: '의존성 주입(DI)과 IoC', link: '/glossary/di-ioc' },
            { text: '애너테이션 (@)', link: '/glossary/annotation' },
            { text: '제네릭 (Generic)', link: '/glossary/generic' },
            { text: 'DTO', link: '/glossary/dto' },
            { text: 'Entity / Domain', link: '/glossary/entity-domain' },
            { text: 'ORM과 MyBatis', link: '/glossary/orm-and-mybatis' },
            { text: '트랜잭션', link: '/glossary/transaction' },
            { text: '필터 / 필터체인', link: '/glossary/filter-chain' },
          ],
        },
        {
          text: '인증 · 보안',
          items: [
            { text: '인증 vs 인가', link: '/glossary/auth-authn-authz' },
            { text: '토큰 / 세션 / 쿠키', link: '/glossary/token-session-cookie' },
            { text: 'JWT', link: '/glossary/jwt' },
          ],
        },
        {
          text: '프론트 · 실시간 · 운영',
          items: [
            { text: 'SPA', link: '/glossary/spa' },
            { text: '컴포넌트 / Props / State', link: '/glossary/component-props-state' },
            { text: 'Hook', link: '/glossary/hook' },
            { text: 'SSE (실시간 스트리밍)', link: '/glossary/sse' },
            { text: '동기 / 비동기', link: '/glossary/async-sync' },
            { text: '캐시 / 캐싱', link: '/glossary/cache' },
            { text: '환경변수', link: '/glossary/environment-variable' },
            { text: 'CI / CD', link: '/glossary/ci-cd' },
          ],
        },
      ],

      '/backend/': [
        {
          text: '백엔드 (Spring Boot · MyBatis)',
          items: [
            { text: '개요', link: '/backend/' },
            { text: 'Spring Boot', link: '/backend/spring-boot' },
            { text: 'Spring MVC와 REST 컨트롤러', link: '/backend/spring-mvc-rest' },
            { text: 'MyBatis', link: '/backend/mybatis' },
            { text: 'MySQL 스키마 설계', link: '/backend/mysql-schema' },
            { text: '입력 검증', link: '/backend/validation' },
            { text: '예외 처리', link: '/backend/exception-handling' },
            { text: 'JWT와 Spring Security', link: '/backend/jwt-security' },
            { text: 'OAuth2 소셜 로그인', link: '/backend/oauth2' },
            { text: '비밀번호 해싱 (BCrypt)', link: '/backend/bcrypt-password' },
            { text: '파일/URL 텍스트 추출', link: '/backend/file-text-extraction' },
            { text: '이메일 발송', link: '/backend/mail' },
            { text: '푸시 알림', link: '/backend/push-notification' },
            { text: 'API 문서화 (Swagger)', link: '/backend/openapi-swagger' },
            { text: '설정 관리', link: '/backend/configuration-properties' },
            { text: '로깅', link: '/backend/logging' },
          ],
        },
      ],

      '/frontend/': [
        {
          text: '프론트엔드 (React · Vite)',
          items: [
            { text: '개요', link: '/frontend/' },
            { text: 'React', link: '/frontend/react' },
            { text: 'TypeScript', link: '/frontend/typescript' },
            { text: 'Vite', link: '/frontend/vite' },
            { text: 'Tailwind와 다크모드', link: '/frontend/tailwind-darkmode' },
            { text: '디자인 토큰 / CSS 변수', link: '/frontend/design-tokens' },
            { text: 'React Router', link: '/frontend/react-router' },
            { text: '상태 관리', link: '/frontend/state-management' },
            { text: '커스텀 훅', link: '/frontend/custom-hooks' },
            { text: 'API 레이어와 JWT 리프레시', link: '/frontend/api-layer-jwt-refresh' },
            { text: '컴포넌트 아키텍처', link: '/frontend/component-architecture' },
            { text: '폼 처리 (RHF)', link: '/frontend/react-hook-form' },
            { text: '데이터 시각화 (Recharts)', link: '/frontend/recharts' },
            { text: 'PWA와 서비스워커', link: '/frontend/pwa' },
            { text: '모바일 앱 (Capacitor)', link: '/frontend/capacitor-mobile' },
          ],
        },
      ],

      '/ai/': [
        {
          text: 'AI 기능',
          items: [
            { text: '개요', link: '/ai/' },
            { text: 'LLM과 프롬프트', link: '/ai/llm-and-prompt' },
            { text: '프롬프트 카탈로그 패턴', link: '/ai/prompt-catalog' },
            { text: '구조화된 출력', link: '/ai/openai-structured-output' },
            { text: 'LangChain4j와 Ollama', link: '/ai/langchain4j-ollama' },
            { text: 'RAG와 벡터DB (Qdrant)', link: '/ai/rag-qdrant' },
            { text: '임베딩과 벡터 검색', link: '/ai/embedding' },
            { text: '환각과 그라운딩', link: '/ai/hallucination' },
            { text: 'AI 오케스트레이터', link: '/ai/orchestrator-autoprep' },
            { text: '폴백 체인', link: '/ai/fallback' },
          ],
        },
        {
          text: '내 영역 C',
          items: [
            { text: '적합도 분석', link: '/ai/fit-analysis' },
            { text: '장기 취업경향 분석', link: '/ai/career-trend-analysis' },
            { text: '대시보드 AI 요약', link: '/ai/dashboard-insight' },
            { text: '자체 LLM 전략 (설계)', link: '/ai/self-llm-strategy' },
          ],
        },
        {
          text: '다른 영역도 알기',
          items: [
            { text: '공고 추출 (B)', link: '/ai/job-posting-extraction' },
            { text: '가상 면접 (D/E)', link: '/ai/interview-ai' },
            { text: 'AI 사용량·크레딧', link: '/ai/ai-usage-credit' },
          ],
        },
      ],

      '/area-c/': [
        {
          text: '영역 C 심화 (내 전문 영역)',
          items: [
            { text: '개요 & 설계 철학', link: '/area-c/' },
          ],
        },
        {
          text: '핵심 파이프라인',
          items: [
            { text: '적합도 분석 파이프라인', link: '/area-c/fit-analysis' },
            { text: '점수 산출 규칙엔진', link: '/area-c/score-engine' },
            { text: '부족역량·학습·자격증', link: '/area-c/gap-and-learning' },
            { text: '지원 전략', link: '/area-c/application-strategy' },
          ],
        },
        {
          text: 'AI 설계',
          items: [
            { text: '뉴로-심볼릭 아키텍처', link: '/area-c/neuro-symbolic' },
            { text: '가드레일 & 그라운딩', link: '/area-c/guardrails' },
            { text: '3단 폴백 체인', link: '/area-c/fallback-chain' },
            { text: '구조화 출력', link: '/area-c/structured-output' },
            { text: 'Read-through 캐시', link: '/area-c/caching-fingerprint' },
          ],
        },
        {
          text: '데이터 · 구조',
          items: [
            { text: '장기 취업경향 분석', link: '/area-c/career-trend' },
            { text: '대시보드 AI 요약', link: '/area-c/dashboard-insight' },
            { text: '오케스트레이터 FIT 파트', link: '/area-c/orchestrator-fit' },
            { text: 'C 데이터 모델', link: '/area-c/data-model' },
            { text: 'C 클래스 설계', link: '/area-c/class-design' },
          ],
        },
        {
          text: 'UI · 종합',
          items: [
            { text: 'C 프론트엔드 UI/UX', link: '/area-c/frontend-ui' },
            { text: 'C 관리자 화면', link: '/area-c/admin' },
            { text: '종합 면접 플레이북', link: '/area-c/interview-playbook' },
          ],
        },
      ],

      '/infra/': [
        {
          text: '인프라 / 협업',
          items: [
            { text: '개요', link: '/infra/' },
            { text: 'Gradle 빌드', link: '/infra/gradle' },
            { text: 'npm/Vite 빌드', link: '/infra/vite-npm-build' },
            { text: 'CI/CD (GitHub Actions)', link: '/infra/github-actions' },
            { text: '컨테이너 배포 (Docker)', link: '/infra/docker-compose' },
            { text: 'Git 협업 전략', link: '/infra/git-workflow' },
            { text: '환경변수와 시크릿', link: '/infra/env-and-secrets' },
            { text: '테스트 전략', link: '/infra/testing' },
          ],
        },
      ],

      '/project/': [
        {
          text: '프로젝트 설명 (면접용)',
          items: [
            { text: 'CareerTuner 한눈에', link: '/project/overview' },
            { text: '전체 아키텍처', link: '/project/architecture' },
            { text: '내 역할 — 영역 C', link: '/project/my-role' },
            { text: '자동 스토리보드 파이프라인', link: '/project/storyboard-pipeline' },
            { text: '어려웠던 문제와 해결', link: '/project/troubleshooting' },
            { text: '프로젝트 면접 스토리', link: '/project/interview-story' },
          ],
        },
      ],

      '/quizzes/': [
        {
          text: '퀴즈로 점검',
          items: [
            { text: '퀴즈 모음', link: '/quizzes/' },
            { text: '백엔드 퀴즈', link: '/quizzes/backend' },
            { text: '프론트엔드 퀴즈', link: '/quizzes/frontend' },
            { text: 'AI 퀴즈', link: '/quizzes/ai' },
            { text: '프로젝트 Q&A 점검', link: '/quizzes/project-qna' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notetester/CareerTunerLearning' },
    ],

    footer: {
      message: '개인 면접 대비용 학습 자료 · 민감정보 미포함',
      copyright: 'CareerTuner Learning',
    },
  },
})

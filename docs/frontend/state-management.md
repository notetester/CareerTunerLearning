# 상태 관리 (Context · Zustand)

> 인증처럼 앱 전체가 공유하고 자주 안 바뀌는 상태는 React Context, 그 외 화면 단위로 끌어 쓰는 가벼운 전역 상태는 Zustand로 나눠 관리했고, 컴포넌트 내부에서만 쓰는 값은 useState로 둡니다.

## 1. 한 줄 정의

상태 관리란 화면에 보이는 데이터(로그인 사용자, 알림 목록, 폼 입력값 등)를 **누가 들고 있고 누가 바꿀 수 있는가**를 정하는 규칙이다. CareerTuner는 상태를 세 층으로 나눈다: 컴포넌트 로컬(`useState`) → 전역 인증(React Context) → 가벼운 전역 도메인 상태(Zustand).

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| State (상태) | 시간에 따라 변하고, 변하면 화면이 다시 그려져야 하는 값 |
| Local state | 한 컴포넌트 안에서만 의미가 있는 상태 (`useState`) |
| Global state | 멀리 떨어진 여러 컴포넌트가 함께 봐야 하는 상태 |
| Context | React 내장. 트리 어디서든 값을 꺼내 쓰게 해주는 "전선" |
| Provider | Context 값을 공급하는 래퍼 컴포넌트 (`AuthProvider`) |
| Zustand | 독일어로 "상태". 작고 보일러플레이트 없는 외부 상태 라이브러리 |
| Store | Zustand의 상태 한 덩어리 + 그 상태를 바꾸는 액션 함수들 |
| Prop drilling | 중간 컴포넌트들이 안 쓰는 props를 손에서 손으로 넘기는 안티패턴 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

상태를 한 군데로 모으지 않으면 두 가지 고통이 온다.

- **Prop drilling**: 로그인 사용자 정보를 헤더, 마이페이지, 지원 건 목록이 모두 봐야 하는데, 최상단에서 `useState`로 들고 props로 내려보내면 중간의 레이아웃·라우트 컴포넌트가 자기는 안 쓰는 `user`를 그냥 통과시키느라 시그니처가 더러워진다.
- **동기화 깨짐**: 같은 데이터를 컴포넌트마다 따로 `useState`로 들면, 한 곳에서 "읽음 처리"를 해도 다른 곳은 모른다. 알림 배지 숫자와 알림 목록이 서로 다른 숫자를 보이는 식.

그렇다고 **모든 걸 전역에 올리는 것도 틀렸다.** 모달 열림/닫힘 같은 한 컴포넌트 안 값까지 전역에 올리면 불필요한 리렌더와 결합이 생긴다. 그래서 "이 값을 몇 개의 컴포넌트가 보는가"로 도구를 고른다.

:::tip 한 문장 판단 기준
**그 컴포넌트와 그 자식만** 보면 `useState`, **앱 전체가 항상** 보면 Context, **여러 화면이 가끔** 보면 Zustand.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

> 영역: 프론트엔드 (frontend/). 인증 Context는 공통 영역이라 영역 A 소유, 도메인 store는 각 기능 담당이 소유.

| 도구 | 파일 | 무엇을 담나 | 비고 |
| --- | --- | --- | --- |
| React Context | `app/auth/AuthContext.tsx` | 로그인 사용자(`MeUser`), `isAuthenticated`, login/logout/refreshMe | 앱 전체가 항상 보는 단일 진실 |
| Zustand | `features/notification/hooks/useNotificationStore.ts` | 알림 목록·미읽음 수·필터·폴링 | 배지와 목록이 같은 store 공유 |
| Zustand | `features/interview/tutorial/tutorialStore.ts` | 튜토리얼/데모 모드·단계 | React 밖에서도 `getState()`로 읽음 |
| Zustand | `features/community/hooks/useCommunityStore.ts` | 커뮤니티 화면 상태 | |
| Zustand | `features/support/hooks/useSupportStore.ts` | 고객지원 화면 상태 | |
| `useState` | 거의 모든 컴포넌트 | 로딩/에러/입력값 등 로컬 값 | 폼은 React Hook Form이 대신 관리 |

전역 인증은 **단 하나의 Context**로 통일했다. 토큰 자체는 상태가 아니라 `app/lib/tokenStore.ts`(localStorage)에 저장하고, Context는 "지금 로그인한 사람"이라는 파생 상태만 들고 있다. 컴포넌트는 `useAuth()` 훅 하나로 사용자와 인증 함수를 꺼낸다(예: `InterviewPage`, `HomePage`, `ApplicationListPage`).

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### Context — 공급(Provider) + 소비(useContext)

```tsx
// AuthContext.tsx (축약)
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  // 새로고침 시 저장된 토큰으로 세션 복원
  useEffect(() => {
    refreshMe().finally(() => setLoading(false));
  }, [refreshMe]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
```

핵심 디테일 세 가지:
- `isAuthenticated: !!user`처럼 **파생 값을 Context 안에서 계산**해 소비처가 다시 안 하게 했다.
- `useAuth`에서 `ctx === null`이면 **명시적으로 throw** — Provider 밖에서 잘못 쓰면 바로 터져서 디버깅이 쉽다.
- 인증 함수들은 `useCallback`으로 감싸 참조 안정성을 줬다.

### Zustand — store 하나 = 상태 + 액션

```ts
// useNotificationStore.ts (축약)
export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  filter: "all",
  markAsRead: async (id) => {
    await notificationApi.markAsRead(id);
    set({
      notifications: get().notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n,
      ),
      unreadCount: Math.max(0, get().unreadCount - 1),
    });
  },
  filtered: () => {                   // 파생 셀렉터
    const { notifications, filter } = get();
    return filter === "all" ? notifications : notifications.filter((n) => n.category === filter);
  },
}));
```

- `set`으로 상태를 바꾸고, `get`으로 액션 안에서 현재 상태를 읽는다. **Provider가 필요 없다** — 어느 컴포넌트든 `useNotificationStore()`로 바로 구독한다.
- React 밖에서도 쓸 수 있다: `tutorialStore.ts`는 `useTutorialStore.getState().mode`를 API 레이어(`interviewApi`)에서 호출해 "데모/튜토리얼 중이면 더미 데이터" 분기를 만든다. Context로는 불가능한 패턴.

### Context vs Zustand 한눈 비교

| 항목 | React Context | Zustand |
| --- | --- | --- |
| Provider 래핑 | 필요 | 불필요 |
| 리렌더 범위 | value 바뀌면 구독 트리 전체 | 구독한 슬라이스만(셀렉터로) |
| React 밖 접근 | 안 됨 | `getState()`로 가능 |
| 보일러플레이트 | 중간 | 적음 |
| CareerTuner 용도 | 전역 인증(단일) | 화면별 도메인 상태(다수) |

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(1문장)**: "전역 인증은 React Context로, 그 외 가벼운 전역 상태는 Zustand로, 컴포넌트 안 값은 useState로 나눠 관리했습니다."
- **기본**: "값을 몇 개 컴포넌트가 보느냐로 도구를 정했습니다. 로그인 사용자처럼 앱 전체가 항상 보고 자주 안 바뀌는 건 `AuthContext`/`AuthProvider`로 한 곳에 모아 prop drilling을 없앴고, 알림·튜토리얼처럼 여러 화면이 가끔 공유하는 도메인 상태는 Provider 없이 쓸 수 있고 보일러플레이트가 적은 Zustand store로 뒀습니다. 로딩·입력값 같은 로컬 상태는 useState로 남겼습니다."
- **꼬리질문 대응**: "Redux를 안 쓴 이유는 우리 전역 상태가 store 4개 정도로 작고 비동기 액션이 store 안 함수로 충분해서 Redux의 보일러플레이트가 과했기 때문이고, Zustand는 React 밖(API 레이어)에서도 `getState()`로 읽을 수 있어 더미 데이터 토글 같은 패턴에 유리했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안 (3~5개)

:::details Q. Context의 단점은? 왜 전부 Context로 안 했나?
Context는 value 객체가 바뀌면 그 Context를 구독하는 컴포넌트가 **전부** 리렌더된다. 자주 바뀌는 값을 큰 Context 하나에 다 넣으면 관련 없는 컴포넌트까지 다시 그려진다. 그래서 자주 안 바뀌는 인증만 Context에 두고, 변경이 잦은 도메인 상태는 셀렉터로 필요한 슬라이스만 구독할 수 있는 Zustand로 분리했다.
:::

:::details Q. 왜 Redux 대신 Zustand인가?
전역 상태 규모가 작아(store 4개) Redux의 action type·reducer·dispatch 보일러플레이트가 과했다. Zustand는 `create()` 한 번에 상태와 비동기 액션을 같이 정의하고 Provider도 필요 없다. 또 React 컴포넌트 밖에서 `store.getState()`로 직접 읽을 수 있어, `interviewApi`가 튜토리얼 모드를 확인해 더미를 반환하는 식의 비-React 코드 분기에 적합했다.
:::

:::details Q. 토큰은 상태로 안 두고 왜 localStorage에 뒀나?
토큰은 "렌더링에 직접 반영되는 값"이 아니라 API 호출에 붙는 자격증명이라 새로고침 후에도 살아남아야 한다. 그래서 `app/lib/tokenStore.ts`(localStorage)에 저장하고, Context는 토큰으로 복원한 `user`라는 파생 상태만 들고 있다. 앱 시작 시 `AuthProvider`의 useEffect가 저장된 토큰으로 `/auth/me`를 불러 세션을 복원한다.
:::

:::details Q. useState와 Zustand store는 어떻게 구분해 썼나?
"그 컴포넌트와 자식만 쓰는 값이면 useState, 멀리 떨어진 여러 화면이 같은 값을 봐야 하면 store"로 갈랐다. 알림은 헤더 배지와 알림 페이지가 같은 미읽음 수를 봐야 해서 store로 올렸고, 모달 열림 여부나 폼 입력값은 로컬이라 useState(폼은 React Hook Form)로 뒀다.
:::

:::details Q. Provider 밖에서 useAuth를 쓰면?
`useAuth`가 `useContext` 결과가 null인지 검사해 명시적으로 에러를 던진다. 덕분에 Provider 래핑을 빼먹는 실수가 런타임에 즉시, 분명한 메시지로 드러난다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문 1~2개)

1. "CareerTuner에서 로그인 사용자, 알림 목록, 모달 열림 상태를 각각 어떤 도구로 관리했고 왜 그렇게 나눴는지" 30초 안에 설명해보자.
2. 면접관이 "그거 다 Context로 하면 안 되나요?"라고 물었다고 가정하고, 리렌더 범위와 store 분리 이유를 들어 반박해보자.

## 퀴즈

<QuizBox question="CareerTuner에서 전역 로그인 사용자 상태를 관리하는 도구는?" :choices="['Zustand store', 'React Context (AuthContext/AuthProvider)', 'localStorage 직접 구독', 'Redux Toolkit']" :answer="1" explanation="전역 인증은 app/auth/AuthContext.tsx의 React Context로 관리한다. 토큰 값 자체는 tokenStore(localStorage)에 두고, Context는 파생 상태인 user만 들고 있다." />

<QuizBox question="Context 대신 Zustand를 선택하기에 가장 적합한 상황은?" :choices="['앱 전체가 항상 보고 거의 안 바뀌는 인증 정보', '한 컴포넌트 안에서만 쓰는 모달 열림 여부', '여러 화면이 공유하면서 React 밖 코드에서도 읽어야 하는 도메인 상태', 'props로 한 단계만 내려주면 되는 값']" :answer="2" explanation="Zustand는 Provider 없이 쓰고 getState()로 React 밖에서도 읽을 수 있어, tutorialStore처럼 API 레이어가 모드를 확인하는 패턴에 적합하다. 인증은 Context, 로컬 값은 useState가 맞다." />

<QuizBox question="prop drilling이 무엇이며 CareerTuner는 인증 정보에서 이를 어떻게 피했는지 한 문단으로 설명하라." explanation="prop drilling은 실제로 그 값을 쓰지 않는 중간 컴포넌트들이 props를 손에서 손으로 계속 전달해야 하는 안티패턴이다. CareerTuner는 로그인 사용자를 최상단에서 useState로 들고 내려보내는 대신 AuthProvider로 트리를 감싸고, 필요한 컴포넌트가 useAuth() 훅으로 트리 어디서든 직접 꺼내 쓰게 해서, 중간 레이아웃·라우트 컴포넌트가 user props를 통과시키지 않도록 했다." />

# React — Hook Patterns

Extended hook patterns with citations. Reference from main SKILL.md.
Sources in `references/sources.md`.

---

## Rules of Hooks [16][24]

All hooks must be called at the **top level** of a function component or custom hook —
never inside loops, conditionals, or nested functions. React relies on call order
to associate hook state with the right component. [16]

```tsx
// VIOLATION: Conditional hook — breaks hook order
function UserProfile({ user }: { user: User | null }) {
  if (!user) return <LoginPrompt />;  // BAD: hook called after conditional return
  const [isEditing, setIsEditing] = useState(false);
  return <ProfileEditor user={user} isEditing={isEditing} />;
}

// CORRECT: Hook before conditional
function UserProfile({ user }: { user: User | null }) {
  const [isEditing, setIsEditing] = useState(false);
  if (!user) return <LoginPrompt />;
  return <ProfileEditor user={user} isEditing={isEditing} />;
}
```

---

## Custom Hooks — Extract Reusable Logic [1][16]

Custom hooks encapsulate stateful logic without touching component tree structure.
"A custom hook is just a function that uses other hooks." [1]

```tsx
// CORRECT: Reusable localStorage hook
function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue] as const;
}

// CORRECT: Data fetching hook with loading/error states
interface UseQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

function useQuery<T>(url: string): UseQueryResult<T> {
  const [data, setData] = useState<T>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error>();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch');
      setData(await response.json());
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, isLoading, error, refetch: fetchData };
}
```

---

## useEffect — Synchronization, Not Lifecycle [3][13]

Effects synchronize your component with an external system. They are not lifecycle
methods. "Every time your component renders, React will clean up the effect from
the last render and run the new effect." [3]

```tsx
// CORRECT: Effect with cleanup — always return cleanup function [3]
function WindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const handleResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize); // cleanup
  }, []);
  return <span>{size.width} x {size.height}</span>;
}

// CORRECT: Extract primitive deps to avoid object churn [3]
function UserOrders({ user }: { user: User }) {
  const userId = user.id;          // primitive
  const isActive = user.status === 'active';  // primitive
  useEffect(() => {
    if (isActive) fetchOrders(userId);
  }, [userId, isActive]);  // stable — no new refs
}
```

### Effect Anti-Patterns to Avoid [13]

| Anti-Pattern | Correct Approach | Source |
|-------------|-----------------|--------|
| Derived state computed in effect | Compute during render with `useMemo` | [13] |
| Event handler logic in effect | Move to event handler directly | [13] |
| Missing dependency in `[]` | Include all dependencies; use `useCallback` to stabilize | [3] |
| Object/array literal in deps | Extract primitives or memoize the reference | [3] |
| No cleanup for subscriptions | Always return cleanup from `useEffect` | [3] |

---

## useReducer — Complex State Machines [14]

When state transitions involve multiple sub-values or the next state depends on the
previous, `useReducer` is more predictable than `useState`. [14]

```tsx
type FormAction =
  | { type: 'SET_VALUE'; field: string; value: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_END' }
  | { type: 'RESET' };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_VALUE':
      return { ...state, values: { ...state.values, [action.field]: action.value } };
    case 'SUBMIT_START': return { ...state, isSubmitting: true };
    case 'SUBMIT_END':   return { ...state, isSubmitting: false };
    case 'RESET':        return initialFormState;
    default:             return state;
  }
}
```

---

## Utility Hooks [11][16]

```tsx
// Debounce rapid value changes
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// Track previous value for comparisons
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

// Detect clicks outside an element
function useClickOutside<T extends HTMLElement>(callback: () => void): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) callback();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [callback]);
  return ref;
}

// Responsive logic
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
```

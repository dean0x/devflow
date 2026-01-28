# Extended Hook Patterns

Additional custom hooks for common React patterns.

## Data Fetching Hook

```tsx
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
      const json = await response.json();
      setData(json);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// Usage
function UserList() {
  const { data: users, isLoading, error, refetch } = useQuery<User[]>('/api/users');

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} onRetry={refetch} />;

  return <ul>{users?.map(user => <li key={user.id}>{user.name}</li>)}</ul>;
}
```

## Debounced Value Hook

```tsx
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

// Usage
function SearchInput() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);

  useEffect(() => {
    if (debouncedQuery) {
      searchApi(debouncedQuery);
    }
  }, [debouncedQuery]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
```

## Previous Value Hook

```tsx
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// Usage
function Counter({ count }: { count: number }) {
  const prevCount = usePrevious(count);

  return (
    <div>
      Current: {count}, Previous: {prevCount ?? 'N/A'}
    </div>
  );
}
```

## Toggle Hook

```tsx
function useToggle(initialValue = false): [boolean, () => void] {
  const [value, setValue] = useState(initialValue);
  const toggle = useCallback(() => setValue(v => !v), []);
  return [value, toggle];
}

// Usage
function Modal() {
  const [isOpen, toggleOpen] = useToggle();

  return (
    <>
      <button onClick={toggleOpen}>Toggle Modal</button>
      {isOpen && <ModalContent onClose={toggleOpen} />}
    </>
  );
}
```

## Media Query Hook

```tsx
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// Usage
function ResponsiveComponent() {
  const isMobile = useMediaQuery('(max-width: 768px)');

  return isMobile ? <MobileLayout /> : <DesktopLayout />;
}
```

## Click Outside Hook

```tsx
function useClickOutside<T extends HTMLElement>(
  callback: () => void
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [callback]);

  return ref;
}

// Usage
function Dropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useClickOutside<HTMLDivElement>(() => setIsOpen(false));

  return (
    <div ref={dropdownRef}>
      <button onClick={() => setIsOpen(true)}>Open</button>
      {isOpen && <DropdownMenu />}
    </div>
  );
}
```

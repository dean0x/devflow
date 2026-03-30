# React — Error Handling Patterns

Error boundaries, async error states, and Suspense integration.
Sources in `references/sources.md`.

---

## Error Boundaries [1]

Error boundaries are class components that catch render errors in their subtree. They
cannot catch async errors (use state for those). [1]

```tsx
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }

class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to error reporting service (Sentry, Datadog, etc.)
    console.error('Error caught by boundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

### Resettable Error Boundary

Allow users to recover without a full page reload:

```tsx
class ResettableErrorBoundary extends Component<
  {
    children: React.ReactNode;
    fallback?: (error: Error, reset: () => void) => React.ReactNode;
    onError?: (error: Error, info: ErrorInfo) => void;
  },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError?.(error, info); }
  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback
        ? this.props.fallback(this.state.error, this.reset)
        : <div><h2>Something went wrong</h2><button onClick={this.reset}>Try again</button></div>;
    }
    return this.props.children;
  }
}
```

---

## Scoped Error Boundaries [1]

Isolate failures to feature boundaries — prevent one component's error from crashing
the whole app:

```tsx
function App() {
  return (
    <div>
      <Header />
      <main>
        <ErrorBoundary fallback={<SidebarError />}>
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary fallback={<ContentError />}>
          <MainContent />
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}
```

---

## Async Error Handling [3][13]

Error boundaries do not catch errors in async code. Use state to track async errors:

```tsx
function useAsync<T>(asyncFn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{
    data: T | null; error: Error | null; isLoading: boolean;
  }>({ data: null, error: null, isLoading: false });

  const execute = useCallback(async () => {
    setState({ data: null, error: null, isLoading: true });
    try {
      const result = await asyncFn();
      setState({ data: result, error: null, isLoading: false });
    } catch (error) {
      setState({ data: null, error: error as Error, isLoading: false });
    }
  }, deps);

  return { ...state, execute };
}

// Usage
function DataComponent() {
  const { data, error, isLoading, execute } = useAsync(() => fetchData(), []);
  useEffect(() => { execute(); }, [execute]);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={execute} />;
  return <DataDisplay data={data} />;
}
```

---

## Suspense Integration [1][7]

`Suspense` handles loading states declaratively. Pair with error boundaries for complete
async UI handling:

```tsx
function Dashboard() {
  return (
    <ErrorBoundary fallback={<DashboardError />}>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />  {/* can suspend during data fetch */}
      </Suspense>
    </ErrorBoundary>
  );
}
```

Server Components extend Suspense: a Server Component can `async/await` data directly;
React streams the result to the client, showing the Suspense fallback until ready. [6][7]

---

## Error Fallback Components [1]

```tsx
function ErrorFallback({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="error-fallback">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      {onRetry && <button onClick={onRetry}>Try again</button>}
    </div>
  );
}
```

---

## Common Violations

| Violation | Problem | Fix | Source |
|-----------|---------|-----|--------|
| No error boundary around risky components | One crash kills the full app | Wrap each feature in `<ErrorBoundary>` | [1] |
| `.catch(() => {})` swallows error | User sees broken UI with no feedback | Set error state and display message | [3] |
| Only success state rendered | No loading spinner or error path | Handle `isLoading` + `error` explicitly | [13] |
| Error state not cleared on retry | Old error persists after successful retry | Clear error at start of each async call | [3] |
| Async errors inside error boundary | Error boundary only catches render errors | Use state-based error handling for async | [1][3] |

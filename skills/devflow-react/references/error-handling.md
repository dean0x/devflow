# Error Handling Patterns

Error boundaries and error handling strategies for React applications.

## Error Boundary Class Component

```tsx
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error caught:', error, info);
    // Log to error reporting service
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

// Usage
<ErrorBoundary fallback={<ErrorPage />}>
  <App />
</ErrorBoundary>
```

## Error Boundary with Reset

```tsx
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

class ResettableErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div>
          <h2>Something went wrong</h2>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Usage
<ResettableErrorBoundary
  fallback={(error, reset) => (
    <div>
      <h2>Error: {error.message}</h2>
      <button onClick={reset}>Retry</button>
    </div>
  )}
  onError={(error) => logErrorToService(error)}
>
  <App />
</ResettableErrorBoundary>
```

## Async Error Handling Hook

```tsx
interface UseAsyncState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

function useAsync<T>(
  asyncFn: () => Promise<T>,
  deps: unknown[] = []
): UseAsyncState<T> & { execute: () => Promise<void> } {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });

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
  const { data, error, isLoading, execute } = useAsync(
    () => fetchData(),
    []
  );

  useEffect(() => {
    execute();
  }, [execute]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={execute} />;
  if (!data) return null;

  return <DataDisplay data={data} />;
}
```

## Error Fallback Components

```tsx
interface ErrorFallbackProps {
  error: Error;
  onRetry?: () => void;
}

function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  return (
    <div role="alert" className="error-fallback">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      {onRetry && (
        <button onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

function NetworkErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  const isNetworkError = error.message.includes('network') ||
                         error.message.includes('fetch');

  return (
    <div role="alert" className="network-error">
      <h2>{isNetworkError ? 'Connection Error' : 'Error'}</h2>
      <p>
        {isNetworkError
          ? 'Please check your internet connection'
          : error.message}
      </p>
      {onRetry && (
        <button onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
```

## Scoped Error Boundaries

```tsx
// Wrap individual features to prevent full app crashes
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

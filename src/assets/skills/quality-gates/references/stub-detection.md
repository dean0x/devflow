# Stub Detection Patterns

Placeholder implementations that compile but don't deliver real functionality. Flag as **P0-Functionality** issues.

Cross-reference: `software-design/references/code-smell-violations.md` covers hardcoded data and fake functionality labeling. This file focuses on structural stub patterns.

---

## 1. Component Stubs

Render nothing meaningful or return placeholder markup.

```tsx
// STUB — returns static text, no real rendering
function UserProfile({ userId }: Props) {
  return <div>Name</div>;
}

// REAL — fetches and renders actual data
function UserProfile({ userId }: Props) {
  const user = useUser(userId);
  if (!user) return <Skeleton />;
  return <div><h2>{user.name}</h2><p>{user.email}</p></div>;
}
```

**Patterns to flag:**
- `return null` / `return <></>` in components that should render content
- Empty function bodies (`{}`) for handlers or lifecycle methods
- Components returning only hardcoded strings with no data binding

---

## 2. API / Service Stubs

Functions that exist in signature but throw, return hardcoded values, or do nothing.

```typescript
// STUB — throws instead of implementing
async function createOrder(items: CartItem[]): Promise<Order> {
  throw new Error("TODO: implement");
}

// STUB — hardcoded return, no real logic
async function getUser(id: string): Promise<User> {
  return { id, name: "Test User", email: "test@test.com" };
}

// REAL — actual implementation
async function createOrder(items: CartItem[]): Promise<Result<Order, OrderError>> {
  const validated = validateItems(items);
  if (!validated.ok) return validated;
  const order = await db.orders.create({ items: validated.value });
  await queue.publish("order.created", order);
  return { ok: true, value: order };
}
```

**Patterns to flag:**
- `throw new Error("TODO")` / `throw new Error("Not implemented")`
- Functions returning hardcoded objects (no DB/API/computation)
- `"Not implemented"` strings in response bodies
- Empty async functions (`async function foo() {}`)

---

## 3. Hook / Effect Stubs

State and effects declared but not wired to behavior.

```typescript
// STUB — effect does nothing
useEffect(() => {}, [userId]);

// STUB — state declared, setter never called
const [items, setItems] = useState<Item[]>([]);
// ... setItems never appears in the component

// STUB — custom hook returns static value
function usePermissions(): Permissions {
  return { canEdit: true, canDelete: false };
}

// REAL — custom hook with actual logic
function usePermissions(): Permissions {
  const { user } = useAuth();
  const { data } = useQuery(["permissions", user.role], fetchPermissions);
  return data ?? DEFAULT_PERMISSIONS;
}
```

**Patterns to flag:**
- `useEffect(() => {}, [...])` — empty effect body
- `useState` where the setter is never called in the component
- Custom hooks returning static/hardcoded values
- `useMemo`/`useCallback` wrapping static values

---

## 4. Wiring Gaps

Individual pieces exist but aren't connected to the running application. **Highest-value detection** — these pass compilation and individual tests but the feature doesn't work end-to-end.

```typescript
// GAP — fetch without await (result discarded)
function loadDashboard() {
  fetchMetrics(); // Promise floats, never awaited
  return <Dashboard />;
}

// GAP — state declared but never rendered
const [error, setError] = useState<string | null>(null);
// ... error never appears in JSX

// GAP — handler defined but not bound
function handleSubmit(data: FormData) { /* real logic */ }
// ... <form onSubmit={handleSubmit}> never appears

// GAP — route defined with no-op handler
app.post("/api/orders", (_req, res) => {
  res.status(200).json({ ok: true });
});

// GAP — env var read but unused
const API_KEY = process.env.STRIPE_API_KEY;
// ... API_KEY never passed to any client or fetch call
```

**Patterns to flag:**
- `fetch`/`axios`/API call without `await` or `.then` (result discarded)
- State variable (`useState`, `useRef`) never rendered or read in output
- Event handler defined but not bound to any element/listener
- Route/endpoint registered with empty or no-op handler
- Environment variable or config read but never used downstream
- Import used only in type position but imported as value (in non-type-only import)

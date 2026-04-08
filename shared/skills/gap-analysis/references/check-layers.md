# Gap Analysis Check Layers

Detailed detection checklists and examples for each focus area. Use these patterns to systematically scan design artifacts.

---

## Completeness Checklist

For each requirement or user story, verify:

- [ ] **Testable success condition** — Can you write a test that definitively passes or fails?
  - BAD: "Login should be fast"
  - GOOD: "Login completes in < 2s at p99 under 100 concurrent users"

- [ ] **Failure path specified** — What happens when the operation fails?
  - BAD: "User submits order"
  - GOOD: "User submits order → if payment fails, show error X and preserve cart; if DB fails, show error Y and queue retry"

- [ ] **All actors identified** — Who initiates, who receives, who observes?
  - BAD: "Email sent on registration"
  - GOOD: "System sends welcome email to registered user; admin receives copy if domain is corporate"

- [ ] **Data constraints defined** — Type, size, format, required/optional?
  - BAD: "User provides profile photo"
  - GOOD: "Profile photo: JPEG/PNG, max 5MB, min 100×100px, max 4096×4096px"

- [ ] **Boundary conditions covered** — Empty state, single item, max capacity?
  - BAD: "Show list of items"
  - GOOD: "Show list (empty state: 'No items yet' message; max 1000 shown; pagination at 25)"

---

## Architecture Checklist

For each new component or modification, verify:

- [ ] **Integration contract defined** — How does this connect to existing systems?
  - BAD: "Feature uses the existing auth service"
  - GOOD: "Feature calls `/api/auth/verify` with Bearer token, expects `{userId, roles}` response"

- [ ] **Layer ownership clear** — Which layer owns each responsibility?
  - BAD: "Validate email format in the UI and save to DB"
  - GOOD: "UI: format validation only; API: business rule validation; DB: constraint enforcement"

- [ ] **Schema changes documented** — New tables, columns, indexes, migrations?
  - BAD: "Store user preferences"
  - GOOD: "Add `user_preferences` JSONB column to `users` table; migration #042; index on `user_id`"

- [ ] **State management specified** — Where does state live, how does it change?
  - BAD: "Track order status"
  - GOOD: "Order status: `pending → confirmed → shipped → delivered | cancelled`; state machine in `OrderService`; event sourced"

---

## Security Checklist

For each data flow across a trust boundary, verify:

- [ ] **Authentication specified** — Who must be authenticated?
  - BAD: "API endpoint to get user data"
  - GOOD: "GET /api/users/:id — requires valid JWT; 401 if missing; 403 if requesting other user's data (RBAC: admin can access all)"

- [ ] **Authorization specified** — Who can perform this action?
  - BAD: "Admin can delete users"
  - GOOD: "DELETE /api/users/:id — requires role=admin; cannot delete self; audit log entry required; soft delete only"

- [ ] **Input validation specified** — What inputs are sanitized and how?
  - BAD: "Accept search query from user"
  - GOOD: "Search query: max 256 chars; strip HTML; parameterized query (no interpolation); rate limit 10 req/min"

- [ ] **Secret handling specified** — How are credentials stored and transmitted?
  - BAD: "Store API key for third-party service"
  - GOOD: "API key stored in environment variable `THIRD_PARTY_KEY`; never logged; never returned in API responses; rotated quarterly"

---

## Performance Checklist

For each data access or computation, verify:

- [ ] **Query patterns identified** — Are queries bounded and indexed?
  - BAD: "Get all orders for dashboard"
  - GOOD: "GET /api/dashboard: fetch last 30 days orders for current user; index on `(user_id, created_at)`; max 500 rows; cached 5 min"

- [ ] **Batch vs. loop specified** — Are N items fetched in 1 query or N queries?
  - BAD: "Display user name next to each comment"
  - GOOD: "Fetch all comments first, collect unique user IDs, batch-fetch users in single query: `SELECT * FROM users WHERE id = ANY($1)`"

- [ ] **Async vs. sync specified** — Are slow operations handled asynchronously?
  - BAD: "Send confirmation email after order"
  - GOOD: "Email queued to background job (max 30s delay acceptable); order creation returns immediately; email failure does not fail order"

- [ ] **Cache strategy specified** — What is cached, for how long, invalidated how?
  - BAD: "Product catalog loaded on each request"
  - GOOD: "Product catalog: Redis cache, 10-min TTL, invalidated on admin product update event; stale-while-revalidate pattern"

---

## Consistency Checklist (multi-issue)

Across all issues in the batch, verify:

- [ ] **Same entity, same name** — Is the same concept called the same thing?
  - CONFLICT: Issue A calls it "customer", Issue B calls it "user", Issue C calls it "account"

- [ ] **Compatible interfaces** — Does Issue A's output match Issue B's expected input?
  - CONFLICT: Issue A returns `{ userId: string }`, Issue B expects `{ user_id: number }`

- [ ] **Non-conflicting scope** — Does one issue's "in scope" conflict with another's "out of scope"?
  - CONFLICT: Issue A scope includes "email notifications"; Issue B explicitly excludes "email"

---

## Dependencies Checklist (multi-issue)

Across all issues in the batch, verify:

- [ ] **Implementation order feasible** — Can issues be implemented independently?
  - BLOCKED: Issue B creates a feature that stores data in a table Issue A creates — Issue A must ship first

- [ ] **Shared files identified** — Do multiple issues modify the same files?
  - RISK: Issues A, B, and C all modify `src/models/user.ts` — coordinate to avoid merge conflicts

- [ ] **API contracts stable** — Do any issues change APIs that other issues consume?
  - RISK: Issue A changes the auth token format; Issues B and C assume the old format — need coordinated rollout

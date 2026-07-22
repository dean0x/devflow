# Design Anti-Patterns: Before/After Plan Examples

Concrete before/after plan snippets for each of the 6 anti-patterns. Use these to recognize and correct problems in implementation plans.

---

## 1. N+1 Queries

### Before (Anti-Pattern)
```
Step 4: Display order history page
- Fetch list of orders for user (query: SELECT * FROM orders WHERE user_id = ?)
- For each order, fetch the product name (query: SELECT name FROM products WHERE id = ?)
- For each order, fetch the customer's address (query: SELECT * FROM addresses WHERE id = ?)
- Render order list with product names and addresses
```
Problems: 1 query for orders + N queries for products + N queries for addresses = 1 + 2N total queries.

### After (Corrected)
```
Step 4: Display order history page
- Fetch orders for user with JOIN to products and addresses:
  SELECT o.*, p.name as product_name, a.* 
  FROM orders o
  JOIN products p ON p.id = o.product_id
  JOIN addresses a ON a.id = o.address_id
  WHERE o.user_id = ?
  ORDER BY o.created_at DESC
  LIMIT 50
- Render order list from joined result (1 query total)
```

---

## 2. God Functions

### Before (Anti-Pattern)
```
Step 3: Implement processCheckout() function
- Validate cart items (stock available, prices match)
- Apply discount codes
- Calculate tax based on shipping address
- Charge payment method via Stripe API
- Create order record in database
- Update inventory counts for each item
- Send confirmation email to customer
- Send fulfillment webhook to warehouse
- Log analytics event
- Return order confirmation
```
Problems: 9 responsibilities in 1 function. Untestable in isolation. Any change breaks everything.

### After (Corrected)
```
Step 3: Implement checkout pipeline
- validateCart(cart): verify stock and prices → Result<ValidatedCart, CartError>
- applyDiscounts(cart, codes): → Result<PricedCart, DiscountError>
- calculateTax(cart, address): → Result<TaxedCart, TaxError>
- chargePayment(cart, paymentMethod): Stripe API call → Result<ChargedCart, PaymentError>
- createOrder(chargedCart): DB write → Result<Order, DBError>
- orchestrateCheckout(): calls above in sequence, rolls back on failure

Post-order async (background jobs):
- updateInventory(order): decrement stock counts
- sendConfirmationEmail(order): customer notification
- notifyWarehouse(order): fulfillment webhook
- trackAnalytics(order): analytics event
```

---

## 3. Missing Parallelism

### Before (Anti-Pattern)
```
Step 5: Build user dashboard
- Fetch user profile from DB
- Then fetch recent orders from DB
- Then fetch unread notification count from DB
- Then fetch account balance from billing service
- Then render dashboard with all data
```
Problems: 4 independent operations run sequentially. Total time = T1 + T2 + T3 + T4 instead of max(T1..T4).

### After (Corrected)
```
Step 5: Build user dashboard
- Fetch all data in parallel (no ordering dependency):
  Promise.all([
    fetchUserProfile(userId),         // ~10ms
    fetchRecentOrders(userId, 10),     // ~20ms
    fetchNotificationCount(userId),   // ~5ms
    fetchAccountBalance(userId),      // ~30ms (billing service)
  ])
- Wait for all 4 to complete (total ~30ms, not ~65ms)
- Render dashboard with combined result
- Error handling: if any fetch fails, show partial data with error indicator for failed section
```

---

## 4. Error Handling Gaps

### Before (Anti-Pattern)
```
Step 7: Implement file upload
- Receive multipart file upload from user
- Validate file type and size
- Upload to S3 bucket
- Save file metadata to database
- Return file URL to client
```
Problems: No failure paths. What if S3 is down? What if DB write fails after S3 upload? Orphaned files, data inconsistency.

### After (Corrected)
```
Step 7: Implement file upload
- Receive multipart file upload from user
- Validate file type (JPEG/PNG/PDF only) and size (max 10MB)
  - On validation failure: return 422 with specific error message, no upload attempted
- Upload to S3 bucket
  - On S3 timeout (>30s): return 503, log error, do not write to DB
  - On S3 error: return 502 with "Storage unavailable", log error with request ID
- Save file metadata to database
  - On DB failure after successful S3 upload: 
    - Queue cleanup job to delete orphaned S3 object
    - Return 500, log error with S3 key for manual cleanup if queue fails
- Return 201 with file URL and metadata
- Idempotency: if file with same hash already exists for user, return existing URL (no duplicate upload)
```

---

## 5. Missing Caching

### Before (Anti-Pattern)
```
Step 2: Load application configuration
- On each API request, fetch feature flags from feature-flag service
- On each request, fetch user's role permissions from database
- On each request, fetch supported currencies list from config service
- Process request with loaded configuration
```
Problems: 3 external calls per request. At 1000 req/s = 3000 calls/s to config services. Latency added to every request.

### After (Corrected)
```
Step 2: Load application configuration (cached)
- Feature flags: cached in Redis, TTL 60s, refreshed on change event
  - On cache miss: fetch from feature-flag service, write to Redis
  - Stale-while-revalidate: serve stale if refresh fails (max 300s stale)
- User permissions: cached per user in Redis, TTL 300s, invalidated on role change
  - Cache key: `permissions:{userId}`
  - On role change event: `DEL permissions:{userId}`
- Supported currencies: in-process cache (singleton), TTL 1h, loaded at startup
  - Currencies are static — process-level cache is sufficient
  - Reload on explicit admin action only
- Total added latency: ~0ms for cache hits (>99% of requests)
```

---

## 6. Poor Decomposition

### Before (Anti-Pattern)
```
Step 4: Handle user registration endpoint
- Parse request body
- Check if user is authenticated (if so, return 400)
- Validate email format and uniqueness
- Hash password with bcrypt
- Create user record
- Also send welcome email
- Also create default workspace for user
- Also log registration event for analytics
- Also update user count metric
- Return 201 with user object
```
Problems: HTTP handler contains business logic, side effects, and infrastructure concerns. Untestable without full stack.

### After (Corrected)
```
Step 4: Handle user registration

HTTP Layer (controller):
- Parse and validate request body (email, password format, required fields)
- Return 422 on validation failure with field-level errors
- Call UserService.register(email, password)
- Return 201 with user DTO on success; map domain errors to HTTP codes

Domain Layer (UserService.register):
- Check uniqueness (throws DuplicateEmailError if taken)
- Hash password (bcrypt, cost 12)
- Create User entity
- Persist via UserRepository
- Emit UserRegistered domain event
- Return created User

Event Handlers (async, triggered by UserRegistered event):
- WelcomeEmailHandler: send welcome email
- WorkspaceSetupHandler: create default workspace
- AnalyticsHandler: log registration event
- MetricsHandler: increment user count

Separation: Controller handles HTTP. Service handles business logic. Events handle side effects.
Each layer independently testable.
```

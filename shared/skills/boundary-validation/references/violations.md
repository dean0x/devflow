# Boundary Validation — Violations

Extended examples of validation violations to detect and fix, with citations.

## Manual Validation Anti-Pattern [1]

The core violation: scattering type checks instead of parsing through a schema.
"If you just _check_ a property and then proceed, you've gained nothing — the
type system doesn't know you checked." [1]

```typescript
// VIOLATION: Manual validation — no type proof, easy to miss cases
function createUser(data: any): User {
  if (!data.email || typeof data.email !== 'string') throw new Error('Invalid email');
  if (!data.age || typeof data.age !== 'number' || data.age < 0) throw new Error('Invalid age');
  if (!data.name || data.name.length > 100) throw new Error('Invalid name');
  return { email: data.email, age: data.age, name: data.name };
}
```

**Why this is wrong** [1][5]:
- Scattered validation logic — no single source of truth
- No type inference — `data` is still `any` after checks
- Easy to miss edge cases (NaN, empty strings, overflow)
- Inconsistent error handling (throws vs returns)
- `any` propagates through the entire call chain [21]

---

## Missing API Boundary Validation [3][4][7]

```typescript
// VIOLATION: No validation at API boundary — trusts external data
app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body); // hostile data flows in unchecked
  res.json(user);
});
```

**Security Risk**: HIGH — injection attacks, data corruption, type confusion [4][7]

---

## Trusting External API Responses [2]

```typescript
// VIOLATION: External API response consumed without parsing
async function fetchUserData(userId: string): Promise<UserData> {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  const data = await response.json();
  return data; // no schema validation — crashes if API changes
}
```

**Risk**: Runtime crash on API contract change, silent data corruption [2]

---

## Unvalidated Environment Variables [8]

```typescript
// VIOLATION: Environment variables used without parsing
const config = {
  port: process.env.PORT,           // undefined? string? NaN?
  dbUrl: process.env.DATABASE_URL,  // could be empty or malformed
  apiKey: process.env.API_KEY,      // could be missing entirely
};
```

**Risk**: Subtle runtime failures instead of fail-fast startup crash [8]

---

## SQL Injection via String Interpolation [7][15]

```typescript
// VIOLATION: String interpolation in SQL — CRITICAL injection risk
async function getUserByEmail(email: string): Promise<User> {
  const query = `SELECT * FROM users WHERE email = '${email}'`;
  return db.query(query);
}

// VIOLATION: Input not parsed before parameterized query
async function searchUsers(searchTerm: string): Promise<User[]> {
  return db.query('SELECT * FROM users WHERE name LIKE $1', [`%${searchTerm}%`]);
}
```

**Security Risk**: CRITICAL — SQL injection allows data theft, modification, deletion [7][15]

---

## File Upload Without Validation [4]

```typescript
// VIOLATION: No validation on file upload — trusts everything
app.post('/upload', async (req, res) => {
  const file = req.files.document;
  await file.mv(`./uploads/${file.name}`); // path traversal, arbitrary extension
  res.send('Uploaded');
});
```

**Risks**: Arbitrary file execution, path traversal (`../../etc/passwd`), storage exhaustion, malware [4]

---

## Unvalidated URL/Query Parameters [3][4]

```typescript
// VIOLATION: Path parameters used directly without parsing
app.get('/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id); // could be anything
  res.json(user);
});

// VIOLATION: Query parameters used directly
app.get('/search', async (req, res) => {
  const results = await db.search(req.query.q); // unchecked, could be array or object
  res.json(results);
});
```

**Risks**: NoSQL injection, type coercion attacks, DoS via crafted input [3]

---

## Header Trust Without Verification [4]

```typescript
// VIOLATION: Trusting request headers for identity
app.use((req, res, next) => {
  const userId = req.headers['x-user-id'];
  req.userId = userId; // spoofable — never trust client headers for auth
  next();
});

// VIOLATION: jwt.decode without jwt.verify
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.decode(token); // decode != verify! No signature check
  req.user = decoded;
  next();
});
```

**Risks**: Authentication bypass, privilege escalation [4]

---

## Webhook Without Signature Verification [9]

```typescript
// VIOLATION: Webhook payload trusted without signature check
app.post('/webhook', async (req, res) => {
  const event = req.body;
  await processPaymentEvent(event); // spoofed events accepted
  res.sendStatus(200);
});
```

**Risks**: Spoofed events, unauthorized actions, financial manipulation [9]

---

## GraphQL Without Depth/Input Limits [3]

```typescript
// VIOLATION: No depth limits, no input validation
const schema = buildSchema(`type Query { users(filter: UserFilter): [User] }`);

resolvers.Query.users = (_, { filter }) => {
  return db.users.find(filter); // filter passed directly to DB — injection risk
};
```

**Risks**: Query complexity attacks, nested injection [3]

---

## Stored XSS via Unsanitized Form Data [4]

```typescript
// VIOLATION: User input rendered and stored without sanitization
app.post('/profile', async (req, res) => {
  const bio = req.body.bio;
  await db.users.update({ bio });         // stored XSS
  res.send(`Profile updated: ${bio}`);    // reflected XSS
});
```

**Risks**: Cross-site scripting (XSS) — both stored and reflected [4]

---

## Detection Patterns

When reviewing code, look for these red flags:

| Pattern | Risk | Source |
|---------|------|--------|
| `req.body` without schema validation | HIGH | [3][4] |
| `req.params` used directly | MEDIUM | [3] |
| `req.query` used directly | MEDIUM | [3] |
| `process.env` without validation | MEDIUM | [8] |
| String interpolation in SQL | CRITICAL | [7][15] |
| `JSON.parse` without schema | HIGH | [1] |
| `eval()` or `Function()` with user input | CRITICAL | [7] |
| File operations with user-provided paths | CRITICAL | [4] |
| `jwt.decode` instead of `jwt.verify` | CRITICAL | [4] |
| Missing webhook signature verification | HIGH | [9] |

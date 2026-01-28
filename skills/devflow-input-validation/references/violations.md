# Input Validation Violations

Extended examples of validation violations to detect and fix.

## Manual Validation Anti-Pattern

```typescript
// VIOLATION: Manual validation scatters checks
function createUser(data: any): User {
  if (!data.email || typeof data.email !== 'string') {
    throw new Error('Invalid email');
  }
  if (!data.age || typeof data.age !== 'number' || data.age < 0) {
    throw new Error('Invalid age');
  }
  if (!data.name || data.name.length > 100) {
    throw new Error('Invalid name');
  }
  // ... more manual checks

  return { email: data.email, age: data.age, name: data.name };
}
```

**Problems**:
- Scattered validation logic
- Easy to miss edge cases
- No type inference
- Inconsistent error handling
- Hard to maintain

---

## Missing API Boundary Validation

```typescript
// VIOLATION: No validation at API boundary
app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body); // Trusting external data!
  res.json(user);
});
```

**Security Risk**: HIGH - Injection attacks, data corruption possible

---

## Trusting External API Responses

```typescript
// VIOLATION: Trusting external API response
async function fetchUserData(userId: string): Promise<UserData> {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  const data = await response.json();
  return data; // No validation!
}
```

**Risk**: Application crash if API changes structure, type safety lost

---

## Unvalidated Environment Variables

```typescript
// VIOLATION: Trusting environment variables
const config = {
  port: process.env.PORT,           // Could be undefined or invalid
  dbUrl: process.env.DATABASE_URL,  // No validation
  apiKey: process.env.API_KEY       // Could be empty or malformed
};
```

**Risk**: Runtime crashes, security issues from malformed config

---

## SQL Injection Vulnerabilities

```typescript
// VIOLATION: Direct string interpolation (SQL injection risk)
async function getUserByEmail(email: string): Promise<User> {
  const query = `SELECT * FROM users WHERE email = '${email}'`;
  return db.query(query);
}

// VIOLATION: No input validation before query
async function searchUsers(searchTerm: string): Promise<User[]> {
  return db.query('SELECT * FROM users WHERE name LIKE $1', [`%${searchTerm}%`]);
}
```

**Security Risk**: CRITICAL - SQL injection allows data theft, modification, deletion

---

## File Upload Without Validation

```typescript
// VIOLATION: Accepting any file upload
app.post('/upload', async (req, res) => {
  const file = req.files.document;
  await file.mv(`./uploads/${file.name}`);  // No validation!
  res.send('Uploaded');
});
```

**Risks**:
- Arbitrary file execution
- Path traversal attacks
- Storage exhaustion
- Malware upload

---

## URL Parameter Injection

```typescript
// VIOLATION: Unvalidated path parameters
app.get('/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id);  // No validation!
  res.json(user);
});

// VIOLATION: Unvalidated query parameters
app.get('/search', async (req, res) => {
  const results = await db.search(req.query.q);  // No validation!
  res.json(results);
});
```

**Risks**: NoSQL injection, type coercion attacks, DoS via crafted input

---

## Header-Based Logic Without Validation

```typescript
// VIOLATION: Trusting request headers
app.use((req, res, next) => {
  const userId = req.headers['x-user-id'];
  req.userId = userId;  // No validation!
  next();
});

// VIOLATION: Trusting JWT without proper validation
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.decode(token);  // decode != verify!
  req.user = decoded;
  next();
});
```

**Risks**: Authentication bypass, privilege escalation

---

## Webhook Payload Vulnerabilities

```typescript
// VIOLATION: Trusting webhook payloads
app.post('/webhook', async (req, res) => {
  const event = req.body;
  await processPaymentEvent(event);  // No signature verification!
  res.sendStatus(200);
});
```

**Risks**: Spoofed events, unauthorized actions, data manipulation

---

## GraphQL Input Vulnerabilities

```typescript
// VIOLATION: No depth/complexity limits
const schema = buildSchema(`
  type Query {
    users(filter: UserFilter): [User]
  }
`);

// No validation on nested input
resolvers.Query.users = (_, { filter }) => {
  return db.users.find(filter);  // filter passed directly to DB!
};
```

**Risks**: Query complexity attacks, injection through nested objects

---

## Form Data Without Sanitization

```typescript
// VIOLATION: Rendering user input without sanitization
app.post('/profile', async (req, res) => {
  const bio = req.body.bio;
  await db.users.update({ bio });  // Stored XSS!
  res.send(`Profile updated: ${bio}`);  // Reflected XSS!
});
```

**Risks**: Cross-site scripting (XSS), stored attacks

---

## Detection Patterns

When reviewing code, look for these red flags:

| Pattern | Risk Level |
|---------|------------|
| `req.body` without schema validation | HIGH |
| `req.params` used directly | MEDIUM |
| `req.query` used directly | MEDIUM |
| `process.env` without validation | MEDIUM |
| String interpolation in SQL | CRITICAL |
| `JSON.parse` without schema | HIGH |
| `eval()` or `Function()` with user input | CRITICAL |
| File operations with user-provided paths | CRITICAL |
| `jwt.decode` instead of `jwt.verify` | CRITICAL |
| Missing webhook signature verification | HIGH |

# Extended Injection Patterns

Detailed examples for injection vulnerability detection. See main SKILL.md for core patterns.

## NoSQL Injection

```typescript
// VULNERABLE
const user = await db.users.findOne({ username: req.body.username });
// Attacker sends: { username: { $gt: "" } }

// SECURE
const username = String(req.body.username);  // Coerce to string
const user = await db.users.findOne({ username });
```

**MongoDB-specific risks:**
```typescript
// VULNERABLE: $where operator accepts arbitrary JS
db.users.find({ $where: `this.name === '${userInput}'` });

// VULNERABLE: regex injection
db.users.find({ name: { $regex: userInput } });
// Attacker sends: ".*" (matches everything)

// SECURE: Escape regex special characters
const escaped = userInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
db.users.find({ name: { $regex: escaped } });
```

## Command Injection

```typescript
// VULNERABLE
exec(`ls ${userInput}`);
exec(`convert ${filename} output.png`);
exec(`ping -c 4 ${hostname}`);

// SECURE
execFile('ls', [userInput]);  // Arguments are escaped
spawn('convert', [filename, 'output.png']);

// For complex commands, use arrays:
const args = ['-c', '4', hostname];
spawn('ping', args);
```

**Shell metacharacter risks:**
```typescript
// Dangerous characters: ; | & $ ` ( ) < > \ ' "
// Example attack: userInput = "file.txt; rm -rf /"

// SECURE: Validate input format
const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
if (!hostnamePattern.test(hostname)) {
  throw new Error('Invalid hostname');
}
```

## Path Traversal

```typescript
// VULNERABLE
const file = req.params.filename;
fs.readFile(`./uploads/${file}`);  // Attacker: ../../../etc/passwd

// SECURE
const file = path.basename(req.params.filename);  // Strip directory
const safePath = path.join('./uploads', file);
if (!safePath.startsWith('./uploads/')) {
  throw new Error('Invalid path');
}
fs.readFile(safePath);
```

**Advanced path traversal patterns:**
```typescript
// VULNERABLE: Encoded traversal
// Attacker sends: %2e%2e%2f%2e%2e%2fetc/passwd (URL encoded ../..)
const decoded = decodeURIComponent(req.params.filename);
fs.readFile(`./uploads/${decoded}`);

// VULNERABLE: Double encoding
// Attacker sends: %252e%252e%252f (double-encoded ../)

// SECURE: Normalize and validate
const requestedPath = path.normalize(
  path.join('./uploads', path.basename(req.params.filename))
);
const absoluteUploads = path.resolve('./uploads');
const absoluteRequested = path.resolve(requestedPath);

if (!absoluteRequested.startsWith(absoluteUploads + path.sep)) {
  throw new Error('Path traversal attempt blocked');
}
```

## LDAP Injection

```typescript
// VULNERABLE
const filter = `(uid=${username})`;
ldap.search(baseDN, filter);
// Attacker: username = "admin)(&(password=*)"

// SECURE: Escape LDAP special characters
function escapeLDAP(str: string): string {
  return str.replace(/[\\*()]/g, char => `\\${char.charCodeAt(0).toString(16)}`);
}
const filter = `(uid=${escapeLDAP(username)})`;
```

## Template Injection (SSTI)

```typescript
// VULNERABLE (server-side template injection)
const template = `Hello ${req.body.name}!`;
ejs.render(template);
// Attacker: name = "<%= process.env.SECRET %>"

// SECURE: Never build templates from user input
const template = 'Hello <%= name %>!';
ejs.render(template, { name: req.body.name });
```

## Header Injection

```typescript
// VULNERABLE: CRLF injection
res.setHeader('Location', `/user/${userInput}`);
// Attacker: userInput = "test\r\nSet-Cookie: admin=true"

// SECURE: Validate or encode
const safeInput = encodeURIComponent(userInput);
res.setHeader('Location', `/user/${safeInput}`);
```

## Detection Grep Commands

```bash
# SQL Injection
grep -rn "query.*\${" --include="*.ts" --include="*.js"
grep -rn "query.*+ " --include="*.ts" --include="*.js"
grep -rn "execute.*\`" --include="*.ts" --include="*.js"

# NoSQL Injection
grep -rn "findOne.*req\.\|find.*req\." --include="*.ts" --include="*.js"
grep -rn "\$where" --include="*.ts" --include="*.js"

# Command Injection
grep -rn "exec\s*\(" --include="*.ts" --include="*.js"
grep -rn "spawn.*\`\|execSync.*\`" --include="*.ts" --include="*.js"

# Path Traversal
grep -rn "readFile.*req\.\|readFileSync.*req\." --include="*.ts" --include="*.js"
grep -rn "path\.join.*req\." --include="*.ts" --include="*.js"
```

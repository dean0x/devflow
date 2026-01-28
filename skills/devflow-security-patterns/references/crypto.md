# Extended Cryptography Patterns

Detailed examples for cryptographic vulnerability detection. See main SKILL.md for core patterns.

## Hardcoded Secrets

```typescript
// VULNERABLE
const API_KEY = 'sk-abc123xyz789';
const dbPassword = 'admin123';
const jwtSecret = 'mysecret';

// SECURE
const API_KEY = process.env.API_KEY;
const dbPassword = process.env.DB_PASSWORD;
// Use secret management: AWS Secrets Manager, Vault, etc.
```

**Secret management patterns:**
```typescript
// VULNERABLE: Secrets in config files
const config = {
  database: {
    password: 'prod_password_123'
  },
  api: {
    key: 'sk-live-abcdef123456'
  }
};

// SECURE: Environment variables with validation
import { z } from 'zod';

const SecretsSchema = z.object({
  DB_PASSWORD: z.string().min(20),
  API_KEY: z.string().regex(/^sk-(live|test)-[a-zA-Z0-9]{32}$/),
  JWT_SECRET: z.string().min(64),
  ENCRYPTION_KEY: z.string().length(64) // 32 bytes hex-encoded
});

function loadSecrets(): Result<Secrets, Error> {
  const result = SecretsSchema.safeParse(process.env);
  if (!result.success) {
    return { ok: false, error: new Error('Invalid secrets configuration') };
  }
  return { ok: true, value: result.data };
}
```

**Using secret managers:**
```typescript
// AWS Secrets Manager
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretId: string): Promise<Result<string, Error>> {
  const client = new SecretsManager({ region: 'us-east-1' });

  try {
    const response = await client.getSecretValue({ SecretId: secretId });
    if (!response.SecretString) {
      return { ok: false, error: new Error('Secret not found') };
    }
    return { ok: true, value: response.SecretString };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// HashiCorp Vault
import Vault from 'node-vault';

async function getVaultSecret(path: string): Promise<Result<string, Error>> {
  const vault = Vault({
    endpoint: process.env.VAULT_ADDR,
    token: process.env.VAULT_TOKEN
  });

  try {
    const result = await vault.read(path);
    return { ok: true, value: result.data.value };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

## Weak Cryptography

```typescript
// VULNERABLE
crypto.createHash('md5').update(password);  // MD5 is broken
crypto.createHash('sha1').update(password);  // SHA1 weak for passwords

// SECURE
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);  // Cost factor 12+

import argon2 from 'argon2';
const hash = await argon2.hash(password);  // Preferred
```

**Password hashing best practices:**
```typescript
// SECURE: Argon2id (recommended)
import argon2 from 'argon2';

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,  // 64 MB
    timeCost: 3,        // 3 iterations
    parallelism: 4      // 4 parallel threads
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// SECURE: bcrypt (widely supported)
import bcrypt from 'bcrypt';

async function hashPassword(password: string): Promise<string> {
  const COST_FACTOR = 12; // Minimum for production
  return bcrypt.hash(password, COST_FACTOR);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

**Encryption key derivation:**
```typescript
// VULNERABLE: Using password directly as key
const key = password;
crypto.createCipheriv('aes-256-gcm', key, iv);

// SECURE: Derive key using PBKDF2 or scrypt
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// Usage
const salt = crypto.randomBytes(16);
const key = await deriveKey(password, salt);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
```

## Insecure Random

```typescript
// VULNERABLE
const token = Math.random().toString(36);  // Predictable!
const id = Date.now().toString();
const code = Math.floor(Math.random() * 1000000);

// SECURE
const token = crypto.randomBytes(32).toString('hex');
const id = crypto.randomUUID();
const code = crypto.randomInt(100000, 1000000);
```

**Secure random generation patterns:**
```typescript
// Secure token generation
function generateToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

// Secure numeric code (e.g., 2FA)
function generateOTP(digits: number = 6): string {
  const max = Math.pow(10, digits);
  const min = Math.pow(10, digits - 1);
  return crypto.randomInt(min, max).toString();
}

// Secure API key generation
function generateApiKey(): string {
  const prefix = 'sk';
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const random = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${env}_${random}`;
}

// Secure password reset token
function generateResetToken(): { token: string; hash: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  return { token, hash, expires };
}
```

## Encryption Patterns

```typescript
// VULNERABLE: ECB mode
crypto.createCipheriv('aes-256-ecb', key, null);

// VULNERABLE: No authentication (CBC without HMAC)
crypto.createCipheriv('aes-256-cbc', key, iv);

// SECURE: Authenticated encryption (GCM)
function encrypt(plaintext: string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(data: EncryptedData, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(data.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));

  let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}
```

## Timing Attack Prevention

```typescript
// VULNERABLE: String comparison reveals length
function verifyToken(provided: string, stored: string): boolean {
  return provided === stored; // Early exit reveals info
}

// SECURE: Constant-time comparison
import { timingSafeEqual } from 'crypto';

function verifyToken(provided: string, stored: string): boolean {
  if (provided.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(stored)
  );
}
```

## Detection Grep Commands

```bash
# Hardcoded secrets
grep -rn "password.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "api.key.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "secret.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "sk-\|pk-\|api_" --include="*.ts" --include="*.js"

# Weak crypto
grep -rn "createHash.*md5\|sha1" --include="*.ts" --include="*.js"
grep -rn "DES\|RC4\|Blowfish" --include="*.ts" --include="*.js"
grep -rn "aes-.*-ecb\|aes-.*-cbc" --include="*.ts" --include="*.js"

# Insecure random
grep -rn "Math.random" --include="*.ts" --include="*.js"
grep -rn "Date.now.*id\|Date.now.*token" --include="*.ts" --include="*.js"

# String comparison for secrets
grep -rn "token.*===\|secret.*===\|key.*===" --include="*.ts" --include="*.js"
```

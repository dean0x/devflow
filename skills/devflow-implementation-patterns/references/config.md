# Configuration Patterns

Detailed patterns for environment configuration, feature flags, and secrets management.

## Environment Configuration

```typescript
// Pattern: Define schema -> Load from env -> Validate -> Export frozen
import { z } from 'zod';

const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.coerce.number().min(1).max(100).default(10),

  // External services
  API_KEY: z.string().min(1),
  API_TIMEOUT_MS: z.coerce.number().default(5000),

  // Feature flags
  ENABLE_NEW_FEATURE: z.coerce.boolean().default(false),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Configuration validation failed:');
    for (const error of result.error.errors) {
      console.error(`  ${error.path.join('.')}: ${error.message}`);
    }
    process.exit(1);
  }
  return Object.freeze(result.data);
}

export const config = loadConfig();
```

## Feature Flags

```typescript
// Pattern: Centralized flags with typed access
interface FeatureFlags {
  newCheckoutFlow: boolean;
  betaFeatures: boolean;
  debugMode: boolean;
}

const defaultFlags: FeatureFlags = {
  newCheckoutFlow: false,
  betaFeatures: false,
  debugMode: false,
};

function loadFeatureFlags(): FeatureFlags {
  return {
    newCheckoutFlow: config.ENABLE_NEW_CHECKOUT === true,
    betaFeatures: config.ENABLE_BETA === true,
    debugMode: config.NODE_ENV === 'development',
  };
}

export const features = loadFeatureFlags();

// Usage
if (features.newCheckoutFlow) {
  return newCheckoutProcess(cart);
} else {
  return legacyCheckoutProcess(cart);
}
```

## Runtime Feature Flags

```typescript
// Pattern: Dynamic flags that can change at runtime
interface FeatureFlagService {
  isEnabled(flag: string, context?: FlagContext): Promise<boolean>;
  getVariant(flag: string, context?: FlagContext): Promise<string | null>;
}

interface FlagContext {
  userId?: string;
  region?: string;
  percentile?: number;
}

class FeatureFlagClient implements FeatureFlagService {
  constructor(private source: FlagSource) {}

  async isEnabled(flag: string, context?: FlagContext): Promise<boolean> {
    const flagConfig = await this.source.getFlag(flag);
    if (!flagConfig) return false;

    // Percentage rollout
    if (flagConfig.percentageEnabled !== undefined && context?.percentile) {
      return context.percentile <= flagConfig.percentageEnabled;
    }

    // User targeting
    if (flagConfig.enabledForUsers && context?.userId) {
      return flagConfig.enabledForUsers.includes(context.userId);
    }

    return flagConfig.enabled;
  }

  async getVariant(flag: string, context?: FlagContext): Promise<string | null> {
    const flagConfig = await this.source.getFlag(flag);
    if (!flagConfig?.variants) return null;

    // Consistent hashing for A/B tests
    if (context?.userId) {
      const bucket = hashToPercentile(context.userId);
      for (const variant of flagConfig.variants) {
        if (bucket <= variant.percentile) {
          return variant.name;
        }
      }
    }

    return flagConfig.defaultVariant || null;
  }
}
```

## Multi-Environment Config

```typescript
// Pattern: Base config + environment overrides
interface BaseConfig {
  appName: string;
  version: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

interface EnvironmentConfig extends BaseConfig {
  apiUrl: string;
  database: {
    host: string;
    port: number;
    name: string;
  };
}

const baseConfig: BaseConfig = {
  appName: 'MyApp',
  version: '1.0.0',
  logLevel: 'info',
};

const environmentConfigs: Record<string, Partial<EnvironmentConfig>> = {
  development: {
    logLevel: 'debug',
    apiUrl: 'http://localhost:3000',
    database: { host: 'localhost', port: 5432, name: 'myapp_dev' },
  },
  staging: {
    apiUrl: 'https://staging-api.example.com',
    database: { host: 'staging-db.example.com', port: 5432, name: 'myapp_staging' },
  },
  production: {
    logLevel: 'warn',
    apiUrl: 'https://api.example.com',
    database: { host: 'prod-db.example.com', port: 5432, name: 'myapp' },
  },
};

function getConfig(env: string): EnvironmentConfig {
  const envConfig = environmentConfigs[env];
  if (!envConfig) {
    throw new Error(`Unknown environment: ${env}`);
  }
  return { ...baseConfig, ...envConfig } as EnvironmentConfig;
}

export const config = getConfig(process.env.NODE_ENV || 'development');
```

## Secrets Management

```typescript
// Pattern: Load secrets separately from config
interface Secrets {
  databasePassword: string;
  apiKey: string;
  jwtSecret: string;
}

async function loadSecrets(): Promise<Secrets> {
  // In production, fetch from secret manager
  if (config.NODE_ENV === 'production') {
    return {
      databasePassword: await secretManager.get('db-password'),
      apiKey: await secretManager.get('api-key'),
      jwtSecret: await secretManager.get('jwt-secret'),
    };
  }

  // In development, use environment variables
  const SecretsSchema = z.object({
    DATABASE_PASSWORD: z.string().min(1),
    API_KEY: z.string().min(1),
    JWT_SECRET: z.string().min(32),
  });

  const result = SecretsSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error('Missing required secrets');
  }

  return {
    databasePassword: result.data.DATABASE_PASSWORD,
    apiKey: result.data.API_KEY,
    jwtSecret: result.data.JWT_SECRET,
  };
}
```

## Configuration Validation on Startup

```typescript
// Pattern: Fail fast with clear error messages
async function validateConfiguration(): Promise<void> {
  const errors: string[] = [];

  // Check required services are reachable
  try {
    await db.ping();
  } catch (error) {
    errors.push(`Database connection failed: ${error.message}`);
  }

  try {
    await redis.ping();
  } catch (error) {
    errors.push(`Redis connection failed: ${error.message}`);
  }

  // Validate configuration values
  if (config.PORT < 1 || config.PORT > 65535) {
    errors.push(`Invalid PORT: ${config.PORT}`);
  }

  if (config.NODE_ENV === 'production' && config.logLevel === 'debug') {
    errors.push('Debug logging should not be enabled in production');
  }

  if (errors.length > 0) {
    console.error('Configuration validation failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

// Call on startup
await validateConfiguration();
```

## Build-Time Configuration

```typescript
// Pattern: Inject config at build time
// vite.config.ts or similar
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __API_URL__: JSON.stringify(process.env.VITE_API_URL),
  },
});

// Type declarations
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __API_URL__: string;

// Usage
const appInfo = {
  version: __APP_VERSION__,
  buildTime: __BUILD_TIME__,
  apiUrl: __API_URL__,
};
```

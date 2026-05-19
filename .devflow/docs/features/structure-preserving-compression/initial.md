Structure-Preserving Compression

  This is a code minimization technique that strips implementation details while
   keeping the structure Claude needs to understand your code.

  The Problem

  Sending full file contents wastes tokens on implementation details Claude
  doesn't need:

  // Full file: 500 tokens
  export class UserService {
    private db: Database;
    private cache: Cache;

    constructor(db: Database, cache: Cache) {
      this.db = db;
      this.cache = cache;
    }

    async getUser(id: string): Promise<User> {
      // Check cache first
      const cached = await this.cache.get(`user:${id}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Query database
      const user = await this.db.query(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );

      // Update cache
      await this.cache.set(
        `user:${id}`,
        JSON.stringify(user),
        { ttl: 3600 }
      );

      return user;
    }

    async createUser(data: CreateUserDTO): Promise<User> {
      // Validate input
      if (!data.email || !data.password) {
        throw new Error('Email and password required');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, 10);

      // Insert into database
      const user = await this.db.insert('users', {
        ...data,
        password: hashedPassword,
        created_at: new Date()
      });

      return user;
    }
  }

  Structure-Preserving Compression

  Strip implementation, keep signatures and types:

  // Compressed: ~75 tokens (85% reduction)
  export class UserService {
    private db: Database;
    private cache: Cache;

    constructor(db: Database, cache: Cache) { /* ... */ }

    async getUser(id: string): Promise<User> {
      // Checks cache, queries DB, updates cache
    }

    async createUser(data: CreateUserDTO): Promise<User> {
      // Validates, hashes password, inserts to DB
    }
  }

  What Gets Preserved

  ✅ Keep:
  - Class/function signatures
  - Type definitions
  - Method names and parameters
  - Return types
  - Comments/docstrings
  - Import/export statements
  - Interface definitions

  ❌ Strip:
  - Function bodies
  - Implementation logic
  - Detailed error handling
  - Logging statements
  - Variable assignments within functions

  Language-Specific Examples

  Python (82% reduction):
  # Before: 400 tokens
  class PaymentProcessor:
      def __init__(self, api_key: str, webhook_secret: str):
          self.client = StripeClient(api_key)
          self.webhook_secret = webhook_secret
          self.logger = logging.getLogger(__name__)

      def process_payment(self, amount: int, currency: str, customer_id: str) ->
   PaymentResult:
          """Process a payment using Stripe API"""
          try:
              charge = self.client.charges.create(
                  amount=amount,
                  currency=currency,
                  customer=customer_id,
                  description=f"Payment for {customer_id}"
              )
              self.logger.info(f"Payment processed: {charge.id}")
              return PaymentResult(success=True, charge_id=charge.id)
          except StripeError as e:
              self.logger.error(f"Payment failed: {str(e)}")
              return PaymentResult(success=False, error=str(e))

  # After: 72 tokens
  class PaymentProcessor:
      def __init__(self, api_key: str, webhook_secret: str): ...

      def process_payment(self, amount: int, currency: str, customer_id: str) ->
   PaymentResult:
          """Process a payment using Stripe API"""
          ...

  JSON/Config (71% reduction):
  // Before: 1000 tokens
  {
    "dependencies": {
      "express": "^4.18.2",
      "react": "^18.2.0",
      "typescript": "^5.0.0",
      // ... 50 more dependencies
    },
    "devDependencies": {
      "jest": "^29.5.0",
      // ... 30 more
    }
  }

  // After: 290 tokens
  {
    "dependencies": { /* 50 entries */ },
    "devDependencies": { /* 30 entries */ }
  }

  How to Implement

  Option 1: Preprocessing script
  # Create compressed versions of files before sending to Claude
  strip-implementations src/**/*.ts > .compressed/

  Option 2: In DevFlow commands
  Add compression step before sub-agent invocation:

  ### Step 1.5: Compress Context

  Before launching sub-agents, create compressed versions of changed files:

  ```bash
  # For each changed file, create structure-only version
  for file in $(git diff --name-only HEAD); do
    case "$file" in
      *.ts|*.js)
        # Keep imports, types, signatures; strip bodies
        ;;
      *.py)
        # Keep class/function defs; replace bodies with ...
        ;;
    esac
  done

  Option 3: Tool/Library
  The research mentioned a VS Code extension called "cline-token-manager" that
  does this automatically:
  - 76% average token reduction
  - No quality degradation
  - Real-time token tracking

  When to Use Structure-Preserving Compression

  Good for:
  - ✅ Architecture audits (only need structure, not implementation)
  - ✅ Security pattern scanning (looking for anti-patterns, not logic)
  - ✅ Dependency analysis (imports/exports matter, not code)
  - ✅ Large codebases where context is limited

  Bad for:
  - ❌ Debugging (need actual implementation to find bugs)
  - ❌ Performance optimization (need to see actual algorithm)
  - ❌ Code generation (need examples of implementation)
  - ❌ Refactoring (need to understand current implementation)

  DevFlow Application

  You could add an optional compression mode to your audit commands:

  ---
  description: Architecture audit with optional compression
  allowed-tools: Task, Bash, Read, Grep, Glob
  ---

  ## Your Task

  ### Optional: Compress Context

  If analyzing large codebase (>100 files changed), enable compression:

  ```bash
  COMPRESS=true  # Set to false for detailed analysis

  If COMPRESS=true:
  - Extract signatures only from source files
  - Keep full content for config files
  - Preserve test file names but strip test bodies

  This would be particularly useful for `/pre-pr` when reviewing large feature
  branches.
# QA Skill — Scenario Templates

Ready-to-adapt templates for common feature types.

## Template 1: CLI Command

```
Feature: New CLI command `devflow foo --bar`

S1 (happy):     Run `devflow foo --bar value` → expected output, exit 0
S2 (happy):     Run `devflow foo` with defaults → sensible default behavior
S3 (boundary):  Run `devflow foo --bar ""` → validation error, exit 1
S4 (boundary):  Run `devflow foo --bar` (missing value) → usage help, exit 1
S5 (negative):  Run `devflow foo --unknown` → "unknown flag" error, exit 1
S6 (negative):  Run in directory without required config → helpful error message
S7 (regression): Existing commands still work unchanged
```

## Template 2: API Endpoint

```
Feature: POST /api/widgets

S1 (happy):      Valid body → 201, widget in response, persisted in DB
S2 (happy):      Minimal valid body → 201, defaults applied
S3 (boundary):   Body at max allowed size → 201 or 413
S4 (boundary):   Empty required field → 400 with field-specific error
S5 (negative):   No auth header → 401
S6 (negative):   Invalid JSON body → 400
S7 (negative):   Duplicate unique field → 409
S8 (integration): Created widget appears in GET /api/widgets
```

## Template 3: Configuration Change

```
Feature: New config option `maxRetries` in config.json

S1 (happy):     Set maxRetries=3 → system retries 3 times on failure
S2 (boundary):  Set maxRetries=0 → no retries (immediate fail)
S3 (boundary):  Set maxRetries=100 → accepted (or capped with warning)
S4 (negative):  Set maxRetries=-1 → validation error on startup
S5 (negative):  Omit maxRetries → sensible default applied
S6 (negative):  Set maxRetries="abc" → type error on startup
S7 (regression): Existing config options still work with new option added
```

## Template 4: File Processing

```
Feature: Import CSV data

S1 (happy):      Valid CSV with 10 rows → 10 records imported
S2 (happy):      CSV with headers → headers correctly mapped
S3 (boundary):   Empty CSV (headers only) → 0 records, no error
S4 (boundary):   Large CSV (10K rows) → all imported within timeout
S5 (negative):   Malformed CSV (unmatched quotes) → error with line number
S6 (negative):   Missing required column → error naming the column
S7 (negative):   File not found → clear error message
S8 (integration): Imported records queryable via existing API
```

## Template 5: Refactoring / Internal Change

```
Feature: Refactored auth middleware (no behavior change intended)

S1 (regression): Login with valid credentials → same response as before
S2 (regression): Login with invalid credentials → same error as before
S3 (regression): Protected endpoint with valid token → accessible
S4 (regression): Protected endpoint without token → 401
S5 (regression): Token expiry behavior unchanged
S6 (regression): Rate limiting behavior unchanged
```

## Template 6: Build System / Tooling Change

```
Feature: Added new build step

S1 (happy):      Full build succeeds → all artifacts present
S2 (happy):      Incremental build after change → only affected files rebuilt
S3 (negative):   Build with missing dependency → clear error message
S4 (regression): Existing build outputs unchanged
S5 (regression): Build time not significantly degraded
S6 (integration): Built artifacts installable/runnable
```

## Template 7: Web Component / Route

```
Feature: Login page

S1 (happy):      Navigate to /login → form visible, all fields present
S2 (happy):      Enter valid credentials → submit → redirect to /dashboard
S3 (boundary):   Email with 255 chars → accepted or validation message shown
S4 (negative):   Submit empty form → validation errors for required fields
S5 (negative):   Wrong password → "Invalid credentials" message displayed
S6 (integration): Successful login → user name visible on dashboard
S7 (regression):  Existing pages still render correctly after changes
S8 (negative):   Navigate to /login when already logged in → redirect to dashboard
```

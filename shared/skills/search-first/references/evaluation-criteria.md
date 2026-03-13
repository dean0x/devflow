# Search-First — Evaluation Criteria

Detailed package evaluation criteria and decision matrix for the 4-outcome model.

## Evaluation Matrix

Score each candidate on these axes (1-5 scale):

| Criterion | Weight | 1 (Poor) | 3 (Acceptable) | 5 (Excellent) |
|-----------|--------|-----------|-----------------|----------------|
| **Maintenance** | High | No commits in 2+ years | Active, yearly releases | Regular releases, responsive maintainer |
| **Adoption** | Medium | < 100 weekly downloads | 1K-10K weekly downloads | > 100K weekly downloads |
| **API Fit** | High | Needs heavy wrapping | Partial fit, thin adapter needed | Direct use, clean API |
| **Bundle Size** | Medium | > 500KB | 50-500KB | < 50KB |
| **Security** | High | Known vulnerabilities | No known issues, few dependencies | Audited, zero/minimal dependencies |
| **License** | Required | GPL/AGPL (restrictive) | LGPL (conditional) | MIT/Apache/BSD (permissive) |

**Minimum thresholds**: License must be compatible. Security must be ≥ 3. All others are trade-offs.

## Decision Matrix

### Adopt (score ≥ 20/25, API Fit ≥ 4)

The package directly solves the problem with minimal integration code.

**Example**: Using `zod` for schema validation — exact fit, massive adoption, tiny bundle.

```
✅ Adopt: zod v3.22
- Maintenance: 5 (monthly releases)
- Adoption: 5 (4M weekly downloads)
- API Fit: 5 (direct use for all validation)
- Bundle Size: 4 (57KB)
- Security: 5 (zero dependencies)
- Total: 24/25
```

### Extend (score ≥ 15/25, API Fit ≥ 2)

The package handles 60-80% of the need. Write a thin adapter for the rest.

**Example**: Using `got` for HTTP but wrapping it with project-specific retry and auth logic.

```
✅ Extend: got v14
- Maintenance: 4 (active)
- Adoption: 5 (8M weekly downloads)
- API Fit: 3 (need custom retry wrapper)
- Bundle Size: 3 (150KB)
- Security: 4 (minimal deps)
- Total: 19/25
Adapter: ~30 lines wrapping retry + auth headers
```

### Compose (no single package fits, but small packages combine)

Two or three focused packages together solve the problem better than one large framework.

**Example**: `ms` (time parsing) + `p-retry` (retry logic) + `quick-lru` (caching) instead of a monolithic HTTP client framework.

**Rules for Compose**:
- Maximum 3 packages in a composition
- Each package must be focused (single responsibility)
- Total combined bundle < what a monolithic alternative would cost
- Glue code should be < 50 lines

### Build (nothing fits, or dependency cost > value)

Write custom code when:
- No package scores ≥ 15/25
- The code is < 50 lines and trivial
- Zero-dependency constraint is explicit
- The domain is too specific for generic packages

**Required**: Document why Build was chosen:

```typescript
// search-first: Built custom — our wire format uses non-standard
// ISO-8601 extensions that no date library handles correctly.
// Evaluated: date-fns (no custom format support), luxon (500KB overhead),
// dayjs (close but missing timezone edge case).
```

## Ecosystem-Specific Hints

### Node.js / TypeScript
- Check npm: `https://www.npmjs.com/package/{name}`
- Bundle size: `https://bundlephobia.com/package/{name}`
- Check if Node.js built-ins handle it (`node:crypto`, `node:url`, `node:path`)

### Python
- Check PyPI: `https://pypi.org/project/{name}`
- Check if stdlib handles it (`urllib`, `json`, `pathlib`, `dataclasses`)

### Rust
- Check crates.io: `https://crates.io/crates/{name}`
- Check if std handles it

### Go
- Check pkg.go.dev
- Go standard library is extensive — check stdlib first

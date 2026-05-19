# Security Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Insecure gRPC connection in example code** - `shared/skills/go/references/concurrency.md:286`
- Problem: The `sync.Once` code example uses `grpc.WithInsecure()`, which disables TLS. While this is example/reference code (not production code), skill files serve as templates that developers copy. Using `grpc.WithInsecure()` in a code example normalizes insecure transport. Additionally, `grpc.Dial` and `grpc.WithInsecure()` are both deprecated in modern gRPC-Go (deprecated since v1.57+ and v1.53+ respectively).
- Impact: Developers copying this pattern into production code will use unencrypted gRPC connections. The example teaches bad practice.
- Fix: Use `grpc.NewClient` with `credentials.NewTLS` or `insecure.NewCredentials()` with an explicit comment noting the security trade-off:
```go
func (c *Client) connection() (*grpc.ClientConn, error) {
    c.once.Do(func() {
        // For production: use credentials.NewTLS(&tls.Config{})
        c.conn, c.err = grpc.NewClient("localhost:50051",
            grpc.WithTransportCredentials(insecure.NewCredentials()), // local dev only
        )
    })
    return c.conn, c.err
}
```

**SQL query passed as raw string parameter in async example** - `shared/skills/python/references/async.md:81-89`
- Problem: The `stream_results` function accepts a raw SQL query string and passes it directly to `conn.execute(query)`. The usage example shows a hardcoded string, but the function signature `def stream_results(query: str)` invites callers to interpolate user input into the query parameter. This is a SQL injection pattern.
- Impact: Developers copying this pattern may pass user-constructed queries. The example does not demonstrate parameterized queries, which is the secure pattern.
- Fix: Show parameterized query usage:
```python
async def stream_results(
    query: str, params: tuple[Any, ...] = ()
) -> AsyncGenerator[Record, None]:
    async with get_connection() as conn:
        cursor = await conn.execute(query, params)
        async for row in cursor:
            yield Record.from_row(row)

# Usage
async for record in stream_results(
    "SELECT * FROM events WHERE status = ?", ("active",)
):
    await process(record)
```

## Issues in Code You Touched (Should Fix)

_No issues found._

The changes to existing files (`plugins.ts`, `coder.md`, `reviewer.md`, `code-review.md`, `code-review-teams.md`, `ambient-router/SKILL.md`) are configuration/registry changes (adding skill names to arrays, adding table rows). These contain no security-sensitive logic.

## Pre-existing Issues (Not Blocking)

### LOW

**Go violations example shows HTTP request ignoring context** - `shared/skills/go/references/violations.md:79`
- The violation example `resp, _ := http.Get(url)` is correctly labeled as a VIOLATION, which is the intended pedagogy. No action needed -- it is teaching developers what NOT to do.

### INFORMATIONAL

**Skill files are read-only reference material** - All new skill files (`shared/skills/go/`, `shared/skills/python/`, `shared/skills/java/`, `shared/skills/rust/`) use `allowed-tools: Read, Grep, Glob` in their frontmatter, which means they cannot execute code or modify files. This is a sound security posture.

**Optional plugin isolation is well-designed** - Language plugins are marked `optional: true` and contain only skill references (no agents, no commands). This limits their blast radius. The skill availability check in `code-review.md` and `code-review-teams.md` properly gates language reviews on whether the skill file exists, preventing errors from missing plugins.

**No hardcoded secrets or credentials** - Scanned all 43 changed files for API keys, tokens, passwords, and secret patterns. None found. The `plugin.json` files contain only public metadata (author email, repository URL, license).

**No command injection vectors** - The `src/cli/plugins.ts` changes are purely declarative (adding objects to a static array). Plugin names are hardcoded strings, not user input. No `exec`, `eval`, `spawn`, or shell execution patterns introduced.

**Detection pattern files are well-structured** - The Go, Python, Java, and Rust detection reference files (`references/detection.md`) include patterns for finding security issues in their respective languages (unsafe deserialization, shell injection, unsafe blocks). These are grep commands for security scanning, which is a positive contribution.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Security Score**: 8/10

The two MEDIUM issues are both in example/reference code within skill documentation files, not in production logic. The actual TypeScript source changes (`plugins.ts`, `plugins.test.ts`) are purely declarative and introduce no security risk. The plugin architecture correctly isolates optional language plugins with read-only permissions. The PR's security posture is strong.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Fix the `grpc.WithInsecure()` example in `shared/skills/go/references/concurrency.md:286` to use modern, non-deprecated gRPC connection API with a comment about TLS.
2. Fix the `stream_results` example in `shared/skills/python/references/async.md:81-89` to demonstrate parameterized queries instead of raw string query passing.

Both fixes are minor documentation changes that prevent teaching insecure patterns to developers who use these skills as reference material.

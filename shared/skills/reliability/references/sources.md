# Reliability — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | The Power of Ten — Rules for Developing Safety-Critical Code | Gerard J. Holzmann | 2006 | Free (NASA/JPL) | 10 rules for verifiable, reliable embedded software |
| 2 | NASA/JPL Coding Standard for the C Programming Language | JPL | 2009 | Free | Institutional coding rules derived from Power of Ten |
| 3 | MISRA C:2023 — Guidelines for the Use of the C Language in Critical Systems | MISRA | 2023 | Paid | Safety-critical C coding guidelines |
| 4 | SEI CERT Coding Standards | SEI Carnegie Mellon | 2024 | Free | Language-specific secure and reliable coding rules |
| 5 | Software Reliability Engineering | John D. Musa | 1998 | Paid | Quantitative reliability measurement and prediction |
| 6 | Release It! — Design and Deploy Production-Ready Software | Michael T. Nygard | 2018 | Paid | Stability patterns: circuit breakers, bulkheads, timeouts |

## Power of Ten Rules Summary [1]

| Rule | Summary | Devflow Category |
|------|---------|-----------------|
| 1 | Restrict to simple control flow — no goto, setjmp, recursion | Bounded Iteration |
| 2 | Fixed upper bound on all loops | Bounded Iteration |
| 3 | No dynamic memory allocation after initialization | Allocation Discipline |
| 4 | No function longer than 60 lines (single printed page) | Complexity (separate skill) |
| 5 | Minimum two assertions per function on average | Assertion Density |
| 6 | Declare data at smallest scope | Complexity (separate skill) |
| 7 | Check return value of every non-void function | Error Handling (engineering rule) |
| 8 | Limit preprocessor to includes and simple conditionals | Metaprogramming Restraint |
| 9 | Restrict pointers — no more than one level of dereferencing | Indirection Limits |
| 10 | Compile with all warnings enabled, zero warnings | Quality rule (zero warnings) |

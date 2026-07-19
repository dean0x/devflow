---
paths: ["**/*.go"]
---
# Go

**Errors are values — never ignore them.**

- Small interfaces defined at the consumer, not the producer
- Channels for communication, mutexes for state — never both
- No bare goroutines — always handle lifecycle and cancellation
- Accept interfaces, return structs
- No `**T` (pointer-to-pointer) — single indirection only; prefer value receivers

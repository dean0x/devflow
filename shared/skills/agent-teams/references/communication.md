# Communication Protocols

## Message Types

### Direct Message (one-to-one)

Use when challenging a specific teammate's finding:

```
To [Security Reviewer]:
"Your finding about SQL injection at api/users.ts:42 - I disagree.
The parameterized query at line 45 handles this. Check the query builder
pattern used throughout this codebase."
```

### Broadcast (one-to-all)

Use when sharing findings that affect all teammates:

```
Broadcast:
"I found that the auth middleware is bypassed for /api/internal/* routes.
This affects security, architecture, and testing perspectives."
```

---

## Debate Protocol

### Round Structure

```
Round 1: Initial findings (each teammate shares top findings)
Round 2: Challenge round (teammates dispute or validate)
Round 3: Resolution (update, withdraw, or escalate)
```

**Cap: 2 challenge exchanges per topic.** If unresolved, escalate to lead.

### Challenge Format

When challenging another teammate:

```
CHALLENGE to [Teammate]:
- Finding: [what they claimed]
- Evidence against: [your counter-evidence with file:line references]
- Suggested resolution: [what you think is correct]
```

### Concession Format

When accepting a challenge:

```
UPDATED based on [Teammate]'s challenge:
- Original: [what I originally claimed]
- Revised: [updated finding incorporating their evidence]
```

### Escalation Format

When debate is unresolved after 2 exchanges:

```
ESCALATION to Lead:
- Topic: [what we disagree about]
- Position A: [first perspective with evidence]
- Position B: [second perspective with evidence]
- Recommendation: [which has stronger evidence, or "genuinely split"]
```

---

## Lead Coordination Messages

### Initiating Debate

```
Lead broadcast:
"All teammates: Share your top 3-5 findings. After sharing, challenge
any finding you disagree with. Provide evidence (file:line references).
You have 2 exchange rounds to resolve disagreements."
```

### Ending Debate

```
Lead broadcast:
"Debate round complete. Submit final findings with confidence levels:
- HIGH: Unanimous or unchallenged with evidence
- MEDIUM: Majority agreed, dissent noted
- LOW: Split opinion, both perspectives included"
```

### Requesting Clarification

```
Lead to [Teammate]:
"Your finding about X contradicts [Other Teammate]'s finding about Y.
Can you address their evidence at [file:line]?"
```

---

## Output Aggregation

### Consensus Report Structure

```markdown
## Confirmed Findings (HIGH confidence)
[Findings all teammates agreed on or that survived challenge]

## Majority Findings (MEDIUM confidence)
[Findings most agreed on, with dissenting view noted]

## Split Findings (LOW confidence)
[Genuinely contested findings with both perspectives and evidence]

## Withdrawn Findings
[Findings that were disproved during debate]
```

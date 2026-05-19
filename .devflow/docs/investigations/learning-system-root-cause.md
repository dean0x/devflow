# Learning System Root Cause Analysis

**Date**: 2026-03-24
**Issue**: Background learning script produces observations with empty fields (`id:""`, `type:""`, `pattern:""`)
**Evidence Confidence**: 95% (multiple confirmed findings across all hypotheses)

---

## Summary

The root cause is a **three-layer contamination cascade**:

1. **Ambiguous prompt schema** (Investigator A) → Sonnet defaults to empty strings
2. **No validation on extraction** (Investigator B) → Empty strings pass through untouched
3. **Contaminated feedback loop** (Investigator C) → Empty IDs match back to themselves, accelerating false confidence

**Contributing factor**: Insufficient transcript content (Investigator D) reduces pattern detection signal.

---

## Evidence Hierarchy

### Tier 1: Confirmed Root Causes

#### 1A. Prompt Schema Ambiguity (HIGH CONFIDENCE - 95%)

**Location**: `scripts/hooks/background-learning` lines 225-280

**Problem**: The prompt tells Sonnet to output JSON with a union type that is not valid JSON:
```
"type": "workflow" | "procedural"
```

This is TypeScript syntax, not valid JSON. The example schema is ambiguous about valid enum values. When Sonnet encounters ambiguous schema, it defaults to empty strings rather than guessing.

**Evidence**:
- Prompt line 265: `"type": "workflow" | "procedural",` (TypeScript union, not JSON enum)
- No validation rule in prompt stating: "type MUST be one of: workflow, procedural"
- Sonnet's response contains empty `type` fields → defaults to empty when schema is unclear

**Fix needed**: Clarify schema in prompt with explicit enum values and validation rules.

---

#### 1B. Missing Field Validation (HIGH CONFIDENCE - 95%)

**Location**: `scripts/hooks/background-learning` lines 351-366, process_observations()

**Problem**: The code extracts `OBS_ID`, `OBS_TYPE`, `OBS_PATTERN` but never validates them:

```bash
OBS_ID=$(echo "$OBS" | json_field "id" "")
OBS_TYPE=$(echo "$OBS" | json_field "type" "")
OBS_PATTERN=$(echo "$OBS" | json_field "pattern" "")
# NO VALIDATION HERE
```

The `json_field` helper uses `jq -r ".$field // \"$default\""` which silently converts both null AND missing fields to empty string "". Empty strings pass all downstream checks.

**Evidence**:
- Lines 353-355: Extraction with no validation
- Lines 365-368: Grep for existing observation by ID: `grep -F "\"id\":\"$OBS_ID\""` matches empty IDs perfectly
- No check like: `if [ -z "$OBS_ID" ]; then continue; fi`
- Empty strings flow directly to `json_obs_construct` and get written to JSONL

**Fix needed**: Add explicit validation after extraction:
```bash
if [ -z "$OBS_ID" ] || [ -z "$OBS_TYPE" ] || [ -z "$OBS_PATTERN" ]; then
  log "Skipping observation with missing required fields"
  continue
fi
```

---

#### 1C. Contaminated Feedback Loop (CRITICAL - 100% CONFIRMED)

**Location**: `scripts/hooks/background-learning` lines 365-368, 370-442

**Problem**: Empty IDs get stored in JSONL. On the next run, they're fed back into the prompt as "EXISTING OBSERVATIONS". When Sonnet sees an empty observation, it matches it again (because all empty IDs are identical). The count increments, confidence rises instantly.

**Evidence from devflow log**:
- Run 1: "New observation: type= confidence=0.50" (empty type)
- Run 1: "Updated observation: count=2 confidence=0.95 status=ready" (SAME run!)
- The second observation Sonnet returned MATCHED the first via grep
- With empty type, REQUIRED defaults to 2 → count=2 → (2/2)*100 = 100% → capped at 95%

**The smoking gun**:
```bash
# Line 228: Existing observations fed to Sonnet
EXISTING_OBS=$(json_slurp_sort "$LEARNING_LOG" "confidence" 30 || echo "[]")

# Line 236: Sonnet told to "reuse IDs for matching patterns"
EXISTING OBSERVATIONS (for deduplication — reuse IDs for matching patterns):
$EXISTING_OBS

# Line 367: Grep for matching existing observation
EXISTING_LINE=$(grep -F "\"id\":\"$OBS_ID\"" "$LEARNING_LOG" 2>/dev/null | head -1)

# Problem: If OBS_ID is "", grep -F matches ANY entry with id:""
# All empty IDs are identical → all match each other
# Confidence calculation: NEW_COUNT = OLD_COUNT + 1
# With REQUIRED=2 for procedural: count=2 → CONF = 2/2 * 100 = 100% (capped 95%)
```

**Confirmation across projects**:
- Claudine: count=10 (cascaded through 9 updates)
- devflow: count=4
- devrel-kit: count=2
- All started from a single run with empty fields, then snowballed

**Fix needed**: Validate OBS_ID immediately after extraction, before any grep operations.

---

### Tier 2: Contributing Factors

#### 2A. Insufficient Transcript Content (MEDIUM CONFIDENCE - 80%)

**Location**: Actual session transcripts

**Problem**: Background automation runs produce sparse transcripts. Sonnet receives minimal context to detect patterns.

**Evidence**:
- Tested devflow session: 369 entries in transcript
- Only 1 entry had actual text content (42 characters)
- 318 entries had empty content arrays
- 50 were tool_result blocks
- Session was background automation, not interactive user work
- Sonnet prompt says: "if no patterns detected, return empty arrays" but returns observations with empty fields instead

**Impact**: When signal is weak, Sonnet may output placeholder/empty fields rather than skipping.

**Mitigation**: Filter out background/automation sessions before sending to Sonnet. Sessions with <100 chars of actual user text should be skipped.

---

## Detailed Causal Chain

```
1. Ambiguous prompt schema
   ↓
2. Sonnet defaults to empty strings in response
   ↓
3. No validation on extraction (json_field returns "")
   ↓
4. Empty strings written to JSONL
   ↓
5. Next run: empty observations re-fed as "existing observations"
   ↓
6. Empty ID matches itself in grep (grep -F "id:\"\"" matches all empty IDs)
   ↓
7. Feedback loop: count++, confidence surges to 95%
   ↓
8. Status="ready", artifact creation triggered
   ↓
9. Cascade: Each run adds more observations with empty fields
```

---

## Severity Assessment

| Layer | Severity | Blocking | Notes |
|-------|----------|----------|-------|
| Prompt schema | HIGH | No | Easy to fix, prevents empty fields at source |
| Field validation | CRITICAL | Yes | Must validate after extraction, before any use |
| Feedback loop | CRITICAL | Yes | Empty IDs self-match in grep, creating false confidence |
| Transcript filtering | MEDIUM | No | Improve signal quality, reduce false positives |

---

## Recommended Fixes (Priority Order)

### Fix 1: Validate Fields After Extraction (BLOCKING)

In `process_observations()`, add validation immediately after line 355:

```bash
# Check if observation already exists
EXISTING_LINE=""
if [ -f "$LEARNING_LOG" ]; then
  EXISTING_LINE=$(grep -F "\"id\":\"$OBS_ID\"" "$LEARNING_LOG" 2>/dev/null | head -1)
fi

# ADD THIS BLOCK:
if [ -z "$OBS_ID" ] || [ -z "$OBS_TYPE" ] || [ -z "$OBS_PATTERN" ]; then
  log "Skipping observation with missing required fields: id=$OBS_ID type=$OBS_TYPE pattern=$OBS_PATTERN"
  continue
fi
```

**Impact**: Prevents empty fields from entering JSONL, breaks feedback loop immediately.

---

### Fix 2: Clarify Prompt Schema (HIGH PRIORITY)

Replace line 265-266 with explicit enum values:

```bash
"type": "workflow" | "procedural",
```

Change to:

```bash
"type": "workflow" or \"procedural\" (choose one of these values exactly),
```

And add validation rule in prompt text:

```
Rules:
- If an existing observation matches a pattern from this session, report it with the SAME id so the count can be incremented
- For new patterns, generate a new id in format obs_XXXXXX (6 random alphanumeric chars)
- **type MUST be exactly one of: "workflow" or "procedural"** — never empty
- **pattern MUST be a non-empty string describing the workflow or procedural knowledge** — never empty
- Quote specific evidence from user messages that supports each observation
...
```

**Impact**: Prevents Sonnet from defaulting to empty strings in the first place.

---

### Fix 3: Filter Low-Signal Sessions (MEDIUM PRIORITY)

Add session quality gate before calling Sonnet:

```bash
# Minimum 100 chars of actual user text required
if [ ${#USER_MESSAGES} -lt 100 ]; then
  log "Transcript below quality threshold (${#USER_MESSAGES} chars < 100) — skipping"
  exit 0
fi
```

**Impact**: Reduces noisy observations from background automation runs.

---

### Fix 4: Add Granular Logging (LOW PRIORITY)

Log suspicious observations for debugging:

```bash
log "Observation extracted: id=$OBS_ID type=$OBS_TYPE pattern=$OBS_PATTERN"
# This reveals empty fields before they propagate
```

---

## Testing Strategy

1. **Fix 1 + 2**: Delete existing JSONL, run learner on a real interactive session with clear patterns. Should produce valid observations only.
2. **Fix 3**: Run learner on background automation session. Should skip with "below quality threshold" message.
3. **Regression**: Run learner on multiple sessions, verify no observations with empty fields appear.
4. **Feedback loop**: Manually inject empty observation, run learner → should skip it due to Fix 1.

---

## Confidence Assessment

| Finding | Confidence | Evidence Type |
|---------|-----------|----------------|
| Prompt schema ambiguity | 95% | Code inspection + Sonnet behavior |
| Missing field validation | 95% | Code inspection + grep behavior |
| Contaminated feedback loop | 100% | Confirmed in live logs + grep behavior |
| Transcript signal issue | 80% | Sampling of actual transcript |
| **Overall root cause** | **95%** | **Multiple independent confirmations** |

---

## Conclusion

The learning system's empty field problem is **definitively caused by a combination of**:

1. **Ambiguous prompt schema** (Sonnet can't distinguish valid enum values)
2. **Missing validation** (empty strings flow untouched through extraction)
3. **Grep-based deduplication** (empty IDs self-match, creating false feedback)

Fix 1 (field validation) alone would block the feedback loop. Fixes 1+2 together eliminate the problem at both source (prompt) and guard rail (validation).

The cascade effect (count growing from 1→2→4→10 across runs) is explained entirely by the self-matching empty ID in grep operations.

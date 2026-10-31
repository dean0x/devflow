---
name: accessibility
description: This skill should be used when the user asks to "add accessibility", "check ARIA", "handle keyboard navigation", or creates UI components, forms, or interactive elements.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.tsx"
    - "**/*.jsx"
    - "**/*.css"
    - "**/*.scss"
  exclude:
    - "node_modules/**"
    - "**/*.test.*"
    - "**/*.spec.*"
---

# Accessibility Patterns

Reference for web accessibility (WCAG 2.2 AA compliance), keyboard navigation, screen reader support, and inclusive design. Sources in `references/sources.md`.

## Iron Law

> **EVERY INTERACTION MUST BE POSSIBLE WITHOUT A MOUSE** [1][3]
>
> Mouse-only interactions exclude users with motor disabilities, power users, and AT users.
> Tab order, focus management, and keyboard shortcuts are not optional enhancements.
> — WCAG 2.1 Principle 2 (Operable) [1]

## Keyboard Navigation

- Make every interactive element reachable via Tab.
- Focus management: on modal open (`role="dialog"`, `aria-modal="true"`), move focus to the first focusable element and trap focus inside. Escape closes modals and dropdowns; on close, return focus to the trigger.
- Skip links: the first focusable element, visible on focus, links to `#main-content`.
- Roving tabIndex: active item `tabIndex={0}`, others `tabIndex={-1}` — radio groups, toolbars, tabs.

## ARIA and Semantic HTML

- First rule of ARIA: use native HTML before adding ARIA roles — no ARIA is better than bad ARIA. `<button>Submit</button>`, not `<div role="button">`; `<nav aria-label="Main">`, not `<div role="navigation">`.
- Top violations: missing form labels · low contrast · missing alt text · missing button names.
- Live regions: `aria-live="polite"` for status updates; `role="alert"` for errors.

## Color and Contrast

| Element | Ratio | Level | SC |
|---------|-------|-------|----|
| Normal text (<18px) | 4.5:1 | AA | 1.4.3 |
| Large text (≥18px bold, ≥24px) | 3:1 | AA | 1.4.3 |
| UI components & focus indicators | 3:1 | AA | 1.4.11 |
| Focus appearance (WCAG 2.2 new) | 3:1 + ≥2px perimeter | AA | 2.4.11 |

Never convey meaning through color alone — pair with icon, text, or pattern (SC 1.4.1).

WCAG 2.2 new AA: `2.4.11` Focus Appearance (≥2px, 3:1 contrast) · `2.5.8` Target Size (≥24×24px) · `3.3.8` Accessible Auth (paste must work)

## Forms and Errors

- Give every input an associated `<label htmlFor>`. A placeholder is not a label: it disappears on input.
- Mark an error with `aria-invalid`, link it with `aria-describedby`, and announce it with `role="alert"`.

## Motion and Cognitive

- Respect `@media (prefers-reduced-motion: reduce)` (SC 2.3.3): cut animation durations to near zero.
- Auto-advancing content (carousels, video) must have pause/stop controls (SC 2.2.2).
- Cognitive: plain language · clear error recovery · no time limits · copy-paste in auth (SC 3.3.8).

## Extended References

See `references/`: `sources.md` (20 sources) · `patterns.md` (correct patterns) · `violations.md` (violation examples) · `detection.md` (grep patterns)

## Severity

| Severity | Criteria |
|----------|----------|
| CRITICAL | No keyboard access · missing form labels · zero contrast |
| HIGH | Missing focus indicators · no skip links · color-only meaning |
| MEDIUM | Missing ARIA labels · poor focus order · small touch targets |
| LOW | Missing optional enhancements |

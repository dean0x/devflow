---
name: accessibility
description: This skill should be used when the user asks to "add accessibility", "check ARIA", "handle keyboard navigation", "add focus management", or creates UI components, forms, or interactive elements. Provides WCAG 2.2 AA patterns for keyboard navigation, ARIA roles and states, focus management, color contrast, and screen reader support.
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

**Activates for**: interactive UI components · forms · React/JSX or CSS · focus/ARIA/contrast reviews

---

## Keyboard Navigation [1][3]

**Focus management**: On modal open, move focus to the first focusable element; on close, return to the trigger. Trap focus inside. [3]

```tsx
// CORRECT: Focus trap — APG dialog pattern [3]
function Modal({ isOpen, onClose, children }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (isOpen) first.current?.focus(); }, [isOpen]);
  return (
    <div role="dialog" aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <button ref={first}>First action</button>{children}
    </div>
  );
}
```

**Skip links**: First focusable element — visible on focus, links to `#main-content`. [1][4]
**Roving tabIndex**: Active item `tabIndex={0}`, others `tabIndex={-1}` — radio groups, toolbars, tabs. [3]

---

## ARIA and Semantic HTML [2][15][18]

**First rule of ARIA**: Use native HTML before adding ARIA roles — no ARIA is better than bad ARIA. [15][18]

| CORRECT [18] | VIOLATION [15] |
|---|---|
| `<button>Submit</button>` | `<div role="button">Submit</div>` |
| `<nav aria-label="Main">` | `<div role="navigation">` |

Top WebAIM Million 2024 violations [5]: missing form labels (#1) · low contrast (#2) · missing alt text (#3) · missing button names (#4).

**Live regions**: `aria-live="polite"` for status updates; `role="alert"` for errors. [2]

---

## Color and Contrast [1][16][19]

| Element | Ratio | Level | SC |
|---------|-------|-------|----|
| Normal text (<18px) | 4.5:1 | AA | [1] §1.4.3 |
| Large text (≥18px bold, ≥24px) | 3:1 | AA | [1] §1.4.3 |
| UI components & focus indicators | 3:1 | AA | [1] §1.4.11 |
| Focus appearance (WCAG 2.2 new) | 3:1 + ≥2px perimeter | AA | [16] §2.4.11 |

Never convey meaning through color alone — pair with icon, text, or pattern. [1] §1.4.1

**WCAG 2.2 new AA** [16]: `2.4.11` Focus Appearance (≥2px, 3:1 contrast) · `2.5.8` Target Size (≥24×24px) · `3.3.8` Accessible Auth (paste must work)

---

## Forms and Errors [1][3][9]

```tsx
// CORRECT: Label + error announcement [1][3]
<label htmlFor="email">Email</label>
<input id="email" type="email" aria-invalid={!!error}
  aria-describedby={error ? 'email-error' : undefined} />
{error && <span id="email-error" role="alert">{error}</span>}
// VIOLATION: Placeholder as label — disappears on input [5]
<input placeholder="Enter email" />
```

---

## Motion and Cognitive [1][17]

```css
@media (prefers-reduced-motion: reduce) { /* WCAG 2.3.3 [1] */
  *, *::before, *::after { animation-duration: 0.01ms !important; }
}
```

Auto-advancing content (carousels, video) must have pause/stop controls. [1] §2.2.2
Cognitive (COGA [17]): plain language · clear error recovery · no time limits · copy-paste in auth (SC 3.3.8) [16]

---

## Extended References

See `references/`: `sources.md` (20 sources) · `patterns.md` (correct patterns) · `violations.md` (violation examples) · `detection.md` (grep patterns)

---

## Severity [1][5]

| Severity | Criteria |
|----------|----------|
| CRITICAL | No keyboard access · missing form labels · zero contrast [1][5] |
| HIGH | Missing focus indicators · no skip links · color-only meaning [1][16] |
| MEDIUM | Missing ARIA labels · poor focus order · small touch targets [1][3] |
| LOW | Missing optional enhancements [2] |

---

## Checklist

- [ ] All interactive elements reachable via Tab [1]
- [ ] Focus indicators visible — ≥2px, 3:1 contrast (SC 2.4.11) [16]
- [ ] Escape closes modals/dropdowns; focus returns to trigger [3]
- [ ] Skip link to main content [1]
- [ ] All form inputs have associated `<label>` [1][5]
- [ ] Errors linked via `aria-describedby` and announced via `role="alert"` [1]
- [ ] Color contrast: 4.5:1 (text) / 3:1 (UI) [1]
- [ ] No color-only meaning [1]
- [ ] `prefers-reduced-motion` respected [1]
- [ ] Touch targets ≥24×24px (SC 2.5.8) [16]
- [ ] `aria-live` for dynamic content [2]
- [ ] Semantic HTML preferred over ARIA roles [15][18]
- [ ] Copy-paste works in authentication fields (SC 3.3.8) [16]

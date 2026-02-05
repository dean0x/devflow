---
name: accessibility
description: Accessibility patterns. Use when creating UI components, forms, interactive elements, or React/JSX code. Triggers on keyboard, ARIA, focus, color contrast discussions.
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

Reference for web accessibility (WCAG 2.1 AA compliance), keyboard navigation, screen reader support, and inclusive design.

## Iron Law

> **EVERY INTERACTION MUST BE POSSIBLE WITHOUT A MOUSE**
>
> If a user cannot complete an action using only keyboard, the feature is broken.
> Mouse-only interactions exclude users with motor disabilities, power users,
> and anyone navigating with assistive technology. Tab order, focus management,
> and keyboard shortcuts are not optional enhancements.

## When This Skill Activates

- Creating interactive UI components
- Building forms and inputs
- Working with React/JSX code
- Discussing focus, ARIA, or screen readers
- Reviewing color schemes or contrast

---

## Keyboard Navigation

### Focus Management

```tsx
// CORRECT: Focus trap in modal
function Modal({ isOpen, onClose, children }) {
  const firstFocusable = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) firstFocusable.current?.focus();
  }, [isOpen]);

  return (
    <div role="dialog" aria-modal="true" onKeyDown={(e) => {
      if (e.key === 'Escape') onClose();
    }}>
      <button ref={firstFocusable}>First action</button>
      {children}
    </div>
  );
}

// VIOLATION: No focus management, no escape handler
function BadModal({ children }) {
  return <div className="modal">{children}</div>;
}
```

### Skip Links

```tsx
// CORRECT: Skip to main content
<a href="#main-content" className="sr-only focus:not-sr-only">
  Skip to main content
</a>
<main id="main-content" tabIndex={-1}>...</main>
```

---

## ARIA and Semantic HTML

### Prefer Semantic Elements

```tsx
// CORRECT: Native semantics
<button onClick={handleClick}>Submit</button>
<nav aria-label="Main"><ul>...</ul></nav>
<article><header>...</header></article>

// VIOLATION: Div with role instead of semantic element
<div role="button" onClick={handleClick}>Submit</div>
<div role="navigation">...</div>
```

### Live Regions

```tsx
// CORRECT: Announce dynamic changes
<div aria-live="polite" aria-atomic="true">
  {message && <p>{message}</p>}
</div>

// For errors (assertive)
<div role="alert">{errorMessage}</div>
```

---

## Color and Contrast

| Element | Minimum Ratio | WCAG Level |
|---------|--------------|------------|
| Normal text (<18px) | 4.5:1 | AA |
| Large text (>=18px bold, >=24px) | 3:1 | AA |
| UI components | 3:1 | AA |
| Enhanced | 7:1 | AAA |

### Never Color-Only Meaning

```tsx
// VIOLATION: Only color indicates error
<input style={{ borderColor: hasError ? 'red' : 'gray' }} />

// CORRECT: Icon + text + color
<input aria-invalid={hasError} aria-describedby="error-msg" />
{hasError && <span id="error-msg" role="alert">Required field</span>}
```

---

## Motion and Animation

```tsx
// CORRECT: Respect user preferences
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

<div className={prefersReduced ? 'no-animation' : 'animate-fade'}>
  Content
</div>

// CSS approach
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Touch and Pointer

### Minimum Target Size

```css
/* CORRECT: 44x44px minimum touch target */
.button {
  min-width: 44px;
  min-height: 44px;
  padding: 12px 16px;
}

/* VIOLATION: Tiny tap targets */
.icon-button {
  width: 20px;
  height: 20px;
}
```

---

## Forms and Errors

```tsx
// CORRECT: Associated labels and error linking
<div>
  <label htmlFor="email">Email</label>
  <input
    id="email"
    type="email"
    aria-invalid={!!error}
    aria-describedby={error ? 'email-error' : undefined}
  />
  {error && <span id="email-error" role="alert">{error}</span>}
</div>

// VIOLATION: Placeholder as label
<input placeholder="Enter email" />
```

---

## Extended References

For additional patterns and detection rules:
- `references/violations.md` - Extended accessibility violations
- `references/patterns.md` - Extended correct patterns
- `references/detection.md` - Grep patterns for finding issues

---

## Severity Guidelines

| Severity | Criteria |
|----------|----------|
| CRITICAL | No keyboard access, missing form labels, zero contrast |
| HIGH | Missing focus indicators, no skip links, color-only meaning |
| MEDIUM | Missing ARIA labels, poor focus order, small touch targets |
| LOW | Missing optional enhancements, could improve announcements |

---

## Checklist

- [ ] All interactive elements reachable via Tab
- [ ] Visible focus indicators on all focusable elements
- [ ] Escape closes modals/dropdowns
- [ ] Skip link to main content
- [ ] All form inputs have associated labels
- [ ] Errors linked via aria-describedby
- [ ] Color contrast meets 4.5:1 (text) / 3:1 (UI)
- [ ] No color-only meaning
- [ ] prefers-reduced-motion respected
- [ ] Touch targets minimum 44x44px
- [ ] aria-live for dynamic content
- [ ] Semantic HTML preferred over ARIA roles

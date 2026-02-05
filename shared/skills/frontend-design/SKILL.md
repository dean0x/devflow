---
name: frontend-design
description: Frontend design patterns. Use when creating UI components, discussing visual design, typography, color, spacing, or reviewing CSS/styling decisions.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.tsx"
    - "**/*.jsx"
    - "**/*.css"
    - "**/*.scss"
    - "**/tailwind.config.*"
  exclude:
    - "node_modules/**"
    - "**/*.test.*"
    - "**/*.spec.*"
---

# Frontend Design Patterns

Reference for intentional visual design, following Anthropic's 4 Dimensions framework. Focus on deliberate aesthetic choices over default slop.

## Iron Law

> **AESTHETICS MUST HAVE INTENT**
>
> Every visual choice must be justified. Default styles, copied gradients, and
> "looks modern" are not justifications. If you cannot explain why a specific
> font, color, or animation exists, it's design debt. Good design is invisible
> because it serves purpose, not because it copies trends.

## When This Skill Activates

- Creating or styling UI components
- Reviewing CSS, Tailwind, or styled-components
- Discussing typography, color schemes, or layouts
- Building design systems or component libraries
- Evaluating visual consistency

---

## 1. Typography Intent

### Font Personality Must Match Product

```css
/* CORRECT: Deliberate choice with rationale */
/* Product: Developer documentation - needs readability */
font-family: 'IBM Plex Mono', 'JetBrains Mono', monospace;

/* VIOLATION: Inter because "everyone uses it" */
font-family: 'Inter', sans-serif; /* Why? What does it communicate? */
```

### Clear Hierarchy

```css
/* CORRECT: Distinct visual hierarchy */
.heading-1 { font-size: 2.5rem; font-weight: 700; letter-spacing: -0.02em; }
.heading-2 { font-size: 1.75rem; font-weight: 600; letter-spacing: -0.01em; }
.body { font-size: 1rem; font-weight: 400; line-height: 1.6; }
.caption { font-size: 0.875rem; font-weight: 400; color: var(--text-muted); }

/* VIOLATION: No hierarchy - everything similar */
.text { font-size: 1rem; }
.text-big { font-size: 1.1rem; }
```

### Line Height Tuning

```css
/* CORRECT: Context-appropriate line height */
.heading { line-height: 1.2; }  /* Tight for short headings */
.body { line-height: 1.6; }     /* Comfortable for reading */
.code { line-height: 1.4; }     /* Balanced for code */

/* VIOLATION: Universal line height */
* { line-height: 1.5; }
```

---

## 2. Color and Theme

### Deliberate Palette

```css
/* CORRECT: Semantic color system with clear purpose */
:root {
  --color-primary: #0066cc;     /* Actions, links - trust/stability */
  --color-success: #0a6640;     /* Positive outcomes */
  --color-warning: #b35900;     /* Attention needed */
  --color-error: #c41e3a;       /* Errors, destructive */
  --color-neutral-900: #1a1a1a; /* Primary text */
  --color-neutral-500: #6b7280; /* Secondary text */
  --color-neutral-100: #f5f5f5; /* Backgrounds */
}

/* VIOLATION: Random hex values without system */
.button { background: #4f46e5; }
.link { color: #3b82f6; }
.alert { background: #ef4444; }
```

### Light/Dark as First-Class

```css
/* CORRECT: Design for both modes intentionally */
:root {
  --bg-primary: #ffffff;
  --text-primary: #1a1a1a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0f0f0f;
    --text-primary: #f5f5f5;
  }
}

/* VIOLATION: Dark mode as afterthought */
.dark-mode { filter: invert(1); }
```

---

## 3. Motion and Animation

### State Communication

```css
/* CORRECT: Animation communicates state change */
.button {
  transition: transform 0.1s ease-out, background 0.15s ease;
}
.button:active {
  transform: scale(0.98); /* Feedback: "I received your click" */
}

/* VIOLATION: Animation for decoration */
.button {
  animation: pulse 2s infinite; /* Why is it pulsing? */
}
```

### Consistent Timing

```css
/* CORRECT: Timing scale for consistency */
:root {
  --duration-fast: 100ms;   /* Micro-interactions */
  --duration-normal: 200ms; /* Standard transitions */
  --duration-slow: 300ms;   /* Complex animations */
  --easing-default: cubic-bezier(0.4, 0, 0.2, 1);
}

/* VIOLATION: Random durations */
.modal { transition: 0.35s; }
.dropdown { transition: 0.2s; }
.tooltip { transition: 0.15s; }
```

### Appropriate Duration

| Element | Duration | Rationale |
|---------|----------|-----------|
| Hover states | 100-150ms | Immediate feedback |
| Dropdowns | 150-200ms | Quick but perceptible |
| Modals | 200-300ms | Significant context change |
| Page transitions | 300-500ms | Major navigation |

---

## 4. Spatial Composition

### Consistent Spacing Scale

```css
/* CORRECT: Mathematical spacing system */
:root {
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-12: 3rem;    /* 48px */
}

/* VIOLATION: Magic numbers */
.card { padding: 18px 22px; margin-bottom: 13px; }
```

### Whitespace With Purpose

```css
/* CORRECT: Whitespace creates visual grouping */
.section { margin-bottom: var(--space-12); }
.section-header { margin-bottom: var(--space-6); }
.paragraph { margin-bottom: var(--space-4); }

/* VIOLATION: Uniform spacing (no hierarchy) */
* + * { margin-top: 1rem; }
```

---

## AI Slop Detection

Flag these patterns - they indicate thoughtless defaults:

| Pattern | Problem |
|---------|---------|
| Purple-to-pink gradient | Copied from templates without brand justification |
| `font-family: Inter` without rationale | Default choice, not intentional |
| Everything centered | No visual hierarchy or flow |
| `rounded-xl` on everything | Border radius should vary by context |
| Shadows on everything | Elevation should be meaningful |
| Generic "hero section" with gradient | Template copy, not designed |
| `animate-pulse` on buttons | Meaningless attention grab |
| Glassmorphism everywhere | Trend following, not purpose |

---

## Extended References

For additional patterns and examples:
- `references/violations.md` - Extended design anti-patterns
- `references/patterns.md` - Extended correct patterns
- `references/detection.md` - Grep patterns for finding issues

---

## Severity Guidelines

| Severity | Criteria |
|----------|----------|
| CRITICAL | No design system (random values everywhere) |
| HIGH | Inconsistent spacing/typography, broken dark mode |
| MEDIUM | Missing hover states, poor visual hierarchy |
| LOW | Could improve animation timing, minor inconsistencies |

---

## Checklist

- [ ] Typography choices have documented rationale
- [ ] Color palette is semantic (not arbitrary hex)
- [ ] Dark/light modes both intentionally designed
- [ ] Spacing follows consistent scale
- [ ] Animations communicate state (not decoration)
- [ ] No "AI slop" patterns present
- [ ] Visual hierarchy is clear
- [ ] Responsive behavior is intentional

# UI Design Correct Patterns

Extended correct patterns for UI design. Reference from main SKILL.md.
Sources in `references/sources.md`.

---

## Typography Patterns [6][7][10][19]

### Intentional Font Selection [6][7]

Font personality must match product context. [6][27]

```css
/* Developer tools — monospace conveys precision, code-first [6][27] */
:root {
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
}

/* Documentation — optimized for long-form reading [7][19] */
:root {
  --font-body:    'Source Serif Pro', Georgia, serif;
  --font-heading: 'Source Sans Pro', system-ui, sans-serif;
  --font-code:    'Source Code Pro', monospace;
}

/* Brand-forward — distinctive personality [27] */
:root {
  --font-display: 'Fraunces', serif;  /* Distinctive headlines */
  --font-body:    'DM Sans', sans-serif;
}
```

### Mathematical Type Scale [10]

Modular scale with 1.25 (major third) ratio — all sizes relate harmonically. [10]

```css
/* CORRECT: 1.25 ratio scale [10] */
:root {
  --text-xs:  0.64rem;   /* 10.24px */
  --text-sm:  0.8rem;    /* 12.8px  */
  --text-base: 1rem;     /* 16px    */
  --text-lg:  1.25rem;   /* 20px    */
  --text-xl:  1.563rem;  /* 25px    */
  --text-2xl: 1.953rem;  /* 31.25px */
  --text-3xl: 2.441rem;  /* 39px    */
  --text-4xl: 3.052rem;  /* 48.8px  */
}

/* CORRECT: Weight + tracking differentiate heading levels [7][15] */
h1 { font-size: var(--text-4xl); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
h2 { font-size: var(--text-2xl); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
h3 { font-size: var(--text-xl);  font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; }
```

### Optimized Readability [6][7][19]

```css
/* CORRECT: Optimal line length 45–75 characters [6][7] */
.prose {
  max-width: 65ch;     /* ~65 characters per line */
  line-height: 1.7;
  font-size: 1.125rem; /* Slightly larger for comfortable reading */
}

.ui-text {
  max-width: none;
  line-height: 1.4;
  font-size: 0.875rem;
}

/* Fluid type with clamp() — no layout breakpoints needed [28] */
.heading-fluid {
  font-size: clamp(var(--text-2xl), 5vw, var(--text-4xl));
}
```

---

## Color System Patterns [1][9][12][14]

### Three-Layer Token Architecture [1][9]

Material Design 3 [1] and W3C Design Tokens spec [9] both recommend this layering:

```css
:root {
  /* Layer 1 — Primitives: raw named values */
  --blue-50:  #eff6ff;
  --blue-500: #3b82f6;
  --blue-600: #2563eb;
  --blue-700: #1d4ed8;

  /* Layer 2 — Semantic: meaning-based aliases */
  --color-primary:        var(--blue-600);
  --color-primary-hover:  var(--blue-700);
  --color-primary-subtle: var(--blue-50);

  /* Layer 3 — Component: specific usage */
  --button-primary-bg:       var(--color-primary);
  --button-primary-bg-hover: var(--color-primary-hover);
  --link-color:              var(--color-primary);
}

/* Dark mode swaps semantic layer only [1][23] */
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary:        var(--blue-500);
    --color-primary-hover:  var(--blue-400);
    --color-primary-subtle: var(--blue-900);
  }
}
```

### Designed Dark Surfaces [1][12][23]

Elevation in dark mode is expressed through lightness (lighter = higher), not shadows. [1][12]

```css
/* CORRECT: Elevation via lightness in dark mode [1] */
@media (prefers-color-scheme: dark) {
  :root {
    --surface-0:        #0a0a0a;  /* Base */
    --surface-1:        #141414;  /* Cards */
    --surface-2:        #1f1f1f;  /* Sidebars */
    --surface-elevated: #262626;  /* Modals */

    --text-primary:   #f9fafb;
    --text-secondary: #d1d5db;
    --text-muted:     #6b7280;

    --border-default: #2e2e2e;
    --border-strong:  #404040;
  }
}
```

### Accessible Contrast [14][26]

```css
/* CORRECT: All text verified against WCAG 2.2 AA [14][26] */
:root {
  /* 4.5:1 minimum for normal text */
  --text-on-primary:  #ffffff;  /* White on blue-600:  4.6:1 ✓ */
  --text-on-surface:  #111827;  /* Gray-900 on white: 15.8:1 ✓ */
  --text-secondary:   #4b5563;  /* Gray-600 on white:  5.7:1 ✓ */
  --text-link:        #2563eb;  /* Blue-600 on white:  4.5:1 ✓ */
}
/* 3:1 minimum for large text (18pt+) and UI components [14] */
```

---

## Spacing Patterns [1][13][15]

### 4px/8px Base Grid [1][13]

Müller-Brockmann's grid mathematics [13], adopted by Material Design as 4dp grid. [1]

```css
/* CORRECT: Base-4 spacing system [1][13] */
:root {
  --space-0:   0;
  --space-px:  1px;
  --space-0-5: 0.125rem; /* 2px  */
  --space-1:   0.25rem;  /* 4px  */
  --space-2:   0.5rem;   /* 8px  */
  --space-3:   0.75rem;  /* 12px */
  --space-4:   1rem;     /* 16px */
  --space-5:   1.25rem;  /* 20px */
  --space-6:   1.5rem;   /* 24px */
  --space-8:   2rem;     /* 32px */
  --space-10:  2.5rem;   /* 40px */
  --space-12:  3rem;     /* 48px */
  --space-16:  4rem;     /* 64px */
  --space-20:  5rem;     /* 80px */
  --space-24:  6rem;     /* 96px */
}
```

### Hierarchical Spacing [5][15]

Gestalt proximity: elements close together are perceived as related. [5]

```css
/* CORRECT: Larger gaps between sections, smaller within [5][15] */
.section        { padding-block: var(--space-16); }
.section-header { margin-bottom: var(--space-8); }
.card           { padding: var(--space-6); }
.card-header    { margin-bottom: var(--space-4); }
.card-title     { margin-bottom: var(--space-2); }
.card-actions   { margin-top: var(--space-6); display: flex; gap: var(--space-3); }
```

---

## Motion Patterns [4][11][24]

### Purposeful State Transitions [4][11]

Animation communicates function — each state change tells the user what happened. [11]

```css
/* CORRECT: System-defined timing [1] */
:root {
  --duration-instant: 50ms;   /* Opacity, color changes */
  --duration-fast:   100ms;   /* Hover, active states — Fitts feedback [4] */
  --duration-normal: 200ms;   /* Dropdowns, tooltips */
  --duration-slow:   300ms;   /* Modals, drawers */
  --duration-slower: 500ms;   /* Page/layout transitions */
  --ease-out:     cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out:  cubic-bezier(0.4, 0, 0.2, 1);
}

/* CORRECT: Specific properties only — never "all" */
.button {
  transition:
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-instant) var(--ease-out);
}
.button:active { transform: scale(0.98); } /* "I received your click" [11] */
```

### Reduced Motion Support [24][26]

```css
/* CORRECT: Required accessibility accommodation [24][26] */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Component Patterns [1][3][5][15]

### Atomic Design Hierarchy [3]

Atoms (token) → Molecules (input + label) → Organisms (form) → Templates → Pages. [3]
Build atoms with tokens; compose molecules without re-specifying primitives.

### Contextual Radius and Elevation [1][15]

```css
/* CORRECT: Radius and shadow signal interactivity level [1][15] */
:root {
  --radius-sm:   4px;
  --radius-md:   6px;
  --radius-lg:   8px;
  --radius-xl:   12px;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.1);
}

.badge             { border-radius: var(--radius-sm); box-shadow: none; }
.button            { border-radius: var(--radius-md); box-shadow: none; }
.card              { border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.card-interactive:hover { box-shadow: var(--shadow-md); }
.dropdown          { border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
.modal             { border-radius: var(--radius-xl); box-shadow: var(--shadow-xl); }
.avatar            { border-radius: var(--radius-full); }
```

### Token-Driven Components [9][17]

```tsx
// CORRECT: Components use tokens, not raw values [9][17]
const Button = styled.button`
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-md);
  background: var(--button-primary-bg);
  color: var(--text-on-primary);
  transition: background var(--duration-fast) var(--ease-out);

  &:hover  { background: var(--button-primary-bg-hover); }
  &:active { transform: scale(0.98); }
`;
```

### Responsive Breakpoints [8][22]

Container queries (CSS Level 5 [22]) for component-level responsiveness:

```css
/* CORRECT: Minimal, purposeful breakpoints [8] */
.container {
  width: 100%;
  max-width: 1280px;
  margin-inline: auto;     /* Logical properties [29] */
  padding-inline: var(--space-4);
}

@media (min-width: 768px)  { .container { padding-inline: var(--space-6); } }
@media (min-width: 1024px) { .container { padding-inline: var(--space-8); } }

/* Container query for component-level responsive [22] */
@container (min-width: 400px) {
  .card { flex-direction: row; }
}
```

---

## Design System Documentation [9][15]

```css
/* CORRECT: Self-documenting design tokens [9] */
:root {
  /*
   * COLOR SYSTEM [1][9]
   * Primitives: Raw hue+shade values (--blue-600)
   * Semantic:   Meaning aliases (--color-primary)
   * Component:  Specific usage (--button-primary-bg)
   */

  /*
   * SPACING SYSTEM [1][13]
   * Base unit: 4px (0.25rem) — Müller-Brockmann 4-column grid
   * Scale: 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24
   */

  /*
   * TYPOGRAPHY SYSTEM [6][10]
   * Scale ratio: 1.25 (major third) — Modular Scale
   * Base: 16px; Weights: 400, 500, 600, 700, 800
   */
}
```

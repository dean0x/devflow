# Frontend Design Correct Patterns

Extended correct patterns for frontend design. Reference from main SKILL.md.

## Typography Patterns

### Intentional Font Selection

```css
/* CORRECT: Font choice with documented rationale */

/* Developer tools - monospace conveys precision, code-first */
:root {
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
}

/* Documentation - optimized for long-form reading */
:root {
  --font-body: 'Source Serif Pro', Georgia, serif;
  --font-heading: 'Source Sans Pro', system-ui, sans-serif;
  --font-code: 'Source Code Pro', monospace;
}

/* Brand-forward marketing - distinctive personality */
:root {
  --font-display: 'Fraunces', serif; /* Distinctive headlines */
  --font-body: 'DM Sans', sans-serif; /* Clean, modern body */
}
```

### Clear Type Scale

```css
/* CORRECT: Mathematical type scale (1.25 ratio) */
:root {
  --text-xs: 0.64rem;   /* 10.24px */
  --text-sm: 0.8rem;    /* 12.8px */
  --text-base: 1rem;    /* 16px */
  --text-lg: 1.25rem;   /* 20px */
  --text-xl: 1.563rem;  /* 25px */
  --text-2xl: 1.953rem; /* 31.25px */
  --text-3xl: 2.441rem; /* 39px */
  --text-4xl: 3.052rem; /* 48.8px */
}

/* CORRECT: Distinct heading styles */
h1 {
  font-size: var(--text-4xl);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

h2 {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

h3 {
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
```

### Optimized Readability

```css
/* CORRECT: Context-appropriate line length and height */
.prose {
  max-width: 65ch; /* ~65 characters per line */
  line-height: 1.7;
  font-size: 1.125rem; /* Slightly larger for reading */
}

.ui-text {
  max-width: none;
  line-height: 1.4;
  font-size: 0.875rem;
}

.code {
  line-height: 1.5;
  font-size: 0.9em;
  tab-size: 2;
}
```

---

## Color System Patterns

### Semantic Color Tokens

```css
/* CORRECT: Multi-layer color system */
:root {
  /* Primitive colors (raw values) */
  --blue-50: #eff6ff;
  --blue-500: #3b82f6;
  --blue-600: #2563eb;
  --blue-700: #1d4ed8;

  /* Semantic tokens (meaning) */
  --color-primary: var(--blue-600);
  --color-primary-hover: var(--blue-700);
  --color-primary-subtle: var(--blue-50);

  /* Component tokens (usage) */
  --button-primary-bg: var(--color-primary);
  --button-primary-bg-hover: var(--color-primary-hover);
  --link-color: var(--color-primary);
}

/* Dark mode swaps semantic tokens, not primitives */
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: var(--blue-500);
    --color-primary-hover: var(--blue-400);
    --color-primary-subtle: var(--blue-900);
  }
}
```

### Intentional Dark Mode

```css
/* CORRECT: Designed dark mode, not inverted */
:root {
  /* Light mode surfaces */
  --surface-0: #ffffff;
  --surface-1: #f9fafb;
  --surface-2: #f3f4f6;
  --surface-elevated: #ffffff;

  /* Light mode text */
  --text-primary: #111827;
  --text-secondary: #4b5563;
  --text-muted: #9ca3af;

  /* Light mode borders */
  --border-default: #e5e7eb;
  --border-strong: #d1d5db;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode surfaces - elevation via lightness */
    --surface-0: #0a0a0a;
    --surface-1: #141414;
    --surface-2: #1f1f1f;
    --surface-elevated: #262626;

    /* Dark mode text */
    --text-primary: #f9fafb;
    --text-secondary: #d1d5db;
    --text-muted: #6b7280;

    /* Dark mode borders */
    --border-default: #2e2e2e;
    --border-strong: #404040;
  }
}
```

### Accessible Color Contrast

```css
/* CORRECT: Verified contrast ratios */
:root {
  /* All text colors meet WCAG AA on their intended backgrounds */
  --text-on-primary: #ffffff;      /* White on blue-600: 4.6:1 */
  --text-on-surface: #111827;      /* Gray-900 on white: 15.8:1 */
  --text-secondary: #4b5563;       /* Gray-600 on white: 5.7:1 */
  --text-link: #2563eb;            /* Blue-600 on white: 4.5:1 */
}
```

---

## Motion Patterns

### Animation Timing System

```css
/* CORRECT: Consistent timing scale */
:root {
  /* Durations */
  --duration-instant: 50ms;
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;

  /* Easing */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

/* Usage guidelines */
/* instant: Immediate feedback (opacity, color) */
/* fast: Micro-interactions (hover, active states) */
/* normal: Standard UI (dropdowns, tooltips) */
/* slow: Attention transitions (modals, drawers) */
/* slower: Major transitions (page, layout) */
```

### Purposeful State Transitions

```css
/* CORRECT: Animation communicates function */
.button {
  transition:
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-instant) var(--ease-out);
}

.button:hover {
  background-color: var(--button-hover-bg);
}

.button:active {
  transform: scale(0.98); /* "I received your input" */
}

/* CORRECT: Loading state with meaningful animation */
.button[data-loading] {
  position: relative;
  color: transparent; /* Hide text */
}

.button[data-loading]::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin var(--duration-slower) linear infinite;
}
```

### Reduced Motion Support

```css
/* CORRECT: Complete reduced motion implementation */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Or preserve critical animations with reduced intensity */
@media (prefers-reduced-motion: reduce) {
  .modal {
    transition: opacity var(--duration-fast);
    /* Remove transform animation, keep opacity */
  }

  .skeleton {
    animation: none;
    /* Static skeleton, no pulse */
  }
}
```

---

## Spacing Patterns

### Mathematical Spacing Scale

```css
/* CORRECT: Base-4 spacing system */
:root {
  --space-0: 0;
  --space-px: 1px;
  --space-0.5: 0.125rem;  /* 2px */
  --space-1: 0.25rem;     /* 4px */
  --space-2: 0.5rem;      /* 8px */
  --space-3: 0.75rem;     /* 12px */
  --space-4: 1rem;        /* 16px */
  --space-5: 1.25rem;     /* 20px */
  --space-6: 1.5rem;      /* 24px */
  --space-8: 2rem;        /* 32px */
  --space-10: 2.5rem;     /* 40px */
  --space-12: 3rem;       /* 48px */
  --space-16: 4rem;       /* 64px */
  --space-20: 5rem;       /* 80px */
  --space-24: 6rem;       /* 96px */
}
```

### Component-Level Spacing

```css
/* CORRECT: Consistent component spacing */
.card {
  padding: var(--space-6);
}

.card-header {
  margin-bottom: var(--space-4);
}

.card-title {
  margin-bottom: var(--space-2);
}

.card-actions {
  margin-top: var(--space-6);
  display: flex;
  gap: var(--space-3);
}

/* CORRECT: Section spacing with hierarchy */
.section {
  padding-block: var(--space-16);
}

.section + .section {
  border-top: 1px solid var(--border-default);
}

.section-header {
  margin-bottom: var(--space-8);
}

.section-content > * + * {
  margin-top: var(--space-4);
}
```

---

## Layout Patterns

### Contextual Border Radius

```css
/* CORRECT: Radius varies by component size and context */
:root {
  --radius-sm: 4px;   /* Small elements: badges, tags */
  --radius-md: 6px;   /* Medium: inputs, buttons */
  --radius-lg: 8px;   /* Large: cards, dialogs */
  --radius-xl: 12px;  /* Extra large: modals, panels */
  --radius-full: 9999px; /* Pills, avatars */
}

.badge { border-radius: var(--radius-sm); }
.button { border-radius: var(--radius-md); }
.card { border-radius: var(--radius-lg); }
.modal { border-radius: var(--radius-xl); }
.avatar { border-radius: var(--radius-full); }
```

### Intentional Elevation

```css
/* CORRECT: Shadows indicate interactivity level */
:root {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

/* Static content - no shadow or subtle */
.card { box-shadow: var(--shadow-sm); }

/* Interactive, hoverable - medium shadow on hover */
.card-interactive:hover {
  box-shadow: var(--shadow-md);
}

/* Floating UI (dropdowns, tooltips) - larger shadow */
.dropdown { box-shadow: var(--shadow-lg); }

/* Modals, dialogs - maximum elevation */
.modal { box-shadow: var(--shadow-xl); }
```

### Responsive Breakpoint System

```css
/* CORRECT: Minimal, purposeful breakpoints */
:root {
  /* Mobile-first defaults */

  /* Tablet: when two columns become useful */
  --breakpoint-md: 768px;

  /* Desktop: when full layout is appropriate */
  --breakpoint-lg: 1024px;

  /* Wide: when extra space needs addressing */
  --breakpoint-xl: 1280px;
}

/* Container with responsive padding */
.container {
  width: 100%;
  max-width: var(--breakpoint-xl);
  margin-inline: auto;
  padding-inline: var(--space-4);
}

@media (min-width: 768px) {
  .container {
    padding-inline: var(--space-6);
  }
}

@media (min-width: 1024px) {
  .container {
    padding-inline: var(--space-8);
  }
}
```

---

## Component Patterns

### Design Token Usage

```tsx
// CORRECT: Components use tokens, not raw values
const Button = styled.button`
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--text-on-primary);
  transition: background var(--duration-fast) var(--ease-out);

  &:hover {
    background: var(--color-primary-hover);
  }

  &:active {
    transform: scale(0.98);
  }
`;
```

### Systematic Icon Sizing

```css
/* CORRECT: Icon sizes that align with text */
.icon-xs { width: 12px; height: 12px; }  /* With text-xs */
.icon-sm { width: 16px; height: 16px; }  /* With text-sm */
.icon-md { width: 20px; height: 20px; }  /* With text-base */
.icon-lg { width: 24px; height: 24px; }  /* With text-lg */
.icon-xl { width: 32px; height: 32px; }  /* Standalone */

/* Icons in buttons */
.button .icon {
  flex-shrink: 0;
}

.button-sm .icon { width: 14px; height: 14px; }
.button-md .icon { width: 16px; height: 16px; }
.button-lg .icon { width: 20px; height: 20px; }
```

---

## Design System Documentation

```css
/* CORRECT: Self-documenting design tokens */
:root {
  /*
   * COLOR SYSTEM
   * ------------
   * Primitives: Raw color values, named by hue+shade
   * Semantic: Meaning-based aliases (primary, success, error)
   * Component: Specific usage (button-bg, input-border)
   */

  /*
   * SPACING SYSTEM
   * --------------
   * Base unit: 4px (0.25rem)
   * Scale: 0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24
   * Usage: Use smallest value that creates visual separation
   */

  /*
   * TYPOGRAPHY SYSTEM
   * -----------------
   * Scale ratio: 1.25 (major third)
   * Base: 16px (1rem)
   * Weights: 400 (body), 500 (emphasis), 600 (heading), 700 (display)
   */
}
```

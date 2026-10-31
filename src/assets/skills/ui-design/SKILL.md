---
name: ui-design
description: This skill should be used when the user asks to "design a component", "pick colors", "improve typography", "fix spacing", or discusses visual design and CSS.
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

# UI Design Patterns

Reference for intentional visual design. Sources in `references/sources.md`.

## Iron Law

> **AESTHETICS MUST HAVE INTENT** [4][11]
>
> Every visual choice must be justified. Default styles, copied gradients, and
> "looks modern" are not justifications. If you cannot explain why a specific
> font, color, or animation exists, it's design debt. Good design is invisible
> because it serves purpose — it satisfies mental models, not trends.
> — Don Norman, *The Design of Everyday Things* [11]; Laws of UX [4]

## 1. Typography

Font choice must match product personality, with a documented rationale: developer tools → monospace (precision), documentation → serif (readability), marketing → distinctive display.

Use a mathematical type scale (1.25 major third ratio). Line length: 45–75 characters for body text; `line-height: 1.7` for prose, `1.2` for headings.

Heading levels must differ in weight, tracking, and size — not size alone. See `references/patterns.md` for scale values, font pairs, and heading styles.

## 2. Color System

Three-layer tokens: primitive (`--blue-600: #2563eb`) → semantic (`--color-primary: var(--blue-600)`) → component (`--button-primary-bg: var(--color-primary)`).

Dark mode: swap semantic tokens only — never invert or filter. Elevation in dark mode is expressed via lightness, not shadows.

Contrast: 4.5:1 for normal text, 3:1 for large text and UI components.

See `references/patterns.md` for dark surface hierarchy and accessible contrast examples.

## 3. Spacing

4px/8px base grid. All padding/margin values must come from the scale: `--space-1` (4px) through `--space-24` (96px). `padding: 18px 22px` is a violation: a magic number, off-grid.

Gestalt proximity: larger gaps between sections, smaller gaps within. Build visual hierarchy with whitespace and spacing, not lines or boxes.

See `references/patterns.md` for full scale and component spacing hierarchy.

## 4. Motion

Animation must communicate state, not decorate. Every interaction needs tactile feedback.

Define a timing system (`--duration-fast: 100ms`, `--duration-normal: 200ms`, `--duration-slow: 300ms`). Never animate `all` — specify properties. Transitions over 500ms feel sluggish for UI.

Required: `@media (prefers-reduced-motion: reduce)` — WCAG 2.2 and vestibular accessibility.

## 5. Component Hierarchy

Atomic Design: atoms → molecules → organisms. Components reference tokens; organisms compose molecules. Radius and shadow signal interactivity, not decoration:

| Element | Radius | Shadow |
|---------|--------|--------|
| Badge/tag | 4px (`--radius-sm`) | none |
| Button/input | 6px (`--radius-md`) | none |
| Card (static) | 8px (`--radius-lg`) | `shadow-sm` |
| Dropdown | 8px | `shadow-lg` |
| Modal | 12px (`--radius-xl`) | `shadow-xl` |

## AI Slop Detection

| Pattern | Problem |
|---------|---------|
| Purple-to-pink gradient | No brand justification; copied template |
| `font-family: Inter` without rationale | Default, not intentional |
| Everything centered | No reading flow; violates hierarchy |
| `rounded-xl` everywhere | Radius must vary by component scale |
| Shadows on everything | Elevation loses meaning when ubiquitous |
| `animate-pulse` on buttons | Hick's Law: noise slows decisions |
| Glassmorphism everywhere | Trend, not purpose |

## Extended References

- `references/sources.md` — Full bibliography (30 sources)
- `references/patterns.md` — Extended correct patterns with citations
- `references/violations.md` — Extended violation examples with citations
- `references/detection.md` — Grep patterns for finding issues

---
name: ui-design
description: This skill should be used when the user asks to "design a component", "pick colors", "improve typography", "fix spacing", "choose a layout", or discusses visual design, CSS, styling decisions, or responsive interfaces. Provides patterns for typography scales, color systems, spacing, and production-grade UI design.
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

Reference for intentional visual design. Every choice must be justified. Sources in `references/sources.md`.

## Iron Law

> **AESTHETICS MUST HAVE INTENT** [4][11]
>
> Every visual choice must be justified. Default styles, copied gradients, and
> "looks modern" are not justifications. If you cannot explain why a specific
> font, color, or animation exists, it's design debt. Good design is invisible
> because it serves purpose — it satisfies mental models, not trends.
> — Don Norman, *The Design of Everyday Things* [11]; Laws of UX [4]

## When This Skill Activates

- Creating/styling UI components; reviewing CSS, Tailwind, or styled-components
- Discussing typography, color schemes, layouts, or design systems

---

## 1. Typography [6][7][10][19]

Font choice must match product personality: developer tools → monospace (precision), documentation → serif (readability), marketing → distinctive display. [6][7][27]

Use a **mathematical type scale** (1.25 major third ratio). All sizes relate harmonically. [10] Line length: 45–75 characters for body text; `line-height: 1.7` for prose, `1.2` for headings. [6][7]

Heading levels must differ in weight, tracking, and size — not size alone. [7][15] See `references/patterns.md` for scale values, font pairs, and heading styles.

---

## 2. Color System [1][9][12][14]

**Three-layer token architecture** (Material Design 3 [1] + W3C Design Tokens spec [9]):

```css
:root {
  --blue-600: #2563eb;                      /* Layer 1: Primitive */
  --color-primary: var(--blue-600);         /* Layer 2: Semantic  */
  --button-primary-bg: var(--color-primary);/* Layer 3: Component */
}
```

**Dark mode**: swap semantic tokens only — never invert or filter. [23]
Elevation in dark mode is expressed via lightness, not shadows. [1][12]

**Contrast**: 4.5:1 for normal text, 3:1 for large text and UI components. [14][26]

See `references/patterns.md` for dark surface hierarchy and accessible contrast examples.

---

## 3. Spacing [1][13][15]

4px/8px base grid — from Müller-Brockmann grid mathematics [13], adopted by Material Design [1].
All padding/margin values must come from the scale: `--space-1` (4px) through `--space-24` (96px).

Gestalt proximity: larger gaps between sections, smaller gaps within — whitespace creates grouping. [5]

**Violation**: `padding: 18px 22px` — magic number, off-grid. [15]

See `references/patterns.md` for full scale and component spacing hierarchy.

---

## 4. Motion [4][11][24]

Animation must communicate state, not decorate. Fitts's Law: every interaction needs tactile feedback. [4][11]

Define a timing system (`--duration-fast: 100ms`, `--duration-normal: 200ms`, `--duration-slow: 300ms`). [1]
Never animate `all` — specify properties. Transitions over 500ms feel sluggish for UI. [4]

**Required**: `@media (prefers-reduced-motion: reduce)` — WCAG 2.2 and vestibular accessibility. [24][26]

---

## 5. Component Hierarchy [1][3][5][15]

Atomic Design [3]: atoms → molecules → organisms. Components reference tokens; organisms compose molecules.

**Elevation table** — radius and shadow signal interactivity, not decoration: [1][11][15]

| Element | Radius | Shadow |
|---------|--------|--------|
| Badge/tag | 4px (`--radius-sm`) | none |
| Button/input | 6px (`--radius-md`) | none |
| Card (static) | 8px (`--radius-lg`) | `shadow-sm` |
| Dropdown | 8px | `shadow-lg` |
| Modal | 12px (`--radius-xl`) | `shadow-xl` |

---

## AI Slop Detection [4][11][15]

| Pattern | Problem |
|---------|---------|
| Purple-to-pink gradient | No brand justification; copied template [15] |
| `font-family: Inter` without rationale | Default, not intentional [6] |
| Everything centered | No reading flow; violates hierarchy [30] |
| `rounded-xl` everywhere | Radius must vary by component scale [1][15] |
| Shadows on everything | Elevation loses meaning when ubiquitous [11] |
| `animate-pulse` on buttons | Hick's Law: noise slows decisions [4] |
| Glassmorphism everywhere | Trend, not purpose [15] |

---

## Extended References

- `references/sources.md` — Full bibliography (30 sources)
- `references/patterns.md` — Extended correct patterns with citations
- `references/violations.md` — Extended violation examples with citations
- `references/detection.md` — Grep patterns for finding issues

---

## Checklist

- [ ] Typography scale is mathematical; font choice has documented rationale [6][10]
- [ ] Color system uses 3-layer tokens (primitives → semantic → component) [1][9]
- [ ] All text meets WCAG contrast minimums (4.5:1 / 3:1) [14][26]
- [ ] Dark mode designed intentionally — no invert filter [23]
- [ ] Spacing follows 4px/8px base grid — no magic numbers [1][13]
- [ ] Animations communicate state; `prefers-reduced-motion` respected [24]
- [ ] Component elevation (shadow, radius) signals interactivity level [1][11]
- [ ] No AI slop patterns present [4][15]
- [ ] Visual hierarchy via whitespace and spacing — not lines or boxes [5][30]

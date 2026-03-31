# UI Design Violations

Extended violation patterns for UI design reviews. Reference from main SKILL.md.
Sources in `references/sources.md`.

---

## Typography Violations [6][7][10]

### No Rationale for Font Choice [6][27]

```css
/* VIOLATION: Default sans-serif without justification [6] */
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
/* Why Inter? What personality does it convey for this product? */

/* VIOLATION: Trend-following font choice */
body { font-family: 'Poppins', sans-serif; }
/* Poppins is everywhere — is it right for YOUR product? [6] */
```

### Flat Type Hierarchy [7][10][15]

```css
/* VIOLATION: Minimal size difference, identical weight [10][15] */
h1 { font-size: 24px; font-weight: 600; }
h2 { font-size: 22px; font-weight: 600; }
h3 { font-size: 20px; font-weight: 600; }
h4 { font-size: 18px; font-weight: 600; }
/* Not a mathematical scale; users cannot scan content hierarchy [7] */

/* VIOLATION: No type variation beyond size */
.title    { font-size: 2rem; }
.subtitle { font-size: 1.5rem; }
.body     { font-size: 1rem; }
/* Weight, tracking, and color are hierarchy tools too [7][15] */
```

### Poor Readability [6][7][19]

```css
/* VIOLATION: Too tight for body text — strains eyes [6] */
p { font-size: 16px; line-height: 1.2; }

/* VIOLATION: Line too long — exceeds 75ch optimal range [6][7] */
.content { max-width: 1200px; font-size: 16px; }
/* 150+ characters per line; readers lose their place [7] */

/* VIOLATION: Inconsistent line heights — no system [10] */
.card-title  { line-height: 1.1; }
.card-body   { line-height: 1.8; }
.card-footer { line-height: 1.4; }
/* Random values without ratio-based scale [10] */
```

---

## Color Violations [1][9][12][14]

### Random Hex Values [1][9][15]

```css
/* VIOLATION: Colors without three-layer token system [1][9] */
.button-primary   { background: #4f46e5; }
.button-secondary { background: #6366f1; }
.link             { color: #3b82f6; }
.error            { color: #ef4444; }
/* Multiple blues with no semantic meaning or relationship [12] */

/* VIOLATION: Inline color overrides break system [9] */
<span style={{ color: '#8b5cf6' }}>Special text</span>
/* One-off values outside the token system cannot be themed */
```

### AI Slop Gradients [15]

```css
/* VIOLATION: Template gradient with no brand relevance [15] */
.hero { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }

/* VIOLATION: Purple-pink gradient copied from templates [15] */
.button { background: linear-gradient(to right, #ec4899, #8b5cf6); }
/* Seen on thousands of sites — communicates nothing specific */

/* VIOLATION: Gradient on text without semantic purpose */
.heading {
  background: linear-gradient(90deg, #f97316, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
/* Eye-catching, but what does the gradient communicate? [11] */
```

### Dark Mode Afterthoughts [1][23]

```css
/* VIOLATION: Invert filter hack — inverts images, ruins UI [23] */
@media (prefers-color-scheme: dark) {
  body { filter: invert(1) hue-rotate(180deg); }
  img  { filter: invert(1) hue-rotate(180deg); }
}

/* VIOLATION: Only swapping background — text/border/shadow remain broken */
.dark { background: #1a1a1a; }

/* VIOLATION: Inconsistent design language across modes */
.card { background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.dark .card {
  background: #2d2d2d;
  border: 1px solid #444; /* Shadows become borders — no consistency [1] */
}
```

### Contrast Failures [14][26]

```css
/* VIOLATION: Same primary blue on dark background — poor contrast [14] */
:root        { --primary: #0066cc; }
.dark .link  { color: var(--primary); } /* Unverified on dark surface */

/* VIOLATION: Shadow invisible on dark background [14] */
.dark .card { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
/* Near-black on black — effectively no elevation cue */
```

---

## Motion Violations [4][11][24]

### Decorative Animation [4][11]

```css
/* VIOLATION: Animation without state communication [11] */
.logo { animation: float 3s ease-in-out infinite; }
/* Why is the logo floating? What does it tell the user? */

/* VIOLATION: Pulsing CTA — Hick's Law: noise slows decisions [4] */
.cta-button { animation: pulse 2s infinite; }

/* VIOLATION: Spinners for instant operations */
.loading { animation: spin 1s linear infinite; }
/* Users experience false latency on sub-100ms operations */
```

### Inconsistent Timing [1][4]

```css
/* VIOLATION: Random durations — no timing system [1] */
.modal   { transition: opacity 0.35s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.dropdown { transition: all 0.2s linear; }
.tooltip { transition: opacity 150ms; }
.button  { transition: background 0.1s, transform 0.15s, box-shadow 0.2s; }
/* Inconsistent rhythm; UI feels unpolished [4] */

/* VIOLATION: "all" transition — animates layout properties [18] */
.card { transition: all 0.3s ease; }
/* Causes width/height layout shifts on resize */
```

### Missing Reduced Motion [24][26]

```css
/* VIOLATION: No @media (prefers-reduced-motion) declaration [24][26] */
/* Affects users with vestibular disorders, epilepsy, motion sensitivity */
/* WCAG 2.2 Success Criterion 2.3.3 (AAA) and 2.3.1 (A for flashing) */
```

---

## Spacing Violations [1][13][15]

### Magic Numbers [13][15]

```css
/* VIOLATION: Values outside 4px grid — no relationship [13] */
.card   { padding: 18px 22px; margin-bottom: 13px; }
.header { padding: 14px 20px; margin-bottom: 27px; }
/* Arbitrary numbers; cannot be reasoned about as a system */

/* VIOLATION: Non-grid pixel values scattered throughout [1] */
.section { margin: 47px 0; }
.title   { margin-bottom: 11px; }
.button  { padding: 9px 17px; }
```

### No Spatial Hierarchy [5][13][15]

```tsx
// VIOLATION: Uniform spacing ignores Gestalt proximity [5]
* + * { margin-top: 1rem; }
/* Everything equally spaced — no grouping cues */

// VIOLATION: Same gap regardless of relationship [5][15]
.grid   { gap: 16px; }
.stack  { gap: 16px; }
.inline { gap: 16px; }
```

---

## Layout Violations [5][11][15][30]

### Everything Centered [5][30]

```css
/* VIOLATION: Centered layout everywhere — no reading flow [30] */
.page    { text-align: center; }
.card    { text-align: center; }
.section { text-align: center; }
/* Centered text works for headings; body text needs left-aligned flow [6] */
```

### Border Radius Overuse [1][15]

```css
/* VIOLATION: Identical radius on all components — no scale signal [1][15] */
.button { border-radius: 12px; }
.card   { border-radius: 12px; }
.input  { border-radius: 12px; }
.avatar { border-radius: 12px; } /* Should be 9999px — full circle */
.badge  { border-radius: 12px; } /* Should be 4px — small element */
```

### Shadow Abuse [1][11][15]

```css
/* VIOLATION: Same shadow on everything — elevation loses meaning [11] */
.card   { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.button { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.input  { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.header { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
/* If everything is elevated, nothing is [1] */

/* VIOLATION: Deep shadow on micro element */
.badge { box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
```

---

## Component Violations [3][4][15]

### Generic Hero Sections [11][15]

```tsx
// VIOLATION: Template hero — seen on thousands of sites [15]
<section className="hero bg-gradient-to-r from-purple-600 to-pink-500">
  <div className="container mx-auto text-center text-white">
    <h1 className="text-5xl font-bold mb-4">Welcome to Our Platform</h1>
    <p className="text-xl mb-8">The best solution for your needs</p>
    <button className="bg-white text-purple-600 rounded-full px-8 py-3">
      Get Started
    </button>
  </div>
</section>
/* What product is this? What does the gradient communicate? [11] */
```

### Glassmorphism Everywhere [15]

```css
/* VIOLATION: Blur on every surface — decorative, not functional [15] */
.card  { background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); }
.modal { background: rgba(255,255,255,0.15); backdrop-filter: blur(20px); }
.nav   { background: rgba(255,255,255,0.1); backdrop-filter: blur(8px); }
/* Performance cost; legibility risk; trend not purpose [4] */
```

### Trend-Following Layouts [4][5]

```css
/* VIOLATION: Bento grid because it's trendy — not because it serves content [4] */
.features { display: grid; grid-template-columns: repeat(4, 1fr); }
.feature-1 { grid-column: span 2; grid-row: span 2; }
/* Does this layout aid comprehension or just look "cool"? [5] */

/* VIOLATION: Scroll animations on everything — Miller's Law: cognitive overload [4] */
.section {
  opacity: 0;
  transform: translateY(50px);
  transition: all 0.6s ease; /* Blocks content consumption */
}
```

---

## Responsive Violations [8][22]

### Desktop-First with Broken Mobile [8]

```css
/* VIOLATION: Mobile treatment is "hide everything" [8] */
.sidebar { width: 300px; }
.content { margin-left: 300px; }

@media (max-width: 768px) {
  .sidebar { display: none; } /* Content hidden, not adapted */
  .content { margin-left: 0; }
}
```

### Breakpoint Chaos [8][22]

```css
/* VIOLATION: Too many breakpoints — impossible to reason about [8] */
@media (max-width: 1200px) { ... }
@media (max-width: 992px)  { ... }
@media (max-width: 768px)  { ... }
@media (max-width: 576px)  { ... }
@media (max-width: 480px)  { ... }
@media (max-width: 375px)  { ... }
/* Use 2–3 intentional breakpoints; prefer container queries [22] */
```

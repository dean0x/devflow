# Frontend Design Violations

Extended violation patterns for frontend design reviews. Reference from main SKILL.md.

## Typography Violations

### No Rationale for Font Choice

```css
/* VIOLATION: Default sans-serif without justification */
body {
  font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
}
/* Why Inter? What personality does it convey? How does it serve the product? */

/* VIOLATION: Trend-following font choice */
body {
  font-family: 'Poppins', sans-serif;
}
/* Poppins is everywhere. Is it right for YOUR product? */
```

### Flat Hierarchy

```css
/* VIOLATION: No visual distinction between heading levels */
h1 { font-size: 24px; font-weight: 600; }
h2 { font-size: 22px; font-weight: 600; }
h3 { font-size: 20px; font-weight: 600; }
h4 { font-size: 18px; font-weight: 600; }
/* All look the same - users can't scan content */

/* VIOLATION: Only size differentiates, nothing else */
.title { font-size: 2rem; }
.subtitle { font-size: 1.5rem; }
.body { font-size: 1rem; }
/* No weight, spacing, or color variation */
```

### Poor Readability

```css
/* VIOLATION: Line height too tight for body text */
p {
  font-size: 16px;
  line-height: 1.2;
}

/* VIOLATION: Lines too long */
.content {
  max-width: 1200px; /* 150+ characters per line */
  font-size: 16px;
}

/* VIOLATION: Inconsistent line heights */
.card-title { line-height: 1.1; }
.card-body { line-height: 1.8; }
.card-footer { line-height: 1.4; }
/* Random values, no system */
```

---

## Color Violations

### Random Hex Values

```css
/* VIOLATION: Colors without system */
.button-primary { background: #4f46e5; }
.button-secondary { background: #6366f1; }
.link { color: #3b82f6; }
.error { color: #ef4444; }
.success { color: #22c55e; }
/* Different blues, no relationship, no semantic meaning */

/* VIOLATION: Inline color overrides */
<span style={{ color: '#8b5cf6' }}>Special text</span>
<div style={{ background: '#fef3c7' }}>Warning area</div>
/* One-off colors that don't fit the system */
```

### AI Slop Gradients

```css
/* VIOLATION: Template gradient with no brand relevance */
.hero {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* VIOLATION: Gradient just because "it's modern" */
.button {
  background: linear-gradient(to right, #ec4899, #8b5cf6);
}
/* Purple-pink gradient copied from every template */

/* VIOLATION: Gradient on text without purpose */
.heading {
  background: linear-gradient(90deg, #f97316, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
/* Eye-catching but what does it communicate? */
```

### Dark Mode Afterthoughts

```css
/* VIOLATION: Invert filter hack */
@media (prefers-color-scheme: dark) {
  body { filter: invert(1) hue-rotate(180deg); }
  img { filter: invert(1) hue-rotate(180deg); }
}

/* VIOLATION: Only swapping background */
.dark {
  background: #1a1a1a;
  /* Text colors, borders, shadows all broken */
}

/* VIOLATION: Different design language in dark mode */
.card {
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.dark .card {
  background: #2d2d2d;
  border: 1px solid #444;
  /* Shadows become borders - inconsistent */
}
```

---

## Motion Violations

### Decorative Animation

```css
/* VIOLATION: Animation without purpose */
.logo {
  animation: float 3s ease-in-out infinite;
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
/* Why is the logo floating? */

/* VIOLATION: Pulsing buttons */
.cta-button {
  animation: pulse 2s infinite;
}
/* Desperate attention-seeking, not communication */

/* VIOLATION: Spinning loaders everywhere */
.loading { animation: spin 1s linear infinite; }
/* Even for instant operations */
```

### Inconsistent Timing

```css
/* VIOLATION: Random durations */
.modal {
  transition: opacity 0.35s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.dropdown {
  transition: all 0.2s linear;
}
.tooltip {
  transition: opacity 150ms;
}
.button {
  transition: background 0.1s, transform 0.15s, box-shadow 0.2s;
}
/* No timing system, feels inconsistent */

/* VIOLATION: "all" transition */
.card {
  transition: all 0.3s ease;
}
/* Animates everything including width/height layout shifts */
```

### Jarring Easing

```css
/* VIOLATION: Linear easing for UI (feels robotic) */
.menu {
  transition: transform 0.3s linear;
}

/* VIOLATION: Aggressive bounce on everything */
.button {
  transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
/* Bounce has its place, but not everywhere */
```

---

## Spacing Violations

### Magic Numbers

```css
/* VIOLATION: Random spacing values */
.card {
  padding: 18px 22px;
  margin-bottom: 13px;
}
.header {
  padding: 14px 20px;
  margin-bottom: 27px;
}
/* No relationship between values */

/* VIOLATION: Pixel values everywhere */
.section { margin: 47px 0; }
.title { margin-bottom: 11px; }
.button { padding: 9px 17px; }
```

### No Spacing System

```tsx
// VIOLATION: Hardcoded spacing in components
<div style={{ padding: '12px 16px', marginBottom: '24px' }}>
  <h2 style={{ marginBottom: '8px' }}>Title</h2>
  <p style={{ marginBottom: '16px' }}>Content</p>
</div>

// VIOLATION: Inconsistent Tailwind spacing
<div className="p-4 mb-6">
  <div className="p-3 mb-5">
    <div className="p-2 mb-4">
      {/* Different patterns at each level */}
    </div>
  </div>
</div>
```

### Uniform Spacing (No Hierarchy)

```css
/* VIOLATION: Lobotomized owl selector misuse */
* + * {
  margin-top: 1rem;
}
/* Everything has same spacing - no visual grouping */

/* VIOLATION: Same gap everywhere */
.grid { gap: 16px; }
.stack { gap: 16px; }
.inline { gap: 16px; }
/* No context-appropriate spacing */
```

---

## Layout Violations

### Everything Centered

```css
/* VIOLATION: Centered text everywhere */
.page {
  text-align: center;
}
.card {
  text-align: center;
}
.section {
  text-align: center;
}
/* No reading flow, no hierarchy */

/* VIOLATION: Centered layout regardless of content */
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
```

### Border Radius Overuse

```css
/* VIOLATION: Same radius on everything */
.button { border-radius: 12px; }
.card { border-radius: 12px; }
.input { border-radius: 12px; }
.avatar { border-radius: 12px; }
.badge { border-radius: 12px; }
.modal { border-radius: 12px; }
/* Avatar should be round, badge should be small radius */

/* VIOLATION: Excessive rounding */
.container {
  border-radius: 24px;
}
/* Large containers look like floating blobs */
```

### Shadow Abuse

```css
/* VIOLATION: Shadow on everything */
.card { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.button { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.input { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.header { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
/* If everything is elevated, nothing is */

/* VIOLATION: Deep shadows for no reason */
.badge {
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
}
/* Tiny element with massive shadow */
```

---

## Component Violations

### Generic Hero Sections

```tsx
// VIOLATION: Template hero with no customization
<section className="hero bg-gradient-to-r from-purple-600 to-pink-500">
  <div className="container mx-auto text-center text-white">
    <h1 className="text-5xl font-bold mb-4">Welcome to Our Platform</h1>
    <p className="text-xl mb-8">The best solution for your needs</p>
    <button className="bg-white text-purple-600 rounded-full px-8 py-3">
      Get Started
    </button>
  </div>
</section>
/* Seen this exact layout on 10,000 websites */
```

### Glassmorphism Everywhere

```css
/* VIOLATION: Blur background without purpose */
.card {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
}
.modal {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(20px);
}
.nav {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
}
/* Glass effect is a choice, not a default */
```

### Trend-Following Patterns

```css
/* VIOLATION: Bento grid because it's trendy */
.features {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(2, 1fr);
}
.feature-1 { grid-column: span 2; grid-row: span 2; }
.feature-2 { grid-column: span 2; }
/* Does this layout serve the content or is it just "cool"? */

/* VIOLATION: Scroll-triggered animations on everything */
.section {
  opacity: 0;
  transform: translateY(50px);
}
.section.visible {
  opacity: 1;
  transform: translateY(0);
  transition: all 0.6s ease;
}
/* Slows down content consumption */
```

---

## Responsive Violations

### Afterthought Mobile

```css
/* VIOLATION: Desktop-first with broken mobile */
.sidebar { width: 300px; }
.content { margin-left: 300px; }

@media (max-width: 768px) {
  .sidebar { display: none; } /* Just hide everything */
  .content { margin-left: 0; }
}
```

### Breakpoint Chaos

```css
/* VIOLATION: Inconsistent breakpoints */
@media (max-width: 1200px) { ... }
@media (max-width: 992px) { ... }
@media (max-width: 768px) { ... }
@media (max-width: 576px) { ... }
@media (max-width: 480px) { ... }
@media (max-width: 375px) { ... }
/* Too many breakpoints, impossible to reason about */
```

---

## Dark Mode Violations (Extended)

### Contrast Inversions

```css
/* VIOLATION: Colors that work in light don't work in dark */
:root {
  --primary: #0066cc;
}
.dark {
  /* Same blue on dark background - poor contrast */
}

/* VIOLATION: Shadows become invisible */
.card {
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.dark .card {
  /* Same shadow on dark background - invisible */
}
```

### Inconsistent Dark Surfaces

```css
/* VIOLATION: Random dark grays */
.dark .bg-1 { background: #1a1a1a; }
.dark .bg-2 { background: #2d2d2d; }
.dark .bg-3 { background: #333333; }
.dark .bg-4 { background: #3d3d3d; }
/* No intentional hierarchy */
```

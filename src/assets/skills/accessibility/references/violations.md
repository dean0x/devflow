# Accessibility Violations

Extended violation patterns for accessibility reviews. Reference from main SKILL.md.
Sources in `references/sources.md`.

---

## Keyboard Navigation Violations [1][3]

### No Keyboard Access [1]

```tsx
// VIOLATION: onClick without keyboard equivalent — WCAG 2.1.1 [1]
<div onClick={handleClick} className="card">Click me</div>

// VIOLATION: Custom element not focusable [1]
<span className="link" onClick={() => navigate('/page')}>Go to page</span>

// VIOLATION: Drag-only interaction — no keyboard alternative [1] §2.1.1
<div draggable onDragStart={handleDrag} onDragEnd={handleDrop}>
  Drag me
</div>
```

### Missing Focus Management [3]

```tsx
// VIOLATION: Modal doesn't trap focus — APG dialog requirement [3]
function Modal({ isOpen, children }) {
  return isOpen ? (
    <div className="modal-overlay">
      <div className="modal-content">
        {children}
        <button onClick={onClose}>Close</button>
        {/* Focus can escape to background; no return-focus on close */}
      </div>
    </div>
  ) : null;
}

// VIOLATION: Dropdown doesn't return focus on close [3]
function Dropdown() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(true)}>Open</button>
      {isOpen && (
        <ul>
          <li onClick={() => setIsOpen(false)}>Option 1</li>
          {/* Focus lost when dropdown closes */}
        </ul>
      )}
    </div>
  );
}
```

### Poor Focus Visibility [1][16]

```css
/* VIOLATION: Focus removed entirely — fails WCAG 2.4.7 and 2.4.11 [1][16] */
*:focus { outline: none; }

/* VIOLATION: Focus invisible on dark backgrounds [16] */
button:focus { outline: 1px solid #333; }

/* VIOLATION: Focus style same as hover — no distinct focus indicator [1] §2.4.7 */
button:hover, button:focus { background: #eee; }
```

### Illogical Tab Order [1]

```tsx
// VIOLATION: Positive tabIndex breaks natural DOM order — WCAG 2.4.3 [1]
<div>
  <input tabIndex={3} placeholder="Third" />
  <input tabIndex={1} placeholder="First" />
  <input tabIndex={2} placeholder="Second" />
</div>
```

---

## ARIA Violations [2][15]

### Missing Labels [1][5]

```tsx
// VIOLATION: Icon button without accessible name — WebAIM Million #4 violation [5]
<button onClick={handleClose}><CloseIcon /></button>

// VIOLATION: Input without label — WebAIM Million #1 violation [5]
<input type="text" placeholder="Search" />

// VIOLATION: Image without alt — WebAIM Million #3 violation [5]
<img src="/logo.png" />

// VIOLATION: Link without text content [1] §2.4.4
<a href="/profile"><Avatar src={user.avatar} /></a>
```

### Incorrect ARIA Usage [2][15]

```tsx
// VIOLATION: role="button" on already-button element — redundant [15]
<button role="button" onClick={handleClick}>Submit</button>

// VIOLATION: aria-hidden on focusable element — keyboard trap [2]
<button aria-hidden="true" onClick={handleClick}>Hidden but focusable</button>

// VIOLATION: Missing required ARIA attributes — incomplete widget [2]
<div role="slider">
  {/* Missing aria-valuenow, aria-valuemin, aria-valuemax */}
</div>

// VIOLATION: aria-label duplicating visible text — redundant, no benefit [15]
<button aria-label="Submit form">Submit form</button>
```

### Overuse of ARIA [15][18]

```tsx
// VIOLATION: ARIA where semantic HTML suffices — "no ARIA is better than bad ARIA" [15]
<div role="navigation" aria-label="Main navigation">
  <div role="list">
    <div role="listitem">
      <div role="link" onClick={() => navigate('/')}>Home</div>
    </div>
  </div>
</div>

// CORRECT: Native HTML [18]
<nav aria-label="Main">
  <ul><li><a href="/">Home</a></li></ul>
</nav>
```

---

## Color and Contrast Violations [1][5]

### Insufficient Contrast [1]

```css
/* VIOLATION: Light gray on white — ~1.5:1, fails AA [1] §1.4.3 — WebAIM Million #2 [5] */
.muted-text { color: #aaa; background: #fff; }

/* VIOLATION: Placeholder text too light */
input::placeholder { color: #ccc; }

/* VIOLATION: Disabled state invisible */
button:disabled { color: #eee; background: #f5f5f5; }
```

### Color-Only Information [1]

```tsx
// VIOLATION: Status only indicated by color — fails WCAG 1.4.1 [1]
<span style={{ color: status === 'error' ? 'red' : 'green' }}>{status}</span>

// VIOLATION: Required fields only marked red [1]
<label style={{ color: required ? 'red' : 'inherit' }}>{label}</label>

// VIOLATION: Chart using only color to differentiate data [1]
<LineChart>
  <Line stroke="red" data={series1} />
  <Line stroke="blue" data={series2} />
  {/* No pattern, icon, or label differentiation */}
</LineChart>
```

---

## Form Violations [1][5]

### Missing Error Association [1]

```tsx
// VIOLATION: Error not associated with input — WCAG 3.3.1 [1]
<div>
  <input id="email" type="email" />
  {error && <span className="error">{error}</span>}
  {/* No aria-describedby linking input to error */}
</div>

// VIOLATION: Error not announced to screen readers [1]
<div>
  <input aria-invalid={!!error} />
  {error && <div className="error-message">{error}</div>}
  {/* No role="alert" or aria-live */}
</div>
```

### Placeholder as Label [1][5]

```tsx
// VIOLATION: Placeholder disappears — WebAIM Million #1 violation [5]
<input placeholder="Email address" />

// VIOLATION: Floating label hidden initially — no persistent label [1] §1.3.1
function FloatingInput({ label }) {
  const [value, setValue] = useState('');
  return (
    <div>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
      <label className={value ? 'floating' : 'hidden'}>{label}</label>
    </div>
  );
}
```

### Form Not Keyboard Navigable [1][3]

```tsx
// VIOLATION: Custom select not keyboard accessible — fails WCAG 2.1.1 [1]
function CustomSelect({ options, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="select" onClick={() => setIsOpen(!isOpen)}>
      <span>{value}</span>
      {isOpen && (
        <ul className="options">
          {options.map(opt => <li onClick={() => onChange(opt)}>{opt}</li>)}
        </ul>
      )}
    </div>
  );
}
```

---

## Motion and Animation Violations [1]

### No Reduced Motion Support [1]

```css
/* VIOLATION: Animation ignores user preference — fails WCAG 2.3.3 [1] */
.hero { animation: slideIn 1s ease-in-out; }
/* No @media (prefers-reduced-motion: reduce) counterpart */
```

### Autoplay Without Pause [1]

```tsx
// VIOLATION: Video autoplays without pause control — WCAG 2.2.2 [1]
<video autoPlay loop muted><source src="/background.mp4" /></video>

// VIOLATION: Carousel auto-advances without pause [1]
function Carousel({ slides }) {
  useEffect(() => {
    const interval = setInterval(nextSlide, 3000);
    return () => clearInterval(interval);
  }, []);
  // No pause on hover, focus, or user control
}
```

### Flashing Content [1]

```css
/* VIOLATION: Flash rate > 3Hz — risks seizures, fails WCAG 2.3.1 [1] */
@keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
.alert { animation: flash 0.2s infinite; }
```

---

## Touch Target Violations [1][8][16]

### Small Touch Targets [1][16]

```css
/* VIOLATION: Below WCAG 2.5.8 minimum of 24×24px [16] */
.icon-btn { width: 24px; height: 24px; padding: 4px; }

/* VIOLATION: Inline links with no padding */
.inline-link { /* Natural text height only — no extra tap area */ }

/* VIOLATION: Close button too small and in corner */
.modal-close { position: absolute; top: 4px; right: 4px; width: 16px; height: 16px; }
```

### Targets Too Close Together [1][8]

```tsx
// VIOLATION: Adjacent small targets without spacing [8]
<div className="button-group">
  <button className="icon-btn">A</button>
  <button className="icon-btn">B</button>
  <button className="icon-btn">C</button>
  {/* No spacing between 24px buttons — combined miss area */}
</div>
```

---

## Screen Reader Violations [4][6]

### Hidden Important Content [1][4]

```tsx
// VIOLATION: aria-hidden on important element — hides from all AT [2]
<main aria-hidden="true">{/* Page content invisible to screen readers */}</main>

// VIOLATION: sr-only misimplemented — content not exposed [4]
<span style={{ display: 'none' }}>Loading...</span>  {/* display:none hides from AT */}
```

### Meaningless Link Text [1][6]

```tsx
// VIOLATION: Generic link text — fails WCAG 2.4.4 [1]; users navigate by link list [6]
<p>To learn more, <a href="/services">click here</a>.</p>

// VIOLATION: Repeated "Read more" links — indistinguishable out of context [6]
{posts.map(post => (
  <article>
    <h2>{post.title}</h2>
    <a href={post.url}>Read more</a>
  </article>
))}
```

### Missing Page Structure [1][4]

```tsx
// VIOLATION: No landmark regions — screen reader navigation impossible [1] §1.3.6
function App() {
  return (
    <div>
      <div className="header">...</div>
      <div className="sidebar">...</div>
      <div className="content">...</div>
    </div>
  );
}

// VIOLATION: Skipped heading levels — breaks document outline [1] §1.3.1
<h1>Page Title</h1>
<h3>Section</h3>   {/* h2 skipped */}
<h5>Subsection</h5> {/* h4 skipped */}
```

---

## Cognitive Accessibility Violations [17]

```tsx
// VIOLATION: Inaccessible authentication — WCAG 3.3.8 [16][17]
<input type="password" onPaste={(e) => e.preventDefault()} />
// Blocking paste forces users to type complex passwords,
// harming users with cognitive disabilities or password managers

// VIOLATION: Vague error message — no recovery path [17]
{error && <span role="alert">Invalid input.</span>}
// Should identify the field, the error, and how to fix it
```

# Accessibility Violations

Extended violation patterns for accessibility reviews. Reference from main SKILL.md.

## Keyboard Navigation Violations

### No Keyboard Access

```tsx
// VIOLATION: onClick without keyboard equivalent
<div onClick={handleClick} className="card">
  Click me
</div>

// VIOLATION: Custom element not focusable
<span className="link" onClick={() => navigate('/page')}>
  Go to page
</span>

// VIOLATION: Drag-only interaction
<div
  draggable
  onDragStart={handleDrag}
  onDragEnd={handleDrop}
>
  Drag me (no keyboard alternative)
</div>
```

### Missing Focus Management

```tsx
// VIOLATION: Modal doesn't trap focus
function Modal({ isOpen, children }) {
  return isOpen ? (
    <div className="modal-overlay">
      <div className="modal-content">
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  ) : null;
}

// VIOLATION: Dropdown doesn't return focus on close
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

### Poor Focus Visibility

```css
/* VIOLATION: Focus removed entirely */
*:focus {
  outline: none;
}

/* VIOLATION: Focus invisible on dark backgrounds */
button:focus {
  outline: 1px solid #333;
}

/* VIOLATION: Focus style same as hover */
button:hover,
button:focus {
  background: #eee;
}
```

### Illogical Tab Order

```tsx
// VIOLATION: tabIndex breaks natural order
<div>
  <input tabIndex={3} placeholder="Third" />
  <input tabIndex={1} placeholder="First" />
  <input tabIndex={2} placeholder="Second" />
</div>

// VIOLATION: Positive tabIndex on many elements
<nav>
  <a href="/" tabIndex={1}>Home</a>
  <a href="/about" tabIndex={2}>About</a>
  <a href="/contact" tabIndex={3}>Contact</a>
</nav>
```

---

## ARIA Violations

### Missing Labels

```tsx
// VIOLATION: Icon button without accessible name
<button onClick={handleClose}>
  <CloseIcon />
</button>

// VIOLATION: Input without label
<input type="text" placeholder="Search" />

// VIOLATION: Image without alt
<img src="/logo.png" />

// VIOLATION: Link without text
<a href="/profile">
  <Avatar src={user.avatar} />
</a>
```

### Incorrect ARIA Usage

```tsx
// VIOLATION: role="button" on already-button element
<button role="button" onClick={handleClick}>Submit</button>

// VIOLATION: aria-hidden on focusable element
<button aria-hidden="true" onClick={handleClick}>
  Hidden but focusable
</button>

// VIOLATION: Missing required ARIA attributes
<div role="slider">
  {/* Missing aria-valuenow, aria-valuemin, aria-valuemax */}
</div>

// VIOLATION: aria-label duplicating visible text
<button aria-label="Submit form">Submit form</button>
```

### Overuse of ARIA

```tsx
// VIOLATION: ARIA where semantic HTML suffices
<div role="navigation" aria-label="Main navigation">
  <div role="list">
    <div role="listitem">
      <div role="link" onClick={() => navigate('/')}>Home</div>
    </div>
  </div>
</div>

// Should be:
<nav aria-label="Main">
  <ul>
    <li><a href="/">Home</a></li>
  </ul>
</nav>
```

---

## Color and Contrast Violations

### Insufficient Contrast

```css
/* VIOLATION: Light gray on white (1.5:1 ratio) */
.muted-text {
  color: #aaa;
  background: #fff;
}

/* VIOLATION: Placeholder text too light */
input::placeholder {
  color: #ccc;
}

/* VIOLATION: Disabled state invisible */
button:disabled {
  color: #eee;
  background: #f5f5f5;
}
```

### Color-Only Information

```tsx
// VIOLATION: Status only indicated by color
<span style={{ color: status === 'error' ? 'red' : 'green' }}>
  {status}
</span>

// VIOLATION: Required fields only marked red
<label style={{ color: required ? 'red' : 'inherit' }}>
  {label}
</label>

// VIOLATION: Chart using only color to differentiate data
<LineChart>
  <Line stroke="red" data={series1} />
  <Line stroke="blue" data={series2} />
  {/* No pattern, icon, or label differentiation */}
</LineChart>
```

---

## Form Violations

### Missing Error Association

```tsx
// VIOLATION: Error not associated with input
<div>
  <input id="email" type="email" />
  {error && <span className="error">{error}</span>}
</div>

// VIOLATION: Error not announced to screen readers
<div>
  <input aria-invalid={!!error} />
  {error && <div className="error-message">{error}</div>}
</div>
```

### Placeholder as Label

```tsx
// VIOLATION: Placeholder disappears, no persistent label
<input placeholder="Email address" />

// VIOLATION: Floating label without visible label initially
function FloatingInput({ label }) {
  const [value, setValue] = useState('');
  return (
    <div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <label className={value ? 'floating' : 'hidden'}>{label}</label>
    </div>
  );
}
```

### Form Not Keyboard Navigable

```tsx
// VIOLATION: Custom select not keyboard accessible
function CustomSelect({ options, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="select" onClick={() => setIsOpen(!isOpen)}>
      <span>{value}</span>
      {isOpen && (
        <ul className="options">
          {options.map(opt => (
            <li onClick={() => onChange(opt)}>{opt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

## Motion and Animation Violations

### No Reduced Motion Support

```css
/* VIOLATION: Animation ignores user preference */
.hero {
  animation: slideIn 1s ease-in-out;
}

@keyframes slideIn {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
```

### Autoplay Without Pause

```tsx
// VIOLATION: Video autoplays without pause control
<video autoPlay loop muted>
  <source src="/background.mp4" />
</video>

// VIOLATION: Carousel auto-advances without pause
function Carousel({ slides }) {
  useEffect(() => {
    const interval = setInterval(nextSlide, 3000);
    return () => clearInterval(interval);
  }, []);
  // No pause on hover or focus
}
```

### Flashing Content

```css
/* VIOLATION: Flash rate > 3 per second */
@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.alert {
  animation: flash 0.2s infinite;
}
```

---

## Touch Target Violations

### Small Touch Targets

```css
/* VIOLATION: Icon buttons too small */
.icon-btn {
  width: 24px;
  height: 24px;
  padding: 4px;
}

/* VIOLATION: Inline links with no padding */
.inline-link {
  /* Natural text height only */
}

/* VIOLATION: Close button in corner */
.modal-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 16px;
  height: 16px;
}
```

### Targets Too Close Together

```tsx
// VIOLATION: Adjacent small targets
<div className="button-group">
  <button className="icon-btn">A</button>
  <button className="icon-btn">B</button>
  <button className="icon-btn">C</button>
  {/* No spacing between 24px buttons */}
</div>
```

---

## Screen Reader Violations

### Hidden Important Content

```tsx
// VIOLATION: Visually hidden but important content
<span className="sr-only">
  Loading... {/* Never announced because sr-only wrong implementation */}
</span>

// VIOLATION: aria-hidden on important element
<main aria-hidden="true">
  {/* Page content hidden from AT */}
</main>
```

### Meaningless Link Text

```tsx
// VIOLATION: Generic link text
<p>
  To learn more about our services, <a href="/services">click here</a>.
</p>

// VIOLATION: Repeated "Read more" links
{posts.map(post => (
  <article>
    <h2>{post.title}</h2>
    <p>{post.excerpt}</p>
    <a href={post.url}>Read more</a>
  </article>
))}
```

### Missing Page Structure

```tsx
// VIOLATION: No landmark regions
function App() {
  return (
    <div>
      <div className="header">...</div>
      <div className="sidebar">...</div>
      <div className="content">...</div>
      <div className="footer">...</div>
    </div>
  );
}

// VIOLATION: Skipped heading levels
<h1>Page Title</h1>
<h3>Section</h3>  {/* h2 skipped */}
<h5>Subsection</h5>  {/* h4 skipped */}
```

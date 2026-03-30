# Accessibility Correct Patterns

Extended correct patterns for accessibility. Reference from main SKILL.md.
Sources in `references/sources.md`.

---

## Keyboard Navigation Patterns [1][3]

### Full Keyboard Support [3]

```tsx
// CORRECT: Custom interactive element with keyboard support — APG button pattern [3]
function ClickableCard({ onClick, children }) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
}

// CORRECT: Drag with keyboard alternative — every pointer interaction needs a keyboard path [1] §2.1.1
function DraggableItem({ item, onMove }) {
  return (
    <div draggable onDragStart={handleDrag} onDragEnd={handleDrop}>
      {item.name}
      <div className="keyboard-controls">
        <button aria-label="Move up" onClick={() => onMove('up')}>↑</button>
        <button aria-label="Move down" onClick={() => onMove('down')}>↓</button>
      </div>
    </div>
  );
}
```

### Focus Trap for Modals [3]

```tsx
// CORRECT: Complete focus management — APG dialog pattern [3]
function Modal({ isOpen, onClose, title, children }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocus.current = document.activeElement as HTMLElement;
      const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    } else {
      previousFocus.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab') return;
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };

  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2 id="modal-title">{title}</h2>
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

### Custom Focus Styles [1][16]

```css
/* CORRECT: Visible focus — meets WCAG 2.4.11 (≥2px, 3:1 contrast) [16] */
:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}
/* Remove outline only for mouse users */
:focus:not(:focus-visible) { outline: none; }
/* High contrast for dark backgrounds */
.dark-theme :focus-visible {
  outline: 2px solid #fff;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.5);
}
```

### Roving Tab Index [3]

```tsx
// CORRECT: Arrow key navigation within component — APG radio group pattern [3]
function RadioGroup({ options, value, onChange }) {
  const [focusIndex, setFocusIndex] = useState(0);
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let newIndex = index;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight':
        newIndex = (index + 1) % options.length; break;
      case 'ArrowUp': case 'ArrowLeft':
        newIndex = (index - 1 + options.length) % options.length; break;
      default: return;
    }
    e.preventDefault();
    setFocusIndex(newIndex);
    onChange(options[newIndex].value);
  };
  return (
    <div role="radiogroup">
      {options.map((option, index) => (
        <label key={option.value}>
          <input type="radio" name="radio-group" value={option.value}
            checked={value === option.value}
            tabIndex={index === focusIndex ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onChange={() => onChange(option.value)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}
```

---

## ARIA Patterns [2][3][15]

### Icon Buttons with Labels [2][5]

```tsx
// CORRECT: Accessible icon button — one of the most common violations [5]
<button aria-label="Close dialog" onClick={onClose}>
  <CloseIcon aria-hidden="true" />
</button>

// CORRECT: Icon with visible tooltip [2]
<button aria-describedby="tooltip-1" onClick={onSettings}>
  <SettingsIcon aria-hidden="true" />
  <span id="tooltip-1" role="tooltip" className="tooltip">Settings</span>
</button>
```

### Live Regions [2]

```tsx
// CORRECT: Status announcements — aria-live="polite" for non-urgent [2]
function SearchResults({ query, results, isLoading }) {
  return (
    <div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isLoading ? 'Searching...' : `${results.length} results for "${query}"`}
      </div>
      <ul>{results.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
    </div>
  );
}
```

### Expandable Content (Disclosure) [3]

```tsx
// CORRECT: Accordion — APG disclosure pattern [3]
function Accordion({ items }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          <h3>
            <button aria-expanded={expanded === item.id}
              aria-controls={`panel-${item.id}`}
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
              {item.title}
              <ChevronIcon aria-hidden="true" />
            </button>
          </h3>
          <div id={`panel-${item.id}`} role="region"
            aria-labelledby={`header-${item.id}`}
            hidden={expanded !== item.id}>
            {item.content}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Form Patterns [1][3][9]

### Accessible Form Field [1][3]

```tsx
// CORRECT: Complete accessible input with hint + error [1] §1.3.1, §3.3.1, §3.3.2
function FormField({ id, label, type = 'text', required, error, hint, ...props }) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="form-field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {hint && <p id={hintId} className="hint">{hint}</p>}
      <input id={id} type={type} required={required}
        aria-invalid={!!error} aria-describedby={describedBy} {...props} />
      {error && <p id={errorId} role="alert" className="error">{error}</p>}
    </div>
  );
}
```

---

## Color and Contrast Patterns [1][19]

### Sufficient Contrast [1]

```css
/* CORRECT: AA compliant contrast on white [1] §1.4.3 */
:root {
  --text-primary: #1a1a1a;    /* 16.1:1 */
  --text-secondary: #595959;  /* 7:1 */
  --text-muted: #767676;      /* 4.54:1 — minimum for normal text */
  --link-color: #0066cc;      /* 5.9:1 */
  --error-color: #c41e3a;     /* 5.4:1 */
  --success-color: #0a6640;   /* 7.2:1 */
}
input::placeholder { color: #767676; /* 4.5:1 minimum [1] */ }
```

### Non-Color Indicators [1]

```tsx
// CORRECT: Multiple indicators for state — never color alone [1] §1.4.1
function StatusBadge({ status }) {
  const config = {
    success: { color: 'green', icon: '✓', label: 'Success' },
    error:   { color: 'red',   icon: '✕', label: 'Error'   },
    warning: { color: 'orange', icon: '⚠', label: 'Warning' },
  };
  const { color, icon, label } = config[status];
  return (
    <span className={`badge badge-${color}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
```

---

## Touch Target Patterns [1][8][16]

```css
/* CORRECT: Meets WCAG 2.5.8 minimum (24×24px) and Material recommendation (48px) [8][16] */
.button { min-width: 44px; min-height: 44px; padding: 12px 16px; }

/* CORRECT: Expand touch area with padding while preserving visual size */
.icon-btn {
  width: 24px;
  height: 24px;
  padding: 10px; /* effective touch target: 44×44px */
}
```

---

## Screen Reader Patterns [4][6]

### Visually Hidden Content [4]

```css
/* CORRECT: Screen reader only — correct implementation [4] */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0;
  margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0);
  white-space: nowrap; border: 0;
}
.sr-only-focusable:focus {
  position: static; width: auto; height: auto;
  overflow: visible; clip: auto; white-space: normal;
}
```

### Meaningful Link Text [1]

```tsx
// CORRECT: Descriptive link text — screen reader users navigate by links [6]
{posts.map(post => (
  <article>
    <h2>{post.title}</h2>
    <p>{post.excerpt}</p>
    <a href={post.url}>
      Read full article: {post.title}
      <span className="sr-only">, posted {post.date}</span>
    </a>
  </article>
))}
```

### Proper Document Structure [1][4]

```tsx
// CORRECT: Landmark regions and heading hierarchy [1] §1.3.1, §2.4.1
function App() {
  return (
    <>
      <a href="#main" className="sr-only-focusable">Skip to main content</a>
      <header>
        <nav aria-label="Main">{/* Navigation */}</nav>
      </header>
      <aside aria-label="Sidebar">{/* Sidebar */}</aside>
      <main id="main" tabIndex={-1}>
        <h1>Page Title</h1>
        <section aria-labelledby="section-1">
          <h2 id="section-1">First Section</h2>
        </section>
      </main>
      <footer>
        <nav aria-label="Footer">{/* Footer nav */}</nav>
      </footer>
    </>
  );
}
```

---

## Motion Patterns [1]

### Reduced Motion Support [1]

```tsx
// CORRECT: JavaScript reduced motion check [1] §2.3.3
function AnimatedComponent({ children }) {
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReduced ? 0 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : 0.3 }}>
      {children}
    </motion.div>
  );
}
```

### Pausable Animations [1]

```tsx
// CORRECT: Carousel with pause controls — WCAG 2.2.2 [1]
function Carousel({ slides, autoPlay = true }) {
  const [isPaused, setIsPaused] = useState(!autoPlay);
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => setCurrent((c) => (c + 1) % slides.length), 5000);
    return () => clearInterval(timer);
  }, [isPaused, slides.length]);
  return (
    <div role="region" aria-roledescription="carousel" aria-label="Featured content"
      onMouseEnter={() => setIsPaused(true)} onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)} onBlur={() => setIsPaused(false)}>
      <button aria-label={isPaused ? 'Play carousel' : 'Pause carousel'}
        onClick={() => setIsPaused(!isPaused)}>
        {isPaused ? '▶' : '⏸'}
      </button>
    </div>
  );
}
```

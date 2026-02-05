# Accessibility Correct Patterns

Extended correct patterns for accessibility. Reference from main SKILL.md.

## Keyboard Navigation Patterns

### Full Keyboard Support

```tsx
// CORRECT: Custom interactive element with keyboard support
function ClickableCard({ onClick, children }) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="card"
    >
      {children}
    </div>
  );
}

// CORRECT: Drag with keyboard alternative
function DraggableItem({ item, onMove }) {
  return (
    <div
      draggable
      onDragStart={handleDrag}
      onDragEnd={handleDrop}
    >
      {item.name}
      <div className="keyboard-controls">
        <button aria-label="Move up" onClick={() => onMove('up')}>↑</button>
        <button aria-label="Move down" onClick={() => onMove('down')}>↓</button>
      </div>
    </div>
  );
}
```

### Focus Trap for Modals

```tsx
// CORRECT: Complete focus management
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
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 id="modal-title">{title}</h2>
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

### Custom Focus Styles

```css
/* CORRECT: Visible, accessible focus styles */
:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}

/* Remove outline only for mouse users */
:focus:not(:focus-visible) {
  outline: none;
}

/* High contrast focus for dark backgrounds */
.dark-theme :focus-visible {
  outline: 2px solid #fff;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.5);
}
```

### Roving Tab Index

```tsx
// CORRECT: Arrow key navigation within component
function RadioGroup({ options, value, onChange }) {
  const [focusIndex, setFocusIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let newIndex = index;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        newIndex = (index + 1) % options.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        newIndex = (index - 1 + options.length) % options.length;
        break;
      default:
        return;
    }

    e.preventDefault();
    setFocusIndex(newIndex);
    onChange(options[newIndex].value);
  };

  return (
    <div role="radiogroup">
      {options.map((option, index) => (
        <label key={option.value}>
          <input
            type="radio"
            name="radio-group"
            value={option.value}
            checked={value === option.value}
            tabIndex={index === focusIndex ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
```

---

## ARIA Patterns

### Icon Buttons with Labels

```tsx
// CORRECT: Accessible icon button
<button aria-label="Close dialog" onClick={onClose}>
  <CloseIcon aria-hidden="true" />
</button>

// CORRECT: Icon with visible tooltip
<button aria-describedby="tooltip-1" onClick={onSettings}>
  <SettingsIcon aria-hidden="true" />
  <span id="tooltip-1" role="tooltip" className="tooltip">
    Settings
  </span>
</button>
```

### Live Regions

```tsx
// CORRECT: Status announcements
function SearchResults({ query, results, isLoading }) {
  return (
    <div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {isLoading
          ? 'Searching...'
          : `${results.length} results found for "${query}"`}
      </div>
      <ul>
        {results.map((result) => (
          <li key={result.id}>{result.title}</li>
        ))}
      </ul>
    </div>
  );
}

// CORRECT: Form submission feedback
function SubmitButton({ isSubmitting, success, error }) {
  return (
    <>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Submitting...' : 'Submit'}
      </button>
      <div role="status" aria-live="assertive">
        {success && <p>Form submitted successfully!</p>}
        {error && <p role="alert">Error: {error}</p>}
      </div>
    </>
  );
}
```

### Expandable Content

```tsx
// CORRECT: Accordion with proper ARIA
function Accordion({ items }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          <h3>
            <button
              aria-expanded={expanded === item.id}
              aria-controls={`panel-${item.id}`}
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            >
              {item.title}
              <ChevronIcon aria-hidden="true" />
            </button>
          </h3>
          <div
            id={`panel-${item.id}`}
            role="region"
            aria-labelledby={`header-${item.id}`}
            hidden={expanded !== item.id}
          >
            {item.content}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Form Patterns

### Accessible Form Field

```tsx
// CORRECT: Complete accessible input
function FormField({
  id,
  label,
  type = 'text',
  required,
  error,
  hint,
  ...props
}) {
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

      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}

      <input
        id={id}
        type={type}
        required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...props}
      />

      {error && (
        <p id={errorId} role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
```

### Accessible Select

```tsx
// CORRECT: Custom select with full keyboard support
function Select({ label, options, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        if (isOpen) {
          onChange(options[focusIndex].value);
          setIsOpen(false);
          buttonRef.current?.focus();
        } else {
          setIsOpen(true);
        }
        e.preventDefault();
        break;
      case 'ArrowDown':
        if (isOpen) {
          setFocusIndex((i) => Math.min(i + 1, options.length - 1));
        } else {
          setIsOpen(true);
        }
        e.preventDefault();
        break;
      case 'ArrowUp':
        if (isOpen) {
          setFocusIndex((i) => Math.max(i - 1, 0));
        }
        e.preventDefault();
        break;
      case 'Escape':
        setIsOpen(false);
        buttonRef.current?.focus();
        break;
    }
  };

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className="select-wrapper" onKeyDown={handleKeyDown}>
      <label id="select-label">{label}</label>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-labelledby="select-label"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedOption?.label || 'Select...'}
      </button>
      {isOpen && (
        <ul
          ref={listRef}
          role="listbox"
          aria-labelledby="select-label"
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={index === focusIndex ? 'focused' : ''}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

## Color and Contrast Patterns

### Sufficient Contrast

```css
/* CORRECT: AA compliant contrast ratios */
:root {
  /* Text colors with sufficient contrast on white */
  --text-primary: #1a1a1a;    /* 16.1:1 */
  --text-secondary: #595959;  /* 7:1 */
  --text-muted: #767676;      /* 4.54:1 - minimum for normal text */

  /* Interactive element colors */
  --link-color: #0066cc;      /* 5.9:1 */
  --error-color: #c41e3a;     /* 5.4:1 */
  --success-color: #0a6640;   /* 7.2:1 */
}

/* CORRECT: Placeholder with sufficient contrast */
input::placeholder {
  color: #767676;  /* 4.5:1 minimum */
}
```

### Non-Color Indicators

```tsx
// CORRECT: Multiple indicators for state
function StatusBadge({ status }) {
  const config = {
    success: { color: 'green', icon: '✓', label: 'Success' },
    error: { color: 'red', icon: '✕', label: 'Error' },
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

// CORRECT: Chart with patterns
function AccessibleChart({ data }) {
  const patterns = ['solid', 'dashed', 'dotted', 'dash-dot'];

  return (
    <LineChart>
      {data.map((series, i) => (
        <Line
          key={series.name}
          stroke={series.color}
          strokeDasharray={patterns[i]}
          name={series.name}
        />
      ))}
      <Legend />
    </LineChart>
  );
}
```

---

## Motion Patterns

### Reduced Motion Support

```tsx
// CORRECT: JavaScript reduced motion check
function AnimatedComponent({ children }) {
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReduced ? 0 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReduced ? 0 : 0.3,
      }}
    >
      {children}
    </motion.div>
  );
}
```

```css
/* CORRECT: CSS reduced motion */
.animated-element {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

@media (prefers-reduced-motion: reduce) {
  .animated-element {
    transition: none;
  }

  /* Or provide minimal transition */
  .animated-element {
    transition: opacity 0.1s ease;
    transform: none !important;
  }
}
```

### Pausable Animations

```tsx
// CORRECT: Carousel with pause controls
function Carousel({ slides, autoPlay = true }) {
  const [isPaused, setIsPaused] = useState(!autoPlay);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setCurrent((c) => (c + 1) % slides.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [isPaused, slides.length]);

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured content"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <button
        aria-label={isPaused ? 'Play carousel' : 'Pause carousel'}
        onClick={() => setIsPaused(!isPaused)}
      >
        {isPaused ? '▶' : '⏸'}
      </button>
      {/* Carousel content */}
    </div>
  );
}
```

---

## Screen Reader Patterns

### Visually Hidden Content

```css
/* CORRECT: Screen reader only class */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Show on focus for skip links */
.sr-only-focusable:focus {
  position: static;
  width: auto;
  height: auto;
  padding: inherit;
  margin: inherit;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

### Meaningful Link Text

```tsx
// CORRECT: Descriptive link text
<p>
  Learn about our <a href="/services">premium support services</a>.
</p>

// CORRECT: Context for repeated links
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

### Proper Document Structure

```tsx
// CORRECT: Landmark regions and heading hierarchy
function App() {
  return (
    <>
      <a href="#main" className="sr-only-focusable">
        Skip to main content
      </a>

      <header>
        <nav aria-label="Main">
          {/* Navigation */}
        </nav>
      </header>

      <aside aria-label="Sidebar">
        {/* Sidebar content */}
      </aside>

      <main id="main" tabIndex={-1}>
        <h1>Page Title</h1>
        <section aria-labelledby="section-1">
          <h2 id="section-1">First Section</h2>
          <h3>Subsection</h3>
        </section>
      </main>

      <footer>
        <nav aria-label="Footer">
          {/* Footer navigation */}
        </nav>
      </footer>
    </>
  );
}
```

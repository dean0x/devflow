# Accessibility Detection Patterns

Grep and regex patterns for detecting accessibility issues. Use with `Grep` tool.

## Keyboard Access Issues

```bash
# onClick without keyboard handler
rg 'onClick=\{[^}]+\}' --type tsx | rg -v 'onKeyDown|onKeyPress|onKeyUp|<button|<a '

# Non-focusable interactive elements
rg '<(div|span)\s+[^>]*onClick' --type tsx

# tabIndex with positive values (breaks natural order)
rg 'tabIndex=\{?[1-9]' --type tsx

# Drag-only interactions
rg 'onDrag(Start|End|Over)' --type tsx | rg -v 'onKey'
```

## Missing Labels

```bash
# Input without id (likely missing label association)
rg '<input[^>]*>' --type tsx | rg -v 'id='

# Button with only icon (no text or aria-label)
rg '<button[^>]*>\s*<[A-Z][a-zA-Z]*Icon' --type tsx | rg -v 'aria-label'

# Image without alt
rg '<img[^>]*>' --type tsx | rg -v 'alt='

# Links without text content
rg '<a[^>]*>\s*<(img|[A-Z])' --type tsx | rg -v 'aria-label'
```

## ARIA Misuse

```bash
# Redundant role on semantic elements
rg '<button[^>]*role="button"' --type tsx
rg '<nav[^>]*role="navigation"' --type tsx
rg '<a[^>]*role="link"' --type tsx

# aria-hidden on focusable elements
rg 'aria-hidden="true"[^>]*(tabIndex|onClick|href)' --type tsx

# Missing required ARIA attributes
rg 'role="slider"' --type tsx | rg -v 'aria-value(now|min|max)'
rg 'role="checkbox"' --type tsx | rg -v 'aria-checked'
rg 'role="tab"' --type tsx | rg -v 'aria-selected'
```

## Focus Management Issues

```bash
# Focus removal (outline: none without replacement)
rg 'outline:\s*none' --type css --type scss | rg -v 'focus-visible|focus-ring'

# Dialogs without role or aria-modal
rg 'modal|dialog' --type tsx -i | rg -v 'role="dialog"|aria-modal'

# Missing escape key handler in modals
rg '(Modal|Dialog|Popup)' --type tsx | rg -v 'Escape|onKeyDown'
```

## Color and Contrast

```bash
# Light gray text (potential contrast issue)
rg 'color:\s*#[a-fA-F0-9]{3,6}' --type css | rg -i '(#[cdef]{3}|#[cdef]{6})'

# Color-only indicators
rg 'color.*error|color.*success|color.*warning' --type css -i

# Placeholder as only label indicator
rg '<input[^>]*placeholder=' --type tsx | rg -v '<label|aria-label'
```

## Form Issues

```bash
# Missing error association
rg 'aria-invalid' --type tsx | rg -v 'aria-describedby'

# Form without noValidate (may conflict with custom validation)
rg '<form[^>]*>' --type tsx | rg 'onSubmit' | rg -v 'noValidate'

# Submit button without type
rg '<button[^>]*>Submit' --type tsx | rg -v 'type="submit"'
```

## Motion Issues

```bash
# Animation without reduced motion check
rg 'animation(-duration)?:' --type css | rg -v 'prefers-reduced-motion'

# Transition without reduced motion check
rg 'transition(-duration)?:' --type css | rg -v 'prefers-reduced-motion'

# Autoplay video/audio
rg '<(video|audio)[^>]*autoPlay' --type tsx

# Infinite animation loops
rg 'animation:.*infinite' --type css
```

## Touch Target Issues

```bash
# Small fixed dimensions
rg '(width|height):\s*(1[0-9]|2[0-9]|3[0-9])px' --type css

# Icon buttons without adequate sizing
rg '\.icon(-btn|Button)' --type css -A5 | rg '(width|height)'
```

## Screen Reader Issues

```bash
# Generic link text
rg '>click here<|>here<|>read more<|>learn more<' --type tsx -i

# aria-label duplicating visible text
rg 'aria-label="([^"]+)"[^>]*>\1<' --type tsx

# Missing landmark regions
rg '<div[^>]*class="(header|footer|nav|sidebar|main)"' --type tsx | rg -v 'role='
```

## Live Region Issues

```bash
# Dynamic content without aria-live
rg '(loading|spinner|toast|notification|alert)' --type tsx -i | rg -v 'aria-live|role="alert"|role="status"'

# Missing aria-atomic on live regions
rg 'aria-live=' --type tsx | rg -v 'aria-atomic'
```

## Semantic HTML Issues

```bash
# Div/span used instead of semantic elements
rg '<div[^>]*role="(button|link|navigation|main|banner|contentinfo)"' --type tsx
rg '<span[^>]*role="(button|link)"' --type tsx

# Heading level skips (partial detection)
rg '<h[1-6]' --type tsx

# List items outside lists
rg '<li[^>]*>' --type tsx | rg -v '<ul|<ol'
```

## Testing Commands

```bash
# Full accessibility audit on changed files
git diff --name-only HEAD~1 | xargs -I{} rg -l 'onClick|<input|<button|<a ' {} 2>/dev/null

# Count potential issues by category
echo "=== Potential Keyboard Issues ==="
rg '<(div|span)\s+[^>]*onClick' --type tsx -c

echo "=== Potential Label Issues ==="
rg '<input[^>]*>' --type tsx | rg -v 'id=' | wc -l

echo "=== Potential ARIA Issues ==="
rg '<button[^>]*role="button"' --type tsx -c
```

# Frontend Design Detection Patterns

Grep and regex patterns for detecting design issues. Use with `Grep` tool.

## Typography Issues

```bash
# Font-family without rationale (look for undocumented choices)
rg "font-family:" --type css --type scss

# Flat heading sizes (minimal difference between levels)
rg "h[1-6]\s*\{" --type css -A3 | rg "font-size"

# Hardcoded font sizes (not using scale)
rg "font-size:\s*\d+px" --type css

# Line-height issues
rg "line-height:\s*[01]\.[0-3]" --type css  # Too tight
rg "line-height:\s*[2-9]" --type css         # Too loose
```

## Color Issues

```bash
# Random hex values (not using variables)
rg "#[a-fA-F0-9]{3,6}" --type css | rg -v "var\(--"

# AI slop gradients (purple-pink patterns)
rg "gradient.*#(667e|764b|8b5c|ec48|f974)" --type css -i
rg "from-purple.*to-pink" --type tsx

# Inline style colors
rg "style=.*color:" --type tsx
rg "style=.*background:" --type tsx

# filter: invert (dark mode hack)
rg "filter:\s*invert" --type css
```

## Motion Issues

```bash
# Decorative animations
rg "animation:.*infinite" --type css
rg "animation:.*pulse" --type css

# "all" transition (animates layout)
rg "transition:\s*all" --type css

# Random durations (not using system)
rg "transition:.*\d+\.\d+s" --type css
rg "animation-duration:.*\d+\.\d+s" --type css

# Linear easing for UI
rg "transition:.*linear" --type css

# Missing reduced motion support
rg "@media.*prefers-reduced-motion" --type css -c
```

## Spacing Issues

```bash
# Magic number padding/margin
rg "(padding|margin):\s*\d{2,}px" --type css
rg "(padding|margin):.*\d+px\s+\d+px\s+\d+px\s+\d+px" --type css

# Hardcoded Tailwind spacing (not using scale)
rg "class=.*p-\[.*px\]" --type tsx
rg "class=.*m-\[.*px\]" --type tsx

# Inconsistent gap usage
rg "gap:\s*\d+px" --type css
```

## Layout Issues

```bash
# Everything centered
rg "text-align:\s*center" --type css -c

# Border-radius overuse (same value everywhere)
rg "border-radius:\s*12px" --type css -c
rg "rounded-xl" --type tsx -c

# Shadow on everything
rg "box-shadow:" --type css -c

# Bento grid patterns
rg "grid-column:\s*span" --type css -c
```

## AI Slop Patterns

```bash
# Generic hero sections
rg "class=.*hero.*gradient" --type tsx
rg "<section.*hero" --type tsx

# Glassmorphism patterns
rg "backdrop-filter:\s*blur" --type css
rg "rgba.*0\.[12]" --type css  # Low opacity backgrounds

# Trending patterns
rg "animate-bounce|animate-pulse" --type tsx
rg "hover:scale-" --type tsx

# Template-like code
rg "Welcome to|Get Started|Learn More" --type tsx
```

## Dark Mode Issues

```bash
# Dark mode not defined
rg "prefers-color-scheme:\s*dark" --type css -c

# Only background swap
rg "\.dark\s*\{" --type css -A5 | rg -v "color:"

# Same shadows in dark mode
rg "\.dark.*box-shadow" --type css
```

## Component Issues

```bash
# Inline styles (not using design system)
rg "style=\{\{" --type tsx -c

# Hardcoded colors in components
rg "color:\s*['\"]#" --type tsx
rg "background:\s*['\"]#" --type tsx

# Non-token spacing
rg "padding:\s*['\"].*px" --type tsx
rg "margin:\s*['\"].*px" --type tsx
```

## Testing Commands

```bash
# Full design audit on CSS files
echo "=== Typography Issues ==="
rg "font-size:\s*\d+px" --type css -c

echo "=== Color Issues ==="
rg "#[a-fA-F0-9]{6}" --type css | rg -v "var\(--" | wc -l

echo "=== Motion Issues ==="
rg "animation:.*infinite" --type css -c

echo "=== Spacing Issues ==="
rg "(padding|margin):\s*\d+px" --type css | wc -l

echo "=== Design System Usage ==="
rg "var\(--" --type css -c
```

## Tailwind-Specific Issues

```bash
# Arbitrary values (bypassing design system)
rg "\[#[a-fA-F0-9]+\]" --type tsx
rg "\[\d+px\]" --type tsx
rg "\[\d+rem\]" --type tsx

# Inconsistent responsive prefixes
rg "md:|lg:|xl:" --type tsx | sort | uniq -c

# Excessive utility classes (consider extraction)
rg "className=\"[^\"]{200,}\"" --type tsx
```

## CSS-in-JS Issues

```bash
# Hardcoded values in styled-components
rg "styled\." --type tsx -A10 | rg "\d+px"
rg "styled\." --type tsx -A10 | rg "#[a-fA-F0-9]"

# Missing theme usage
rg "styled\." --type tsx -A10 | rg -v "theme\."
```

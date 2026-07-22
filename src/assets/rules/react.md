---
paths: ["**/*.tsx", "**/*.jsx"]
---
# React

**Composition over prop drilling — lift state only as high as needed.**

- Hooks at top level, never inside conditions or loops
- Complete useEffect dependency arrays + cleanup functions
- Key props on list items — never use array index as key
- Memoize expensive computations, not everything

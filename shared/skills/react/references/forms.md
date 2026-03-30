# React — Form Patterns

Extended form handling patterns with citations. Reference from main SKILL.md.
Sources in `references/sources.md`.

---

## Controlled vs Uncontrolled [1]

**Controlled**: React state is the single source of truth. Every keystroke updates state.
Gives full control for validation and conditional logic.

**Uncontrolled**: DOM manages value; use `ref` to read on submit. Simpler for basic forms
and native browser behavior (file inputs must be uncontrolled). [1]

```tsx
// VIOLATION: Switching from uncontrolled to controlled mid-lifecycle
function SearchInput() {
  const [value, setValue] = useState<string>();  // undefined initially
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
  // BAD: undefined -> string switch causes React warning
}

// CORRECT: Controlled — initialize with empty string
function SearchInput() {
  const [value, setValue] = useState('');  // always a string
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
}

// CORRECT: Uncontrolled with FormData for simple submit-only forms
function UncontrolledForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formRef.current) onSubmit(new FormData(formRef.current));
  };
  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      <input name="password" type="password" required />
      <button type="submit">Submit</button>
    </form>
  );
}
```

---

## Controlled Form with Validation [1][21][22]

Accessible forms require labels, error announcements, and `aria-invalid`. [21][22]

```tsx
function LoginForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Partial<typeof formData>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));  // clear on change
  };

  const validate = (): boolean => {
    const newErrors: Partial<typeof formData> = {};
    if (!formData.email) newErrors.email = 'Email required';
    if (!formData.password) newErrors.password = 'Password required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="email">Email</label>
      <input
        id="email" name="email" type="email"
        value={formData.email} onChange={handleChange}
        aria-invalid={!!errors.email} aria-describedby="email-error"
      />
      {errors.email && <span id="email-error" role="alert">{errors.email}</span>}

      <label htmlFor="password">Password</label>
      <input
        id="password" name="password" type="password"
        value={formData.password} onChange={handleChange}
        aria-invalid={!!errors.password} aria-describedby="password-error"
      />
      {errors.password && <span id="password-error" role="alert">{errors.password}</span>}

      <button type="submit">Login</button>
    </form>
  );
}
```

---

## Reusable Form Hook [14][1]

Extract form logic into a custom hook to avoid repetition across form components. [14]

```tsx
interface UseFormOptions<T> {
  initialValues: T;
  validate: (values: T) => Partial<Record<keyof T, string>>;
  onSubmit: (values: T) => void | Promise<void>;
}

function useForm<T extends Record<string, unknown>>({
  initialValues, validate, onSubmit,
}: UseFormOptions<T>) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (name: keyof T) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [name]: e.target.value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleBlur = (name: keyof T) => () => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const fieldErrors = validate(values);
    if (fieldErrors[name]) setErrors((prev) => ({ ...prev, [name]: fieldErrors[name] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate(values);
    setErrors(validationErrors);
    setTouched(Object.keys(values).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
    if (Object.keys(validationErrors).length === 0) {
      setIsSubmitting(true);
      try { await onSubmit(values); } finally { setIsSubmitting(false); }
    }
  };

  const reset = () => { setValues(initialValues); setErrors({}); setTouched({}); };
  return { values, errors, touched, isSubmitting, handleChange, handleBlur, handleSubmit, reset };
}
```

---

## Multi-Step Form [1]

```tsx
function MultiStepForm() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>({ name: '', email: '', address: '' });
  const updateData = (updates: Partial<FormData>) =>
    setData((prev) => ({ ...prev, ...updates }));
  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const steps = [
    <PersonalInfo {...{ next, prev, data, updateData }} />,
    <AddressInfo {...{ next, prev, data, updateData }} />,
    <Confirmation {...{ next, prev, data, updateData }} />,
  ];

  return (
    <div>
      <StepIndicator current={step} total={steps.length} />
      {steps[step]}
    </div>
  );
}
```

---

## Server Actions (React 19+) [1][7][10]

Server Actions allow form submission to invoke server-side functions directly,
eliminating the need for API route boilerplate. [7][10]

```tsx
// Server Component with Server Action
async function createTodo(formData: FormData) {
  'use server';
  const title = formData.get('title') as string;
  await db.todos.create({ title });
  revalidatePath('/todos');
}

export default function NewTodoForm() {
  return (
    <form action={createTodo}>
      <input name="title" type="text" required />
      <button type="submit">Add Todo</button>
    </form>
  );
}
```

---

## Common Form Violations

| Violation | Problem | Fix | Source |
|-----------|---------|-----|--------|
| `useState<string>()` for input value | undefined→string switch causes warning | Always initialize with `''` | [1] |
| No labels on inputs | Screen readers can't identify fields | Use `<label htmlFor>` + `id` pair | [21][22] |
| Error displayed without `role="alert"` | Screen readers miss error announcements | Add `role="alert"` to error elements | [21] |
| No `aria-invalid` on errored input | Assistive tech can't identify invalid state | Set `aria-invalid={!!error}` | [22] |
| Not resetting form after successful submit | Stale values confuse users | Call `reset()` or clear state | [1] |
| Validation only on submit | Late feedback hurts UX | Validate on blur for touched fields | [1] |

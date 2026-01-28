# Form Patterns

Comprehensive form handling patterns for React applications.

## Controlled Form

```tsx
interface FormData {
  email: string;
  password: string;
}

function LoginForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};
    if (!formData.email) newErrors.email = 'Email required';
    if (!formData.password) newErrors.password = 'Password required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <input
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          aria-invalid={!!errors.email}
        />
        {errors.email && <span role="alert">{errors.email}</span>}
      </div>
      <div>
        <input
          name="password"
          type="password"
          value={formData.password}
          onChange={handleChange}
          aria-invalid={!!errors.password}
        />
        {errors.password && <span role="alert">{errors.password}</span>}
      </div>
      <button type="submit">Login</button>
    </form>
  );
}
```

## Form with Validation Hook

```tsx
interface UseFormOptions<T> {
  initialValues: T;
  validate: (values: T) => Partial<Record<keyof T, string>>;
  onSubmit: (values: T) => void | Promise<void>;
}

function useForm<T extends Record<string, unknown>>({
  initialValues,
  validate,
  onSubmit,
}: UseFormOptions<T>) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (name: keyof T) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setValues((prev) => ({ ...prev, [name]: e.target.value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleBlur = (name: keyof T) => () => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const fieldErrors = validate(values);
    if (fieldErrors[name]) {
      setErrors((prev) => ({ ...prev, [name]: fieldErrors[name] }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate(values);
    setErrors(validationErrors);
    setTouched(
      Object.keys(values).reduce(
        (acc, key) => ({ ...acc, [key]: true }),
        {} as Record<keyof T, boolean>
      )
    );

    if (Object.keys(validationErrors).length === 0) {
      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const reset = () => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  };

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    reset,
    setValues,
  };
}

// Usage
function SignupForm() {
  const form = useForm({
    initialValues: { name: '', email: '', password: '' },
    validate: (values) => {
      const errors: Partial<typeof values> = {};
      if (!values.name) errors.name = 'Name required';
      if (!values.email) errors.email = 'Email required';
      if (values.password.length < 8) errors.password = 'Min 8 characters';
      return errors;
    },
    onSubmit: async (values) => {
      await api.signup(values);
    },
  });

  return (
    <form onSubmit={form.handleSubmit}>
      <input
        value={form.values.name}
        onChange={form.handleChange('name')}
        onBlur={form.handleBlur('name')}
      />
      {form.touched.name && form.errors.name && (
        <span role="alert">{form.errors.name}</span>
      )}
      {/* ... other fields */}
      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Submitting...' : 'Sign Up'}
      </button>
    </form>
  );
}
```

## Multi-Step Form

```tsx
interface StepProps {
  next: () => void;
  prev: () => void;
  data: FormData;
  updateData: (updates: Partial<FormData>) => void;
}

function MultiStepForm() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>({
    name: '',
    email: '',
    address: '',
    payment: '',
  });

  const updateData = (updates: Partial<FormData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const steps = [
    <PersonalInfo {...{ next, prev, data, updateData }} />,
    <AddressInfo {...{ next, prev, data, updateData }} />,
    <PaymentInfo {...{ next, prev, data, updateData }} />,
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

## Uncontrolled Form with FormData

```tsx
function UncontrolledForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formRef.current) {
      const formData = new FormData(formRef.current);
      onSubmit(formData);
    }
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

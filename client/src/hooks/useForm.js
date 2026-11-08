import { useState, useCallback } from "react";

/**
 * Generic form state hook.
 *
 * Usage:
 *   const { values, errors, isSubmitting, handleChange, handleSubmit } = useForm({
 *     initialValues: { email: "", password: "" },
 *     validate: (vals) => {
 *       const errs = {};
 *       if (!vals.email) errs.email = "Required";
 *       return errs;
 *     },
 *     onSubmit: async (vals) => { await api.post(...) },
 *   });
 */
export function useForm({ initialValues, validate, onSubmit }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setValues((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    // Clear field error on change
    setErrors((prev) => {
      if (prev[name]) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev;
    });
    setSubmitError(null);
  }, []);

  const handleBlur = useCallback(
    (e) => {
      const { name } = e.target;
      setTouched((prev) => ({ ...prev, [name]: true }));

      // Validate single field
      if (validate) {
        const allErrors = validate(values);
        if (allErrors[name]) {
          setErrors((prev) => ({ ...prev, [name]: allErrors[name] }));
        }
      }
    },
    [values, validate]
  );

  const setValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      if (e) e.preventDefault();

      // Run validation
      if (validate) {
        const validationErrors = validate(values);
        if (Object.keys(validationErrors).length > 0) {
          setErrors(validationErrors);
          // Touch all fields
          const allTouched = {};
          for (const key of Object.keys(values)) {
            allTouched[key] = true;
          }
          setTouched(allTouched);
          return;
        }
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        await onSubmit(values);
      } catch (err) {
        // Handle structured API errors
        if (err?.details) {
          const fieldErrors = {};
          for (const detail of err.details) {
            if (detail.field) {
              fieldErrors[detail.field] = detail.message;
            }
          }
          if (Object.keys(fieldErrors).length > 0) {
            setErrors(fieldErrors);
          } else {
            setSubmitError(err.message);
          }
        } else {
          setSubmitError(err?.message || "Something went wrong");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, validate, onSubmit]
  );

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setSubmitError(null);
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    submitError,
    handleChange,
    handleBlur,
    handleSubmit,
    setValue,
    setValues,
    reset,
  };
}

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

type FieldProps = {
  label?: string;
  help?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

/** Field — label + control + help/error, consistent spacing and a11y wiring. */
export function Field({ label, help, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')} data-invalid={error ? 'true' : undefined}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : help ? (
        <span className="field-help">{help}</span>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['input', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={['select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['textarea', className].filter(Boolean).join(' ')} {...rest} />;
}

/** LabeledInput — Field + Input in one call, for the common single-line case. */
export function LabeledInput({
  label,
  help,
  error,
  id,
  ...rest
}: { label: string; help?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const inputId = id || generated;
  return (
    <Field label={label} help={help} error={error} htmlFor={inputId}>
      <Input id={inputId} {...rest} />
    </Field>
  );
}

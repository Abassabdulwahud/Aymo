import { InputHTMLAttributes, useState } from "react";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function PasswordField({ label, id, ...rest }: PasswordFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="auth-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input id={id} type={show ? "text" : "password"} {...rest} />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShow((value) => !value)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

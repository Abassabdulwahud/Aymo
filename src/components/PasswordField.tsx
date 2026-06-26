import { InputHTMLAttributes, useState } from "react";
import { useI18n } from "../i18n";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function PasswordField({ label, id, ...rest }: PasswordFieldProps) {
  const { t } = useI18n();
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
          {show ? t("auth.hide") : t("auth.show")}
        </button>
      </div>
    </div>
  );
}

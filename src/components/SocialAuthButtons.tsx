import { RefObject } from "react";

interface SocialAuthButtonsProps {
  mode: "login" | "signup";
  onGoogle: () => Promise<void>;
  onApple: () => Promise<void>;
  disabled?: boolean;
  googleButtonRef: RefObject<HTMLDivElement | null>;
  googleEnabled: boolean;
  googleStatus: string | null;
  appleEnabled: boolean;
  appleStatus: string | null;
}

export function SocialAuthButtons({
  mode,
  onGoogle,
  onApple,
  disabled = false,
  googleButtonRef,
  googleEnabled,
  googleStatus,
  appleEnabled,
  appleStatus,
}: SocialAuthButtonsProps) {
  const text = mode === "login" ? "Sign in" : "Sign up";

  return (
    <div className="social-auth-group">
      {googleEnabled ? (
        <div ref={googleButtonRef} className="google-signin-slot" aria-label={`${text} with Google`} />
      ) : (
        <button className="btn social-btn" type="button" onClick={() => void onGoogle()} disabled={disabled}>
          {text} with Google
        </button>
      )}
      {googleStatus ? <p className="social-auth-status">{googleStatus}</p> : null}

      <button
        className="btn social-btn"
        type="button"
        onClick={() => void onApple()}
        disabled={disabled || !appleEnabled}
      >
        {text} with Apple
      </button>
      {appleStatus ? <p className="social-auth-status">{appleStatus}</p> : null}
    </div>
  );
}

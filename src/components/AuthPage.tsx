import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthDivider } from "./AuthDivider";
import { AuthHeader } from "./AuthHeader";
import { PasswordField } from "./PasswordField";
import { SocialAuthButtons } from "./SocialAuthButtons";
import { fetchAuthProviders, type AuthProvidersConfig } from "../services/authService";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number | boolean>,
          ) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (config: {
          clientId: string;
          scope: string;
          redirectURI: string;
          usePopup: boolean;
          state: string;
          nonce: string;
        }) => void;
        signIn: () => Promise<{ authorization?: { id_token?: string } }>;
      };
    };
  }
}

const GOOGLE_SDK_URL = "https://accounts.google.com/gsi/client";
const APPLE_SDK_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
const scriptCache = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const cached = scriptCache.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });

  scriptCache.set(src, promise);
  return promise;
}

function randomValue(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface AuthPageProps {
  darkMode: boolean;
  onToggleTheme: () => void;
  onEmailAuth: (params: { mode: AuthMode; email: string; password: string; fullName: string }) => Promise<void>;
  onGoogleAuth: (oauthToken: string) => Promise<void>;
  onAppleAuth: (oauthToken: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  onResetPassword: (token: string, newPassword: string) => Promise<void>;
}

type AuthMode = "login" | "signup" | "reset";

export function AuthPage({
  darkMode,
  onToggleTheme,
  onEmailAuth,
  onGoogleAuth,
  onAppleAuth,
  onForgotPassword,
  onResetPassword,
}: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProvidersConfig | null>(null);
  const [googleStatus, setGoogleStatus] = useState<string | null>(null);
  const [appleStatus, setAppleStatus] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const submitLabel = mode === "login" ? "Log In" : mode === "signup" ? "Sign Up" : "Reset Password";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("resetToken");
    if (token) {
      setResetToken(token);
      setMode("reset");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAuthProviders()
      .then((config) => {
        if (!active) return;
        setProviders(config);
        setGoogleStatus(config.google.enabled ? null : config.google.reason);
        setAppleStatus(config.apple.enabled ? null : config.apple.reason);
      })
      .catch(() => {
        if (!active) return;
        setGoogleStatus("Could not load provider configuration from the backend.");
        setAppleStatus("Could not load provider configuration from the backend.");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const googleProvider = providers?.google;
    if (!googleProvider?.enabled || !googleProvider.clientId || !googleButtonRef.current) {
      return;
    }

    let cancelled = false;
    setGoogleStatus("Loading Google sign-in...");

    void loadScript(GOOGLE_SDK_URL)
      .then(() => {
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;
        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: googleProvider.clientId,
          callback: ({ credential }) => {
            if (!credential) {
              setError("Google sign-in did not return a usable identity token.");
              return;
            }
            void (async () => {
              try {
                setIsSubmitting(true);
                setError(null);
                await onGoogleAuth(credential);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Google authentication failed.");
              } finally {
                setIsSubmitting(false);
              }
            })();
          },
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: darkMode ? "filled_black" : "outline",
          size: "large",
          text: mode === "login" ? "signin_with" : "signup_with",
          shape: "rectangular",
          width: 404,
        });
        setGoogleStatus(null);
      })
      .catch(() => {
        if (cancelled) return;
        setGoogleStatus("Google sign-in could not load in this browser right now.");
      });

    return () => {
      cancelled = true;
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
    };
  }, [darkMode, mode, onGoogleAuth, providers]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if ((mode === "signup" || mode === "reset") && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setIsSubmitting(true);
      if (mode === "reset") {
        if (!resetToken) {
          throw new Error("Password reset link is missing or invalid.");
        }
        await onResetPassword(resetToken, password);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("resetToken");
        window.history.replaceState({}, "", nextUrl.toString());
      } else {
        await onEmailAuth({ mode, email, password, fullName });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(googleStatus ?? "Google sign-in is still loading.");
  };

  const handleApple = async () => {
    setError(null);

    const appleProvider = providers?.apple;
    if (!appleProvider?.enabled || !appleProvider.clientId || !appleProvider.redirectUri) {
      setError(appleStatus ?? "Apple sign-in is not ready in this environment.");
      return;
    }

    try {
      setIsSubmitting(true);
      await loadScript(APPLE_SDK_URL);

      if (!window.AppleID?.auth) {
        throw new Error("Apple sign-in could not initialize in this browser.");
      }

      window.AppleID.auth.init({
        clientId: appleProvider.clientId,
        scope: "name email",
        redirectURI: appleProvider.redirectUri,
        usePopup: true,
        state: randomValue(),
        nonce: randomValue(),
      });

      const response = await window.AppleID.auth.signIn();
      const token = response.authorization?.id_token;
      if (!token) {
        throw new Error("Apple sign-in did not return an identity token.");
      }

      await onAppleAuth(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apple authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email first so we know which account to reset.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onForgotPassword(normalizedEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start password reset.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="site-shell auth-shell">
      <button className="btn auth-theme-btn" type="button" onClick={onToggleTheme}>
        {darkMode ? "Light Mode" : "Dark Mode"}
      </button>

      <section className="auth-card">
        <AuthHeader
          subtitle={mode === "login" ? "Welcome back" : mode === "signup" ? "Create your account" : "Choose a new password"}
          darkMode={darkMode}
        />

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <div className="auth-field">
              <label className="field-label" htmlFor="full-name">Full name</label>
              <input
                id="full-name"
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </div>
          ) : null}

          {mode !== "reset" ? (
            <div className="auth-field">
              <label className="field-label" htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          ) : null}

          <PasswordField
            id="auth-password"
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {mode === "signup" || mode === "reset" ? (
            <PasswordField
              id="confirm-password"
              label="Confirm password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          ) : null}

          <button className="btn btn-solid auth-submit" type="submit">
            {isSubmitting ? "Please wait..." : submitLabel}
          </button>

          {mode === "login" ? (
            <button type="button" className="text-link auth-forgot" onClick={() => void handleForgotPassword()}>
              Forgot password?
            </button>
          ) : null}
        </form>

        {mode !== "reset" ? (
          <>
            <AuthDivider />

            <SocialAuthButtons
              mode={mode}
              onGoogle={handleGoogle}
              onApple={handleApple}
              disabled={isSubmitting}
              googleButtonRef={googleButtonRef}
              googleEnabled={Boolean(providers?.google.enabled)}
              googleStatus={googleStatus}
              appleEnabled={Boolean(providers?.apple.enabled)}
              appleStatus={appleStatus}
            />
          </>
        ) : null}

        {error ? <p className="auth-error">{error}</p> : null}

        <p className="auth-switch-text">
          {mode === "login" ? "Don't have an account?" : mode === "signup" ? "Already have an account?" : "Remembered it?"}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => {
              if (mode === "reset") {
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete("resetToken");
                window.history.replaceState({}, "", nextUrl.toString());
                setResetToken(null);
                setMode("login");
                return;
              }
              setMode((value) => (value === "login" ? "signup" : "login"));
            }}
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </section>
    </div>
  );
}

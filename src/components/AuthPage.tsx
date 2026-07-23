import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthDivider } from "./AuthDivider";
import { useNavigate } from "react-router-dom";
import { AuthHeader } from "./AuthHeader";
import { useI18n } from "../i18n";
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

type AuthMode = "login" | "signup" | "reset";

type EmailAuthMode = Exclude<AuthMode, "reset">;

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
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
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
  initialMode?: EmailAuthMode;
  onToggleTheme: () => void;
  onEmailAuth: (params: { mode: EmailAuthMode; email: string; password: string; fullName: string }) => Promise<void>;
  onGoogleAuth: (oauthToken: string) => Promise<void>;
  onAppleAuth: (oauthToken: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  onResetPassword: (token: string, newPassword: string) => Promise<void>;
  onContinueOffline?: () => void;
}

export function AuthPage({
  darkMode,
  initialMode = "login",
  onToggleTheme,
  onEmailAuth,
  onGoogleAuth,
  onAppleAuth,
  onForgotPassword,
  onResetPassword,
  onContinueOffline,
}: AuthPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProvidersConfig | null>(null);
  const [googleStatus, setGoogleStatus] = useState<string | null>(null);
  const [appleStatus, setAppleStatus] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const submitLabel = mode === "login" ? t("auth.login") : mode === "signup" ? t("auth.signup") : t("auth.resetPassword");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("resetToken");
    if (token) {
      setResetToken(token);
      setMode("reset");
    }
  }, []);

  useEffect(() => {
    if (resetToken) {
      return;
    }
    setMode(initialMode);
  }, [initialMode, resetToken]);

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

    const googleClientId = googleProvider.clientId;

    let cancelled = false;
    setGoogleStatus(t("auth.googleLoading"));

    void loadScript(GOOGLE_SDK_URL)
      .then(() => {
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;
        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => {
            if (!credential) {
              setError(t("auth.googleTokenMissing"));
              return;
            }
            void (async () => {
              try {
                setIsSubmitting(true);
                setError(null);
                await onGoogleAuth(credential);
              } catch (err) {
                setError(err instanceof Error ? err.message : t("auth.googleFailed"));
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
        setGoogleStatus(t("auth.googleLoadFailed"));
      });

    return () => {
      cancelled = true;
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
    };
  }, [darkMode, mode, onGoogleAuth, providers, t]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if ((mode === "signup" || mode === "reset") && password !== confirmPassword) {
      setError(t("auth.passwordsMismatch"));
      return;
    }

    try {
      setIsSubmitting(true);
      if (mode === "reset") {
        if (!resetToken) {
          throw new Error(t("auth.resetLinkInvalid"));
        }
        await onResetPassword(resetToken, password);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("resetToken");
        window.history.replaceState({}, "", nextUrl.toString());
      } else {
        await onEmailAuth({ mode, email, password, fullName });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.authFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(googleStatus ?? t("auth.googleStillLoading"));
  };

  const handleApple = async () => {
    setError(null);

    const appleProvider = providers?.apple;
    if (!appleProvider?.enabled || !appleProvider.clientId || !appleProvider.redirectUri) {
      setError(appleStatus ?? t("auth.appleNotReady"));
      return;
    }

    const redirectUri = appleProvider.redirectUri;

    try {
      setIsSubmitting(true);
      await loadScript(APPLE_SDK_URL);

      if (!window.AppleID?.auth) {
        throw new Error(t("auth.appleInitFailed"));
      }

      window.AppleID.auth.init({
        clientId: appleProvider.clientId,
        scope: "name email",
        redirectURI: redirectUri,
        usePopup: true,
        state: randomValue(),
        nonce: randomValue(),
      });

      const response = await window.AppleID.auth.signIn();
      const token = response.authorization?.id_token;
      if (!token) {
        throw new Error(t("auth.appleTokenMissing"));
      }

      await onAppleAuth(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.appleFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError(t("auth.enterEmailFirst"));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onForgotPassword(normalizedEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.resetStartFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="site-shell auth-shell">
      <button className="btn auth-theme-btn" type="button" onClick={onToggleTheme}>
        {darkMode ? t("auth.lightMode") : t("auth.darkMode")}
      </button>

      <section className="auth-card">
        <AuthHeader
          subtitle={mode === "login" ? t("auth.welcomeBack") : mode === "signup" ? t("auth.createAccount") : t("auth.chooseNewPassword")}
          darkMode={darkMode}
        />

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <div className="auth-field">
              <label className="field-label" htmlFor="full-name">{t("auth.fullName")}</label>
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
              <label className="field-label" htmlFor="auth-email">{t("auth.email")}</label>
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
            label={t("auth.password")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {mode === "signup" || mode === "reset" ? (
            <PasswordField
              id="confirm-password"
              label={t("auth.confirmPassword")}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          ) : null}

          <button className="btn btn-solid auth-submit" type="submit">
            {isSubmitting ? t("auth.pleaseWait") : submitLabel}
          </button>

          {mode === "login" ? (
            <button type="button" className="text-link auth-forgot" onClick={() => void handleForgotPassword()}>
              {t("auth.forgotPassword")}
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

            {onContinueOffline ? (
              <div style={{ marginTop: "16px", display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "none", color: "var(--foreground)", fontSize: "14px", fontWeight: 500 }}
                  onClick={onContinueOffline}
                >
                  Continue Offline (Local Mode)
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {error ? <p className="auth-error">{error}</p> : null}

        <p className="auth-switch-text">
          {mode === "login" ? t("auth.noAccount") : mode === "signup" ? t("auth.haveAccount") : t("auth.remembered")}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => {
              if (mode === "reset") {
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete("resetToken");
                window.history.replaceState({}, "", nextUrl.toString());
                setResetToken(null);
                navigate("/login", { replace: true });
                return;
              }
              navigate(mode === "login" ? "/signup" : "/login");
            }}
          >
            {mode === "login" ? t("auth.signupCta") : t("auth.loginCta")}
          </button>
        </p>
      </section>
    </div>
  );
}

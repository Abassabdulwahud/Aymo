import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, MoreVertical } from "lucide-react";
import { LanguageCode, languageCodeToName, useI18n } from "../i18n";

interface AccountSettingsMenuProps {
  name: string;
  email: string;
  darkMode: boolean;
  language: LanguageCode;
  onThemeChange: (next: boolean) => void;
  onLanguageChange: (next: LanguageCode) => void;
  onLogout: () => void;
}

const ACCOUNT_LANGUAGES: LanguageCode[] = ["en", "fr", "ar", "ha"];

export function AccountSettingsMenu({
  name,
  email,
  darkMode,
  language,
  onThemeChange,
  onLanguageChange,
  onLogout,
}: AccountSettingsMenuProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".account-menu-wrap")) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleOutsideClick, { capture: true });
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleOutsideClick, { capture: true });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const languageLabels: Record<LanguageCode, string> = {
    en: t("language.en"),
    ar: t("language.ar"),
    fr: t("language.fr"),
    es: t("language.es"),
    de: t("language.de"),
    ha: t("language.ha"),
  };

  const chooseTheme = (nextDarkMode: boolean) => {
    onThemeChange(nextDarkMode);
    setIsThemeOpen(false);
  };

  const chooseLanguage = (nextLanguage: LanguageCode) => {
    onLanguageChange(nextLanguage);
    setIsLanguageOpen(false);
  };

  return (
    <div className="account-menu-wrap">
      <button
        className="menu-icon-btn account-menu-trigger"
        type="button"
        aria-label="Open account settings"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <MoreVertical size={18} strokeWidth={2} />
      </button>

      {isOpen ? (
        <div className="account-settings-menu" role="menu">
          <div className="account-menu-profile">
            <strong>{name}</strong>
            <span>{email}</span>
          </div>

          <div className="account-menu-divider" />

          <div className="account-menu-section">
            <button
              className="account-menu-row"
              type="button"
              aria-expanded={isThemeOpen}
              onClick={() => {
                setIsThemeOpen((value) => !value);
                setIsLanguageOpen(false);
              }}
            >
              <span>{t("settings.theme")}</span>
              <span className="account-menu-row-meta">
                {darkMode ? t("app.dark") : t("app.light")}
                {isThemeOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {isThemeOpen ? (
              <div className="account-menu-options">
                <button type="button" onClick={() => chooseTheme(false)}>
                  <span>{t("app.light")}</span>
                  {!darkMode ? <Check size={14} /> : null}
                </button>
                <button type="button" onClick={() => chooseTheme(true)}>
                  <span>{t("app.dark")}</span>
                  {darkMode ? <Check size={14} /> : null}
                </button>
              </div>
            ) : null}
          </div>

          <div className="account-menu-section">
            <button
              className="account-menu-row"
              type="button"
              aria-expanded={isLanguageOpen}
              onClick={() => {
                setIsLanguageOpen((value) => !value);
                setIsThemeOpen(false);
              }}
            >
              <span>{t("settings.language")}</span>
              <span className="account-menu-row-meta">
                {languageLabels[language] ?? languageCodeToName(language)}
                {isLanguageOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {isLanguageOpen ? (
              <div className="account-menu-options">
                {ACCOUNT_LANGUAGES.map((item) => (
                  <button key={item} type="button" onClick={() => chooseLanguage(item)}>
                    <span>{languageLabels[item] ?? languageCodeToName(item)}</span>
                    {language === item ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            className="account-menu-row account-menu-logout"
            type="button"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
          >
            <span>{t("settings.logout")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

import { AI_PROVIDER_OPTIONS } from "../constants/aiProviders";
import { AIProvider } from "../types";
import { AymoLogo } from "./AymoLogo";
import { SettingsSection } from "./SettingsSection";
import { ThemeToggle } from "./ThemeToggle";

interface SettingsPageProps {
  darkMode: boolean;
  language: string;
  aiProvider: AIProvider;
  name: string;
  email: string;
  onBack: () => void;
  onThemeChange: (next: boolean) => void;
  onLanguageChange: (value: string) => void;
  onAIProviderChange: (value: AIProvider) => void;
  onLogout: () => void;
}

const LANGUAGES = ["English", "Arabic", "French", "Spanish", "German", "Portuguese"];

export function SettingsPage({
  darkMode,
  language,
  aiProvider,
  name,
  email,
  onBack,
  onThemeChange,
  onLanguageChange,
  onAIProviderChange,
  onLogout,
}: SettingsPageProps) {
  return (
    <div className="site-shell settings-shell">
      <header className="settings-header">
        <div className="settings-head-left">
          <div className="logo-wrap">
            <AymoLogo size="medium" darkMode={darkMode} />
          </div>
          <h2>Settings</h2>
        </div>
        <button className="btn" onClick={onBack}>Back</button>
      </header>

      <div className="settings-card">
        <SettingsSection title="Theme">
          <ThemeToggle checked={darkMode} onChange={onThemeChange} />
        </SettingsSection>

        <SettingsSection title="Language">
          <label className="field-label" htmlFor="language-select">Preferred language</label>
          <select
            id="language-select"
            className="settings-select"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value)}
          >
            {LANGUAGES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </SettingsSection>

        <SettingsSection title="AI Provider">
          <div className="provider-list" role="radiogroup" aria-label="AI Provider">
            {AI_PROVIDER_OPTIONS.map((provider) => (
              <label key={provider.id} className="provider-option">
                <input
                  type="radio"
                  name="ai-provider"
                  value={provider.id}
                  checked={aiProvider === provider.id}
                  onChange={() => onAIProviderChange(provider.id)}
                />
                <div>
                  <p className="provider-title">{provider.title}</p>
                  <p className="provider-description">{provider.description}</p>
                </div>
              </label>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title="Account">
          <div className="account-row">
            <span>Name</span>
            <strong>{name}</strong>
          </div>
          <div className="account-row">
            <span>Email</span>
            <strong>{email}</strong>
          </div>
          <button className="btn" onClick={onLogout}>Logout</button>
        </SettingsSection>
      </div>
    </div>
  );
}

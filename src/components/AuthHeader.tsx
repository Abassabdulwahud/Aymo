import { AymoLogo } from "./AymoLogo";

interface AuthHeaderProps {
  subtitle: string;
  darkMode: boolean;
}

export function AuthHeader({ subtitle, darkMode }: AuthHeaderProps) {
  return (
    <header className="auth-header">
      <div className="auth-logo">
        <AymoLogo size="large" darkMode={darkMode} />
        <h2>{subtitle}</h2>
      </div>
    </header>
  );
}

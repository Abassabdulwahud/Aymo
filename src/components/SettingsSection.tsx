import { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

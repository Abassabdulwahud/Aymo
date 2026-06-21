interface AymoLogoProps {
  size?: "large" | "medium" | "small";
  darkMode?: boolean;
  className?: string;
  alt?: string;
}

export function AymoLogo({
  size = "medium",
  darkMode = false,
  className = "",
  alt = "AYMO Notebook logo",
}: AymoLogoProps) {
  return (
    <img
      src="/aymo-logo-main.png"
      alt={alt}
      className={`aymo-logo aymo-logo-${size} ${darkMode ? "is-dark" : ""} ${className}`.trim()}
      loading="eager"
      decoding="async"
    />
  );
}


interface AymoLogoProps {
  variant?: "full" | "icon";
  size?: "large" | "medium" | "small";
  darkMode?: boolean;
  className?: string;
  alt?: string;
}

export function AymoLogo({
  variant = "icon",
  size = "medium",
  darkMode = false,
  className = "",
  alt = "AYMO logo",
}: AymoLogoProps) {
  const src = variant === "full" ? "/aymo-logo-new.png" : "/aymo-logo-icon-new.png";
  return (
    <img
      src={src}
      alt={alt}
      className={`aymo-logo aymo-logo-${size} ${darkMode ? "is-dark" : ""} ${variant === "full" ? "is-full" : ""} ${className}`.trim().replace(/\s+/g, ' ')}
      loading="eager"
      decoding="async"
    />
  );
}



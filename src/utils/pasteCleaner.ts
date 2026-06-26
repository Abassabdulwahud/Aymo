export function cleanPastedText(value: string): string {
  if (!value) return "";

  const normalized = value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const withJoinedHyphenations = normalized.replace(/([A-Za-z])-\n(?=[A-Za-z])/g, "$1");
  const collapsedParagraphs = withJoinedHyphenations
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim(),
    )
    .filter(Boolean);

  return collapsedParagraphs.join("\n\n");
}

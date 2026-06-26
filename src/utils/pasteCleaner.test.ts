import { describe, expect, it } from "vitest";
import { cleanPastedText } from "./pasteCleaner";

describe("cleanPastedText", () => {
  it("joins words split by hyphenated line breaks", () => {
    const input = "constructivist ap-\nproach improves understanding.";
    expect(cleanPastedText(input)).toBe("constructivist approach improves understanding.");
  });

  it("collapses single newlines into sentence spacing", () => {
    const input = "This is line one.\nThis is line two.\nThis is line three.";
    expect(cleanPastedText(input)).toBe("This is line one. This is line two. This is line three.");
  });

  it("preserves paragraph boundaries", () => {
    const input = "First paragraph line 1.\nFirst paragraph line 2.\n\nSecond paragraph line 1.";
    expect(cleanPastedText(input)).toBe("First paragraph line 1. First paragraph line 2.\n\nSecond paragraph line 1.");
  });

  it("normalizes repeated spaces and non-breaking spaces", () => {
    const input = "Spacing\u00a0\u00a0test   with   multiple spaces.";
    expect(cleanPastedText(input)).toBe("Spacing test with multiple spaces.");
  });

  it("splits merged lower-upper boundaries that appear after copy", () => {
    const input = "This uses theConstructivistApproach for learning.";
    expect(cleanPastedText(input)).toBe("This uses the Constructivist Approach for learning.");
  });
});

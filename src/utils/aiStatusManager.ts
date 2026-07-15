export type AIContextType =
  | "general"
  | "note"
  | "summary"
  | "explanation"
  | "rewrite"
  | "pdf"
  | "video"
  | "audio"
  | "ocr"
  | "image"
  | "long_running";

export interface StatusPhase {
  phrase: string;
}

/**
 * Reusable and extensible status mapping configuration representing AYMO's
 * identity as a premium, calm, and intelligent notebook study partner.
 */
export const SIGNATURE_STATUSES: Record<AIContextType, StatusPhase[]> = {
  general: [
    { phrase: "Thinking" },
    { phrase: "Understanding your question" },
    { phrase: "Preparing a response" },
  ],
  note: [
    { phrase: "Reviewing your notes" },
    { phrase: "Organizing your ideas" },
    { phrase: "Understanding your writing" },
  ],
  summary: [
    { phrase: "Finding the key ideas" },
    { phrase: "Building your summary" },
    { phrase: "Identifying the important points" },
  ],
  explanation: [
    { phrase: "Breaking it down" },
    { phrase: "Preparing a simple explanation" },
    { phrase: "Connecting the concepts" },
  ],
  rewrite: [
    { phrase: "Improving the wording" },
    { phrase: "Refining your writing" },
    { phrase: "Reorganizing your ideas" },
  ],
  // Future-ready segments:
  pdf: [
    { phrase: "Scanning PDF structures" },
    { phrase: "Reading document content" },
    { phrase: "Correlating text references" },
  ],
  video: [
    { phrase: "Analyzing video timeline" },
    { phrase: "Extracting visual frames" },
    { phrase: "Processing video stream" },
  ],
  audio: [
    { phrase: "Listening to audio clip" },
    { phrase: "Transcribing speech patterns" },
    { phrase: "Analyzing audio context" },
  ],
  ocr: [
    { phrase: "Performing optical character recognition" },
    { phrase: "Scanning printed characters" },
    { phrase: "Extracting text layout" },
  ],
  image: [
    { phrase: "Inspecting image layers" },
    { phrase: "Detecting visual elements" },
    { phrase: "Understanding visual layout" },
  ],
  long_running: [
    { phrase: "Executing deep reasoning steps" },
    { phrase: "Cross-referencing notebook context" },
    { phrase: "Refining final answer" },
  ],
};

/**
 * Detects the AI query context type from the user's prompt text.
 */
export function detectAIContext(prompt: string): AIContextType {
  const lower = prompt.toLowerCase();

  // Future file type and multi-media detection:
  if (lower.includes(".pdf") || lower.includes("pdf") || lower.includes("document")) return "pdf";
  if (lower.includes(".mp4") || lower.includes("video") || lower.includes("watch")) return "video";
  if (lower.includes(".mp3") || lower.includes("audio") || lower.includes("listen") || lower.includes("voice")) return "audio";
  if (lower.includes("ocr") || lower.includes("scan") || lower.includes("handwriting")) return "ocr";
  if (lower.includes("image") || lower.includes("photo") || lower.includes("draw")) return "image";
  if (lower.includes("reason") || lower.includes("reasoning") || lower.includes("step-by-step") || lower.includes("think deeply")) return "long_running";

  // Note-taking core contexts:
  if (lower.includes("summar") || lower.includes("overview") || lower.includes("tldr") || lower.includes("takeaway")) {
    return "summary";
  }
  if (lower.includes("explain") || lower.includes("what is") || lower.includes("define") || lower.includes("why")) {
    return "explanation";
  }
  if (lower.includes("improv") || lower.includes("rewrite") || lower.includes("rephrase") || lower.includes("polish") || lower.includes("wording")) {
    return "rewrite";
  }
  if (lower.includes("note") || lower.includes("content") || lower.includes("idea") || lower.includes("writing")) {
    return "note";
  }

  return "general";
}

/**
 * Gets a context-aware thinking phrase that cycles through the pool of options
 * based on the elapsed time or index.
 */
export function getSignatureProgressPhrase(prompt: string, phaseIndex: number): string {
  const context = detectAIContext(prompt);
  const phases = SIGNATURE_STATUSES[context];
  const selectedPhase = phases[phaseIndex % phases.length];
  return selectedPhase.phrase;
}

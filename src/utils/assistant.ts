import { ChatMessage, UploadedItem } from "../types";

interface AssistantReplyContext {
  provider: string;
  noteTitle: string;
  noteBody: string;
  uploads: UploadedItem[];
  prompt: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function summarizeUploads(uploads: UploadedItem[]): string {
  if (uploads.length === 0) return "No uploaded files are attached yet.";
  const labels = uploads.slice(0, 3).map((upload) => `${upload.name} (${upload.kind})`);
  const suffix = uploads.length > 3 ? ` plus ${uploads.length - 3} more` : "";
  return `Attached resources include ${labels.join(", ")}${suffix}.`;
}

function buildQuestionResponse(prompt: string, noteBody: string, uploads: UploadedItem[]): string {
  const lowerPrompt = prompt.toLowerCase();
  const hasQuestions = noteBody.includes("?");

  if (lowerPrompt.includes("summary")) {
    return `Here is the short summary: ${noteBody.slice(0, 180).trim() || "The note is still empty, so there is nothing to summarize yet."}`;
  }

  if (lowerPrompt.includes("question") || lowerPrompt.includes("quiz")) {
    return hasQuestions
      ? "Your note already contains reflective questions, so I would turn those into quick review prompts and answer them from memory."
      : "I would add two review questions here: one about the main idea and one about how you would apply it in practice.";
  }

  if (lowerPrompt.includes("takeaway") || lowerPrompt.includes("important")) {
    return countWords(noteBody) > 80
      ? "The strongest takeaway is that this note already has enough detail to be distilled into a few clean revision prompts."
      : "The main opportunity is to make the core takeaway more explicit with one sentence that states the big idea.";
  }

  if (lowerPrompt.includes("file") || lowerPrompt.includes("upload") || lowerPrompt.includes("document")) {
    return summarizeUploads(uploads);
  }

  return "Based on the current note, I would focus on clarifying the main idea, linking it to one example, and turning the note into a few revision questions.";
}

export function buildAssistantReply({
  provider,
  noteTitle,
  noteBody,
  uploads,
  prompt,
}: AssistantReplyContext): ChatMessage {
  const providerName =
    provider === "gemini"
      ? "Google Gemini"
      : provider === "openai"
        ? "OpenAI"
        : provider === "deepseek"
          ? "DeepSeek"
          : "AYMO AI";
  const words = countWords(noteBody);
  const trimmedPrompt = prompt.trim();
  const bodyResponse =
    trimmedPrompt.toLowerCase().includes("file") ||
    trimmedPrompt.toLowerCase().includes("upload") ||
    trimmedPrompt.toLowerCase().includes("document")
      ? summarizeUploads(uploads)
      : buildQuestionResponse(trimmedPrompt, noteBody, uploads);

  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content: `${providerName} reviewed "${noteTitle || "Untitled note"}" (${words} words). ${bodyResponse}`,
  };
}

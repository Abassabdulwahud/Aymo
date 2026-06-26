import { AIProvider } from "../types";

interface AIProviderOption {
  id: AIProvider;
  title: string;
  description: string;
}

export const AI_PROVIDER_OPTIONS: AIProviderOption[] = [
  {
    id: "gemini",
    title: "Gemini",
    description: "Fast and great for multimodal content like images and audio.",
  },
  {
    id: "openai",
    title: "OpenAI",
    description: "Detailed insights and advanced reasoning across complex notes.",
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    description: "Cost-effective and excellent for logical analysis and reasoning tasks.",
  },
];

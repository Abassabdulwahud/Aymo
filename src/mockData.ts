import { InsightItem, UploadedItem } from "./types";

export const INITIAL_TITLE = "Neuroscience Reading Notes";

export const INITIAL_BODY = `Attention is not just focus. It is selective resource allocation.

Key ideas:
- The prefrontal cortex helps prioritize goals and suppress distractions.
- Novelty can improve retention, but too much novelty fragments memory.
- Retrieval practice beats passive review for durable learning.

Questions to explore:
1. How can I design daily routines that reduce context switching?
2. Which note patterns improve long-term recall?
`;

export const MOCK_UPLOADS: UploadedItem[] = [
  {
    id: "f-1",
    name: "cognitive-load.pdf",
    kind: "pdf",
    sizeLabel: "2.4 MB",
    addedAt: "2h ago",
  },
  {
    id: "f-2",
    name: "lecture-week-3.mp4",
    kind: "video",
    sizeLabel: "84 MB",
    addedAt: "1h ago",
  },
  {
    id: "f-3",
    name: "memory-research-link",
    kind: "link",
    sizeLabel: "URL",
    source: "https://example.com/memory-research",
    addedAt: "30m ago",
  },
  {
    id: "f-4",
    name: "interview-audio.m4a",
    kind: "audio",
    sizeLabel: "17 MB",
    addedAt: "10m ago",
  },
];

export const MOCK_INSIGHTS: InsightItem[] = [
  {
    id: "i-1",
    title: "Core Theme",
    detail: "Your note focuses on attention, memory, and practical learning systems.",
  },
  {
    id: "i-2",
    title: "Quick Summary",
    detail: "You connected neuroscience concepts to day-to-day study strategy and asked strong follow-up questions.",
  },
  {
    id: "i-3",
    title: "Learning Tip",
    detail: "Convert the two open questions into weekly experiments and track outcomes directly in this note.",
  },
];

export const VOICE_TRANSCRIPT_MOCK = "Voice note: Spaced repetition works better when I review difficult concepts right before forgetting begins.";

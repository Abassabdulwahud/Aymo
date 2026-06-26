import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Copy, Mic, RefreshCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { AIResponseFormatter } from "./AIResponseFormatter";
import { languageCodeToSpeechLocale } from "../i18n";
import { useI18n } from "../i18n";
import { AIProvider, ChatMessage } from "../types";
import { AI_PROVIDER_OPTIONS } from "../constants/aiProviders";

interface AIAssistantPanelProps {
  messages: ChatMessage[];
  liveSummary: {
    title: string;
    detail: string;
  };
  aiProvider: AIProvider;
  onAIProviderChange: (provider: AIProvider) => void;
  onSubmitPrompt: (prompt: string) => Promise<void>;
}

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function AIAssistantPanel({
  messages,
  liveSummary: _liveSummary,
  aiProvider,
  onAIProviderChange,
  onSubmitPrompt,
}: AIAssistantPanelProps) {
  const { language } = useI18n();
  const [chatInput, setChatInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice input is ready.");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptBufferRef = useRef("");
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) {
      return;
    }

    conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  // Auto-resize textarea as content changes
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to auto so the scrollHeight reflects the real content height
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [chatInput]);

  const mapSpeechError = (errorCode?: string) => {
    switch (errorCode) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone access was blocked. Please allow microphone permission and try again.";
      case "audio-capture":
        return "No microphone was detected. Connect a microphone and try again.";
      case "network":
        return "Speech recognition needs an internet connection right now. Check your connection and try again.";
      case "no-speech":
        return "No speech was detected. Try speaking again a little closer to the microphone.";
      default:
        return "Voice transcription could not start in this browser.";
    }
  };

  const submitPrompt = async (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmitPrompt(trimmedPrompt);
      setChatInput("");
      // Immediately collapse the textarea back to its minimum height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without Shift submits; Shift+Enter inserts a newline
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt(chatInput);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitPrompt(chatInput);
  };

  const handleVoicePrompt = async () => {
    if (isVoiceRecording) {
      setVoiceStatus("Finishing transcription...");
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognitionApi = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setVoiceError("This browser does not support Web Speech API voice transcription.");
      setVoiceStatus("Voice transcription unavailable.");
      return;
    }

    if (!navigator.onLine) {
      setVoiceError("Voice transcription needs an internet connection because Web Speech API is browser-hosted.");
      setVoiceStatus("Connect to the internet to start recording.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone access is not available in this browser.");
      setVoiceStatus("Microphone access is required.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setVoiceError("Microphone access is unavailable. Please allow microphone permission and try again.");
      setVoiceStatus("Microphone access is required.");
      return;
    }

    const recognition = new SpeechRecognitionApi();
    let encounteredSpeechError = false;
    transcriptBufferRef.current = "";
    setVoiceError(null);
    setVoiceStatus("Recording...");
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageCodeToSpeechLocale(language);
    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if ((result as { isFinal?: boolean }).isFinal) {
          transcriptBufferRef.current = `${transcriptBufferRef.current} ${transcript}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
      }

      const preview = interimTranscript || transcriptBufferRef.current;
      if (preview) {
        setChatInput(preview);
        setVoiceStatus(`Recording... ${preview}`);
      } else {
        setVoiceStatus("Recording...");
      }
    };
    recognition.onerror = (event) => {
      encounteredSpeechError = true;
      transcriptBufferRef.current = "";
      setIsVoiceRecording(false);
      setVoiceError(mapSpeechError(event.error));
      setVoiceStatus("Voice transcription stopped.");
    };
    recognition.onend = () => {
      setIsVoiceRecording(false);
      if (encounteredSpeechError) {
        return;
      }

      const transcript = transcriptBufferRef.current.trim();
      if (transcript) {
        setChatInput(transcript);
        setVoiceStatus("Recording stopped. Review the transcript and send when ready.");
      } else {
        setVoiceStatus("Recording stopped.");
      }
    };
    recognitionRef.current = recognition;
    setIsVoiceRecording(true);
    recognition.start();
  };

  const latestUserPrompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const selectedProvider = AI_PROVIDER_OPTIONS.find((provider) => provider.id === aiProvider) ?? AI_PROVIDER_OPTIONS[0];

  return (
    <section className="assistant-panel" aria-label="AI assistant chat">
      <div ref={conversationRef} className="assistant-conversation-scroll">
        <div className="assistant-conversation">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`chat-message ${message.role === "user" ? "chat-message-user" : "chat-message-assistant"}`}
            >
              {message.role === "assistant" ? (
                <>
                  <div className="assistant-markdown">
                    <AIResponseFormatter content={message.content} />
                  </div>
                  <div className="assistant-message-actions" aria-label="Assistant response actions">
                    <button type="button" aria-label="Copy response" onClick={() => void navigator.clipboard?.writeText(message.content)}>
                      <Copy size={15} strokeWidth={1.8} />
                    </button>
                    <button type="button" aria-label="Good response">
                      <ThumbsUp size={15} strokeWidth={1.8} />
                    </button>
                    <button type="button" aria-label="Bad response">
                      <ThumbsDown size={15} strokeWidth={1.8} />
                    </button>
                    <button type="button" aria-label="Regenerate response" onClick={() => void submitPrompt(latestUserPrompt)}>
                      <RefreshCcw size={15} strokeWidth={1.8} />
                    </button>
                  </div>
                </>
              ) : (
                <p>{message.content}</p>
              )}
            </article>
          ))}
          {messages.length === 0 ? <div className="assistant-empty">Ask a question about your note.</div> : null}
        </div>
      </div>

      <form className="assistant-chat-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="assistant-chat-input"
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message"
          aria-label="Write a message"
          rows={1}
        />
        <div className="assistant-input-footer">
          <div className="assistant-provider-wrap">
            <button
              className="assistant-provider-button"
              type="button"
              aria-label="Choose AI provider"
              aria-expanded={isProviderMenuOpen}
              onClick={() => setIsProviderMenuOpen((value) => !value)}
            >
              <span>{selectedProvider.title}</span>
              <ChevronDown size={14} strokeWidth={2} />
            </button>
            {isProviderMenuOpen ? (
              <div className="assistant-provider-menu" role="menu">
                {AI_PROVIDER_OPTIONS.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      onAIProviderChange(provider.id);
                      setIsProviderMenuOpen(false);
                    }}
                  >
                    <span>{provider.title}</span>
                    {provider.id === aiProvider ? <Check size={14} strokeWidth={2} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="assistant-input-footer-spacer" />
          {chatInput.trim() ? (
            <button className="assistant-send-button" type="submit" disabled={isSubmitting} aria-label="Send message">
              <ArrowUp size={18} strokeWidth={2} />
            </button>
          ) : null}
          <button
            className={`assistant-input-mic ${isVoiceRecording ? "is-recording" : ""}`}
            type="button"
            onClick={() => void handleVoicePrompt()}
            aria-label={isVoiceRecording ? "Stop voice input" : "Start voice input"}
            title={voiceError ?? voiceStatus}
          >
            <Mic size={18} strokeWidth={2} />
          </button>
        </div>
      </form>
    </section>
  );
}

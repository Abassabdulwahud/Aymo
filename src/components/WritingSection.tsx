import { KeyboardEvent, MouseEvent, RefObject, useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, Mic, Underline } from "lucide-react";
import { useI18n } from "../i18n";
import { cleanPastedText } from "../utils/pasteCleaner";

interface WritingSectionProps {
  title: string;
  body: string;
  isRecording: boolean;
  recordingStatus: string;
  recordingError: string | null;
  editorRef: RefObject<HTMLTextAreaElement>;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onRecordToggle: () => void | Promise<void>;
  onCursorChange: (start: number, end: number) => void;
}

type FormatKind = "bold" | "italic" | "underline";

export function WritingSection({
  title,
  body,
  isRecording,
  recordingStatus,
  recordingError,
  editorRef,
  onTitleChange,
  onBodyChange,
  onRecordToggle,
  onCursorChange,
}: WritingSectionProps) {
  const { t } = useI18n();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the title textarea to match its content height.
  // No max-height — the Knowledge Title expands as tall as the content needs.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // Auto-resize the body editor to match its content height.
  // The outer scroll container handles scrolling — the editor itself never clips.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const hasSelection = selection.end > selection.start;

  const syncSelection = (textarea: HTMLTextAreaElement) => {
    const nextSelection = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    setSelection(nextSelection);
    onCursorChange(nextSelection.start, nextSelection.end);
  };

  const focusEditorFromPanel = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea")) {
      return;
    }

    editorRef.current?.focus();
  };

  // Pressing Enter in the Knowledge Title moves focus to the body editor.
  // Titles are a single conceptual line — newlines are never inserted.
  const handleTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      editorRef.current?.focus();
      // Place cursor at the start of the editor body
      editorRef.current?.setSelectionRange(0, 0);
    }
  };

  const applyFormat = (kind: FormatKind) => {
    if (!hasSelection || !editorRef.current) {
      return;
    }

    const { start, end } = selection;
    const selectedText = body.slice(start, end);
    const wrappedText =
      kind === "bold"
        ? `**${selectedText}**`
        : kind === "italic"
          ? `_${selectedText}_`
          : `<u>${selectedText}</u>`;
    const nextBody = `${body.slice(0, start)}${wrappedText}${body.slice(end)}`;
    const nextEnd = start + wrappedText.length;

    onBodyChange(nextBody);
    setSelection({ start, end: nextEnd });
    onCursorChange(start, nextEnd);

    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(start, nextEnd);
    });
  };

  return (
    <section className="writing-panel" aria-label="Writing section">
      <div className="writing-document-scroll" onMouseDown={focusEditorFromPanel}>
        <article className="writing-document" aria-label="Knowledge document">
          <textarea
            ref={titleRef}
            id="note-title"
            className="title-input"
            value={title}
            rows={1}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={handleTitleKeyDown}
            placeholder={t("writing.title")}
            aria-label="Knowledge title"
            spellCheck
          />

          <div className="editor-wrap">
            {hasSelection ? (
              <div className="floating-format-toolbar" role="toolbar" aria-label="Text formatting">
                <button type="button" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("bold")}>
                  <Bold size={16} strokeWidth={2} />
                </button>
                <button type="button" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("italic")}>
                  <Italic size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label="Underline"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyFormat("underline")}
                >
                  <Underline size={16} strokeWidth={2} />
                </button>
              </div>
            ) : null}

            <textarea
              id="note-body"
              className="editor"
              ref={editorRef}
              value={body}
              onChange={(event) => {
                onBodyChange(event.target.value);
                syncSelection(event.target);
              }}
              onClick={(event) => syncSelection(event.currentTarget)}
              onKeyUp={(event) => syncSelection(event.currentTarget)}
              onSelect={(event) => syncSelection(event.currentTarget)}
              onPaste={(event) => {
                const clipboardValue = event.clipboardData.getData("text/plain");
                if (!clipboardValue) {
                  return;
                }

                event.preventDefault();
                const cleaned = cleanPastedText(clipboardValue);
                const textarea = event.currentTarget;
                const selectionStart = textarea.selectionStart;
                const selectionEnd = textarea.selectionEnd;
                const nextBody = `${body.slice(0, selectionStart)}${cleaned}${body.slice(selectionEnd)}`;
                const nextCursor = selectionStart + cleaned.length;
                onBodyChange(nextBody);
                setSelection({ start: nextCursor, end: nextCursor });
                onCursorChange(nextCursor, nextCursor);

                window.requestAnimationFrame(() => {
                  textarea.focus();
                  textarea.setSelectionRange(nextCursor, nextCursor);
                });
              }}
              placeholder={t("writing.placeholder")}
            />
          </div>
        </article>
      </div>

      <div className="writing-utility-bar" aria-label="Writing tools">
        <button
          className={`writing-mic-button ${isRecording ? "is-recording" : ""}`}
          type="button"
          onClick={() => void onRecordToggle()}
          aria-label={isRecording ? t("writing.stopRecording") : t("writing.recordVoice")}
          aria-pressed={isRecording}
          title={recordingError ?? recordingStatus}
        >
          <Mic size={18} strokeWidth={2} />
        </button>

        <div className="writing-record-status" aria-live="polite">
          <span>{recordingStatus}</span>
          {recordingError ? <span>{recordingError}</span> : null}
        </div>
      </div>
    </section>
  );
}

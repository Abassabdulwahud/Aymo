import { KeyboardEvent, MouseEvent, RefObject, useLayoutEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { useI18n } from "../i18n";
import { cleanPastedText } from "../utils/pasteCleaner";
import { EditorContextMenu } from "./EditorContextMenu";

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
  notes?: Array<{ id: number; title: string; cardTitle: string }>;
  onAskAI?: (prompt: string) => void;
}

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
  notes = [],
  onAskAI,
}: WritingSectionProps) {
  const { t } = useI18n();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  // Snapshot the selection at right-click time, before the textarea loses focus.
  // This is the fix for formatting tools appearing to do nothing:
  // browsers reset selectionStart/End to 0 on blur, so by the time a menu item
  // is clicked, reading the live DOM gives {0,0} instead of the real range.
  const savedSelectionRef = useRef({ start: 0, end: 0 });

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Auto-resize the title textarea to match its content height.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // Auto-resize the body editor to match its content height.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const selectedText = body.slice(selection.start, selection.end);

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
    if (target.closest("button, input, textarea, .editor-context-menu")) {
      return;
    }

    editorRef.current?.focus();
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(0, 0);
    }
  };

  // Helper to extract paragraph surrounding the cursor when nothing is selected
  const getParagraphAtCursor = (val: string, cursor: number) => {
    if (!val) return "";
    const before = val.slice(0, cursor);
    const after = val.slice(cursor);
    const startIdx = before.lastIndexOf("\n\n") !== -1 ? before.lastIndexOf("\n\n") + 2 : 0;
    const endIdx = after.indexOf("\n\n") !== -1 ? cursor + after.indexOf("\n\n") : val.length;
    return val.slice(startIdx, endIdx).trim();
  };

  const handleContextMenuAction = async (actionId: string, payload?: any) => {
    const textarea = editorRef.current;
    if (!textarea) return;

    // Use the selection that was active when the menu opened, NOT the live DOM
    // value (which browsers reset to 0 when the textarea loses focus).
    const start = savedSelectionRef.current.start;
    const end = savedSelectionRef.current.end;
    const selText = body.slice(start, end);

    const applyWrapping = (before: string, after: string = before) => {
      const nextBody = `${body.slice(0, start)}${before}${selText}${after}${body.slice(end)}`;
      onBodyChange(nextBody);
      const nextStart = start + before.length;
      const nextEnd = nextStart + selText.length;
      setSelection({ start: nextStart, end: nextEnd });
      onCursorChange(nextStart, nextEnd);
      window.requestAnimationFrame(() => {
        textarea.focus();
        if (start === end) {
          // Future typing: place cursor in between markers
          textarea.setSelectionRange(nextStart, nextStart);
        } else {
          textarea.setSelectionRange(nextStart, nextEnd);
        }
      });
    };

    switch (actionId) {
      case "cut":
        if (start !== end) {
          void navigator.clipboard?.writeText(selText);
          const nextBody = `${body.slice(0, start)}${body.slice(end)}`;
          onBodyChange(nextBody);
          setSelection({ start, end: start });
          onCursorChange(start, start);
          window.requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(start, start);
          });
        }
        break;
      case "copy":
        if (start !== end) {
          void navigator.clipboard?.writeText(selText);
        }
        break;
      case "paste":
        try {
          const text = await navigator.clipboard?.readText();
          if (text) {
            const nextBody = `${body.slice(0, start)}${text}${body.slice(end)}`;
            onBodyChange(nextBody);
            const nextCursor = start + text.length;
            setSelection({ start: nextCursor, end: nextCursor });
            onCursorChange(nextCursor, nextCursor);
            window.requestAnimationFrame(() => {
              textarea.focus();
              textarea.setSelectionRange(nextCursor, nextCursor);
            });
          }
        } catch {
          // Clipboard API block fallback
        }
        break;
      case "pastePlain":
        try {
          const text = await navigator.clipboard?.readText();
          if (text) {
            const plain = text.replace(/<[^>]*>/g, ""); // strip HTML tags
            const nextBody = `${body.slice(0, start)}${plain}${body.slice(end)}`;
            onBodyChange(nextBody);
            const nextCursor = start + plain.length;
            setSelection({ start: nextCursor, end: nextCursor });
            onCursorChange(nextCursor, nextCursor);
            window.requestAnimationFrame(() => {
              textarea.focus();
              textarea.setSelectionRange(nextCursor, nextCursor);
            });
          }
        } catch {
          // Clipboard fallback
        }
        break;
      case "selectAll":
        textarea.focus();
        textarea.setSelectionRange(0, body.length);
        setSelection({ start: 0, end: body.length });
        onCursorChange(0, body.length);
        break;
      case "bold":
        applyWrapping("**");
        break;
      case "italic":
        applyWrapping("_");
        break;
      case "underline":
        applyWrapping("<u>", "</u>");
        break;
      case "strikethrough":
        applyWrapping("~~");
        break;
      case "highlight":
        applyWrapping("==");
        break;
      case "clearFormat":
        if (start !== end) {
          const cleared = selText
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/_(.*?)_/g, "$1")
            .replace(/<u>(.*?)<\/u>/g, "$1")
            .replace(/~~(.*?)~~/g, "$1")
            .replace(/==(.*?)==/g, "$1")
            .replace(/<mark>(.*?)<\/mark>/g, "$1")
            .replace(/<span style="[^"]*">(.*?)<\/span>/g, "$1");
          const nextBody = `${body.slice(0, start)}${cleared}${body.slice(end)}`;
          onBodyChange(nextBody);
          const nextEnd = start + cleared.length;
          setSelection({ start, end: nextEnd });
          onCursorChange(start, nextEnd);
          window.requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(start, nextEnd);
          });
        }
        break;
      case "h1":
        applyWrapping("# ", "");
        break;
      case "h2":
        applyWrapping("## ", "");
        break;
      case "h3":
        applyWrapping("### ", "");
        break;
      case "textColor":
        if (payload) {
          applyWrapping(`<span style="color: ${payload}">`, "</span>");
        } else {
          // Reset default text color by stripping color span if selection matches
          applyWrapping("", "");
        }
        break;
      case "bgColor":
        if (payload) {
          applyWrapping(`<span style="background-color: ${payload}">`, "</span>");
        } else {
          applyWrapping("", "");
        }
        break;
      case "insertTable":
        applyWrapping("\n| Column 1 | Column 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n");
        break;
      case "insertCallout":
        applyWrapping("\n> [!NOTE]\n> Callout content\n");
        break;
      case "insertDivider":
        applyWrapping("\n---\n");
        break;
      case "insertCode":
        applyWrapping("\n```javascript\n", "\n```\n");
        break;
      case "insertMath":
        applyWrapping("\n$$\n", "\n$$\n");
        break;
      case "insertLinkedNote":
        if (payload) {
          applyWrapping(`[${payload.title || payload.cardTitle}](/notes/${payload.id})`, "");
        }
        break;
      case "searchSelected":
        if (selText.trim()) {
          window.open(`https://www.google.com/search?q=${encodeURIComponent(selText.trim())}`, "_blank");
        }
        break;
      case "aiExplain":
      case "aiSummarize":
      case "aiRewrite":
      case "aiSimplify":
      case "aiTranslate":
      case "aiContinue":
        if (onAskAI) {
          const contextText = selText.trim() || getParagraphAtCursor(body, start) || body.trim();
          let aiPrompt = "";
          if (actionId === "aiExplain") {
            aiPrompt = `Explain this context from my note: "${contextText}"`;
          } else if (actionId === "aiSummarize") {
            aiPrompt = `Summarize this context from my note: "${contextText}"`;
          } else if (actionId === "aiRewrite") {
            aiPrompt = `Rewrite and polish this context from my note: "${contextText}"`;
          } else if (actionId === "aiSimplify") {
            aiPrompt = `Simplify this context to make it clearer: "${contextText}"`;
          } else if (actionId === "aiTranslate") {
            aiPrompt = `Translate this context from my note: "${contextText}"`;
          } else if (actionId === "aiContinue") {
            aiPrompt = `Continue writing based on this note content: "${contextText}"`;
          }
          onAskAI(aiPrompt);
        }
        break;
      default:
        break;
    }
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
              onContextMenu={(e) => {
                e.preventDefault();
                // Snapshot selection NOW while the textarea still has focus.
                // After the menu mounts the textarea loses focus and the browser
                // zeros selectionStart/End — which is the root cause of formatting
                // tools appearing in the UI but doing nothing.
                const ta = e.currentTarget;
                savedSelectionRef.current = {
                  start: ta.selectionStart,
                  end: ta.selectionEnd,
                };
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
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

      {contextMenu && (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedText={selectedText}
          notes={notes}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
        />
      )}
    </section>
  );
}

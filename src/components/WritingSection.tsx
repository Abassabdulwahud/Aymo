import { KeyboardEvent, MouseEvent, RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { useI18n } from "../i18n";
import { EditorContextMenu } from "./EditorContextMenu";

// TipTap Rich-Text Editor imports
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

interface WritingSectionProps {
  title: string;
  body: string;
  isRecording: boolean;
  recordingStatus: string;
  recordingError: string | null;
  editorRef: RefObject<any>; // Changed to any to support the custom selection/focus bridge
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
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Context Menu coordinates state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Initialize TipTap Editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight.configure({ multicolor: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      TextStyle,
      Color,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: true, // Allow HTML tags like <u> and <span>
        linkify: true,
      }),
      Placeholder.configure({
        placeholder: t("writing.placeholder"),
      }),
    ],
    content: body,
    editorProps: {
      attributes: {
        class: "editor",
        id: "note-body",
      },
    },
    onUpdate: ({ editor }) => {
      // Serialize to Markdown to save
      const md = (editor.storage as any).markdown.getMarkdown();
      onBodyChange(md);

      // Notify of cursor changes
      const { from, to } = editor.state.selection;
      onCursorChange(from - 1, to - 1);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      onCursorChange(from - 1, to - 1);
    },
  });

  // Keep editor content in sync with external updates (like switching notes)
  useEffect(() => {
    if (!editor) return;
    const currentMarkdown = (editor.storage as any).markdown.getMarkdown();
    if (body !== currentMarkdown) {
      editor.commands.setContent(body);
    }
  }, [body, editor]);

  // Backwards-compatible Ref Bridge:
  // Maps standard textarea APIs (focus, selectionStart/End, setSelectionRange) to TipTap
  useEffect(() => {
    if (!editorRef || !editor) return;

    (editorRef as any).current = {
      focus: () => {
        editor.commands.focus();
      },
      setSelectionRange: (start: number, end: number) => {
        editor.commands.setTextSelection({ from: start + 1, to: end + 1 });
      },
      get selectionStart() {
        return editor.state.selection.from - 1;
      },
      get selectionEnd() {
        return editor.state.selection.to - 1;
      },
    };
  }, [editor, editorRef]);

  // Auto-resize the title textarea to match its content height.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const getSelectedText = () => {
    if (!editor) return "";
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  };

  const focusEditorFromPanel = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, .editor-context-menu, .tiptap")) {
      return;
    }
    editor?.commands.focus();
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      editor?.commands.focus();
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleContextMenuAction = async (actionId: string, payload?: any) => {
    if (!editor) return;

    const { from, to } = editor.state.selection;
    const selText = editor.state.doc.textBetween(from, to);

    switch (actionId) {
      case "cut":
        if (from !== to) {
          void navigator.clipboard?.writeText(selText);
          editor.commands.deleteSelection();
        }
        break;
      case "copy":
        if (from !== to) {
          void navigator.clipboard?.writeText(selText);
        }
        break;
      case "paste":
        try {
          const text = await navigator.clipboard?.readText();
          if (text) {
            editor.commands.insertContent(text);
          }
        } catch {
          // Clipboard fallback
        }
        break;
      case "pastePlain":
        try {
          const text = await navigator.clipboard?.readText();
          if (text) {
            const plain = text.replace(/<[^>]*>/g, ""); // strip HTML tags
            editor.commands.insertContent(plain);
          }
        } catch {
          // Clipboard fallback
        }
        break;
      case "selectAll":
        editor.commands.selectAll();
        break;
      case "bold":
        editor.chain().focus().toggleBold().run();
        break;
      case "italic":
        editor.chain().focus().toggleItalic().run();
        break;
      case "underline":
        editor.chain().focus().toggleUnderline().run();
        break;
      case "strikethrough":
        editor.chain().focus().toggleStrike().run();
        break;
      case "highlight":
        editor.chain().focus().toggleHighlight().run();
        break;
      case "clearFormat":
        editor.chain().focus().unsetAllMarks().clearNodes().run();
        break;
      case "h1":
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case "h2":
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case "h3":
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case "textColor":
        if (payload) {
          editor.chain().focus().setColor(payload).run();
        } else {
          editor.chain().focus().unsetColor().run();
        }
        break;
      case "bgColor":
        if (payload) {
          editor.chain().focus().toggleHighlight({ color: payload }).run();
        } else {
          editor.chain().focus().unsetHighlight().run();
        }
        break;
      case "insertTable":
        editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
        break;
      case "insertCallout":
        editor.chain().focus().toggleBlockquote().run();
        break;
      case "insertDivider":
        editor.chain().focus().setHorizontalRule().run();
        break;
      case "insertCode":
        editor.chain().focus().toggleCodeBlock().run();
        break;
      case "insertMath":
        editor.chain().focus().insertContent("\n$$\ne = mc^2\n$$\n").run();
        break;
      case "insertLinkedNote":
        if (payload) {
          editor.chain().focus().insertContent(`[${payload.title || payload.cardTitle}](/notes/${payload.id})`).run();
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
          let contextText = selText.trim();
          if (!contextText) {
            // Grab current paragraph/block
            contextText = editor.state.selection.$from.parent.textContent.trim();
          }
          if (!contextText) {
            contextText = editor.getText();
          }
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
        <article className="writing-document" aria-label="Knowledge document" onContextMenu={handleContextMenu}>
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
            <EditorContent editor={editor} />
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
          selectedText={getSelectedText()}
          notes={notes}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
        />
      )}
    </section>
  );
}

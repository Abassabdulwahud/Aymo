/**
 * SelectionContextMenu
 *
 * Reusable floating selection menu that shares the exact same visual design
 * as the Note Editor context menu (EditorContextMenu).
 *
 * It intentionally reuses:
 *  - SmartSubmenu from EditorContextMenu (same viewport-safe positioning)
 *  - The CSS classes .editor-context-menu / .editor-context-submenu / etc.
 *    so that both menus are guaranteed to look identical and inherit the
 *    same light/dark-mode tokens.
 *
 * Contexts:
 *  "pdf"  — full PDF annotation menu (compact cascading structure)
 *  "note" — trimmed set for note editor text selection
 *  "ai"   — minimal set for AI response text
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { SmartSubmenu } from "./EditorContextMenu";

const MARGIN = 10; // px safety margin from viewport edges

// ─────────────────────────────────────────────────────────────────────────────
// Action type union
// ─────────────────────────────────────────────────────────────────────────────

export type SelectionContext = "pdf" | "note" | "ai";

export type SelectionMenuAction =
  // Clipboard
  | "cut"
  | "copy"
  | "copy-with-citation"
  | "select-all"
  // Highlight colours (top-level shortcut)
  | "color-yellow"
  | "color-green"
  | "color-blue"
  | "color-pink"
  | "color-orange"
  | "remove-highlight"
  // Annotation (top-level quick buttons)
  | "annotate-highlight"
  | "annotate-comment"
  | "annotate-bookmark"
  // Format submenu
  | "annotate-underline"
  | "annotate-strikethrough"
  | "annotate-squiggly"
  | "annotate-redact"
  | "remove-annotation"
  // Insert submenu
  | "insert-comment"
  | "insert-sticky-note"
  | "insert-textbox"
  | "insert-arrow"
  | "insert-rectangle"
  | "insert-circle"
  | "insert-line"
  | "insert-freehand"
  | "insert-stamp"
  // Search
  | "search-selected"
  | "search-google"
  | "search-aymo"
  | "search-document"
  // AI
  | "ai-explain"
  | "ai-summarize"
  | "ai-rewrite"
  | "ai-simplify"
  | "ai-translate"
  | "ai-continue"
  | "ai-ask"
  | "ai-custom"
  // Knowledge
  | "km-create-note"
  | "km-append-note"
  | "km-link-note"
  | "km-bookmark"
  | "km-tag";

export interface SelectionContextMenuProps {
  x: number;
  y: number;
  selectedText: string;
  context: SelectionContext;
  pageNumber?: number;
  onAction: (action: SelectionMenuAction, selectedText: string) => void;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner helper: a submenu trigger button (mirrors menu-item-parent pattern)
// ─────────────────────────────────────────────────────────────────────────────

interface SubTriggerProps {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
  id: string;
  activeSubmenu: string | null;
  setActiveSubmenu: (id: string | null) => void;
}

function SubTrigger({
  label,
  shortcut,
  children,
  id,
  activeSubmenu,
  setActiveSubmenu,
}: SubTriggerProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={triggerRef}
      className="menu-item-parent"
      onMouseEnter={() => setActiveSubmenu(id)}
      onMouseLeave={() => setActiveSubmenu(null)}
    >
      <button type="button" className="has-submenu" aria-haspopup="true">
        {label}
        {shortcut && <span className="shortcut-label">{shortcut}</span>}
        <span className="submenu-arrow">▶</span>
      </button>

      {activeSubmenu === id && (
        <SmartSubmenu parentRef={triggerRef}>{children}</SmartSubmenu>
      )}
    </div>
  );
}

// Colour chip indicator
function ColorDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 11,
        height: 11,
        borderRadius: "50%",
        background: color,
        border: "1px solid rgba(0,0,0,0.12)",
        marginRight: 8,
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectionContextMenu (root)
// ─────────────────────────────────────────────────────────────────────────────

export function SelectionContextMenu({
  x,
  y,
  selectedText,
  context,
  onAction,
  onClose,
}: SelectionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState({ top: y, left: x });
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  // Viewport-safe positioning (same logic as EditorContextMenu)
  useEffect(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (x + rect.width > vw - MARGIN) left = Math.max(MARGIN, vw - rect.width - MARGIN);
    if (y + rect.height > vh - MARGIN) top = Math.max(MARGIN, vh - rect.height - MARGIN);
    setCoords({ top, left });
  }, [x, y]);

  // Click outside → close
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  // Escape → close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const fire = useCallback(
    (action: SelectionMenuAction) => {
      onAction(action, selectedText);
      onClose();
    },
    [onAction, onClose, selectedText],
  );

  const hasSelection = selectedText.trim().length > 0;

  // ── PDF context ─────────────────────────────────────────────────────────────
  if (context === "pdf") {
    return (
      <div
        ref={menuRef}
        className="editor-context-menu"
        style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
        role="menu"
        aria-label="PDF selection actions"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* ── Clipboard ── */}
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("cut")}>
          Cut <span className="shortcut-label">Ctrl+X</span>
        </button>
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("copy")}>
          Copy <span className="shortcut-label">Ctrl+C</span>
        </button>
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("copy-with-citation")}>
          Copy with Citation
        </button>

        <div className="menu-divider" />

        {/* ── Highlight (quick colour submenu) ── */}
        <SubTrigger
          id="highlight"
          label="Highlight"
          activeSubmenu={activeSubmenu}
          setActiveSubmenu={setActiveSubmenu}
        >
          <button type="button" role="menuitem" onClick={() => fire("color-yellow")}>
            <ColorDot color="#FFD60A" /> Yellow
          </button>
          <button type="button" role="menuitem" onClick={() => fire("color-green")}>
            <ColorDot color="#4ADE80" /> Green
          </button>
          <button type="button" role="menuitem" onClick={() => fire("color-blue")}>
            <ColorDot color="#60A5FA" /> Blue
          </button>
          <button type="button" role="menuitem" onClick={() => fire("color-pink")}>
            <ColorDot color="#F472B6" /> Pink
          </button>
          <button type="button" role="menuitem" onClick={() => fire("color-orange")}>
            <ColorDot color="#FB923C" /> Orange
          </button>
          <div className="menu-divider" />
          <button type="button" role="menuitem" onClick={() => fire("remove-highlight")}>
            Remove Highlight
          </button>
        </SubTrigger>

        {/* ── Comment & Bookmark (top-level) ── */}
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("annotate-comment")}>
          Comment
        </button>
        <button type="button" role="menuitem" onClick={() => fire("annotate-bookmark")}>
          Bookmark
        </button>

        <div className="menu-divider" />

        {/* ── Format submenu ── */}
        <SubTrigger
          id="format"
          label="Format"
          activeSubmenu={activeSubmenu}
          setActiveSubmenu={setActiveSubmenu}
        >
          <button type="button" role="menuitem" onClick={() => fire("annotate-highlight")}>
            Highlight
          </button>
          <button type="button" role="menuitem" onClick={() => fire("annotate-underline")}>
            Underline
          </button>
          <button type="button" role="menuitem" onClick={() => fire("annotate-strikethrough")}>
            Strikethrough
          </button>
          <button type="button" role="menuitem" onClick={() => fire("annotate-squiggly")}>
            Squiggly
          </button>
          <button type="button" role="menuitem" onClick={() => fire("annotate-redact")}>
            Redact
          </button>
          <div className="menu-divider" />
          <button type="button" role="menuitem" onClick={() => fire("remove-annotation")}>
            Remove Annotation
          </button>
        </SubTrigger>

        {/* ── Insert submenu ── */}
        <SubTrigger
          id="insert"
          label="Insert"
          activeSubmenu={activeSubmenu}
          setActiveSubmenu={setActiveSubmenu}
        >
          <button type="button" role="menuitem" onClick={() => fire("insert-comment")}>
            Comment
          </button>
          <button type="button" role="menuitem" onClick={() => fire("insert-sticky-note")}>
            Sticky Note
          </button>
          <button type="button" role="menuitem" onClick={() => fire("insert-textbox")}>
            Text Box
          </button>
          <div className="menu-divider" />
          <button type="button" role="menuitem" onClick={() => fire("insert-arrow")}>
            Arrow
          </button>
          <button type="button" role="menuitem" onClick={() => fire("insert-rectangle")}>
            Rectangle
          </button>
          <button type="button" role="menuitem" onClick={() => fire("insert-circle")}>
            Circle
          </button>
          <button type="button" role="menuitem" onClick={() => fire("insert-line")}>
            Line
          </button>
          <div className="menu-divider" />
          <button type="button" role="menuitem" onClick={() => fire("insert-freehand")}>
            Freehand Drawing
          </button>
          <button type="button" role="menuitem" onClick={() => fire("insert-stamp")}>
            Stamp
          </button>
        </SubTrigger>

        <div className="menu-divider" />

        {/* ── Search ── */}
        <button
          type="button"
          role="menuitem"
          disabled={!hasSelection}
          onClick={() => fire("search-selected")}
        >
          Search Selected Text
        </button>

        {/* ── Ask AI submenu ── */}
        <SubTrigger
          id="ai"
          label="Ask AI"
          activeSubmenu={activeSubmenu}
          setActiveSubmenu={setActiveSubmenu}
        >
          <button type="button" role="menuitem" onClick={() => fire("ai-explain")}>
            Explain
          </button>
          <button type="button" role="menuitem" onClick={() => fire("ai-summarize")}>
            Summarize
          </button>
          <button type="button" role="menuitem" onClick={() => fire("ai-simplify")}>
            Simplify
          </button>
          <button type="button" role="menuitem" onClick={() => fire("ai-translate")}>
            Translate
          </button>
          <button type="button" role="menuitem" onClick={() => fire("ai-continue")}>
            Continue
          </button>
          <div className="menu-divider" />
          <button type="button" role="menuitem" onClick={() => fire("ai-custom")}>
            Ask Custom Question…
          </button>
        </SubTrigger>

        <div className="menu-divider" />

        {/* ── Select All ── */}
        <button type="button" role="menuitem" onClick={() => fire("select-all")}>
          Select All <span className="shortcut-label">Ctrl+A</span>
        </button>
      </div>
    );
  }

  // ── Note context ─────────────────────────────────────────────────────────────
  if (context === "note") {
    return (
      <div
        ref={menuRef}
        className="editor-context-menu"
        style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
        role="menu"
        aria-label="Note selection actions"
        onContextMenu={(e) => e.preventDefault()}
      >
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("copy")}>
          Copy <span className="shortcut-label">Ctrl+C</span>
        </button>
        <div className="menu-divider" />
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("ai-explain")}>
          Explain
        </button>
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("ai-summarize")}>
          Summarize
        </button>
        <div className="menu-divider" />
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("search-selected")}>
          Search Google
        </button>
      </div>
    );
  }

  // ── AI context ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
      role="menu"
      aria-label="AI response actions"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => fire("copy")}>
        Copy <span className="shortcut-label">Ctrl+C</span>
      </button>
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("km-create-note")}>
        Create Note
      </button>
      <div className="menu-divider" />
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("ai-explain")}>
        Explain
      </button>
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("ai-simplify")}>
        Simplify
      </button>
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => fire("ai-continue")}>
        Continue
      </button>
    </div>
  );
}

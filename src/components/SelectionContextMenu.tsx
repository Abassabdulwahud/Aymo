/**
 * SelectionContextMenu — reusable floating action menu for text selections.
 *
 * Supports three contexts:
 *   "pdf"  — annotation, clipboard, AI, knowledge management, search
 *   "note" — trimmed action set appropriate for the note editor
 *   "ai"   — actions on AI response text
 *
 * Viewport-safe: submenus flip left/up when they would overflow the window.
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ── types ─────────────────────────────────────────────────────────────────────

export type SelectionContext = "pdf" | "note" | "ai";

export type SelectionMenuAction =
  // Annotation
  | "annotate-highlight"
  | "annotate-underline"
  | "annotate-strikethrough"
  | "annotate-comment"
  | "annotate-bookmark"
  | "color-yellow"
  | "color-green"
  | "color-blue"
  | "color-pink"
  // Clipboard
  | "copy"
  | "copy-with-citation"
  // AI
  | "ai-explain"
  | "ai-summarize"
  | "ai-rewrite"
  | "ai-simplify"
  | "ai-translate"
  | "ai-ask"
  | "ai-continue"
  // Knowledge
  | "km-create-note"
  | "km-append-note"
  | "km-link-note"
  | "km-bookmark"
  | "km-tag"
  // Search
  | "search-google"
  | "search-aymo"
  | "search-document";

export interface SelectionContextMenuProps {
  x: number;
  y: number;
  selectedText: string;
  context: SelectionContext;
  pageNumber?: number;
  onAction: (action: SelectionMenuAction, selectedText: string) => void;
  onClose: () => void;
}

// ── constants ─────────────────────────────────────────────────────────────────

const MARGIN = 10; // px safety margin from viewport edges
const SUBMENU_WIDTH = 200;
const MENU_WIDTH = 220;

// ── SmartSubmenu ──────────────────────────────────────────────────────────────

interface SubItem {
  label: string;
  action: SelectionMenuAction;
  color?: string;
}

interface SmartSubmenuProps {
  parentRef: React.RefObject<HTMLLIElement | null>;
  items: SubItem[];
  onAction: (action: SelectionMenuAction) => void;
}

function SmartSubmenu({ parentRef, items, onAction }: SmartSubmenuProps) {
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    opacity: 0,
    pointerEvents: "none",
    top: 0,
    left: 0,
    width: SUBMENU_WIDTH,
  });

  useEffect(() => {
    const parent = parentRef.current;
    const menu = menuRef.current;
    if (!parent || !menu) return;

    const parentRect = parent.getBoundingClientRect();
    const menuHeight = menu.offsetHeight || items.length * 36;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer right side; flip left if not enough room
    let left = parentRect.right + 2;
    if (left + SUBMENU_WIDTH + MARGIN > vw) {
      left = parentRect.left - SUBMENU_WIDTH - 2;
    }

    // Prefer same top; shift up if overflows bottom
    let top = parentRect.top;
    if (top + menuHeight + MARGIN > vh) {
      top = vh - menuHeight - MARGIN;
    }
    if (top < MARGIN) top = MARGIN;

    setStyle({
      position: "fixed",
      top,
      left,
      width: SUBMENU_WIDTH,
      opacity: 1,
      pointerEvents: "auto",
    });
  }, [parentRef, items.length]);

  return (
    <ul ref={menuRef} className="scm-submenu" style={style} role="menu">
      {items.map((item) => (
        <li
          key={item.action}
          className="scm-item"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onAction(item.action);
          }}
        >
          {item.color && (
            <span
              className="scm-color-chip"
              style={{ background: item.color }}
            />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ── MenuItem with optional submenu ────────────────────────────────────────────

interface MenuItemProps {
  label: string;
  icon?: string;
  subItems?: SubItem[];
  action?: SelectionMenuAction;
  onAction: (action: SelectionMenuAction) => void;
}

function MenuItem({ label, icon, subItems, action, onAction }: MenuItemProps) {
  const [open, setOpen] = useState(false);
  const liRef = useRef<HTMLLIElement | null>(null);

  return (
    <li
      ref={liRef}
      className={`scm-item${subItems ? " scm-has-sub" : ""}`}
      role="menuitem"
      aria-haspopup={!!subItems}
      aria-expanded={open}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        if (!subItems && action) {
          e.stopPropagation();
          onAction(action);
        }
      }}
    >
      {icon && <span className="scm-icon">{icon}</span>}
      <span className="scm-label">{label}</span>
      {subItems && <span className="scm-arrow">›</span>}
      {open && subItems && (
        <SmartSubmenu
          parentRef={liRef}
          items={subItems}
          onAction={onAction}
        />
      )}
    </li>
  );
}

// ── divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <li className="scm-divider" role="separator" />;
}

// ── group label ───────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
  return <li className="scm-group-label">{label}</li>;
}

// ── SelectionContextMenu ──────────────────────────────────────────────────────

export function SelectionContextMenu({
  x,
  y,
  selectedText,
  context,
  onAction,
  onClose,
}: SelectionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: y,
    left: x,
    opacity: 0,
    width: MENU_WIDTH,
  });

  // Smart positioning: keep menu fully inside viewport
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const menuHeight = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = y;
    let left = x;
    if (left + MENU_WIDTH + MARGIN > vw) left = vw - MENU_WIDTH - MARGIN;
    if (top + menuHeight + MARGIN > vh) top = vh - menuHeight - MARGIN;
    if (top < MARGIN) top = MARGIN;
    if (left < MARGIN) left = MARGIN;

    setStyle({ position: "fixed", top, left, opacity: 1, width: MENU_WIDTH });
  }, [x, y]);

  // Close on outside click / escape
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const handle = useCallback(
    (action: SelectionMenuAction) => {
      onAction(action, selectedText);
      onClose();
    },
    [onAction, onClose, selectedText],
  );

  // ── PDF context ─────────────────────────────────────────────────────────────
  const pdfItems = (
    <>
      <GroupLabel label="Annotation" />
      <MenuItem
        label="Highlight"
        icon="🖊"
        subItems={[
          { label: "Yellow", action: "color-yellow", color: "#FFD60A" },
          { label: "Green",  action: "color-green",  color: "#4ADE80" },
          { label: "Blue",   action: "color-blue",   color: "#60A5FA" },
          { label: "Pink",   action: "color-pink",   color: "#F472B6" },
        ]}
        onAction={handle}
      />
      <MenuItem label="Underline"     icon="U̲" action="annotate-underline"     onAction={handle} />
      <MenuItem label="Strikethrough" icon="S̶" action="annotate-strikethrough" onAction={handle} />
      <MenuItem label="Add Comment"   icon="💬" action="annotate-comment"       onAction={handle} />
      <MenuItem label="Bookmark"      icon="🔖" action="annotate-bookmark"      onAction={handle} />
      <Divider />
      <GroupLabel label="Clipboard" />
      <MenuItem label="Copy"               icon="⎘" action="copy"               onAction={handle} />
      <MenuItem label="Copy with Citation" icon="📄" action="copy-with-citation" onAction={handle} />
      <Divider />
      <GroupLabel label="AI" />
      <MenuItem label="Explain"    icon="💡" action="ai-explain"    onAction={handle} />
      <MenuItem label="Summarize"  icon="📝" action="ai-summarize"  onAction={handle} />
      <MenuItem label="Simplify"   icon="✨" action="ai-simplify"   onAction={handle} />
      <MenuItem label="Translate"  icon="🌐" action="ai-translate"  onAction={handle} />
      <MenuItem label="Ask AI…"    icon="🤖" action="ai-ask"        onAction={handle} />
      <Divider />
      <GroupLabel label="Knowledge" />
      <MenuItem label="Create Note"         icon="📔" action="km-create-note" onAction={handle} />
      <MenuItem label="Append to Note"      icon="➕" action="km-append-note"  onAction={handle} />
      <Divider />
      <GroupLabel label="Search" />
      <MenuItem label="Search Google"        icon="🔍" action="search-google"   onAction={handle} />
      <MenuItem label="Search in AYMO"       icon="🔎" action="search-aymo"     onAction={handle} />
      <MenuItem label="Search in Document"   icon="📖" action="search-document" onAction={handle} />
    </>
  );

  // ── Note context ────────────────────────────────────────────────────────────
  const noteItems = (
    <>
      <MenuItem label="Copy"      icon="⎘" action="copy"       onAction={handle} />
      <MenuItem label="Explain"   icon="💡" action="ai-explain"  onAction={handle} />
      <MenuItem label="Summarize" icon="📝" action="ai-summarize" onAction={handle} />
      <MenuItem label="Search Google" icon="🔍" action="search-google" onAction={handle} />
    </>
  );

  // ── AI context ──────────────────────────────────────────────────────────────
  const aiItems = (
    <>
      <MenuItem label="Copy"          icon="⎘"  action="copy"         onAction={handle} />
      <MenuItem label="Create Note"   icon="📔" action="km-create-note" onAction={handle} />
      <MenuItem label="Explain"       icon="💡" action="ai-explain"    onAction={handle} />
      <MenuItem label="Simplify"      icon="✨" action="ai-simplify"   onAction={handle} />
      <MenuItem label="Continue"      icon="➡" action="ai-continue"   onAction={handle} />
    </>
  );

  return (
    <div
      ref={menuRef}
      className="scm-root"
      style={style}
      role="menu"
      aria-label="Selection actions"
      onContextMenu={(e) => e.preventDefault()}
    >
      <ul className="scm-list">
        {context === "pdf"  && pdfItems}
        {context === "note" && noteItems}
        {context === "ai"   && aiItems}
      </ul>
    </div>
  );
}

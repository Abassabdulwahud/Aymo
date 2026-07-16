import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MARGIN = 10; // safety gap from viewport edges in px

interface SmartSubmenuProps {
  parentRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  role?: string;
}

/**
 * SmartSubmenu renders a floating submenu that is always positioned fully
 * within the visible viewport.
 *
 * Strategy:
 * 1. Mount with `visibility: hidden` so the browser can measure its true size.
 * 2. In useLayoutEffect (before paint), read the parent anchor rect + submenu
 *    dimensions and compute the best position.
 * 3. Apply the position and flip to `visibility: visible` in one synchronous
 *    layout cycle — no flicker.
 *
 * Horizontal preference: opens to the right of the parent.
 *   Flips left if there is not enough room on the right.
 * Vertical preference: aligns the top of the submenu with the top of the
 *   parent row. Shifts upward if the bottom would overflow.
 */
export function SmartSubmenu({
  parentRef,
  children,
  className = "",
  role = "menu",
}: SmartSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    top: 0,
    left: 0,
    zIndex: 10000,
  });

  useLayoutEffect(() => {
    const submenu = submenuRef.current;
    const parent = parentRef.current;
    if (!submenu || !parent) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const parentRect = parent.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const sw = submenuRect.width;
    const sh = submenuRect.height;

    // ── Horizontal ────────────────────────────────────────────────────────
    // Default: open to the right of the parent
    let left = parentRect.right - 2;
    if (left + sw > vw - MARGIN) {
      // Not enough room on the right → open to the left
      left = parentRect.left - sw + 2;
    }
    // Final clamp so it never exits the viewport
    left = Math.max(MARGIN, Math.min(left, vw - sw - MARGIN));

    // ── Vertical ──────────────────────────────────────────────────────────
    // Default: top of submenu aligns with top of parent row
    let top = parentRect.top;
    if (top + sh > vh - MARGIN) {
      // Shift up so the bottom edge stays inside
      top = vh - sh - MARGIN;
    }
    top = Math.max(MARGIN, top);

    setStyle({
      position: "fixed",
      visibility: "visible",
      top,
      left,
      zIndex: 10000,
    });
  }, []); // runs once on mount — parent geometry is stable while the submenu is open

  return (
    <div ref={submenuRef} className={`editor-context-submenu ${className}`} role={role} style={style}>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component interfaces
// ────────────────────────────────────────────────────────────────────────────

interface EditorContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAction: (actionId: string, payload?: any) => void;
  selectedText: string;
  notes: Array<{ id: number; title: string; cardTitle: string }>;
}

export function EditorContextMenu({
  x,
  y,
  onClose,
  onAction,
  selectedText,
  notes,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [coords, setCoords] = useState({ top: y, left: x });

  // Refs used so SmartSubmenu can read parent geometry
  const formatTriggerRef = useRef<HTMLDivElement | null>(null);
  const insertTriggerRef = useRef<HTMLDivElement | null>(null);
  const aiTriggerRef = useRef<HTMLDivElement | null>(null);

  // Keep main menu within screen boundaries
  useEffect(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nextLeft = x;
    let nextTop = y;

    if (x + rect.width > vw - MARGIN) {
      nextLeft = Math.max(MARGIN, vw - rect.width - MARGIN);
    }
    if (y + rect.height > vh - MARGIN) {
      nextTop = Math.max(MARGIN, vh - rect.height - MARGIN);
    }

    setCoords({ top: nextTop, left: nextLeft });
  }, [x, y]);

  // Click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleItemClick = (actionId: string, payload?: any) => {
    onAction(actionId, payload);
    onClose();
  };

  const hasSelection = selectedText.trim().length > 0;

  const textColors = [
    { name: "Default", color: "" },
    { name: "Muted Gray", color: "#8b949e" },
    { name: "Terracotta Red", color: "#f87171" },
    { name: "Classic Blue", color: "#60a5fa" },
    { name: "Olive Green", color: "#34d399" },
    { name: "Warm Amber", color: "#fbbf24" },
  ];

  const bgColors = [
    { name: "Clear", color: "" },
    { name: "Gray", color: "rgba(139,148,158,0.15)" },
    { name: "Red", color: "rgba(248,113,113,0.15)" },
    { name: "Blue", color: "rgba(96,165,250,0.15)" },
    { name: "Green", color: "rgba(52,211,153,0.15)" },
    { name: "Yellow", color: "rgba(251,191,36,0.15)" },
  ];

  return (
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={{ position: "fixed", top: `${coords.top}px`, left: `${coords.left}px`, zIndex: 9999 }}
      role="menu"
      aria-label="Editor context actions"
    >
      {/* ── Clipboard ── */}
      <button type="button" role="menuitem" onClick={() => handleItemClick("cut")}>
        Cut <span className="shortcut-label">Ctrl+X</span>
      </button>
      <button type="button" role="menuitem" onClick={() => handleItemClick("copy")}>
        Copy <span className="shortcut-label">Ctrl+C</span>
      </button>
      <button type="button" role="menuitem" onClick={() => handleItemClick("paste")}>
        Paste <span className="shortcut-label">Ctrl+V</span>
      </button>
      <button type="button" role="menuitem" onClick={() => handleItemClick("pastePlain")}>
        Paste as Plain Text <span className="shortcut-label">Ctrl+Shift+V</span>
      </button>

      <div className="menu-divider" />

      {/* ── Format submenu ── */}
      <div
        ref={formatTriggerRef}
        className="menu-item-parent"
        onMouseEnter={() => setActiveSubmenu("format")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button type="button" className="has-submenu" aria-haspopup="true">
          Format <span className="submenu-arrow">▶</span>
        </button>

        {activeSubmenu === "format" && (
          <SmartSubmenu parentRef={formatTriggerRef} className="format-submenu">
            <button type="button" role="menuitem" onClick={() => handleItemClick("bold")}>
              Bold <span className="shortcut-label">Ctrl+B</span>
            </button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("italic")}>
              Italic <span className="shortcut-label">Ctrl+I</span>
            </button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("underline")}>
              Underline <span className="shortcut-label">Ctrl+U</span>
            </button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("strikethrough")}>
              Strikethrough
            </button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("highlight")}>
              Highlight
            </button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("clearFormat")}>
              Clear Formatting
            </button>

            <div className="menu-divider" />

            <button type="button" role="menuitem" onClick={() => handleItemClick("h1")}>Heading 1</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("h2")}>Heading 2</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("h3")}>Heading 3</button>

            <div className="menu-divider" />

            <ColorSubmenu
              label="Text Color"
              items={textColors}
              onPick={(color) => handleItemClick("textColor", color)}
            />
            <ColorSubmenu
              label="Background Color"
              items={bgColors}
              onPick={(color) => handleItemClick("bgColor", color)}
            />
          </SmartSubmenu>
        )}
      </div>

      {/* ── Insert submenu ── */}
      <div
        ref={insertTriggerRef}
        className="menu-item-parent"
        onMouseEnter={() => setActiveSubmenu("insert")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button type="button" className="has-submenu" aria-haspopup="true">
          Insert <span className="submenu-arrow">▶</span>
        </button>

        {activeSubmenu === "insert" && (
          <SmartSubmenu parentRef={insertTriggerRef} className="insert-submenu">
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertTable")}>Table</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertCallout")}>Callout</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertDivider")}>Divider</button>
            <div className="menu-divider" />
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertCode")}>Code Block</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertMath")}>Math Block</button>
            <div className="menu-divider" />
            <LinkedNoteSubmenu notes={notes} onPick={(note) => handleItemClick("insertLinkedNote", note)} />
          </SmartSubmenu>
        )}
      </div>

      <div className="menu-divider" />

      {/* ── Search Selected Text ── */}
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelection}
        onClick={() => handleItemClick("searchSelected")}
      >
        Search Selected Text
      </button>

      {/* ── Ask AI submenu ── */}
      <div
        ref={aiTriggerRef}
        className="menu-item-parent"
        onMouseEnter={() => setActiveSubmenu("ai")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button type="button" className="has-submenu" aria-haspopup="true">
          Ask AI <span className="submenu-arrow">▶</span>
        </button>

        {activeSubmenu === "ai" && (
          <SmartSubmenu parentRef={aiTriggerRef} className="ai-submenu">
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiExplain")}>Explain</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiSummarize")}>Summarize</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiRewrite")}>Rewrite</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiSimplify")}>Simplify</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiTranslate")}>Translate</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiContinue")}>Continue Writing</button>
          </SmartSubmenu>
        )}
      </div>

      <div className="menu-divider" />

      {/* ── Select All ── */}
      <button type="button" role="menuitem" onClick={() => handleItemClick("selectAll")}>
        Select All <span className="shortcut-label">Ctrl+A</span>
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable inner submenu helpers
// ────────────────────────────────────────────────────────────────────────────

interface ColorItem {
  name: string;
  color: string;
}

function ColorSubmenu({
  label,
  items,
  onPick,
}: {
  label: string;
  items: ColorItem[];
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={triggerRef}
      className="menu-item-parent-inner"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="submenu-label">
        {label} <span className="submenu-arrow">▶</span>
      </span>

      {open && (
        <SmartSubmenu parentRef={triggerRef}>
          {items.map((item) => (
            <button
              key={item.name}
              type="button"
              role="menuitem"
              onClick={() => onPick(item.color)}
            >
              {item.color ? (
                <span className="color-indicator" style={{ backgroundColor: item.color }} />
              ) : (
                <span className="color-indicator clear" />
              )}
              {item.name}
            </button>
          ))}
        </SmartSubmenu>
      )}
    </div>
  );
}

function LinkedNoteSubmenu({
  notes,
  onPick,
}: {
  notes: Array<{ id: number; title: string; cardTitle: string }>;
  onPick: (note: { id: number; title: string; cardTitle: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={triggerRef}
      className="menu-item-parent-inner"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="submenu-label">
        Linked Note <span className="submenu-arrow">▶</span>
      </span>

      {open && (
        <SmartSubmenu parentRef={triggerRef} className="notes-list-menu">
          {notes.length === 0 ? (
            <span className="no-notes-label">No notes found</span>
          ) : (
            notes.map((note) => (
              <button
                key={note.id}
                type="button"
                role="menuitem"
                onClick={() => onPick(note)}
              >
                {note.title || note.cardTitle}
              </button>
            ))
          )}
        </SmartSubmenu>
      )}
    </div>
  );
}

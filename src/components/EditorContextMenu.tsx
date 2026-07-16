import { useEffect, useRef, useState } from "react";

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

  // Keep menu within screen boundaries
  useEffect(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const rect = menuEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextLeft = x;
    let nextTop = y;

    // Check right edge overflow
    if (x + rect.width > viewportWidth) {
      nextLeft = Math.max(8, viewportWidth - rect.width - 8);
    }
    // Check bottom edge overflow
    if (y + rect.height > viewportHeight) {
      nextTop = Math.max(8, viewportHeight - rect.height - 8);
    }

    setCoords({ top: nextTop, left: nextLeft });
  }, [x, y]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleItemClick = (actionId: string, payload?: any) => {
    onAction(actionId, payload);
    onClose();
  };

  const hasSelection = selectedText.trim().length > 0;

  // Premium academic color palettes for submenus
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
      style={{
        position: "fixed",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 9999,
      }}
      role="menu"
      aria-label="Editor context actions"
    >
      {/* Clipboard section */}
      <button type="button" role="menuitem" onClick={() => handleItemClick("cut")}>
        Cut
        <span className="shortcut-label">Ctrl+X</span>
      </button>
      <button type="button" role="menuitem" onClick={() => handleItemClick("copy")}>
        Copy
        <span className="shortcut-label">Ctrl+C</span>
      </button>
      <button type="button" role="menuitem" onClick={() => handleItemClick("paste")}>
        Paste
        <span className="shortcut-label">Ctrl+V</span>
      </button>
      <button type="button" role="menuitem" onClick={() => handleItemClick("pastePlain")}>
        Paste as Plain Text
        <span className="shortcut-label">Ctrl+Shift+V</span>
      </button>

      <div className="menu-divider" />

      {/* Format Submenu trigger */}
      <div
        className="menu-item-parent"
        onMouseEnter={() => setActiveSubmenu("format")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button type="button" className="has-submenu" aria-haspopup="true">
          Format
          <span className="submenu-arrow">▶</span>
        </button>
        {activeSubmenu === "format" && (
          <div className="editor-context-submenu format-submenu" role="menu">
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

            {/* Text Color Submenu */}
            <div className="menu-item-parent-inner">
              <span className="submenu-label">Text Color <span className="submenu-arrow">▶</span></span>
              <div className="editor-context-submenu-inner" role="menu">
                {textColors.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    role="menuitem"
                    onClick={() => handleItemClick("textColor", color.color)}
                  >
                    {color.color ? (
                      <span className="color-indicator" style={{ backgroundColor: color.color }} />
                    ) : (
                      <span className="color-indicator clear" />
                    )}
                    {color.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Background Color Submenu */}
            <div className="menu-item-parent-inner">
              <span className="submenu-label">Background Color <span className="submenu-arrow">▶</span></span>
              <div className="editor-context-submenu-inner" role="menu">
                {bgColors.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    role="menuitem"
                    onClick={() => handleItemClick("bgColor", color.color)}
                  >
                    {color.color ? (
                      <span className="color-indicator" style={{ backgroundColor: color.color }} />
                    ) : (
                      <span className="color-indicator clear" />
                    )}
                    {color.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Insert Submenu trigger */}
      <div
        className="menu-item-parent"
        onMouseEnter={() => setActiveSubmenu("insert")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button type="button" className="has-submenu" aria-haspopup="true">
          Insert
          <span className="submenu-arrow">▶</span>
        </button>
        {activeSubmenu === "insert" && (
          <div className="editor-context-submenu insert-submenu" role="menu">
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertTable")}>Table</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertCallout")}>Callout</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertDivider")}>Divider</button>
            <div className="menu-divider" />
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertCode")}>Code Block</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("insertMath")}>Math Block</button>
            <div className="menu-divider" />

            {/* Linked Note Submenu */}
            <div className="menu-item-parent-inner">
              <span className="submenu-label">Linked Note <span className="submenu-arrow">▶</span></span>
              <div className="editor-context-submenu-inner notes-list-menu" role="menu">
                {notes.length === 0 ? (
                  <span className="no-notes-label">No notes found</span>
                ) : (
                  notes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleItemClick("insertLinkedNote", note)}
                    >
                      {note.title || note.cardTitle}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="menu-divider" />

      {/* Search Selected Text */}
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelection}
        onClick={() => handleItemClick("searchSelected")}
      >
        Search Selected Text
      </button>

      {/* Ask AI Submenu trigger */}
      <div
        className="menu-item-parent"
        onMouseEnter={() => setActiveSubmenu("ai")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button type="button" className="has-submenu" aria-haspopup="true">
          Ask AI
          <span className="submenu-arrow">▶</span>
        </button>
        {activeSubmenu === "ai" && (
          <div className="editor-context-submenu ai-submenu" role="menu">
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiExplain")}>Explain</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiSummarize")}>Summarize</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiRewrite")}>Rewrite</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiSimplify")}>Simplify</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiTranslate")}>Translate</button>
            <button type="button" role="menuitem" onClick={() => handleItemClick("aiContinue")}>Continue Writing</button>
          </div>
        )}
      </div>

      <div className="menu-divider" />

      {/* Select All */}
      <button type="button" role="menuitem" onClick={() => handleItemClick("selectAll")}>
        Select All
        <span className="shortcut-label">Ctrl+A</span>
      </button>
    </div>
  );
}

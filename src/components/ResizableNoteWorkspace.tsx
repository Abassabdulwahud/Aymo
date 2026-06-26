import { ReactNode, useEffect, useRef, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { loadNoteRightPanelLayout, saveNoteRightPanelLayout } from "../services/noteLayoutStorage";

const MIN_LEFT_WIDTH = 360;
const MIN_RIGHT_WIDTH = 360;
const DIVIDER_WIDTH = 8;
const DEFAULT_RIGHT_RATIO = 0.42;

type ResizableNoteWorkspaceProps = {
  left: ReactNode;
  right: ReactNode;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function ResizableNoteWorkspace({ left, right, isCollapsed, onToggleCollapse }: ResizableNoteWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return loadNoteRightPanelLayout().rightPanelWidth;
  });
  const [isDragging, setIsDragging] = useState(false);

  const getClampedWidth = (rawWidth: number) => {
    const container = containerRef.current;
    if (!container) {
      return rawWidth;
    }

    const availableWidth = container.clientWidth - DIVIDER_WIDTH;
    const maxRightWidth = Math.max(MIN_RIGHT_WIDTH, availableWidth - MIN_LEFT_WIDTH);
    return clamp(rawWidth, MIN_RIGHT_WIDTH, maxRightWidth);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateLayoutWidth = () => {
      setRightPanelWidth((current) => {
        const availableWidth = container.clientWidth - DIVIDER_WIDTH;
        const fallbackWidth = availableWidth * DEFAULT_RIGHT_RATIO;
        return getClampedWidth(current ?? fallbackWidth);
      });
    };

    updateLayoutWidth();

    const observer = new ResizeObserver(updateLayoutWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (rightPanelWidth === null) {
      return;
    }

    document.documentElement.style.setProperty("--note-right-panel-width", `${rightPanelWidth}px`);
    saveNoteRightPanelLayout({ rightPanelWidth });
  }, [rightPanelWidth]);

  const resizeToClientX = (clientX: number) => {
    if (isCollapsed) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    setRightPanelWidth(getClampedWidth(rect.right - clientX));
  };

  const startDragging = (clientX: number) => {
    if (isCollapsed) {
      return;
    }

    setIsDragging(true);
    resizeToClientX(clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resizeToClientX(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  useEffect(() => {
    if (isCollapsed) {
      return;
    }

    const headerDivider = document.querySelector<HTMLElement>(".note-topbar-divider");
    if (!headerDivider) {
      return;
    }

    const handleHeaderPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      startDragging(event.clientX);
    };

    headerDivider.addEventListener("pointerdown", handleHeaderPointerDown);
    return () => headerDivider.removeEventListener("pointerdown", handleHeaderPointerDown);
  }, [isCollapsed]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    startDragging(event.clientX);
  };

  return (
    <div
      ref={containerRef}
      className={`note-split-pane ${isDragging ? "is-dragging" : ""} ${isCollapsed ? "is-collapsed" : ""}`}
    >
      <div className="note-split-pane-left">{left}</div>
      {!isCollapsed ? (
        <div
          className="note-split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize note panels"
          onPointerDown={handlePointerDown}
        />
      ) : null}
      <div
        className="note-split-pane-right"
        aria-hidden={isCollapsed}
        style={rightPanelWidth === null ? undefined : { flexBasis: rightPanelWidth, width: rightPanelWidth }}
      >
        {right}
      </div>
      {isCollapsed ? (
        <button
          className="note-panel-reopen-button"
          type="button"
          onClick={onToggleCollapse}
          aria-label="Reopen right panel"
        >
          <PanelRightOpen size={20} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

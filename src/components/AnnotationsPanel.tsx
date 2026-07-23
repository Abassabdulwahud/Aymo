/**
 * AnnotationsPanel
 *
 * Right-side panel listing all annotations for the active PDF document.
 * - Groups entries by page number
 * - Clicking an entry fires onJumpToPage + onFlash so the viewer scrolls and
 *   flashes the matching overlay
 * - Inline comment editing
 * - Delete, Create Note, and Append to Note actions per annotation
 */

import { useState } from "react";
import type { Annotation, AnnotationType } from "../types";

interface AnnotationsPanelProps {
  annotations: Annotation[];
  onJumpToPage: (pageIndex: number) => void;
  onFlash: (annotationId: string | number) => void;
  onDelete: (annotationId: string | number) => void;
  onUpdateComment: (annotationId: string | number, comment: string) => void;
  onCreateNote: (annotation: Annotation) => void;
  onAppendToNote: (annotation: Annotation) => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<AnnotationType | string, string> = {
  highlight:     "Highlight",
  underline:     "Underline",
  strikethrough: "Strikethrough",
  comment:       "Comment",
  bookmark:      "Bookmark",
};

const TYPE_ICON: Record<AnnotationType | string, string> = {
  highlight:     "🖊",
  underline:     "U̲",
  strikethrough: "S̶",
  comment:       "💬",
  bookmark:      "🔖",
};

// Group annotations by page number, preserving creation order within a page.
function groupByPage(annotations: Annotation[]): Map<number, Annotation[]> {
  const map = new Map<number, Annotation[]>();
  for (const a of annotations) {
    const page = a.page_number ?? 0;
    if (!map.has(page)) map.set(page, []);
    map.get(page)!.push(a);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a - b));
}

export function AnnotationsPanel({
  annotations,
  onJumpToPage,
  onFlash,
  onDelete,
  onUpdateComment,
  onCreateNote,
  onAppendToNote,
  onClose,
}: AnnotationsPanelProps) {
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null);

  const grouped = groupByPage(annotations);

  const handleItemClick = (annotation: Annotation) => {
    if (annotation.page_number !== null) {
      onJumpToPage(annotation.page_number);
    }
    onFlash(annotation.id);
  };

  const startEdit = (annotation: Annotation) => {
    setEditingId(annotation.id);
    setEditText(annotation.comment ?? "");
  };

  const commitEdit = (annotationId: string | number) => {
    onUpdateComment(annotationId, editText);
    setEditingId(null);
  };

  return (
    <aside className="annotations-panel" aria-label="Annotations">
      {/* Header */}
      <div className="annotations-panel-header">
        <h3 className="annotations-panel-title">
          <span>📌</span> Annotations
          <span className="annotations-panel-count">{annotations.length}</span>
        </h3>
        <button
          className="annotations-panel-close"
          onClick={onClose}
          aria-label="Close annotations panel"
        >
          ×
        </button>
      </div>

      {/* Body */}
      {annotations.length === 0 ? (
        <div className="annotations-panel-empty">
          <p>No annotations yet.</p>
          <p className="annotations-panel-hint">
            Select text in the PDF and choose an annotation action.
          </p>
        </div>
      ) : (
        <div className="annotations-panel-body">
          {Array.from(grouped.entries()).map(([page, items]) => (
            <section key={page} className="annotations-page-group">
              <h4 className="annotations-page-label">Page {page + 1}</h4>
              {items.map((annotation) => (
                <div
                  key={annotation.id}
                  className="annotation-card"
                  style={{ "--annotation-color": annotation.color } as React.CSSProperties}
                >
                  {/* Color stripe + type icon */}
                  <div
                    className="annotation-card-stripe"
                    style={{ background: annotation.color }}
                  />

                  <div className="annotation-card-body">
                    {/* Type badge */}
                    <div className="annotation-card-meta">
                      <span className="annotation-type-badge">
                        {TYPE_ICON[annotation.annotation_type]}{" "}
                        {TYPE_LABEL[annotation.annotation_type]}
                      </span>
                    </div>

                    {/* Selected text */}
                    <p
                      className="annotation-card-text"
                      onClick={() => handleItemClick(annotation)}
                      title="Jump to annotation"
                    >
                      "{annotation.selected_text.slice(0, 120)}
                      {annotation.selected_text.length > 120 ? "…" : ""}"
                    </p>

                    {/* Comment */}
                    {editingId === annotation.id ? (
                      <div className="annotation-comment-editor">
                        <textarea
                          className="annotation-comment-textarea"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          placeholder="Add a comment…"
                          autoFocus
                        />
                        <div className="annotation-comment-actions">
                          <button
                            className="annotation-btn annotation-btn-save"
                            onClick={() => commitEdit(annotation.id)}
                          >
                            Save
                          </button>
                          <button
                            className="annotation-btn annotation-btn-cancel"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      annotation.comment && (
                        <p
                          className="annotation-card-comment"
                          onClick={() => startEdit(annotation)}
                          title="Edit comment"
                        >
                          💬 {annotation.comment}
                        </p>
                      )
                    )}

                    {/* Actions */}
                    <div className="annotation-card-actions">
                      <button
                        className="annotation-btn annotation-btn-ghost"
                        onClick={() => handleItemClick(annotation)}
                        title="Jump to page"
                      >
                        ↗ Go
                      </button>
                      <button
                        className="annotation-btn annotation-btn-ghost"
                        onClick={() => startEdit(annotation)}
                        title="Edit comment"
                      >
                        💬
                      </button>
                      <button
                        className="annotation-btn annotation-btn-ghost"
                        onClick={() => onCreateNote(annotation)}
                        title="Create note from selection"
                      >
                        📔
                      </button>
                      <button
                        className="annotation-btn annotation-btn-ghost"
                        onClick={() => onAppendToNote(annotation)}
                        title="Append to existing note"
                      >
                        ➕
                      </button>
                      {confirmDeleteId === annotation.id ? (
                        <>
                          <button
                            className="annotation-btn annotation-btn-danger"
                            onClick={() => {
                              onDelete(annotation.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Delete
                          </button>
                          <button
                            className="annotation-btn annotation-btn-cancel"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          className="annotation-btn annotation-btn-ghost annotation-btn-delete"
                          onClick={() => setConfirmDeleteId(annotation.id)}
                          title="Delete annotation"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

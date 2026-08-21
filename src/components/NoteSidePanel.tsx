import { DragEvent, useEffect, useMemo, useState } from "react";
import { FileText, Link, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useI18n } from "../i18n";
import { AIProvider, ChatMessage, UploadedItem } from "../types";
import { AIAssistantPanel } from "./AIAssistantPanel";
import { LocalMediaViewer } from "./LocalMediaViewer";

export type RightTab = "uploads" | "viewer" | "assistant";

interface NoteSidePanelProps {
  uploads: UploadedItem[];
  messages: ChatMessage[];
  liveSummary: {
    title: string;
    detail: string;
  };
  activeTab: RightTab;
  aiProvider: AIProvider;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onAIProviderChange: (provider: AIProvider) => void;
  onTabChange: (tab: RightTab) => void;
  onFileUpload: (files: FileList | null) => void;
  onAddLink: () => void;
  onRemoveUpload: (id: string | number) => Promise<void> | void;
  // Annotation system additions
  selectedNoteId: string | number;
  annotations: Annotation[];
  flashAnnotationId: string | number | null;
  jumpToPage: number | null;
  onAnnotationCreate: (
    pageIndex: number,
    selectedText: string,
    rects: BoundingRect[],
    action: SelectionMenuAction,
    sourceId: string | number,
  ) => void;
  onJumpToPage: (pageIndex: number | null) => void;
  onFlash: (id: string | number | null) => void;
  onDeleteAnnotation: (id: string | number) => void;
  onUpdateAnnotationComment: (id: string | number, comment: string) => void;
  onCreateNoteFromAnnotation: (text: string, pageNumber: number) => void;
  onAppendNoteFromAnnotation: (text: string, pageNumber: number) => void;
  onAskAI: (prompt: string) => void;
  onCopyText: (text: string, withCitation?: boolean, pageNumber?: number) => void;
  onSearchGoogle: (text: string) => void;
}

import { SelectionMenuAction } from "./SelectionContextMenu";
import { Annotation, BoundingRect } from "../types";

function detectViewerKind(upload: UploadedItem): "image" | "pdf" | "document" | "video" | "audio" | "link" {
  const name = upload.name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)\b/.test(name)) return "image";
  if (upload.kind === "video") return "video";
  if (upload.kind === "audio") return "audio";
  if (upload.kind === "link") return "link";
  if (upload.kind === "pdf" || /\.pdf\b/.test(name)) return "pdf";
  return "document";
}

export function NoteSidePanel({
  uploads,
  messages,
  liveSummary,
  activeTab,
  aiProvider,
  onSubmitPrompt,
  onAIProviderChange,
  onTabChange,
  onFileUpload,
  onAddLink,
  onRemoveUpload,
  selectedNoteId: _selectedNoteId,
  annotations,
  flashAnnotationId,
  jumpToPage,
  onAnnotationCreate,
  onJumpToPage,
  onFlash,
  onDeleteAnnotation,
  onUpdateAnnotationComment,
  onCreateNoteFromAnnotation,
  onAppendNoteFromAnnotation,
  onAskAI,
  onCopyText,
  onSearchGoogle,
}: NoteSidePanelProps) {
  const { t } = useI18n();

  // ── State ───────────────────────────────────────────────────────────────────
  const [selectedUploadId, setSelectedUploadId] = useState<string | number | null>(
    uploads[0]?.id ?? null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [showAnnotationsPanel, setShowAnnotationsPanel] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(() => {
    try {
      const persisted = sessionStorage.getItem("aymo_file_viewer_header_expanded");
      return persisted !== null ? JSON.parse(persisted) : true;
    } catch {
      return true;
    }
  });

  // ── Keep selectedUploadId in sync when uploads list changes ────────────────
  useEffect(() => {
    setSelectedUploadId((current) => {
      if (current && uploads.some((upload) => upload.id === current)) {
        return current;
      }
      return uploads[0]?.id ?? null;
    });
  }, [uploads]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) ?? uploads[0] ?? null,
    [selectedUploadId, uploads],
  );

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFileUpload(event.dataTransfer.files);
  };

  const openUpload = (upload: UploadedItem) => {
    setSelectedUploadId(upload.id);
    onTabChange("viewer");
  };

  const toggleHeaderExpansion = () => {
    setIsHeaderExpanded((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem("aymo_file_viewer_header_expanded", JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  // ── Renders ─────────────────────────────────────────────────────────────────
  const renderUploads = () => (
    <div className="tab-panel-body uploads-view">
      <div className="upload-head">
        <div>
          <h2>{t("tab.uploads")}</h2>
          <p className="upload-subtitle">{uploads.length} {t("uploads.count")}</p>
        </div>
        <button className="icon-only-button" type="button" onClick={onAddLink} aria-label={t("uploads.addLink")}>
          <Link size={18} strokeWidth={2} />
        </button>
      </div>

      <label
        className={`upload-dropzone ${isDragging ? "drag-active" : ""}`}
        htmlFor="tabbed-file-upload"
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          id="tabbed-file-upload"
          type="file"
          multiple
          onChange={(event) => onFileUpload(event.target.files)}
          accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a,.aac,.ogg,.png,.jpg,.jpeg,.gif,.webp"
        />
        <Plus size={22} strokeWidth={1.8} />
        <p>{t("uploads.dropHint")}</p>
        <span>{t("uploads.supported")}</span>
      </label>

      <div className="uploads-tab-list">
        {uploads.map((upload) => (
          <article key={upload.id} className="upload-card">
            <div className="upload-row">
              <button className="upload-row-main" type="button" onClick={() => openUpload(upload)}>
                <FileText size={20} strokeWidth={1.8} />
                <span className="upload-row-copy">
                  <strong>{upload.name}</strong>
                  <span>
                    {upload.sizeLabel} | {t("uploads.added")} {upload.addedAt}
                  </span>
                </span>
              </button>
              <button className="icon-only-button" type="button" onClick={() => onRemoveUpload(upload.id)} aria-label={t("uploads.remove")}>
                <Trash2 size={17} strokeWidth={1.8} />
              </button>
            </div>
          </article>
        ))}
        {uploads.length === 0 ? <div className="assistant-empty">{t("uploads.empty")}</div> : null}
      </div>
    </div>
  );

  const renderViewer = () => {
    if (!selectedUpload) {
      return <div className="assistant-empty">{t("viewer.selectFile")}</div>;
    }

    const viewerKind = detectViewerKind(selectedUpload);

    return (
      <div className="file-viewer-shell" style={{ gap: isHeaderExpanded ? "18px" : "4px" }}>
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="file-viewer-head" style={{ padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, paddingBottom: 4 }}>
            {viewerKind === "pdf" && (
              <button
                className={`icon-only-button${showAnnotationsPanel ? " active" : ""}`}
                type="button"
                onClick={() => setShowAnnotationsPanel((prev) => !prev)}
                aria-label="Toggle annotations panel"
                title="Toggle annotations panel"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <span>📌</span>
              </button>
            )}
            <button
              className="icon-only-button"
              type="button"
              onClick={toggleHeaderExpansion}
              aria-label={isHeaderExpanded ? "Collapse header" : "Expand header"}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              {isHeaderExpanded ? <ChevronUp size={18} strokeWidth={2} /> : <ChevronDown size={18} strokeWidth={2} />}
            </button>
            <button className="icon-only-button" type="button" onClick={() => onRemoveUpload(selectedUpload.id)} aria-label={t("uploads.remove")}>
              <Trash2 size={17} strokeWidth={1.8} />
            </button>
          </div>

          {/* Collapsible meta area */}
          <div
            style={{
              maxHeight: isHeaderExpanded ? "300px" : "0px",
              overflow: "hidden",
              transition: "max-height 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms cubic-bezier(0.4, 0, 0.2, 1), padding 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              opacity: isHeaderExpanded ? 1 : 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
              <div className="file-viewer-copy">
                <span className="file-meta-detail">{viewerKind} | {selectedUpload.sizeLabel}</span>
                <h3 style={{ margin: 0, fontSize: "22px", wordBreak: "break-word" }}>{selectedUpload.name}</h3>
                <p className="file-subtext" style={{ margin: 0 }}>{t("uploads.added")} {selectedUpload.addedAt}</p>
              </div>
            </div>
            <div style={{ borderBottom: "1px solid var(--border)", margin: "4px 0" }} />
          </div>
        </div>

        {/* ── Viewer surface — LocalMediaViewer fetches blob from IndexedDB ── */}
        <div className="file-viewer-surface">
          <LocalMediaViewer
            upload={selectedUpload}
            viewerKind={viewerKind}
            annotations={annotations}
            flashAnnotationId={flashAnnotationId}
            jumpToPage={jumpToPage}
            showAnnotationsPanel={showAnnotationsPanel}
            onAnnotationCreate={onAnnotationCreate}
            onJumpToPage={onJumpToPage}
            onFlash={onFlash}
            onDeleteAnnotation={onDeleteAnnotation}
            onUpdateAnnotationComment={onUpdateAnnotationComment}
            onCreateNoteFromAnnotation={onCreateNoteFromAnnotation}
            onAppendNoteFromAnnotation={onAppendNoteFromAnnotation}
            onAskAI={onAskAI}
            onCopyText={onCopyText}
            onSearchGoogle={onSearchGoogle}
            onCloseAnnotationsPanel={() => setShowAnnotationsPanel(false)}
          />
        </div>
      </div>
    );
  };

  return (
    <section className="right-tabs-panel" aria-label="Right panel">
      <div className="right-tab-content">
        {activeTab === "uploads" ? renderUploads() : null}
        {activeTab === "viewer" ? <div className="tab-panel-body">{renderViewer()}</div> : null}
        {activeTab === "assistant" ? (
          <div className="tab-panel-body">
            <AIAssistantPanel
              messages={messages}
              liveSummary={liveSummary}
              aiProvider={aiProvider}
              onAIProviderChange={onAIProviderChange}
              onSubmitPrompt={onSubmitPrompt}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

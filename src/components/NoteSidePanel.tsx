import { DragEvent, useEffect, useMemo, useState } from "react";
import { FileText, Link, Plus, Trash2, CheckCircle2, Loader2, Circle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useI18n } from "../i18n";
import { AIProvider, ChatMessage, UploadedItem } from "../types";
import { AIAssistantPanel } from "./AIAssistantPanel";
import { PdfCanvasViewer } from "./PdfCanvasViewer";

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
  onRemoveUpload: (id: number) => Promise<void> | void;
  // Annotation system additions
  selectedNoteId: number;
  annotations: Annotation[];
  flashAnnotationId: number | null;
  jumpToPage: number | null;
  onAnnotationCreate: (
    pageIndex: number,
    selectedText: string,
    rects: BoundingRect[],
    action: SelectionMenuAction,
    sourceId: number,
  ) => void;
  onJumpToPage: (pageIndex: number | null) => void;
  onFlash: (id: number | null) => void;
  onDeleteAnnotation: (id: number) => void;
  onUpdateAnnotationComment: (id: number, comment: string) => void;
  onCreateNoteFromAnnotation: (text: string, pageNumber: number) => void;
  onAppendNoteFromAnnotation: (text: string, pageNumber: number) => void;
  onAskAI: (prompt: string) => void;
  onCopyText: (text: string, withCitation?: boolean, pageNumber?: number) => void;
  onSearchGoogle: (text: string) => void;
}

import { SelectionMenuAction } from "./SelectionContextMenu";
import { Annotation, BoundingRect } from "../types";
import { AnnotationsPanel } from "./AnnotationsPanel";


function detectViewerKind(upload: UploadedItem): "image" | "pdf" | "document" | "video" | "audio" | "link" {
  const source = `${upload.source ?? ""} ${upload.name}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)\b/.test(source)) return "image";
  if (upload.kind === "video") return "video";
  if (upload.kind === "audio") return "audio";
  if (upload.kind === "link") return "link";
  if (upload.kind === "pdf" || /\.pdf\b/.test(source)) return "pdf";
  return "document";
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
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
  selectedNoteId,
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
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(uploads[0]?.id ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [showAnnotationsPanel, setShowAnnotationsPanel] = useState(false);

  const toggleStepsExpanded = (id: number) => {
    setExpandedSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  };



  useEffect(() => {
    setSelectedUploadId((current) => {
      if (current && uploads.some((upload) => upload.id === current)) {
        return current;
      }
      return uploads[0]?.id ?? null;
    });
  }, [uploads]);

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) ?? uploads[0] ?? null,
    [selectedUploadId, uploads],
  );

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      if (!selectedUpload?.source) {
        setPreviewUrl(null);
        setPreviewError(null);
        return;
      }

      const viewerKind = detectViewerKind(selectedUpload);
      if (!["image", "pdf", "video", "audio"].includes(viewerKind)) {
        setPreviewUrl(selectedUpload.source);
        setPreviewError(null);
        return;
      }

      try {
        const response = await fetch(selectedUpload.source);
        if (!response.ok) {
          throw new Error("Preview could not be loaded.");
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!isCancelled) {
          setPreviewUrl(objectUrl);
          setPreviewError(null);
        }
      } catch {
        if (!isCancelled) {
          setPreviewUrl(selectedUpload.source);
          setPreviewError(t("viewer.previewLoadFailed"));
        }
      }
    };

    void loadPreview();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedUpload, t]);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFileUpload(event.dataTransfer.files);
  };

  const openUpload = (upload: UploadedItem) => {
    setSelectedUploadId(upload.id);
    onTabChange("viewer");
  };

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

  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(() => {
    try {
      const persisted = sessionStorage.getItem("aymo_file_viewer_header_expanded");
      return persisted !== null ? JSON.parse(persisted) : true; // Default to expanded (true)
    } catch {
      return true;
    }
  });

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

  const renderViewer = () => {
    if (!selectedUpload) {
      return <div className="assistant-empty">{t("viewer.selectFile")}</div>;
    }

    const viewerKind = detectViewerKind(selectedUpload);

    return (
      <div className="file-viewer-shell" style={{ gap: isHeaderExpanded ? "18px" : "4px" }}>
        <div className="file-viewer-head" style={{ padding: "0 2px" }}>
          {/* Persistent Action Bar: collapse toggle and delete button */}
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

          {/* Collapsible Meta & Filename Area */}
          <div
            style={{
              maxHeight: isHeaderExpanded ? "300px" : "0px",
              overflow: "hidden",
              transition: "max-height 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms cubic-bezier(0.4, 0, 0.2, 1), padding 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              opacity: isHeaderExpanded ? 1 : 0,
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
              <div className="file-viewer-copy">
                <span className="file-meta-detail">{viewerKind} | {selectedUpload.sizeLabel}</span>
                <h3 style={{ margin: 0, fontSize: "22px", wordBreak: "break-word" }}>{selectedUpload.name}</h3>
                <p className="file-subtext" style={{ margin: 0 }}>{t("uploads.added")} {selectedUpload.addedAt}</p>
              </div>
              <div className="file-viewer-actions" style={{ flexShrink: 0 }}>
                {selectedUpload.source ? (
                  <a className="text-action" href={selectedUpload.source} target="_blank" rel="noreferrer">
                    {t("viewer.openSource")}
                  </a>
                ) : null}
              </div>
            </div>
            <div style={{ borderBottom: "1px solid var(--border)", margin: "4px 0" }} />
          </div>
        </div>

        <div className="file-viewer-surface">
          {viewerKind === "image" && previewUrl ? <img className="file-preview-image" src={previewUrl} alt={selectedUpload.name} /> : null}
          {viewerKind === "video" && previewUrl ? (
            <div className="media-preview-container">
              <video className="file-preview-media" src={previewUrl} controls />
            </div>
          ) : null}
          {viewerKind === "audio" && previewUrl ? (
            <div className="media-preview-container">
              <audio className="file-preview-audio" src={previewUrl} controls />
            </div>
          ) : null}
          {viewerKind === "link" ? (
            <div className="file-link-preview">
              <p>{selectedUpload.source ?? t("viewer.noLink")}</p>
              {selectedUpload.source ? (
                <a className="text-action" href={selectedUpload.source} target="_blank" rel="noreferrer">
                  {t("viewer.openLink")}
                </a>
              ) : null}
            </div>
          ) : null}
          {viewerKind === "pdf" && previewUrl ? (
            <div className="pdf-viewer-stage-container" style={{ display: "flex", width: "100%", height: "100%", position: "relative" }}>
              <div className="pdf-viewer-stage" style={{ flexGrow: 1, minWidth: 0 }}>
                <PdfCanvasViewer
                  source={previewUrl}
                  sourceId={selectedUpload.id}
                  annotations={annotations.filter((a) => a.source_id === selectedUpload.id)}
                  flashAnnotationId={flashAnnotationId}
                  jumpToPage={jumpToPage}
                  onAnnotationCreate={onAnnotationCreate}
                  onAskAI={onAskAI}
                  onCopyText={onCopyText}
                  onSearchGoogle={onSearchGoogle}
                  onCreateNote={onCreateNoteFromAnnotation}
                  onAppendToNote={onAppendNoteFromAnnotation}
                />
              </div>
              {showAnnotationsPanel && (
                <AnnotationsPanel
                  annotations={annotations.filter((a) => a.source_id === selectedUpload.id)}
                  onJumpToPage={(pIndex) => onJumpToPage(pIndex)}
                  onFlash={(id) => onFlash(id)}
                  onDelete={onDeleteAnnotation}
                  onUpdateComment={onUpdateAnnotationComment}
                  onCreateNote={(a) => onCreateNoteFromAnnotation(a.selected_text, (a.page_number ?? 0) + 1)}
                  onAppendToNote={(a) => onAppendNoteFromAnnotation(a.selected_text, (a.page_number ?? 0) + 1)}
                  onClose={() => setShowAnnotationsPanel(false)}
                />
              )}
            </div>
          ) : null}
          {viewerKind === "document" ? (
            <div className="file-preview-fallback">
              <p>{t("viewer.documentInlineUnsupported")}</p>
              {selectedUpload.source ? (
                <a className="text-action" href={selectedUpload.source} target="_blank" rel="noreferrer">
                  {t("viewer.openDocument")}
                </a>
              ) : null}
            </div>
          ) : null}
          {previewError ? (
            <div className="file-preview-fallback">
              <p>{previewError}</p>
            </div>
          ) : null}
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

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
  onStartExtraction: (id: number) => Promise<void> | void;
}

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
  onStartExtraction,
}: NoteSidePanelProps) {
  const { t } = useI18n();
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(uploads[0]?.id ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const toggleStepsExpanded = (id: number) => {
    setExpandedSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getFriendlyStatus = (
    status: string,
    steps: Array<{ name: string; status: string }>,
    progress: number,
    processedChunks?: number,
    totalChunks?: number,
  ): string => {
    if (status === "queued") return "Queued";
    if (status === "pending") return "Pending";
    if (status === "failed") return "Failed";
    if (status === "completed") return "Completed";

    if (status === "processing" || status.startsWith("processing")) {
      const activeStep = steps.find((s) => s.status === "processing" || s.status.startsWith("processing"));
      if (activeStep) {
        if (activeStep.name === "Extracting Audio" || activeStep.name === "Segmenting Audio") {
          return "Preparing Audio";
        }
        if (activeStep.name === "Transcribing Chunks") {
          if (processedChunks !== undefined && totalChunks !== undefined && totalChunks > 0) {
            return `Processing ${processedChunks}/${totalChunks} Chunks`;
          }
          const chunkMatch = activeStep.status.match(/Chunk\s+(\d+)\/(\d+)/i);
          if (chunkMatch) {
            return `Processing ${chunkMatch[1]}/${chunkMatch[2]} Chunks`;
          }
          return "Transcribing";
        }
        return activeStep.name;
      }
      return "Processing";
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const renderProgressPanel = (upload: UploadedItem) => {
    const status = upload.extractionStatus;
    if (!status || status === "completed") return null;

    // Show uploading spinner for optimistic temp entries
    if (status === "uploading") {
      return (
        <div className="upload-progress-panel upload-progress-uploading">
          <div className="progress-info-row">
            <span className="progress-status-text">
              <Loader2 size={13} className="animate-spin" style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
              Uploading…
            </span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill progress-bar-indeterminate" />
          </div>
        </div>
      );
    }

    const progress = upload.progressPercent ?? 0;
    const isFailed = status === "failed";
    const errorMsg = upload.extractionError;



    let steps: Array<{ name: string; status: "pending" | "processing" | "completed" | "failed" }> = [];
    if (upload.detailedSteps) {
      try {
        steps = JSON.parse(upload.detailedSteps);
      } catch (e) {
        console.error("Failed to parse detailed steps JSON", e);
      }
    }

    const isExpanded = !!expandedSteps[upload.id];

    return (
      <div className={`upload-progress-panel ${isFailed ? "is-failed" : ""}`}>
        <div className="progress-info-row">
          <span className="progress-status-text">
            {isFailed ? "Extraction failed" : getFriendlyStatus(status, steps, progress, upload.processedChunks, upload.totalChunks)}
          </span>
          {!isFailed && <span className="progress-percentage">{progress}%</span>}
        </div>

        {!isFailed && (
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        )}

        {isFailed && errorMsg && (
          <div className="progress-error-message">
            {errorMsg}
          </div>
        )}



        {steps.length > 0 && (
          <div className="progress-steps-section">
            <button
              type="button"
              className="progress-steps-toggle"
              onClick={() => toggleStepsExpanded(upload.id)}
            >
              <span>{isExpanded ? "Hide details" : "Show details"}</span>
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {isExpanded && (
              <ul className="progress-steps-list">
                {steps.map((step, idx) => (
                  <li key={idx} className={`progress-step-item is-${step.status}`}>
                    <span className="step-icon">
                      {step.status === "completed" && <CheckCircle2 size={13} className="step-icon-completed" />}
                      {step.status === "processing" && <Loader2 size={13} className="animate-spin step-icon-processing" />}
                      {step.status === "pending" && <Circle size={13} className="step-icon-pending" />}
                      {step.status === "failed" && <XCircle size={13} className="step-icon-failed" />}
                    </span>
                    <span className="step-name">{step.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
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
                    {upload.extractionStatus && upload.extractionStatus === "completed" ? ` | ${t("viewer.extraction")}: ${upload.extractionStatus}` : ""}
                  </span>
                </span>
              </button>
              <button className="icon-only-button" type="button" onClick={() => onRemoveUpload(upload.id)} aria-label={t("uploads.remove")}>
                <Trash2 size={17} strokeWidth={1.8} />
              </button>
            </div>
            {upload.extractionStatus && upload.extractionStatus !== "completed" && renderProgressPanel(upload)}
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
      <div className="file-viewer-shell">
        <div className="file-viewer-head">
          <div className="file-viewer-copy">
            <span className="file-meta-detail">{viewerKind} | {selectedUpload.sizeLabel}</span>
            <h3>{selectedUpload.name}</h3>
            <p className="file-subtext">{t("uploads.added")} {selectedUpload.addedAt}</p>
          </div>
          <div className="file-viewer-actions">
            {selectedUpload.source ? (
              <a className="text-action" href={selectedUpload.source} target="_blank" rel="noreferrer">
                {t("viewer.openSource")}
              </a>
            ) : null}
            <button className="icon-only-button" type="button" onClick={() => onRemoveUpload(selectedUpload.id)} aria-label={t("uploads.remove")}>
              <Trash2 size={17} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="file-viewer-surface">
          {viewerKind === "image" && previewUrl ? <img className="file-preview-image" src={previewUrl} alt={selectedUpload.name} /> : null}
          {viewerKind === "video" && previewUrl ? (
            <div className="media-preview-container">
              <div className="media-coming-soon-banner">AI video analysis is coming soon.</div>
              <video className="file-preview-media" src={previewUrl} controls />
            </div>
          ) : null}
          {viewerKind === "audio" && previewUrl ? (
            <div className="media-preview-container">
              <div className="media-coming-soon-banner">AI transcription for audio is coming soon.</div>
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
            <div className="pdf-viewer-stage">
              <PdfCanvasViewer source={previewUrl} />
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

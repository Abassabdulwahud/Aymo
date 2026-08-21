/**
 * LocalMediaViewer.tsx
 *
 * Renders the appropriate viewer for a local or cloud attachment.
 *
 * Architecture:
 *   - Uses useLocalAttachmentUrl to resolve the playable URL from IndexedDB.
 *   - The URL is fetched on demand when the attachment changes.
 *   - Object URLs are revoked when the attachment changes or the component unmounts.
 *   - Falls back to a CDN URL for cloud files.
 *
 * Supported types:
 *   video  → <video controls> with play/pause/seek/volume/fullscreen
 *   audio  → <audio controls> with play/pause/seek/volume
 *   image  → <img> with object-fit contain
 *   pdf    → PdfCanvasViewer (pass-through)
 *   link   → clickable URL
 *   document → download link (browser cannot render inline)
 */

import { useI18n } from "../i18n";
import { UploadedItem, Annotation, BoundingRect } from "../types";
import { useLocalAttachmentUrl } from "../hooks/useLocalAttachmentUrl";
import { PdfCanvasViewer } from "./PdfCanvasViewer";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { Loader2 } from "lucide-react";
import type { SelectionMenuAction } from "./SelectionContextMenu";

// ─── Props ────────────────────────────────────────────────────────────────────

interface LocalMediaViewerProps {
  upload: UploadedItem;
  viewerKind: "image" | "video" | "audio" | "pdf" | "document" | "link";
  // PDF annotation system
  annotations: Annotation[];
  flashAnnotationId?: string | number | null;
  jumpToPage?: number | null;
  showAnnotationsPanel?: boolean;
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
  onCloseAnnotationsPanel: () => void;
}

// ─── Loading / Error states ───────────────────────────────────────────────────

function LoadingState({ message }: { message: string }) {
  return (
    <div className="media-loading-state">
      <Loader2 size={28} strokeWidth={1.5} className="media-loading-spinner" />
      <p>{message}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="media-error-state">
      <p>{message}</p>
    </div>
  );
}

// ─── Individual viewers ───────────────────────────────────────────────────────

function VideoViewer({ url, name }: { url: string; name: string }) {
  return (
    <div className="media-preview-container">
      <video
        className="file-preview-media"
        src={url}
        controls
        aria-label={name}
        onError={(e) => {
          const video = e.currentTarget;
          // MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED = 4
          if (video.error?.code === 4) {
            video.insertAdjacentHTML(
              "afterend",
              `<p class="media-codec-error">This browser cannot play this video format. Try converting to MP4 (H.264).</p>`
            );
          }
        }}
      />
    </div>
  );
}

function AudioViewer({ url, name }: { url: string; name: string }) {
  return (
    <div className="media-preview-container audio-preview-container">
      <audio
        className="file-preview-audio"
        src={url}
        controls
        aria-label={name}
        onError={(e) => {
          const audio = e.currentTarget;
          if (audio.error?.code === 4) {
            audio.insertAdjacentHTML(
              "afterend",
              `<p class="media-codec-error">This browser cannot play this audio format. Try MP3 or WAV.</p>`
            );
          }
        }}
      />
    </div>
  );
}

function ImageViewer({ url, name }: { url: string; name: string }) {
  return (
    <div className="image-preview-container">
      <img
        className="file-preview-image"
        src={url}
        alt={name}
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
          img.insertAdjacentHTML(
            "afterend",
            `<p class="media-error-state">Could not display this image.</p>`
          );
        }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LocalMediaViewer({
  upload,
  viewerKind,
  annotations,
  flashAnnotationId,
  jumpToPage,
  showAnnotationsPanel,
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
  onCloseAnnotationsPanel,
}: LocalMediaViewerProps) {
  const { t } = useI18n();

  // ── Resolve the URL from IndexedDB (or CDN for cloud files) ────────────────
  const { url, loading, error } = useLocalAttachmentUrl(
    upload.id,
    upload.source ?? null,
  );

  // ── Link viewer (no blob needed) ────────────────────────────────────────────
  if (viewerKind === "link") {
    return (
      <div className="file-link-preview">
        <p>{upload.source ?? t("viewer.noLink")}</p>
        {upload.source ? (
          <a className="text-action" href={upload.source} target="_blank" rel="noreferrer">
            {t("viewer.openLink")}
          </a>
        ) : null}
      </div>
    );
  }

  // ── Document viewer (no inline rendering) ───────────────────────────────────
  if (viewerKind === "document") {
    return (
      <div className="file-preview-fallback">
        <p>{t("viewer.documentInlineUnsupported")}</p>
        {url ? (
          <a className="text-action" href={url} target="_blank" rel="noreferrer">
            {t("viewer.openDocument")}
          </a>
        ) : null}
      </div>
    );
  }

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return <LoadingState message="Loading file…" />;
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (error && !url) {
    return <ErrorState message={error} />;
  }

  // ── No URL resolved ─────────────────────────────────────────────────────────
  if (!url) {
    return <ErrorState message="File not available locally." />;
  }

  // ── Render by type ──────────────────────────────────────────────────────────
  if (viewerKind === "video") {
    return <VideoViewer url={url} name={upload.name} />;
  }

  if (viewerKind === "audio") {
    return <AudioViewer url={url} name={upload.name} />;
  }

  if (viewerKind === "image") {
    return <ImageViewer url={url} name={upload.name} />;
  }

  if (viewerKind === "pdf") {
    return (
      <div
        className="pdf-viewer-stage-container"
        style={{ display: "flex", width: "100%", height: "100%", position: "relative" }}
      >
        <div className="pdf-viewer-stage" style={{ flexGrow: 1, minWidth: 0 }}>
          <PdfCanvasViewer
            source={url}
            sourceId={upload.id}
            annotations={annotations.filter((a) => a.source_id === upload.id)}
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
            annotations={annotations.filter((a) => a.source_id === upload.id)}
            onJumpToPage={(pIndex) => onJumpToPage(pIndex)}
            onFlash={(id) => onFlash(id)}
            onDelete={onDeleteAnnotation}
            onUpdateComment={onUpdateAnnotationComment}
            onCreateNote={(a) =>
              onCreateNoteFromAnnotation(a.selected_text, (a.page_number ?? 0) + 1)
            }
            onAppendToNote={(a) =>
              onAppendNoteFromAnnotation(a.selected_text, (a.page_number ?? 0) + 1)
            }
            onClose={onCloseAnnotationsPanel}
          />
        )}
      </div>
    );
  }

  return null;
}

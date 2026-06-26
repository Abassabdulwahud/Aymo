import { ChangeEvent, DragEvent, useState } from "react";
import { FileCard } from "./FileCard";
import { UploadedItem } from "../types";

interface UploadSectionProps {
  uploads: UploadedItem[];
  onFileUpload: (files: FileList | null) => void;
  onAddLink: () => void;
  onRemoveUpload: (id: number) => void;
}

export function UploadSection({ uploads, onFileUpload, onAddLink, onRemoveUpload }: UploadSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFileUpload(event.target.files);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFileUpload(event.dataTransfer.files);
  };

  return (
    <section className="panel upload-panel" aria-label="Upload section">
      <div className="upload-head">
        <div>
          <h2>Uploads</h2>
          <p className="upload-subtitle">{uploads.length} item{uploads.length === 1 ? "" : "s"} attached</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setIsExpanded((value) => !value)} type="button">
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {isExpanded ? (
        <>
          <div className="upload-actions">
            <button className="btn btn-ghost" onClick={onAddLink} type="button">
              Add Link
            </button>
          </div>

          <label
            className={`upload-dropzone ${isDragging ? "drag-active" : ""}`}
            htmlFor="file-upload"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              id="file-upload"
              type="file"
              multiple
              onChange={handleInput}
              accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a,.aac,.ogg"
            />
            <p>Drag and drop files here, or click to browse.</p>
            <span>Supports PDFs, documents, videos, and audio files.</span>
          </label>

          <div className="files-grid">
            {uploads.map((item) => (
              <FileCard
                key={item.id}
                id={item.id}
                name={item.name}
                kind={item.kind}
                sizeLabel={item.sizeLabel}
                addedAt={item.addedAt}
                source={item.source}
                onRemove={onRemoveUpload}
              />
            ))}
            {uploads.length === 0 ? <div className="assistant-empty">No uploads yet.</div> : null}
          </div>
        </>
      ) : (
        <p className="upload-collapsed-copy">Uploads are collapsed by default to keep your writing space focused.</p>
      )}
    </section>
  );
}

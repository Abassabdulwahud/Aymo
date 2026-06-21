import { ChangeEvent, DragEvent, useState } from "react";
import { FileCard } from "./FileCard";
import { UploadedItem } from "../types";

interface UploadSectionProps {
  uploads: UploadedItem[];
  onFileUpload: (files: FileList | null) => void;
  onAddLink: () => void;
}

export function UploadSection({ uploads, onFileUpload, onAddLink }: UploadSectionProps) {
  const [isDragging, setIsDragging] = useState(false);

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
        <h2>Uploads</h2>
        <button className="btn btn-ghost" onClick={onAddLink}>
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
          accept=".pdf,.doc,.docx,.txt,.mp4,.mov,.mp3,.wav,.m4a"
        />
        <p>Drag and drop files here, or click to browse.</p>
        <span>Supports PDFs, documents, videos, and audio files.</span>
      </label>

      <div className="files-grid">
        {uploads.map((item) => (
          <FileCard
            key={item.id}
            name={item.name}
            kind={item.kind}
            sizeLabel={item.sizeLabel}
            addedAt={item.addedAt}
            source={item.source}
          />
        ))}
      </div>
    </section>
  );
}

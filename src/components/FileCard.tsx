import { UploadKind } from "../types";

interface FileCardProps {
  id: string | number;
  name: string;
  kind: UploadKind;
  sizeLabel: string;
  addedAt: string;
  source?: string;
  onRemove?: (id: string | number) => void;
}

const KIND_LABEL: Record<UploadKind, string> = {
  image: "IMG",
  pdf: "PDF",
  document: "DOC",
  video: "VID",
  audio: "AUD",
  link: "URL",
};

export function FileCard({ id, name, kind, sizeLabel, addedAt, source, onRemove }: FileCardProps) {
  const actionLabel = kind === "link" ? "Open source link" : "Open attachment";

  return (
    <article className="file-card">
      <div className="file-icon" aria-hidden="true">{KIND_LABEL[kind]}</div>
      <div className="file-meta">
        <p className="file-name">{name}</p>
        <p className="file-subtext">
          {sizeLabel} | Added {addedAt}
        </p>
        {source ? (
          <a className="file-link" href={source} target="_blank" rel="noreferrer">
            {actionLabel}
          </a>
        ) : null}
        {onRemove ? (
          <button className="btn btn-ghost" type="button" onClick={() => onRemove(id)}>
            Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

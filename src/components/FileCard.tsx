import { UploadKind } from "../types";

interface FileCardProps {
  name: string;
  kind: UploadKind;
  sizeLabel: string;
  addedAt: string;
  source?: string;
}

const KIND_LABEL: Record<UploadKind, string> = {
  pdf: "PDF",
  doc: "DOC",
  video: "VID",
  audio: "AUD",
  link: "URL",
};

export function FileCard({ name, kind, sizeLabel, addedAt, source }: FileCardProps) {
  return (
    <article className="file-card">
      <div className="file-icon" aria-hidden="true">{KIND_LABEL[kind]}</div>
      <div className="file-meta">
        <p className="file-name">{name}</p>
        <p className="file-subtext">
          {sizeLabel} · Added {addedAt}
        </p>
        {source ? (
          <a className="file-link" href={source} target="_blank" rel="noreferrer">
            Open source link
          </a>
        ) : null}
      </div>
    </article>
  );
}

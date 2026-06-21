interface WritingSectionProps {
  title: string;
  body: string;
  isRecording: boolean;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onRecordToggle: () => void;
}

export function WritingSection({
  title,
  body,
  isRecording,
  onTitleChange,
  onBodyChange,
  onRecordToggle,
}: WritingSectionProps) {
  return (
    <section className="panel writing-panel" aria-label="Writing section">
      <label className="field-label" htmlFor="note-title">
        Title
      </label>
      <input
        id="note-title"
        className="title-input"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Untitled note"
      />

      <label className="field-label" htmlFor="note-body">
        Writing Space
      </label>
      <textarea
        id="note-body"
        className="editor"
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        placeholder="Start writing your note..."
      />

      <div className="record-row">
        <button
          className={`btn ${isRecording ? "btn-solid" : "btn-ghost"}`}
          onClick={onRecordToggle}
          aria-pressed={isRecording}
        >
          {isRecording ? "Stop Recording" : "Record Voice"}
        </button>
        <p className="hint-text">
          {isRecording
            ? "Listening... speech will be transcribed into your note."
            : "Tap record to convert your voice into text."}
        </p>
      </div>
    </section>
  );
}

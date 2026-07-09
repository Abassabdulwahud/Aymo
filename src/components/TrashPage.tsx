import React, { useEffect, useState } from "react";
import { Trash2, RotateCcw, Search, Trash } from "lucide-react";
import { BackendNote, listTrashedNotes, restoreNote, permanentlyDeleteNote, emptyTrash } from "../services/notesService";
import { useI18n } from "../i18n";
import { AccountSettingsMenu } from "./AccountSettingsMenu";

import { LanguageCode } from "../i18n";

interface TrashPageProps {
  authToken: string;
  darkMode: boolean;
  language: LanguageCode;
  profile: { name: string; email: string };
  onThemeChange: (next: boolean) => void;
  onLanguageChange: (next: any) => void;
  onLogout: () => void;
  onNoteRestored: (note: BackendNote) => void;
}

export const TrashPage: React.FC<TrashPageProps> = ({
  authToken,
  darkMode,
  language,
  profile,
  onThemeChange,
  onLanguageChange,
  onLogout,
  onNoteRestored,
}) => {
  const { t } = useI18n();
  const [trashedNotes, setTrashedNotes] = useState<BackendNote[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirmation dialog state
  const [confirmTarget, setConfirmTarget] = useState<{ type: "single" | "all"; noteId?: number; title?: string } | null>(null);

  const loadTrash = async (query = "") => {
    setLoading(true);
    setError(null);
    try {
      const items = await listTrashedNotes(authToken, query);
      setTrashedNotes(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trashed notes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      loadTrash(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search, authToken]);

  const handleRestore = async (noteId: number) => {
    try {
      const restored = await restoreNote(authToken, noteId);
      setTrashedNotes((prev) => prev.filter((n) => n.id !== noteId));
      onNoteRestored(restored);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore note.");
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmTarget) return;
    try {
      if (confirmTarget.type === "single" && confirmTarget.noteId !== undefined) {
        await permanentlyDeleteNote(authToken, confirmTarget.noteId);
        setTrashedNotes((prev) => prev.filter((n) => n.id !== confirmTarget.noteId));
      } else if (confirmTarget.type === "all") {
        await emptyTrash(authToken);
        setTrashedNotes([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to perform deletion.");
    } finally {
      setConfirmTarget(null);
    }
  };

  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  const getFirstMeaningfulLine = (value: string): string => {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  };

  return (
    <div className="site-shell home-shell">
      {/* Confirmation Dialog Modal */}
      {confirmTarget && (
        <div className="confirm-dialog-overlay" onClick={() => setConfirmTarget(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>
              {confirmTarget.type === "single"
                ? "Delete this note permanently?"
                : "Delete every note in Trash permanently?"}
            </h3>
            <p>This action cannot be undone.</p>
            <div className="confirm-dialog-buttons">
              <button className="btn" onClick={() => setConfirmTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-solid btn-danger"
                onClick={handleConfirmAction}
              >
                {confirmTarget.type === "single" ? "Delete Forever" : "Empty Trash"}
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className="sidebar">
        {/* Render same Sidebar layout as App.tsx. Will be wired in App.tsx layout */}
      </aside>

      <section className="home-main">
        <header className="home-header">
          <div>
            <h2>Trash</h2>
          </div>
          <div className="home-header-actions">
            {trashedNotes.length > 0 && (
              <button
                className="btn btn-solid btn-danger"
                onClick={() => setConfirmTarget({ type: "all" })}
              >
                Empty Trash
              </button>
            )}
            <AccountSettingsMenu
              name={profile.name}
              email={profile.email}
              darkMode={darkMode}
              language={language}
              onThemeChange={onThemeChange}
              onLanguageChange={onLanguageChange}
              onLogout={onLogout}
            />
          </div>
        </header>

        {error && <p className="auth-error">{error}</p>}

        <div className="trash-search-wrapper">
          <Search size={18} className="search-icon-inside" />
          <input
            className="search-input trash-search"
            placeholder="Search deleted notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="notes-list">
          {trashedNotes.map((note) => {
            const preview = getFirstMeaningfulLine(note.body);
            return (
              <article key={note.id} className="note-card trash-note-card">
                <div className="note-card-head">
                  <div className="note-card-copy">
                    <h3>{note.title.trim() || t("app.noteUntitled")}</h3>
                    {preview ? <p className="preview-text">{preview}</p> : null}
                  </div>
                  <div className="trash-actions">
                    <button
                      className="btn btn-icon-text"
                      title="Restore Note"
                      onClick={() => handleRestore(note.id)}
                    >
                      <RotateCcw size={16} />
                      Restore
                    </button>
                    <button
                      className="btn btn-icon-text btn-danger-text"
                      title="Delete Permanently"
                      onClick={() =>
                        setConfirmTarget({ type: "single", noteId: note.id, title: note.title })
                      }
                    >
                      <Trash2 size={16} />
                      Delete Forever
                    </button>
                  </div>
                </div>
                <div className="note-card-foot">
                  <span>
                    Deleted:{" "}
                    {note.deleted_at
                      ? new Date(note.deleted_at).toLocaleDateString()
                      : "Recently"}
                  </span>
                  <span>
                    {countWords(note.body)} {t("home.words")}
                  </span>
                </div>
              </article>
            );
          })}

          {trashedNotes.length === 0 && !loading && (
            <div className="trash-empty-state">
              <Trash size={48} className="trash-empty-icon" />
              <h3>Trash is empty.</h3>
              <p>Deleted notes will appear here until you permanently remove them.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

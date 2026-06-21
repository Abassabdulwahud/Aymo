import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import { WritingSection } from "./components/WritingSection";
import { UploadSection } from "./components/UploadSection";
import { AIAssistantPanel } from "./components/AIAssistantPanel";
import { SettingsPage } from "./components/SettingsPage";
import { AuthPage } from "./components/AuthPage";
import { AymoLogo } from "./components/AymoLogo";
import { AIProvider, UploadedItem, UploadKind } from "./types";
import { VOICE_TRANSCRIPT_MOCK } from "./mockData";
import { loadPreferences, saveAIProviderPreference } from "./services/preferencesService";
import {
  clearAuthToken,
  fetchCurrentUser,
  requestPasswordReset,
  loadAuthToken,
  loginWithApple,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  resetPassword,
  saveAuthToken,
} from "./services/authService";

interface HomeNote {
  id: string;
  title: string;
  body: string;
  tag: "research" | "ideas" | "work" | "personal";
  pinned: boolean;
  updatedAt: string;
  uploads: UploadedItem[];
}

type View = "home" | "note" | "settings";

const INITIAL_NOTES: HomeNote[] = [
  {
    id: "n1",
    title: "Neuroscience Reading Notes",
    body: "Attention is selective resource allocation. Retrieval practice beats passive review.",
    tag: "research",
    pinned: true,
    updatedAt: "Mar 27, 2026",
    uploads: [
      { id: "u1", name: "cognitive-load.pdf", kind: "pdf", sizeLabel: "2.4 MB", addedAt: "2h ago" },
      { id: "u2", name: "lecture-week-3.mp4", kind: "video", sizeLabel: "84 MB", addedAt: "1h ago" },
    ],
  },
  {
    id: "n2",
    title: "Product Redesign Kickoff",
    body: "Align on metric, review user pain points, draft concepts.",
    tag: "work",
    pinned: true,
    updatedAt: "Mar 26, 2026",
    uploads: [{ id: "u3", name: "brief.docx", kind: "doc", sizeLabel: "680 KB", addedAt: "1d ago" }],
  },
  {
    id: "n3",
    title: "Voice UI Patterns",
    body: "Brevity, cadence, and silence are underrated design tools.",
    tag: "ideas",
    pinned: false,
    updatedAt: "Mar 25, 2026",
    uploads: [{ id: "u4", name: "interview-audio.m4a", kind: "audio", sizeLabel: "17 MB", addedAt: "1d ago" }],
  },
  {
    id: "n4",
    title: "Lisbon Trip Observations",
    body: "The city feels like layered memory. Light changes perception fast.",
    tag: "personal",
    pinned: false,
    updatedAt: "Mar 23, 2026",
    uploads: [],
  },
];

const TAGS = [
  { id: "all", label: "All Notes" },
  { id: "research", label: "Research" },
  { id: "ideas", label: "Ideas" },
  { id: "work", label: "Work" },
  { id: "personal", label: "Personal" },
] as const;

function detectKind(fileName: string): UploadKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if ([".doc", ".docx", ".txt"].some((ext) => lower.endsWith(ext))) return "doc";
  if ([".mp4", ".mov", ".mkv"].some((ext) => lower.endsWith(ext))) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac"].some((ext) => lower.endsWith(ext))) return "audio";
  return "doc";
}

function bytesToLabel(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function providerLabel(provider: AIProvider): string {
  switch (provider) {
    case "gemini":
      return "Google Gemini API";
    case "openai":
      return "OpenAI API";
    case "deepseek":
      return "DeepSeek API";
    default:
      return "AI Provider";
  }
}

export default function App() {
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(loadAuthToken());
  const [view, setView] = useState<View>("home");
  const [notes, setNotes] = useState<HomeNote[]>(INITIAL_NOTES);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<(typeof TAGS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string>(INITIAL_NOTES[0].id);
  const [isRecording, setIsRecording] = useState(false);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState("English");
  const [aiProvider, setAIProvider] = useState<AIProvider>("gemini");
  const [profile, setProfile] = useState({ name: "Aya Morgan", email: "aya@aymo.app" });

  useEffect(() => {
    let mounted = true;
    void loadPreferences().then((preferences) => {
      if (mounted) setAIProvider(preferences.aiProvider);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      if (!authToken) {
        if (mounted) {
          setAuthenticated(false);
          setIsAuthChecking(false);
        }
        return;
      }

      try {
        const user = await fetchCurrentUser(authToken);
        if (!mounted) return;
        setProfile({
          name: user.full_name || user.email.split("@")[0] || "AYMO User",
          email: user.email,
        });
        setAuthenticated(true);
      } catch {
        if (!mounted) return;
        clearAuthToken();
        setAuthToken(null);
        setAuthenticated(false);
      } finally {
        if (mounted) setIsAuthChecking(false);
      }
    };

    void restoreSession();

    return () => {
      mounted = false;
    };
  }, [authToken]);

  const finalizeAuth = async (token: string) => {
    saveAuthToken(token);
    setAuthToken(token);
    const user = await fetchCurrentUser(token);
    setProfile({
      name: user.full_name || user.email.split("@")[0] || "AYMO User",
      email: user.email,
    });
    setAuthenticated(true);
  };

  const handleEmailAuth = async ({
    mode,
    email,
    password,
  }: {
    mode: "login" | "signup";
    email: string;
    password: string;
    fullName: string;
  }) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (mode === "signup") {
      await registerWithEmail(fullName.trim(), normalizedEmail, password);
    }
    const token = await loginWithEmail(normalizedEmail, password);
    await finalizeAuth(token);
  };

  const handleGoogleAuth = async (oauthToken: string) => {
    const token = await loginWithGoogle(oauthToken);
    await finalizeAuth(token);
  };

  const handleAppleAuth = async (oauthToken: string) => {
    const token = await loginWithApple(oauthToken);
    await finalizeAuth(token);
  };

  const handleForgotPassword = async (email: string) => {
    const response = await requestPasswordReset(email);
    if (response.reset_token) {
      const nextPassword = window.prompt(
        "Development reset token created. Enter a new password for this account:",
        "",
      );
      if (!nextPassword) {
        throw new Error("Password reset was cancelled.");
      }
      const token = await resetPassword(response.reset_token, nextPassword);
      await finalizeAuth(token);
      window.alert("Password updated. You are now signed in.");
      return;
    }
    window.alert(response.message);
  };

  const handleResetPassword = async (token: string, newPassword: string) => {
    const accessToken = await resetPassword(token, newPassword);
    await finalizeAuth(accessToken);
  };

  const selectedNote = notes.find((note) => note.id === selectedId) ?? notes[0];

  const filteredNotes = useMemo(() => {
    const q = search.toLowerCase();
    return notes.filter((note) => {
      const matchesTag = activeTag === "all" || note.tag === activeTag;
      const matchesSearch =
        !q || note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q);
      return matchesTag && matchesSearch;
    });
  }, [notes, search, activeTag]);

  const openNote = (id: string) => {
    setSelectedId(id);
    setView("note");
  };

  const createNote = () => {
    const fresh: HomeNote = {
      id: `n-${Date.now()}`,
      title: "Untitled Note",
      body: "",
      tag: "ideas",
      pinned: false,
      updatedAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      uploads: [],
    };
    setNotes((prev) => [fresh, ...prev]);
    setSelectedId(fresh.id);
    setView("note");
  };

  const togglePin = (id: string) => {
    setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, pinned: !note.pinned } : note)));
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((note) => note.id !== id);
      if (selectedId === id && next.length) setSelectedId(next[0].id);
      return next;
    });
  };

  const updateCurrentNote = (patch: Partial<HomeNote>) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === selectedNote.id
          ? {
              ...note,
              ...patch,
              updatedAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            }
          : note,
      ),
    );
  };

  const handleUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const mapped: UploadedItem[] = Array.from(files).map((file, index) => ({
      id: `u-${Date.now()}-${index}`,
      name: file.name,
      kind: detectKind(file.name),
      sizeLabel: bytesToLabel(file.size),
      addedAt: "Just now",
    }));
    updateCurrentNote({ uploads: [...mapped, ...selectedNote.uploads] });
  };

  const handleAddLink = () => {
    const input = window.prompt("Paste a URL to attach to this note:", "https://");
    if (!input) return;
    updateCurrentNote({
      uploads: [
        {
          id: `l-${Date.now()}`,
          name: input.replace(/^https?:\/\//, "") || "new-link",
          kind: "link",
          sizeLabel: "URL",
          source: input,
          addedAt: "Just now",
        },
        ...selectedNote.uploads,
      ],
    });
  };

  const handleRecordToggle = () => {
    if (!isRecording) {
      setIsRecording(true);
      return;
    }
    setIsRecording(false);
    updateCurrentNote({ body: `${selectedNote.body.trim()}\n\n${VOICE_TRANSCRIPT_MOCK}`.trim() });
  };

  const handleAIProviderChange = (provider: AIProvider) => {
    setAIProvider(provider);
    void saveAIProviderPreference(provider);
  };

  const insights = useMemo(() => {
    const words = countWords(selectedNote.body);
    const questions = (selectedNote.body.match(/\?/g) || []).length;
    const activeProvider = providerLabel(aiProvider);

    return [
      {
        id: "i1",
        title: "Provider In Use",
        detail: `${activeProvider} is currently analyzing this note and its uploads.`,
      },
      {
        id: "i2",
        title: "Live Summary",
        detail: `This note has about ${words} words and ${selectedNote.uploads.length} uploaded resources.`,
      },
      {
        id: "i3",
        title: "Reasoning Signal",
        detail:
          questions > 0
            ? `Detected ${questions} reflective question${questions > 1 ? "s" : ""}; this improves depth of analysis.`
            : "Add one question to improve revision and active recall quality.",
      },
    ];
  }, [selectedNote.body, selectedNote.uploads.length, aiProvider]);

  if (isAuthChecking) {
    return (
      <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
        <div className="site-shell auth-loading">Checking session...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
        <AuthPage
          darkMode={darkMode}
          onToggleTheme={() => setDarkMode((value) => !value)}
          onEmailAuth={handleEmailAuth}
          onGoogleAuth={handleGoogleAuth}
          onAppleAuth={handleAppleAuth}
          onForgotPassword={handleForgotPassword}
          onResetPassword={handleResetPassword}
        />
      </div>
    );
  }

  if (view === "settings") {
    return (
      <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
        <SettingsPage
          darkMode={darkMode}
          language={language}
          aiProvider={aiProvider}
          name={profile.name}
          email={profile.email}
          onBack={() => setView("home")}
          onThemeChange={setDarkMode}
          onLanguageChange={setLanguage}
          onAIProviderChange={handleAIProviderChange}
          onLogout={() => {
            setAuthenticated(false);
            clearAuthToken();
            setAuthToken(null);
            setView("home");
          }}
        />
      </div>
    );
  }

  if (view === "note") {
    return (
      <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
        <div className="site-shell">
          <header className="note-topbar">
            <div className="note-topbar-left">
              <AymoLogo size="medium" darkMode={darkMode} />
              <button className="btn" onClick={() => setView("home")}>Back</button>
            </div>
            <div className="topbar-actions">
              <button className="btn" onClick={() => window.alert("Share link copied.")}>Share</button>
              <button className="btn btn-solid" onClick={() => window.alert("Note saved.")}>Save</button>
            </div>
          </header>

          <main className="workspace-grid">
            <WritingSection
              title={selectedNote.title}
              body={selectedNote.body}
              isRecording={isRecording}
              onTitleChange={(value) => updateCurrentNote({ title: value })}
              onBodyChange={(value) => updateCurrentNote({ body: value })}
              onRecordToggle={handleRecordToggle}
            />

            <UploadSection
              uploads={selectedNote.uploads}
              onFileUpload={handleUpload}
              onAddLink={handleAddLink}
            />
          </main>

          <AIAssistantPanel
            insights={insights}
            collapsed={assistantCollapsed}
            onToggleCollapsed={() => setAssistantCollapsed((value) => !value)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
      <div className="site-shell home-shell">
        <aside className="sidebar">
          <div className="logo-wrap">
            <AymoLogo size="medium" darkMode={darkMode} />
          </div>

          <p className="side-label">Tags</p>
          <ul className="tag-list">
            {TAGS.map((tag) => {
              const count = tag.id === "all" ? notes.length : notes.filter((n) => n.tag === tag.id).length;
              return (
                <li
                  key={tag.id}
                  className={`tag-item ${activeTag === tag.id ? "active" : ""}`}
                  onClick={() => setActiveTag(tag.id)}
                >
                  <span>{tag.label}</span>
                  <span>{count}</span>
                </li>
              );
            })}
          </ul>

          <div className="sidebar-footer">
            <button className="icon-btn" aria-label="Settings" onClick={() => setView("settings")}>Settings</button>
            <button className="icon-btn" onClick={() => setDarkMode((value) => !value)}>
              {darkMode ? "Light" : "Dark"}
            </button>
          </div>
        </aside>

        <section className="home-main">
          <header className="home-header">
            <div>
              <p className="eyebrow">AYMO Notebook</p>
              <h2>My Notes</h2>
            </div>
            <button className="btn btn-solid" onClick={createNote}>Create Note</button>
          </header>

          <input
            className="search-input"
            placeholder="Search notes by title or content"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="notes-list">
            {filteredNotes.map((note) => (
              <article key={note.id} className="note-card" onClick={() => openNote(note.id)}>
                <div className="note-card-head">
                  <h3>{note.title}</h3>
                  <span className="tag-badge">{note.tag}</span>
                </div>
                <p className="preview-text">{note.body || "Start writing your note..."}</p>
                <div className="note-card-foot">
                  <span>{note.updatedAt}</span>
                  <span>{countWords(note.body)} words</span>
                </div>
                <div className="note-actions" onClick={(event) => event.stopPropagation()}>
                  <button className="btn" onClick={() => togglePin(note.id)}>{note.pinned ? "Unpin" : "Pin"}</button>
                  <button className="btn" onClick={() => deleteNote(note.id)}>Delete</button>
                </div>
              </article>
            ))}
            {filteredNotes.length === 0 ? <p className="empty">No notes found.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

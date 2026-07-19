import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import { useRef } from "react";
import { SmoothStreamer } from "./utils/smoothStreamer";
import { MoreVertical, PanelRightClose } from "lucide-react";
import { matchPath, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "./services/apiClient";
import { LanguageCode, languageCodeToSpeechLocale, normalizeLanguageCode, useI18n } from "./i18n";
import { WritingSection } from "./components/WritingSection";
import { NoteSidePanel, RightTab } from "./components/NoteSidePanel";
import { AuthPage } from "./components/AuthPage";
import { AymoLogo } from "./components/AymoLogo";
import { ResizableNoteWorkspace } from "./components/ResizableNoteWorkspace";
import { AccountSettingsMenu } from "./components/AccountSettingsMenu";
import { AIProvider, ChatMessage, UploadKind, UploadedItem } from "./types";
import { loadPreferences, savePreferences } from "./services/preferencesService";
import { loadAIProvider, saveAIProvider } from "./services/aiProviderStorage";
import { TrashPage } from "./components/TrashPage";
import { listTrashedNotes } from "./services/notesService";
import {
  clearAuthToken,
  fetchCurrentUser,
  loadAuthToken,
  loginWithApple,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  requestPasswordReset,
  resetPassword,
  saveAuthToken,
} from "./services/authService";
import {
  addLink,
  BackendFile,
  BackendNote,
  createNote,
  deleteNote as deleteNoteRequest,
  listNotes,
  removeFile,
  setNotePin,
  updateNote,
  uploadFile,
  getNoteFiles,
} from "./services/notesService";
import { listTags } from "./services/tagsService";
import { chatWithAIHttp, listAIResponses, streamAIChat } from "./services/aiService";
import { queueLinkScrape, queuePdfExtraction, syncNoteContent } from "./services/contentService";
import { loadNoteRightPanelLayout, saveNoteRightPanelLayout } from "./services/noteLayoutStorage";
import * as annotationsService from "./services/annotationsService";
import { Annotation, BoundingRect } from "./types";
import { SelectionMenuAction } from "./components/SelectionContextMenu";

interface HomeNote {
  id: number;
  title: string;
  cardTitle: string;
  body: string;
  tag: string;
  pinned: boolean;
  updatedAt: string;
  updatedAtIso: string;
  uploads: UploadedItem[];
}

interface NoteDateGroup {
  id: string;
  label: string;
  notes: HomeNote[];
}

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function ProtectedRoute({ isAuthenticated, children }: { isAuthenticated: boolean; children: JSX.Element }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PublicRoute({ isAuthenticated, children }: { isAuthenticated: boolean; children: JSX.Element }) {
  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

function bytesToLabel(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(timestamp: string, justNowLabel: string): string {
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return justNowLabel;
  const diffMinutes = Math.max(0, Math.round((Date.now() - value) / 60000));
  if (diffMinutes < 1) return justNowLabel;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function formatDisplayDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getFirstMeaningfulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function groupNotesByDate(notes: HomeNote[]): NoteDateGroup[] {
  const today = startOfLocalDay(new Date());
  const groups: NoteDateGroup[] = [
    { id: "today", label: "TODAY", notes: [] },
    { id: "yesterday", label: "YESTERDAY", notes: [] },
    { id: "previous-7", label: "PREVIOUS 7 DAYS", notes: [] },
    { id: "previous-30", label: "PREVIOUS 30 DAYS", notes: [] },
    { id: "older", label: "OLDER", notes: [] },
  ];

  for (const note of notes) {
    const updated = startOfLocalDay(new Date(note.updatedAtIso));
    const diffDays = Math.floor((today.getTime() - updated.getTime()) / 86400000);
    if (diffDays <= 0) {
      groups[0].notes.push(note);
    } else if (diffDays === 1) {
      groups[1].notes.push(note);
    } else if (diffDays <= 7) {
      groups[2].notes.push(note);
    } else if (diffDays <= 30) {
      groups[3].notes.push(note);
    } else {
      groups[4].notes.push(note);
    }
  }

  return groups.filter((group) => group.notes.length > 0);
}

function mapFileToUpload(file: BackendFile, justNowLabel: string): UploadedItem {
  return {
    id: file.id,
    name: file.file_name,
    kind: file.file_type as UploadKind,
    sizeLabel: file.file_type === "link" ? "URL" : bytesToLabel(file.file_size),
    source: file.file_url,
    addedAt: formatRelativeTime(file.uploaded_at, justNowLabel),
    extractionStatus: file.extraction_status,
    extractionError: file.extraction_error,
    progressPercent: file.progress_percent,
    detailedSteps: file.detailed_steps,
    durationSeconds: file.duration_seconds,
    processedChunks: file.processed_chunks,
    totalChunks: file.total_chunks,
  };
}

function buildHomeCardTitle(title: string, body: string, untitledLabel: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return untitledLabel;
  }

  return `${words.slice(0, 3).join(" ")}...`;
}

function mapNoteToHomeNote(note: BackendNote, labels: { untitled: string; untagged: string; justNow: string }): HomeNote {
  return {
    id: note.id,
    title: note.title,
    cardTitle: buildHomeCardTitle(note.title, note.body, labels.untitled),
    body: note.body,
    tag: note.tags[0]?.name ?? labels.untagged,
    pinned: note.is_pinned,
    updatedAt: formatDisplayDate(note.updated_at),
    updatedAtIso: note.updated_at,
    uploads: note.files.map((file) => mapFileToUpload(file, labels.justNow)),
  };
}

function mapCachedResponsesToMessages(
  items: Array<{ id: string; question: string; response: string }>,
): ChatMessage[] {
  return items.flatMap((item) => [
    {
      id: `${item.id}-user`,
      role: "user" as const,
      content: item.question,
    },
    {
      id: `${item.id}-assistant`,
      role: "assistant" as const,
      content: item.response,
      status: "done" as const,
    },
  ]);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function detectUploadKind(filename: string): UploadKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  if (["doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "rtf", "md"].includes(ext)) return "document";
  return "document";
}

function normalizeSpeechSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTranscriptSegments(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentenceMatches = normalized.match(/[^.!?]+[.!?]*/g)?.map((segment) => segment.trim()).filter(Boolean) ?? [];
  if (sentenceMatches.length > 1) {
    return sentenceMatches;
  }

  return normalized
    .split(/\s{2,}|(?<=\b(?:America|money|note|idea|question|summary))\s+(?=[A-Z])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function removeDuplicateConsecutiveSpeech(value: string): string {
  const segments = splitTranscriptSegments(value);
  if (segments.length === 0) return "";

  const deduped: string[] = [];
  for (const segment of segments) {
    const normalizedSegment = normalizeSpeechSegment(segment);
    const previousSegment = deduped[deduped.length - 1];
    if (previousSegment && normalizeSpeechSegment(previousSegment) === normalizedSegment) {
      continue;
    }
    deduped.push(segment.replace(/\s+/g, " ").trim());
  }

  return deduped.join(" ").trim();
}

export default function App() {
  const { setLanguage: setAppLanguage, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [isAuthenticated, setAuthenticated] = useState(false);
  /**
   * sessionStatus drives the startup loading UI:
   *   "checking"       – first attempt in progress (no spinner shown yet)
   *   "retrying"       – backend unreachable, retrying (show "Restoring your session…")
   *   "ready"          – authenticated and workspace loaded
   *   "unauthenticated" – no token or 401 received; show login
   */
  const [sessionStatus, setSessionStatus] = useState<"checking" | "retrying" | "ready" | "unauthenticated">("checking");
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(loadAuthToken());
  const [notes, setNotes] = useState<HomeNote[]>([]);
  const [trashedNoteCount, setTrashedNoteCount] = useState(0);
  const [search, setSearch] = useState("");
  const [tagCatalog, setTagCatalog] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState(t("record.ready"));
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [aiProvider, setAIProvider] = useState<AIProvider>(() => loadAIProvider());
  const [activeRightTab, setActiveRightTab] = useState<RightTab>("assistant");
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(
    () => loadNoteRightPanelLayout().rightPanelCollapsed,
  );
  const [profile, setProfile] = useState({ name: "Aya Morgan", email: "aya@aymo.app" });
  const [isBusy, setIsBusy] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [openNoteMenuId, setOpenNoteMenuId] = useState<number | null>(null);
  const [chatMessagesByNote, setChatMessagesByNote] = useState<Record<number, ChatMessage[]>>({});
  
  // Annotation system state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [flashAnnotationId, setFlashAnnotationId] = useState<number | null>(null);
  const [jumpToPage, setJumpToPage] = useState<number | null>(null);

  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptBufferRef = useRef("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const editorSelectionRef = useRef({ start: 0, end: 0 });
  const lastSyncedRef = useRef<Record<number, { title: string; body: string }>>({});
  const queuedExtractionRef = useRef<Record<number, true>>({});
  // Tracks the IDs of files that we just uploaded. Polling is suppressed for
  // these entries until the backend confirms them (they flip to a real positive ID).
  const pendingUploadIdsRef = useRef<Set<number>>(new Set());
  // Timestamp of the last upload completion — used for a short cooldown
  // so stale poll responses arriving immediately after an upload don't
  // overwrite the freshly-inserted real backend entries.
  const lastUploadAtRef = useRef<number>(0);
  const noteLabels = useMemo(
    () => ({
      untitled: t("app.noteUntitled"),
      untagged: t("app.noteUntagged"),
      justNow: t("app.relativeJustNow"),
    }),
    [t],
  );
  const noteRouteMatch = matchPath("/notes/:noteId", location.pathname);
  const routeNoteId = noteRouteMatch ? Number(noteRouteMatch.params.noteId) || null : null;

  const playRecordingTone = async (frequency: number, durationMs: number) => {
    const AudioContextApi = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextApi) return;

    const context = new AudioContextApi();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.03;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();

    window.setTimeout(() => {
      oscillator.stop();
      void context.close();
    }, durationMs);
  };

  const mapSpeechError = (errorCode?: string) => {
    switch (errorCode) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone access was blocked. Please allow microphone permission and try again.";
      case "audio-capture":
        return "No microphone was detected. Connect a microphone and try again.";
      case "network":
        return "Speech recognition needs an internet connection right now. Check your connection and try again.";
      case "no-speech":
        return "No speech was detected. Try speaking a little closer to the microphone.";
      default:
        return "Voice transcription could not start. Please try again in a supported browser.";
    }
  };

  useEffect(() => {
    let mounted = true;

    /**
     * Returns true only for errors that prove the JWT is definitively rejected
     * by the server — i.e. the server was reachable and said "no".
     *
     * Everything else (network down, backend restarting, 5xx) is transient and
     * should trigger a retry rather than a logout.
     */
    const isAuthFailure = (err: unknown): boolean => {
      if (err instanceof ApiError && err.status === 401) return true;
      return false;
    };

    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const restoreSession = async () => {
      if (!authToken) {
        if (mounted) {
          setAuthenticated(false);
          setSessionStatus("unauthenticated");
          setIsWorkspaceLoading(false);
        }
        return;
      }

      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const user = await fetchCurrentUser(authToken);
          if (!mounted) return;
          setProfile({
            name: user.full_name || user.email.split("@")[0] || t("app.sessionUserFallback"),
            email: user.email,
          });
          setAuthenticated(true);
          setSessionStatus("ready");
          return;
        } catch (err) {
          if (!mounted) return;

          // True auth failure (401) — token is invalid or expired.
          // Wipe the token immediately; do not retry.
          if (isAuthFailure(err)) {
            clearAuthToken();
            setAuthToken(null);
            setAuthenticated(false);
            setIsWorkspaceLoading(false);
            setSessionStatus("unauthenticated");
            return;
          }

          // Transient failure (network down, backend restarting, 5xx).
          // Retry if attempts remain; preserve the token throughout.
          if (attempt < MAX_RETRIES) {
            if (mounted) setSessionStatus("retrying");
            await delay(RETRY_DELAY_MS);
            // Re-check mounted after the delay in case component unmounted.
            if (!mounted) return;
          } else {
            // All retries exhausted — the backend is unreachable (CORS,
            // network down, cold-start timeout, etc.).
            // We cannot validate the stored token, so clear it and send
            // the user to Login. This prevents the "Restoring your session…"
            // screen from showing forever.
            if (mounted) {
              clearAuthToken();
              setAuthToken(null);
              setAuthenticated(false);
              setIsWorkspaceLoading(false);
              setSessionStatus("unauthenticated");
            }
          }
        }
      }
    };

    void restoreSession();

    return () => {
      mounted = false;
    };
  }, [authToken]);

  useEffect(() => {
    let mounted = true;

    const hydrateWorkspace = async () => {
      if (!authToken || !isAuthenticated) {
        if (mounted) {
          setIsWorkspaceLoading(false);
          setNotes([]);
          setTagCatalog([]);
          setSelectedId(null);
        }
        return;
      }

      try {
        if (mounted) {
          setIsWorkspaceLoading(true);
        }
        const [preferences, noteItems, tagItems] = await Promise.all([
          loadPreferences(authToken),
          listNotes(authToken),
          listTags(authToken),
        ]);
        if (!mounted) return;

        // Load trash count independently — never let it block note loading
        try {
          const trashedItems = await listTrashedNotes(authToken);
          if (mounted) setTrashedNoteCount(trashedItems.length);
        } catch {
          // Trash endpoint not yet available or failed — silently ignore
          if (mounted) setTrashedNoteCount(0);
        }

        const mappedNotes = noteItems.map((note) => mapNoteToHomeNote(note, noteLabels));
        lastSyncedRef.current = Object.fromEntries(
          mappedNotes.map((note) => [note.id, { title: note.title, body: note.body }]),
        );
        setAIProvider(loadAIProvider());
        setDarkMode(preferences.theme === "dark");
        const normalizedLanguage = normalizeLanguageCode(preferences.language);
        setLanguage(normalizedLanguage);
        setAppLanguage(normalizedLanguage);
        setNotes(mappedNotes);
        setTagCatalog(tagItems.map((tag) => tag.name));
        setSelectedId((current) => {
          if (current && mappedNotes.some((note) => note.id === current)) {
            return current;
          }
          return mappedNotes[0]?.id ?? null;
        });
      } catch {
        if (!mounted) return;
        setNotes([]);
        setTagCatalog([]);
        setSelectedId(null);
      } finally {
        if (mounted) {
          setIsWorkspaceLoading(false);
        }
      }
    };

    void hydrateWorkspace();

    return () => {
      mounted = false;
    };
  }, [authToken, isAuthenticated, noteLabels]);

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (openNoteMenuId === null) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Close if the click target is not within the open menu wrap.
      if (!target.closest(".menu-wrap")) {
        setOpenNoteMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenNoteMenuId(null);
      }
    };

    document.addEventListener("click", handleOutsideClick, { capture: true });
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleOutsideClick, { capture: true });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openNoteMenuId]);

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const isNoteView = location.pathname.startsWith("/notes/");

    body.classList.toggle("page-note-view", isNoteView);
    root.classList.toggle("page-note-view", isNoteView);

    if (isNoteView) {
      document.title = "AYMO - Note Page";
    } else if (location.pathname === "/home") {
      document.title = "AYMO - Home";
    } else if (location.pathname === "/login") {
      document.title = "AYMO - Login";
    } else if (location.pathname === "/signup") {
      document.title = "AYMO - Signup";
    } else {
      document.title = "AYMO";
    }

    return () => {
      body.classList.remove("page-note-view");
      root.classList.remove("page-note-view");
    };
  }, [location.pathname]);

  const finalizeAuth = async (token: string) => {
    saveAuthToken(token);
    setAuthToken(token);
    const user = await fetchCurrentUser(token);
    setProfile({
      name: user.full_name || user.email.split("@")[0] || t("app.sessionUserFallback"),
      email: user.email,
    });
    setAuthenticated(true);
    setSessionStatus("ready");
    navigate("/home", { replace: true });
  };

  const handleEmailAuth = async ({
    mode,
    email,
    password,
    fullName,
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

  const selectedNote = useMemo(
    () => {
      if (routeNoteId) {
        return notes.find((note) => note.id === routeNoteId) ?? null;
      }
      return (selectedId ? notes.find((note) => note.id === selectedId) : undefined) ?? notes[0] ?? null;
    },
    [notes, routeNoteId, selectedId],
  );

  useEffect(() => {
    if (routeNoteId && routeNoteId !== selectedId) {
      setSelectedId(routeNoteId);
    }
  }, [routeNoteId, selectedId]);

  useEffect(() => {
    let cancelled = false;

    const hydrateChatHistory = async () => {
      if (!authToken || !selectedNote) {
        return;
      }
      if (chatMessagesByNote[selectedNote.id]) {
        return;
      }

      try {
        const items = await listAIResponses(authToken, selectedNote.id);
        if (cancelled) return;
        setChatMessagesByNote((prev) => {
          if (prev[selectedNote.id]) {
            return prev;
          }
          return {
            ...prev,
            [selectedNote.id]: mapCachedResponsesToMessages(items.reverse()),
          };
        });
      } catch {
        // Keep the chat panel usable even if history cannot be loaded.
      }
    };

    void hydrateChatHistory();

    return () => {
      cancelled = true;
    };
  }, [authToken, selectedNote, chatMessagesByNote]);

  // Fetch annotations when active note or its files change
  useEffect(() => {
    if (!authToken || !selectedNote) return;

    let active = true;
    const fetchAllAnnotations = async () => {
      try {
        const list: Annotation[] = [];
        for (const file of selectedNote.uploads) {
          if (file.kind === "pdf") {
            const fileAnns = await annotationsService.listAnnotations(authToken, "pdf", file.id);
            list.push(...fileAnns);
          }
        }
        if (active) {
          setAnnotations(list);
        }
      } catch (e) {
        console.error("Failed to load annotations", e);
      }
    };

    void fetchAllAnnotations();
    return () => {
      active = false;
    };
  }, [authToken, selectedNote?.uploads, selectedNote?.id]);

  // Annotation system handlers
  const handleAnnotationCreate = async (
    pageIndex: number,
    selectedText: string,
    rects: BoundingRect[],
    action: SelectionMenuAction,
    sourceId: number,
  ) => {
    if (!authToken || !selectedNote) return;

    // Determine color and type from the menu action
    let color = "#FFD60A";
    let type: Annotation["annotation_type"] = "highlight";

    if (action.startsWith("color-")) {
      const colorVal = action.replace("color-", "");
      if      (colorVal === "green")  color = "#4ADE80";
      else if (colorVal === "blue")   color = "#60A5FA";
      else if (colorVal === "pink")   color = "#F472B6";
      else if (colorVal === "orange") color = "#FB923C";
    }

    if      (action === "annotate-underline")       type = "underline";
    else if (action === "annotate-strikethrough")   type = "strikethrough";
    else if (action === "annotate-squiggly")        type = "strikethrough";
    else if (action === "annotate-redact")          type = "strikethrough";
    else if (action === "annotate-comment")         type = "comment";
    else if (action === "annotate-bookmark")        type = "bookmark";

    // sourceId comes directly from the viewer that was clicked — no guessing.
    const payload = {
      source_type: "pdf" as const,
      source_id: sourceId,
      page_number: pageIndex,
      selected_text: selectedText,
      bounding_rects: rects,
      color,
      annotation_type: type,
      comment: type === "comment" ? "New comment" : undefined,
    };

    try {
      const newAnn = await annotationsService.createAnnotation(authToken, payload);
      setAnnotations((prev) => [...prev, newAnn]);
    } catch (e) {
      console.error("Failed to create annotation", e);
    }
  };


  const handleDeleteAnnotation = async (id: number) => {
    if (!authToken) return;
    try {
      await annotationsService.deleteAnnotation(authToken, id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      console.error("Failed to delete annotation", e);
    }
  };

  const handleUpdateAnnotationComment = async (id: number, comment: string) => {
    if (!authToken) return;
    try {
      const updated = await annotationsService.updateAnnotation(authToken, id, { comment });
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (e) {
      console.error("Failed to update annotation comment", e);
    }
  };

  const handleCreateNoteFromAnnotation = async (text: string, pageNumber: number) => {
    if (!authToken) return;
    try {
      const created = mapNoteToHomeNote(await createNote(authToken), noteLabels);
      const updated = await updateNote(authToken, created.id, {
        title: `Highlight from PDF Page ${pageNumber}`,
        body: text,
      });
      const mapped = mapNoteToHomeNote(updated, noteLabels);
      lastSyncedRef.current[mapped.id] = {
        title: mapped.title,
        body: mapped.body,
      };
      setNotes((prev) => [mapped, ...prev]);
      setSelectedId(mapped.id);
      navigate(`/notes/${mapped.id}`);
    } catch (e) {
      console.error("Failed to create note from highlight", e);
    }
  };

  const handleAppendNoteFromAnnotation = async (text: string, pageNumber: number) => {
    if (!authToken || !selectedNote) return;
    try {
      const newBody = `${selectedNote.body}\n\n> ${text} (Page ${pageNumber})`;
      const updated = await updateNote(authToken, selectedNote.id, {
        body: newBody,
      });
      replaceNote(mapNoteToHomeNote(updated, noteLabels));
    } catch (e) {
      console.error("Failed to append highlight to note", e);
    }
  };

  const handleFlashAnnotation = (id: number | null) => {
    setFlashAnnotationId(id);
    if (id !== null) {
      setTimeout(() => setFlashAnnotationId(null), 1500);
    }
  };

  useEffect(() => {
    if (!authToken || !selectedNote) {
      return;
    }

    const lastSynced = lastSyncedRef.current[selectedNote.id];
    if (lastSynced && lastSynced.title === selectedNote.title && lastSynced.body === selectedNote.body) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void syncNoteContent(authToken, selectedNote.id, {
        title: selectedNote.title,
        body: selectedNote.body,
      })
        .then(() => {
          lastSyncedRef.current[selectedNote.id] = {
            title: selectedNote.title,
            body: selectedNote.body,
          };
        })
        .catch(() => {
          // Save retries naturally on the next local edit pause.
        });
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authToken, selectedNote]);

  const sidebarTags = useMemo(() => {
    const noteTags = notes.map((note) => note.tag).filter(Boolean);
    const uniqueTags = Array.from(new Set([...tagCatalog, ...noteTags])).sort((left, right) => left.localeCompare(right));
    return [
      { id: "all", label: "All Notes", count: notes.length },
      { id: "pinned", label: "Pinned", count: notes.filter((note) => note.pinned).length },
      ...uniqueTags.map((tag) => ({
        id: tag.toLowerCase(),
        label: tag,
        count: notes.filter((note) => note.tag.toLowerCase() === tag.toLowerCase()).length,
      })),
    ];
  }, [notes, tagCatalog]);

  const filteredNotes = useMemo(() => {
    const query = search.toLowerCase();
    return notes.filter((note) => {
      const matchesTag =
        activeTag === "all" ||
        (activeTag === "pinned" ? note.pinned : note.tag.toLowerCase() === activeTag);
      const matchesSearch =
        !query || note.title.toLowerCase().includes(query) || note.body.toLowerCase().includes(query);
      return matchesTag && matchesSearch;
    });
  }, [notes, search, activeTag]);

  const groupedNotes = useMemo(() => groupNotesByDate(filteredNotes), [filteredNotes]);
  const primarySidebarItems = sidebarTags.slice(0, 2);
  const tagSidebarItems = sidebarTags.slice(2);

  const openNote = (id: number) => {
    setOpenNoteMenuId(null);
    setSelectedId(id);
    navigate(`/notes/${id}`);
  };

  const replaceNote = (nextNote: HomeNote) => {
    setNotes((prev) => prev.map((note) => (note.id === nextNote.id ? nextNote : note)));
  };

  const queueExtractionForFile = async (file: Pick<BackendFile, "id" | "file_type">) => {
    // Automatic extraction disabled.
  };

  const refreshNoteFiles = async () => {
    if (!authToken || !selectedNote) return;

    // If we just finished an upload < 2s ago, skip this poll tick. The backend
    // may not yet have the new record, and an early poll would briefly show the
    // file list without the freshly uploaded entry (perceived as "disappeared").
    if (Date.now() - lastUploadAtRef.current < 2000) return;

    try {
      const files = await getNoteFiles(authToken, selectedNote.id);
      const mapped = files.map((file) => mapFileToUpload(file, noteLabels.justNow));

      setNotes((prev) =>
        prev.map((note) => {
          if (note.id !== selectedNote.id) return note;

          // 1. Always keep optimistic temp entries (negative IDs) so they
          //    remain visible while the network round-trip is still in flight.
          const tempEntries = note.uploads.filter((u) => u.id < 0);

          // 2. From the polled backend list, skip any ID that is currently
          //    tracked as a pending upload that we haven't confirmed yet.
          //    (pendingUploadIdsRef is cleared once handleUpload swaps in
          //    the real backend record.)
          const freshMapped = mapped.filter(
            (u) => !pendingUploadIdsRef.current.has(u.id)
          );

          // 3. For any real (positive-ID) entries already in local state that
          //    are NOT in the polled list yet — keep them too. This handles the
          //    narrow window where the upload just completed but the next poll
          //    fetch started before the backend committed the row.
          const localRealNotInPoll = note.uploads.filter(
            (u) => u.id > 0 && !mapped.some((m) => m.id === u.id)
          );

          return {
            ...note,
            uploads: [...tempEntries, ...localRealNotInPoll, ...freshMapped],
          };
        })
      );
    } catch {
      // Fail silently in the background
    }
  };

  useEffect(() => {
    if (!authToken || !selectedNote) return;

    // Check if any file is actively extracting
    const hasActiveExtraction = selectedNote.uploads.some(
      (upload) =>
        upload.extractionStatus === "pending" ||
        upload.extractionStatus === "queued" ||
        upload.extractionStatus?.startsWith("processing")
    );

    if (!hasActiveExtraction) return;

    const intervalId = window.setInterval(() => {
      void refreshNoteFiles();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedNote, authToken]);

  const createNewNote = async () => {
    if (!authToken) return;
    setIsBusy(true);
    setHomeError(null);
    try {
      const created = mapNoteToHomeNote(await createNote(authToken), noteLabels);
      lastSyncedRef.current[created.id] = {
        title: created.title,
        body: created.body,
      };
      setSearch("");
      setActiveTag("all");
      setNotes((prev) => [created, ...prev]);
      setSelectedId(created.id);
      navigate(`/notes/${created.id}`);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t("app.newNoteError"));
    } finally {
      setIsBusy(false);
    }
  };

  const deleteCurrentNote = async (id: number) => {
    if (!authToken) return;
    setHomeError(null);
    setOpenNoteMenuId(null);
    try {
      await deleteNoteRequest(authToken, id);
      let nextSelectedId: number | null = null;
      setNotes((prev) => {
        const remaining = prev.filter((note) => note.id !== id);
        nextSelectedId = remaining[0]?.id ?? null;
        return remaining;
      });
      setSelectedId((current) => (current === id ? nextSelectedId : current));
      setTrashedNoteCount((prev) => prev + 1);
      setChatMessagesByNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t("app.deleteNoteError"));
    }
  };

  const togglePin = async (id: number) => {
    if (!authToken) return;
    const existing = notes.find((note) => note.id === id);
    if (!existing) return;
    const updated = await setNotePin(authToken, id, !existing.pinned);
    replaceNote(mapNoteToHomeNote(updated, noteLabels));
    setOpenNoteMenuId(null);
  };

  const updateCurrentNote = (patch: Partial<HomeNote>) => {
    if (!selectedNote) return;
    const now = new Date().toISOString();
    replaceNote({
      ...selectedNote,
      ...patch,
      updatedAt: formatDisplayDate(now),
      updatedAtIso: now,
    });
  };

  const renameNote = async (id: number) => {
    if (!authToken) return;
    const existing = notes.find((note) => note.id === id);
    if (!existing) return;

    const nextTitle = window.prompt("Rename note", existing.title || existing.cardTitle);
    if (nextTitle === null) return;
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) return;

    try {
      const updated = await updateNote(authToken, id, { title: trimmedTitle });
      replaceNote(mapNoteToHomeNote(updated, noteLabels));
      setOpenNoteMenuId(null);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "Could not rename note.");
    }
  };

  const duplicateNote = async (id: number) => {
    if (!authToken) return;
    const existing = notes.find((note) => note.id === id);
    if (!existing) return;

    try {
      const created = await createNote(authToken);
      const duplicated = mapNoteToHomeNote(
        await updateNote(authToken, created.id, {
          title: `${existing.cardTitle} copy`,
          body: existing.body,
          is_pinned: existing.pinned,
        }),
        noteLabels,
      );
      lastSyncedRef.current[duplicated.id] = {
        title: duplicated.title,
        body: duplicated.body,
      };
      setNotes((prev) => [duplicated, ...prev]);
      setOpenNoteMenuId(null);
      openNote(duplicated.id);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t("app.newNoteError"));
    }
  };

  const shareNote = (id: number) => {
    setSelectedId(id);
    setOpenNoteMenuId(null);
    window.alert(t("app.shareCopied"));
  };

  const handleEditorCursorChange = (start: number, end: number) => {
    editorSelectionRef.current = { start, end };
  };

  const persistCurrentNote = async () => {
    if (!authToken || !selectedNote) return;
    const updated = await updateNote(authToken, selectedNote.id, {
      title: selectedNote.title,
      body: selectedNote.body,
      is_pinned: selectedNote.pinned,
    });
    const mapped = mapNoteToHomeNote(updated, noteLabels);
    lastSyncedRef.current[mapped.id] = {
      title: mapped.title,
      body: mapped.body,
    };
    replaceNote(mapped);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!authToken || !selectedNote || !files || files.length === 0) return;

    // Step 1: Immediately insert optimistic placeholder cards so the user sees
    // the files right away — before the upload network request even finishes.
    const now = Date.now();
    const tempIds = Array.from(files).map((_, i) => -(now + i));
    const tempUploads: UploadedItem[] = Array.from(files).map((file, i) => ({
      id: tempIds[i],  // negative IDs mark temp/optimistic entries
      name: file.name,
      kind: detectUploadKind(file.name),
      sizeLabel: bytesToLabel(file.size),
      addedAt: noteLabels.justNow,
      extractionStatus: "uploading",
    }));
    const noteIdSnapshot = selectedNote.id;
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteIdSnapshot
          ? { ...note, uploads: [...tempUploads, ...note.uploads] }
          : note
      )
    );

    // Step 2: Perform the actual upload(s).
    let uploaded: BackendFile[];
    try {
      uploaded = await Promise.all(
        Array.from(files).map((file) => uploadFile(authToken, selectedNote.id, file))
      );
    } catch (error) {
      // Upload failed — replace temp entries with an error state and bail out.
      setNotes((prev) =>
        prev.map((note) => {
          if (note.id !== noteIdSnapshot) return note;
          return {
            ...note,
            uploads: note.uploads.map((u) =>
              u.id < 0
                ? { ...u, extractionStatus: "failed", extractionError: "Upload failed. Please try again." }
                : u
            ),
          };
        })
      );
      window.alert(error instanceof Error ? error.message : t("app.uploadRemoveError"));
      return;
    }

    // Mark the timestamp so the polling cooldown kicks in for 2s.
    lastUploadAtRef.current = Date.now();

    // Register real IDs in the pending set so a concurrent poll that fires
    // before our state update completes cannot shadow them.
    for (const f of uploaded) {
      pendingUploadIdsRef.current.add(f.id);
    }

    // Step 3: Replace the temp placeholder entries with the real backend entries.
    // We drop ALL negative-ID entries for this note and prepend the real uploads.
    setNotes((prev) =>
      prev.map((note) => {
        if (note.id !== noteIdSnapshot) return note;
        const realMapped = uploaded.map((f) => mapFileToUpload(f, noteLabels.justNow));
        const nonTempExisting = note.uploads.filter((u) => u.id >= 0);
        return { ...note, uploads: [...realMapped, ...nonTempExisting] };
      })
    );

    // Now that state is updated, remove from the pending set — polling can
    // include these IDs from this point on without risk of a race.
    for (const f of uploaded) {
      pendingUploadIdsRef.current.delete(f.id);
    }

    // Step 4: Fire extraction queuing in the background is disabled.
  };

  const handleAddLink = async () => {
    if (!authToken || !selectedNote) return;
    const input = window.prompt(t("app.addLinkPrompt"), "https://");
    if (!input) return;
    const created = await addLink(authToken, selectedNote.id, input, input.replace(/^https?:\/\//, ""));
    updateCurrentNote({ uploads: [mapFileToUpload(created, noteLabels.justNow), ...selectedNote.uploads] });
  };

  const handleRemoveUpload = async (fileId: number) => {
    if (!authToken || !selectedNote) return;
    try {
      await removeFile(authToken, fileId);
      setNotes((prev) =>
        prev.map((note) =>
          note.id === selectedNote.id
            ? { ...note, uploads: note.uploads.filter((upload) => upload.id !== fileId) }
            : note,
        ),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("app.uploadRemoveError");
      window.alert(detail);
    }
  };

  const handleRecordToggle = async () => {
    if (!selectedNote) return;

    if (isRecording) {
      setRecordingStatus(t("record.finishing"));
      speechRecognitionRef.current?.stop();
      return;
    }

    const SpeechRecognitionApi =
      window.SpeechRecognition ??
      (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setRecordingError("This browser does not support Web Speech API voice transcription.");
      setRecordingStatus(t("record.unavailable"));
      return;
    }

    if (!navigator.onLine) {
      setRecordingError("Voice transcription needs an internet connection because Web Speech API is browser-hosted.");
      setRecordingStatus(t("record.connectInternet"));
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Microphone access is not available in this browser.");
      setRecordingStatus(t("record.micRequired"));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setRecordingError("Microphone access is unavailable. Please allow microphone permission and try again.");
      setRecordingStatus(t("record.micRequired"));
      return;
    }

    if (editorRef.current) {
      editorSelectionRef.current = {
        start: editorRef.current.selectionStart,
        end: editorRef.current.selectionEnd,
      };
    }

    const recognition = new SpeechRecognitionApi() as SpeechRecognitionInstance;
    let encounteredSpeechError = false;
    transcriptBufferRef.current = "";
    setRecordingError(null);
    setRecordingStatus(t("record.recording"));
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageCodeToSpeechLocale(language);
    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if ((result as { isFinal?: boolean }).isFinal) {
          transcriptBufferRef.current = `${transcriptBufferRef.current} ${transcript}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
      }

      setRecordingStatus(
        interimTranscript
          ? `Recording... ${interimTranscript}`
          : transcriptBufferRef.current
            ? `Recording... ${transcriptBufferRef.current}`
            : t("record.recording"),
      );
    };
    recognition.onerror = (event: { error?: string }) => {
      encounteredSpeechError = true;
      transcriptBufferRef.current = "";
      setIsRecording(false);
      setRecordingError(mapSpeechError(event.error));
      setRecordingStatus(t("record.voiceStopped"));
    };
    recognition.onend = () => {
      setIsRecording(false);
      const transcript = removeDuplicateConsecutiveSpeech(transcriptBufferRef.current);

      if (transcript && !encounteredSpeechError) {
        const currentBody = selectedNote.body;
        const { start, end } = editorSelectionRef.current;
        const safeStart = Math.min(start, currentBody.length);
        const safeEnd = Math.min(end, currentBody.length);
        const prefix = currentBody.slice(0, safeStart);
        const suffix = currentBody.slice(safeEnd);
        const separatorBefore = prefix && !/\s$/.test(prefix) ? " " : "";
        const separatorAfter = suffix && !/^\s/.test(suffix) ? " " : "";
        const nextBody = `${prefix}${separatorBefore}${transcript}${separatorAfter}${suffix}`;
        const nextCursor = prefix.length + separatorBefore.length + transcript.length;

        const scrollContainer = document.querySelector(".writing-document-scroll");
        const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;

        updateCurrentNote({
          body: nextBody,
        });
        editorSelectionRef.current = { start: nextCursor, end: nextCursor };
        window.setTimeout(() => {
          editorRef.current?.focus();
          editorRef.current?.setSelectionRange(nextCursor, nextCursor);
          if (scrollContainer && prevScrollTop !== null) {
            scrollContainer.scrollTop = prevScrollTop;
          }
        }, 0);
        setRecordingStatus(t("record.stoppedAdded"));
      } else if (!encounteredSpeechError) {
        setRecordingStatus(t("record.stopped"));
      }

      transcriptBufferRef.current = "";
      void playRecordingTone(520, 120);
    };

    speechRecognitionRef.current = recognition;
    setIsRecording(true);
    setRecordingStatus(t("record.recording"));
    await playRecordingTone(720, 90);
    recognition.start();
  };

  const handleAIProviderChange = (provider: AIProvider) => {
    setAIProvider(provider);
    saveAIProvider(provider);
  };

  const handleThemeChange = (next: boolean) => {
    setDarkMode(next);
    void savePreferences(authToken, {
      language,
      theme: next ? "dark" : "light",
    });
  };

  const handleLanguageChange = (next: LanguageCode) => {
    const normalizedLanguage = normalizeLanguageCode(next);
    setLanguage(normalizedLanguage);
    setAppLanguage(normalizedLanguage);
    void savePreferences(authToken, {
      language: normalizedLanguage,
      theme: darkMode ? "dark" : "light",
    });
  };

  const handleLogout = () => {
    clearAuthToken();
    setAuthToken(null);
    setAuthenticated(false);
    setSessionStatus("unauthenticated");
    setSelectedId(null);
    setNotes([]);
    navigate("/login", { replace: true });
  };

  const handleAssistantPrompt = async (prompt: string) => {
    if (!selectedNote || !authToken) return;
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content: prompt,
    };
    setChatMessagesByNote((prev) => ({
      ...prev,
      [selectedNote.id]: [...(prev[selectedNote.id] ?? []), userMessage],
    }));

    const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Insert the bubble immediately with "thinking" status so the user sees
    // acknowledgement before the first token arrives.
    setChatMessagesByNote((prev) => ({
      ...prev,
      [selectedNote.id]: [
        ...(prev[selectedNote.id] ?? []),
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          status: "thinking" as const,
        },
      ],
    }));

    let firstDelta = true;

    // Instantiate the character-by-character typewriter loop
    const streamer = new SmoothStreamer(
      (text) => {
        setChatMessagesByNote((prev) => ({
          ...prev,
          [selectedNote.id]: (prev[selectedNote.id] ?? []).map((message) => {
            if (message.id !== assistantMessageId) return message;
            const nextStatus = firstDelta ? ("streaming" as const) : (message.status as "streaming");
            firstDelta = false;
            return { ...message, content: text, status: nextStatus };
          }),
        }));
      },
      () => {
        // Drained and fully typed
        setChatMessagesByNote((prev) => ({
          ...prev,
          [selectedNote.id]: (prev[selectedNote.id] ?? []).map((message) =>
            message.id === assistantMessageId
              ? { ...message, status: "done" as const }
              : message,
          ),
        }));
      }
    );

    try {
      const streamed = await streamAIChat(authToken, selectedNote.id, prompt, aiProvider, {
        onDelta: (chunk) => {
          streamer.enqueue(chunk);
        },
      });

      if (streamed.cached) {
        streamer.destroy();
        setChatMessagesByNote((prev) => ({
          ...prev,
          [selectedNote.id]: (prev[selectedNote.id] ?? []).map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: streamed.content, status: "done" as const }
              : message,
          ),
        }));
      } else {
        streamer.finish();
      }
    } catch (streamError) {
      streamer.destroy();
      try {
        const fallback = await chatWithAIHttp(authToken, selectedNote.id, prompt, aiProvider);
        setChatMessagesByNote((prev) => ({
          ...prev,
          [selectedNote.id]: (prev[selectedNote.id] ?? []).map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: fallback.response, status: "done" as const }
              : message,
          ),
        }));
      } catch (httpError) {
        const detail =
          httpError instanceof Error
            ? httpError.message
            : streamError instanceof Error
              ? streamError.message
              : "The AI assistant is unavailable right now.";
        setChatMessagesByNote((prev) => ({
          ...prev,
          [selectedNote.id]: (prev[selectedNote.id] ?? []).map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `AI error: ${detail}`, status: "error" as const }
              : message,
          ),
        }));
      }
    }
  };

  const assistantMessages = useMemo<ChatMessage[]>(() => {
    return selectedNote ? chatMessagesByNote[selectedNote.id] ?? [] : [];
  }, [selectedNote, chatMessagesByNote]);

  const liveSummary = useMemo(() => {
    const body = selectedNote?.body ?? "";
    const uploadCount = selectedNote?.uploads.length ?? 0;
    const words = countWords(body);
    return {
      title: "Live Summary",
      detail: `This note has about ${words} words and ${uploadCount} uploaded resource${uploadCount === 1 ? "" : "s"}.`,
    };
  }, [selectedNote]);

  const loadingScreen = (
    <div className="site-shell auth-loading">
      {sessionStatus === "retrying"
        ? t("app.sessionRestoring")
        : t("app.authChecking")}
    </div>
  );

  const noteScreen = !selectedNote ? (
    <div className="site-shell auth-loading">{t("app.firstNotePrompt")}</div>
  ) : (
    <div className={`site-shell note-shell ${isRightPanelCollapsed ? "is-right-panel-collapsed" : ""}`}>
      <header className="note-topbar">
        <div className="note-topbar-left">
          <AymoLogo variant="icon" size="small" darkMode={darkMode} />
          <button className="btn" onClick={() => navigate("/home")}>{t("app.back")}</button>
        </div>
        <div className="note-topbar-divider" aria-hidden="true" />
        <div className="topbar-actions">
          <div className="right-tabs-header" role="tablist" aria-label="Right panel sections">
            <button
              className={`tab-chip ${activeRightTab === "uploads" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveRightTab("uploads")}
            >
              {t("tab.uploads")}
            </button>
            <button
              className={`tab-chip ${activeRightTab === "viewer" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveRightTab("viewer")}
            >
              {t("tab.viewer")}
            </button>
            <button
              className={`tab-chip ${activeRightTab === "assistant" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveRightTab("assistant")}
            >
              {t("tab.assistant")}
            </button>
          </div>
          {!isRightPanelCollapsed ? (
            <button
              className="note-panel-collapse-button"
              type="button"
              onClick={() => {
                setIsRightPanelCollapsed(true);
                saveNoteRightPanelLayout({ rightPanelCollapsed: true });
              }}
              aria-label="Collapse right panel"
            >
              <PanelRightClose size={18} strokeWidth={2} />
            </button>
          ) : null}
          <div className="note-topbar-buttons">
            <button className="btn" onClick={() => window.alert(t("app.shareCopied"))}>{t("app.share")}</button>
            <button className="btn btn-solid" onClick={() => void persistCurrentNote()}>{t("app.save")}</button>
            <AccountSettingsMenu
              name={profile.name}
              email={profile.email}
              darkMode={darkMode}
              language={language}
              onThemeChange={handleThemeChange}
              onLanguageChange={handleLanguageChange}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      <main className="note-workspace">
        <ResizableNoteWorkspace
          isCollapsed={isRightPanelCollapsed}
          onToggleCollapse={() => {
            setIsRightPanelCollapsed((current) => {
              const next = !current;
              saveNoteRightPanelLayout({ rightPanelCollapsed: next });
              return next;
            });
          }}
          left={
            <div className="note-editor-column">
              <WritingSection
                title={selectedNote.title}
                body={selectedNote.body}
                isRecording={isRecording}
                recordingStatus={recordingStatus}
                recordingError={recordingError}
                editorRef={editorRef}
                onTitleChange={(value) => updateCurrentNote({ title: value })}
                onBodyChange={(value) => updateCurrentNote({ body: value })}
                onRecordToggle={handleRecordToggle}
                onCursorChange={handleEditorCursorChange}
                notes={notes}
                onAskAI={handleAssistantPrompt}
              />
            </div>
          }
          right={
            <aside className="note-side-column" aria-label="Note tools">
              <div className="note-side-sticky">
                <NoteSidePanel
                  uploads={selectedNote.uploads}
                  messages={assistantMessages}
                  liveSummary={liveSummary}
                  activeTab={activeRightTab}
                  aiProvider={aiProvider}
                  onTabChange={setActiveRightTab}
                  onAIProviderChange={handleAIProviderChange}
                  onSubmitPrompt={handleAssistantPrompt}
                  onFileUpload={(files) => void handleUpload(files)}
                  onAddLink={() => void handleAddLink()}
                  onRemoveUpload={(id) => void handleRemoveUpload(id)}
                  // Annotation system wire-up
                  selectedNoteId={selectedNote.id}
                  annotations={annotations}
                  flashAnnotationId={flashAnnotationId}
                  jumpToPage={jumpToPage}
                  onAnnotationCreate={handleAnnotationCreate}
                  onJumpToPage={setJumpToPage}
                  onFlash={handleFlashAnnotation}
                  onDeleteAnnotation={handleDeleteAnnotation}
                  onUpdateAnnotationComment={handleUpdateAnnotationComment}
                  onCreateNoteFromAnnotation={handleCreateNoteFromAnnotation}
                  onAppendNoteFromAnnotation={handleAppendNoteFromAnnotation}
                  onAskAI={handleAssistantPrompt}
                  onCopyText={(text, citation) => console.log("Copied", text, citation)}
                  onSearchGoogle={(text) => console.log("Searching Google", text)}
                />
              </div>
            </aside>
          }
        />
      </main>
    </div>
  );

  const homeScreen = (
    <div className="site-shell home-shell">
      <aside className="sidebar">
        <div className="logo-wrap">
          <AymoLogo variant="icon" size="small" darkMode={darkMode} />
        </div>

        <nav className="home-nav" aria-label="Notebook views">
          {primarySidebarItems.map((tag) => (
            <button
              key={tag.id}
              className={`tag-item ${activeTag === tag.id ? "active" : ""}`}
              onClick={() => {
                setActiveTag(tag.id);
                setOpenNoteMenuId(null);
              }}
            >
              <span>{tag.label}</span>
              <span>{tag.count}</span>
            </button>
          ))}
        </nav>

        <p className="side-label">{t("home.tags")}</p>
        <ul className="tag-list">
          {tagSidebarItems.map((tag) => (
            <li key={tag.id}>
              <button
                className={`tag-item ${activeTag === tag.id ? "active" : ""}`}
                onClick={() => {
                  setActiveTag(tag.id);
                  setOpenNoteMenuId(null);
                }}
              >
                <span>{tag.label}</span>
                <span>{tag.count}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="sidebar-section-divider" />
        <button
          className={`tag-item trash-nav-item ${location.pathname === "/trash" ? "active" : ""}`}
          onClick={() => {
            setOpenNoteMenuId(null);
            navigate("/trash");
          }}
        >
          <span>Trash</span>
          <span>{trashedNoteCount > 0 ? `(${trashedNoteCount})` : ""}</span>
        </button>
      </aside>

      <section className="home-main">
        <header className="home-header">
          <div>
            <h2>{t("home.title")}</h2>
          </div>
          <div className="home-header-actions">
            <button className="btn btn-solid" onClick={() => void createNewNote()} disabled={isBusy}>
              {isBusy ? t("home.creating") : t("home.createNote")}
            </button>
            <AccountSettingsMenu
              name={profile.name}
              email={profile.email}
              darkMode={darkMode}
              language={language}
              onThemeChange={handleThemeChange}
              onLanguageChange={handleLanguageChange}
              onLogout={handleLogout}
            />
          </div>
        </header>

        {homeError ? <p className="auth-error">{homeError}</p> : null}

        <input
          className="search-input"
          placeholder="Search notes, PDFs, and links"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpenNoteMenuId(null);
          }}
        />

        <div className="notes-list">
          {groupedNotes.map((group) => (
            <section key={group.id} className="note-date-group" aria-labelledby={`group-${group.id}`}>
              <h3 id={`group-${group.id}`} className="note-date-label">{group.label}</h3>
              <div className="note-date-items">
                {group.notes.map((note) => {
                  const preview = getFirstMeaningfulLine(note.body);
                  return (
                    <article key={note.id} className="note-card" onClick={() => openNote(note.id)}>
                      <div className="note-card-head">
                        <div className="note-card-copy">
                          <h3>{note.cardTitle}</h3>
                          {preview ? <p className="preview-text">{preview}</p> : null}
                        </div>
                        <div className="menu-wrap note-menu-wrap" onClick={(event) => event.stopPropagation()}>
                          <button
                            className="menu-icon-btn note-menu-button"
                            aria-label={`Open actions for ${note.cardTitle}`}
                            aria-expanded={openNoteMenuId === note.id}
                            onClick={() => {
                              setOpenNoteMenuId((value) => (value === note.id ? null : note.id));
                            }}
                          >
                            <MoreVertical size={16} strokeWidth={2} />
                          </button>
                          {openNoteMenuId === note.id ? (
                            <div className="dropdown-menu note-dropdown-menu">
                              <button onClick={() => openNote(note.id)}>Open</button>
                              <button onClick={() => void togglePin(note.id)}>{note.pinned ? t("home.unpin") : t("home.pin")}</button>
                              <button onClick={() => void renameNote(note.id)}>Rename</button>
                              <button onClick={() => void duplicateNote(note.id)}>Duplicate</button>
                              <button onClick={() => void deleteCurrentNote(note.id)}>{t("home.delete")}</button>
                              <button onClick={() => shareNote(note.id)}>{t("app.share")}</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="note-card-foot">
                        <span>{note.updatedAt}</span>
                        <span>{countWords(note.body)} {t("home.words")}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {filteredNotes.length === 0 ? <p className="empty">{t("home.emptyNotes")}</p> : null}
        </div>
      </section>
    </div>
  );

  if (sessionStatus === "checking" || sessionStatus === "retrying") {
    return (
      <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
        {loadingScreen}
      </div>
    );
  }

  return (
    <div className={`theme-root ${darkMode ? "theme-dark" : ""}`}>
      <Routes>
        <Route path="/" element={<Navigate to={isAuthenticated ? "/home" : "/login"} replace />} />
        <Route
          path="/login"
          element={(
            <PublicRoute isAuthenticated={isAuthenticated}>
              <AuthPage
                initialMode="login"
                darkMode={darkMode}
                onToggleTheme={() => setDarkMode((value) => !value)}
                onEmailAuth={handleEmailAuth}
                onGoogleAuth={handleGoogleAuth}
                onAppleAuth={handleAppleAuth}
                onForgotPassword={handleForgotPassword}
                onResetPassword={handleResetPassword}
              />
            </PublicRoute>
          )}
        />
        <Route
          path="/signup"
          element={(
            <PublicRoute isAuthenticated={isAuthenticated}>
              <AuthPage
                initialMode="signup"
                darkMode={darkMode}
                onToggleTheme={() => setDarkMode((value) => !value)}
                onEmailAuth={handleEmailAuth}
                onGoogleAuth={handleGoogleAuth}
                onAppleAuth={handleAppleAuth}
                onForgotPassword={handleForgotPassword}
                onResetPassword={handleResetPassword}
              />
            </PublicRoute>
          )}
        />
        <Route
          path="/home"
          element={(
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              {isWorkspaceLoading ? loadingScreen : homeScreen}
            </ProtectedRoute>
          )}
        />
        <Route
          path="/trash"
          element={(
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              {isWorkspaceLoading ? (
                loadingScreen
              ) : (
                <div className="site-shell home-shell">
                  <aside className="sidebar">
                    <div className="logo-wrap">
                      <AymoLogo variant="icon" size="small" darkMode={darkMode} />
                    </div>

                    <nav className="home-nav" aria-label="Notebook views">
                      {primarySidebarItems.map((tag) => (
                        <button
                          key={tag.id}
                          className={`tag-item ${activeTag === tag.id ? "active" : ""}`}
                          onClick={() => {
                            setActiveTag(tag.id);
                            setOpenNoteMenuId(null);
                            navigate("/home");
                          }}
                        >
                          <span>{tag.label}</span>
                          <span>{tag.count}</span>
                        </button>
                      ))}
                    </nav>

                    <p className="side-label">{t("home.tags")}</p>
                    <ul className="tag-list">
                      {tagSidebarItems.map((tag) => (
                        <li key={tag.id}>
                          <button
                            className={`tag-item ${activeTag === tag.id ? "active" : ""}`}
                            onClick={() => {
                              setActiveTag(tag.id);
                              setOpenNoteMenuId(null);
                              navigate("/home");
                            }}
                          >
                            <span>{tag.label}</span>
                            <span>{tag.count}</span>
                          </button>
                        </li>
                      ))}
                    </ul>

                    <div className="sidebar-section-divider" />
                    <button
                      className={`tag-item trash-nav-item active`}
                      onClick={() => {
                        setOpenNoteMenuId(null);
                      }}
                    >
                      <span>Trash</span>
                      <span>{trashedNoteCount > 0 ? `(${trashedNoteCount})` : ""}</span>
                    </button>
                  </aside>
                  <TrashPage
                    authToken={authToken!}
                    darkMode={darkMode}
                    language={language}
                    profile={profile}
                    onThemeChange={handleThemeChange}
                    onLanguageChange={handleLanguageChange}
                    onLogout={handleLogout}
                    onNoteRestored={(restoredNote) => {
                      setNotes((prev) => [mapNoteToHomeNote(restoredNote, noteLabels), ...prev]);
                      setTrashedNoteCount((prev) => Math.max(0, prev - 1));
                    }}
                  />
                </div>
              )}
            </ProtectedRoute>
          )}
        />
        <Route
          path="/notes/:noteId"
          element={(
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              {isWorkspaceLoading
                ? loadingScreen
                : routeNoteId && notes.length > 0 && !selectedNote
                  ? <Navigate to="/home" replace />
                  : noteScreen}
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/home" : "/login"} replace />} />
      </Routes>
    </div>
  );
}

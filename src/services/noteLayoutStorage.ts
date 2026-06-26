const NOTE_RIGHT_PANEL_LAYOUT_KEY = "aymo.notePage.rightPanelLayout";
const LEGACY_RIGHT_PANEL_WIDTH_KEY = "aymo.notePage.rightPanelWidth";

export interface NoteRightPanelLayout {
  rightPanelCollapsed: boolean;
  rightPanelWidth: number | null;
}

const DEFAULT_LAYOUT: NoteRightPanelLayout = {
  rightPanelCollapsed: false,
  rightPanelWidth: null,
};

function readLegacyWidth(): number | null {
  try {
    const stored = window.localStorage.getItem(LEGACY_RIGHT_PANEL_WIDTH_KEY);
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadNoteRightPanelLayout(): NoteRightPanelLayout {
  if (typeof window === "undefined") {
    return DEFAULT_LAYOUT;
  }

  try {
    const raw = window.localStorage.getItem(NOTE_RIGHT_PANEL_LAYOUT_KEY);
    if (!raw) {
      return {
        ...DEFAULT_LAYOUT,
        rightPanelWidth: readLegacyWidth(),
      };
    }

    const parsed = JSON.parse(raw) as Partial<NoteRightPanelLayout>;
    const width = typeof parsed.rightPanelWidth === "number" && Number.isFinite(parsed.rightPanelWidth)
      ? parsed.rightPanelWidth
      : readLegacyWidth();

    return {
      rightPanelCollapsed: Boolean(parsed.rightPanelCollapsed),
      rightPanelWidth: width,
    };
  } catch {
    return {
      ...DEFAULT_LAYOUT,
      rightPanelWidth: readLegacyWidth(),
    };
  }
}

export function saveNoteRightPanelLayout(patch: Partial<NoteRightPanelLayout>): NoteRightPanelLayout {
  const next = {
    ...loadNoteRightPanelLayout(),
    ...patch,
  };

  try {
    window.localStorage.setItem(NOTE_RIGHT_PANEL_LAYOUT_KEY, JSON.stringify(next));
  } catch {
    // Keep layout usable when storage is blocked.
  }

  return next;
}

export const NOTE_RIGHT_PANEL_LAYOUT_STORAGE_KEY = NOTE_RIGHT_PANEL_LAYOUT_KEY;

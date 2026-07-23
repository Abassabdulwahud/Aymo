import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { AymoLogo } from "./AymoLogo";
import {
  LocalWorkspace,
  createLocalWorkspace,
  getActiveLocalWorkspace,
  setActiveWorkspaceId,
} from "../services/localWorkspaceDatabase";
import {
  StorageHealth,
  formatStorageBytes,
  getStorageHealth,
  requestPersistentStorage,
} from "../services/storageHealthService";

interface WorkspaceGateProps {
  children: ReactNode;
}

type WorkspaceGateState =
  | { status: "loading" }
  | { status: "ready"; workspace: LocalWorkspace }
  | { status: "empty"; workspaces: LocalWorkspace[] }
  | { status: "select"; workspaces: LocalWorkspace[] }
  | { status: "recovery"; workspaces: LocalWorkspace[]; missingWorkspaceId: string }
  | { status: "unavailable"; message: string };

function storageStatusLabel(health: StorageHealth | null): string {
  if (!health) return "Checking local storage";
  if (!health.indexedDbAvailable) return "Local storage unavailable";
  if (health.status === "critical") return "Storage almost full";
  if (health.status === "warning") return "Backup recommended";
  if (health.persistentStorageEnabled === true) return "Persistent local storage enabled";
  return "Stored locally";
}

function WorkspaceHealthSummary({ health }: { health: StorageHealth | null }) {
  const available = health ? formatStorageBytes(health.availableBytes) : "Checking";

  return (
    <div className={`workspace-health-card ${health?.status ?? "healthy"}`}>
      <div>
        <span className="workspace-health-kicker">Workspace Health</span>
        <strong>{storageStatusLabel(health)}</strong>
      </div>
      <ul>
        <li>{health?.indexedDbAvailable === false ? "Local database unavailable" : "Local database ready"}</li>
        <li>
          {health?.persistentStorageEnabled === true
            ? "Persistent storage enabled"
            : health?.persistentStorageSupported
              ? "Persistent storage can be requested"
              : "Persistent storage support unknown"}
        </li>
        <li>{available} available</li>
      </ul>
    </div>
  );
}

export function WorkspaceGate({ children }: WorkspaceGateProps) {
  const [gateState, setGateState] = useState<WorkspaceGateState>({ status: "loading" });
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Personal Workspace");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshStorageHealth = async () => {
    const health = await getStorageHealth();
    setStorageHealth(health);
  };

  const refreshWorkspaces = async () => {
    try {
      const [{ activeWorkspace, activeWorkspaceId, workspaces }, health] = await Promise.all([
        getActiveLocalWorkspace(),
        getStorageHealth(),
      ]);
      setStorageHealth(health);

      if (activeWorkspace) {
        setGateState({ status: "ready", workspace: activeWorkspace });
        return;
      }

      if (activeWorkspaceId && !activeWorkspace) {
        setGateState({ status: "recovery", workspaces, missingWorkspaceId: activeWorkspaceId });
        return;
      }

      setGateState(workspaces.length > 0 ? { status: "select", workspaces } : { status: "empty", workspaces });
    } catch (caught) {
      setGateState({
        status: "unavailable",
        message: caught instanceof Error ? caught.message : "Local workspace storage could not start.",
      });
    }
  };

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  useEffect(() => {
    if (!navigator.storage?.persisted) return;

    let isMounted = true;
    const requestPersistenceIfNeeded = async () => {
      try {
        const alreadyPersistent = await navigator.storage.persisted();
        if (!alreadyPersistent) {
          await requestPersistentStorage();
        }
      } finally {
        if (isMounted) {
          await refreshStorageHealth();
        }
      }
    };

    void requestPersistenceIfNeeded();

    return () => {
      isMounted = false;
    };
  }, []);

  const sortedWorkspaces = useMemo(() => {
    if (gateState.status !== "select" && gateState.status !== "empty" && gateState.status !== "recovery") {
      return [];
    }
    return [...gateState.workspaces].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [gateState]);

  const handleCreateWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    try {
      const workspace = await createLocalWorkspace(workspaceName);
      await refreshStorageHealth();
      setGateState({ status: "ready", workspace });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace could not be created.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectWorkspace = async (workspace: LocalWorkspace) => {
    setError(null);
    setIsBusy(true);

    try {
      await setActiveWorkspaceId(workspace.id);
      setGateState({ status: "ready", workspace });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace could not be opened.");
    } finally {
      setIsBusy(false);
    }
  };

  if (gateState.status === "ready") {
    return <>{children}</>;
  }

  if (gateState.status === "loading") {
    return (
      <div className="workspace-gate-shell">
        <div className="workspace-gate-panel compact">
          <AymoLogo variant="icon" size="small" />
          <p>Opening local workspace...</p>
        </div>
      </div>
    );
  }

  if (gateState.status === "unavailable") {
    return (
      <div className="workspace-gate-shell">
        <div className="workspace-gate-panel">
          <AymoLogo variant="icon" size="small" />
          <span className="workspace-eyebrow">Local workspace unavailable</span>
          <h1>AYMO needs browser storage to protect your knowledge.</h1>
          <p>{gateState.message}</p>
          <WorkspaceHealthSummary health={storageHealth} />
        </div>
      </div>
    );
  }

  const isRecovery = gateState.status === "recovery";
  const isSelect = gateState.status === "select" || isRecovery;

  return (
    <div className="workspace-gate-shell">
      <div className="workspace-gate-panel">
        <div className="workspace-gate-brand">
          <AymoLogo variant="icon" size="small" />
          <span>AYMO</span>
        </div>

        {isRecovery ? (
          <>
            <span className="workspace-eyebrow">Workspace not found</span>
            <h1>Your remembered workspace is not available on this device.</h1>
            <p>
              Choose another local workspace, create a new one, or restore from a backup when that option is connected.
            </p>
            <div className="workspace-recovery-actions">
              <button className="btn" type="button" disabled>
                Restore from Cloud
              </button>
              <button className="btn" type="button" disabled>
                Import Workspace
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="workspace-eyebrow">Local-first workspace</span>
            <h1>Create a workspace before anything goes to the cloud.</h1>
            <p>
              AYMO stores workspace foundations on this device first. Sign-in and sync can be added later.
            </p>
          </>
        )}

        <WorkspaceHealthSummary health={storageHealth} />

        {isSelect && sortedWorkspaces.length > 0 ? (
          <div className="workspace-list" aria-label="Available workspaces">
            {sortedWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                className="workspace-list-item"
                type="button"
                onClick={() => void handleSelectWorkspace(workspace)}
                disabled={isBusy}
              >
                <strong>{workspace.name}</strong>
                <span>Stored locally</span>
              </button>
            ))}
          </div>
        ) : null}

        <form className="workspace-create-form" onSubmit={handleCreateWorkspace}>
          <label htmlFor="workspace-name">Workspace name</label>
          <div className="workspace-create-row">
            <input
              id="workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Personal Workspace"
              maxLength={80}
            />
            <button className="btn btn-solid" type="submit" disabled={isBusy || !workspaceName.trim()}>
              {isBusy ? "Creating..." : "Create Workspace"}
            </button>
          </div>
        </form>

        {error ? <p className="workspace-error">{error}</p> : null}
      </div>
    </div>
  );
}

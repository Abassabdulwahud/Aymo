import { useEffect, useState } from "react";
import {
  StorageHealth,
  formatStorageBytes,
  getStorageHealth,
  requestPersistentStorage,
} from "../services/storageHealthService";

interface WorkspaceHealthPanelProps {
  /** Pass true when the session is local-only (no cloud account). */
  isLocalSession: boolean;
}

function StatusBadge({ status }: { status: StorageHealth["status"] | "loading" }) {
  const labels: Record<string, string> = {
    healthy: "Healthy",
    warning: "Warning",
    critical: "Critical",
    unavailable: "Unavailable",
    loading: "Checking…",
  };
  return (
    <span className={`ws-health-badge ws-health-badge--${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

export function WorkspaceHealthPanel({ isLocalSession }: WorkspaceHealthPanelProps) {
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [requestingPersist, setRequestingPersist] = useState(false);

  const refresh = async () => {
    const result = await getStorageHealth();
    setHealth(result);
  };

  useEffect(() => {
    void refresh();
    // Refresh storage estimate every 60 seconds while panel is mounted.
    const intervalId = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const handleEnablePersistence = async () => {
    setRequestingPersist(true);
    try {
      await requestPersistentStorage();
      await refresh();
    } finally {
      setRequestingPersist(false);
    }
  };

  const status = health?.status ?? "loading";
  const usageLabel = health ? formatStorageBytes(health.usageBytes) : "—";
  const availableLabel = health ? formatStorageBytes(health.availableBytes) : "—";
  const persistEnabled = health?.persistentStorageEnabled;
  const persistSupported = health?.persistentStorageSupported ?? false;

  return (
    <div className={`ws-health-panel ws-health-panel--${status}`}>
      <div className="ws-health-panel__header">
        <span className="ws-health-panel__title">Workspace</span>
        <StatusBadge status={status} />
      </div>

      <ul className="ws-health-panel__rows">
        <li className="ws-health-row">
          <span className="ws-health-row__label">Storage</span>
          <span className="ws-health-row__value">Stored locally</span>
        </li>

        <li className="ws-health-row">
          <span className="ws-health-row__label">Used</span>
          <span className="ws-health-row__value">{usageLabel}</span>
        </li>

        <li className="ws-health-row">
          <span className="ws-health-row__label">Available</span>
          <span className="ws-health-row__value">{availableLabel}</span>
        </li>

        <li className="ws-health-row">
          <span className="ws-health-row__label">Persistent</span>
          <span className="ws-health-row__value">
            {persistEnabled === true
              ? "Enabled"
              : persistEnabled === false
                ? "Not enabled"
                : "Unknown"}
          </span>
        </li>

        <li className="ws-health-row">
          <span className="ws-health-row__label">Cloud sync</span>
          <span className="ws-health-row__value ws-health-row__value--muted">
            {isLocalSession ? "Disabled" : "Active"}
          </span>
        </li>
      </ul>

      {persistSupported && persistEnabled === false && (
        <button
          className="ws-health-panel__persist-btn"
          type="button"
          onClick={() => void handleEnablePersistence()}
          disabled={requestingPersist}
        >
          {requestingPersist ? "Requesting…" : "Enable Persistent Storage"}
        </button>
      )}
    </div>
  );
}

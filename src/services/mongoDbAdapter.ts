import type { CloudSyncAdapter, SyncQueueRecord, ConflictRecord, ConflictResolution, SyncEntityType, SyncOperation } from "./syncTypes";

export class MongoDBAdapter implements CloudSyncAdapter {
  readonly provider = "mongodb" as const;
  private authToken: string;
  private baseUrl: string;

  constructor(authToken: string, baseUrl = "") {
    this.authToken = authToken;
    // Default to port 8000 in development, otherwise current origin
    this.baseUrl = baseUrl || (
      window.location.origin.includes("localhost") || 
      window.location.origin.includes("127.0.0.1") 
        ? "http://127.0.0.1:8000" 
        : window.location.origin
    );
  }

  private get headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.authToken}`,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/protected/sync/status`, {
        method: "GET",
        headers: this.headers,
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return data.available === true;
    } catch {
      return false;
    }
  }

  async pushOperation(record: SyncQueueRecord): Promise<{ remoteId: string }> {
    const resp = await fetch(`${this.baseUrl}/api/protected/sync/push`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(record),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Cloud push failed: ${resp.status} - ${errText}`);
    }

    const data = await resp.json();
    if (!data.remoteId) {
      throw new Error("Cloud push succeeded but returned no remoteId");
    }

    return { remoteId: data.remoteId };
  }

  async fetchChanges(
    workspaceId: string,
    since: string | null,
  ): Promise<
    Array<{
      entityType: SyncEntityType;
      operation: SyncOperation;
      localId: string | null;
      remoteId: string;
      payload: Record<string, unknown>;
      updatedAt: string;
    }>
  > {
    const url = new URL(`${this.baseUrl}/api/protected/sync/pull`);
    url.searchParams.append("workspaceId", workspaceId);
    if (since) {
      url.searchParams.append("since", since);
    }

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Cloud pull failed: ${resp.status} - ${errText}`);
    }

    const data = await resp.json();
    return data.changes || [];
  }

  async resolveConflict(conflict: ConflictRecord): Promise<Omit<ConflictResolution, "pending">> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/protected/sync/conflict`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(conflict),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.resolution && data.resolution !== "pending") {
          return data.resolution as Omit<ConflictResolution, "pending">;
        }
      }
    } catch (e) {
      console.warn("Adapter resolution failed, falling back to local-wins:", e);
    }
    return "local-wins";
  }
}

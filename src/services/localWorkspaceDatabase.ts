export interface LocalWorkspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  syncEnabled: boolean;
}

const DATABASE_NAME = "aymo_local";
const DATABASE_VERSION = 1;
const ACTIVE_WORKSPACE_KEY = "activeWorkspaceId";
const ACTIVE_WORKSPACE_STORAGE_KEY = "aymo.activeWorkspaceId";

type StoreName =
  | "workspaces"
  | "workspaceMetadata"
  | "notes"
  | "tags"
  | "preferences"
  | "annotations"
  | "aiHistory"
  | "attachments"
  | "attachmentBlobs"
  | "syncQueue"
  | "remoteMappings"
  | "tombstones"
  | "conflicts";

interface MetadataRecord {
  key: string;
  value: string;
  updatedAt: string;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const next = value === "x" ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

function createObjectStore(database: IDBDatabase, name: StoreName, options?: IDBObjectStoreParameters): IDBObjectStore {
  if (database.objectStoreNames.contains(name)) {
    return database.transaction(name, "readonly").objectStore(name);
  }
  return database.createObjectStore(name, options);
}

function ensureSchema(database: IDBDatabase): void {
  const workspaces = createObjectStore(database, "workspaces", { keyPath: "id" });
  if (!workspaces.indexNames.contains("updatedAt")) {
    workspaces.createIndex("updatedAt", "updatedAt");
  }

  createObjectStore(database, "workspaceMetadata", { keyPath: "key" });

  const workspaceScopedStores: StoreName[] = [
    "notes",
    "tags",
    "preferences",
    "annotations",
    "aiHistory",
    "attachments",
    "attachmentBlobs",
    "syncQueue",
    "remoteMappings",
    "tombstones",
    "conflicts",
  ];

  for (const storeName of workspaceScopedStores) {
    const store = createObjectStore(database, storeName, { keyPath: "id" });
    if (!store.indexNames.contains("workspaceId")) {
      store.createIndex("workspaceId", "workspaceId");
    }
  }
}

export function openLocalWorkspaceDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      ensureSchema(request.result);
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open local workspace database."));
    };
  });

  return databasePromise;
}

function runTransaction<T>(
  storeNames: StoreName | StoreName[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  return openLocalWorkspaceDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeNames, mode);
        let result: T;
        let operationSettled = false;

        transaction.oncomplete = () => {
          if (operationSettled) {
            resolve(result);
          }
        };
        transaction.onabort = () => reject(transaction.error ?? new Error("Local database transaction was aborted."));
        transaction.onerror = () => reject(transaction.error ?? new Error("Local database transaction failed."));

        operation(transaction)
          .then((value) => {
            result = value;
            operationSettled = true;
          })
          .catch((error) => {
            try {
              transaction.abort();
            } catch {
              // The transaction may already be closed.
            }
            reject(error);
          });
      }),
  );
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local database request failed."));
  });
}

export async function listLocalWorkspaces(): Promise<LocalWorkspace[]> {
  return runTransaction("workspaces", "readonly", async (transaction) => {
    const store = transaction.objectStore("workspaces");
    const workspaces = await requestToPromise<LocalWorkspace[]>(store.getAll());
    return workspaces.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  });
}

export async function getLocalWorkspace(id: string): Promise<LocalWorkspace | null> {
  return runTransaction("workspaces", "readonly", async (transaction) => {
    const workspace = await requestToPromise<LocalWorkspace | undefined>(
      transaction.objectStore("workspaces").get(id),
    );
    return workspace ?? null;
  });
}

export async function createLocalWorkspace(name: string): Promise<LocalWorkspace> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Workspace name is required.");
  }

  const now = new Date().toISOString();
  const workspace: LocalWorkspace = {
    id: createId(),
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
    syncEnabled: false,
  };

  await runTransaction(["workspaces", "workspaceMetadata"], "readwrite", async (transaction) => {
    transaction.objectStore("workspaces").put(workspace);
    const metadata: MetadataRecord = {
      key: ACTIVE_WORKSPACE_KEY,
      value: workspace.id,
      updatedAt: now,
    };
    transaction.objectStore("workspaceMetadata").put(metadata);
  });

  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspace.id);
  } catch {
    // IndexedDB remains the source of truth.
  }

  return workspace;
}

export async function setActiveWorkspaceId(workspaceId: string): Promise<void> {
  const now = new Date().toISOString();
  await runTransaction("workspaceMetadata", "readwrite", async (transaction) => {
    const metadata: MetadataRecord = {
      key: ACTIVE_WORKSPACE_KEY,
      value: workspaceId,
      updatedAt: now,
    };
    transaction.objectStore("workspaceMetadata").put(metadata);
  });

  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // IndexedDB remains the source of truth.
  }
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  const fromDatabase = await runTransaction("workspaceMetadata", "readonly", async (transaction) => {
    const metadata = await requestToPromise<MetadataRecord | undefined>(
      transaction.objectStore("workspaceMetadata").get(ACTIVE_WORKSPACE_KEY),
    );
    return metadata?.value ?? null;
  });

  if (fromDatabase) {
    return fromDatabase;
  }

  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function getActiveLocalWorkspace(): Promise<{
  activeWorkspace: LocalWorkspace | null;
  activeWorkspaceId: string | null;
  workspaces: LocalWorkspace[];
}> {
  const [activeWorkspaceId, workspaces] = await Promise.all([
    getActiveWorkspaceId(),
    listLocalWorkspaces(),
  ]);

  const activeWorkspace = activeWorkspaceId
    ? workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : workspaces[0] ?? null;

  return {
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
  };
}

export interface LocalNote {
  id: string; // UUID
  workspaceId: string;
  title: string;
  body: string;
  isPinned: boolean;
  isFavorited: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null; // ISO string if trashed
  tags: string[];
  files: any[];
}

export async function listLocalNotes(workspaceId: string, includeTrashed = false): Promise<LocalNote[]> {
  return runTransaction("notes", "readonly", async (transaction) => {
    const store = transaction.objectStore("notes");
    const index = store.index("workspaceId");
    const request = index.getAll(workspaceId);
    const allNotes = await requestToPromise<LocalNote[]>(request);
    
    return allNotes.filter(n => includeTrashed ? n.deletedAt !== null : n.deletedAt === null);
  });
}

export async function getLocalNote(id: string): Promise<LocalNote | null> {
  return runTransaction("notes", "readonly", async (transaction) => {
    const note = await requestToPromise<LocalNote | undefined>(
      transaction.objectStore("notes").get(id),
    );
    return note ?? null;
  });
}

export async function putLocalNote(note: LocalNote): Promise<void> {
  await runTransaction("notes", "readwrite", async (transaction) => {
    transaction.objectStore("notes").put(note);
  });
}

export async function deleteLocalNotePermanently(id: string): Promise<void> {
  await runTransaction("notes", "readwrite", async (transaction) => {
    transaction.objectStore("notes").delete(id);
  });
}

export function generateUuid(): string {
  return createId();
}


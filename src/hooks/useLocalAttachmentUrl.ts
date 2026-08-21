/**
 * useLocalAttachmentUrl.ts
 *
 * React hook that resolves the playable/renderable URL for an attachment.
 *
 * Architecture:
 *   For LOCAL attachments (string UUID id):
 *     Fetches the raw Blob from IndexedDB → URL.createObjectURL(blob)
 *     The Object URL is stable for the lifetime of this hook instance.
 *     It is revoked when the attachment ID changes or the component unmounts.
 *
 *   For CLOUD attachments (numeric backend id):
 *     Uses the provided fallbackUrl (CDN URL) directly.
 *     No IndexedDB read required.
 *
 *   Fallback chain:
 *     1. IndexedDB blob (best — works offline, no network)
 *     2. fallbackUrl (CDN URL — requires network, but works for cloud files)
 *     3. null + error message
 *
 * Usage:
 *   const { url, loading, error } = useLocalAttachmentUrl(upload.id, upload.source);
 *
 *   // url is a blob: URL (local) or CDN URL (cloud)
 *   // loading is true while the IndexedDB fetch is in progress
 *   // error is set if no blob was found and no fallback is available
 */

import { useEffect, useState } from "react";
import { getLocalAttachmentBlob } from "../services/localWorkspaceDatabase";

export interface LocalAttachmentUrlState {
  /** The playable/renderable URL, or null while loading or on error. */
  url: string | null;
  /** True while fetching from IndexedDB. */
  loading: boolean;
  /**
   * Human-readable error, set when:
   * - No blob was found in IndexedDB AND
   * - No fallbackUrl is available
   */
  error: string | null;
}

/**
 * @param attachmentId  The attachment's ID. String = local UUID; number = cloud ID.
 * @param fallbackUrl   Optional CDN/blob URL to use when IndexedDB has no blob
 *                      (cloud files, pre-v3 uploads, etc.)
 */
export function useLocalAttachmentUrl(
  attachmentId: string | number | null | undefined,
  fallbackUrl?: string | null,
): LocalAttachmentUrlState {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      // ── No attachment selected ─────────────────────────────────────────────
      if (attachmentId === null || attachmentId === undefined) {
        setUrl(null);
        setLoading(false);
        setError(null);
        return;
      }

      // ── Cloud file (numeric backend ID) ─────────────────────────────────────
      // Cloud files are identified by numeric IDs from the backend.
      // They live at a CDN URL — use that directly.
      if (typeof attachmentId === "number") {
        setUrl(fallbackUrl ?? null);
        setLoading(false);
        setError(fallbackUrl ? null : "No URL available for this file.");
        return;
      }

      // ── Local file (UUID string) ─────────────────────────────────────────────
      // If there's already a non-blob fallback URL (e.g. a CDN URL), use it
      // immediately while we check IndexedDB in parallel. This prevents a flash
      // of the loading state for cloud-synced files that happen to have a UUID.
      if (fallbackUrl && !fallbackUrl.startsWith("blob:")) {
        if (!isCancelled) {
          setUrl(fallbackUrl);
          setLoading(false);
          setError(null);
        }
        return;
      }

      setLoading(true);
      setError(null);
      // Don't clear the previous url yet — let the old URL render until the
      // new one is ready to avoid a flash of empty content.

      try {
        const blob = await getLocalAttachmentBlob(String(attachmentId));
        if (isCancelled) return;

        if (blob) {
          // ── Happy path: blob found in IndexedDB ──────────────────────────────
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          setError(null);
        } else if (fallbackUrl) {
          // ── Fallback: no blob, but a URL is available (pre-v3, cloud-synced) ─
          setUrl(fallbackUrl);
          setError(null);
        } else {
          // ── Nothing available ────────────────────────────────────────────────
          setUrl(null);
          setError(
            "This file is not available locally. " +
            "It may have been attached before offline storage was enabled. " +
            "Try re-attaching the file."
          );
        }
      } catch (err) {
        if (isCancelled) return;
        console.error("[useLocalAttachmentUrl] IndexedDB read failed:", err);
        if (fallbackUrl) {
          setUrl(fallbackUrl);
          setError(null);
        } else {
          setUrl(null);
          setError("Could not read the local file. Storage may be unavailable.");
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    // ── Cleanup ────────────────────────────────────────────────────────────────
    // Revoke the Object URL when the attachment changes or the component unmounts.
    // This prevents memory leaks from accumulating unreferenced blobs.
    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    // Re-run whenever the attachment ID changes.
    // We deliberately exclude fallbackUrl from deps — once we have a blob URL
    // we don't want the fallback to clobber it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId]);

  return { url, loading, error };
}

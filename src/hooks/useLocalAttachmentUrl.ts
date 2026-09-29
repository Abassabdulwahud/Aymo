/**
 * useLocalAttachmentUrl.ts
 *
 * React hook that resolves the playable/renderable URL for an attachment from IndexedDB v4.
 * Object URLs created with URL.createObjectURL(blob) are revoked when the attachment
 * ID changes or the component unmounts.
 */

import { useEffect, useState } from "react";
import { AttachmentService } from "../services/attachmentService";

export interface LocalAttachmentUrlState {
  /** The playable/renderable URL, or null while loading or on error. */
  url: string | null;
  /** True while fetching from IndexedDB. */
  loading: boolean;
  /** Human-readable error message. */
  error: string | null;
}

export function useLocalAttachmentUrl(
  attachmentId: string | number | null | undefined,
  fallbackUrl?: string | null,
  workspaceId?: string,
): LocalAttachmentUrlState {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      if (attachmentId === null || attachmentId === undefined) {
        setUrl(null);
        setLoading(false);
        setError(null);
        return;
      }

      if (typeof attachmentId === "number") {
        setUrl(fallbackUrl ?? null);
        setLoading(false);
        setError(fallbackUrl ? null : "No URL available for this file.");
        return;
      }

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

      try {
        const blob = await AttachmentService.getAttachmentBlob(String(attachmentId), workspaceId);
        if (isCancelled) return;

        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          setError(null);
        } else if (fallbackUrl) {
          setUrl(fallbackUrl);
          setError(null);
        } else {
          setUrl(null);
          setError("MISSING_BLOB: This file is not available in local IndexedDB storage.");
        }
      } catch (err: any) {
        if (isCancelled) return;
        if (fallbackUrl) {
          setUrl(fallbackUrl);
          setError(null);
        } else {
          setUrl(null);
          setError(err?.message || "Could not read the local file from IndexedDB.");
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
  }, [attachmentId, workspaceId]);

  return { url, loading, error };
}

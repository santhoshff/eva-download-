import { useCallback, useEffect, useRef, useState } from "react";
import { extractUrl } from "@/lib/media";

/**
 * Monitors the system clipboard for a supported video/audio link.
 *
 * Fires on:
 *  - first mount
 *  - document becomes visible again (user switches back to the tab)
 *  - window receives focus
 *
 * The same URL is never surfaced twice in a row — once clearClipboardUrl
 * is called (e.g. when the sheet closes) the slot resets so a fresh copy of
 * the same URL will trigger again next time.
 */
export function useClipboardLink() {
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  // Track the last URL we already surfaced so we don't open the sheet twice
  // for the same value while the user hasn't dismissed it yet.
  const surfacedRef = useRef<string | null>(null);

  const check = useCallback(async () => {
    // navigator.clipboard is not available in insecure contexts or when
    // the document does not have focus on some browsers — guard accordingly.
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard?.readText ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const url = extractUrl(text);
      if (url && url !== surfacedRef.current) {
        surfacedRef.current = url;
        setClipboardUrl(url);
      }
    } catch {
      // NotAllowedError on iOS < 17 or when permission is denied — ignore silently.
    }
  }, []);

  useEffect(() => {
    // Check immediately on mount.
    void check();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onFocus = () => void check();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  /** Call this when the sheet closes so the same URL can trigger again if re-copied. */
  const clearClipboardUrl = useCallback(() => {
    surfacedRef.current = null;
    setClipboardUrl(null);
  }, []);

  return { clipboardUrl, clearClipboardUrl };
}

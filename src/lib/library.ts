import type { FormatKind, Platform } from "./media";

export interface LibraryItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  platform: Platform;
  kind: FormatKind;
  formatLabel: string;
  durationSec: number;
  sizeBytes?: number;
  fileName: string;
  savedAt: number;
  demo: boolean;
}

const KEY = "eva.library.v1";
const EVENT = "eva:library";

export function readLibrary(): LibraryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LibraryItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: LibraryItem[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
  window.dispatchEvent(new Event(EVENT));
}

export function addToLibrary(item: Omit<LibraryItem, "id" | "savedAt">): LibraryItem {
  const full: LibraryItem = { ...item, id: crypto.randomUUID(), savedAt: Date.now() };
  write([full, ...readLibrary()]);
  return full;
}

export function removeFromLibrary(id: string) {
  write(readLibrary().filter((i) => i.id !== id));
}

export function subscribeLibrary(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

import stillFilm from "@/assets/still-film.jpg";
import coverAlbum from "@/assets/cover-album.jpg";
import coverDoc from "@/assets/cover-doc.jpg";

export type Platform = "youtube" | "instagram" | "tiktok" | "x" | "unknown";
export type FormatKind = "video" | "audio";

export interface MediaFormat {
  id: string;
  kind: FormatKind;
  label: string; // "1080p" | "320 kbps"
  sizeBytes?: number | undefined;
  ext: string;
}

export interface MediaInfo {
  url: string;
  platform: Platform;
  title: string;
  author?: string | undefined;
  thumbnail: string;
  durationSec: number;
  formats: MediaFormat[];
  demo: boolean;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  unknown: "Link",
};

export function detectPlatform(url: string): Platform {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return "unknown";
  }
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host === "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com")) return "x";
  return "unknown";
}

/** Pull the first http(s) URL out of shared text. */
export function extractUrl(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  try {
    return new URL(m[0]).toString();
  } catch {
    return null;
  }
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

const MB = 1024 * 1024;

function buildFormats(durationSec: number): MediaFormat[] {
  const min = durationSec / 60;
  return [
    { id: "v1080", kind: "video", label: "1080p", sizeBytes: Math.round(min * 19 * MB), ext: "mp4" },
    { id: "v720", kind: "video", label: "720p", sizeBytes: Math.round(min * 9.3 * MB), ext: "mp4" },
    { id: "v480", kind: "video", label: "480p", sizeBytes: Math.round(min * 4 * MB), ext: "mp4" },
    { id: "a320", kind: "audio", label: "320 kbps", sizeBytes: Math.round(min * 2.4 * MB), ext: "mp3" },
    { id: "a192", kind: "audio", label: "192 kbps", sizeBytes: Math.round(min * 1.44 * MB), ext: "mp3" },
    { id: "a128", kind: "audio", label: "128 kbps", sizeBytes: Math.round(min * 0.96 * MB), ext: "mp3" },
  ];
}

/** Sample metadata used until a self-hosted extractor is connected. */
export function mockMediaInfo(url: string): MediaInfo {
  const platform = detectPlatform(url);
  const samples: Record<Platform, Omit<MediaInfo, "url" | "platform" | "formats" | "demo">> = {
    youtube: { title: "The Long Way Home", author: "A slow-cinema essay on return", thumbnail: stillFilm, durationSec: 272 },
    instagram: { title: "Night Train to Lisbon", author: "@meridian.studio", thumbnail: coverAlbum, durationSec: 238 },
    tiktok: { title: "Field Notes on Silence", author: "@quietforest", thumbnail: coverDoc, durationSec: 724 },
    x: { title: "Dust Road — Director's Cut", author: "@dustroadfilm", thumbnail: stillFilm, durationSec: 143 },
    unknown: { title: "Untitled media", author: "Unknown source", thumbnail: coverDoc, durationSec: 180 },
  };
  const s = samples[platform];
  return { url, platform, ...s, formats: buildFormats(s.durationSec), demo: true };
}

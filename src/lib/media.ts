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
  directUrl?: string | undefined;
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

export function mockMediaInfo(url: string): MediaInfo {
  const platform = detectPlatform(url);
  let title = "Shared Media";
  let author = "Online Media";
  let durationSec = 120;

  try {
    const parsed = new URL(url);
    if (platform === "instagram") {
      const match = url.match(/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/i);
      const shortcode = match ? match[1] : "";
      title = shortcode ? `Instagram Reel (${shortcode})` : "Instagram Reel";
      author = "@instagram";
      durationSec = 60;
    } else if (platform === "youtube") {
      let videoId = "";
      if (parsed.hostname.includes("youtu.be")) {
        videoId = parsed.pathname.slice(1).split("?")[0];
      } else {
        videoId = parsed.searchParams.get("v") || "";
      }
      title = videoId ? `YouTube Video (${videoId})` : "YouTube Video";
      author = "YouTube Channel";
      durationSec = 240;
    } else if (platform === "tiktok") {
      const match = url.match(/video\/([0-9]+)/i);
      const id = match ? match[1] : "";
      title = id ? `TikTok Video (${id})` : "TikTok Video";
      author = "@tiktok";
      durationSec = 45;
    } else if (platform === "x") {
      const match = url.match(/status\/([0-9]+)/i);
      const id = match ? match[1] : "";
      title = id ? `Post on X (${id})` : "Post on X";
      author = "@x";
      durationSec = 90;
    } else {
      title = parsed.hostname.replace(/^www\./, "");
      author = "Web Media";
      durationSec = 120;
    }
  } catch {
    // fallback defaults
  }

  const thumb = platform === "youtube" ? stillFilm : platform === "instagram" ? coverAlbum : coverDoc;
  return {
    url,
    platform,
    title,
    author,
    thumbnail: thumb,
    durationSec,
    formats: buildFormats(durationSec),
    demo: false,
  };
}


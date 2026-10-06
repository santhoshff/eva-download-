import { Innertube, ClientType, Platform } from "youtubei.js";
import { spawn } from "node:child_process";

// Enable JavaScript evaluator on Platform shim so signature ciphers can be deciphered if needed
if (typeof Platform !== "undefined" && Platform?.shim) {
  try {
    Platform.shim.eval = (data: any, env: any) => {
      const code = typeof data === "string" ? data : data?.output || "";
      const fn = new Function(...Object.keys(env || {}), code);
      return fn(...Object.values(env || {}));
    };
  } catch (e) {
    console.warn("[Platform.shim.eval] Could not set custom evaluator:", e);
  }
}

export interface PoTokenResult {
  poToken: string;
  visitorData?: string | undefined;
}

// In-memory cache for PoToken
let cachedPoToken: { data: PoTokenResult; expiresAt: number } | null = null;

export async function resolvePoToken(): Promise<PoTokenResult | null> {
  if (cachedPoToken && cachedPoToken.expiresAt > Date.now()) {
    return cachedPoToken.data;
  }

  const envPoToken =
    typeof process !== "undefined"
      ? process.env?.["YOUTUBE_PO_TOKEN"] || process.env?.["YT_PO_TOKEN"]
      : undefined;
  const envVisitorData =
    typeof process !== "undefined"
      ? process.env?.["YOUTUBE_VISITOR_DATA"] || process.env?.["YT_VISITOR_DATA"]
      : undefined;

  if (envPoToken) {
    const result: PoTokenResult = {
      poToken: envPoToken.trim(),
      visitorData: envVisitorData?.trim(),
    };
    cachedPoToken = { data: result, expiresAt: Date.now() + 6 * 3600 * 1000 };
    return result;
  }

  const potProviderUrl =
    typeof process !== "undefined"
      ? process.env?.["POT_PROVIDER_URL"] || process.env?.["PO_TOKEN_SERVER_URL"]
      : undefined;

  if (potProviderUrl) {
    try {
      const res = await fetch(potProviderUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const poToken = json?.poToken || json?.po_token || json?.token;
        const visitorData = json?.visitorData || json?.visitor_data;
        if (poToken) {
          const result: PoTokenResult = { poToken, visitorData };
          cachedPoToken = { data: result, expiresAt: Date.now() + 6 * 3600 * 1000 };
          return result;
        }
      }
    } catch (err) {
      console.warn("[PoToken] Failed to reach remote PoToken provider:", err);
    }
  }

  return null;
}

// Cached Innertube clients for Android (progressive video with sound) and iOS (HQ audio & HD video)
let androidClientInstance: Innertube | null = null;
let androidClientPromise: Promise<Innertube> | null = null;

let iosClientInstance: Innertube | null = null;
let iosClientPromise: Promise<Innertube> | null = null;

export async function getAndroidInnertube(): Promise<Innertube> {
  if (androidClientInstance) return androidClientInstance;
  if (!androidClientPromise) {
    androidClientPromise = Innertube.create({ client_type: ClientType.ANDROID })
      .then((yt) => {
        androidClientInstance = yt;
        return yt;
      })
      .catch((err) => {
        androidClientPromise = null;
        console.error("[YouTube Android Innertube Error]:", err);
        throw err;
      });
  }
  return androidClientPromise;
}

export async function getIOSInnertube(): Promise<Innertube> {
  if (iosClientInstance) return iosClientInstance;
  if (!iosClientPromise) {
    iosClientPromise = Innertube.create({ client_type: ClientType.IOS })
      .then((yt) => {
        iosClientInstance = yt;
        return yt;
      })
      .catch((err) => {
        iosClientPromise = null;
        console.error("[YouTube iOS Innertube Error]:", err);
        throw err;
      });
  }
  return iosClientPromise;
}

export async function getInnertube(): Promise<Innertube> {
  return getAndroidInnertube();
}

export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1).split("?")[0]?.split("/")[0] || null;
    }
    if (parsed.pathname.includes("/shorts/")) {
      return parsed.pathname.split("/shorts/")[1]?.split("?")[0]?.split("/")[0] || null;
    }
    if (parsed.pathname.includes("/embed/")) {
      return parsed.pathname.split("/embed/")[1]?.split("?")[0]?.split("/")[0] || null;
    }
    if (parsed.pathname.includes("/live/")) {
      return parsed.pathname.split("/live/")[1]?.split("?")[0]?.split("/")[0] || null;
    }
    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v");
    }
  } catch {}
  const match = url.match(/(?:youtu\.be\/|watch\?v=|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/i);
  return match && match[1] ? match[1] : null;
}

export interface YouTubeFormat {
  id: string;
  kind: "video" | "audio";
  label: string;
  sizeBytes?: number | undefined;
  ext: string;
  directUrl?: string | undefined;
}

export interface YouTubeMedia {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSec: number;
  formats: YouTubeFormat[];
  directVideoUrl?: string | undefined;
  directAudioUrl?: string | undefined;
}

/**
 * Fallback to python yt-dlp if installed on the host
 */
async function extractViaLocalYtDlp(url: string, videoId: string): Promise<YouTubeMedia | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn("python", [
        "-m",
        "yt_dlp",
        "--js-runtimes",
        "node:node",
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        url,
      ]);

      let stdout = "";
      child.stdout.on("data", (c) => {
        stdout += c.toString();
      });

      child.on("close", (code) => {
        if (code !== 0 || !stdout) {
          return resolve(null);
        }
        try {
          const raw = JSON.parse(stdout);
          const title = raw.title || "YouTube Video";
          const author = raw.uploader || raw.channel || "YouTube Creator";
          const durationSec = Math.round(Number(raw.duration) || 180);
          const thumbnail =
            raw.thumbnail ||
            (Array.isArray(raw.thumbnails) && raw.thumbnails[raw.thumbnails.length - 1]?.url) ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

          const rawFormats: any[] = Array.isArray(raw.formats) ? raw.formats : [];
          const formats: YouTubeFormat[] = [];
          const seen = new Set<string>();

          // Progressive formats first
          for (const f of rawFormats.filter((f) => f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none" && f.url)) {
            const h = f.height || 360;
            const label = `${h}p (MP4 Video)`;
            if (!seen.has(label)) {
              seen.add(label);
              formats.push({
                id: `yt-ytdlp-${f.format_id}`,
                kind: "video",
                label,
                sizeBytes: f.filesize || f.filesize_approx,
                ext: "mp4",
                directUrl: f.url,
              });
            }
          }

          // Audio formats
          for (const f of rawFormats.filter((f) => (!f.vcodec || f.vcodec === "none") && f.url)) {
            const label = "HQ Audio (M4A · 128 kbps)";
            if (!seen.has("audio")) {
              seen.add("audio");
              formats.push({
                id: `yt-ytdlp-audio-${f.format_id}`,
                kind: "audio",
                label,
                sizeBytes: f.filesize || f.filesize_approx,
                ext: "m4a",
                directUrl: f.url,
              });
            }
          }

          if (formats.length > 0) {
            return resolve({
              id: videoId,
              title,
              author,
              thumbnail,
              durationSec,
              formats,
              directVideoUrl: formats.find((f) => f.kind === "video")?.directUrl,
              directAudioUrl: formats.find((f) => f.kind === "audio")?.directUrl,
            });
          }
        } catch {
          // ignore parse error
        }
        resolve(null);
      });

      child.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export async function extractYouTube(url: string): Promise<YouTubeMedia | null> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    console.warn("[YouTube] Could not extract video ID from URL:", url);
    return null;
  }

  // 1. Primary: Dual-Client Innertube Extraction (Android for progressive video with sound, iOS for HQ Audio and HD video)
  try {
    const [androidYt, iosYt] = await Promise.all([
      getAndroidInnertube().catch((e) => {
        console.warn("[YouTube Android Client Init Error]:", e);
        return null;
      }),
      getIOSInnertube().catch((e) => {
        console.warn("[YouTube iOS Client Init Error]:", e);
        return null;
      }),
    ]);

    const [androidInfo, iosInfo] = await Promise.all([
      androidYt ? androidYt.getBasicInfo(videoId).catch((e) => {
        console.warn("[YouTube Android getBasicInfo Error]:", e?.message || e);
        return null;
      }) : null,
      iosYt ? iosYt.getBasicInfo(videoId).catch((e) => {
        console.warn("[YouTube iOS getBasicInfo Error]:", e?.message || e);
        return null;
      }) : null,
    ]);

    if (androidInfo || iosInfo) {
      const basic = androidInfo?.basic_info || iosInfo?.basic_info;
      const title = basic?.title || "YouTube Video";
      const author = basic?.author || "YouTube Creator";
      const durationSec = Number(basic?.duration) || 180;

      const thumbs = basic?.thumbnail || [];
      const thumbnail =
        thumbs[thumbs.length - 1]?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const formats: YouTubeFormat[] = [];
      const seenLabels = new Set<string>();

      // A. Progressive video formats from Android (contain BOTH video and audio in single MP4)
      const androidProg = androidInfo?.streaming_data?.formats || [];
      for (const f of androidProg) {
        if (f.url) {
          const height = f.height || (f.quality_label ? parseInt(f.quality_label, 10) : 360);
          const label = f.quality_label || `${height}p`;
          const displayLabel = `${label} (MP4 Video)`;
          seenLabels.add(label);
          formats.push({
            id: `yt-prog-${f.itag || label}`,
            kind: "video",
            label: displayLabel,
            sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 12 * 1024 * 1024),
            ext: "mp4",
            directUrl: f.url,
          });
        }
      }

      // B. Adaptive HD video formats from iOS (1080p, 720p, etc.)
      const iosAdaptive = iosInfo?.streaming_data?.adaptive_formats || [];
      for (const f of iosAdaptive.filter((a: any) => a?.has_video && !a?.has_audio)) {
        if (f.url) {
          const height = f.height || (f.quality_label ? parseInt(f.quality_label, 10) : 0);
          const label = f.quality_label || (height ? `${height}p` : "HD Video");
          if (!seenLabels.has(label) && (height >= 720 || formats.length === 0)) {
            seenLabels.add(label);
            formats.push({
              id: `yt-hd-${f.itag || label}`,
              kind: "video",
              label: `${label} (HD Video)`,
              sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 20 * 1024 * 1024),
              ext: "mp4",
              directUrl: f.url,
            });
          }
        }
      }

      // C. Audio formats from iOS (clean unblocked AAC direct streams)
      const iosAudios = iosAdaptive.filter((a: any) => a?.has_audio && !a?.has_video);
      for (const af of iosAudios) {
        if (af.url) {
          const isHigh = (af.bitrate || 0) > 80000;
          formats.push({
            id: `yt-audio-${af.itag}`,
            kind: "audio",
            label: isHigh ? "HQ Audio (M4A · 128 kbps)" : "Audio (M4A · 48 kbps)",
            sizeBytes: Number(af.content_length) || Math.round((durationSec / 60) * 1.5 * 1024 * 1024),
            ext: "m4a",
            directUrl: af.url,
          });
          if (isHigh) break;
        }
      }

      // D. Fallback audio from progressive stream if no separate audio format was returned
      const hasAudio = formats.some((f) => f.kind === "audio");
      if (!hasAudio && formats[0]?.directUrl) {
        formats.push({
          id: "yt-audio-prog",
          kind: "audio",
          label: "Original Audio (M4A)",
          sizeBytes: Math.round((durationSec / 60) * 1.5 * 1024 * 1024),
          ext: "m4a",
          directUrl: formats[0].directUrl,
        });
      }

      const directVideoUrl = formats.find((f) => f.kind === "video")?.directUrl;
      const directAudioUrl = formats.find((f) => f.kind === "audio")?.directUrl;

      if (formats.length > 0) {
        console.log(`[YouTube Extraction] Successfully extracted ${formats.length} formats for ${videoId} ("${title}")`);
        return {
          id: videoId,
          title,
          author,
          thumbnail,
          durationSec,
          formats,
          directVideoUrl,
          directAudioUrl,
        };
      }
    }
  } catch (err) {
    console.error("[YouTube Extraction Error] Innertube combined extraction failed:", err);
  }

  // 2. Secondary fallback: Local python yt-dlp if available
  try {
    console.log(`[YouTube Extraction] Trying local yt-dlp fallback for ${videoId}...`);
    const ytdlpResult = await extractViaLocalYtDlp(url, videoId);
    if (ytdlpResult && ytdlpResult.formats.length > 0) {
      console.log(`[YouTube Extraction] Local yt-dlp fallback succeeded for ${videoId}`);
      return ytdlpResult;
    }
  } catch (err) {
    console.warn("[YouTube Extraction Error] yt-dlp fallback error:", err);
  }

  // 3. Fallback: YouTube oEmbed metadata (metadata only)
  try {
    console.log(`[YouTube Extraction] Trying oEmbed fallback for metadata (${videoId})...`);
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (res.ok) {
      const oembed = (await res.json()) as any;
      console.log(`[YouTube Extraction] oEmbed metadata obtained for ${videoId}: "${oembed?.title}"`);
      return {
        id: videoId,
        title: (oembed?.title as string) || "YouTube Video",
        author: (oembed?.author_name as string) || "YouTube Creator",
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSec: 180,
        formats: [
          { id: "yt-360p", kind: "video", label: "360p (MP4 Video)", sizeBytes: 15 * 1024 * 1024, ext: "mp4" },
          { id: "yt-audio", kind: "audio", label: "Original Audio (M4A)", sizeBytes: 3 * 1024 * 1024, ext: "m4a" },
        ],
      };
    }
  } catch (err) {
    console.warn("[YouTube Extraction Error] oEmbed fallback error:", err);
  }

  return null;
}

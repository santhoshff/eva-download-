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

// Cached Innertube clients for Android (progressive video with sound), iOS (HQ audio & HD video), and TV (bot-check bypass)
let androidClientInstance: Innertube | null = null;
let androidClientPromise: Promise<Innertube> | null = null;

let iosClientInstance: Innertube | null = null;
let iosClientPromise: Promise<Innertube> | null = null;

let tvClientInstance: Innertube | null = null;
let tvClientPromise: Promise<Innertube> | null = null;

function buildSessionOptions(client_type: ClientType, pot: PoTokenResult | null) {
  const opts: {
    client_type: ClientType;
    generate_session_locally: boolean;
    po_token?: string;
    visitor_data?: string;
  } = {
    client_type,
    generate_session_locally: true,
  };
  if (pot?.poToken) opts.po_token = pot.poToken;
  if (pot?.visitorData) opts.visitor_data = pot.visitorData;
  return opts;
}

export async function getAndroidInnertube(): Promise<Innertube> {
  if (androidClientInstance) return androidClientInstance;
  if (!androidClientPromise) {
    const pot = await resolvePoToken().catch(() => null);
    androidClientPromise = Innertube.create(buildSessionOptions(ClientType.ANDROID, pot))
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
    const pot = await resolvePoToken().catch(() => null);
    iosClientPromise = Innertube.create(buildSessionOptions(ClientType.IOS, pot))
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

export async function getTvInnertube(): Promise<Innertube> {
  if (tvClientInstance) return tvClientInstance;
  if (!tvClientPromise) {
    const pot = await resolvePoToken().catch(() => null);
    tvClientPromise = Innertube.create(buildSessionOptions(ClientType.TV_EMBEDDED, pot))
      .then((yt) => {
        tvClientInstance = yt;
        return yt;
      })
      .catch((err) => {
        tvClientPromise = null;
        console.warn("[YouTube TV Innertube Error]:", err);
        throw err;
      });
  }
  return tvClientPromise;
}

export async function getInnertube(): Promise<Innertube> {
  return getTvInnertube().catch(() => getAndroidInnertube());
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
  const match = url.match(/(?:youtu\.be\/|watch\?v=|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{6,12})/i);
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

/** Decipher format URL if encrypted signature cipher is present */
async function decipherFormatUrl(f: any, player: any): Promise<string | undefined> {
  if (typeof f?.url === "string" && f.url.startsWith("http")) {
    return f.url;
  }
  if (typeof f?.decipher === "function" && player) {
    try {
      const url = await f.decipher(player);
      if (typeof url === "string" && url.startsWith("http")) {
        return url;
      }
    } catch (e) {
      // decipher failed
    }
  }
  return undefined;
}

/** Piped API instances */
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://api.piped.privacydev.net",
  "https://piped-api.lunar.icu",
  "https://pipedapi.leptons.xyz",
  "https://ytapi.bluss.me",
];

export async function extractViaPiped(videoId: string): Promise<YouTubeMedia | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      if (!data || !data.title) continue;

      const formats: YouTubeFormat[] = [];
      const seenLabels = new Set<string>();

      const videoStreams: any[] = Array.isArray(data.videoStreams) ? data.videoStreams : [];
      for (const vs of videoStreams) {
        if (!vs.url) continue;
        const quality = vs.quality || "720p";
        const label = `${quality} (${vs.format || "MP4 Video"})`;
        if (seenLabels.has(quality)) continue;
        seenLabels.add(quality);

        formats.push({
          id: `piped-${vs.itag || quality}`,
          kind: "video",
          label,
          sizeBytes: Number(vs.size) || undefined,
          ext: "mp4",
          directUrl: vs.url,
        });
        if (formats.length >= 3) break;
      }

      const audioStreams: any[] = Array.isArray(data.audioStreams) ? data.audioStreams : [];
      for (const as of audioStreams) {
        if (!as.url) continue;
        const label = `Audio (${as.quality || as.format || "M4A"})`;
        if (seenLabels.has("audio")) continue;
        seenLabels.add("audio");

        formats.push({
          id: `piped-audio-${as.itag || "default"}`,
          kind: "audio",
          label,
          sizeBytes: Number(as.size) || undefined,
          ext: as.format?.toLowerCase() === "opus" ? "opus" : "m4a",
          directUrl: as.url,
        });
        break;
      }

      if (formats.length > 0) {
        console.log(`[YouTube Extraction] Piped (${instance}) succeeded for ${videoId}`);
        return {
          id: videoId,
          title: data.title || "YouTube Video",
          author: data.uploader || "YouTube Creator",
          thumbnail: data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          durationSec: Number(data.duration) || 180,
          formats,
          directVideoUrl: formats.find((f) => f.kind === "video")?.directUrl,
          directAudioUrl: formats.find((f) => f.kind === "audio")?.directUrl,
        };
      }
    } catch {
      // try next instance
    }
  }
  return null;
}

/** Invidious API instances */
const INVIDIOUS_INSTANCES = [
  "https://invidious.privacydev.net",
  "https://iv.melmac.space",
  "https://invidious.protokolla.fi",
  "https://inv.tux.pizza",
  "https://invidious.drgns.space",
];

export async function extractViaInvidious(videoId: string): Promise<YouTubeMedia | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      if (!data || !data.title) continue;

      const formats: YouTubeFormat[] = [];
      const seenLabels = new Set<string>();

      const formatStreams: any[] = Array.isArray(data.formatStreams) ? data.formatStreams : [];
      for (const fs of formatStreams) {
        if (!fs.url) continue;
        const resLabel = fs.resolution || fs.quality || "720p";
        const label = `${resLabel} (MP4 Video)`;
        if (seenLabels.has(resLabel)) continue;
        seenLabels.add(resLabel);

        formats.push({
          id: `invidious-${fs.itag || resLabel}`,
          kind: "video",
          label,
          sizeBytes: Number(fs.size) || undefined,
          ext: "mp4",
          directUrl: fs.url,
        });
      }

      const adaptiveFormats: any[] = Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [];
      for (const af of adaptiveFormats.filter((a: any) => a.type?.includes("audio") && a.url)) {
        const label = "HQ Audio (M4A)";
        if (!seenLabels.has("audio")) {
          seenLabels.add("audio");
          formats.push({
            id: `invidious-audio-${af.itag || "default"}`,
            kind: "audio",
            label,
            sizeBytes: Number(af.contentLength) || undefined,
            ext: "m4a",
            directUrl: af.url,
          });
        }
      }

      if (formats.length > 0) {
        console.log(`[YouTube Extraction] Invidious (${instance}) succeeded for ${videoId}`);
        return {
          id: videoId,
          title: data.title || "YouTube Video",
          author: data.author || "YouTube Creator",
          thumbnail:
            (Array.isArray(data.videoThumbnails) && data.videoThumbnails[0]?.url) ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          durationSec: Number(data.lengthSeconds) || 180,
          formats,
          directVideoUrl: formats.find((f) => f.kind === "video")?.directUrl,
          directAudioUrl: formats.find((f) => f.kind === "audio")?.directUrl,
        };
      }
    } catch {
      // try next instance
    }
  }
  return null;
}

/** Cobalt API instances */
const COBALT_INSTANCES = [
  "https://cobalt-api.kwiatekm.pl",
  "https://api.server.artemislena.eu",
  "https://cobalt-backend.canine.tools",
  "https://api.cobalt.tools",
];

export async function extractViaCobalt(url: string, videoId: string): Promise<YouTubeMedia | null> {
  for (const instance of COBALT_INSTANCES) {
    try {
      const res = await fetch(`${instance.replace(/\/$/, "")}/`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          url,
          videoQuality: "720",
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      const streamUrl = data?.url;
      if (streamUrl && typeof streamUrl === "string") {
        console.log(`[YouTube Extraction] Cobalt (${instance}) succeeded for ${videoId}`);
        return {
          id: videoId,
          title: data.filename?.replace(/\.[^/.]+$/, "") || "YouTube Video",
          author: "YouTube Creator",
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          durationSec: 180,
          formats: [
            {
              id: "cobalt-video",
              kind: "video",
              label: "HD Video (MP4)",
              ext: "mp4",
              directUrl: streamUrl,
            },
            {
              id: "cobalt-audio",
              kind: "audio",
              label: "Audio (MP3)",
              ext: "mp3",
              directUrl: streamUrl,
            },
          ],
          directVideoUrl: streamUrl,
          directAudioUrl: streamUrl,
        };
      }
    } catch {
      // try next instance
    }
  }
  return null;
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

  // 1. If self-hosted extractor microservice is configured, query it first
  const selfHostedExtractor = typeof process !== "undefined" ? process.env?.["EVA_EXTRACTOR_URL"] : undefined;
  if (selfHostedExtractor) {
    try {
      const res = await fetch(`${selfHostedExtractor.replace(/\/$/, "")}/info?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(6000),
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const info = (await res.json()) as any;
        if (info?.title && Array.isArray(info?.formats)) {
          console.log(`[YouTube Extraction] Dedicated extractor succeeded for ${videoId}`);
          const formats: YouTubeFormat[] = info.formats.map((f: any) => ({
            id: f.formatId || f.id || "best",
            kind: f.kind || (f.resolution?.includes("audio") ? "audio" : "video"),
            label: f.resolution || f.label || "MP4 Video",
            sizeBytes: f.filesize,
            ext: f.ext || "mp4",
            directUrl: `${selfHostedExtractor.replace(/\/$/, "")}/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(f.formatId || f.id || "best")}`,
          }));
          return {
            id: info.id || videoId,
            title: info.title,
            author: info.uploader || "YouTube Creator",
            thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            durationSec: Number(info.duration) || 180,
            formats,
            directVideoUrl: formats.find((f) => f.kind === "video")?.directUrl,
            directAudioUrl: formats.find((f) => f.kind === "audio")?.directUrl,
          };
        }
      }
    } catch (e) {
      console.warn("[YouTube Extraction] Dedicated extractor unreachable, continuing with fallbacks:", e);
    }
  }

  // 2. Primary: Multi-Client Innertube Extraction (TV_EMBEDDED + Android + iOS with deciphering)
  try {
    const [tvYt, androidYt, iosYt] = await Promise.all([
      getTvInnertube().catch(() => null),
      getAndroidInnertube().catch(() => null),
      getIOSInnertube().catch(() => null),
    ]);

    const [tvInfo, androidInfo, iosInfo] = await Promise.all([
      tvYt ? tvYt.getBasicInfo(videoId).catch(() => null) : null,
      androidYt ? androidYt.getBasicInfo(videoId).catch(() => null) : null,
      iosYt ? iosYt.getBasicInfo(videoId).catch(() => null) : null,
    ]);

    const activeInfo = tvInfo || androidInfo || iosInfo;
    const activeYt = tvInfo ? tvYt : androidInfo ? androidYt : iosYt;

    if (activeInfo && activeYt) {
      const basic = activeInfo.basic_info;
      const title = basic?.title || "YouTube Video";
      const author = basic?.author || "YouTube Creator";
      const durationSec = Number(basic?.duration) || 180;

      const thumbs = basic?.thumbnail || [];
      const thumbnail =
        thumbs[thumbs.length - 1]?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const formats: YouTubeFormat[] = [];
      const seenLabels = new Set<string>();

      // Progressive video formats (contains BOTH video and audio)
      const progFormats = [
        ...(tvInfo?.streaming_data?.formats || []),
        ...(androidInfo?.streaming_data?.formats || []),
      ];

      for (const f of progFormats) {
        const directUrl = await decipherFormatUrl(f, activeYt.session?.player);
        if (directUrl) {
          const height = f.height || (f.quality_label ? parseInt(f.quality_label, 10) : 360);
          const label = f.quality_label || `${height}p`;
          const displayLabel = `${label} (MP4 Video)`;
          if (!seenLabels.has(label)) {
            seenLabels.add(label);
            formats.push({
              id: `yt-prog-${f.itag || label}`,
              kind: "video",
              label: displayLabel,
              sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 12 * 1024 * 1024),
              ext: "mp4",
              directUrl,
            });
          }
        }
      }

      // Adaptive HD video formats (1080p, 720p)
      const adaptiveVideo = [
        ...(iosInfo?.streaming_data?.adaptive_formats || []),
        ...(tvInfo?.streaming_data?.adaptive_formats || []),
      ].filter((a: any) => a?.has_video && !a?.has_audio);

      for (const f of adaptiveVideo) {
        const directUrl = await decipherFormatUrl(f, activeYt.session?.player);
        if (directUrl) {
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
              directUrl,
            });
          }
        }
      }

      // Audio formats
      const adaptiveAudio = [
        ...(iosInfo?.streaming_data?.adaptive_formats || []),
        ...(androidInfo?.streaming_data?.adaptive_formats || []),
        ...(tvInfo?.streaming_data?.adaptive_formats || []),
      ].filter((a: any) => a?.has_audio && !a?.has_video);

      for (const af of adaptiveAudio) {
        const directUrl = await decipherFormatUrl(af, activeYt.session?.player);
        if (directUrl) {
          const isHigh = (af.bitrate || 0) > 80000;
          formats.push({
            id: `yt-audio-${af.itag}`,
            kind: "audio",
            label: isHigh ? "HQ Audio (M4A · 128 kbps)" : "Audio (M4A · 48 kbps)",
            sizeBytes: Number(af.content_length) || Math.round((durationSec / 60) * 1.5 * 1024 * 1024),
            ext: "m4a",
            directUrl,
          });
          if (isHigh) break;
        }
      }

      // Fallback audio from progressive stream if needed
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

      if (formats.some((f) => f.directUrl)) {
        console.log(`[YouTube Extraction] Innertube multi-client succeeded: ${formats.length} formats for ${videoId}`);
        return {
          id: videoId,
          title,
          author,
          thumbnail,
          durationSec,
          formats,
          directVideoUrl: formats.find((f) => f.kind === "video")?.directUrl,
          directAudioUrl: formats.find((f) => f.kind === "audio")?.directUrl,
        };
      }
    }
  } catch (err) {
    console.warn("[YouTube Extraction] Innertube extraction warning:", err);
  }

  // 3. Fallback: Piped API multi-instance network
  try {
    console.log(`[YouTube Extraction] Trying Piped fallback for ${videoId}...`);
    const pipedResult = await extractViaPiped(videoId);
    if (pipedResult && pipedResult.formats.some((f) => f.directUrl)) {
      return pipedResult;
    }
  } catch (err) {
    console.warn("[YouTube Extraction] Piped fallback error:", err);
  }

  // 4. Fallback: Invidious API multi-instance network
  try {
    console.log(`[YouTube Extraction] Trying Invidious fallback for ${videoId}...`);
    const invidiousResult = await extractViaInvidious(videoId);
    if (invidiousResult && invidiousResult.formats.some((f) => f.directUrl)) {
      return invidiousResult;
    }
  } catch (err) {
    console.warn("[YouTube Extraction] Invidious fallback error:", err);
  }

  // 5. Fallback: Cobalt API network
  try {
    console.log(`[YouTube Extraction] Trying Cobalt fallback for ${videoId}...`);
    const cobaltResult = await extractViaCobalt(url, videoId);
    if (cobaltResult && cobaltResult.formats.some((f) => f.directUrl)) {
      return cobaltResult;
    }
  } catch (err) {
    console.warn("[YouTube Extraction] Cobalt fallback error:", err);
  }

  // 6. Fallback: Local python yt-dlp if available
  try {
    console.log(`[YouTube Extraction] Trying local yt-dlp fallback for ${videoId}...`);
    const ytdlpResult = await extractViaLocalYtDlp(url, videoId);
    if (ytdlpResult && ytdlpResult.formats.length > 0) {
      return ytdlpResult;
    }
  } catch (err) {
    console.warn("[YouTube Extraction] Local yt-dlp fallback error:", err);
  }

  // 7. Last resort: YouTube oEmbed metadata
  try {
    console.log(`[YouTube Extraction] Trying oEmbed fallback for metadata (${videoId})...`);
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (res.ok) {
      const oembed = (await res.json()) as any;
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
    console.warn("[YouTube Extraction] oEmbed fallback error:", err);
  }

  return null;
}


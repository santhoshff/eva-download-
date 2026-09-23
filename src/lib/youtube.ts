import { Innertube, ClientType, Platform } from "youtubei.js";

// Enable JavaScript evaluator on Platform shim so signature ciphers can be deciphered
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

// In-memory cache for PoToken to avoid expensive regeneration
let cachedPoToken: { data: PoTokenResult; expiresAt: number } | null = null;

/**
 * Resolves a Proof-of-Origin (PoToken) and visitor data from:
 * 1. Environment variables (YOUTUBE_PO_TOKEN / YT_PO_TOKEN)
 * 2. Remote PoToken provider service (POT_PROVIDER_URL / PO_TOKEN_SERVER_URL)
 * 3. Dynamic bgutils-js integration if installed
 */
export async function resolvePoToken(): Promise<PoTokenResult | null> {
  // Check in-memory cache first (valid for 6 hours)
  if (cachedPoToken && cachedPoToken.expiresAt > Date.now()) {
    return cachedPoToken.data;
  }

  // 1. Static tokens from environment variables
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
    console.log("[PoToken] Loaded static PoToken from environment variables");
    return result;
  }

  // 2. Query remote PoToken provider service if configured
  const potProviderUrl =
    typeof process !== "undefined"
      ? process.env?.["POT_PROVIDER_URL"] || process.env?.["PO_TOKEN_SERVER_URL"]
      : undefined;

  if (potProviderUrl) {
    try {
      console.log(`[PoToken] Fetching token from provider: ${potProviderUrl}`);
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
          console.log("[PoToken] Successfully obtained token from remote provider");
          return result;
        }
      } else {
        console.warn(`[PoToken] Remote provider returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("[PoToken] Failed to reach remote PoToken provider:", err);
    }
  }

  // 3. Dynamic bgutils-js generator (optional module for VPS / self-hosted environments)
  try {
    // @ts-ignore
    const bgUtils = (await import(/* @vite-ignore */ "bgutils-js").catch(() => null)) as any;
    if (bgUtils?.BG) {
      console.log("[PoToken] Generating token via local bgutils-js");
      // @ts-ignore
      const JSDOM = (await import(/* @vite-ignore */ "jsdom").catch(() => null)) as any;
      if (JSDOM?.JSDOM) {
        const dom = new JSDOM.JSDOM();
        Object.assign(globalThis, { window: dom.window, document: dom.window.document });
      }

      const tempYt = await Innertube.create({ retrieve_player: false });
      const visitorData = tempYt.session.context.client.visitorData;
      const requestKey = "O43z0dpjhgX20SCx4KAo";

      const bgConfig = {
        fetch,
        globalObj: globalThis,
        identifier: visitorData,
        requestKey,
      };

      const bgChallenge = await bgUtils.BG.Challenge.create(bgConfig);
      if (bgChallenge?.interpreterJavascript) {
        new Function(bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue)();
      }

      const poResult = await bgUtils.BG.PoToken.generate({
        program: bgChallenge.program,
        globalName: bgChallenge.globalName,
        bgConfig,
      });

      if (poResult?.poToken) {
        const result: PoTokenResult = { poToken: poResult.poToken, visitorData };
        cachedPoToken = { data: result, expiresAt: Date.now() + 6 * 3600 * 1000 };
        console.log("[PoToken] Generated PoToken successfully via bgutils-js");
        return result;
      }
    }
  } catch (err) {
    console.warn("[PoToken] Dynamic bgutils-js generation failed or unsupported:", err);
  }

  return null;
}

let innertubeInstance: Innertube | null = null;
let innertubePromise: Promise<Innertube> | null = null;

export async function getInnertube(): Promise<Innertube> {
  if (innertubeInstance) return innertubeInstance;
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const pot = await resolvePoToken().catch(() => null);

      const clientTypeEnv =
        typeof process !== "undefined"
          ? process.env?.["YOUTUBE_CLIENT_TYPE"]
          : undefined;

      const sessionOptions: any = {};

      if (clientTypeEnv) {
        sessionOptions.client_type =
          clientTypeEnv === "ANDROID"
            ? ClientType.ANDROID
            : clientTypeEnv === "IOS"
              ? ClientType.IOS
              : clientTypeEnv === "TV"
                ? ClientType.TV
                : ClientType.WEB;
      }

      if (pot?.poToken) {
        sessionOptions.po_token = pot.poToken;
        if (pot.visitorData) {
          sessionOptions.visitor_data = pot.visitorData;
        }
      }

      console.log("[YouTube Innertube] Initializing client session:", {
        client_type: sessionOptions.client_type || "DEFAULT (WEB)",
        has_po_token: !!sessionOptions.po_token,
        has_visitor_data: !!sessionOptions.visitor_data,
      });

      const yt = await Innertube.create(sessionOptions);
      innertubeInstance = yt;
      return yt;
    })().catch((err) => {
      innertubePromise = null;
      console.error("[YouTube Innertube] Failed to create Innertube instance:", err);
      throw err;
    });
  }
  return innertubePromise;
}

export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1).split("?")[0] || null;
    }
    if (parsed.pathname.includes("/shorts/")) {
      return parsed.pathname.split("/shorts/")[1]?.split("?")[0] || null;
    }
    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v");
    }
  } catch {}
  const match = url.match(/(?:youtu\.be\/|watch\?v=|shorts\/)([a-zA-Z0-9_-]{11})/i);
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

export async function extractYouTube(url: string): Promise<YouTubeMedia | null> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    console.warn("[YouTube] Could not extract video ID from URL:", url);
    return null;
  }

  // 1. Try Innertube Client
  try {
    const yt = await getInnertube();
    console.log(`[YouTube Extraction] Requesting basic info for ${videoId}...`);
    const basic = await yt.getBasicInfo(videoId);

    const title = basic.basic_info?.title || "YouTube Video";
    const author = basic.basic_info?.author || "YouTube Channel";
    const durationSec = Number(basic.basic_info?.duration) || 180;

    const thumbs = basic.basic_info?.thumbnail || [];
    const thumbnail =
      thumbs[thumbs.length - 1]?.url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const formats: YouTubeFormat[] = [];
    const seenLabels = new Set<string>();

    const progFormats = basic.streaming_data?.formats || [];
    const adaptiveFormats = basic.streaming_data?.adaptive_formats || [];

    // Progressive combined formats (Video + Audio in single MP4 file)
    for (const f of progFormats) {
      let directUrl = f.url;
      if (!directUrl && typeof f.decipher === "function") {
        try {
          directUrl = await f.decipher(yt.session.player);
        } catch (e) {
          console.warn("[YouTube Format Decipher Error]", e);
        }
      }
      if (directUrl) {
        const label = f.quality_label || (f.height ? `${f.height}p` : "HD Video");
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          formats.push({
            id: `yt-${f.itag || label}`,
            kind: "video",
            label,
            sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 12 * 1024 * 1024),
            ext: "mp4",
            directUrl,
          });
        }
      }
    }

    // Adaptive video formats if no progressive
    if (formats.length === 0) {
      for (const f of adaptiveFormats.filter((a: any) => a?.has_video)) {
        let directUrl = f.url;
        if (!directUrl && typeof f.decipher === "function") {
          try {
            directUrl = await f.decipher(yt.session.player);
          } catch (e) {}
        }
        if (directUrl) {
          const label = f.quality_label || (f.height ? `${f.height}p` : "Video");
          if (!seenLabels.has(label)) {
            seenLabels.add(label);
            formats.push({
              id: `yt-${f.itag || label}`,
              kind: "video",
              label,
              sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 15 * 1024 * 1024),
              ext: "mp4",
              directUrl,
            });
          }
          if (formats.length >= 3) break;
        }
      }
    }

    // Audio format
    let directAudioUrl: string | undefined;
    const audioFormats = adaptiveFormats.filter((a: any) => a?.has_audio && !a?.has_video);
    for (const af of audioFormats) {
      let directUrl = af.url;
      if (!directUrl && typeof af.decipher === "function") {
        try {
          directUrl = await af.decipher(yt.session.player);
        } catch (e) {}
      }
      if (directUrl) {
        directAudioUrl = directUrl;
        formats.push({
          id: "yt-audio",
          kind: "audio",
          label: "Audio (320 kbps)",
          sizeBytes: Number(af.content_length) || Math.round((durationSec / 60) * 2 * 1024 * 1024),
          ext: "mp3",
          directUrl,
        });
        break;
      }
    }

    if (!directAudioUrl && formats[0]?.directUrl) {
      directAudioUrl = formats[0].directUrl;
      formats.push({
        id: "yt-audio",
        kind: "audio",
        label: "Audio Track",
        sizeBytes: Math.round((durationSec / 60) * 2 * 1024 * 1024),
        ext: "mp3",
        directUrl: formats[0].directUrl,
      });
    }

    const directVideoUrl = formats.find((f) => f.kind === "video")?.directUrl;

    if (formats.length > 0) {
      console.log(`[YouTube Extraction] Successfully extracted ${formats.length} formats for ${videoId} (${title})`);
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
    } else {
      console.warn(`[YouTube Extraction] No streamable format URLs returned by Innertube for ${videoId}`);
    }
  } catch (err) {
    console.error("[YouTube Extraction Error] Innertube getBasicInfo failed:", err);
  }

  // 2. Fallback: YouTube oEmbed metadata (metadata only, no direct stream)
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
          { id: "yt-720p", kind: "video", label: "720p (HD)", sizeBytes: 25 * 1024 * 1024, ext: "mp4" },
          { id: "yt-360p", kind: "video", label: "360p (SD)", sizeBytes: 12 * 1024 * 1024, ext: "mp4" },
          { id: "yt-audio", kind: "audio", label: "Original Audio", sizeBytes: 3 * 1024 * 1024, ext: "mp3" },
        ],
      };
    }
  } catch (err) {
    console.warn("[YouTube Extraction Error] oEmbed fallback error:", err);
  }

  return null;
}



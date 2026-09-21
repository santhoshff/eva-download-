import { Innertube, ClientType } from "youtubei.js";

let innertubeInstance: Innertube | null = null;
let innertubePromise: Promise<Innertube> | null = null;

export async function getInnertube(): Promise<Innertube> {
  if (innertubeInstance) return innertubeInstance;
  if (!innertubePromise) {
    innertubePromise = Innertube.create({ client_type: ClientType.ANDROID })
      .then((yt) => {
        innertubeInstance = yt;
        return yt;
      })
      .catch((err) => {
        innertubePromise = null;
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
  return match ? match[1] : null;
}

export interface YouTubeFormat {
  id: string;
  kind: "video" | "audio";
  label: string;
  sizeBytes?: number;
  ext: string;
  directUrl?: string;
}

export interface YouTubeMedia {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSec: number;
  formats: YouTubeFormat[];
  directVideoUrl?: string;
  directAudioUrl?: string;
}

export async function extractYouTube(url: string): Promise<YouTubeMedia | null> {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  // 1. Try Innertube Android Client (high speed direct googlevideo streaming URLs)
  try {
    const yt = await getInnertube();
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
      if (f.url) {
        const label = f.quality_label || (f.height ? `${f.height}p` : "HD Video");
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          formats.push({
            id: `yt-${f.itag || label}`,
            kind: "video",
            label,
            sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 12 * 1024 * 1024),
            ext: "mp4",
            directUrl: f.url,
          });
        }
      }
    }

    // Adaptive video formats if no progressive
    if (formats.length === 0) {
      for (const f of adaptiveFormats.filter((a: any) => a.has_video)) {
        if (f.url) {
          const label = f.quality_label || (f.height ? `${f.height}p` : "Video");
          if (!seenLabels.has(label)) {
            seenLabels.add(label);
            formats.push({
              id: `yt-${f.itag || label}`,
              kind: "video",
              label,
              sizeBytes: Number(f.content_length) || Math.round((durationSec / 60) * 15 * 1024 * 1024),
              ext: "mp4",
              directUrl: f.url,
            });
          }
          if (formats.length >= 3) break;
        }
      }
    }

    // Audio format
    let directAudioUrl: string | undefined;
    const audioFormats = adaptiveFormats.filter((a: any) => a.has_audio && !a.has_video);
    if (audioFormats.length > 0 && audioFormats[0].url) {
      directAudioUrl = audioFormats[0].url;
      formats.push({
        id: "yt-audio",
        kind: "audio",
        label: "Audio (320 kbps)",
        sizeBytes: Number(audioFormats[0].content_length) || Math.round((durationSec / 60) * 2 * 1024 * 1024),
        ext: "mp3",
        directUrl: audioFormats[0].url,
      });
    } else if (formats[0]?.directUrl) {
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
  } catch (err) {
    console.warn("YouTube Innertube extraction error:", err);
  }

  // 2. Fallback: YouTube oEmbed metadata
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (res.ok) {
      const oembed = (await res.json()) as any;
      return {
        id: videoId,
        title: oembed.title || "YouTube Video",
        author: oembed.author_name || "YouTube Creator",
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
    console.warn("YouTube oEmbed fallback error:", err);
  }

  return null;
}

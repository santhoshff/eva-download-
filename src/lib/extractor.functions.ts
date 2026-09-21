import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatform, mockMediaInfo, type MediaFormat, type MediaInfo } from "./media";
import { extractInstagram } from "./instagram";

export const getExtractorStatus = createServerFn({ method: "GET" }).handler(async () => ({
  connected: true,
}));

async function extractTikTok(url: string): Promise<MediaInfo | null> {
  try {
    const res = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;

    const formats: MediaFormat[] = [];
    if (d.play) {
      formats.push({
        id: "tiktok-hd",
        kind: "video",
        label: "HD Video (No Watermark)",
        sizeBytes: d.size || 15 * 1024 * 1024,
        ext: "mp4",
        directUrl: d.play,
      });
    }
    if (d.wmplay) {
      formats.push({
        id: "tiktok-wm",
        kind: "video",
        label: "Standard Video",
        sizeBytes: d.wm_size || 10 * 1024 * 1024,
        ext: "mp4",
        directUrl: d.wmplay,
      });
    }
    if (d.music) {
      formats.push({
        id: "tiktok-audio",
        kind: "audio",
        label: "Original Audio",
        sizeBytes: 3 * 1024 * 1024,
        ext: "mp3",
        directUrl: d.music,
      });
    }

    return {
      url,
      platform: "tiktok",
      title: d.title || "TikTok Video",
      author: d.author?.nickname || d.author?.unique_id || "@tiktok",
      thumbnail: d.cover || d.origin_cover || "",
      durationSec: Math.round(Number(d.duration) || 30),
      formats,
      demo: false,
    };
  } catch (e) {
    console.warn("TikTok extraction error:", e);
    return null;
  }
}

async function extractYouTube(url: string): Promise<MediaInfo | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const oembed = (await res.json()) as any;

    let videoId = "";
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) {
        videoId = parsed.pathname.slice(1).split("?")[0];
      } else {
        videoId = parsed.searchParams.get("v") || "";
      }
    } catch {}

    const thumbnail = videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : oembed.thumbnail_url || "";

    const formats: MediaFormat[] = [
      { id: "1080p", kind: "video", label: "1080p (Full HD)", sizeBytes: 55 * 1024 * 1024, ext: "mp4" },
      { id: "720p", kind: "video", label: "720p (HD)", sizeBytes: 28 * 1024 * 1024, ext: "mp4" },
      { id: "480p", kind: "video", label: "480p (SD)", sizeBytes: 15 * 1024 * 1024, ext: "mp4" },
      { id: "audio-320", kind: "audio", label: "320 kbps (Audio)", sizeBytes: 6 * 1024 * 1024, ext: "mp3" },
      { id: "audio-128", kind: "audio", label: "128 kbps (Audio)", sizeBytes: 3 * 1024 * 1024, ext: "mp3" },
    ];

    return {
      url,
      platform: "youtube",
      title: oembed.title || "YouTube Video",
      author: oembed.author_name || "YouTube Creator",
      thumbnail,
      durationSec: 210,
      formats,
      demo: false,
    };
  } catch (e) {
    console.warn("YouTube oEmbed error:", e);
    return null;
  }
}

export const getMediaInfo = createServerFn({ method: "POST" })
  .validator((input: { url: string }) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }): Promise<MediaInfo> => {
    const platform = detectPlatform(data.url);

    // 1. If TikTok, use direct live extractor
    if (platform === "tiktok") {
      const tiktokData = await extractTikTok(data.url);
      if (tiktokData) return tiktokData;
    }

    // 2. If YouTube, use direct live metadata
    if (platform === "youtube") {
      const ytData = await extractYouTube(data.url);
      if (ytData) return ytData;
    }

    // 3. If Instagram, use direct live Polaris extractor
    if (platform === "instagram") {
      try {
        const instaData = await extractInstagram(data.url);
        if (instaData) {
          const formats: MediaFormat[] = [];
          if (instaData.videoVersions && instaData.videoVersions.length > 0) {
            for (let i = 0; i < instaData.videoVersions.length; i++) {
              const v = instaData.videoVersions[i];
              const label = v.height ? `${v.height}p` : i === 0 ? "1080p (HD)" : `${Math.max(480, 1080 - i * 360)}p`;
              formats.push({
                id: `insta-${v.height || i}`,
                kind: "video",
                label,
                sizeBytes: 15 * 1024 * 1024,
                ext: "mp4",
                directUrl: v.url,
              });
            }
          } else if (instaData.videoUrl) {
            formats.push({
              id: "insta-hd",
              kind: "video",
              label: "1080p (HD)",
              sizeBytes: 15 * 1024 * 1024,
              ext: "mp4",
              directUrl: instaData.videoUrl,
            });
          }

          if (formats.length === 0) {
            formats.push({
              id: "insta-1080",
              kind: "video",
              label: "1080p",
              sizeBytes: 15 * 1024 * 1024,
              ext: "mp4",
              directUrl: instaData.videoUrl,
            });
          }

          formats.push({
            id: "insta-audio",
            kind: "audio",
            label: "Original Audio",
            sizeBytes: 3 * 1024 * 1024,
            ext: "mp3",
            directUrl: instaData.videoUrl,
          });

          return {
            url: data.url,
            platform: "instagram",
            title: instaData.title,
            author: instaData.uploader,
            thumbnail: instaData.thumbnail,
            durationSec: instaData.duration || 30,
            formats,
            demo: false,
          };
        }
      } catch (err) {
        console.warn("Instagram extractor failed:", err);
      }
    }

    // 4. Check external microservice if configured
    const extractorUrl = typeof process !== "undefined" ? process.env?.["EVA_EXTRACTOR_URL"] : undefined;
    if (extractorUrl) {
      try {
        const res = await fetch(`${extractorUrl.replace(/\/$/, "")}/info?url=${encodeURIComponent(data.url)}`, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const parsed = (await res.json()) as {
            title: string;
            author?: string;
            thumbnail: string;
            duration: number;
            formats: Array<{ id: string; kind: "video" | "audio"; label: string; size?: number; ext: string; directUrl?: string }>;
          };
          return {
            url: data.url,
            platform,
            title: parsed.title,
            author: parsed.author,
            thumbnail: parsed.thumbnail,
            durationSec: parsed.duration,
            formats: parsed.formats.map((f) => ({
              id: f.id,
              kind: f.kind,
              label: f.label,
              sizeBytes: f.size,
              ext: f.ext,
              directUrl: f.directUrl,
            })),
            demo: false,
          };
        }
      } catch {
        // Fall back
      }
    }

    // 4. Try local yt-dlp if available
    try {
      const ytdlModule = (await import("yt-dlp-exec").catch(() => null)) as any;
      if (ytdlModule) {
        const ytdl = typeof ytdlModule === "function" ? ytdlModule : ytdlModule.default || ytdlModule;
        const raw = (await ytdl(data.url, {
          dumpSingleJson: true,
          noWarnings: true,
          preferFreeFormats: true,
        })) as any;

        if (raw && raw.title) {
          const title: string = raw.title;
          const author: string | undefined = raw.uploader || raw.channel || raw.creator || raw.uploader_id;
          const thumbnail: string =
            raw.thumbnail || (Array.isArray(raw.thumbnails) && raw.thumbnails[0]?.url) || "";
          const durationSec: number = Math.round(Number(raw.duration) || 0);

          const formats: MediaFormat[] = [];
          const seenLabels = new Set<string>();
          const rawFormats: any[] = Array.isArray(raw.formats) ? raw.formats : [];

          for (const f of rawFormats.filter((f) => f.vcodec && f.vcodec !== "none")) {
            const height = f.height || (f.resolution ? parseInt(f.resolution.split("x")[1] || "0", 10) : 0);
            const label = height ? `${height}p` : f.format_note || "Video";
            if (seenLabels.has(label)) continue;
            seenLabels.add(label);
            formats.push({
              id: String(f.format_id),
              kind: "video",
              label,
              sizeBytes: f.filesize || f.filesize_approx,
              ext: f.ext || "mp4",
              directUrl: typeof f.url === "string" ? f.url : undefined,
            });
            if (formats.length >= 4) break;
          }

          if (formats.length > 0) {
            return {
              url: data.url,
              platform,
              title,
              author,
              thumbnail,
              durationSec,
              formats,
              demo: false,
            };
          }
        }
      }
    } catch {
      // Local yt-dlp not available
    }

    // 5. Clean, dynamic fallback based on actual URL
    return mockMediaInfo(data.url);
  });

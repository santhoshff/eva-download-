import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatform, mockMediaInfo, type MediaFormat, type MediaInfo } from "./media";

export const getExtractorStatus = createServerFn({ method: "GET" }).handler(async () => ({
  connected: typeof process !== "undefined" && Boolean(process.env?.["EVA_EXTRACTOR_URL"]),
}));

export const getMediaInfo = createServerFn({ method: "POST" })
  .validator((input: { url: string }) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }): Promise<MediaInfo> => {
    const extractorUrl = typeof process !== "undefined" ? process.env?.["EVA_EXTRACTOR_URL"] : undefined;
    const base = extractorUrl;
    if (base) {
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/info?url=${encodeURIComponent(data.url)}`, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const parsed = (await res.json()) as {
            title: string;
            author?: string;
            thumbnail: string;
            duration: number;
            formats: Array<{ id: string; kind: "video" | "audio"; label: string; size?: number; ext: string }>;
          };
          return {
            url: data.url,
            platform: detectPlatform(data.url),
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
            })),
            demo: false,
          };
        }
      } catch {
        // Continue to local extractor
      }
    }

    try {
      const ytdlModule = (await import("yt-dlp-exec").catch(() => null)) as any;
      if (!ytdlModule) return mockMediaInfo(data.url);
      const ytdl = typeof ytdlModule === "function" ? ytdlModule : ytdlModule.default || ytdlModule;
      const raw = (await ytdl(data.url, {
        dumpSingleJson: true,
        noWarnings: true,
        preferFreeFormats: true,
      })) as any;

      const title: string = raw.title || "Untitled Media";
      const author: string | undefined = raw.uploader || raw.channel || raw.creator || raw.uploader_id;
      const thumbnail: string =
        raw.thumbnail || (Array.isArray(raw.thumbnails) && raw.thumbnails[0]?.url) || "";
      const durationSec: number = Math.round(Number(raw.duration) || 0);
      const platform = detectPlatform(data.url);

      const formats: MediaFormat[] = [];
      const seenVideoLabels = new Set<string>();
      const seenAudioLabels = new Set<string>();
      const rawFormats: any[] = Array.isArray(raw.formats) ? raw.formats : [];

      // 1. Process Video Formats
      const videoCandidates = rawFormats
        .filter((f) => f.vcodec && f.vcodec !== "none")
        .sort((a, b) => Number(b.height || b.tbr || 0) - Number(a.height || a.tbr || 0));

      for (const f of videoCandidates) {
        const height = f.height || (f.resolution ? parseInt(f.resolution.split("x")[1] || "0", 10) : 0);
        const label = height ? `${height}p` : f.format_note || "Video";
        if (seenVideoLabels.has(label)) continue;
        seenVideoLabels.add(label);

        const sizeBytes =
          f.filesize ||
          f.filesize_approx ||
          (f.tbr && durationSec ? Math.round(((f.tbr * 1024) / 8) * durationSec) : undefined);

        formats.push({
          id: String(f.format_id),
          kind: "video",
          label,
          sizeBytes,
          ext: f.ext || "mp4",
          directUrl: typeof f.url === "string" ? f.url : undefined,
        });

        if (formats.filter((x) => x.kind === "video").length >= 5) break;
      }

      if (!formats.some((x) => x.kind === "video") && raw.url) {
        formats.push({
          id: "best",
          kind: "video",
          label: "Best Quality",
          sizeBytes: raw.filesize || raw.filesize_approx,
          ext: raw.ext || "mp4",
          directUrl: raw.url,
        });
      }

      // 2. Process Audio Formats
      const audioCandidates = rawFormats
        .filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
        .sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0));

      for (const f of audioCandidates) {
        const abr = Math.round(Number(f.abr || f.tbr || 128));
        const label = `${abr} kbps`;
        if (seenAudioLabels.has(label)) continue;
        seenAudioLabels.add(label);

        const sizeBytes =
          f.filesize ||
          f.filesize_approx ||
          (durationSec ? Math.round(((abr * 1024) / 8) * durationSec) : undefined);

        formats.push({
          id: String(f.format_id),
          kind: "audio",
          label,
          sizeBytes,
          ext: f.ext === "m4a" || f.ext === "mp3" ? f.ext : "m4a",
          directUrl: typeof f.url === "string" ? f.url : undefined,
        });

        if (formats.filter((x) => x.kind === "audio").length >= 4) break;
      }

      if (formats.length === 0) {
        formats.push({
          id: "best",
          kind: "video",
          label: "Original",
          sizeBytes: undefined,
          ext: "mp4",
          directUrl: typeof raw.url === "string" ? raw.url : undefined,
        });
      }

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
    } catch (err) {
      console.error("Local yt-dlp extraction failed, falling back to mock:", err);
      return mockMediaInfo(data.url);
    }
  });


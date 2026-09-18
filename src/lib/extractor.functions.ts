import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatform, mockMediaInfo, type MediaFormat, type MediaInfo } from "./media";

/**
 * Self-hosted extractor contract (set EVA_EXTRACTOR_URL to enable):
 *   GET {base}/info?url=<encoded>      -> { title, author?, thumbnail, duration, formats: [{ id, kind, label, size?, ext }] }
 *   GET {base}/download?url=&format=   -> file stream (Content-Disposition + Content-Length)
 * Any non-2xx response body is shown to the user verbatim as the error reason.
 */

const remoteFormat = z.object({
  id: z.string(),
  kind: z.enum(["video", "audio"]),
  label: z.string(),
  size: z.number().optional(),
  ext: z.string().default("mp4"),
});

const remoteInfo = z.object({
  title: z.string(),
  author: z.string().optional(),
  thumbnail: z.string().url(),
  duration: z.number(),
  formats: z.array(remoteFormat).min(1),
});

export const getExtractorStatus = createServerFn({ method: "GET" }).handler(async () => ({
  connected: Boolean(process.env["EVA_EXTRACTOR_URL"]),
}));

export const getMediaInfo = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }): Promise<MediaInfo> => {
    const base = process.env["EVA_EXTRACTOR_URL"];
    if (!base) return mockMediaInfo(data.url);

    const res = await fetch(`${base.replace(/\/$/, "")}/info?url=${encodeURIComponent(data.url)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body.trim() || `Extractor returned ${res.status}`);
    }
    const parsed = remoteInfo.parse(await res.json());
    const formats: MediaFormat[] = parsed.formats.map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      sizeBytes: f.size,
      ext: f.ext,
    }));
    return {
      url: data.url,
      platform: detectPlatform(data.url),
      title: parsed.title,
      author: parsed.author,
      thumbnail: parsed.thumbnail,
      durationSec: parsed.duration,
      formats,
      demo: false,
    };
  });

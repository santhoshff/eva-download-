import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Readable } from "node:stream";

const query = z.object({
  url: z.string().url(),
  format: z.string().min(1),
  directUrl: z.string().url().optional().or(z.literal("")),
});

export const Route = createFileRoute("/api/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = Object.fromEntries(new URL(request.url).searchParams);
        const parsed = query.safeParse(params);
        if (!parsed.success) {
          return Response.json({ error: "Invalid request parameters" }, { status: 400 });
        }
        const { url, format, directUrl } = parsed.data;

        // 1. If self-hosted microservice is configured, query it
        const base = typeof process !== "undefined" ? process.env?.["EVA_EXTRACTOR_URL"] : undefined;
        if (base) {
          try {
            const upstream = await fetch(
              `${base.replace(/\/$/, "")}/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}`,
            );
            if (upstream.ok && upstream.body) {
              const headers = new Headers();
              for (const h of ["content-type", "content-length", "content-disposition"]) {
                const v = upstream.headers.get(h);
                if (v) headers.set(h, v);
              }
              headers.set("cache-control", "no-store");
              return new Response(upstream.body, { status: 200, headers });
            }
          } catch {
            // Fall back to built-in local extractor
          }
        }

        // 2. Direct URL streaming (ultra fast CDN transfer with real progress)
        if (directUrl && directUrl.startsWith("http")) {
          try {
            const upstream = await fetch(directUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "*/*",
                Referer: url,
              },
            });

            if (upstream.ok && upstream.body) {
              const headers = new Headers();
              const ct = upstream.headers.get("content-type");
              const cl = upstream.headers.get("content-length");
              if (ct) headers.set("content-type", ct);
              if (cl) headers.set("content-length", cl);
              headers.set("content-disposition", `attachment; filename="download"`);
              headers.set("cache-control", "no-store");
              return new Response(upstream.body, { status: 200, headers });
            }
          } catch (e) {
            console.warn("Direct CDN streaming failed, falling back to yt-dlp.exec:", e);
          }
        }

        // 3. Fallback: Check if TikTok or direct public provider
        if (url.includes("tiktok.com")) {
          try {
            const tkRes = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
            if (tkRes.ok) {
              const tkJson = (await tkRes.json()) as any;
              const isAudio = format.startsWith("a") || format.includes("audio");
              const tkUrl = isAudio ? tkJson.data?.music : tkJson.data?.play;
              if (tkUrl) {
                const streamRes = await fetch(tkUrl, {
                  headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
                });
                if (streamRes.ok && streamRes.body) {
                  const headers = new Headers();
                  headers.set("content-type", isAudio ? "audio/mp4" : "video/mp4");
                  headers.set("content-disposition", `attachment; filename="download.${isAudio ? "mp3" : "mp4"}"`);
                  headers.set("cache-control", "no-store");
                  return new Response(streamRes.body, { status: 200, headers });
                }
              }
            }
          } catch {
            // continue
          }
        }

        // 4. Fallback: yt-dlp process streaming directly
        try {
          const ytdlModule = (await import("yt-dlp-exec").catch(() => null)) as any;
          if (!ytdlModule) {
            return Response.json({ error: "Download service processing stream, please try direct link or retry." }, { status: 400 });
          }
          const ytdlExec = (ytdlModule.exec || ytdlModule.default?.exec || ytdlModule);
          const proc = ytdlExec(url, {
            format: format || "best",
            output: "-",
          });

          if (!proc.stdout) {
            return Response.json({ error: "Failed to open media stream" }, { status: 500 });
          }

          const webStream = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
          const headers = new Headers();
          const isAudio =
            format.startsWith("a") || format === "140" || format === "251" || format === "139";
          headers.set("content-type", isAudio ? "audio/mp4" : "video/mp4");
          headers.set("content-disposition", `attachment; filename="download.${isAudio ? "mp3" : "mp4"}"`);
          headers.set("cache-control", "no-store");

          return new Response(webStream, { status: 200, headers });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Download failed";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});


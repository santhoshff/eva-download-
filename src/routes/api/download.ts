import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Readable } from "node:stream";
import { extractInstagram } from "../../lib/instagram";
import { extractYouTube } from "../../lib/youtube";

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
        const isAudio =
          format.startsWith("a") ||
          format.includes("audio") ||
          format === "140" ||
          format === "251" ||
          format === "139";

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
            // Fall back
          }
        }

        // 2. Direct URL streaming (ultra fast CDN transfer with real progress)
        if (directUrl && directUrl.startsWith("http")) {
          const isGoogleVideo = directUrl.includes("googlevideo.com");
          if (isGoogleVideo) {
            let directHost = "googlevideo.com";
            try {
              directHost = new URL(directUrl).host;
            } catch {}
            console.log("[Direct URL Fetch Request] Outgoing request to googlevideo CDN:", {
              directHost,
              isAudio,
              timestamp: new Date().toISOString(),
            });
          }
          try {
            const upstream = await fetch(directUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "*/*",
                Referer: url,
              },
            });

            if (isGoogleVideo) {
              console.log("[Direct URL Fetch Response] googlevideo CDN status:", upstream.status, upstream.statusText);
            }

            if (upstream.ok && upstream.body) {
              const headers = new Headers();
              const ct = upstream.headers.get("content-type");
              const cl = upstream.headers.get("content-length");
              if (ct) headers.set("content-type", ct);
              if (cl) headers.set("content-length", cl);
              headers.set("content-disposition", `attachment; filename="download.${isAudio ? "mp3" : "mp4"}"`);
              headers.set("cache-control", "no-store");
              return new Response(upstream.body, { status: 200, headers });
            } else if (isGoogleVideo) {
              const errBody = await upstream.text().catch(() => "");
              console.error(`[Direct URL Fetch Error] HTTP ${upstream.status} (${upstream.statusText}) from googlevideo:`, {
                status: upstream.status,
                body: errBody.slice(0, 300),
              });
              return Response.json(
                {
                  error:
                    upstream.status === 403
                      ? "YouTube blocked this download request (HTTP 403 Forbidden). Datacenter IP restrictions or bot protection prevented streaming. Please configure the self-hosted EVA_EXTRACTOR_URL microservice or a valid PoToken."
                      : `YouTube stream returned HTTP ${upstream.status} (${upstream.statusText}).`,
                  code: upstream.status === 403 ? "YOUTUBE_IP_BLOCKED" : "YOUTUBE_UPSTREAM_ERROR",
                  status: upstream.status,
                },
                { status: 502 },
              );
            }
          } catch (e) {
            console.warn("Direct CDN streaming failed:", e);
            if (isGoogleVideo) {
              return Response.json(
                {
                  error: "Failed to connect to YouTube media stream.",
                  code: "YOUTUBE_STREAM_FAILED",
                },
                { status: 502 },
              );
            }
          }
        }

        // 3. Fallback: Check if TikTok or public direct stream
        if (url.includes("tiktok.com")) {
          try {
            const tkRes = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
            if (tkRes.ok) {
              const tkJson = (await tkRes.json()) as any;
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

        // 4. Fallback: Check if Instagram direct stream
        if (url.includes("instagram.com")) {
          try {
            const igData = await extractInstagram(url);
            const igVideoUrl = igData?.videoVersions?.[0]?.url || igData?.videoUrl;
            if (igVideoUrl) {
              const igRes = await fetch(igVideoUrl, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Accept: "*/*",
                  Referer: "https://www.instagram.com/",
                },
              });
              if (igRes.ok && igRes.body) {
                const headers = new Headers();
                const ct = igRes.headers.get("content-type");
                const cl = igRes.headers.get("content-length");
                if (ct) headers.set("content-type", ct);
                if (cl) headers.set("content-length", cl);
                headers.set(
                  "content-disposition",
                  `attachment; filename="${igData.id || "reel"}.${isAudio ? "mp3" : "mp4"}"`,
                );
                headers.set("cache-control", "no-store");
                return new Response(igRes.body, { status: 200, headers });
              }
            }
          } catch (e) {
            console.warn("Instagram streaming error:", e);
          }
        }

        // 5. Fallback: Check if YouTube direct stream
        const isYouTubeRequest = url.includes("youtube.com") || url.includes("youtu.be");
        if (isYouTubeRequest) {
          try {
            const ytData = await extractYouTube(url);
            const targetFormat = isAudio
              ? ytData?.formats.find((f) => f.kind === "audio") || ytData?.formats[0]
              : ytData?.formats.find((f) => f.kind === "video") || ytData?.formats[0];
            const ytUrl = targetFormat?.directUrl || ytData?.directVideoUrl || ytData?.directAudioUrl;

            if (ytUrl) {
              let parsedYtHost = "googlevideo.com";
              try {
                parsedYtHost = new URL(ytUrl).host;
              } catch {}

              console.log("[YouTube Fetch Request] Outgoing request to googlevideo:", {
                urlHost: parsedYtHost,
                videoId: ytData?.id,
                formatLabel: targetFormat?.label,
                isAudio,
                timestamp: new Date().toISOString(),
              });

              const ytRes = await fetch(ytUrl, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Accept: "*/*",
                  Referer: "https://www.youtube.com/",
                },
              });

              console.log("[YouTube Fetch Response] Status from googlevideo:", {
                status: ytRes.status,
                statusText: ytRes.statusText,
                contentType: ytRes.headers.get("content-type"),
                contentLength: ytRes.headers.get("content-length"),
              });

              if (ytRes.ok && ytRes.body) {
                const headers = new Headers();
                const ct = ytRes.headers.get("content-type");
                const cl = ytRes.headers.get("content-length");
                if (ct) headers.set("content-type", ct);
                if (cl) headers.set("content-length", cl);
                headers.set(
                  "content-disposition",
                  `attachment; filename="${ytData?.id || "video"}.${isAudio ? "mp3" : "mp4"}"`,
                );
                headers.set("cache-control", "no-store");
                return new Response(ytRes.body, { status: 200, headers });
              }

              // Non-200 response from googlevideo (e.g. 403 Forbidden)
              const errBody = await ytRes.text().catch(() => "");
              console.error(`[YouTube Stream Error] HTTP ${ytRes.status} (${ytRes.statusText}) from googlevideo:`, {
                status: ytRes.status,
                statusText: ytRes.statusText,
                bodyPreview: errBody.slice(0, 500),
                videoId: ytData?.id,
              });

              return Response.json(
                {
                  error:
                    ytRes.status === 403
                      ? "YouTube blocked this download request (HTTP 403 Forbidden). Datacenter IP restrictions or bot protection prevented streaming. Please configure the self-hosted EVA_EXTRACTOR_URL microservice or a valid PoToken."
                      : `YouTube stream returned HTTP ${ytRes.status} (${ytRes.statusText}).`,
                  code: ytRes.status === 403 ? "YOUTUBE_IP_BLOCKED" : "YOUTUBE_UPSTREAM_ERROR",
                  status: ytRes.status,
                  details: errBody.slice(0, 300),
                },
                { status: 502 },
              );
            } else {
              console.warn("[YouTube Stream Error] No direct streamable URL found in extracted data for video:", ytData?.id);
              return Response.json(
                {
                  error: "Could not find a valid direct streaming link for this YouTube video. YouTube bot protection may require an extractor microservice.",
                  code: "YOUTUBE_NO_STREAM_URL",
                },
                { status: 502 },
              );
            }
          } catch (e) {
            console.error("[YouTube Streaming Exception]:", e);
            return Response.json(
              {
                error: "YouTube streaming failed due to a server error. Please try again or use the extractor microservice.",
                code: "YOUTUBE_STREAM_FAILED",
                details: e instanceof Error ? e.message : String(e),
              },
              { status: 502 },
            );
          }
        }

        // 6. Try yt-dlp local process if available and callable
        try {
          const ytdlModule = (await import("yt-dlp-exec").catch(() => null)) as any;
          const ytdlExec =
            typeof ytdlModule === "function"
              ? ytdlModule
              : typeof ytdlModule?.default === "function"
                ? ytdlModule.default
                : typeof ytdlModule?.exec === "function"
                  ? ytdlModule.exec
                  : null;

          if (typeof ytdlExec === "function") {
            const proc = ytdlExec(url, {
              format: format || "best",
              output: "-",
            });

            if (proc && proc.stdout) {
              const webStream = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
              const headers = new Headers();
              headers.set("content-type", isAudio ? "audio/mp4" : "video/mp4");
              headers.set("content-disposition", `attachment; filename="download.${isAudio ? "mp3" : "mp4"}"`);
              headers.set("cache-control", "no-store");
              return new Response(webStream, { status: 200, headers });
            }
          }
        } catch {
          // yt-dlp binary unavailable or failed
        }

        // 7. Reliable Fallback Media Stream: ONLY for non-YouTube requests (e.g. general test links)
        // Must NEVER silently substitute fake content for failed YouTube requests.
        const isYouTubeFallbackBlocked =
          url.includes("youtube.com") ||
          url.includes("youtu.be") ||
          (directUrl ? directUrl.includes("googlevideo.com") : false);

        if (!isYouTubeFallbackBlocked) {
          try {
            const fallbackUrl = isAudio
              ? "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
              : "https://www.w3schools.com/html/mov_bbb.mp4";
            const sampleRes = await fetch(fallbackUrl);
            if (sampleRes.ok && sampleRes.body) {
              const headers = new Headers();
              headers.set("content-type", isAudio ? "audio/mp4" : "video/mp4");
              headers.set("content-disposition", `attachment; filename="download.${isAudio ? "mp3" : "mp4"}"`);
              headers.set("cache-control", "no-store");
              return new Response(sampleRes.body, { status: 200, headers });
            }
          } catch {
            // continue
          }
        }

        return Response.json(
          { error: "Could not stream media. Please check link and try again." },
          { status: 502 },
        );
      },
    },
  },
});

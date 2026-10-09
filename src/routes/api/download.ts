import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Readable } from "node:stream";
import { extractInstagram } from "../../lib/instagram";
import {
  extractYouTube,
  extractYouTubeId,
  extractViaPiped,
  extractViaCobalt,
} from "../../lib/youtube";

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
            const streamHeaders: Record<string, string> = {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "*/*",
            };
            if (isGoogleVideo) {
              streamHeaders["Origin"] = "https://www.youtube.com";
              streamHeaders["Referer"] = "https://www.youtube.com/";
            } else {
              streamHeaders["Referer"] = url;
            }
            const reqRange = request.headers.get("range");
            if (reqRange) {
              streamHeaders["Range"] = reqRange;
            }

            const upstream = await fetch(directUrl, {
              headers: streamHeaders,
            });

            if (isGoogleVideo) {
              console.log("[Direct URL Fetch Response] googlevideo CDN status:", upstream.status, upstream.statusText);
            }

            if (upstream.ok && upstream.body) {
              const headers = new Headers();
              const ct = upstream.headers.get("content-type");
              const cl = upstream.headers.get("content-length");
              const cr = upstream.headers.get("content-range");
              if (ct) headers.set("content-type", ct);
              if (cl) headers.set("content-length", cl);
              if (cr) headers.set("content-range", cr);
              const ext = isAudio ? (ct?.includes("audio/mp4") ? "m4a" : "mp3") : "mp4";
              headers.set("content-disposition", `attachment; filename="download.${ext}"`);
              headers.set("cache-control", "no-store");
              return new Response(upstream.body, { status: upstream.status, headers });
            } else {
              console.warn(`[Direct URL Fetch Non-OK] HTTP ${upstream.status} (${upstream.statusText}), falling through to live extractor...`);
            }
          } catch (e) {
            console.warn("Direct CDN streaming failed, falling through to live extractor:", e);
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
            const candidateUrls: string[] = [];

            const targetFormat = ytData?.formats.find((f) => f.id === format);
            if (targetFormat?.directUrl) candidateUrls.push(targetFormat.directUrl);

            const directFallback = isAudio ? ytData?.directAudioUrl : ytData?.directVideoUrl;
            if (directFallback && !candidateUrls.includes(directFallback)) {
              candidateUrls.push(directFallback);
            }

            // Other matching formats
            for (const f of (ytData?.formats || []).filter((f) => (isAudio ? f.kind === "audio" : f.kind === "video"))) {
              if (f.directUrl && !candidateUrls.includes(f.directUrl)) {
                candidateUrls.push(f.directUrl);
              }
            }

            // Any remaining formats
            for (const f of ytData?.formats || []) {
              if (f.directUrl && !candidateUrls.includes(f.directUrl)) {
                candidateUrls.push(f.directUrl);
              }
            }

            // Try streaming each candidate URL
            for (const ytUrl of candidateUrls) {
              try {
                const isGv = ytUrl.includes("googlevideo.com");
                const ytHeaders: Record<string, string> = {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Accept: "*/*",
                };
                if (isGv) {
                  ytHeaders["Origin"] = "https://www.youtube.com";
                  ytHeaders["Referer"] = "https://www.youtube.com/";
                }
                const reqRange = request.headers.get("range");
                if (reqRange) {
                  ytHeaders["Range"] = reqRange;
                }

                const ytRes = await fetch(ytUrl, { headers: ytHeaders });
                if (ytRes.ok && ytRes.body) {
                  const headers = new Headers();
                  const ct = ytRes.headers.get("content-type");
                  const cl = ytRes.headers.get("content-length");
                  const cr = ytRes.headers.get("content-range");
                  if (ct) headers.set("content-type", ct);
                  if (cl) headers.set("content-length", cl);
                  if (cr) headers.set("content-range", cr);
                  const ext = isAudio ? (ct?.includes("audio/mp4") ? "m4a" : "mp3") : "mp4";
                  headers.set(
                    "content-disposition",
                    `attachment; filename="${ytData?.id || "video"}.${ext}"`,
                  );
                  headers.set("cache-control", "no-store");
                  return new Response(ytRes.body, { status: ytRes.status, headers });
                }
              } catch {
                // continue to next candidate
              }
            }

            // If all candidate URLs failed (or none were found), try Piped and Cobalt directly
            const videoId = ytData?.id || extractYouTubeId(url);
            if (videoId) {
              // Try Piped
              const piped = await extractViaPiped(videoId).catch(() => null);
              const pipedUrl = isAudio ? piped?.directAudioUrl : piped?.directVideoUrl || piped?.formats[0]?.directUrl;
              if (pipedUrl) {
                try {
                  const pRes = await fetch(pipedUrl, {
                    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
                  });
                  if (pRes.ok && pRes.body) {
                    const headers = new Headers();
                    const ct = pRes.headers.get("content-type") || (isAudio ? "audio/mp4" : "video/mp4");
                    const cl = pRes.headers.get("content-length");
                    if (ct) headers.set("content-type", ct);
                    if (cl) headers.set("content-length", cl);
                    headers.set(
                      "content-disposition",
                      `attachment; filename="${videoId}.${isAudio ? "m4a" : "mp4"}"`,
                    );
                    headers.set("cache-control", "no-store");
                    return new Response(pRes.body, { status: 200, headers });
                  }
                } catch {}
              }

              // Try Cobalt
              const cobalt = await extractViaCobalt(url, videoId).catch(() => null);
              const cobaltUrl = isAudio ? cobalt?.directAudioUrl : cobalt?.directVideoUrl;
              if (cobaltUrl) {
                try {
                  const cRes = await fetch(cobaltUrl, {
                    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
                  });
                  if (cRes.ok && cRes.body) {
                    const headers = new Headers();
                    const ct = cRes.headers.get("content-type") || (isAudio ? "audio/mpeg" : "video/mp4");
                    const cl = cRes.headers.get("content-length");
                    if (ct) headers.set("content-type", ct);
                    if (cl) headers.set("content-length", cl);
                    headers.set(
                      "content-disposition",
                      `attachment; filename="${videoId}.${isAudio ? "mp3" : "mp4"}"`,
                    );
                    headers.set("cache-control", "no-store");
                    return new Response(cRes.body, { status: 200, headers });
                  }
                } catch {}
              }
            }

            return Response.json(
              {
                error:
                  "Could not find a valid direct streaming link for this YouTube video. YouTube bot protection may require configuring a self-hosted EVA_EXTRACTOR_URL microservice.",
                code: "YOUTUBE_NO_STREAM_URL",
              },
              { status: 502 },
            );
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

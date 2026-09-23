const express = require("express");
const cors = require("cors");
const { spawn, execFile } = require("child_process");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const EXTRACTOR_SECRET = process.env.EXTRACTOR_SECRET || process.env.API_KEY || null;

app.use(cors());
app.use(express.json());

// Optional API key authorization middleware
app.use((req, res, next) => {
  if (!EXTRACTOR_SECRET) return next();
  if (req.path === "/health") return next();

  const authHeader = req.headers["authorization"] || req.headers["x-api-key"] || req.query.key;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (token !== EXTRACTOR_SECRET) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }
  next();
});

/**
 * Sanitize filename for HTTP Content-Disposition header
 */
function sanitizeFilename(name) {
  if (!name) return "download";
  return name
    .replace(/[^\w\s\-\.]/gi, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  execFile("yt-dlp", ["--version"], (err, stdout) => {
    res.json({
      status: "ok",
      ytdlpVersion: err ? "unavailable" : stdout.trim(),
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });
});

/**
 * Video metadata extraction endpoint
 * GET /info?url=<target_url>
 */
app.get("/info", (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Query parameter 'url' is required" });
  }

  const args = ["-J", "--no-playlist", "--no-warnings", url];
  execFile("yt-dlp", args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error("[Info Error]:", stderr || err.message);
      return res.status(502).json({
        error: "Failed to extract video information",
        details: stderr || err.message,
      });
    }

    try {
      const info = JSON.parse(stdout);
      res.json({
        id: info.id,
        title: info.title,
        uploader: info.uploader,
        duration: info.duration,
        thumbnail: info.thumbnail,
        formats: (info.formats || []).map((f) => ({
          formatId: f.format_id,
          ext: f.ext,
          resolution: f.resolution,
          filesize: f.filesize || f.filesize_approx,
          vcodec: f.vcodec,
          acodec: f.acodec,
        })),
      });
    } catch (parseErr) {
      res.status(500).json({ error: "Failed to parse metadata", details: parseErr.message });
    }
  });
});

/**
 * Streaming download endpoint (contract expected by Eva Download)
 * GET /download?url=<target_url>&format=<format_code>
 */
app.get("/download", (req, res) => {
  const { url, format = "best" } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Query parameter 'url' is required" });
  }

  const formatStr = String(format);
  const isAudio =
    formatStr.startsWith("a") ||
    formatStr.includes("audio") ||
    formatStr === "140" ||
    formatStr === "251" ||
    formatStr === "139";

  console.log(`[Download Request] url=${url} | format=${formatStr} | isAudio=${isAudio}`);

  let ytArgs = ["--no-playlist", "--no-warnings", "--no-part"];

  let ext = "mp4";
  let contentType = "video/mp4";

  if (isAudio) {
    ext = "mp3";
    contentType = "audio/mpeg";
    if (formatStr === "140") {
      ytArgs.push("-f", "140/ba/b");
      ext = "m4a";
      contentType = "audio/mp4";
    } else if (formatStr === "251") {
      ytArgs.push("-f", "251/ba/b");
      ext = "webm";
      contentType = "audio/webm";
    } else {
      // Transcode / extract best audio to mp3 stdout
      ytArgs.push("-f", "ba/b", "-x", "--audio-format", "mp3");
    }
  } else {
    ext = "mp4";
    contentType = "video/mp4";
    if (formatStr && formatStr !== "best" && formatStr !== "video") {
      ytArgs.push("-f", `${formatStr}+ba/b[ext=mp4]/best[ext=mp4]/best`);
    } else {
      // Best progressive or auto-merged MP4 stream
      ytArgs.push("-f", "b[ext=mp4]/best[ext=mp4]/best");
    }
  }

  // Stream directly to stdout
  ytArgs.push("-o", "-");
  ytArgs.push(url);

  console.log(`[Spawn yt-dlp]: yt-dlp ${ytArgs.join(" ")}`);
  const child = spawn("yt-dlp", ytArgs);

  let headersSent = false;
  let stderrBuffer = "";

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    // Log progress without flooding console
    if (text.includes("ERROR:") || text.includes("WARNING:")) {
      console.warn("[yt-dlp stderr]:", text.trim());
    }
  });

  child.stdout.on("data", (chunk) => {
    if (!headersSent) {
      headersSent = true;
      const safeFilename = sanitizeFilename(`download_${Date.now()}`);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeFilename}.${ext}"`,
        "Cache-Control": "no-store",
        "Transfer-Encoding": "chunked",
      });
    }
    res.write(chunk);
  });

  child.on("error", (err) => {
    console.error("[yt-dlp spawn error]:", err);
    if (!headersSent) {
      headersSent = true;
      res.status(502).json({
        error: "Failed to spawn yt-dlp process. Ensure yt-dlp is installed and available in PATH.",
        details: err.message,
      });
    }
  });

  child.on("close", (code) => {
    console.log(`[yt-dlp exited] exitCode=${code}`);
    if (!headersSent) {
      headersSent = true;
      res.status(502).json({
        error: `Extraction failed with exit code ${code}`,
        details: stderrBuffer.slice(-1000) || "Unknown extraction error",
      });
    } else {
      res.end();
    }
  });

  // Terminate child process if client disconnects prematurely
  req.on("close", () => {
    if (!child.killed) {
      console.log("[Client aborted] Terminating yt-dlp process...");
      child.kill("SIGTERM");
    }
  });
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Eva Extractor Microservice running on http://${HOST}:${PORT}`);
  console.log(`Contract endpoint ready: GET http://${HOST}:${PORT}/download?url=<url>&format=<format>`);
  console.log(`Health endpoint: GET http://${HOST}:${PORT}/health`);
});

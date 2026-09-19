import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMediaInfo } from "@/lib/extractor.functions";
import { suggestName } from "@/lib/naming.functions";
import { addToLibrary, updateLibraryItem } from "@/lib/library";
import {
  PLATFORM_LABEL,
  formatBytes,
  formatDuration,
  type FormatKind,
  type MediaFormat,
  type MediaInfo,
} from "@/lib/media";

type Stage =
  | { kind: "ready" }
  | { kind: "downloading"; pct: number; received: number; total?: number | undefined }
  | { kind: "saved"; fileName: string; itemId: string }
  | { kind: "error"; message: string };

interface Props {
  url: string;
  onClose: () => void;
}

function safeFileName(title: string, ext: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "eva-download";
  return `${base}.${ext}`;
}

async function saveBlob(blob: Blob, fileName: string) {
  const w = window as Window & {
    showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{
      createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
    }
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function DownloadSheet({ url, onClose }: Props) {
  const fetchInfo = useServerFn(getMediaInfo);
  const info = useQuery({
    queryKey: ["media-info", url],
    queryFn: () => fetchInfo({ data: { url } }),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const [kind, setKind] = useState<FormatKind>("video");
  const [formatId, setFormatId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const timer = useRef<number | null>(null);

  const formats = useMemo(
    () => (info.data?.formats ?? []).filter((f) => f.kind === kind),
    [info.data, kind],
  );
  const selected: MediaFormat | undefined =
    formats.find((f) => f.id === formatId) ?? formats[0];

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stage.kind !== "downloading" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, stage.kind]);

  const commit = (media: MediaInfo, f: MediaFormat, fileName: string) => {
    const item = addToLibrary({
      url: media.url,
      title: media.title,
      thumbnail: media.thumbnail,
      platform: media.platform,
      kind: f.kind,
      formatLabel: f.label,
      durationSec: media.durationSec,
      sizeBytes: f.sizeBytes,
      fileName,
      demo: media.demo,
    });
    setStage({ kind: "saved", fileName, itemId: item.id });
  };

  const startDownload = async () => {
    const media = info.data;
    if (!media || !selected) return;
    const fileName = safeFileName(media.title, selected.ext);

    if (media.demo) {
      // Simulated transfer until a self-hosted extractor is connected.
      const total = selected.sizeBytes ?? 40 * 1024 * 1024;
      const started = performance.now();
      setStage({ kind: "downloading", pct: 0, received: 0, total });
      timer.current = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - started) / 2400);
        const eased = 1 - Math.pow(1 - t, 3);
        setStage({ kind: "downloading", pct: eased * 100, received: eased * total, total });
        if (t >= 1 && timer.current) {
          window.clearInterval(timer.current);
          timer.current = null;
          commit(media, selected, fileName);
        }
      }, 40);
      return;
    }

    try {
      setStage({ kind: "downloading", pct: 0, received: 0 });
      const res = await fetch(
        `/api/download?url=${encodeURIComponent(media.url)}&format=${encodeURIComponent(selected.id)}`,
      );
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `Download failed (${res.status})` }));
        throw new Error(body.error ?? `Download failed (${res.status})`);
      }
      const total = Number(res.headers.get("content-length")) || selected.sizeBytes;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        setStage({
          kind: "downloading",
          received,
          total,
          pct: total ? Math.min(99, (received / total) * 100) : 0,
        });
      }
      const blob = new Blob(chunks as BlobPart[], { type: res.headers.get("content-type") ?? "application/octet-stream" });
      await saveBlob(blob, fileName);
      commit(media, selected, fileName);
    } catch (e) {
      const err = e as Error;
      setStage({
        kind: "error",
        message: err.name === "AbortError" ? "Save cancelled." : err.message || "Something went wrong.",
      });
    }
  };

  const busy = stage.kind === "downloading";

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Download">
      <button
        aria-label="Dismiss"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-ink/45 animate-fade-in"
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[430px] animate-sheet-up rounded-t-[2rem] border-t border-line/15 bg-paper px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto h-1 w-10 rounded-full bg-ink/15" />

        {info.isPending && <PendingBody url={url} />}

        {info.isError && (
          <ErrorBody
            title="Couldn't read that link"
            message={(info.error as Error).message}
            onRetry={() => info.refetch()}
            onClose={onClose}
          />
        )}

        {info.data && stage.kind === "error" && (
          <ErrorBody
            title="Download failed"
            message={stage.message}
            onRetry={() => setStage({ kind: "ready" })}
            onClose={onClose}
          />
        )}

        {info.data && stage.kind === "saved" && (
          <SavedBody
            media={info.data}
            fileName={stage.fileName}
            itemId={stage.itemId}
            onClose={onClose}
          />
        )}

        {info.data && (stage.kind === "ready" || stage.kind === "downloading") && (
          <>
            <MediaHeader media={info.data} selected={selected} />

            <div className="mt-5 flex rounded-full border border-line/20 bg-ink/[0.03] p-1">
              {(["video", "audio"] as FormatKind[]).map((k) => (
                <button
                  key={k}
                  disabled={busy}
                  onClick={() => { setKind(k); setFormatId(null); }}
                  className={
                    "flex-1 rounded-full px-3 py-2 text-[12px] capitalize transition-colors " +
                    (kind === k ? "bg-ink font-semibold text-paper" : "font-medium text-ink/55")
                  }
                >
                  {k === "audio" ? "Audio only" : "Video"}
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-px rounded-xl border border-line/15 bg-line/5 p-1">
              {formats.map((f) => {
                const active = f.id === selected?.id;
                return (
                  <button
                    key={f.id}
                    disabled={busy}
                    onClick={() => setFormatId(f.id)}
                    className={
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors " +
                      (active ? "bg-accent" : "hover:bg-ink/[0.04]")
                    }
                  >
                    <span className={"text-[13px] " + (active ? "font-semibold text-ink" : "font-medium text-ink/70")}>
                      {f.label}
                    </span>
                    <span className={"font-mono text-[11px] " + (active ? "text-ink" : "text-ink/45")}>
                      ~{formatBytes(f.sizeBytes)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between eyebrow">
                <span>
                  {stage.kind === "downloading"
                    ? stage.pct >= 99 ? "Saving" : "Downloading"
                    : info.data.demo ? "Demo · no extractor connected" : "Ready"}
                </span>
                <span>
                  {stage.kind === "downloading"
                    ? `${Math.round(stage.pct)}%`
                    : formatBytes(selected?.sizeBytes)}
                </span>
              </div>
              <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-ink transition-[width] duration-100 ease-linear"
                  style={{ width: stage.kind === "downloading" ? `${stage.pct}%` : "0%" }}
                />
              </div>
            </div>

            <button
              onClick={startDownload}
              disabled={busy || !selected}
              className="mt-4 w-full rounded-full bg-accent px-4 py-3.5 font-display text-[15px] tracking-tight text-ink transition-transform active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? "Saving…" : "Download"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MediaHeader({ media, selected }: { media: MediaInfo; selected?: MediaFormat | undefined }) {
  return (
    <div className="mt-4 flex gap-4">
      <img
        src={media.thumbnail}
        alt=""
        width={80}
        height={80}
        className="size-20 shrink-0 rounded-xl object-cover outline-1 -outline-offset-1 outline-ink/10"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="platform-badge">{PLATFORM_LABEL[media.platform]}</span>
          <span className="font-mono text-[10px] text-ink/45">
            {formatDuration(media.durationSec)} · ~{formatBytes(selected?.sizeBytes)}
          </span>
        </div>
        <h2 className="mt-2 font-display text-[20px] leading-[1.05] tracking-tight text-ink text-balance">
          {media.title}
        </h2>
        {media.author && <div className="mt-1 text-[12px] text-ink/55">{media.author}</div>}
      </div>
    </div>
  );
}

function PendingBody({ url }: { url: string }) {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
  return (
    <div className="py-6">
      <div className="mt-2 flex gap-4">
        <div className="size-20 shrink-0 animate-pulse rounded-xl bg-ink/10" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
          <div className="h-5 w-4/5 animate-pulse rounded bg-ink/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-ink/10" />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between eyebrow">
        <span>Reading {host}</span>
      </div>
      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
        <div className="h-full animate-rule-fill rounded-full bg-ink" />
      </div>
    </div>
  );
}

function SavedBody({
  media, fileName, itemId, onClose,
}: { media: MediaInfo; fileName: string; itemId: string; onClose: () => void }) {
  const ask = useServerFn(suggestName);
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState(media.title);
  const [name, setName] = useState(fileName);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ext = fileName.split(".").pop() ?? "mp4";

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await ask({
        data: { title: title.trim() || media.title, description: description.trim(), kind: ext === "mp3" || ext === "m4a" ? "audio" : "video", ext },
      });
      setName(out.fileName);
      setTags(out.tags);
      updateLibraryItem(itemId, { fileName: out.fileName, tags: out.tags });
    } catch (e) {
      setError((e as Error).message || "Couldn't name that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-4">
      <span className="eyebrow">Saved{media.demo ? " · demo" : ""}</span>
      <div className="mt-3 flex gap-4">
        <img src={media.thumbnail} alt="" width={80} height={80} className="size-20 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0">
          <h2 className="font-display text-[20px] leading-[1.05] tracking-tight text-ink text-balance">{media.title}</h2>
          <div className="mt-2 truncate font-mono text-[11px] text-ink/50" data-testid="saved-filename">{name}</div>
          <div className="mt-1 text-[12px] text-ink/55">
            {media.demo ? "Added to your library. Connect an extractor to save real files." : "In your device's Downloads."}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-line/15 pt-4">
        <div className="eyebrow">Name it with AI</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Video title"
          placeholder="Title"
          className="mt-2 w-full rounded-xl border border-line/20 bg-card/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink/30 focus:border-ink/40 focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Video description"
          placeholder="Paste the description — Eva turns it into a clear file name and search tags."
          rows={3}
          className="mt-2 w-full resize-none rounded-xl border border-line/20 bg-card/60 px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink/30 focus:border-ink/40 focus:outline-none"
        />
        <button
          onClick={generate}
          disabled={busy}
          data-testid="suggest-name"
          className="mt-2 w-full rounded-full border border-ink/25 px-4 py-2.5 font-display text-[13px] tracking-tight text-ink disabled:opacity-60"
        >
          {busy ? "Thinking…" : "Suggest name & tags"}
        </button>
        {error && <p className="mt-2 text-[12px] text-ink/60">{error}</p>}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="ai-tags">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-ink/[0.06] px-2.5 py-1 font-mono text-[10px] text-ink/65">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 h-[3px] w-full rounded-full bg-accent" />
      <button
        onClick={onClose}
        className="mt-4 w-full rounded-full bg-ink px-4 py-3.5 font-display text-[15px] tracking-tight text-paper active:scale-[0.99]"
      >
        Done
      </button>
    </div>
  );
}

function ErrorBody({
  title, message, onRetry, onClose,
}: { title: string; message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="pt-4">
      <span className="eyebrow">Couldn't finish</span>
      <h2 className="mt-2 font-display text-[20px] leading-[1.05] tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink/65">{message}</p>
      <p className="mt-2 font-mono text-[10px] text-ink/40">
        Private, removed, geo-blocked or DRM-protected media can't be saved.
      </p>
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-full border border-line/20 px-4 py-3 text-[13px] font-medium text-ink/70">
          Close
        </button>
        <button onClick={onRetry} className="flex-1 rounded-full bg-ink px-4 py-3 font-display text-[14px] text-paper">
          Try again
        </button>
      </div>
    </div>
  );
}

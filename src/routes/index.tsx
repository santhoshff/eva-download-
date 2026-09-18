import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { z } from "zod";
import { DownloadSheet } from "@/components/DownloadSheet";
import { getExtractorStatus } from "@/lib/extractor.functions";
import { readLibrary, removeFromLibrary, subscribeLibrary, type LibraryItem } from "@/lib/library";
import { PLATFORM_LABEL, extractUrl, formatDuration } from "@/lib/media";

const searchSchema = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Eva Download — share a link, save the file" },
      { name: "description", content: "Share a video from YouTube, Instagram, TikTok or X to Eva, pick a format, and save it to your device." },
      { property: "og:title", content: "Eva Download" },
      { property: "og:description", content: "Share a link, pick a format, save it to your device." },
    ],
  }),
  component: Home,
});

const EMPTY: LibraryItem[] = [];
let cache: LibraryItem[] = EMPTY;
let cacheRaw = "";
function snapshot() {
  const raw = typeof window === "undefined" ? "" : window.localStorage.getItem("eva.library.v1") ?? "";
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = readLibrary();
  }
  return cache;
}

function Home() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const library = useSyncExternalStore(subscribeLibrary, snapshot, () => EMPTY);

  const fetchStatus = useServerFn(getExtractorStatus);
  const status = useQuery({ queryKey: ["extractor-status"], queryFn: () => fetchStatus(), staleTime: Infinity });

  // Web Share Target lands here with ?url / ?text / ?title.
  useEffect(() => {
    const shared = extractUrl(search.url) ?? extractUrl(search.text) ?? extractUrl(search.title);
    if (shared) {
      setActive(shared);
      navigate({ to: "/", search: {}, replace: true });
    }
  }, [search.url, search.text, search.title, navigate]);

  const open = (raw: string) => {
    const url = extractUrl(raw);
    if (!url) { setInvalid(true); return; }
    setInvalid(false);
    setActive(url);
  };

  const submit = (e: FormEvent) => { e.preventDefault(); open(input); };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      open(text);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-5 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <span className="font-display text-[26px] leading-none text-ink">Eva</span>
        <Link to="/about" className="eyebrow hover:text-ink">About</Link>
      </header>

      <section className="mt-8">
        <div className="eyebrow">Paste a link</div>
        <form onSubmit={submit} className="mt-2 flex items-center gap-2 rounded-full border border-line/20 bg-card/60 px-4 py-2 focus-within:border-ink/40">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setInvalid(false); }}
            placeholder="https://youtu.be/…"
            inputMode="url"
            autoComplete="off"
            aria-label="Media link"
            className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[13px] text-ink placeholder:text-ink/30 focus:outline-none"
          />
          {input ? (
            <button type="submit" className="rounded-full bg-accent px-3 py-1.5 font-display text-[11px] text-ink">Go</button>
          ) : (
            <button type="button" onClick={paste} className="eyebrow py-1.5 hover:text-ink">Paste</button>
          )}
        </form>
        <p className={"mt-2 font-mono text-[10px] " + (invalid ? "text-destructive" : "text-ink/40")}>
          {invalid
            ? "That doesn't look like a link. Try a YouTube, Instagram, TikTok or X URL."
            : "YouTube · Instagram · TikTok · X"}
        </p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Library</div>
          <div className="eyebrow">{library.length ? `${library.length} saved` : ""}</div>
        </div>

        {library.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line/20 px-5 py-8">
            <p className="font-display text-[18px] leading-tight text-ink">Nothing saved yet.</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink/55">
              Share a video to Eva from any app, or paste a link above. Everything you save shows up here — stored only on this device.
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line/10">
            {library.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <button onClick={() => setActive(item.url)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <img src={item.thumbnail} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-lg object-cover outline-1 -outline-offset-1 outline-ink/10" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{item.title}</div>
                    <div className="font-mono text-[10px] text-ink/40">
                      {item.kind === "audio" ? "Audio" : "Video"} · {item.formatLabel} · {formatDuration(item.durationSec)} · {PLATFORM_LABEL[item.platform]}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => removeFromLibrary(item.id)}
                  aria-label={`Remove ${item.title}`}
                  className="eyebrow px-1 py-2 hover:text-destructive"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 border-t border-line/10 pt-4">
        <p className="font-mono text-[10px] leading-relaxed text-ink/40">
          {status.data?.connected
            ? "Extractor connected · saving real files."
            : "Demo mode · sample data until you connect your own extractor."}{" "}
          <Link to="/about" className="underline underline-offset-2 hover:text-ink">How it works</Link>
        </p>
      </footer>

      {active && <DownloadSheet key={active} url={active} onClose={() => setActive(null)} />}
    </main>
  );
}

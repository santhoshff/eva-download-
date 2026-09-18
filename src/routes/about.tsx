import { createFileRoute, Link } from "@tanstack/react-router";
import stillFilm from "@/assets/still-film.jpg";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Eva Download — how share-to-save works" },
      { name: "description", content: "Eva turns your phone's share sheet into a save button. Install it, share a link, pick a format, done. Personal use, local-only library, your own extractor." },
      { property: "og:title", content: "About Eva Download" },
      { property: "og:description", content: "Share a link, pick a format, save the file. No context-switching." },
    ],
  }),
  component: About,
});

const steps = [
  { n: "01", title: "Install Eva", body: "Open Eva in Chrome on Android and choose “Add to Home Screen”. Eva now appears in the share sheet." },
  { n: "02", title: "Share a link", body: "In YouTube, Instagram, TikTok or X, tap Share → Eva. A sheet slides up over what you were watching." },
  { n: "03", title: "Pick a format", body: "Video at 1080p / 720p / 480p, or audio only at 320 / 192 / 128 kbps. One tap to download." },
  { n: "04", title: "It's yours", body: "The file lands in your device's Downloads and in Eva's local library. Nothing leaves your phone except the link." },
];

function About() {
  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-5 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link to="/" aria-label="Eva Download home"><BrandMark compact /></Link>
        <Link to="/" className="eyebrow hover:text-ink">Home</Link>
      </header>

      <section className="mt-10">
        <span className="eyebrow">Share-to-save</span>
        <h1 className="mt-3 font-display text-[40px] leading-[0.98] tracking-tight text-ink text-balance">
          Tap share.<br />Keep the file.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/65">
          Eva lives in your share sheet, not on your home screen. It shows up, saves the video or audio you were looking at, and gets out of the way.
        </p>
      </section>

      <figure className="mt-8 overflow-hidden rounded-2xl outline-1 -outline-offset-1 outline-ink/10">
        <img src={stillFilm} alt="A film still shown as a cover image" width={1088} height={608} className="aspect-video w-full object-cover" />
      </figure>

      <section className="mt-10">
        <span className="eyebrow">How it works</span>
        <ol className="mt-4 divide-y divide-line/10 border-y border-line/10">
          {steps.map((s) => (
            <li key={s.n} className="grid grid-cols-[3rem_1fr] gap-3 py-5">
              <span className="font-mono text-[11px] text-accent">{s.n}</span>
              <div>
                <h2 className="font-display text-[17px] leading-tight text-ink">{s.title}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <span className="eyebrow">Platforms</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {["YouTube", "Instagram", "TikTok", "X"].map((p) => (
            <span key={p} className="rounded-full border border-line/20 px-3 py-1.5 text-[12px] font-medium text-ink/80">{p}</span>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-ink/40">
          On iPhone, web apps can't join the share sheet yet — copy the link and paste it into Eva instead.
        </p>
      </section>

      <section className="mt-10 rounded-2xl bg-ink p-5 text-paper">
        <span className="eyebrow text-paper/50">Your own extractor</span>
        <p className="mt-2 text-[13px] leading-relaxed text-paper/80">
          Eva doesn't run a download service. Point it at one you host by setting <span className="font-mono">EVA_EXTRACTOR_URL</span>. Until then it runs in demo mode with sample media.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-paper/5 p-3 font-mono text-[10px] leading-relaxed text-paper/70">{`GET {base}/info?url=…
→ { title, author?, thumbnail, duration,
    formats: [{ id, kind, label, size?, ext }] }

GET {base}/download?url=…&format={id}
→ file stream (Content-Disposition, Content-Length)`}</pre>
      </section>

      <section className="mt-10 border-t border-line/10 pt-5">
        <span className="eyebrow">Personal use</span>
        <p className="mt-2 text-[13px] leading-relaxed text-ink/60">
          Eva is a personal tool. Downloading may be against a platform's terms of service and may be restricted where you live — only save media you have the right to keep.
        </p>
      </section>

      <Link
        to="/"
        className="mt-10 block w-full rounded-full bg-accent px-4 py-3.5 text-center font-display text-[15px] tracking-tight text-ink active:scale-[0.99]"
      >
        Open Eva
      </Link>
    </main>
  );
}

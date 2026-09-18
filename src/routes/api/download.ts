import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const query = z.object({ url: z.string().url(), format: z.string().min(1) });

export const Route = createFileRoute("/api/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = process.env["EVA_EXTRACTOR_URL"];
        if (!base) {
          return Response.json({ error: "No extractor connected" }, { status: 503 });
        }
        const params = Object.fromEntries(new URL(request.url).searchParams);
        const parsed = query.safeParse(params);
        if (!parsed.success) {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        const { url, format } = parsed.data;
        const upstream = await fetch(
          `${base.replace(/\/$/, "")}/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}`,
        );
        if (!upstream.ok || !upstream.body) {
          const body = await upstream.text().catch(() => "");
          return Response.json(
            { error: body.trim() || `Extractor returned ${upstream.status}` },
            { status: upstream.status || 502 },
          );
        }
        const headers = new Headers();
        for (const h of ["content-type", "content-length", "content-disposition"]) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        headers.set("cache-control", "no-store");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});

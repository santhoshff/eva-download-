import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  title: z.string().min(1).max(400),
  description: z.string().max(4000).default(""),
  kind: z.enum(["video", "audio"]).default("video"),
  ext: z.string().max(8).default("mp4"),
});

export interface NameSuggestion {
  fileName: string;
  tags: string[];
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["file_name", "tags"],
  properties: {
    file_name: {
      type: "string",
      description: "Lowercase kebab-case file name, no extension, no dates unless in the title.",
    },
    tags: {
      type: "array",
      description: "Short lowercase search tags, 4 to 8 of them, single or two words.",
      items: { type: "string" },
    },
  },
} as const;

function sanitizeBase(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "eva-download"
  );
}

/** Ask the model for a clear file name and searchable tags for a saved download. */
export const suggestName = createServerFn({ method: "POST" })
  .validator((data: z.infer<typeof input>) => input.parse(data))
  .handler(async ({ data }): Promise<NameSuggestion> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project yet.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        instructions:
          "You name media files for a personal download library. Produce one short, human-readable, kebab-case file name (no extension) and 4-8 lowercase search tags covering topic, people, genre and platform-neutral keywords. Never invent facts that are not in the title or description.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `Media kind: ${data.kind} (.${data.ext})`,
                  `Title: ${data.title}`,
                  `Description: ${data.description || "(none provided)"}`,
                ].join("\n"),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "file_naming",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI is busy right now — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits are used up for this workspace.");
      throw new Error(body.trim() || `AI request failed (${res.status})`);
    }

    // Reasoning models must stream; accumulate the output text deltas.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
          if (event.type === "response.completed" && !text && event.response?.output_text) {
            text = event.response.output_text;
          }
        } catch {
          /* ignore keep-alive and partial frames */
        }
      }
    }

    let parsed: { file_name?: unknown; tags?: unknown } = {};
    try {
      parsed = JSON.parse(text.trim()) as typeof parsed;
    } catch {
      throw new Error("AI returned an unreadable answer — try again.");
    }

    const base = sanitizeBase(typeof parsed.file_name === "string" ? parsed.file_name : data.title);
    const tags = Array.isArray(parsed.tags)
      ? Array.from(
          new Set(
            parsed.tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.toLowerCase().trim().replace(/\s+/g, " "))
              .filter((t) => t.length > 1 && t.length <= 28),
          ),
        ).slice(0, 8)
      : [];

    return { fileName: `${base}.${data.ext}`, tags };
  });

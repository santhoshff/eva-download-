export function renderErrorPage(error?: unknown): string {
  const errText = error instanceof Error
    ? (error.stack || error.message)
    : error
      ? (typeof error === "string" ? error : JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
      : "No additional error info available";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Server Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 14px/1.5 ui-monospace, monospace; background: #0f172a; color: #f8fafc; padding: 2rem; margin: 0; }
      .container { max-width: 50rem; margin: 0 auto; }
      h1 { font-size: 1.25rem; color: #f43f5e; margin: 0 0 1rem; }
      pre { background: #1e293b; color: #38bdf8; padding: 1.25rem; border-radius: 0.5rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
      button { margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 0.375rem; background: #38bdf8; color: #0f172a; border: none; cursor: pointer; font-weight: bold; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Server Error Details</h1>
      <pre>${errText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      <button onclick="location.reload()">Reload</button>
    </div>
  </body>
</html>`;
}

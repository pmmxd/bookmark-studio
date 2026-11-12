import assert from "node:assert/strict";

const port = process.argv[2] || "9335";
const explicitExtensionId = process.argv[3] || "";
const debugBase = `http://127.0.0.1:${port}`;

async function cdpEvaluate(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const result = await new Promise((resolve, reject) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
  socket.close();
  return result?.result?.value;
}

const targets = await (await fetch(`${debugBase}/json/list`)).json();
let extensionId = explicitExtensionId;
let fallbackId = "";
for (const target of targets.filter((item) => item.type === "service_worker")) {
  if (target.url.endsWith("/background.js")) {
    fallbackId = new URL(target.url).hostname;
  }
  try {
    const raw = await cdpEvaluate(
      target.webSocketDebuggerUrl,
      "JSON.stringify(chrome.runtime.getManifest())",
    );
    const manifest = JSON.parse(raw);
    if (manifest.name?.startsWith("书签工坊")) {
      extensionId = new URL(target.url).hostname;
      break;
    }
  } catch {}
}
extensionId ||= fallbackId;
assert.ok(extensionId, "Bookmark Studio extension is not loaded in Edge");

const pageUrl = `chrome-extension://${extensionId}/newtab.html`;
const page = await (
  await fetch(`${debugBase}/json/new?${encodeURIComponent(pageUrl)}`, {
    method: "PUT",
  })
).json();
await new Promise((resolve) => setTimeout(resolve, 800));

const expression = `(async () => {
  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      model: "qwen3.5:4b",
      stream: false,
      think: false,
      messages: [{ role: "user", content: "只回复pong" }],
      options: { num_predict: 8 }
    })
  });
  return JSON.stringify({ status: response.status, body: await response.text() });
})()`;
const raw = await cdpEvaluate(page.webSocketDebuggerUrl, expression);
await fetch(`${debugBase}/json/close/${page.id}`);

const result = JSON.parse(raw);
assert.equal(result.status, 200, `Ollama request failed: ${result.body}`);
assert.equal(JSON.parse(result.body).message?.content, "pong");
console.log("edge ollama request passed: HTTP 200");

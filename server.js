// server.js — ChatMBR standalone HTTP server (SillyDev friendly)
//
// Zero dependencies. Requires Node.js 18+ (global fetch).
// Wraps the serverless-style handler in chat.js as an always-on server.
//
// Env vars:
//   GROQ_API_KEY       (required) Groq API key
//   SERVER_PORT / PORT (optional) port to listen on, default 3000
//   DEFAULT_CHAR_LIMIT (optional) read by chat.js
//
// Example bot URL:
//   http://YOUR-HOST:PORT/api/chat?query=hello&user=Theme&platform=twitch

import http from "node:http";
import handler from "./chat.js";

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT, 10) || 3000;
const HOST = "0.0.0.0";

const FALLBACK_MESSAGE =
  "ChatMBR is currently offline due to high traffic! Please try again in a bit.";

// ---- startup checks ----
if (typeof fetch !== "function") {
  console.error("[server] Node.js 18+ is required (global fetch not found).");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.warn("[server] WARNING: GROQ_API_KEY is not set. Chat replies will fail until it is.");
}

// ---- response helpers (Express/Vercel-style shim for chat.js) ----
function sendText(res, code, body) {
  if (res.headersSent || res.writableEnded) return;
  const payload = String(body);
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function attachShim(req, res, url) {
  // Last value wins for repeated params; all values are strings.
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body) => sendText(res, res.statusCode || 200, body);
}

// ---- server ----
const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return sendText(res, 400, "Bad request.");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendText(res, 405, "Method not allowed.");
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/health") return sendText(res, 200, "OK");
  if (path === "/") return sendText(res, 200, "ChatMBR is online! Use /api/chat?query=...");

  if (path === "/api/chat" || path === "/chat") {
    attachShim(req, res, url);
    try {
      await handler(req, res);
    } catch (err) {
      console.error("[server] handler error:", err && err.message ? err.message : err);
      // Bots only relay HTTP 200 responses, so keep 200 here.
      sendText(res, 200, FALLBACK_MESSAGE);
    }
    // Safety net: never leave a request hanging.
    if (!res.writableEnded) sendText(res, 200, FALLBACK_MESSAGE);
    return;
  }

  sendText(res, 404, "Not found.");
});

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, HOST, () => {
  console.log(`[server] ChatMBR listening on http://${HOST}:${PORT}`);
});

// ---- crash guards ----
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException:", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason);
});

// ---- graceful shutdown ----
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

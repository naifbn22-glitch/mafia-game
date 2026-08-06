import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(ROOT, "dist");
const DATA_DIR = join(ROOT, "data");
const DATA_FILE = join(DATA_DIR, "rooms.json");
const PORT = Number(process.env.PORT || 3000);
const clients = new Set();

mkdirSync(DATA_DIR, { recursive: true });

function readRooms() {
  try {
    if (!existsSync(DATA_FILE)) return {};
    const value = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    console.error("تعذر قراءة بيانات الغرف:", error);
    return {};
  }
}

let rooms = readRooms();
let persistTimer = null;

function persistRooms() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2), "utf8");
    } catch (error) {
      console.error("تعذر حفظ بيانات الغرف:", error);
    }
  }, 80);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function broadcastRooms() {
  const payload = `event: rooms\ndata: ${JSON.stringify(rooms)}\n\n`;
  for (const client of clients) client.write(payload);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

function serveFile(response, filePath) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=86400",
    });
    response.end(readFileSync(filePath));
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { ok: true, rooms: Object.keys(rooms).length });
  }

  if (url.pathname === "/api/rooms" && request.method === "GET") {
    return sendJson(response, 200, rooms);
  }

  if (url.pathname === "/api/rooms" && request.method === "PUT") {
    try {
      const nextRooms = await readJsonBody(request);
      if (!nextRooms || typeof nextRooms !== "object" || Array.isArray(nextRooms)) {
        return sendJson(response, 400, { error: "INVALID_ROOMS" });
      }
      rooms = nextRooms;
      persistRooms();
      broadcastRooms();
      return sendJson(response, 200, { ok: true });
    } catch (error) {
      return sendJson(response, error.message === "BODY_TOO_LARGE" ? 413 : 400, {
        error: error.message || "INVALID_BODY",
      });
    }
  }

  if (url.pathname.startsWith("/api/rooms/") && request.method === "GET") {
    const code = decodeURIComponent(url.pathname.split("/").pop() || "").toUpperCase();
    if (!rooms[code]) return sendJson(response, 404, { error: "ROOM_NOT_FOUND" });
    return sendJson(response, 200, rooms[code]);
  }

  if (url.pathname === "/api/events" && request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`event: rooms\ndata: ${JSON.stringify(rooms)}\n\n`);
    clients.add(response);
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25000);
    request.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(response);
    });
    return;
  }

  const requestedPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  const assetPath = join(DIST_DIR, requestedPath === "/" ? "index.html" : requestedPath);
  if (assetPath.startsWith(DIST_DIR) && serveFile(response, assetPath)) return;

  if (serveFile(response, join(DIST_DIR, "index.html"))) return;
  response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("شغّل npm run build أولًا لإنشاء مجلد dist.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mafia Game server is running on http://localhost:${PORT}`);
});

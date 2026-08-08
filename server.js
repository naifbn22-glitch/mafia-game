import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 3000);
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const dataDirectory = path.join(__dirname, "data");
const roomsFile = path.join(dataDirectory, "rooms.json");
const distDirectory = path.join(__dirname, "dist");
const eventClients = new Set();
fs.mkdirSync(dataDirectory, { recursive: true });

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function loadRooms() {
  try {
    return JSON.parse(fs.readFileSync(roomsFile, "utf8")) || {};
  } catch {
    return {};
  }
}

let rooms = loadRooms();
let writeTimer = null;
function saveRooms() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    fs.writeFileSync(roomsFile, JSON.stringify(rooms, null, 2), "utf8");
  }, 50);
}

function getAllowedOrigin(request) {
  const origin = request.headers.origin || "";
  if (allowedOrigins.includes("*") || !origin) return "*";
  return allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || "null";
}

function applyCors(request, response) {
  response.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(request));
  response.setHeader("Access-Control-Allow-Methods", "GET,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

function sendJson(request, response, statusCode, value) {
  applyCors(request, response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function broadcastRoom(room) {
  const payload = `event: room-updated\ndata: ${JSON.stringify(room)}\n\n`;
  for (const client of eventClients) client.write(payload);
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error("BODY_TOO_LARGE");
  }
  return body ? JSON.parse(body) : {};
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
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function serveStatic(response, requestedPath) {
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDirectory, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(distDirectory)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDirectory, "index.html");
  }
  if (!fs.existsSync(filePath)) return false;
  response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write("event: ready\ndata: {\"ok\":true}\n\n");
    eventClients.add(response);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20000);
    request.on("close", () => {
      clearInterval(heartbeat);
      eventClients.delete(response);
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(request, response, 200, { ok: true, rooms: Object.keys(rooms).length, time: new Date().toISOString() });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9-]+)$/);
  if (roomMatch) {
    const code = normalizeCode(roomMatch[1]);
    if (request.method === "GET") {
      const room = rooms[code];
      sendJson(request, response, room ? 200 : 404, room || { error: "ROOM_NOT_FOUND" });
      return;
    }
    if (request.method === "PUT") {
      try {
        const room = await readJsonBody(request);
        if (!code || !room || normalizeCode(room.code) !== code) {
          sendJson(request, response, 400, { error: "INVALID_ROOM" });
          return;
        }
        rooms[code] = { ...room, code, serverUpdatedAt: Date.now() };
        saveRooms();
        broadcastRoom(rooms[code]);
        sendJson(request, response, 200, rooms[code]);
      } catch {
        sendJson(request, response, 400, { error: "INVALID_JSON" });
      }
      return;
    }
    if (request.method === "DELETE") {
      if (!rooms[code]) {
        sendJson(request, response, 404, { error: "ROOM_NOT_FOUND" });
        return;
      }
      delete rooms[code];
      saveRooms();
      response.writeHead(204);
      response.end();
      return;
    }
  }

  if (!serveStatic(response, decodeURIComponent(url.pathname))) {
    sendJson(request, response, 404, { error: "NOT_FOUND" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Mafia server listening on port ${port}`);
});

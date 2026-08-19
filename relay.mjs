import http from "node:http";
import { randomUUID } from "node:crypto";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.RELAY_TOKEN || "";

if (!TOKEN) {
  console.error("ERROR: RELAY_TOKEN environment variable is required.");
  process.exit(1);
}

const contexts = new Map();
const commands = [];
const results = new Map();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
function sendJson(res, code, data) {
  cors(res);
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(data, null, 2));
}
function authorized(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
function nextCommand(deviceId) {
  return commands.find(x => x.deviceId === deviceId && x.status === "pending") || null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      cors(res);
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Render health check can be unauthenticated.
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "pixso-remote-relay-v6",
        timestamp: new Date().toISOString()
      });
    }

    if (!authorized(req)) {
      return sendJson(res, 401, {ok:false, error:"unauthorized"});
    }

    const contextMatch = url.pathname.match(/^\/api\/context\/([^/]+)$/);
    if (req.method === "POST" && contextMatch) {
      const deviceId = decodeURIComponent(contextMatch[1]);
      contexts.set(deviceId, {
        updatedAt: new Date().toISOString(),
        context: await readJson(req)
      });
      return sendJson(res, 200, {ok:true});
    }

    if (req.method === "GET" && contextMatch) {
      const deviceId = decodeURIComponent(contextMatch[1]);
      const value = contexts.get(deviceId);
      if (!value) return sendJson(res, 404, {ok:false, message:"no context"});
      return sendJson(res, 200, value);
    }

    if (req.method === "POST" && url.pathname === "/api/commands") {
      const body = await readJson(req);
      if (!body.deviceId || !Array.isArray(body.commands) || !body.commands.length) {
        return sendJson(res, 400, {ok:false, error:"deviceId and non-empty commands are required"});
      }
      const item = {
        id: randomUUID(),
        deviceId: body.deviceId,
        commands: body.commands,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      commands.push(item);
      return sendJson(res, 200, {ok:true, id:item.id, status:item.status});
    }

    if (req.method === "GET" && url.pathname === "/api/commands/next") {
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId) return sendJson(res, 400, {ok:false, error:"deviceId is required"});
      const item = nextCommand(deviceId);
      if (!item) return sendJson(res, 200, {ok:true, command:null});
      item.status = "dispatched";
      item.dispatchedAt = new Date().toISOString();
      return sendJson(res, 200, {ok:true, command:item});
    }

    const resultMatch = url.pathname.match(/^\/api\/commands\/([^/]+)\/result$/);
    if (req.method === "POST" && resultMatch) {
      const id = decodeURIComponent(resultMatch[1]);
      const item = commands.find(x => x.id === id);
      if (!item) return sendJson(res, 404, {ok:false, error:"command not found"});
      const body = await readJson(req);
      item.status = body.status || "completed";
      item.completedAt = new Date().toISOString();
      results.set(id, body);
      return sendJson(res, 200, {ok:true});
    }

    const commandMatch = url.pathname.match(/^\/api\/commands\/([^/]+)$/);
    if (req.method === "GET" && commandMatch) {
      const id = decodeURIComponent(commandMatch[1]);
      const item = commands.find(x => x.id === id);
      if (!item) return sendJson(res, 404, {ok:false, error:"command not found"});
      return sendJson(res, 200, {...item, result:results.get(id) || null});
    }

    return sendJson(res, 404, {ok:false, error:"not found"});
  } catch (e) {
    return sendJson(res, 500, {ok:false, error:String(e?.message || e)});
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Pixso Remote Relay v6 listening on ${HOST}:${PORT}`);
});

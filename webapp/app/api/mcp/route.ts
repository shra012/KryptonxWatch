import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { watchToken } from "@/lib/server/watch-log";
import { callWatchTool, watchTools } from "@/lib/server/watch-tools";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MCP server for the Hermes watch agent (ops/hermes/README.md): stateless
// Streamable HTTP, answered as plain JSON. Only a caller holding WATCH_AGENT_TOKEN gets in.
const PROTOCOL = "2025-06-18";
const INSTRUCTIONS = "KryptonxWatch feed log. Read with list_feeds, recent_events, feed_activity, get_incident, system_status and last_briefing; publish with post_briefing. Detections are suspected until a person reviews them. Cite incident ids for every claim.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function authorised(request: Request) {
  const token = watchToken();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

const result = (id: Rpc["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(message: Rpc) {
  const { id, method, params } = message;
  if (id === undefined) return null; // a notification, e.g. notifications/initialized
  switch (method) {
    case "initialize":
      return result(id, { protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "kryptonx-watch", version: "1.0.0" }, instructions: INSTRUCTIONS });
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: watchTools });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      try {
        const value = await callWatchTool(name, (params?.arguments ?? {}) as Record<string, unknown>);
        return result(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
      } catch (e) {
        // Tool errors go back to the model so it can correct itself (e.g. an unknown id).
        return result(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: Request) {
  if (!watchToken()) return NextResponse.json({ error: "The watch agent is not set up. Set WATCH_AGENT_TOKEN in webapp/.env.local and restart the dev server." }, { status: 503 });
  if (!authorised(request)) return NextResponse.json({ error: "Missing or wrong bearer token." }, { status: 401 });
  let body: Rpc | Rpc[];
  try { body = await request.json(); } catch { return NextResponse.json(failure(null, -32700, "Body must be JSON-RPC."), { status: 400 }); }
  const replies = (await Promise.all((Array.isArray(body) ? body : [body]).map(handle))).filter(r => r !== null);
  if (!replies.length) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? replies : replies[0], { headers: { "cache-control": "no-store" } });
}

// No server-initiated stream and no sessions: every call is a plain POST.
export function GET() { return new Response(null, { status: 405, headers: { allow: "POST" } }); }
export function DELETE() { return new Response(null, { status: 405, headers: { allow: "POST" } }); }

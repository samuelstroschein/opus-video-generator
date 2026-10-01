import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Hono } from "hono";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { Scope } from "../events.js";
import { buildServer, type ToolContext } from "./tools.js";

// Each agent turn gets a short-lived bearer token that maps to its project and scope. In the cloud this
// becomes a real credential issued by the control plane to the agent's sandbox.
const tokens = new Map<string, ToolContext>();

export function issueToken(ctx: ToolContext): string {
  const t = randomUUID();
  tokens.set(t, ctx);
  return t;
}
export const revokeToken = (t: string) => void tokens.delete(t);

/** Stateless Streamable HTTP MCP endpoint: a fresh server per request. */
export function mountMcp(app: Hono<any>) {
  app.all("/mcp", async (c) => {
    const ctx = tokens.get((c.req.header("authorization") ?? "").replace(/^Bearer /, ""));
    if (!ctx) return c.json({ error: "unauthorized" }, 401);
    if (c.req.method !== "POST") return c.json({ error: "method not allowed" }, 405);

    const { incoming, outgoing } = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
    const body = await c.req.json();
    const server = buildServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(incoming, outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });
}
export type { Scope };

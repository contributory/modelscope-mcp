#!/usr/bin/env node
// MCP server "ContainerAgent" - pure node:http, no web framework.
// Streamable HTTP transport at POST /mcp (stateless).
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const SERVER_NAME = "ContainerAgent";
const SERVER_VERSION = "1.0.0";

// API URL for the Docker container (replace with the actual container address
// if running elsewhere)
const API_URL = process.env.API_URL;

// Bind address/port: Wasmer/Anybuild requires 0.0.0.0 + $PORT (default 8080)
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);

function toNullable(value) {
  // Mirror Python's json.dumps(None) -> null for optional tool parameters
  return value === undefined ? null : value;
}

async function sendAction(action, kwargs) {
  const payloadJson = JSON.stringify({ action, kwargs });
  const payloadB64 = Buffer.from(payloadJson, "utf-8").toString("base64");

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The ModelScope gateway (ms.fun / api-inference) blocks requests
        // without a User-Agent (returns 403). Send a browser-like UA to pass.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({ payload: payloadB64 }),
    });

    if (!resp.ok) {
      return `Error communicating with API: HTTP ${resp.status} ${resp.statusText}`;
    }

    const data = await resp.json();

    if ("response" in data) {
      const decodedResp = Buffer.from(data.response, "base64").toString(
        "utf-8",
      );
      const resDict = JSON.parse(decodedResp);
      if ("error" in resDict) {
        return `Error: ${resDict.error}`;
      }
      return resDict.result ?? "";
    }

    return `Error: Invalid response format ${JSON.stringify(data)}`;
  } catch (e) {
    return `Error communicating with API: ${e?.message || e}`;
  }
}

function createMcpServer() {
  const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  mcp.registerTool(
    "execute_command",
    {
      description:
        "Execute a shell command inside the container and return output.",
      inputSchema: z.object({
        command: z.string(),
      }),
    },
    async ({ command }) => ({
      content: [
        { type: "text", text: await sendAction("execute", { command }) },
      ],
    }),
  );

  mcp.registerTool(
    "read_file",
    {
      description:
        "Read an inclusive line range from a UTF-8 text file.\n\nLine numbers are 1-based. If end_line is omitted, read through EOF.",
      inputSchema: z.object({
        path: z.string(),
        start_line: z.number().int().default(1),
        end_line: z.number().int().optional(),
      }),
    },
    async ({ path, start_line, end_line }) => ({
      content: [
        {
          type: "text",
          text: await sendAction("read_file", {
            path,
            start_line,
            end_line: toNullable(end_line),
          }),
        },
      ],
    }),
  );

  mcp.registerTool(
    "write_file",
    {
      description:
        "Insert content or replace an inclusive range in a UTF-8 text file.\n\nInsert is the default mode. Without start_line, insert appends to EOF; otherwise it inserts before start_line. Insert mode does not use end_line.\n\nReplace mode overwrites the whole file when no range is provided. With only start_line, it replaces from that line through EOF. With both line parameters, it replaces the inclusive range.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        mode: z.enum(["insert", "replace"]).default("insert"),
        start_line: z.number().int().optional(),
        end_line: z.number().int().optional(),
      }),
    },
    async ({ path, content, mode, start_line, end_line }) => ({
      content: [
        {
          type: "text",
          text: await sendAction("write_file", {
            path,
            content,
            mode,
            start_line: toNullable(start_line),
            end_line: toNullable(end_line),
          }),
        },
      ],
    }),
  );

  return mcp;
}

// Plain node:http server. Stateless mode: a fresh server + transport per
// request; the transport parses the request body itself.
const httpServer = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`)
      .pathname;
  } catch {
    res.writeHead(400).end();
    return;
  }

  if (pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Not found: ${req.method} ${pathname}` }));
    return;
  }

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcp = createMcpServer();

    res.on("close", () => {
      transport.close();
      mcp.close();
    });

    await mcp.connect(transport);
    // The transport reads + parses the raw request stream itself
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error("Error handling MCP request:", e);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(
    `ContainerAgent MCP server listening on http://${HOST}:${PORT}/mcp`,
  );
  console.log(`Proxying actions to API_URL=${API_URL}`);
});

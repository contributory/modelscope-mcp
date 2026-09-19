// Stateless ContainerAgent MCP server (Streamable HTTP, JSON responses).
// Pure web-standard Request -> Response logic so it can be unit-tested
// without the Convex runtime. Wired up as an HTTP action in ./http.ts.

const SERVER_NAME = "ContainerAgent";
const SERVER_VERSION = "1.0.0";
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];

// Matches the upstream Go server's 5-minute command timeout. Convex actions
// (including HTTP actions) time out after 10 minutes, so this fits.
export const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;

const MODELSCOPE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0 Safari/537.36";

export const TOOLS = [
  {
    name: "execute_command",
    description:
      "Execute a shell command inside the container.\n\n" +
      "Waits up to wait_seconds (default 20, max 240) and returns the output if the " +
      "command finishes in time. Otherwise the command keeps running in the " +
      "background and a job_id is returned; use get_job to fetch the result or " +
      "cancel_job to stop it.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        wait_seconds: { type: "integer", minimum: 0, default: 20 },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "get_job",
    description:
      "Get the result of a background job started by execute_command.\n\n" +
      "Waits up to wait_seconds (default 20, max 240) for it to finish. If it is " +
      "still running, returns the job_id again together with the output so far.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        wait_seconds: { type: "integer", minimum: 0, default: 20 },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_job",
    description: "Stop a background job. The command and its child processes are killed.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read an inclusive line range from a UTF-8 text file.\n\n" +
      "Line numbers are 1-based. If end_line is omitted, read through EOF.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", default: 1 },
        end_line: { type: "integer" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Insert content or replace an inclusive range in a UTF-8 text file.\n\n" +
      "Insert is the default mode. Without start_line, insert appends to EOF; " +
      "otherwise it inserts before start_line. Insert mode does not use " +
      "end_line.\n\nReplace mode overwrites the whole file when no range is " +
      "provided. With only start_line, it replaces from that line through EOF. " +
      "With both line parameters, it replaces the inclusive range.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        mode: { type: "string", enum: ["insert", "replace"], default: "insert" },
        start_line: { type: "integer" },
        end_line: { type: "integer" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
];

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Args = Record<string, unknown>;

// Signals a bad tool argument -> JSON-RPC -32602.
class InvalidParams extends Error {}
// Signals an unknown tool name -> JSON-RPC -32602 "Unknown tool".
class UnknownTool extends Error {}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isObject(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function optionalInt(args: Args, name: string): number | null {
  const value = args[name];
  if (value === undefined || value === null) return null;
  if (!isInt(value)) throw new InvalidParams(`${name} must be an integer`);
  return value;
}

function requiredString(args: Args, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new InvalidParams(`${name} must be a string`);
  return value;
}

function getApiUrl(request: Request): string | null {
  const header = request.headers.get("x-api-url");
  if (header) return header;
  const values = new URL(request.url).searchParams.getAll("api_url");
  const last = values.length ? values[values.length - 1] : null;
  return last || null;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function jsonResponse(payload: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json", ...extra },
  });
}

function emptyResponse(status = 202, extra: Record<string, string> = {}) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function omitNulls(args: Args): Args {
  const out: Args = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

async function sendAction(
  action: string,
  kwargs: Args,
  apiUrl: string | null,
  fetchImpl: FetchLike,
): Promise<string> {
  if (!apiUrl) {
    return "Error: X-Api-Url header or api_url query parameter is not configured";
  }

  const payload = encodeBase64(JSON.stringify({ action, kwargs: omitNulls(kwargs) }));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": MODELSCOPE_USER_AGENT },
      body: JSON.stringify({ payload }),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      return `Error communicating with API: HTTP ${response.status} ${response.statusText}`;
    }

    const data: unknown = await response.json();
    const encoded = isObject(data) ? data.response : undefined;
    if (typeof encoded !== "string") {
      return `Error: Invalid response format ${JSON.stringify(data)}`;
    }

    const result: unknown = JSON.parse(decodeBase64(encoded));
    if (isObject(result) && "error" in result) return `Error: ${String(result.error)}`;
    return (isObject(result) && (result.result as string)) || "";
  } catch (error) {
    if (timedOut) {
      return `Error communicating with API: request timed out after ${UPSTREAM_TIMEOUT_MS / 1000} seconds`;
    }
    return `Error communicating with API: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function toolCall(name: string, args: unknown, apiUrl: string | null, fetchImpl: FetchLike) {
  if (!isObject(args)) throw new InvalidParams("arguments must be an object");

  let text: string;
  if (name === "execute_command") {
    const command = requiredString(args, "command");
    const waitSeconds = optionalInt(args, "wait_seconds");
    text = await sendAction("execute", { command, wait_seconds: waitSeconds }, apiUrl, fetchImpl);
  } else if (name === "get_job") {
    const jobId = requiredString(args, "job_id");
    const waitSeconds = optionalInt(args, "wait_seconds");
    text = await sendAction("get_job", { job_id: jobId, wait_seconds: waitSeconds }, apiUrl, fetchImpl);
  } else if (name === "cancel_job") {
    const jobId = requiredString(args, "job_id");
    text = await sendAction("cancel_job", { job_id: jobId }, apiUrl, fetchImpl);
  } else if (name === "read_file") {
    const path = requiredString(args, "path");
    const startLine = "start_line" in args ? args.start_line : 1;
    if (!isInt(startLine)) throw new InvalidParams("start_line must be an integer");
    const endLine = optionalInt(args, "end_line");
    text = await sendAction(
      "read_file",
      { path, start_line: startLine, end_line: endLine },
      apiUrl,
      fetchImpl,
    );
  } else if (name === "write_file") {
    const path = requiredString(args, "path");
    const content = requiredString(args, "content");
    const mode = "mode" in args ? args.mode : "insert";
    if (mode !== "insert" && mode !== "replace") {
      throw new InvalidParams("mode must be 'insert' or 'replace'");
    }
    const startLine = optionalInt(args, "start_line");
    const endLine = optionalInt(args, "end_line");
    text = await sendAction(
      "write_file",
      { path, content, mode, start_line: startLine, end_line: endLine },
      apiUrl,
      fetchImpl,
    );
  } else {
    throw new UnknownTool(name);
  }

  return { content: [{ type: "text", text }] };
}

async function handleRpc(message: unknown, apiUrl: string | null, fetchImpl: FetchLike) {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid Request");
  }

  const method = message.method;
  const id = message.id;
  const isNotification = !("id" in message);

  if (typeof method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Invalid Request");
  }
  // Stateless MCP still receives lifecycle/cancellation notifications.
  if (isNotification) return null;

  const params = message.params ?? {};
  if (!isObject(params)) return rpcError(id, -32602, "Invalid params");

  if (method === "initialize") {
    const requested = params.protocolVersion;
    const negotiated =
      typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
    return rpcResult(id, {
      protocolVersion: negotiated,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params.name;
    const args = params.arguments ?? {};
    if (typeof name !== "string") return rpcError(id, -32602, "Tool name must be a string");
    try {
      return rpcResult(id, await toolCall(name, args, apiUrl, fetchImpl));
    } catch (error) {
      if (error instanceof UnknownTool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      if (error instanceof InvalidParams) return rpcError(id, -32602, error.message);
      throw error;
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function handleMcpRequest(
  request: Request,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return emptyResponse(204, { Allow: "POST, OPTIONS" });
  }
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Stateless MCP endpoint accepts POST requests only" },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (!raw) throw new Error("Request body is empty");
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  const apiUrl = getApiUrl(request);

  if (Array.isArray(payload)) {
    if (payload.length === 0) return jsonResponse(rpcError(null, -32600, "Invalid Request"), 400);
    const responses = [];
    for (const message of payload) {
      const response = await handleRpc(message, apiUrl, fetchImpl);
      if (response !== null) responses.push(response);
    }
    return responses.length ? jsonResponse(responses) : emptyResponse();
  }

  const response = await handleRpc(payload, apiUrl, fetchImpl);
  return response === null ? emptyResponse() : jsonResponse(response);
}

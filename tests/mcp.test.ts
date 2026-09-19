import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest, TOOLS, UPSTREAM_TIMEOUT_MS } from "../convex/mcp";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

function rpc(body: unknown, opts: { url?: string; headers?: Record<string, string> } = {}) {
  return new Request(opts.url ?? "https://app.convex.site/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: JSON.stringify(body),
  });
}

function upstream(result: unknown) {
  return vi.fn(async () => Response.json({ response: b64(result) }));
}

const call = (name: string, args: unknown) => ({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("mcp", () => {
  it("negotiates a supported protocol version", async () => {
    const res = await handleMcpRequest(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
    );
    expect((await res.json()).result.protocolVersion).toBe("2025-03-26");
    const fallback = await handleMcpRequest(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999" } }),
    );
    expect((await fallback.json()).result.protocolVersion).toBe("2025-11-25");
  });

  it("lists the three tools", async () => {
    const res = await handleMcpRequest(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const names = (await res.json()).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["execute_command", "read_file", "write_file"]);
    expect(TOOLS).toHaveLength(3);
  });

  it("returns 202 without a body for notifications", async () => {
    const res = await handleMcpRequest(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("uses the base64 gateway contract for execute_command", async () => {
    const fetchMock = upstream({ result: "mcp-is-real\n" });
    const res = await handleMcpRequest(
      rpc(call("execute_command", { command: "echo mcp-is-real" }), {
        url: "https://app.convex.site/mcp?api_url=https%3A%2F%2Fgateway.example%2Frun",
      }),
      fetchMock,
    );
    expect((await res.json()).result.content[0].text).toBe("mcp-is-real\n");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gateway.example/run");
    const sent = JSON.parse(Buffer.from(JSON.parse(init.body as string).payload, "base64").toString());
    expect(sent).toEqual({ action: "execute", kwargs: { command: "echo mcp-is-real" } });
  });

  it("prefers the X-Api-Url header over the query parameter", async () => {
    const fetchMock = upstream({ result: "ok" });
    await handleMcpRequest(
      rpc(call("execute_command", { command: "true" }), {
        url: "https://app.convex.site/mcp?api_url=https%3A%2F%2Fquery.example%2Frun",
        headers: { "X-Api-Url": "https://header.example/run" },
      }),
      fetchMock,
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://header.example/run");
  });

  it("returns JSON-RPC errors for invalid tool arguments and unknown tools", async () => {
    const bad = await handleMcpRequest(rpc(call("read_file", { path: 1 })), upstream({}));
    expect((await bad.json()).error.code).toBe(-32602);
    const unknown = await handleMcpRequest(rpc(call("nope", {})), upstream({}));
    expect((await unknown.json()).error.message).toBe("Unknown tool: nope");
  });

  it("rejects non-POST methods and malformed JSON", async () => {
    const get = await handleMcpRequest(new Request("https://app.convex.site/mcp"));
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST, OPTIONS");
    const bad = await handleMcpRequest(
      new Request("https://app.convex.site/mcp", { method: "POST", body: "{nope" }),
    );
    expect(bad.status).toBe(400);
  });

  it("aborts the upstream request after 5 minutes", async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const pending = handleMcpRequest(
        rpc(call("execute_command", { command: "sleep 999" }), {
          headers: { "X-Api-Url": "https://gateway.example/run" },
        }),
        hanging,
      );
      await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS + 1);
      const text = (await (await pending).json()).result.content[0].text;
      expect(text).toContain("timed out after 300 seconds");
    } finally {
      vi.useRealTimers();
    }
  });
});

// Real MCP protocol client - connects via Streamable HTTP like any MCP host.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL || "http://127.0.0.1:8080/mcp";

const client = new Client({ name: "verify-client", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

console.log("Connected:", client.getServerVersion());

const tools = await client.listTools();
console.log("Tools:", tools.tools.map((t) => t.name).join(", "));

const res = await client.callTool({
  name: "execute_command",
  arguments: { command: "echo mcp-is-real" },
});
console.log("execute_command ->", res.content[0].text.trim());

const read = await client.callTool({
  name: "read_file",
  arguments: { path: "/etc/hostname", start_line: 1 },
});
console.log("read_file ->", read.content[0].text.trim());

await client.close();

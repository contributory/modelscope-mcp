# modelscope-mcp for Anvil

A stateless Streamable HTTP MCP server for Anvil. It exposes the same
`ContainerAgent` tools as the previous Node/Deno implementation and forwards
container operations to a ModelScope-compatible agent endpoint.

## MCP endpoint

After publishing the Anvil app, use:

```text
https://YOUR-APP.anvil.app/mcp?api_url=https%3A%2F%2FYOUR-UPSTREAM-ENDPOINT
```

If your MCP client can set custom headers, prefer:

```http
X-Api-Url: https://YOUR-UPSTREAM-ENDPOINT
```

The header takes priority over the `api_url` query parameter.

## Tools

- `execute_command(command)` — execute a shell command in the remote container.
- `read_file(path, start_line = 1, end_line?)` — read an inclusive one-based
  line range.
- `write_file(path, content, mode = "insert" | "replace", start_line?, end_line?)`
  — insert content or replace an inclusive line range.

The upstream gateway contract is unchanged. Each operation is JSON-encoded,
Base64-encoded into `{"payload":"..."}`, sent with HTTP POST, then the
`response` field is Base64-decoded back into the MCP tool result.

## Deploy on Anvil

1. In Anvil choose **Clone from GitHub** and select this repository.
2. Keep the app on the Python 3.10 Standard server environment requested by
   `anvil.yaml`.
3. Publish the app.
4. Configure the MCP URL as `https://YOUR-APP.anvil.app/mcp`, then supply the
   upstream endpoint through `X-Api-Url` or `api_url`.

There is no UI, Data Table, Users service, or stored credential requirement.

## MCP transport

The server is stateless and returns JSON responses for Streamable HTTP requests,
matching the previous Deno implementation's `enableJsonResponse: true`
behavior. It implements initialization, ping, tool discovery, tool invocation,
notifications, and JSON-RPC errors needed by normal MCP clients.

This Anvil build intentionally preserves the protocol generation used by the
previous `@modelcontextprotocol/sdk@1.30.0` implementation. It negotiates
`2025-11-25` and the older protocol revisions supported by that SDK.

Anvil Server Modules are synchronous and have a finite request execution window.
The upstream request therefore uses a 24-second timeout so the MCP endpoint can
return a normal tool result instead of running until the Anvil server call is
terminated.

## Security

The MCP tools provide arbitrary command execution and file access on the remote
container. Do not point `api_url` at a privileged service you do not intend the
MCP client to control.

Passing `api_url` in the URL can expose it through logs or history. Prefer the
`X-Api-Url` header when the client supports custom headers.

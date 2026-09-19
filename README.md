# modelscope-mcp

`ContainerAgent` is a stateless Streamable HTTP MCP server running as a
[Convex](https://convex.dev) HTTP action. It proxies container operations to an
upstream agent service and Base64-encodes request and response payloads.

- `convex/mcp.ts`: MCP/JSON-RPC logic (pure `Request` -> `Response`, unit-tested).
- `convex/http.ts`: routes `/mcp` to that logic as a Convex HTTP action.
- `tests/mcp.test.ts`: Vitest suite.

## Endpoint

After deploying, the MCP endpoint is served from the deployment's HTTP actions
domain (`.convex.site`, not `.convex.cloud`):

```
https://YOUR-DEPLOYMENT.convex.site/mcp?api_url=https%3A%2F%2FYOUR-UPSTREAM-ENDPOINT
```

Or pass the upstream through a header (preferred, keeps it out of logs):

```
X-Api-Url: https://YOUR-UPSTREAM-ENDPOINT
```

There is no stored credential and no database.

## Tools

- `execute_command(command)`
- `read_file(path, start_line = 1, end_line?)`
- `write_file(path, content, mode = "insert" | "replace", start_line?, end_line?)`

## Timeouts

The upstream request is aborted after 5 minutes, matching the Go server's
command timeout. Convex actions time out after 10 minutes.

## Development

```bash
npm install
npm test
npm run typecheck
npx convex dev      # first run: log in and create/select a project
npm run deploy      # npx convex deploy (needs CONVEX_DEPLOY_KEY in CI)
```

## Security

The MCP tools provide arbitrary command execution and file access on the remote
container. Do not point `api_url` at a privileged service you do not intend the
MCP client to control.

Passing `api_url` in the URL can expose it through logs or history. Prefer the
`X-Api-Url` header when the client supports custom headers.

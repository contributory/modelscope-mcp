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

## Tools

- `execute_command(command, wait_seconds = 20)` — wait up to `wait_seconds`
  (max 240). Returns the command output if it finishes in time; otherwise the
  command keeps running and a `job_id` is returned.
- `get_job(job_id, wait_seconds = 20)` — wait again for a background job.
  Still running → `job_id` plus output so far.
- `cancel_job(job_id)` — kill the command and its child processes.
- `read_file(path, start_line = 1, end_line?)`
- `write_file(path, content, mode = "insert" | "replace", start_line?, end_line?)`

## Timeouts

`execute_command` / `get_job` wait at most 240 seconds before returning a
`job_id`. The Go server kills a command after 5 minutes. The MCP → upstream
HTTP request is aborted after 5 minutes. Convex actions time out after 10
minutes.

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

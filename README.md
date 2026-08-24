# modelscope-mcp

`ContainerAgent` is a stateless Streamable HTTP MCP server. It proxies container
operations to an upstream agent service and Base64-encodes request and response
payloads.

The project provides two entry points:

- `server.js`: a standalone Node.js HTTP server.
- `deno-server.js`: a web-standard Deno handler exported as a default function.

## Requirements

- Node.js 20 or newer for `server.js`.
- A Deno-compatible serverless runtime for `deno-server.js`.
- An upstream agent endpoint supplied through the `API_URL` environment
  variable. No upstream endpoint is embedded in the source code.

## Installation

Install the Node.js dependencies:

```bash
npm install
```

## Node.js server

Set `API_URL` in the deployment environment, then start the server:

```bash
npm start
```

The MCP endpoint is exposed at `/mcp`.

### Environment variables

| Variable  | Required | Default   | Description |
| --------- | -------- | --------- | ----------- |
| `API_URL` | Yes      | None      | Upstream agent action endpoint. |
| `HOST`    | No       | `0.0.0.0` | HTTP bind address. |
| `PORT`    | No       | `8080`    | HTTP listening port. |

## Deno handler

`deno-server.js` exports the request handler directly:

```js
export default async function handler(request) {
  // Returns a web-standard Response.
}
```

Configure `API_URL` as a deployment environment variable. The host platform
must route MCP requests to `/mcp`.

## Tools

- `execute_command(command)`: executes a shell command in the container and
  returns its output.
- `read_file(path, start_line = 1, end_line?)`: reads an inclusive, one-based
  line range from a UTF-8 text file.
- `write_file(path, content, mode = "insert" | "replace", start_line?, end_line?)`:
  inserts content or replaces an inclusive line range.

## Testing

Start the Node.js server and run the MCP protocol client:

```bash
npm test
```

Use `MCP_URL` to point the test client at a different MCP deployment. The test
initializes the server, lists its tools, executes a command, and reads a file.

## Security

- Keep `API_URL` in the deployment environment rather than source control.
- The tools provide command execution and file access. Deploy the server only
  in an isolated container and restrict access to the MCP endpoint.
- Use authentication and authorization at the gateway before exposing the
  server publicly.

import { httpActionGeneric, httpRouter } from "convex/server";
import { handleMcpRequest } from "./mcp";

const http = httpRouter();

// Served at https://<deployment>.convex.site/mcp
const mcp = httpActionGeneric(async (_ctx, request) => handleMcpRequest(request));

// The endpoint is stateless and POST-only; GET/DELETE get a 405 with an Allow header.
for (const method of ["POST", "GET", "DELETE", "OPTIONS"] as const) {
  http.route({ path: "/mcp", method, handler: mcp });
}

export default http;

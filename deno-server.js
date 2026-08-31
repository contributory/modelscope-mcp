import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@4.1.13";

const SERVER_NAME = "ContainerAgent";
const SERVER_VERSION = "1.0.0";

function toNullable(value) {
	return value === undefined ? null : value;
}

function encodeBase64(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary);
}

function decodeBase64(value) {
	const binary = atob(value);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

async function sendAction(action, kwargs, apiUrl) {
	if (!apiUrl) {
		return "Error: X-Api-Url header is not configured";
	}

	const payload = encodeBase64(JSON.stringify({ action, kwargs }));

	try {
		const response = await fetch(apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
			},
			body: JSON.stringify({ payload }),
		});

		if (!response.ok) {
			return `Error communicating with API: HTTP ${response.status} ${response.statusText}`;
		}

		const data = await response.json();

		if (!("response" in data)) {
			return `Error: Invalid response format ${JSON.stringify(data)}`;
		}

		const result = JSON.parse(decodeBase64(data.response));
		if ("error" in result) {
			return `Error: ${result.error}`;
		}

		return result.result ?? "";
	} catch (error) {
		return `Error communicating with API: ${error?.message || error}`;
	}
}

function createMcpServer(apiUrl) {
	const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

	mcp.registerTool(
		"execute_command",
		{
			description: "Execute a shell command inside the container and return output.",
			inputSchema: z.object({
				command: z.string(),
			}),
		},
		async ({ command }) => ({
			content: [
				{ type: "text", text: await sendAction("execute", { command }, apiUrl) },
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
					}, apiUrl),
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
					}, apiUrl),
				},
			],
		}),
	);

	return mcp;
}

export default async function handler(request) {
	const { pathname } = new URL(request.url);

	if (pathname !== "/mcp") {
		return Response.json(
			{ error: `Not found: ${request.method} ${pathname}` },
			{ status: 404 },
		);
	}

	try {
		const url = new URL(request.url);
		const apiUrl = request.headers.get("X-Api-Url") ?? url.searchParams.get("api_url");
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		const mcp = createMcpServer(apiUrl);

		await mcp.connect(transport);
		return await transport.handleRequest(request);
	} catch (error) {
		console.error("Error handling MCP request:", error);
		return Response.json(
			{
				jsonrpc: "2.0",
				error: { code: -32603, message: "Internal server error" },
				id: null,
			},
			{ status: 500 },
		);
	}
}

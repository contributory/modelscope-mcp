import base64
import json

import anvil
import anvil.server
import requests


SERVER_NAME = "ContainerAgent"
SERVER_VERSION = "1.0.0"
LATEST_PROTOCOL_VERSION = "2025-11-25"
SUPPORTED_PROTOCOL_VERSIONS = (
    LATEST_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
    "2024-10-07",
)
UPSTREAM_TIMEOUT_SECONDS = 24
MODELSCOPE_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0 Safari/537.36"
)

TOOLS = [
    {
        "name": "execute_command",
        "description": "Execute a shell command inside the container and return output.",
        "inputSchema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
            "additionalProperties": False,
        },
    },
    {
        "name": "read_file",
        "description": (
            "Read an inclusive line range from a UTF-8 text file.\n\n"
            "Line numbers are 1-based. If end_line is omitted, read through EOF."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "start_line": {"type": "integer", "default": 1},
                "end_line": {"type": "integer"},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "write_file",
        "description": (
            "Insert content or replace an inclusive range in a UTF-8 text file.\n\n"
            "Insert is the default mode. Without start_line, insert appends to EOF; "
            "otherwise it inserts before start_line. Insert mode does not use "
            "end_line.\n\nReplace mode overwrites the whole file when no range is "
            "provided. With only start_line, it replaces from that line through EOF. "
            "With both line parameters, it replaces the inclusive range."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "mode": {
                    "type": "string",
                    "enum": ["insert", "replace"],
                    "default": "insert",
                },
                "start_line": {"type": "integer"},
                "end_line": {"type": "integer"},
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
    },
]


def _headers_lower(headers):
    return {str(name).lower(): value for name, value in (headers or {}).items()}


def _last_query_value(value):
    if isinstance(value, (list, tuple)):
        return value[-1] if value else None
    return value


def _get_api_url(request):
    headers = _headers_lower(request.headers)
    header_value = headers.get("x-api-url")
    if header_value:
        return str(header_value)

    query_value = _last_query_value((request.query_params or {}).get("api_url"))
    return str(query_value) if query_value else None


def _json_response(payload, status=200, extra_headers=None):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )
    headers = {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    return anvil.server.HttpResponse(
        status=status,
        body=anvil.BlobMedia("application/json", body),
        headers=headers,
    )


def _empty_response(status=202, extra_headers=None):
    headers = {"Cache-Control": "no-store"}
    if extra_headers:
        headers.update(extra_headers)
    return anvil.server.HttpResponse(status=status, body="", headers=headers)


def _rpc_result(request_id, result):
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _rpc_error(request_id, code, message, data=None):
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def _read_json_body(request):
    if request.body is None:
        raise ValueError("Request body is empty")
    raw = request.body.get_bytes()
    if not raw:
        raise ValueError("Request body is empty")
    return json.loads(raw.decode("utf-8"))


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _optional_int(arguments, name):
    value = arguments.get(name)
    if value is None:
        return None
    if not _is_int(value):
        raise ValueError(f"{name} must be an integer")
    return value


def _required_string(arguments, name):
    value = arguments.get(name)
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    return value


def _send_action(action, kwargs, api_url):
    if not api_url:
        return "Error: X-Api-Url header or api_url query parameter is not configured"

    payload_json = json.dumps(
        {"action": action, "kwargs": kwargs},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    payload_b64 = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

    try:
        response = requests.post(
            api_url,
            headers={
                "Content-Type": "application/json",
                "User-Agent": MODELSCOPE_USER_AGENT,
            },
            json={"payload": payload_b64},
            allow_redirects=False,
            timeout=UPSTREAM_TIMEOUT_SECONDS,
        )
        if not response.ok:
            return (
                "Error communicating with API: "
                f"HTTP {response.status_code} {response.reason}"
            )

        data = response.json()
        encoded_response = data.get("response")
        if not isinstance(encoded_response, str):
            return f"Error: Invalid response format {json.dumps(data)}"

        decoded = base64.b64decode(encoded_response).decode("utf-8")
        result = json.loads(decoded)
        if "error" in result:
            return f"Error: {result['error']}"
        return result.get("result") or ""
    except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError) as error:
        return f"Error communicating with API: {error}"


def _tool_call(name, arguments, api_url):
    if not isinstance(arguments, dict):
        raise ValueError("arguments must be an object")

    if name == "execute_command":
        command = _required_string(arguments, "command")
        text = _send_action("execute", {"command": command}, api_url)
    elif name == "read_file":
        path = _required_string(arguments, "path")
        start_line = arguments.get("start_line", 1)
        if not _is_int(start_line):
            raise ValueError("start_line must be an integer")
        end_line = _optional_int(arguments, "end_line")
        text = _send_action(
            "read_file",
            {
                "path": path,
                "start_line": start_line,
                "end_line": end_line,
            },
            api_url,
        )
    elif name == "write_file":
        path = _required_string(arguments, "path")
        content = _required_string(arguments, "content")
        mode = arguments.get("mode", "insert")
        if mode not in {"insert", "replace"}:
            raise ValueError("mode must be 'insert' or 'replace'")
        start_line = _optional_int(arguments, "start_line")
        end_line = _optional_int(arguments, "end_line")
        text = _send_action(
            "write_file",
            {
                "path": path,
                "content": content,
                "mode": mode,
                "start_line": start_line,
                "end_line": end_line,
            },
            api_url,
        )
    else:
        raise KeyError(name)

    return {"content": [{"type": "text", "text": str(text)}]}


def _handle_rpc(message, api_url):
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _rpc_error(None, -32600, "Invalid Request")

    method = message.get("method")
    request_id = message.get("id")
    is_notification = "id" not in message

    if not isinstance(method, str):
        return None if is_notification else _rpc_error(request_id, -32600, "Invalid Request")

    if is_notification:
        # Stateless MCP still receives lifecycle/cancellation notifications.
        return None

    params = message.get("params") or {}
    if not isinstance(params, dict):
        return _rpc_error(request_id, -32602, "Invalid params")

    if method == "initialize":
        requested = params.get("protocolVersion")
        negotiated = (
            requested
            if requested in SUPPORTED_PROTOCOL_VERSIONS
            else LATEST_PROTOCOL_VERSION
        )
        return _rpc_result(
            request_id,
            {
                "protocolVersion": negotiated,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        )

    if method == "ping":
        return _rpc_result(request_id, {})

    if method == "tools/list":
        return _rpc_result(request_id, {"tools": TOOLS})

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str):
            return _rpc_error(request_id, -32602, "Tool name must be a string")
        try:
            result = _tool_call(name, arguments, api_url)
            return _rpc_result(request_id, result)
        except KeyError:
            return _rpc_error(request_id, -32602, f"Unknown tool: {name}")
        except ValueError as error:
            return _rpc_error(request_id, -32602, str(error))

    return _rpc_error(request_id, -32601, f"Method not found: {method}")


@anvil.server.route(
    "/mcp",
    methods=["POST", "GET", "DELETE", "OPTIONS"],
    enable_cors=False,
)
def modelscope_mcp(**_params):
    request = anvil.server.request

    if request.method == "OPTIONS":
        return _empty_response(
            204,
            {
                "Allow": "POST, OPTIONS",
            },
        )

    if request.method != "POST":
        return _json_response(
            {"error": "Stateless MCP endpoint accepts POST requests only"},
            status=405,
            extra_headers={"Allow": "POST, OPTIONS"},
        )

    try:
        payload = _read_json_body(request)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return _json_response(_rpc_error(None, -32700, "Parse error"), status=400)

    api_url = _get_api_url(request)

    if isinstance(payload, list):
        if not payload:
            return _json_response(_rpc_error(None, -32600, "Invalid Request"), status=400)
        responses = []
        for message in payload:
            response = _handle_rpc(message, api_url)
            if response is not None:
                responses.append(response)
        return _json_response(responses) if responses else _empty_response()

    response = _handle_rpc(payload, api_url)
    if response is None:
        return _empty_response()
    return _json_response(response)

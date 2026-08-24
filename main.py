import os
import json
import base64
import requests
from typing import Literal
from fastmcp import FastMCP

mcp = FastMCP("ContainerAgent")

# API URL for the Docker container (replace with actual Docker container address if running elsewhere)
API_URL = os.environ.get("API_URL", "http://127.0.0.1:8000/action")


def send_action(action: str, kwargs: dict) -> str:
    payload_dict = {"action": action, "kwargs": kwargs}
    payload_json = json.dumps(payload_dict)
    payload_b64 = base64.b64encode(payload_json.encode("utf-8")).decode("utf-8")

    try:
        resp = requests.post(API_URL, json={"payload": payload_b64})
        resp.raise_for_status()
        resp_data = resp.json()

        if "response" in resp_data:
            decoded_resp = base64.b64decode(resp_data["response"]).decode("utf-8")
            res_dict = json.loads(decoded_resp)
            if "error" in res_dict:
                return f"Error: {res_dict['error']}"
            return res_dict.get("result", "")
        else:
            return f"Error: Invalid response format {resp_data}"
    except Exception as e:
        return f"Error communicating with API: {e}"


@mcp.tool()
def execute_command(command: str) -> str:
    """Execute a shell command inside the container and return output."""
    return send_action("execute", {"command": command})


@mcp.tool()
def read_file(path: str, start_line: int = 1, end_line: int | None = None) -> str:
    """Read an inclusive line range from a UTF-8 text file.

    Line numbers are 1-based. If end_line is omitted, read through EOF.
    """
    return send_action(
        "read_file", {"path": path, "start_line": start_line, "end_line": end_line}
    )


@mcp.tool()
def write_file(
    path: str,
    content: str,
    mode: Literal["insert", "replace"] = "insert",
    start_line: int | None = None,
    end_line: int | None = None,
) -> str:
    """Insert content or replace an inclusive range in a UTF-8 text file.

    Insert is the default mode. Without start_line, insert appends to EOF;
    otherwise it inserts before start_line. Insert mode does not use end_line.

    Replace mode overwrites the whole file when no range is provided. With
    only start_line, it replaces from that line through EOF. With both line
    parameters, it replaces the inclusive range.
    """
    return send_action(
        "write_file",
        {
            "path": path,
            "content": content,
            "mode": mode,
            "start_line": start_line,
            "end_line": end_line,
        },
    )


app = mcp.http_app(transport="streamable-http")

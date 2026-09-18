import base64
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "server_code" / "ModelScopeMCP.py"


class FakeBlobMedia:
    def __init__(self, content_type, content, name=None):
        self.content_type = content_type
        self.content = content
        self.name = name


class FakeHttpResponse:
    def __init__(self, status=200, body="", headers=None):
        self.status = status
        self.body = body
        self.headers = headers or {}


class FakeRoute:
    def __call__(self, *args, **kwargs):
        def decorate(fn):
            return fn

        return decorate


fake_anvil = types.ModuleType("anvil")
fake_server = types.ModuleType("anvil.server")
fake_anvil.BlobMedia = FakeBlobMedia
fake_server.HttpResponse = FakeHttpResponse
fake_server.route = FakeRoute()
fake_server.request = None
fake_anvil.server = fake_server
sys.modules["anvil"] = fake_anvil
sys.modules["anvil.server"] = fake_server

spec = importlib.util.spec_from_file_location("modelscope_mcp_under_test", MODULE_PATH)
mcp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp)


class FakeBody:
    def __init__(self, payload):
        self.payload = payload

    def get_bytes(self):
        return self.payload


class FakeRequest:
    def __init__(self, method="POST", payload=None, headers=None, query_params=None):
        self.method = method
        self.headers = headers or {}
        self.query_params = query_params or {}
        self.body = None if payload is None else FakeBody(
            json.dumps(payload).encode("utf-8")
        )


def response_json(response):
    return json.loads(response.body.content.decode("utf-8"))


class ModelScopeMCPTest(unittest.TestCase):
    def call_route(self, request):
        fake_server.request = request
        return mcp.modelscope_mcp()

    def test_initialize_negotiates_supported_protocol(self):
        response = self.call_route(
            FakeRequest(
                payload={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "test", "version": "1"},
                    },
                }
            )
        )
        self.assertEqual(response.status, 200)
        result = response_json(response)["result"]
        self.assertEqual(result["protocolVersion"], "2025-11-25")
        self.assertEqual(result["serverInfo"]["name"], "ContainerAgent")
        self.assertIn("tools", result["capabilities"])

    def test_tools_list_preserves_three_tools(self):
        response = self.call_route(
            FakeRequest(
                payload={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {},
                }
            )
        )
        tools = response_json(response)["result"]["tools"]
        self.assertEqual(
            [tool["name"] for tool in tools],
            ["execute_command", "read_file", "write_file"],
        )

    def test_header_api_url_has_priority(self):
        request = FakeRequest(
            headers={"X-Api-Url": "https://header.example/run"},
            query_params={"api_url": "https://query.example/run"},
        )
        self.assertEqual(mcp._get_api_url(request), "https://header.example/run")

    def test_notification_returns_202_without_json_body(self):
        response = self.call_route(
            FakeRequest(
                payload={
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                }
            )
        )
        self.assertEqual(response.status, 202)
        self.assertEqual(response.body, "")

    @patch.object(mcp.requests, "post")
    def test_execute_command_uses_base64_gateway_contract(self, post):
        upstream_payload = base64.b64encode(
            json.dumps({"result": "mcp-is-real\n"}).encode("utf-8")
        ).decode("ascii")
        post.return_value.ok = True
        post.return_value.json.return_value = {"response": upstream_payload}

        response = self.call_route(
            FakeRequest(
                query_params={"api_url": "https://gateway.example/run"},
                payload={
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        "name": "execute_command",
                        "arguments": {"command": "echo mcp-is-real"},
                    },
                },
            )
        )

        rpc = response_json(response)
        self.assertEqual(rpc["result"]["content"][0]["text"], "mcp-is-real\n")

        request_json = post.call_args.kwargs["json"]
        decoded = json.loads(
            base64.b64decode(request_json["payload"]).decode("utf-8")
        )
        self.assertEqual(
            decoded,
            {"action": "execute", "kwargs": {"command": "echo mcp-is-real"}},
        )

    def test_invalid_tool_arguments_return_jsonrpc_error(self):
        response = self.call_route(
            FakeRequest(
                payload={
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {
                        "name": "read_file",
                        "arguments": {"path": "/tmp/a", "start_line": "1"},
                    },
                }
            )
        )
        rpc = response_json(response)
        self.assertEqual(rpc["error"]["code"], -32602)


if __name__ == "__main__":
    unittest.main()

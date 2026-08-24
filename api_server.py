import os
import json
import base64
import subprocess
from typing import Literal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI()

class PayloadRequest(BaseModel):
    payload: str  # Base64 encoded JSON string

class PayloadResponse(BaseModel):
    response: str # Base64 encoded JSON string

def execute_command_local(command: str) -> str:
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return "Command timed out"
    except OSError as e:
        return str(e)

def read_file_local(path: str, start_line: int = 1, end_line: int | None = None) -> str:
    try:
        if start_line < 1:
            return "Error: start_line must be at least 1"
        if end_line is not None and end_line < start_line:
            return "Error: end_line must be greater than or equal to start_line"

        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        if start_line > len(lines) and lines:
            return f"Error: start_line exceeds file length ({len(lines)} lines)"

        return "".join(lines[start_line - 1 : end_line])
    except (OSError, UnicodeError) as e:
        return str(e)

def write_file_local(
    path: str,
    content: str,
    mode: Literal["insert", "replace"] = "insert",
    start_line: int | None = None,
    end_line: int | None = None,
) -> str:
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

        if start_line is not None and start_line < 1:
            return "Error: start_line must be at least 1"
        if end_line is not None and start_line is None:
            return "Error: start_line is required when end_line is provided"
        if end_line is not None and start_line is not None and end_line < start_line:
            return "Error: end_line must be greater than or equal to start_line"

        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except FileNotFoundError:
            lines = []

        if mode == "insert":
            if end_line is not None:
                return "Error: end_line is not used in insert mode"

            insert_at = len(lines) if start_line is None else start_line - 1
            if insert_at > len(lines):
                return f"Error: start_line exceeds append position ({len(lines) + 1})"

            if content and insert_at > 0 and not lines[insert_at - 1].endswith(("\n", "\r")):
                lines[insert_at - 1] += "\n"

            insertion = content
            if insertion and insert_at < len(lines) and not insertion.endswith(("\n", "\r")):
                insertion += "\n"
            lines.insert(insert_at, insertion)

            with open(path, "w", encoding="utf-8") as f:
                f.writelines(lines)

            location = "EOF" if start_line is None else f"before line {start_line}"
            return f"Successfully inserted content {location} in {path}"

        if start_line is None:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Successfully replaced the entire file {path}"

        if not lines:
            if start_line != 1:
                return "Error: start_line exceeds append position (1)"
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Successfully replaced content from line 1 in {path}"

        if start_line > len(lines):
            return f"Error: start_line exceeds file length ({len(lines)} lines)"

        replace_through = len(lines) if end_line is None else end_line
        if replace_through > len(lines):
            return f"Error: end_line exceeds file length ({len(lines)} lines)"

        replacement = content.splitlines(keepends=True)
        if replacement and replace_through < len(lines) and not replacement[-1].endswith(("\n", "\r")):
            replacement[-1] += "\n"
        lines[start_line - 1 : replace_through] = replacement

        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)

        return f"Successfully replaced lines {start_line}-{replace_through} in {path}"
    except (OSError, UnicodeError) as e:
        return str(e)

@app.post("/action")
def perform_action(req: PayloadRequest):
    try:
        decoded_bytes = base64.b64decode(req.payload)
        data = json.loads(decoded_bytes.decode('utf-8'))
        action = data.get('action')
        kwargs = data.get('kwargs', {})

        if action == "execute":
            res = execute_command_local(**kwargs)
        elif action == "read_file":
            res = read_file_local(**kwargs)
        elif action == "write_file":
            res = write_file_local(**kwargs)
        else:
            res = f"Unknown action: {action}"

        response_json = json.dumps({"result": res})
        encoded_response = base64.b64encode(response_json.encode('utf-8')).decode('utf-8')
        return PayloadResponse(response=encoded_response)

    except Exception as e:
        error_json = json.dumps({"error": str(e)})
        encoded_error = base64.b64encode(error_json.encode('utf-8')).decode('utf-8')
        return PayloadResponse(response=encoded_error)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)

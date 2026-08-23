import os
import subprocess
from typing import Literal

from fastmcp import FastMCP

mcp = FastMCP("ContainerAgent")


@mcp.tool()
def execute_command(command: str) -> str:
    """Execute a shell command inside the container and return output."""
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


@mcp.tool()
def read_file(path: str, start_line: int = 1, end_line: int | None = None) -> str:
    """Read an inclusive line range from a UTF-8 text file.

    Line numbers are 1-based. If end_line is omitted, read through EOF.
    """
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))

    mcp.run(transport="streamable-http", host="127.0.0.1", port=port)
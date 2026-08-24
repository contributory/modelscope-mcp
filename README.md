# modelscope-mcp (Node.js)

MCP server (`ContainerAgent`) chuyển tiếp các hành động trong container (`execute`, `read_file`, `write_file`) tới một agent API từ xa. Toàn bộ payload được mã hóa base64 trước khi gửi.

Đã chuyển từ Python (FastMCP) sang Node.js dùng [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) với transport **Streamable HTTP** (stateless).

## Cài đặt

```bash
npm install
```

Yêu cầu Node.js >= 20.

## Chạy

```bash
npm start
```

Server lắng nghe tại `/mcp`.

### Biến môi trường

| Biến      | Mặc định                    | Mô tả                                              |
| --------- | --------------------------- | -------------------------------------------------- |
| `API_URL` | `http://127.0.0.1:8000/action` | Địa chỉ API của container/agent cần gọi          |
| `HOST`    | `0.0.0.0`                   | Địa chỉ bind (Wasmer Edge yêu cầu `0.0.0.0`)       |
| `PORT`    | `8080`                      | Cổng HTTP                                          |

Ví dụ:

```bash
API_URL=http://agent:8000/action PORT=3000 npm start
```

## Tools

- `execute_command(command)` — chạy shell command trong container và trả về output.
- `read_file(path, start_line = 1, end_line?)` — đọc khoảng dòng (1-based) của file UTF-8.
- `write_file(path, content, mode = "insert" | "replace", start_line?, end_line?)` — chèn nội dung hoặc thay thế một khoảng dòng trong file.

## Kiểm tra nhanh

```bash
curl -X POST http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

# A2UI over MCP Apps Dual-Mode Server

Python MCP server demonstrating dynamic dual-mode delivery of A2UI interfaces and fallback sandboxed MCP Apps.

## Usage

```bash
uv run server.py --transport sse --port 8000
```

## Running Tests

```bash
uv run --with pytest pytest test_server.py
```

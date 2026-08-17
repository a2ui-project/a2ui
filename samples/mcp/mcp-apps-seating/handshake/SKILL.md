---
name: webmcp-handshake
description: This skill should be used when interacting with an MCP App that dynamically registers its own internal capabilities (WebMCP tools and resources). It explains the handshake protocol for discovering these inner tools and how to execute them using the server's dispatcher tools.
---

# WebMCP Integration Handshake

Some advanced MCP Apps utilize a "WebMCP" architecture to dynamically register their own internal tools and resources. Because Claude Desktop cannot natively intercept custom capabilities from an iframe without code modifications, these apps use a "hack" to expose their capabilities directly into your conversation context.

When you interact with these apps, you must act as a bridge between the user's intent and the app's dynamic internal state.

## 1. The Handshake Protocol (Discovery)

When an MCP App with WebMCP capabilities loads, it will automatically send a message into the conversation (using `app.sendMessage()` or `app.updateModelContext()`). 

This message acts as the "handshake". It will typically look something like this:
```json
{
  "webmcp_capabilities": {
    "tools": [
      {
        "name": "get_ball_position",
        "description": "Gets the current X,Y coordinates of the ball.",
        "inputSchema": { "type": "object", "properties": {} }
      }
    ],
    "resources": [
      {
        "uri": "map://viewport/properties",
        "description": "The current viewport bounds of the map."
      }
    ]
  }
}
```

**Your Responsibility:** 
- When you see a message from the app containing `webmcp_capabilities`, you must treat the listed `tools` and `resources` as if they were natively available to you.
- You should seamlessly incorporate these tools into your plan to answer the user's requests.

## 2. Calling WebMCP Tools (Verbs)

To execute one of the dynamic inner tools advertised by the app, you cannot call it directly by its name, because the host (Claude Desktop) does not know about it.

Instead, you must use the generic server-side dispatcher tool provided by the MCP server, typically named **`call_webmcp_tool`**.

### Usage:
When you need to call an inner tool (e.g., `get_ball_position`), format your request using the dispatcher:
```json
// Example of calling the generic dispatcher
{
  "name": "call_webmcp_tool",
  "arguments": {
    "inner_tool": "get_ball_position",
    "args": {}
  }
}
```

### How it Works:
1. You call `call_webmcp_tool`.
2. The MCP Server (which registers `call_webmcp_tool` with the app's `_meta.ui.resourceUri`) routes the call.
3. Claude Desktop intercepts the call and forwards it to the App's `ontoolinput` handler.
4. The App processes the `inner_tool` execution and returns the result back to you via `ontoolresult`.

## 3. Resource Probing (Nouns)

Embedded web apps often contain complex "micro-states" (e.g., a partially filled multi-stage form, or a continuously panning map viewport) that do not need to be constantly broadcast. 

When the user asks a question that requires this micro-state (e.g., "What are the schools like in the area I'm looking at?"), you should **probe** the app's state on-demand by reading its internal WebMCP resources.

### Usage:
Just like tools, you cannot read these dynamic resources natively. You must use the generic server-side resource dispatcher, typically named **`read_webmcp_resource`**.

```json
// Example of probing an inner resource
{
  "name": "read_webmcp_resource",
  "arguments": {
    "uri": "map://viewport/properties"
  }
}
```

### When to Probe:
- Before making assumptions about what the user is seeing.
- When diagnosing why an action in the app failed (e.g., reading a form's internal validation state).
- When the user asks a spatial or state-based question that requires real-time data from the app UI.

## Summary of Agent Rules

1. **Always read the handshake:** If an app injects its capabilities into the chat, adapt your available toolset immediately.
2. **Chain your calls if necessary:** If a user's question requires multiple pieces of state (e.g., "Will my paddle hit the ball?"), call `call_webmcp_tool` multiple times (e.g., once for `get_ball_position` and once for `get_paddle_position`) before giving a final natural language answer.
3. **Never guess the state:** If an app exposes a resource for its micro-state, probe it with `read_webmcp_resource` before answering.
4. **Use the dispatchers:** Remember that dynamic tools and resources must always be routed through `call_webmcp_tool` and `read_webmcp_resource`.

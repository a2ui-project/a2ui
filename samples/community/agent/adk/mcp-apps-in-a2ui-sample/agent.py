# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import json
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Read HTML from file
html_path = os.path.join(os.path.dirname(__file__), "mcp_app.html")
with open(html_path, "r") as f:
  MCP_APP_HTML = f.read()


@app.post("/a2a")
async def handle_a2a(request: Request):
  body = await request.json()
  print("Received A2A request:", body)

  req_id = body.get("id")

  # Check if it's a request to load the app or an action
  params = body.get("params", {})
  message = params.get("message", {})
  parts = message.get("parts", [])

  req_text = ""
  user_action = {}

  if parts:
    part = parts[0]
    if part.get("kind") == "data":
      data = part.get("data", {})
      req_text = data.get("request", "")
      user_action = data.get("userAction", {})

  if req_text == "Load MCP App":
    # Return the surface with the McpApp component
    response_data = [
        {"beginRendering": {"surfaceId": "mcp-surface", "root": "mcp-app-root"}},
        {
            "surfaceUpdate": {
                "surfaceId": "mcp-surface",
                "components": [{
                    "id": "mcp-app-root",
                    "component": {
                        "McpApp": {
                            "resourceUri": "custom://mcp-sample-app",
                            "htmlContent": MCP_APP_HTML,
                            "allowedTools": ["trigger_agent_action"],
                        }
                    },
                }],
            }
        },
    ]
    return JSONResponse(
        content={
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "kind": "task",
                "status": {"message": {"parts": response_data}},
            },
        }
    )

  elif user_action.get("name") == "trigger_agent_action":
    # Handle the tool call forwarded by the client
    context = user_action.get("context", {})
    print("Agent handling trigger_agent_action with context:", context)

    # Return a response that might update the UI or just confirm
    response_data = [
        {
            "beginRendering": {
                "surfaceId": "mcp-response-surface",
                "root": "mcp-response-root",
            }
        },
        {
            "surfaceUpdate": {
                "surfaceId": "mcp-response-surface",
                "components": [{
                    "id": "mcp-response-root",
                    "component": {
                        "Text": {
                            "text": {
                                "literalString": (
                                    "Agent processed action: " + json.dumps(context)
                                )
                            }
                        }
                    },
                }],
            }
        },
    ]
    print("Agent responding with:", {"jsonrpc": "2.0", "id": req_id, "result": "..."})
    return JSONResponse(
        content={
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "kind": "task",
                "status": {"message": {"parts": response_data}},
            },
        }
    )

  # Default fallback
  return JSONResponse(
      content={
          "jsonrpc": "2.0",
          "id": req_id,
          "result": {
              "kind": "task",
              "status": {
                  "message": {
                      "parts": [
                          {"kind": "text", "text": "I'm not sure how to handle that."}
                      ]
                  }
              },
          },
      }
  )


@app.get("/.well-known/agent-card.json")
async def handle_card():
  return {"url": "http://localhost:8000/a2a", "endpoint": "http://localhost:8000/a2a"}


if __name__ == "__main__":
  uvicorn.run(app, host="0.0.0.0", port=8000)

# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Concise FastAPI server demonstrating A2UI Templates expansion with Agent SDK."""

import json
import os
import glob
from pathlib import Path
from typing import Any, Dict, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types

from a2ui.template import Template, A2uiTemplateManager

app = FastAPI(title="A2UI Templates Community Demo Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_headers=["*"],
    allow_methods=["*"],
)

MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


def load_templates() -> List[Template]:
    """Loads all example template definitions."""
    current_file = Path(__file__).resolve()
    repo_root = current_file.parents[3]
    examples_pattern = str(
        repo_root
        / "agent_sdks"
        / "python"
        / "a2ui_agent"
        / "src"
        / "a2ui"
        / "template"
        / "examples"
        / "*.json"
    )
    templates = []
    for path in glob.glob(examples_pattern):
        templates.append(Template.from_json_file(path))
    return templates


templates = load_templates()
manager = A2uiTemplateManager(
    templates=templates,
    surface_id="main",
    version="0.9.1",
)

SYSTEM_PROMPT = manager.prompt_generator.generate(
    role_description="You are an A2UI assistant. Respond to requests using compact A2UI Express DSL.",
    include_schema=True,
)


class ChatRequest(BaseModel):
    prompt: str
    surfaceId: str = "surface_1"
    conversationId: str = "default_conv"


PRESET_RESPONSES = {
    "show user profile": """
    <a2ui>
    root = UserProfile("usr_101", "Alice Smith", "Lead Architect")
    </a2ui>
    """,
    "show team roster": """
    <a2ui>
    team1 = TeamCard("Core Architecture", [
        {userId: "u1", userName: "Dr. Elena Vance", role: "Principal Architect"},
        {userId: "u2", userName: "Marcus Vance", role: "Streaming Lead"}
    ])
    team2 = TeamCard("Design Systems", [
        {userId: "u3", userName: "Aria Chen", role: "Head of Design"},
        {userId: "u4", userName: "Liam Kjell", role: "Senior Engineer"}
    ])
    root = TeamRoster("Organization Directory", [team1, team2])
    </a2ui>
    """,
    "show team goals": """
    <a2ui>
    root = TeamGoalList("Core Protocol Engineering", [
        {title: "Deliver synchronous template expansion engine", priority: "High", targetDate: "2026-08-30"},
        {title: "Redesign templates for Basic Catalog", priority: "High", targetDate: "2026-08-15"},
        {title: "Simplify community demo architectures", priority: "Medium", targetDate: "2026-09-01"}
    ])
    </a2ui>
    """,
    "show feedback board": """
    <a2ui>
    root = TeamFeedbackBoard("Frontend & Protocols Guild", [
        {author: "Dr. Elena Vance", note: "Synchronous template expansion eliminated all streaming race conditions.", rating: 5},
        {author: "Marcus Vance", note: "Standard Basic Catalog components ensure 100% cross-renderer compatibility.", rating: 5}
    ])
    </a2ui>
    """,
    "show competency panel": """
    <a2ui>
    root = TeamMemberKnowledgePanel("Alice Smith", "Lead Systems Architect", 9, 142)
    </a2ui>
    """,
}


@app.get("/templates")
def list_templates():
    return [{"id": t.template_id, "parameters": t.parameters} for t in templates]


@app.post("/interact")
@app.post("/api/chat")
async def chat(req: ChatRequest):
    prompt_lower = req.prompt.strip().lower()

    # 1. Preset shortcut responses for instant offline evaluation
    if prompt_lower in PRESET_RESPONSES:
        dsl = PRESET_RESPONSES[prompt_lower]
        target_manager = A2uiTemplateManager(
            templates=templates,
            surface_id=req.surfaceId,
            version="0.9.1",
        )
        parts = target_manager.parser.parse_response(dsl)
        messages = parts[0].a2ui_json if parts and parts[0].a2ui_json else []
        return {
            "messages": messages,
            "raw": dsl.strip(),
            "text": f"Here is the rendered {req.prompt}:",
            "surfaceId": req.surfaceId,
        }

    # 2. Live Gemini inference if API key is provided
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            response = await client.aio.models.generate_content(
                model=MODEL_NAME,
                contents=[req.prompt],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="text/plain",
                ),
            )
            raw_text = response.text or ""
            target_manager = A2uiTemplateManager(
                templates=templates,
                surface_id=req.surfaceId,
                version="0.9.1",
            )
            parts = target_manager.parser.parse_response(raw_text)
            messages = []
            text_parts = []
            for part in parts:
                if part.text:
                    text_parts.append(part.text)
                if part.a2ui_json:
                    messages.extend(part.a2ui_json)

            # Detect the surfaceId created in the messages
            created_surface_id = req.surfaceId
            for msg in messages:
                if isinstance(msg, dict) and "createSurface" in msg:
                    created_surface_id = msg["createSurface"].get("surfaceId", req.surfaceId)
                    break

            return {
                "messages": messages,
                "raw": raw_text,
                "text": "\n".join(text_parts).strip() or "Here is the response:",
                "surfaceId": created_surface_id,
            }
        except Exception as e:
            return {
                "error": str(e),
                "messages": [
                    {
                        "version": "v0.9.1",
                        "createSurface": {"surfaceId": req.surfaceId, "catalogId": BASIC_CATALOG_ID},
                    },
                    {
                        "version": "v0.9.1",
                        "updateComponents": {
                            "surfaceId": req.surfaceId,
                            "components": [
                                {"id": "root", "component": "Card", "child": "err_txt"},
                                {"id": "err_txt", "component": "Text", "text": f"Error: {str(e)}", "variant": "body"},
                            ],
                        },
                    },
                ],
                "surfaceId": req.surfaceId,
            }

    # 3. Fallback when API key is missing
    return {
        "text": "Gemini API key not configured. Click one of the preset template buttons on the left to see instant examples.",
        "messages": [],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)

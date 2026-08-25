# Copyright 2024 Google LLC
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

"""Concise FastAPI server demonstrating A2UI Static and Dynamic Templates with Agent SDK."""

from __future__ import annotations

import glob
import inspect
import json
import os
from pathlib import Path
import time
from typing import Any, Dict, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel

from a2ui.inference_formats.experimental.template import (
    Template,
    StaticTemplate,
    DynamicTemplate,
    Param,
    ParamType,
    TemplateInferenceFormat,
)

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

# Mock Secure HR / Compensation Database
EMPLOYEE_COMPENSATION_DB = {
    "emp_101": {
        "employeeName": "Dr. Elena Vance",
        "role": "Principal Systems Architect",
        "baseSalary": "$215,000",
        "annualBonus": "$45,000",
        "equity": "3,500 RSUs",
        "clearanceLevel": "Level 5 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_102": {
        "employeeName": "Marcus Vance",
        "role": "Streaming & Protocols Lead",
        "baseSalary": "$195,000",
        "annualBonus": "$38,000",
        "equity": "2,800 RSUs",
        "clearanceLevel": "Level 4 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_103": {
        "employeeName": "Aria Chen",
        "role": "Head of Design Systems",
        "baseSalary": "$205,000",
        "annualBonus": "$42,000",
        "equity": "3,100 RSUs",
        "clearanceLevel": "Level 5 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_104": {
        "employeeName": "Liam Kjell",
        "role": "Senior Framework Engineer",
        "baseSalary": "$180,000",
        "annualBonus": "$32,000",
        "equity": "2,200 RSUs",
        "clearanceLevel": "Level 3 - Internal",
        "verifiedAt": "2026-08-13",
    },
}


def fetch_employee_compensation(employeeId: str) -> Dict[str, Any]:
    """Fetches verified confidential compensation package from internal HR database."""
    if employeeId not in EMPLOYEE_COMPENSATION_DB:
        raise ValueError(
            f"Employee ID '{employeeId}' not found in HR compensation records."
            f" Available: {list(EMPLOYEE_COMPENSATION_DB.keys())}"
        )
    return EMPLOYEE_COMPENSATION_DB[employeeId]


def render_payroll_summary(
    department: str = "Global Engineering", includeBonus: bool = True
) -> Dict[str, Any]:
    """Programmatic dynamic template: performs Python math, loops, formatting, and builds an AST table."""
    total_base = 0
    total_bonus = 0
    rows: List[Dict[str, Any]] = []

    for emp_id, record in EMPLOYEE_COMPENSATION_DB.items():
        base_int = int(record["baseSalary"].replace("$", "").replace(",", ""))
        bonus_int = int(record["annualBonus"].replace("$", "").replace(",", ""))
        total_base += base_int
        total_bonus += bonus_int

        cols = [
            {"component": "Text", "text": record["employeeName"], "variant": "body"},
            {"component": "Text", "text": record["role"], "variant": "caption"},
            {"component": "Text", "text": record["baseSalary"], "variant": "body"},
        ]
        if includeBonus:
            cols.append(
                {"component": "Text", "text": record["annualBonus"], "variant": "body"}
            )

        rows.append({
            "component": "Row",
            "justify": "spaceBetween",
            "align": "center",
            "children": cols,
        })
        rows.append({"component": "Divider", "axis": "horizontal"})

    # Header Row
    header_cols = [
        {"component": "Text", "text": "Employee", "variant": "caption"},
        {"component": "Text", "text": "Role", "variant": "caption"},
        {"component": "Text", "text": "Base Salary", "variant": "caption"},
    ]
    if includeBonus:
        header_cols.append(
            {"component": "Text", "text": "Annual Bonus", "variant": "caption"}
        )

    # Total Row
    total_cols = [
        {"component": "Text", "text": "TOTAL PAYROLL", "variant": "h4"},
        {
            "component": "Text",
            "text": f"{len(EMPLOYEE_COMPENSATION_DB)} Employees",
            "variant": "caption",
        },
        {"component": "Text", "text": f"${total_base:,}", "variant": "h4"},
    ]
    if includeBonus:
        total_cols.append(
            {"component": "Text", "text": f"${total_bonus:,}", "variant": "h4"}
        )

    total_budget = total_base + (total_bonus if includeBonus else 0)

    return {
        "component": "Card",
        "child": {
            "component": "Column",
            "children": [
                {
                    "component": "Row",
                    "justify": "spaceBetween",
                    "align": "center",
                    "children": [
                        {
                            "component": "Row",
                            "align": "center",
                            "children": [
                                {"component": "Icon", "name": "lock"},
                                {
                                    "component": "Text",
                                    "text": (
                                        f"Payroll & Compensation Summary: {department}"
                                    ),
                                    "variant": "h3",
                                },
                            ],
                        },
                        {
                            "component": "Text",
                            "text": "Confidential HR Record",
                            "variant": "caption",
                        },
                    ],
                },
                {"component": "Divider", "axis": "horizontal"},
                {
                    "component": "Row",
                    "justify": "spaceBetween",
                    "align": "center",
                    "children": header_cols,
                },
                {"component": "Divider", "axis": "horizontal"},
                *rows,
                {
                    "component": "Row",
                    "justify": "spaceBetween",
                    "align": "center",
                    "children": total_cols,
                },
                {"component": "Divider", "axis": "horizontal"},
                {
                    "component": "Row",
                    "justify": "spaceBetween",
                    "align": "center",
                    "children": [
                        {
                            "component": "Text",
                            "text": (
                                "🔒 Computed live by server Python execution engine"
                            ),
                            "variant": "caption",
                        },
                        {
                            "component": "Text",
                            "text": f"Total Budget: ${total_budget:,}",
                            "variant": "caption",
                        },
                    ],
                },
            ],
        },
    }


def load_templates() -> List[Any]:
    """Loads all static templates and registers dynamic resolver templates."""
    current_file = Path(__file__).resolve()
    templates_dir = current_file.parent / "templates"
    templates_pattern = str(templates_dir / "*.yaml")

    templates_list = []
    salary_layout = None

    for path in glob.glob(templates_pattern):
        loaded_templates = StaticTemplate.from_yaml_file(path)
        for tmpl in loaded_templates:
            if tmpl.template_id == "SalaryCard":
                salary_layout = tmpl
            else:
                templates_list.append(tmpl)

    if salary_layout is not None:
        # Register DynamicTemplate for EmployeeSalaryCard (Data Binding Mode)
        dynamic_salary = DynamicTemplate(
            version="0.1",
            template_id="EmployeeSalaryCard",
            resolver=fetch_employee_compensation,
            layout=salary_layout,
            description=(
                "Secure verified employee compensation card. Pass only the"
                " employeeId ('emp_101', 'emp_102', 'emp_103', 'emp_104');"
                " compensation data is securely fetched server-side from the"
                " HR database."
            ),
            sample_data={"employeeId": "emp_101"},
        )
        templates_list.append(dynamic_salary)

    # Register DynamicTemplate for PayrollSummary (Programmatic Render Mode)
    payroll_template = DynamicTemplate(
        version="0.1",
        template_id="PayrollSummary",
        render=render_payroll_summary,
        description=(
            "Programmatic dynamic template that aggregates company payroll, sums"
            " employee base salaries and bonuses using server Python logic, and builds"
            " an interactive summary table. Pass department (default 'Engineering') and"
            " includeBonus (default True)."
        ),
        sample_data={"department": "Global Engineering", "includeBonus": True},
    )
    templates_list.append(payroll_template)

    return templates_list


templates = load_templates()
format_instance = TemplateInferenceFormat(
    templates=templates,
    surface_id="main",
    version="0.9.1",
)

ROLE_DESCRIPTION = """You are an A2UI interface assistant. When helpful, respond with visual UI using the compact A2UI Express DSL inside `<a2ui>` tags.

Select and present only the UI components that are directly relevant to the user's request. Depending on the query, this may be a single template, a standard primitive, or a custom composed layout that you invent to address the query.

You can compose high-level templates and primitive components together:
- Layout & Containers: `Column`, `Row`, `Card`, `SectionCard(title, description, headerAction, children)`, `TwoColumnLayout(headerChild, leftChildren, rightChildren)`.
- Reusable & Dynamic Templates:
  - `UserProfile(userId, userName, role)` for individual identity cards.
  - `EmployeeSalaryCard(employeeId)` for verified employee compensation. Pass only the employeeId (e.g. "emp_101" for Dr. Elena Vance, "emp_102" for Marcus Vance, "emp_103" for Aria Chen, "emp_104" for Liam Kjell). Confidential compensation data is securely resolved server-side from the HR database.
  - `TeamMemberKnowledgePanel(userName, role, experienceYears, completedTasks)` for stats and skill summaries.
  - `TeamGoalList(teamName, goals)` or `GoalItem(title, priority, targetDate)` for objective tracking.
  - `TeamFeedbackBoard(teamName, feedbacks)` or `FeedbackItem(author, note, rating)` for reviews and retrospectives.
  - `TeamCard(teamName, members)` and `TeamRoster(directoryTitle, children)` for organizational hierarchies.

For complex queries requiring multiple sections (such as a performance review or project status), you can invent appropriate composite layouts—for instance, grouping a `TeamMemberKnowledgePanel`, `TeamFeedbackBoard`, and `TeamGoalList` within a `Column` or `TwoColumnLayout`."""

SYSTEM_PROMPT = format_instance.prompt_generator.generate(
    role_description=ROLE_DESCRIPTION,
    include_schema=True,
)


class ChatRequest(BaseModel):
    prompt: str
    surfaceId: str = "surface_1"
    conversationId: str = "default_conv"


class DynamicResolveRequest(BaseModel):
    params: Dict[str, Any]


PRESET_RESPONSES = {
    "show user profile": (
        """
    <a2ui>
    root = UserProfile("usr_101", "Alice Smith", "Lead Architect")
    </a2ui>
    """
    ),
    "show verified salary": (
        """
    <a2ui>
    root = EmployeeSalaryCard("emp_102")
    </a2ui>
    """
    ),
    "show payroll summary": (
        """
    <a2ui>
    root = PayrollSummary("Global Engineering", true)
    </a2ui>
    """
    ),
    "show user evaluation": (
        """
    <a2ui>
    knowledge = TeamMemberKnowledgePanel("Alice Smith", "Lead Systems Architect", 9, 142)
    feedbacks = TeamFeedbackBoard("Peer Reviews & Feedback", [
        {author: "Dr. Elena Vance", note: "Exceptional architecture design and synchronous template engine.", rating: 5},
        {author: "Marcus Vance", note: "Great mentor on A2UI streaming and component catalogs.", rating: 5}
    ])
    goals = TeamGoalList("2026 Objectives", [
        {title: "Finalize A2UI Protocol Specification", priority: "High", targetDate: "2026-09-30"},
        {title: "Publish Community Template Studio", priority: "High", targetDate: "2026-10-15"}
    ])
    root = Column([knowledge, feedbacks, goals])
    </a2ui>
    """
    ),
    "show team roster": (
        """
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
    """
    ),
    "show team goals": (
        """
    <a2ui>
    root = TeamGoalList("Core Protocol Engineering", [
        {title: "Deliver synchronous template expansion engine", priority: "High", targetDate: "2026-08-30"},
        {title: "Redesign templates for Basic Catalog", priority: "High", targetDate: "2026-08-15"},
        {title: "Simplify community demo architectures", priority: "Medium", targetDate: "2026-09-01"}
    ])
    </a2ui>
    """
    ),
    "show feedback board": (
        """
    <a2ui>
    root = TeamFeedbackBoard("Frontend & Protocols Guild", [
        {author: "Dr. Elena Vance", note: "Synchronous template expansion eliminated all streaming race conditions.", rating: 5},
        {author: "Marcus Vance", note: "Standard Basic Catalog components ensure 100% cross-renderer compatibility.", rating: 5}
    ])
    </a2ui>
    """
    ),
    "show competency panel": (
        """
    <a2ui>
    root = TeamMemberKnowledgePanel("Alice Smith", "Lead Systems Architect", 9, 142)
    </a2ui>
    """
    ),
}


@app.get("/templates")
@app.get("/api/templates")
def list_templates():
    res = []
    for t in templates:
        t_dict = t.to_dict()
        t_dict["yamlContent"] = t.to_yaml()
        sample_params = t.sample_data or {}
        try:
            expanded_components = format_instance.processor.expand_template(
                "root", t.template_id, sample_params
            )
            sample_messages = [
                {
                    "version": "v0.9.1",
                    "createSurface": {
                        "surfaceId": f"preview_{t.template_id}",
                        "catalogId": BASIC_CATALOG_ID,
                    },
                },
                {
                    "version": "v0.9.1",
                    "updateComponents": {
                        "surfaceId": f"preview_{t.template_id}",
                        "components": expanded_components,
                    },
                },
            ]
        except Exception:
            sample_messages = []
        t_dict["sampleMessages"] = sample_messages

        if getattr(t, "is_dynamic", False):
            dynamic_tmpl: DynamicTemplate = t  # type: ignore
            t_dict["isDynamic"] = True
            if getattr(dynamic_tmpl, "render_fn", None) is not None:
                t_dict["isProgrammatic"] = True
                try:
                    t_dict["renderSource"] = inspect.getsource(dynamic_tmpl.render_fn)
                except Exception:
                    t_dict["renderSource"] = ""
            if dynamic_tmpl.layout is not None:
                t_dict["isDataBinding"] = True
                t_dict["layoutTemplate"] = dynamic_tmpl.layout.to_dict()
                t_dict["layoutTemplateYaml"] = dynamic_tmpl.layout.to_yaml()
            # Run resolver on sampleData to show resolved state
            try:
                t_dict["resolvedData"] = dynamic_tmpl.resolve(sample_params)
            except Exception:
                t_dict["resolvedData"] = {}
            if dynamic_tmpl.template_id == "EmployeeSalaryCard":
                t_dict["availablePresets"] = [
                    {"label": f"{v['employeeName']} ({k})", "value": k}
                    for k, v in EMPLOYEE_COMPENSATION_DB.items()
                ]

        res.append(t_dict)
    return res


@app.post("/templates/{template_id}/resolve")
@app.post("/api/templates/{template_id}/resolve")
def resolve_template(template_id: str, req: DynamicResolveRequest):
    tmpl = format_instance.processor.templates.get(template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    try:
        expanded_components = format_instance.processor.expand_template(
            "root", template_id, req.params
        )
        sample_messages = [
            {
                "version": "v0.9.1",
                "createSurface": {
                    "surfaceId": f"preview_{template_id}",
                    "catalogId": BASIC_CATALOG_ID,
                },
            },
            {
                "version": "v0.9.1",
                "updateComponents": {
                    "surfaceId": f"preview_{template_id}",
                    "components": expanded_components,
                },
            },
        ]
        resolved_data = {}
        if getattr(tmpl, "is_dynamic", False):
            if getattr(tmpl, "render_fn", None) is not None:
                resolved_data = {
                    "execution": "Python Programmatic Render Function",
                    "generatedComponentCount": len(expanded_components),
                    "appliedParams": req.params,
                }
            else:
                resolved_data = tmpl.resolve(req.params)  # type: ignore

        return {
            "expandedComponents": expanded_components,
            "sampleMessages": sample_messages,
            "resolvedData": resolved_data,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/interact")
@app.post("/api/chat")
async def chat(req: ChatRequest):
    start_time = time.perf_counter()
    prompt_lower = req.prompt.strip().lower()

    # 1. Preset shortcut responses for instant offline evaluation
    if prompt_lower in PRESET_RESPONSES:
        dsl = PRESET_RESPONSES[prompt_lower]
        target_format = TemplateInferenceFormat(
            templates=templates,
            surface_id=req.surfaceId,
            version="0.9.1",
        )
        parts = target_format.parser.parse_response(dsl)
        messages = parts[0].a2ui_json if parts and parts[0].a2ui_json else []
        latency = round(time.perf_counter() - start_time, 3)
        return {
            "messages": messages,
            "raw": dsl.strip(),
            "text": f"Here is the rendered {req.prompt}:",
            "surfaceId": req.surfaceId,
            "metrics": {
                "latency": latency,
                "thinkingTokens": 0,
                "outputTokens": len(dsl.split()),
                "isPreset": True,
            },
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
            latency = round(time.perf_counter() - start_time, 2)
            raw_text = response.text or ""
            target_format = TemplateInferenceFormat(
                templates=templates,
                surface_id=req.surfaceId,
                version="0.9.1",
            )
            parts = target_format.parser.parse_response(raw_text)

            messages = []
            text_parts = []
            for part in parts:
                if part.text:
                    text_parts.append(part.text)
                if part.a2ui_json:
                    messages.extend(part.a2ui_json)

            thinking_tokens = 0
            candidates_tokens = 0
            if response.usage_metadata:
                thinking_tokens = (
                    getattr(response.usage_metadata, "thoughts_token_count", 0) or 0
                )
                candidates_tokens = (
                    getattr(response.usage_metadata, "candidates_token_count", 0) or 0
                )

            actual_surface_id = req.surfaceId
            for msg in messages:
                if isinstance(msg, dict):
                    if "createSurface" in msg and "surfaceId" in msg["createSurface"]:
                        actual_surface_id = msg["createSurface"]["surfaceId"]
                        break
                    elif (
                        "updateComponents" in msg
                        and "surfaceId" in msg["updateComponents"]
                    ):
                        actual_surface_id = msg["updateComponents"]["surfaceId"]
                        break

            return {
                "messages": messages,
                "raw": raw_text.strip(),
                "text": "\n".join(text_parts).strip() or "UI generated successfully.",
                "surfaceId": actual_surface_id,
                "metrics": {
                    "latency": latency,
                    "thinkingTokens": thinking_tokens,
                    "outputTokens": candidates_tokens,
                    "isPreset": False,
                },
            }
        except Exception as e:
            return {
                "messages": [],
                "raw": f"Error: {str(e)}",
                "text": f"Error generating template UI: {str(e)}",
                "surfaceId": req.surfaceId,
                "metrics": {
                    "latency": round(time.perf_counter() - start_time, 2),
                    "thinkingTokens": 0,
                    "outputTokens": 0,
                    "isPreset": False,
                },
            }

    # 3. Fallback when no Gemini API key is configured
    return {
        "messages": [],
        "raw": "",
        "text": (
            "Gemini API key is not configured on the server. Please click one of the"
            " preset buttons above or set the GEMINI_API_KEY environment variable."
        ),
        "surfaceId": req.surfaceId,
        "metrics": {
            "latency": 0.0,
            "thinkingTokens": 0,
            "outputTokens": 0,
            "isPreset": True,
        },
    }

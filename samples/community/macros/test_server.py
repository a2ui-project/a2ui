# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit and integration tests for the typesafe templates community server."""

import pytest
import sys
from pathlib import Path
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))

from server import (
    app,
    format_instance,
    PRESET_RESPONSES,
    render_payroll_summary,
    EMPLOYEE_COMPENSATION_DB,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_list_macros(client):
    """Verifies that the /macros API endpoint lists all typesafe macros."""
    response = client.get("/macros")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 11
    macro_ids = [t["macroId"] for t in data]
    assert "EmployeeSalaryCard" in macro_ids
    assert "PayrollSummary" in macro_ids
    assert "UserProfile" in macro_ids
    assert "GoalItem" in macro_ids
    assert "FeedbackItem" in macro_ids

    # Verify backward compatibility on /templates
    compat_response = client.get("/templates")
    assert compat_response.status_code == 200
    assert len(compat_response.json()) == len(data)


def test_resolve_macro_endpoint(client):
    """Verifies POST /macros/{id}/resolve endpoint."""
    response = client.post(
        "/macros/EmployeeSalaryCard/resolve",
        json={"params": {"employeeId": "emp_102"}},
    )
    assert response.status_code == 200
    data = response.json()
    assert "expandedComponents" in data
    assert len(data["sampleMessages"]) >= 2


def test_payroll_summary_dynamic_builder():
    """Verifies programmatic dynamic template returns typesafe card and expands cleanly."""
    card = render_payroll_summary(department="AI Research", includeBonus=True)
    assert card.component_name == "Card"
    expanded = format_instance.processor.expand(
        "PayrollSummary",
        {"department": "AI Research", "includeBonus": True},
        instance_id="root",
    )
    assert len(expanded) > 10
    # Root component must be Card with ID root
    root_comp = [c for c in expanded if c["id"] == "root"][0]
    assert root_comp["component"] == "Card"
    # Verification text
    assert any("AI Research" in str(c.get("text", "")) for c in expanded)
    assert any("TOTAL PAYROLL" in str(c.get("text", "")) for c in expanded)


def test_employee_salary_card_resolver():
    """Verifies data binding resolver mode for confidential employee salary."""
    expanded = format_instance.processor.expand(
        "EmployeeSalaryCard", {"employeeId": "emp_102"}, instance_id="root"
    )
    assert len(expanded) > 0
    record = EMPLOYEE_COMPENSATION_DB["emp_102"]
    # Check that confidential data was bound into the template layout
    texts = [str(c.get("text", "")) for c in expanded]
    assert record["employeeName"] in texts
    assert record["baseSalary"] in texts
    assert record["annualBonus"] in texts
    assert record["equity"] in texts


def test_preset_responses_compilation():
    """Verifies that all predefined preset DSL prompts compile and expand into valid A2UI envelopes."""
    for preset_name, dsl_snippet in PRESET_RESPONSES.items():
        messages = format_instance.parser.compile(dsl_snippet)
        assert len(messages) >= 1, f"Preset '{preset_name}' failed compilation"
        # Find updateComponents or surfaceUpdate message
        update_msg = [
            m for m in messages if "updateComponents" in m or "surfaceUpdate" in m
        ]
        assert update_msg, f"Preset '{preset_name}' produced no update envelope"
        comps = update_msg[0].get("updateComponents", {}).get(
            "components"
        ) or update_msg[0].get("surfaceUpdate", {}).get("components")
        assert len(comps) >= 1, f"Preset '{preset_name}' produced empty components"


def test_interact_preset(client):
    """Verifies POST /interact with a preset shortcut."""
    response = client.post(
        "/interact",
        json={"prompt": "show user profile", "surfaceId": "surface_test"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["messages"]) >= 2
    assert "messages" in data
    assert not data["raw"].startswith("Error:")


def test_interact_live_llm(client):
    """Verifies POST /interact with live Gemini LLM generation, ensuring response parsing and macro expansion work end-to-end."""
    import os

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        pytest.skip("GEMINI_API_KEY not set in environment.")

    response = client.post(
        "/interact",
        json={
            "prompt": "Create a team goal list for Cloud Platform team with 2 goals",
            "surfaceId": "surface_live_test",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert not data["raw"].startswith("Error:"), f"LLM error: {data['raw']}"
    assert len(data["messages"]) >= 1, "Expected at least one A2UI message from LLM"

    # Verify that all components in the messages are basic catalog primitives,
    # and all macros were expanded
    all_components = []
    for msg in data["messages"]:
        if "updateComponents" in msg:
            all_components.extend(msg["updateComponents"].get("components", []))
        elif "surfaceUpdate" in msg:
            all_components.extend(msg["surfaceUpdate"].get("components", []))

    assert len(all_components) > 0, "No components found in messages"
    component_types = {c["component"] for c in all_components}
    # Macros like TeamGoalList or GoalItem should NOT appear unexpanded
    assert "TeamGoalList" not in component_types
    assert "GoalItem" not in component_types
    # Basic primitives like Card, Text, Column, Row should appear
    assert any(t in component_types for t in ["Card", "Text", "Column", "Row"])

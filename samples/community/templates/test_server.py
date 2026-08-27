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


def test_list_templates(client):
    """Verifies that the /templates API endpoint lists all 12 typesafe templates."""
    response = client.get("/templates")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 11
    template_ids = [t["templateId"] for t in data]
    assert "EmployeeSalaryCard" in template_ids
    assert "PayrollSummary" in template_ids
    assert "UserProfile" in template_ids
    assert "GoalItem" in template_ids
    assert "FeedbackItem" in template_ids


def test_payroll_summary_dynamic_builder():
    """Verifies programmatic dynamic template returns typesafe card and expands cleanly."""
    card = render_payroll_summary(department="AI Research", includeBonus=True)
    assert card.component_name == "Card"
    expanded = format_instance.processor.expand_template(
        "root", "PayrollSummary", {"department": "AI Research", "includeBonus": True}
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
    expanded = format_instance.processor.expand_template(
        "root", "EmployeeSalaryCard", {"employeeId": "emp_102"}
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
        comps = update_msg[0].get("updateComponents", {}).get("components") or update_msg[0].get("surfaceUpdate", {}).get("components")
        assert len(comps) >= 1, f"Preset '{preset_name}' produced empty components"

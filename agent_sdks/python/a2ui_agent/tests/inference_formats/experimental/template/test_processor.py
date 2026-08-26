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

"""Unit tests for A2UI Template Processor (processor.py) focusing on Python runtime execution and typing."""

import asyncio
import json
from pathlib import Path
from typing import Any, Dict
import pytest

from a2ui.inference_formats.experimental.template import (
    DynamicTemplate,
    dynamic_template,
    StaticTemplate,
    TemplateProcessor,
    TemplateId,
    InstanceId,
    ComponentId,
    ParamPath,
    TemplateParams,
)
from a2ui.inference_formats.experimental.template.processor import (
    _resolve_param_path,
    _substitute_params,
)

BASIC_CATALOG_PATH = (
    Path(__file__).resolve().parents[7]
    / "specification"
    / "v0_9_1"
    / "catalogs"
    / "basic"
    / "catalog.json"
)
BASIC_CATALOG: Dict[str, Any] = {}
if BASIC_CATALOG_PATH.is_file():
    with open(BASIC_CATALOG_PATH, "r", encoding="utf-8") as f:
        BASIC_CATALOG = json.load(f)


def test_dynamic_template_with_resolver():
    """Verifies Mode B dynamic template where a native Python resolver fetches data and binds it to a static layout."""
    layout_yaml = """
version: "0.1"
name: LiveStockCard
catalogs:
  - "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
parameters:
  ticker: {type: string}
  price: {type: number, required: false}
  changePct: {type: string, required: false}
layout:
  component: Card
  child:
    component: Column
    children:
      - component: Text
        text: "Stock: ${ticker}"
      - component: Text
        text: "Price: $${price}"
      - component: Text
        text: "Change: ${changePct}%"
"""

    mock_db = {
        "GOOG": {"price": 175.50, "changePct": "+1.8"},
        "AAPL": {"price": 220.10, "changePct": "-0.4"},
    }

    async def fetch_stock_data(ticker: str) -> Dict[str, Any]:
        await asyncio.sleep(0.01)
        return mock_db.get(ticker, {"price": 0.0, "changePct": "0.0"})

    tmpl = DynamicTemplate(
        name="LiveStockCard",
        template_id="LiveStockCard",
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        layout=layout_yaml,
        resolver=fetch_stock_data,
        description="Displays live stock pricing.",
    )

    processor = TemplateProcessor(templates=[tmpl], catalogs=BASIC_CATALOG)
    expanded = processor.expand_template(
        "stock_goog", "LiveStockCard", {"ticker": "GOOG"}
    )

    assert len(expanded) == 5
    price_comp = next((c for c in expanded if c.get("text") == "Price: $175.5"), None)
    assert price_comp is not None


def test_programmatic_dynamic_template_render():
    """Verifies Mode A dynamic template where a native Python callable directly constructs the component tree."""

    def render_payroll(department: str = "Engineering", includeBonus: bool = True):
        employees = [
            {"name": "Alice", "salary": 150000, "bonus": 20000},
            {"name": "Bob", "salary": 140000, "bonus": 15000},
        ]
        rows = []
        for emp in employees:
            cols = [{"component": "Text", "text": emp["name"]}]
            if includeBonus:
                cols.append({"component": "Text", "text": f"Bonus: ${emp['bonus']}"})
            rows.append({"component": "Row", "children": cols})

        return {
            "component": "Card",
            "child": {
                "component": "Column",
                "children": [
                    {"component": "Text", "text": f"Payroll: {department}"},
                    *rows,
                ],
            },
        }

    tmpl = DynamicTemplate(
        name="PayrollSummary",
        template_id="PayrollSummary",
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        render=render_payroll,
        description="Dynamic payroll summary calculation.",
    )

    processor = TemplateProcessor(templates=[tmpl], catalogs=BASIC_CATALOG)
    expanded = processor.expand_template(
        "payroll_root", "PayrollSummary", {"department": "AI Research"}
    )

    assert any(c.get("text") == "Payroll: AI Research" for c in expanded)
    assert any(c.get("text") == "Bonus: $20000" for c in expanded)


def test_programmatic_dynamic_template_extra_params_filtered():
    """Verifies that dynamic render functions with explicit signatures do not break when receiving unexpected kwargs."""

    def render_card(title: str):
        return {"component": "Text", "text": title}

    tmpl = DynamicTemplate(
        name="SimpleCard",
        template_id="SimpleCard",
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        render=render_card,
    )
    processor = TemplateProcessor(templates=[tmpl], catalogs=BASIC_CATALOG)

    expanded = processor.expand_template(
        "inst",
        "SimpleCard",
        {"title": "Filtered", "extra1": "drop_me", "extra2": 42},
    )
    assert len(expanded) == 1
    assert expanded[0]["text"] == "Filtered"


def test_dynamic_template_resolve_non_dict_fallback():
    """Verifies graceful fallback when a resolver returns a non-dict value."""
    layout_yaml = """
version: "0.1"
name: NonDictLayout
catalogs:
  - "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
parameters:
  paramA: {type: string}
layout:
  component: Text
  text: ${paramA}
"""

    def bad_resolver(paramA: str):
        return "not a dict"

    tmpl = DynamicTemplate(
        name="NonDictLayout",
        template_id="NonDictLayout",
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        layout=layout_yaml,
        resolver=bad_resolver,
    )
    processor = TemplateProcessor(templates=[tmpl], catalogs=BASIC_CATALOG)
    expanded = processor.expand_template("root", "NonDictLayout", {"paramA": "safe"})
    assert len(expanded) == 1
    assert expanded[0]["text"] == "safe"


def test_dynamic_template_loop_custom_as_variable():
    """Verifies dynamic template expansion utilizing custom loop variable naming."""
    layout_yaml = """
version: "0.1"
name: CustomAsList
catalogs:
  - "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
parameters:
  items: {type: array}
layout:
  component: Column
  children:
    loop:
      param: items
      as: item_var
      item:
        component: Text
        text: ${item_var.label}
"""
    tmpl = StaticTemplate.from_yaml(layout_yaml)
    processor = TemplateProcessor(templates=[tmpl], catalogs=BASIC_CATALOG)
    expanded = processor.expand_template(
        "root",
        "CustomAsList",
        {"items": [{"label": "First"}, {"label": "Second"}]},
    )
    texts = [c["text"] for c in expanded if c.get("component") == "Text"]
    assert "First" in texts
    assert "Second" in texts


def test_template_processor_requires_catalogs():
    """Verifies that TemplateProcessor requires explicit catalogs and rejects default assumptions."""
    t = StaticTemplate(
        name="StandaloneTemplate",
        template_id="StandaloneTemplate",
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        parameters={},
        components=[],
    )
    with pytest.raises(ValueError, match="TemplateProcessor requires explicit catalog"):
        TemplateProcessor(templates=[t])


def test_template_processor_with_custom_domain_catalog():
    """Verifies TemplateProcessor when initialized with a custom domain catalog."""
    custom_catalog = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://company.org/custom_medical_catalog.json",
        "title": "Medical Component Catalog",
        "components": {
            "PatientChart": {"type": "object"},
            "VitalsGauge": {"type": "object"},
        },
        "functions": {},
    }

    layout_yaml = """
version: "0.1"
name: MedicalReport
catalogs:
  - "https://company.org/custom_medical_catalog.json"
parameters:
  patientName: {type: string}
layout:
  component: PatientChart
  properties:
    name: ${patientName}
"""
    tmpl = StaticTemplate.from_yaml(layout_yaml)
    processor = TemplateProcessor(templates=[tmpl], catalogs=custom_catalog)

    assert (
        processor.base_catalog_id == "https://company.org/custom_medical_catalog.json"
    )

    cat = processor.generate_inference_catalog()
    assert "PatientChart" in cat["components"]
    assert "VitalsGauge" in cat["components"]
    assert "MedicalReport" in cat["components"]
    assert "Card" not in cat["components"]
    assert "Button" not in cat["components"]


def test_multi_catalog_resolution_and_disambiguation():
    """Verifies multi-catalog resolution, collision detection, and explicit catalogId disambiguation."""
    catalog_a = {
        "$id": "https://a2ui.org/cat_a.json",
        "catalogId": "https://a2ui.org/cat_a.json",
        "components": {
            "SharedBox": {"type": "object"},
            "CompA": {"type": "object"},
        },
    }
    catalog_b = {
        "$id": "https://a2ui.org/cat_b.json",
        "catalogId": "https://a2ui.org/cat_b.json",
        "components": {
            "SharedBox": {"type": "object"},
            "CompB": {"type": "object"},
        },
    }

    # Case 1: Ambiguous component without disambiguation raises ValueError
    ambiguous_yaml = """
version: "0.1"
name: AmbiguousTemplate
catalogs:
  - "https://a2ui.org/cat_a.json"
  - "https://a2ui.org/cat_b.json"
parameters: {}
layout:
  component: SharedBox
"""
    tmpl_ambiguous = StaticTemplate.from_yaml(ambiguous_yaml)
    with pytest.raises(ValueError, match="ambiguous across multiple declared catalogs"):
        TemplateProcessor(
            templates=[tmpl_ambiguous],
            catalogs=[catalog_a, catalog_b],
            version="v1.0",
        )

    # Case 2: Disambiguated component with catalogId resolves successfully
    disambiguated_yaml = """
version: "0.1"
name: DisambiguatedTemplate
catalogs:
  - "https://a2ui.org/cat_a.json"
  - "https://a2ui.org/cat_b.json"
parameters: {}
layout:
  component: SharedBox
  catalogId: "https://a2ui.org/cat_b.json"
"""
    tmpl_ok = StaticTemplate.from_yaml(disambiguated_yaml)
    proc = TemplateProcessor(
        templates=[tmpl_ok],
        catalogs=[catalog_a, catalog_b],
        version="v1.0",
    )
    expanded = proc.expand_template("inst_1", "DisambiguatedTemplate", {})
    assert len(expanded) == 1
    assert expanded[0]["component"] == "SharedBox"
    assert expanded[0]["catalogId"] == "https://a2ui.org/cat_b.json"


def test_v09_rejects_multi_catalog_template():
    """Verifies that A2UI v0.9 strictly rejects templates declaring multiple catalogs."""
    catalog_a = {
        "$id": "https://a2ui.org/cat_a.json",
        "components": {"CompA": {}},
    }
    catalog_b = {
        "$id": "https://a2ui.org/cat_b.json",
        "components": {"CompB": {}},
    }
    multi_yaml = """
version: "0.1"
name: MultiCatTemplate
catalogs:
  - "https://a2ui.org/cat_a.json"
  - "https://a2ui.org/cat_b.json"
parameters: {}
layout:
  component: CompA
"""
    tmpl = StaticTemplate.from_yaml(multi_yaml)
    with pytest.raises(ValueError, match="only supports a single catalog"):
        TemplateProcessor(
            templates=[tmpl],
            catalogs=[catalog_a, catalog_b],
            version="v0.9.1",
        )


def test_type_aliases_and_private_helpers():
    """Verifies that semantic type aliases and backwards-compatible private functions are available."""
    assert TemplateId is str
    assert InstanceId is str
    assert ComponentId is str
    assert ParamPath is str

    params: TemplateParams = {"user": {"profile": {"tier": "Pro"}}}
    found, val = _resolve_param_path("user.profile.tier", params)
    assert found is True
    assert val == "Pro"

    sub = _substitute_params("${user.profile.tier}", params)
    assert sub == "Pro"

    t = StaticTemplate(
        name="Dummy",
        template_id="Dummy",
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        version="0.1",
        parameters={},
        components=[],
    )
    p = TemplateProcessor(templates=[t], catalogs=BASIC_CATALOG)
    p._validate_templates()
    p.validate_templates()


def test_dynamic_template_decorator_processor_expansion():
    """Verifies that @dynamic_template can be directly registered and expanded by TemplateProcessor."""

    @dynamic_template(
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        description="Renders a KPI metric display.",
    )
    def kpi_metric(label: str, value: str, change: str = "+0.0%"):
        return {
            "component": "Card",
            "child": {
                "component": "Column",
                "children": [
                    {"component": "Text", "text": f"{label}: {value}"},
                    {"component": "Text", "text": f"Change: {change}"},
                ],
            },
        }

    processor = TemplateProcessor(templates=[kpi_metric], catalogs=BASIC_CATALOG)
    expanded = processor.expand_template(
        "inst_kpi",
        "KpiMetric",
        {"label": "Revenue", "value": "$1.2M", "change": "+12%"},
    )
    assert len(expanded) == 4
    assert any(c.get("text") == "Revenue: $1.2M" for c in expanded)
    assert any(c.get("text") == "Change: +12%" for c in expanded)

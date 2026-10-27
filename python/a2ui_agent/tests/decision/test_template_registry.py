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

"""Unit tests for SurfaceTemplate and TemplateRegistry."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiValidationError
from a2ui.inference_formats.decision import (
    SurfaceTemplate,
    SynthesisOutput,
    SynthesisStage,
    TemplateRegistry,
)
from a2ui.parser.messages import to_message_dicts, to_message_models


def _make_v09_template(
    template_id: str = "metric_card_v09",
    *,
    required_pointers: tuple[str, ...] = ("/cpu",),
    is_mutable: bool = False,
    protocol_version: str = "v0.9",
) -> SurfaceTemplate:
    return SurfaceTemplate(
        template_id=template_id,
        description="Displays CPU metric card",
        surface_id="metrics_surface",
        catalog_id="https://example.com/catalogs/devops/v1",
        protocol_version=protocol_version,
        components=(
            {
                "id": "root",
                "component": "MetricGauge",
                "label": "CPU Usage",
                "value": {"path": "/cpu"},
            },
        ),
        required_pointers=required_pointers,
        is_mutable=is_mutable,
    )


def _make_v10_template(
    template_id: str = "metric_card_v10",
    *,
    catalog_id: str | None = "https://example.com/catalogs/devops/v1",
    required_pointers: tuple[str, ...] = ("/cpu",),
) -> SurfaceTemplate:
    return SurfaceTemplate(
        template_id=template_id,
        description="Displays CPU metric card in v1.0",
        surface_id="metrics_v10_surface",
        catalog_id=catalog_id,
        protocol_version="v1.0",
        components=(
            {
                "id": "root",
                "component": "MetricGauge",
                "label": "CPU Usage",
                "value": {"@path": "/cpu"},
            },
        ),
        required_pointers=required_pointers,
    )


class TestSurfaceTemplate:
    """Tests for SurfaceTemplate matching and message rendering."""

    def test_matches_payload_checks_all_required_pointers(self) -> None:
        template = _make_v09_template(required_pointers=("/cpu", "/memory"))
        assert template.matches_payload(["/cpu", "/memory", "/disk"]) is True
        assert template.matches_payload(["/cpu"]) is False
        assert template.matches_payload([]) is False

    def test_matches_payload_with_empty_requirements_always_matches(self) -> None:
        template = _make_v09_template(required_pointers=())
        assert template.matches_payload([]) is True
        assert template.matches_payload(["/any"]) is True

    def test_render_messages_v09_with_and_without_payload(self) -> None:
        template = _make_v09_template(protocol_version="v0.9")

        empty_msgs = template.render_messages({})
        assert len(empty_msgs) == 2
        empty_dicts = to_message_dicts(empty_msgs)
        assert empty_dicts[0] == {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "metrics_surface",
                "catalogId": "https://example.com/catalogs/devops/v1",
            },
        }
        assert empty_dicts[1] == {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "metrics_surface",
                "components": [{
                    "id": "root",
                    "component": "MetricGauge",
                    "label": "CPU Usage",
                    "value": {"path": "/cpu"},
                }],
            },
        }

        populated_msgs = template.render_messages(
            {"cpu": 72.5}, surface_id="custom_surface"
        )
        assert len(populated_msgs) == 3
        populated_dicts = to_message_dicts(populated_msgs)
        assert populated_dicts[0]["createSurface"]["surfaceId"] == "custom_surface"
        assert populated_dicts[1]["updateComponents"]["surfaceId"] == "custom_surface"
        assert populated_dicts[2] == {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": "custom_surface",
                "path": "/",
                "value": {"cpu": 72.5},
            },
        }

    def test_render_messages_normalizes_v091_wire_version_to_v09(self) -> None:
        template = _make_v09_template(protocol_version="v0.9.1")
        msgs = template.render_messages({"cpu": 40})
        msg_dicts = to_message_dicts(msgs)
        assert [m["version"] for m in msg_dicts] == ["v0.9", "v0.9", "v0.9"]

        bare_v10 = SurfaceTemplate(
            template_id="bare_v10",
            description="Bare 1.0 protocol version",
            surface_id="s_v10",
            catalog_id=None,
            protocol_version="1.0",
            components=({"id": "root", "component": "MetricGauge"},),
        )
        assert bare_v10.root_component() == "MetricGauge"
        v10_dicts = to_message_dicts(bare_v10.render_messages({}))
        assert [m["version"] for m in v10_dicts] == ["v1.0", "v1.0"]

    def test_render_messages_v10_with_and_without_catalog_id(self) -> None:
        template_with_cat = _make_v10_template(
            catalog_id="https://example.com/catalogs/devops/v1"
        )
        msgs = template_with_cat.render_messages({"cpu": 88})
        msg_dicts = to_message_dicts(msgs)
        assert len(msg_dicts) == 3
        assert msg_dicts[0] == {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "metrics_v10_surface",
                "catalogId": "https://example.com/catalogs/devops/v1",
            },
        }
        assert msg_dicts[1]["version"] == "v1.0"
        assert msg_dicts[2]["version"] == "v1.0"

        template_no_cat = _make_v10_template(catalog_id=None)
        no_cat_dicts = to_message_dicts(template_no_cat.render_messages({}))
        assert no_cat_dicts[0] == {
            "version": "v1.0",
            "createSurface": {"surfaceId": "metrics_v10_surface"},
        }

    def test_render_messages_deep_copies_components(self) -> None:
        template = _make_v09_template()
        msgs = template.render_messages({})
        msg_dicts = to_message_dicts(msgs)
        msg_dicts[1]["updateComponents"]["components"][0]["label"] = "Mutated"
        assert template.components[0]["label"] == "CPU Usage"


class TestTemplateRegistry:
    """Tests for TemplateRegistry registration, lookup, and CQS promotion."""

    def test_register_get_list_and_matching_templates(self) -> None:
        registry = TemplateRegistry()
        t1 = _make_v09_template("t1", required_pointers=("/cpu",))
        t2 = _make_v09_template("t2", required_pointers=("/cpu", "/mem"))

        registry.register(t1)
        registry.register(t2)

        assert registry.get("t1") == t1
        assert registry.get("t2") == t2
        assert registry.get("unknown") is None
        assert registry.list_templates() == (t1, t2)

        assert registry.matching_templates(["/cpu"]) == (t1,)
        assert registry.matching_templates(["/cpu", "/mem"]) == (t1, t2)
        assert registry.matching_templates(["/disk"]) == ()

    @pytest.mark.parametrize(
        "bad_components",
        [
            (),
            ({"id": "root"},),
            ({"component": "MetricGauge"},),
            ({"id": "", "component": "MetricGauge"},),
            ({"id": "root", "component": "   "},),
        ],
    )
    def test_register_fails_fast_on_malformed_components(
        self, bad_components: tuple[dict[str, object], ...]
    ) -> None:
        registry = TemplateRegistry()
        bad_template = SurfaceTemplate(
            template_id="bad_template",
            description="Malformed component template",
            surface_id="s1",
            catalog_id="https://example.com/catalog",
            protocol_version="v0.9",
            components=bad_components,
        )
        with pytest.raises((A2uiValidationError, ValueError)):
            registry.register(bad_template)
        assert registry.get("bad_template") is None

    def test_register_fails_fast_on_invalid_envelope_schema(self) -> None:
        registry = TemplateRegistry()
        # In v0.9, CreateSurface requires a non-null catalogId.
        missing_catalog_v09 = SurfaceTemplate(
            template_id="bad_v09",
            description="Missing catalogId in v0.9",
            surface_id="s1",
            catalog_id=None,
            protocol_version="v0.9",
            components=({"id": "root", "component": "MetricGauge"},),
        )
        with pytest.raises((A2uiValidationError, ValueError)):
            registry.register(missing_catalog_v09)

    def test_promote_synthesized_registers_reusable_template(self) -> None:
        registry = TemplateRegistry()
        raw_messages = to_message_models([
            {
                "version": "v1.0",
                "createSurface": {
                    "surfaceId": "synth_surface",
                    "catalogId": "https://example.com/catalogs/finance/v1",
                },
            },
            {
                "version": "v1.0",
                "updateComponents": {
                    "surfaceId": "synth_surface",
                    "components": [{
                        "id": "root",
                        "component": "TickerCard",
                        "symbol": {"@path": "/ticker"},
                    }],
                },
            },
            {
                "version": "v1.0",
                "updateDataModel": {
                    "surfaceId": "synth_surface",
                    "path": "/",
                    "value": {"ticker": "GOOG"},
                },
            },
        ])
        output = SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=raw_messages,
            confidence=0.92,
            entropy=0.12,
            component_tree_spec={"root_component": "TickerCard"},
        )

        promoted = registry.promote_synthesized(
            "ticker_template",
            "Promoted ticker card",
            output,
            required_pointers=["/ticker"],
            is_mutable=True,
        )

        assert promoted.template_id == "ticker_template"
        assert promoted.surface_id == "synth_surface"
        assert promoted.catalog_id == "https://example.com/catalogs/finance/v1"
        assert promoted.protocol_version == "v1.0"
        assert promoted.required_pointers == ("/ticker",)
        assert promoted.is_mutable is True
        assert registry.get("ticker_template") == promoted

        rendered = promoted.render_messages({"ticker": "Alphabet"}, surface_id="s2")
        rendered_dicts = to_message_dicts(rendered)
        assert rendered_dicts[0]["createSurface"]["surfaceId"] == "s2"
        assert rendered_dicts[2]["updateDataModel"]["value"] == {"ticker": "Alphabet"}

    def test_promote_synthesized_raises_when_missing_update_components(
        self,
    ) -> None:
        registry = TemplateRegistry()
        abstain_output = SynthesisOutput(
            stage=SynthesisStage.ABSTAIN_FALLBACK,
            messages=[],
            confidence=0.20,
            entropy=0.95,
        )
        with pytest.raises(ValueError, match="updateComponents"):
            registry.promote_synthesized(
                "invalid_promotion", "Should fail", abstain_output
            )

    def test_promote_synthesized_normalizes_v08_surface_update_to_v09(
        self,
    ) -> None:
        registry = TemplateRegistry()
        v08_messages = to_message_models([
            {
                "beginRendering": {
                    "surfaceId": "v08_surface",
                    "catalogId": "https://example.com/catalogs/ops/v1",
                    "root": "root",
                },
            },
            {
                "surfaceUpdate": {
                    "surfaceId": "v08_surface",
                    "components": [{
                        "id": "root",
                        "component": {"MetricGauge": {"value": {"path": "/cpu"}}},
                    }],
                },
            },
        ])
        output = SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=v08_messages,
            confidence=0.90,
            entropy=0.10,
        )
        promoted = registry.promote_synthesized(
            "from_v08", "Promoted from v0.8", output, required_pointers=["/cpu"]
        )
        rendered = promoted.render_messages({"cpu": 55.0})
        rendered_dicts = to_message_dicts(rendered)
        assert [m["version"] for m in rendered_dicts] == ["v0.9", "v0.9", "v0.9"]
        assert rendered_dicts[0]["createSurface"]["surfaceId"] == "v08_surface"
        assert (
            rendered_dicts[1]["updateComponents"]["components"][0]["component"]
            == "MetricGauge"
        )

        # Also verify explicit protocol_version="v0.8" on SurfaceTemplate normalizes to v0.9.
        explicit_v08 = _make_v09_template("explicit_v08", protocol_version="v0.8")
        v08_dicts = to_message_dicts(explicit_v08.render_messages({"cpu": 10}))
        assert [m["version"] for m in v08_dicts] == ["v0.9", "v0.9", "v0.9"]

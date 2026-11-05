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

"""Streaming, prompt-generation, DAG, and specification round-trip tests for A2UI XML."""

from __future__ import annotations

import glob
import json
import os
import re

import pytest

from a2ui.core import A2uiParseError, A2uiValidationError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import A2uiXmlFormat, to_message_dicts, to_message_models
from a2ui.parser import A2uiPart, ErrorPart, TextPart
from a2ui.utils import RendererState

from ..repo_paths import find_repo_root

pytestmark = pytest.mark.filterwarnings("ignore:\\[EXPERIMENTAL\\]:UserWarning")


def _find_spec_example_files() -> list[str]:
    repo_root = find_repo_root()
    files = sorted(
        glob.glob(
            os.path.join(repo_root, "catalogs", "basic", "v1", "examples", "*.json")
        )
    )
    return files


SPEC_EXAMPLE_FILES = _find_spec_example_files()


def _reachable_from_root(components_by_id: dict[str, dict]) -> dict[str, dict]:
    if "root" not in components_by_id:
        return components_by_id

    def _refs(val):
        if isinstance(val, str):
            if val in components_by_id:
                yield val
        elif isinstance(val, dict):
            for v in val.values():
                yield from _refs(v)
        elif isinstance(val, list):
            for v in val:
                yield from _refs(v)

    reached: set[str] = set()
    stack = ["root"]
    while stack:
        cid = stack.pop()
        if cid in reached:
            continue
        reached.add(cid)
        comp = components_by_id[cid]
        stack.extend(_refs({k: v for k, v in comp.items() if k != "id"}))
    return {k: v for k, v in components_by_id.items() if k in reached}


class TestA2uiXmlStreaming:
    """Verifies progressive chunk-by-chunk streaming, opaque fences, and error handling."""

    @pytest.mark.parametrize("version", ["0.9", "1.0"])
    @pytest.mark.parametrize("chunk_size", [1, 7, 64])
    def test_progressive_streaming_emits_before_block_closes(
        self, version: str, chunk_size: int
    ):
        catalog = BasicCatalog(version)
        parser = A2uiXmlFormat([catalog], strict=True).create_parser()
        response = """Hello before UI!
<a2ui>
```json dataModel
{
  "note": "Literal </a2ui> inside opaque fence must NOT close block!"
}
```
<Card>
  <Column>
    <Text text="First streamed leaf" />
    <Button variant="primary" action="confirm">
      <Text text="Confirm" />
    </Button>
  </Column>
</Card>
</a2ui>
Goodbye after UI!"""

        stream = parser.open_stream()
        emitted_parts = []
        a2ui_emissions_while_in_block = 0

        for i in range(0, len(response), chunk_size):
            chunk = response[i : i + chunk_size]
            ready = stream.feed(chunk)
            if stream.is_in_block:
                a2ui_emissions_while_in_block += sum(
                    1 for p in ready if isinstance(p, A2uiPart)
                )
            emitted_parts.extend(ready)
        emitted_parts.extend(stream.close())

        if chunk_size <= 7:
            assert (
                a2ui_emissions_while_in_block >= 1
            ), "Expected progressive A2uiPart emissions before </a2ui> arrived"

        text_joined = "".join(p.text for p in emitted_parts if isinstance(p, TextPart))
        assert "Hello before UI!" in text_joined
        assert "Goodbye after UI!" in text_joined

        surf = stream.state.get_surface("main")
        assert surf is not None
        comps = surf.components_model.get_all()
        assert "root" in comps
        assert len(comps) == 5

    def test_stream_after_rejected_block_continue_vs_end(self):
        catalog = BasicCatalog("1.0")
        parser = A2uiXmlFormat([catalog]).create_parser()
        bad_then_good = """Intro
<a2ui>
<NonExistentWidget />
</a2ui>
Middle
<a2ui>
<Text text="Recovered block" />
</a2ui>"""

        # Default `after_rejected_block="end"` raises on bad block
        stream_end = parser.open_stream(after_rejected_block="end")
        with pytest.raises(A2uiValidationError):
            for ch in bad_then_good:
                stream_end.feed(ch)

        # `after_rejected_block="continue"` emits ErrorPart and parses second block
        stream_cont = parser.open_stream(after_rejected_block="continue")
        parts = []
        for i in range(0, len(bad_then_good), 5):
            parts.extend(stream_cont.feed(bad_then_good[i : i + 5]))
        parts.extend(stream_cont.close())

        assert any(isinstance(p, ErrorPart) for p in parts)
        a2ui_parts = [p for p in parts if isinstance(p, A2uiPart)]
        assert len(a2ui_parts) == 1
        assert stream_cont.state.get_surface("main") is not None

    def test_stream_unclosed_a2ui_block_raises_parse_error(self):
        catalog = BasicCatalog("1.0")
        parser = A2uiXmlFormat([catalog]).create_parser()
        stream = parser.open_stream()
        stream.feed('<a2ui>\n<Text text="Truncated" />')
        assert stream.is_in_block is True
        with pytest.raises(A2uiParseError):
            stream.close()


class TestA2uiXmlPromptsAndSharedDag:
    """Verifies prompt generation, example rewriting, and shared DAG `<Ref>` round-tripping."""

    def test_prompt_generator_allowed_messages_and_instruction_rewriting(self):
        catalog = BasicCatalog("1.0")
        fmt = A2uiXmlFormat([catalog])
        gen = fmt.prompt_generator

        full_prompt = gen.generate()
        # Raw createSurface JSON examples inside BasicCatalog.instructions should be rewritten into <a2ui> A2UI XML
        assert '"createSurface"' not in full_prompt
        assert "<a2ui>" in full_prompt
        assert "| `<TextField>` |" in full_prompt

        # Verify every standalone <a2ui>...</a2ui> example block in base rules compiles strictly!
        base_rules = gen.generate_base_rules()
        example_blocks = re.findall(
            r"^<a2ui>\n(.*?)\n^</a2ui>",
            base_rules,
            flags=re.MULTILINE | re.DOTALL,
        )
        assert example_blocks
        strict_parser = A2uiXmlFormat([catalog], strict=True).create_parser()
        for block in example_blocks:
            msgs = strict_parser.compile(block)
            assert len(msgs) >= 1

        # Verify `allowed_messages` pruning
        pruned = gen.generate_base_rules(allowed_messages=["CreateSurfaceMessage"])
        assert "CreateSurfaceMessage" in pruned
        assert "DeleteSurfaceMessage" not in pruned
        assert "CallRendererFunctionMessage" not in pruned

    def test_shared_dag_component_roundtrips_via_ref_tag(self):
        catalog = BasicCatalog("1.0")
        parser = A2uiXmlFormat([catalog], strict=True).create_parser()
        dag_payload = to_message_models({
            "version": "1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": catalog.catalog_id,
                "components": [
                    {
                        "id": "root",
                        "component": "Row",
                        "children": ["shared_badge", "shared_badge"],
                    },
                    {
                        "id": "shared_badge",
                        "component": "Text",
                        "text": "Shared Node",
                    },
                ],
            },
        })
        a2ui_xml_text = parser.decompile(dag_payload)
        assert "<Ref " in a2ui_xml_text
        recompiled = parser.compile(a2ui_xml_text)
        state = RendererState([catalog])
        touched = state.apply(recompiled)
        state.check_topology(touched)
        surf = state.get_surface("main")
        assert surf is not None
        root_comp = surf.components_model.get_all()["root"].properties
        assert root_comp["children"] == ["shared_badge", "shared_badge"]


class TestA2uiXmlSpecificationRoundtrip:
    """Verifies 100% strict round-tripping across all Basic Catalog specification examples."""

    @pytest.mark.parametrize("version", ["0.9", "1.0"])
    @pytest.mark.parametrize(
        "json_file", SPEC_EXAMPLE_FILES, ids=lambda p: os.path.basename(p)
    )
    def test_basic_catalog_example_strict_roundtrip(self, version: str, json_file: str):
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        if data.get("customComponents"):
            pytest.skip(f"{os.path.basename(json_file)} uses custom components")

        raw_messages = data.get("messages", [data])
        components_by_id: dict[str, dict] = {}
        data_model: dict = {}
        surface_id = "main"

        for msg in raw_messages:
            if not isinstance(msg, dict):
                continue
            if "createSurface" in msg:
                cs = msg["createSurface"]
                surface_id = cs.get("surfaceId", surface_id)
                if isinstance(cs.get("dataModel"), dict):
                    data_model.update(cs["dataModel"])
                for c in cs.get("components", []):
                    if isinstance(c, dict) and "id" in c:
                        components_by_id[c["id"]] = c
            if "updateComponents" in msg:
                for c in msg["updateComponents"].get("components", []):
                    if isinstance(c, dict) and "id" in c:
                        components_by_id[c["id"]] = c

        reachable = list(_reachable_from_root(components_by_id).values())
        if not reachable:
            pytest.skip(f"No components in {os.path.basename(json_file)}")

        catalog = BasicCatalog(version)
        strict_fmt = A2uiXmlFormat([catalog], strict=True)
        parser = strict_fmt.create_parser()

        if version == "1.0":
            payload = to_message_models({
                "version": "1.0",
                "createSurface": {
                    "surfaceId": surface_id,
                    "catalogId": catalog.catalog_id,
                    "components": reachable,
                    **({"dataModel": data_model} if data_model else {}),
                },
            })
        else:
            # Normalize `@path`/`@call` in v1.0 example components to v0.9 `path`/`call`
            norm_str = (
                json.dumps(reachable)
                .replace('"@path":', '"path":')
                .replace('"@call":', '"call":')
            )
            norm_comps = json.loads(norm_str)
            msgs_v09 = [
                {
                    "version": "v0.9",
                    "createSurface": {
                        "surfaceId": surface_id,
                        "catalogId": catalog.catalog_id,
                    },
                },
                {
                    "version": "v0.9",
                    "updateComponents": {
                        "surfaceId": surface_id,
                        "components": norm_comps,
                    },
                },
            ]
            if data_model:
                msgs_v09.append({
                    "version": "v0.9",
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": data_model,
                    },
                })
            payload = to_message_models(msgs_v09)

        a2ui_xml_doc = parser.decompile(payload)
        assert a2ui_xml_doc.strip(), "Decompiled A2UI XML must not be empty"

        # Must compile with zero Six-Laws violations (`strict=True`) AND pass RendererState topology!
        diag = parser.compile_with_diagnostics(a2ui_xml_doc, strict=True)
        assert diag.strict_valid is True
        assert diag.strict_violations == ()

        state = RendererState([catalog])
        touched = state.apply(diag.messages)
        state.check_topology(touched)
        assert state.get_surface(surface_id) is not None

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


import os
import re
import sys

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import (
    DEFAULT_PROGRESSIVE_KEYS,
    DEFAULT_WORKFLOW_RULES,
    DirectJsonFormat,
    DirectJsonParser,
)
from a2ui.inference_formats.experimental.elemental import (
    ElementalFormat,
    ElementalParser,
)
from a2ui.inference_formats.express import ExpressFormat, ExpressParser
from a2ui.utils import resolve_catalogs


@pytest.fixture
def test_catalog():
    return Catalog.from_json(
        {
            "catalogId": "https://a2ui.org/test_catalog",
            "components": {
                "Text": {
                    "properties": {"text": {"type": "string", "positionalIndex": 0}}
                }
            },
            "functions": {
                "openUrl": {
                    "properties": {"url": {"type": "string", "positionalIndex": 0}}
                }
            },
        },
        protocol_version=ProtocolVersion.V0_9,
    )


def test_schema_strategy_prompt_generation(test_catalog):
    from a2ui.processor import CatalogConfig, InMemoryCatalogProvider

    config = CatalogConfig(
        InMemoryCatalogProvider(
            test_catalog.to_json(), protocol_version=ProtocolVersion.V0_9
        ).load()
    )
    catalogs = resolve_catalogs(
        [config],
        {"v0.9": {"supportedCatalogIds": ["https://a2ui.org/test_catalog"]}},
    )

    direct_json_format = DirectJsonFormat(catalogs)
    prompt = direct_json_format.prompt_generator.generate()
    assert "### Catalog Schema:" in prompt


def test_schema_strategy_prompt_shows_the_protocol_schemas_once(test_catalog):
    direct_json_format = DirectJsonFormat(
        [test_catalog, BasicCatalog(ProtocolVersion.V0_9)]
    )

    prompt = direct_json_format.prompt_generator.generate()
    base_rules = direct_json_format.prompt_generator.generate_base_rules()
    instructions = direct_json_format.prompt_generator.generate_catalog_instructions()

    for text in (prompt, base_rules + instructions):
        assert text.count("### Agent to Renderer Schema:") == 1
        assert text.count("### Common Types Schema:") <= 1
        assert text.count("### Catalog Schema:") == 2


def test_schema_strategy_base_rules_hold_the_protocol_schemas(test_catalog):
    generator = DirectJsonFormat(
        [test_catalog, BasicCatalog(ProtocolVersion.V0_9)]
    ).prompt_generator

    base_rules = generator.generate_base_rules()
    assert base_rules.startswith(DEFAULT_WORKFLOW_RULES)
    assert "### Agent to Renderer Schema:" in base_rules
    assert "### Catalog Schema:" not in base_rules

    for catalog in (None, test_catalog):
        instructions = generator.generate_catalog_instructions(catalog=catalog)
        assert "### Agent to Renderer Schema:" not in instructions
        assert "### Common Types Schema:" not in instructions
    assert (
        generator.generate_catalog_instructions(catalog=test_catalog).count(
            "### Catalog Schema:"
        )
        == 1
    )


def test_schema_strategy_base_rules_keep_only_the_allowed_messages(
    test_catalog,
):
    generator = DirectJsonFormat([test_catalog]).prompt_generator
    pruned_generator = DirectJsonFormat(
        [test_catalog], allowed_messages=["CreateSurfaceMessage"]
    ).prompt_generator

    every_message = generator.generate_base_rules()
    overridden = generator.generate_base_rules(
        allowed_messages=["CreateSurfaceMessage"]
    )

    assert "UpdateDataModelMessage" in every_message
    assert "CreateSurfaceMessage" in overridden
    assert "UpdateDataModelMessage" not in overridden
    # The generator's own allowlist is the default, and the argument overrides it.
    assert pruned_generator.generate_base_rules() == overridden
    assert (
        pruned_generator.generate_base_rules(
            allowed_messages=["CreateSurfaceMessage", "UpdateDataModelMessage"]
        ).count("UpdateDataModelMessage")
        > 0
    )


def test_schema_parser(test_catalog):
    parser = DirectJsonParser([test_catalog])
    parsed = parser.parse_response(
        '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
        ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui is not None


def test_schema_parser_rejects_an_invalid_payload(test_catalog):
    parser = DirectJsonParser([test_catalog])
    with pytest.raises(A2uiValidationError):
        parser.parse_response(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            ' "catalogId": "https://a2ui.org/test_catalog"}}, {"version": "v0.9",'
            ' "updateComponents": {"surfaceId": "main", "components": [{"id":'
            ' "root", "component": "Unknown"}]}}]</a2ui-json>'
        )


def test_schema_parser_with_nested_close_tag(test_catalog):
    parser = DirectJsonParser([test_catalog])
    # The JSON string literal itself contains '</a2ui-json>'
    response = (
        '<a2ui-json>[{\n  "version": "v0.9",\n  "createSurface": {\n   '
        ' "surfaceId": "main",\n    "catalogId":'
        ' "https://a2ui.org/test_catalog"\n  }\n}, {\n  "version": "v0.9",\n '
        ' "updateComponents": {\n    "surfaceId": "main",\n    "components": [{\n'
        '      "id": "root",\n      "component": "Text",\n      "text": "This is'
        ' a literal close tag: </a2ui-json> inside a string."\n    }]\n '
        " }\n}]</a2ui-json>"
    )
    parsed = parser.parse_response(response)
    assert len(parsed) == 1
    assert parsed[0].a2ui is not None
    dump = parsed[0].a2ui[1].model_dump(by_alias=True, exclude_none=True)
    assert dump["updateComponents"]["components"][0]["text"] == (
        "This is a literal close tag: </a2ui-json> inside a string."
    )


def test_direct_json_parser_extracts_tagged_block(test_catalog, monkeypatch):
    monkeypatch.setenv("A2UI_VERSION_1_0", "true")
    parser = DirectJsonFormat([test_catalog]).create_parser()
    parsed = parser.parse_response(
        '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
        ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
    )
    a2ui_parts = [p for p in parsed if p.a2ui is not None]
    assert len(a2ui_parts) == 1


def test_supports_streaming_property(test_catalog):
    from a2ui.processor import CatalogConfig, InMemoryCatalogProvider

    config = CatalogConfig(
        InMemoryCatalogProvider(
            test_catalog.to_json(), protocol_version=ProtocolVersion.V0_9
        ).load()
    )

    # 1. DirectJsonFormat parser supports streaming
    direct_json_fmt = DirectJsonFormat([config.transformed_catalog])
    assert direct_json_fmt.supports_streaming is True
    assert direct_json_fmt.create_parser().supports_streaming is True

    # 2. ExpressFormat parser supports streaming
    express_fmt = ExpressFormat([test_catalog])
    assert express_fmt.supports_streaming is True
    assert express_fmt.create_parser().supports_streaming is True

    # 3. ElementalFormat parser does not support streaming
    elemental_fmt = ElementalFormat([test_catalog])
    assert elemental_fmt.supports_streaming is False
    assert elemental_fmt.create_parser().supports_streaming is False


def test_open_stream_raises_not_implemented(test_catalog):
    from a2ui.inference_formats.express import ExpressResponseStream

    express_parser = ExpressParser([test_catalog])
    assert isinstance(express_parser.open_stream(), ExpressResponseStream)

    elemental_parser = ElementalParser([test_catalog])
    with pytest.raises(NotImplementedError) as exc_info:
        elemental_parser.open_stream()
    assert "Streaming is not supported by ElementalParser" in str(exc_info.value)


def test_decompiler_delegation(test_catalog):
    from a2ui.inference_formats._shared import to_message_models
    from a2ui.processor import CatalogConfig

    config = CatalogConfig(test_catalog)
    # Verify Direct JSON Parser Decompile
    direct_json_fmt = DirectJsonFormat([config.transformed_catalog])
    payload = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": "https://a2ui.org/test_catalog",
        },
    }
    direct_decompile = direct_json_fmt.create_parser().decompile(
        to_message_models([payload])
    )
    assert "createSurface" in direct_decompile
    assert "main" in direct_decompile

    # Verify Express Parser Decompile
    express_fmt = ExpressFormat([test_catalog])
    expr_parser = express_fmt.create_parser()
    envelopes = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": "https://a2ui.org/test_catalog",
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": "Hello World",
                }],
            },
        },
    ]
    decompiled_dsl = expr_parser.decompile(to_message_models(envelopes))
    assert 'root = Text("Hello World")' in decompiled_dsl

    # Verify wrap_decompiled_blocks implementation
    assert (
        direct_json_fmt.create_parser().wrap_decompiled_blocks(["{}", "{}"])
        == "<a2ui-json>\n{}\n{}\n</a2ui-json>"
    )
    assert (
        expr_parser.wrap_decompiled_blocks(["a = 1", "b = 2"])
        == "<a2ui>\na = 1\nb = 2\n</a2ui>"
    )

    # A generator whose hooks render nothing renders an empty snippet.
    from a2ui.prompt import PromptGenerator

    class DummyPromptGenerator(PromptGenerator):

        @property
        def catalogs(self):
            return []

    assert DummyPromptGenerator().generate() == ""

    # Verify invalid catalog_id check
    from a2ui.core import A2uiCatalogError
    from a2ui.processor import InMemoryCatalogProvider

    with pytest.raises(A2uiCatalogError) as ctx:
        _ = InMemoryCatalogProvider({"catalogId": 12345}, protocol_version="1.0").load()
    assert "not a non-empty string" in str(ctx.value)

    # An empty allowlist keeps nothing. Keeping everything means not pruning.
    from a2ui.catalog_transformers import ComponentPruningTransformer
    from a2ui.utils import prune_messages_schema

    assert not ComponentPruningTransformer([]).transform(test_catalog).components
    assert prune_messages_schema({}, "0.9", []) == {}


def test_direct_json_prompt_describes_every_catalog():
    catalogs = [
        Catalog.from_json(
            {"catalogId": catalog_id, "components": {}}, protocol_version="0.9"
        )
        for catalog_id in ("a", "b")
    ]
    direct_json_format = DirectJsonFormat(catalogs)

    prompt = direct_json_format.prompt_generator.generate()

    assert '"catalogId":"a"' in prompt
    assert '"catalogId":"b"' in prompt
    assert direct_json_format.catalogs == list(catalogs)
    assert direct_json_format.create_parser().catalogs == list(catalogs)


def test_direct_json_format_passes_all_catalogs_to_v1_0_parsers():
    catalogs = [
        Catalog.from_json(
            {"catalogId": catalog_id, "components": {}}, protocol_version="1.0"
        )
        for catalog_id in ("a", "b")
    ]
    direct_json_format = DirectJsonFormat(catalogs)

    assert direct_json_format.catalogs == list(catalogs)
    assert direct_json_format.create_parser().catalogs == list(catalogs)


_CUT_TEXT_CHUNK = (
    '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1",'
    ' "catalogId": "%s"}}, {"version": "v0.9", "updateComponents":'
    ' {"surfaceId": "s1", "components": [{"id": "root", "component": "Text",'
    ' "text": "Hel'
)


@pytest.mark.parametrize(
    ("progressive_keys", "healed"),
    [(DEFAULT_PROGRESSIVE_KEYS, True), (frozenset(), False)],
    ids=["default", "healing_off"],
)
def test_direct_json_format_progressive_keys_reach_its_parser(progressive_keys, healed):
    catalog = BasicCatalog("0.9")
    direct_json_format = DirectJsonFormat([catalog], progressive_keys=progressive_keys)

    parts = (
        direct_json_format.create_parser()
        .open_stream()
        .feed(_CUT_TEXT_CHUNK % catalog.catalog_id)
    )
    messages = [
        message.model_dump(by_alias=True, exclude_none=True)
        for part in parts
        for message in getattr(part, "a2ui", None) or []
    ]
    assert any("updateComponents" in message for message in messages) == healed


_PLAIN_ANCHORED_PATH_RE = re.compile(r"\^((?:[\w./-]|\\\.)+?)/?\$?")


def _load_toml_file(path: str) -> dict[str, object]:
    if sys.version_info >= (3, 11):
        import tomllib
    else:
        import tomli as tomllib
    with open(path, "rb") as f:
        loaded: dict[str, object] = tomllib.load(f)
    return loaded


def _experimental_mypy_targets(repo_root: str) -> list[str]:
    exp_dir = os.path.join(
        repo_root,
        "python",
        "a2ui_agent",
        "src",
        "a2ui",
        "inference_formats",
        "experimental",
    )
    targets: set[str] = set()
    for root, dirs, files in os.walk(exp_dir):
        dirs[:] = [d for d in dirs if d != "__pycache__" and not d.startswith(".")]
        rel_dir = os.path.relpath(root, repo_root).replace(os.sep, "/")
        parts = rel_dir.split("/")
        for depth in range(1, len(parts) + 1):
            targets.add("/".join(parts[:depth]) + "/")
        for fname in files:
            if fname.endswith(".py"):
                targets.add(f"{rel_dir}/{fname}")
    return sorted(targets)


def _assert_mypy_excludes_valid(raw_exclude: str | list[str], repo_root: str) -> None:
    excludes = [raw_exclude] if isinstance(raw_exclude, str) else raw_exclude
    compiled = [re.compile(pat) for pat in excludes]
    targets = _experimental_mypy_targets(repo_root)
    assert any(target.endswith(".py") for target in targets)
    for target in targets:
        matching = [pat.pattern for pat in compiled if pat.search(target)]
        assert not matching, f"{target} is excluded from mypy by {matching}"

    for pat_str in excludes:
        match = _PLAIN_ANCHORED_PATH_RE.fullmatch(pat_str)
        if match is not None:
            disk_path = os.path.join(repo_root, match.group(1).replace(r"\.", "."))
            assert os.path.exists(disk_path), (
                f"[tool.mypy].exclude pattern {pat_str!r} points to missing"
                f" path {disk_path}"
            )


def test_mypy_config_includes_experimental_inference_formats() -> None:
    from .repo_paths import find_repo_root

    repo_root = find_repo_root()
    if repo_root is None:
        pytest.skip("repository root not found")

    config = _load_toml_file(os.path.join(repo_root, "pyproject.toml"))
    tool_cfg = config["tool"]
    assert isinstance(tool_cfg, dict)
    mypy_cfg = tool_cfg["mypy"]
    assert isinstance(mypy_cfg, dict)
    raw_exclude = mypy_cfg["exclude"]
    assert isinstance(raw_exclude, (str, list))
    _assert_mypy_excludes_valid(raw_exclude, repo_root)


def test_mypy_exclude_validator_handles_regex_and_directory_forms() -> None:
    from .repo_paths import find_repo_root

    repo_root = find_repo_root()
    if repo_root is None:
        pytest.skip("repository root not found")

    _assert_mypy_excludes_valid(
        r"(?x)(^eval/ | ^python/a2ui_[a-z0-9]+/tests/)", repo_root
    )
    with pytest.raises(AssertionError, match="experimental/ is excluded"):
        _assert_mypy_excludes_valid(
            ["^python/a2ui_agent/src/a2ui/inference_formats/experimental/$"],
            repo_root,
        )
    with pytest.raises(AssertionError, match="points to missing path"):
        _assert_mypy_excludes_valid(
            [r"^no_such_path_for_mypy_exclude_test\.py$"], repo_root
        )

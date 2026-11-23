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

"""Conformance tests for A2UI Skill and SkillSet APIs driven by conformance/agent/skill.yaml."""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any

import pytest

from a2ui.constants import EXAMPLES_HEADING
from a2ui.core import A2uiValidationError
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.inference_formats.experimental.atom import AtomFormat
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.inference_formats.express import ExpressFormat
from a2ui.processor import CatalogConfig
from a2ui.skill import Skill, SkillGenerator, SkillSet

from ..repo_paths import find_repo_root
from .conformance_helpers import (
    assert_known_keys,
    case_params,
    load_conformance_yaml,
)

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
SUITE = "agent/skill.yaml"
GOLDENS_DIR = os.path.join(REPO_ROOT, "conformance", "test_data", "skills")

_ERROR_CATEGORIES: dict[str, type[Exception]] = {
    "ValidationError": A2uiValidationError,
}

_CASE_METADATA_KEYS = frozenset({"name", "description", "features", "action", "args"})
_SINGLE_SKILL_CASE_KEYS = _CASE_METADATA_KEYS | frozenset({
    "expected_frontmatter",
    "expected_filename",
    "expect_contains",
    "expect_absent",
})
_SKILL_SET_CASE_KEYS = _CASE_METADATA_KEYS | frozenset({
    "expected_skills",
    "expected_lookups",
})
_FORMAT_ARGS = frozenset({"format", "catalog", "catalogs", "examples"})
_ARGS_KEYS: dict[str, frozenset[str]] = {
    "from_format": _FORMAT_ARGS | {"name", "description", "skill_catalogs"},
    "core_syntax": _FORMAT_ARGS | {"name", "description"},
    "from_catalog": (
        _FORMAT_ARGS | {"skill_catalog", "name", "description", "include_examples"}
    ),
    "skill_set": _FORMAT_ARGS | {"skill_catalogs", "core_name"},
    "monolithic_skill_equals_prompt_snippet": frozenset({"format", "catalogs"}),
}
_EXPORT_CASE_KEYS = _CASE_METADATA_KEYS | frozenset({
    "expect_error",
    "expected_files",
    "expected_absent_files",
})
_EXPECT_ERROR_KEYS = frozenset({"category", "message"})

SKILL_CASES = load_conformance_yaml(SUITE)


def test_prompt_generator_base_rules_conformance() -> None:
    """Asserts prompt_generator.generate_base_rules() matches golden file exactly."""
    cat_path = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")
    cat_config = CatalogConfig.from_path(cat_path)
    catalog = cat_config.transformed_catalog
    express_fmt = ExpressFormat([catalog])
    prompt_gen = express_fmt.prompt_generator

    golden_path = os.path.join(GOLDENS_DIR, "express_base_rules.txt")
    with open(golden_path, "r", encoding="utf-8") as f:
        expected = f.read()

    actual = prompt_gen.generate_base_rules()
    assert actual == expected


def test_prompt_generator_catalog_instructions_conformance() -> None:
    """Asserts prompt_generator.generate_catalog_instructions() matches golden file exactly."""
    cat_path = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")
    cat_config = CatalogConfig.from_path(cat_path)
    catalog = cat_config.transformed_catalog
    express_fmt = ExpressFormat([catalog])
    prompt_gen = express_fmt.prompt_generator

    golden_path = os.path.join(GOLDENS_DIR, "express_catalog_instructions.txt")
    with open(golden_path, "r", encoding="utf-8") as f:
        expected = f.read()

    actual = prompt_gen.generate_catalog_instructions(catalog=catalog)
    assert actual == expected


def _run_export_to_directory_case(case: dict[str, Any], args: dict[str, Any]) -> None:
    """Exports literal skills into a temp dir and checks what survives."""
    assert_known_keys(case, _EXPORT_CASE_KEYS, "export_to_directory case")
    with tempfile.TemporaryDirectory(prefix="a2ui-skill-export-") as temp_dir:
        for rel in args.get("pre_existing_files", []):
            abs_path = os.path.join(temp_dir, rel)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write("pre-existing")

        def run() -> None:
            skill_set = SkillSet()
            for spec in args.get("skills", []):
                skill_set.add(
                    Skill(
                        name=spec["name"],
                        description=spec["description"],
                        content=spec["content"],
                        filename=spec.get("filename"),
                    )
                )
            written = skill_set.export_to_directory(temp_dir)
            assert written == skill_set.to_dict()
            for rel, markdown in written.items():
                with open(os.path.join(temp_dir, rel), encoding="utf-8") as f:
                    assert f.read() == markdown

        expect_error = case.get("expect_error")
        if expect_error is not None:
            assert_known_keys(expect_error, _EXPECT_ERROR_KEYS, "expect_error")
            with pytest.raises(
                _ERROR_CATEGORIES[expect_error["category"]],
                match=expect_error.get("message"),
            ):
                run()
        else:
            run()

        for rel in case.get("expected_files", []):
            assert os.path.exists(
                os.path.join(temp_dir, rel)
            ), f"expected {rel} to exist"
        for rel in case.get("expected_absent_files", []):
            assert not os.path.exists(
                os.path.join(temp_dir, rel)
            ), f"expected {rel} to be removed"


def _catalogs_body(prompt_gen: Any, catalogs: list[Any]) -> str:
    """The body of a monolithic skill for catalogs that aren't the format's own."""
    examples: list[str] = []
    for cat in catalogs:
        text = prompt_gen.generate_examples(catalog=cat)
        if text and text not in examples:
            examples.append(text)
    sections = [
        prompt_gen.generate_base_rules(),
        *(prompt_gen.generate_catalog_instructions(catalog=cat) for cat in catalogs),
    ]
    if examples:
        sections.append(EXAMPLES_HEADING + "\n\n".join(examples))
    return "\n\n".join(section for section in sections if section)


def _load_example(rel_path: str) -> Any:
    """Loads the messages of one prompt example, relative to the repository root."""
    with open(os.path.join(REPO_ROOT, rel_path), encoding="utf-8") as f:
        return to_message_models(json.load(f))


@pytest.mark.parametrize("suite, case", case_params(SUITE, SKILL_CASES))
def test_skill_yaml_conformance_cases(suite: str, case: dict[str, Any]) -> None:
    """Executes one declared test case from conformance/agent/skill.yaml."""
    del suite
    action = case["action"]
    args = case.get("args", {})

    if action == "export_to_directory":
        _run_export_to_directory_case(case, args)
        return

    if action in _ARGS_KEYS:
        assert_known_keys(args, _ARGS_KEYS[action], f"{action} args")
    cat_rel_paths = args.get("catalogs") or (
        [args["catalog"]] if args.get("catalog") else []
    )
    catalogs_by_path = {
        rel_path: (
            CatalogConfig.from_path(
                os.path.join(REPO_ROOT, rel_path)
            ).transformed_catalog
        )
        for rel_path in cat_rel_paths
    }
    catalogs = list(catalogs_by_path.values())
    examples = [_load_example(rel) for rel in args.get("examples", [])] or None

    fmt_name = args.get("format", "express")
    if fmt_name == "express":
        fmt: Any = ExpressFormat(catalogs, examples=examples)
    elif fmt_name == "direct_json":
        fmt = DirectJsonFormat(catalogs, examples=examples)
    elif fmt_name == "atom":
        fmt = AtomFormat(catalogs)
    elif fmt_name == "elemental":
        fmt = ElementalFormat(catalogs)
    else:
        raise ValueError(f"Unsupported format: {fmt_name}")

    generator = SkillGenerator(fmt)

    prompt_gen = fmt.prompt_generator

    # The generator's arguments, passed only when the case gives them, so that a
    # case without them checks the defaults. A catalog a case gives is one of the
    # format's own.
    skill_args = {key: args[key] for key in ("name", "description") if key in args}
    skill_catalogs = (
        [catalogs_by_path[rel] for rel in args["skill_catalogs"]]
        if "skill_catalogs" in args
        else None
    )
    catalogs_arg = {} if skill_catalogs is None else {"catalogs": skill_catalogs}

    def expect_skill(skill_obj: Skill, body: str) -> None:
        """Checks the skill against the case, and its body against `body`."""
        assert skill_obj.to_markdown() == (
            f"---\n{case['expected_frontmatter']}---\n\n{body.strip()}\n"
        )
        if "expected_filename" in case:
            assert skill_obj.filename == case["expected_filename"]
        for text in case.get("expect_contains", []):
            assert text in skill_obj.content
        for text in case.get("expect_absent", []):
            assert text not in skill_obj.content

    if action == "from_format":
        assert_known_keys(case, _SINGLE_SKILL_CASE_KEYS, "from_format case")
        snippet = prompt_gen.generate()
        skill_obj = generator.generate_skill(**skill_args, **catalogs_arg)
        expect_skill(
            skill_obj,
            snippet
            if skill_catalogs is None
            else _catalogs_body(prompt_gen, skill_catalogs),
        )
        assert prompt_gen.generate() == snippet

    elif action == "core_syntax":
        assert_known_keys(case, _SINGLE_SKILL_CASE_KEYS, "core_syntax case")
        expect_skill(
            generator.generate_core_skill(**skill_args),
            prompt_gen.generate_base_rules(),
        )

    elif action == "from_catalog":
        assert_known_keys(case, _SINGLE_SKILL_CASE_KEYS, "from_catalog case")
        given = (
            {"catalog": catalogs_by_path[args["skill_catalog"]]}
            if "skill_catalog" in args
            else {}
        )
        if "include_examples" in args:
            given["include_examples"] = args["include_examples"]
        cat = given.get("catalog", catalogs[0])
        body = prompt_gen.generate_catalog_instructions(catalog=cat)
        examples_text = (
            prompt_gen.generate_examples(catalog=cat)
            if given.get("include_examples", True)
            else ""
        )
        if examples_text:
            body += f"\n\n{EXAMPLES_HEADING}{examples_text}"
        expect_skill(generator.generate_catalog_skill(**given, **skill_args), body)

    elif action == "monolithic_skill_equals_prompt_snippet":
        assert_known_keys(
            case, _CASE_METADATA_KEYS, "monolithic_skill_equals_prompt_snippet case"
        )
        skill_obj = generator.generate_skill()
        snippet = fmt.prompt_generator.generate()
        assert skill_obj.content == snippet + "\n"
        # The serialized skill trims whitespace at the body's ends.
        assert skill_obj.to_markdown().split("---\n\n", 1)[1] == snippet.strip() + "\n"

    elif action == "skill_set":
        assert_known_keys(case, _SKILL_SET_CASE_KEYS, "skill_set case")
        given_core = "core_name" in args
        skill_set = generator.generate_skillset(
            **catalogs_arg, **({"core_name": args["core_name"]} if given_core else {})
        )
        skills_by_file = skill_set.to_dict()
        assert list(skills_by_file) == case["expected_skills"]
        core = generator.generate_core_skill(
            **({"name": args["core_name"]} if given_core else {})
        )
        expected = [core] + [
            generator.generate_catalog_skill(c)
            for c in (catalogs if skill_catalogs is None else skill_catalogs)
        ]
        assert list(skills_by_file.values()) == [s.to_markdown() for s in expected]
        for query, filename in case.get("expected_lookups", {}).items():
            found = skill_set.get(query)
            assert (found.filename if found else None) == filename, query

    else:
        pytest.fail(f"Unhandled conformance action: {action!r}")

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

import os
import tempfile
from typing import Any

import pytest

from a2ui.core import A2uiValidationError
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
_SINGLE_FILE_CASE_KEYS = _CASE_METADATA_KEYS | frozenset({"expected_file"})
_SKILL_SET_CASE_KEYS = _CASE_METADATA_KEYS | frozenset({
    "expected_skills",
    "expected_skill_files",
})
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
            skill_set.export_to_directory(temp_dir)

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


@pytest.mark.parametrize("suite, case", case_params(SUITE, SKILL_CASES))
def test_skill_yaml_conformance_cases(suite: str, case: dict[str, Any]) -> None:
    """Executes one declared test case from conformance/agent/skill.yaml."""
    del suite
    action = case["action"]
    args = case.get("args", {})

    if action == "export_to_directory":
        _run_export_to_directory_case(case, args)
        return

    cat_rel_path = args.get("catalog")
    catalog = None
    if cat_rel_path:
        abs_cat_path = os.path.join(REPO_ROOT, cat_rel_path)
        cat_config = CatalogConfig.from_path(abs_cat_path)
        catalog = cat_config.transformed_catalog

    fmt_name = args.get("format", "express")
    catalogs = [catalog] if catalog else []
    if fmt_name == "express":
        fmt: Any = ExpressFormat(catalogs)
    elif fmt_name == "atom":
        fmt = AtomFormat(catalogs)
    elif fmt_name == "elemental":
        fmt = ElementalFormat(catalogs)
    else:
        raise ValueError(f"Unsupported format: {fmt_name}")

    generator = SkillGenerator(fmt)

    if action == "from_format":
        assert_known_keys(case, _SINGLE_FILE_CASE_KEYS, "from_format case")
        mono_name = args.get("name", "a2ui")
        skill_obj = generator.generate_skill(name=mono_name)
        expected_rel = case["expected_file"]
        expected_abs = os.path.join(REPO_ROOT, expected_rel)
        with open(expected_abs, "r", encoding="utf-8") as gf:
            expected_content = gf.read()
        assert skill_obj.to_markdown() == expected_content

    elif action == "core_syntax":
        assert_known_keys(case, _SINGLE_FILE_CASE_KEYS, "core_syntax case")
        core_name = args.get("name", "a2ui-core")
        skill_obj = generator.generate_core_skill(name=core_name)
        expected_rel = case["expected_file"]
        expected_abs = os.path.join(REPO_ROOT, expected_rel)
        with open(expected_abs, "r", encoding="utf-8") as gf:
            expected_content = gf.read()
        assert skill_obj.to_markdown() == expected_content

    elif action == "from_catalog":
        assert_known_keys(case, _SINGLE_FILE_CASE_KEYS, "from_catalog case")
        assert catalog is not None
        skill_obj = generator.generate_catalog_skill(catalog)
        expected_rel = case["expected_file"]
        expected_abs = os.path.join(REPO_ROOT, expected_rel)
        with open(expected_abs, "r", encoding="utf-8") as gf:
            expected_content = gf.read()
        assert skill_obj.to_markdown() == expected_content

    elif action == "skill_set":
        assert_known_keys(case, _SKILL_SET_CASE_KEYS, "skill_set case")
        skill_set = generator.generate_skillset()
        skills_by_file = skill_set.to_dict()
        for k in case.get("expected_skills", []):
            assert k in skills_by_file
        for k, golden_rel in case.get("expected_skill_files", {}).items():
            with open(os.path.join(REPO_ROOT, golden_rel), "r", encoding="utf-8") as gf:
                assert skills_by_file[k] == gf.read(), k

    else:
        pytest.fail(f"Unhandled conformance action: {action!r}")

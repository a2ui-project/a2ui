#!/usr/bin/env python3
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

"""Validates blueprint specifications across the repository.

This script discovers and checks the integrity of Module Blueprints, Feature
Blueprints, and Codebase Blueprints. It ensures that all references are
resolvable, file naming conventions are met, and fields follow requirements.
"""

from __future__ import annotations

import glob
import os
import re
import sys
from typing import Any

COMMIT_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
SNAKE_CASE_RE = re.compile(r'^[a-z0-9_]+$')
FEATURE_FILE_RE = re.compile(r'^([a-z0-9_]+)\.blueprint\.md$')


def _coerce_yaml_scalar(raw_val: str, empty_as_dict: bool = False) -> Any:
    """Coerces a stripped YAML scalar value into its Python representation."""
    lower_val = raw_val.lower()
    if lower_val == 'true':
        return True
    if lower_val == 'false':
        return False
    if lower_val in ('null', 'none', '~'):
        return None
    if raw_val == '[]':
        return []
    if raw_val == '{}':
        return {}
    if raw_val == '' and empty_as_dict:
        return {}
    return raw_val


def _append_yaml_list_item(
    data: dict[str, Any], path: list[tuple[int, str]], val: Any
) -> None:
    """Appends an item to a nested YAML list container."""
    parent: Any = data
    for i, (_, pk) in enumerate(path):
        if i == len(path) - 1 and isinstance(parent[pk], dict) and not parent[pk]:
            parent[pk] = []
        parent = parent[pk]
    if isinstance(parent, list):
        parent.append(val)


def _set_yaml_dict_key(
    data: dict[str, Any], path: list[tuple[int, str]], key: str, val: Any
) -> None:
    """Sets a key-value pair on a nested YAML dictionary container."""
    parent: Any = data
    for _, pk in path:
        parent = parent[pk]
    if isinstance(parent, dict):
        parent[key] = val


def parse_yaml(yaml_str: str) -> dict[str, Any]:
    """Parses a YAML string into a dictionary.

    A simple, zero-dependency YAML parser for blueprint frontmatter.
    Handles nested dicts and lists based on indentation.

    Args:
        yaml_str: The raw YAML string to parse.

    Returns:
        A dictionary containing the parsed YAML data.
    """
    data: dict[str, Any] = {}
    path: list[tuple[int, str]] = []

    for raw_line in yaml_str.splitlines():
        line = re.sub(r'#.*$', '', raw_line)
        stripped = line.strip()
        if not stripped:
            continue

        indent = len(line) - len(line.lstrip())
        while path and indent <= path[-1][0]:
            path.pop()

        if stripped.startswith('- '):
            raw_val = stripped[2:].strip().strip('"\'')
            _append_yaml_list_item(data, path, _coerce_yaml_scalar(raw_val))
        elif ':' in stripped:
            key, val_str = stripped.split(':', 1)
            clean_key = key.strip()
            raw_val = val_str.strip().strip('"\'')
            val = _coerce_yaml_scalar(raw_val, empty_as_dict=True)
            _set_yaml_dict_key(data, path, clean_key, val)
            path.append((indent, clean_key))

    return data


def parse_frontmatter(
    file_path: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Parses the YAML frontmatter from a markdown file.

    Args:
        file_path: Absolute path to the markdown file.

    Returns:
        A tuple of (metadata, error_message). If successful, error_message is
        None. If parsing fails, metadata is None.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return None, f'Failed to read file: {e}'

    if not content.startswith('---'):
        return None, "File does not start with frontmatter separator '---'"

    parts = content.split('---', 2)
    if len(parts) < 3:
        return None, "File does not have matching frontmatter separator '---'"

    try:
        data = parse_yaml(parts[1])
        return data, None
    except Exception as e:
        return None, f'Failed to parse YAML frontmatter: {e}'


def discover_module_blueprints(
    modules_dir: str, errors: list[str]
) -> dict[str, dict[str, Any]]:
    """Discovers and validates module blueprints under modules_dir."""
    module_blueprints: dict[str, dict[str, Any]] = {}
    if not os.path.exists(modules_dir):
        errors.append(f"Modules directory '{modules_dir}' does not exist")
        return module_blueprints

    for file in sorted(glob.glob(os.path.join(modules_dir, '*.blueprint.md'))):
        basename = os.path.basename(file)
        data, err = parse_frontmatter(file)
        if err or data is None:
            errors.append(f'Module blueprint {basename}: {err or "No data returned"}')
            continue

        name = data.get('name')
        if not name:
            errors.append(
                f"Module blueprint {basename}: Missing mandatory 'name' field in"
                ' frontmatter'
            )
            continue

        if not SNAKE_CASE_RE.match(name):
            errors.append(
                f"Module blueprint {basename}: 'name' '{name}' must be snake_case"
            )

        expected_filename = f'{name}.blueprint.md'
        if basename != expected_filename:
            errors.append(
                f'Module blueprint {basename}: Filename does not match name'
                f" '{name}' (expected '{expected_filename}')"
            )

        module_blueprints[name] = {'file': basename}

    return module_blueprints


def _validate_single_feature_blueprint(
    full_path: str,
    rel_path: str,
    file: str,
    module_blueprints: dict[str, dict[str, Any]],
    errors: list[str],
) -> tuple[str, dict[str, Any]] | None:
    """Validates a single feature blueprint file and returns its metadata."""
    match = FEATURE_FILE_RE.match(file)
    if not match:
        errors.append(
            f"Feature blueprint '{rel_path}': Filename does not follow"
            ' required feature_name.blueprint.md snake_case format (no'
            ' date prefix)'
        )
        return None

    extracted_name = match.group(1)
    data, err = parse_frontmatter(full_path)
    if err or data is None:
        errors.append(f"Feature blueprint '{rel_path}': {err or 'No data returned'}")
        return None

    feature_name = data.get('feature_name')
    if not feature_name:
        errors.append(
            f"Feature blueprint '{rel_path}': Missing mandatory"
            " 'feature_name' field in frontmatter"
        )
        return None

    if feature_name != extracted_name:
        errors.append(
            f"Feature blueprint '{rel_path}': 'feature_name'"
            f" '{feature_name}' does not match name in filename"
            f" '{extracted_name}'"
        )

    mod_list = _validate_feature_modules(rel_path, data, module_blueprints, errors)
    deps = _validate_feature_deps_field(rel_path, data, errors)
    return feature_name, {
        'file': rel_path,
        'module_blueprints': mod_list,
        'dependencies': deps,
    }


def _validate_feature_modules(
    rel_path: str,
    data: dict[str, Any],
    module_blueprints: dict[str, dict[str, Any]],
    errors: list[str],
) -> list[str]:
    """Validates the module_blueprints field of a feature blueprint."""
    mod_list = data.get('module_blueprints')
    if mod_list is None:
        errors.append(
            f"Feature blueprint '{rel_path}': Missing mandatory"
            " 'module_blueprints' field in frontmatter"
        )
        return []
    if not isinstance(mod_list, list):
        errors.append(
            f"Feature blueprint '{rel_path}': 'module_blueprints' must"
            ' be a list of module names'
        )
        return []
    for mod_name in mod_list:
        if mod_name not in module_blueprints:
            errors.append(
                f"Feature blueprint '{rel_path}': References"
                f" unknown module blueprint '{mod_name}'"
            )
    return mod_list


def _validate_feature_deps_field(
    rel_path: str, data: dict[str, Any], errors: list[str]
) -> list[str]:
    """Validates the dependencies field of a feature blueprint."""
    dependencies = data.get('dependencies')
    if dependencies is None:
        return []
    if not isinstance(dependencies, list):
        errors.append(
            f"Feature blueprint '{rel_path}': 'dependencies' must"
            ' be a list of feature names'
        )
        return []
    for dep in dependencies:
        if not isinstance(dep, str):
            errors.append(
                f"Feature blueprint '{rel_path}': Each"
                ' dependency must be a string (feature name)'
            )
    return dependencies


def _validate_feature_dep_links(
    feature_blueprints: dict[str, dict[str, Any]], errors: list[str]
) -> None:
    """Validates that all declared feature dependencies exist in feature_blueprints."""
    for feat_info in feature_blueprints.values():
        for dep in feat_info['dependencies']:
            if dep not in feature_blueprints:
                errors.append(
                    f"Feature blueprint '{feat_info['file']}': Dependency '{dep}' is"
                    ' not a valid feature blueprint in the repository'
                )


def discover_feature_blueprints(
    features_dir: str,
    module_blueprints: dict[str, dict[str, Any]],
    errors: list[str],
) -> dict[str, dict[str, Any]]:
    """Discovers and validates feature blueprints under features_dir."""
    feature_blueprints: dict[str, dict[str, Any]] = {}
    if not os.path.exists(features_dir):
        return feature_blueprints

    for root, _, files in os.walk(features_dir):
        for file in sorted(files):
            if not file.endswith('.blueprint.md'):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, features_dir)
            res = _validate_single_feature_blueprint(
                full_path, rel_path, file, module_blueprints, errors
            )
            if res is not None:
                feature_blueprints[res[0]] = res[1]

    _validate_feature_dep_links(feature_blueprints, errors)
    return feature_blueprints


def _validate_single_feature_claim(
    rel_path: str,
    associated_module: str,
    feat_name: str,
    feat_commit: Any,
    check_commit: bool,
    claimed_names: set[str],
    feature_blueprints: dict[str, dict[str, Any]],
    errors: list[str],
) -> None:
    """Validates a single feature entry in a codebase blueprint's implemented_features."""
    if check_commit and feat_commit is not None:
        if not isinstance(feat_commit, str) or not COMMIT_SHA_RE.match(feat_commit):
            errors.append(
                f"Codebase blueprint '{rel_path}': Feature '{feat_name}' commit"
                f" '{feat_commit}' must be a 40-character lowercase hex git commit"
                ' SHA or null'
            )

    if feat_name not in feature_blueprints:
        errors.append(
            f"Codebase blueprint '{rel_path}': References"
            f" unknown implemented feature '{feat_name}'"
        )
        return

    feat_info = feature_blueprints[feat_name]
    if associated_module not in feat_info['module_blueprints']:
        errors.append(
            f"Codebase blueprint '{rel_path}': Implemented"
            f" feature '{feat_name}' does not target"
            f" associated_module '{associated_module}'"
            f" (targets: {feat_info['module_blueprints']})"
        )

    for dep in feat_info['dependencies']:
        if dep not in claimed_names:
            errors.append(
                f"Codebase blueprint '{rel_path}': Implemented"
                f" feature '{feat_name}' requires dependency"
                f" feature '{dep}' in 'implemented_features'"
            )


def validate_implemented_features(
    rel_path: str,
    associated_module: str,
    implemented_features: Any,
    feature_blueprints: dict[str, dict[str, Any]],
    errors: list[str],
    allow_legacy_list: bool = False,
) -> None:
    """Validates the implemented_features section of a codebase blueprint."""
    if (
        implemented_features is None
        or implemented_features == []
        or implemented_features == {}
    ):
        return

    if isinstance(implemented_features, dict):
        claimed_names = set(implemented_features.keys())
        for feat_name, feat_commit in implemented_features.items():
            _validate_single_feature_claim(
                rel_path,
                associated_module,
                feat_name,
                feat_commit,
                True,
                claimed_names,
                feature_blueprints,
                errors,
            )
    elif allow_legacy_list and isinstance(implemented_features, list):
        claimed_names = set(implemented_features)
        for feat_name in implemented_features:
            _validate_single_feature_claim(
                rel_path,
                associated_module,
                feat_name,
                None,
                False,
                claimed_names,
                feature_blueprints,
                errors,
            )
    else:
        errors.append(
            f"Codebase blueprint '{rel_path}': 'implemented_features'"
            ' must be a mapping of feature names to 40-character git commit hashes'
        )


def _validate_single_codebase_blueprint(
    full_path: str,
    rel_path: str,
    file: str,
    workspace_root: str,
    module_blueprints: dict[str, dict[str, Any]],
    feature_blueprints: dict[str, dict[str, Any]],
    errors: list[str],
    warnings: list[str],
    allow_legacy_list: bool = False,
) -> bool:
    """Validates one codebase blueprint file."""
    if file != 'codebase.blueprint.md':
        warnings.append(
            f"Codebase directory contains extra file '{rel_path}'"
            ' (intermediate blueprints should be folded into'
            " 'codebase.blueprint.md' when complete)"
        )

    if not re.match(r'^[a-z0-9_]+\.blueprint\.md$', file):
        errors.append(
            f"Codebase blueprint '{rel_path}': Filename does not follow"
            ' required <name>.blueprint.md snake_case format'
        )
        return False

    data, err = parse_frontmatter(full_path)
    if err or data is None:
        errors.append(f"Codebase blueprint '{rel_path}': {err or 'No data returned'}")
        return False

    associated_module = data.get('associated_module')
    if not associated_module:
        errors.append(
            f"Codebase blueprint '{rel_path}': Missing mandatory"
            " 'associated_module' field in frontmatter"
        )
        return False

    if associated_module not in module_blueprints:
        errors.append(
            f"Codebase blueprint '{rel_path}': References unknown"
            f" associated_module '{associated_module}'"
        )

    codebase_path = data.get('codebase_path')
    if not codebase_path:
        errors.append(
            f"Codebase blueprint '{rel_path}': Missing mandatory"
            " 'codebase_path' field in frontmatter"
        )
    elif not isinstance(codebase_path, str):
        errors.append(
            f"Codebase blueprint '{rel_path}': 'codebase_path' must be a string"
        )
    elif not os.path.exists(os.path.join(workspace_root, codebase_path)):
        errors.append(
            f"Codebase blueprint '{rel_path}': 'codebase_path'"
            f" '{codebase_path}' points to non-existent directory"
        )

    commit_hash = data.get('module_blueprint_commit')
    if commit_hash is not None and (
        not isinstance(commit_hash, str) or not COMMIT_SHA_RE.match(commit_hash)
    ):
        errors.append(
            f"Codebase blueprint '{rel_path}': 'module_blueprint_commit'"
            ' must be a 40-character lowercase hex git commit SHA or null'
        )

    validate_implemented_features(
        rel_path,
        associated_module,
        data.get('implemented_features'),
        feature_blueprints,
        errors,
        allow_legacy_list=allow_legacy_list,
    )
    return True


def main() -> None:
    """Discovers, validates, and reports on all blueprints in the repository.

    Validates Module Blueprints, Feature Blueprints, and Codebase Blueprints.
    Exits with code 0 on success, or code 1 with detailed error logs on failure.
    """
    blueprints_root = os.path.abspath(os.path.dirname(__file__))
    workspace_root = os.path.abspath(os.path.join(blueprints_root, '..'))
    errors: list[str] = []
    warnings: list[str] = []

    modules_dir = os.path.join(blueprints_root, 'modules')
    module_blueprints = discover_module_blueprints(modules_dir, errors)

    features_dir = os.path.join(blueprints_root, 'features')
    feature_blueprints = discover_feature_blueprints(
        features_dir, module_blueprints, errors
    )

    codebases_dir = os.path.join(blueprints_root, 'codebases')
    if os.path.exists(codebases_dir):
        for root, _, files in os.walk(codebases_dir):
            for file in sorted(files):
                if file.startswith('.'):
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, blueprints_root)
                _validate_single_codebase_blueprint(
                    full_path,
                    rel_path,
                    file,
                    workspace_root,
                    module_blueprints,
                    feature_blueprints,
                    errors,
                    warnings,
                )
    else:
        errors.append(f"Codebases directory '{codebases_dir}' does not exist")

    for warn in warnings:
        print(f'Warning: {warn}', file=sys.stderr)

    if errors:
        print(
            f'=== Blueprint Validation Failed with {len(errors)} error(s) ===',
            file=sys.stderr,
        )
        for err in errors:
            print(f'Error: {err}', file=sys.stderr)
        sys.exit(1)

    print('=== Blueprint Validation Passed Successfully ===')
    sys.exit(0)


if __name__ == '__main__':
    main()

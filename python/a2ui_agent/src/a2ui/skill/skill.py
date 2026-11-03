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

"""Skill and SkillSet domain objects for A2UI skill packages."""

from collections.abc import Iterator, Sequence
import ntpath
import os
import posixpath
import re
import shutil
from typing import Any, Optional
import yaml

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.inference_format import InferenceFormat


def _clean_catalog_name(catalog: Any) -> str:
    """Derives a clean, LLM-friendly catalog name from a catalog ID or URL."""
    raw_id = getattr(catalog, "catalog_id", "basic")
    if not raw_id:
        return "basic"
    if "/" in raw_id or "\\" in raw_id:
        raw_id = raw_id.replace("\\", "/")
        parts = [p for p in raw_id.split("/") if p and not p.endswith(".json")]
        if parts:
            cand = parts[-1]
            if cand.startswith("v") and len(parts) > 1:
                cand = parts[-2]
            raw_id = cand
    return raw_id.lower()


def _resolve_catalogs_list(
    catalogs: Optional[Sequence[CatalogApi]],
    fmt: InferenceFormat,
) -> list[CatalogApi]:
    """Resolves catalogs from an explicit sequence or the format's defaults."""
    if catalogs is not None:
        return list(catalogs)

    defaults: list[CatalogApi] = []
    if hasattr(fmt, "catalogs") and fmt.catalogs:
        defaults.extend(fmt.catalogs)

    return defaults


def _validate_skill_filename(filename: str) -> str:
    """Checks that a skill filename stays inside the directory a SkillSet is exported to.

    The filename must be relative and contain no empty, `.` or `..` segment. Both `/`
    and `\\` separate segments, so a filename is rejected on every platform it would
    escape on.

    Raises:
        A2uiValidationError: If the filename is not such a path. It subclasses
            `ValueError`, so callers catching that still do.
    """
    segments = re.split(r"[\\/]", filename)
    escapes = (
        not filename
        or posixpath.isabs(filename)
        or ntpath.isabs(filename)
        or any(segment in ("", ".", "..") for segment in segments)
    )
    if escapes:
        raise A2uiValidationError(
            f"Skill filename {filename!r} must be a relative path without '.' or"
            " '..' segments."
        )
    return filename


def _assert_resolves_inside(target: str, output_root: str, filename: str) -> None:
    """Checks that `target` resolves, through any symlinks, to `output_root` or inside it.

    The nearest existing ancestor of `target` (or `target` itself) is resolved with
    `os.path.realpath`. The lexical check in `_validate_skill_filename` cannot see a
    symlinked directory under the output directory, and removing or writing through one
    would reach outside it. `output_root` must already be resolved.

    Raises:
        A2uiValidationError: If the resolved path is outside `output_root`.
    """
    existing = target
    while not os.path.lexists(existing):
        parent = os.path.dirname(existing)
        if parent == existing:
            break
        existing = parent
    real = os.path.realpath(existing)
    if real != output_root and not real.startswith(output_root + os.sep):
        raise A2uiValidationError(
            f"Skill filename {filename!r} resolves through a symlink to {real!r},"
            " outside the output directory."
        )


class Skill:
    """Represents a single A2UI Skill package with YAML frontmatter metadata and markdown content.

    Allows developers to inspect and mutate fields (name, description, metadata, content)
    before serializing back to markdown format.

    `filename` is the path the skill is written to, relative to the directory a SkillSet
    is exported to. It is checked on construction and on every assignment, so
    `SkillSet.export_to_directory` can rely on every filename staying inside its output
    directory.

    Raises:
        A2uiValidationError: If `filename` is absolute or has an empty, `.` or `..`
            segment.
    """

    def __init__(
        self,
        name: str,
        description: str,
        content: str,
        metadata: Optional[dict[str, Any]] = None,
        filename: Optional[str] = None,
    ):
        self.name = name
        self.description = description
        self.content = content
        self.metadata = metadata or {}
        self._filename = _validate_skill_filename(filename or f"{name}/SKILL.md")

    @property
    def filename(self) -> str:
        """The path the skill is written to, relative to the export directory."""
        return self._filename

    @filename.setter
    def filename(self, value: str) -> None:
        self._filename = _validate_skill_filename(value)

    def to_markdown(self) -> str:
        """Serializes skill object back to complete markdown string with YAML frontmatter."""
        fm: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
        }
        if self.metadata:
            fm["metadata"] = self.metadata

        yaml_str = yaml.dump(fm, sort_keys=False).strip()
        return f"---\n{yaml_str}\n---\n\n{self.content.strip()}\n"

    def __str__(self) -> str:
        return self.to_markdown()

    def __repr__(self) -> str:
        return f"Skill(name={self.name!r}, filename={self.filename!r})"


class SkillSet:
    """Collection of Skill objects representing a modular or multi-skill package."""

    def __init__(self, skills: Optional[dict[str, Skill]] = None):
        # Keys are the paths the export writes, so they are held to the same rule as
        # `Skill.filename`.
        self._skills: dict[str, Skill] = {
            _validate_skill_filename(key): skill
            for key, skill in (skills or {}).items()
        }

    def add(self, skill: Skill) -> None:
        """Adds a Skill to the collection, keyed by its filename.

        The filename is checked again here, since the export trusts every key of this
        mapping and a caller can bypass the `filename` setter.
        """
        self._skills[_validate_skill_filename(skill.filename)] = skill

    def get(self, filename: str) -> Optional[Skill]:
        """Retrieves a Skill by filename or key."""
        if filename in self._skills:
            return self._skills[filename]
        # Search by exact skill name first
        for sk in self._skills.values():
            if sk.name == filename:
                return sk
        # Search by partial filename with minimum length constraint
        if len(filename) >= 3:
            for sk in self._skills.values():
                if filename in sk.filename:
                    return sk
        return None

    def to_dict(self) -> dict[str, str]:
        """Serializes all skills to a dictionary mapping filename to markdown text."""
        return {
            filename: skill.to_markdown() for filename, skill in self._skills.items()
        }

    def export_to_directory(self, output_dir: str) -> dict[str, str]:
        """Exports all skills in the set to the specified output directory on disk.

        Args:
            output_dir: The root skills directory where skill packages should be written
                (for example, the root skills path `.agents/skills` or `/path/to/skill-registry`).

        What is wiped:
            The directory that directly holds each skill file (for example,
            `{output_dir}/a2ui-core` for `a2ui-core/SKILL.md`) is completely wiped
            before writing. This ensures no stale or orphaned files from prior exports
            (such as old scripts, obsolete notes, or deleted sub-files) persist. A
            symlink or regular file at that path is removed as such, not followed.

        What is NOT wiped:
            - Ancestors of a skill's directory (for example `{output_dir}/src` for
              `src/skills/nested/SKILL.md`).
            - Unrelated sibling skill directories located in `output_dir` (e.g.
              `{output_dir}/git-workflow/` or `{output_dir}/custom-agent-skill/`) are
              strictly preserved and never touched.
            - The `output_dir` root directory itself is never wiped.

        Every filename was checked when it entered the set, and each skill directory's
        parent is resolved through symlinks before anything is removed, so nothing here
        can reach outside `output_dir`.

        Raises:
            A2uiValidationError: If a skill directory's parent is a symlink that resolves outside
                `output_dir`. Nothing is removed or written in that case.

        Returns:
            A dictionary mapping skill filenames to generated markdown content.
        """
        os.makedirs(output_dir, exist_ok=True)
        output_root = os.path.realpath(output_dir)

        # Check every skill directory before touching any, so a bad one aborts the
        # export whole.
        skill_dirs_to_clean: dict[str, str] = {}
        for filename in self._skills:
            dir_name = os.path.dirname(filename)
            if not dir_name:
                continue
            skill_folder = os.path.join(output_dir, dir_name)
            _assert_resolves_inside(
                os.path.dirname(skill_folder), output_root, filename
            )
            skill_dirs_to_clean[skill_folder] = filename

        for skill_folder in skill_dirs_to_clean:
            # A symlink is removed as a link, never followed; `rmtree` would refuse it.
            if os.path.islink(skill_folder) or os.path.isfile(skill_folder):
                os.unlink(skill_folder)
            elif os.path.isdir(skill_folder):
                shutil.rmtree(skill_folder)

        results = {}
        for filename, skill in self._skills.items():
            file_path = os.path.join(output_dir, filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            markdown_text = skill.to_markdown()
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(markdown_text)
            results[filename] = markdown_text
        return results

    def __getitem__(self, key: str) -> Skill:
        item = self.get(key)
        if item is None:
            raise KeyError(key)
        return item

    def __iter__(self) -> Iterator[str]:
        return iter(self._skills)

    def keys(self) -> Any:
        return self._skills.keys()

    def values(self) -> Any:
        return self._skills.values()

    def items(self) -> Any:
        return self._skills.items()

    def __len__(self) -> int:
        return len(self._skills)

    def __repr__(self) -> str:
        return f"SkillSet({list(self._skills.keys())!r})"

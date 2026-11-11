# Copyright 2026 Google LLC
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

"""Structural checks of one `ReactApp` component, with structured diagnostics."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import math
import re
from typing import Any, Literal

from a2ui.core import A2uiErrorDetail, A2uiValidationError

ALLOWED_MODULES: tuple[str, ...] = (
    "react",
    "react/jsx-runtime",
    "react-dom",
    "react-dom/client",
    "a2ui",
    "a2ui:bindings",
)
"""The modules a ReactApp may import, as the runtime's import map maps them."""

ReactAppDiagnosticCode = Literal[
    "missing_source",
    "missing_default_export",
    "forbidden_import",
    "triple_quote",
    "invalid_data_paths",
    "invalid_functions",
    "compiled_set",
    "invalid_height",
]

# Strings are matched so that comment markers inside them are kept; comments
# are matched so that imports inside them are ignored.
_STRING_OR_COMMENT_RE = re.compile(
    r"""("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)"""
    r"""|//[^\n]*|/\*[\s\S]*?\*/"""
)
# `import x from "m"`, `import {a, b} from "m"`, `import "m"`, `export ... from "m"`.
_STATIC_IMPORT_RE = re.compile(
    r"""(?:^|[\s;}])(?:import|export)\b(?:[\s\w{},*$]*?\bfrom)?\s*(['"])([^'"\n]+)\1"""
)
_DYNAMIC_IMPORT_RE = re.compile(r"""\bimport\s*\(\s*(?:(['"`])([^'"`\n]*)\1\s*\))?""")
_REQUIRE_RE = re.compile(r"""\brequire\s*\(""")
_DEFAULT_EXPORT_RE = re.compile(
    r"""\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b"""
)
_JSON_POINTER_RE = re.compile(r"(?:/(?:[^~/]|~[01])*)*")


@dataclass(frozen=True)
class ReactAppDiagnostic:
    """One problem found in a `ReactApp` component.

    Attributes:
        code: A stable identifier of the kind of problem.
        message: What is wrong and how to fix it, written for the model.
        property_name: The component property the problem is in, such as `source`.
        component_id: The component's `id`, if it has one.
        surface_id: The surface the component is on, if known.
    """

    code: ReactAppDiagnosticCode
    message: str
    property_name: str
    component_id: str | None = None
    surface_id: str | None = None

    @property
    def path(self) -> str:
        """The property's path, in the style of `A2uiErrorDetail.path`."""
        return f"components.{self.component_id or '?'}.{self.property_name}"

    def to_error_detail(self) -> A2uiErrorDetail:
        """Returns the diagnostic as an `A2uiErrorDetail`."""
        return A2uiErrorDetail(
            path=self.path,
            code=self.code,
            message=self.message,
            surface_id=self.surface_id,
        )

    def describe(self) -> str:
        """Returns a one-line description that names the component."""
        where = f"ReactApp '{self.component_id or '?'}'"
        if self.surface_id:
            where += f" on surface '{self.surface_id}'"
        return f"{where}, `{self.property_name}`: {self.message}"


class ReactAppValidationError(A2uiValidationError):
    """Raised when `ReactApp` components fail their checks.

    The message lists every problem, so it can go back to the model as is in a
    retry prompt. `diagnostics` holds the same problems as data.
    """

    def __init__(self, diagnostics: Sequence[ReactAppDiagnostic]) -> None:
        self.diagnostics: list[ReactAppDiagnostic] = list(diagnostics)
        count = len(self.diagnostics)
        lines = [
            f"The ReactApp check found {count} problem{'s' if count != 1 else ''}:",
            *(f"- {d.describe()}" for d in self.diagnostics),
        ]
        super().__init__(
            "\n".join(lines),
            details=[d.to_error_detail() for d in self.diagnostics],
        )


def _strip_comments(source: str) -> str:
    """Replaces the comments in TypeScript source with spaces, keeping strings."""
    return _STRING_OR_COMMENT_RE.sub(
        lambda m: m.group(1) if m.group(1) is not None else " ", source
    )


def _imported_modules(code: str) -> tuple[list[str], list[str]]:
    """Returns the statically imported modules and descriptions of other loads."""
    modules = [m.group(2) for m in _STATIC_IMPORT_RE.finditer(code)]
    other: list[str] = []
    for m in _DYNAMIC_IMPORT_RE.finditer(code):
        if m.group(2) is None:
            other.append("a dynamic `import()` of a computed module")
        else:
            modules.append(m.group(2))
    if _REQUIRE_RE.search(code):
        other.append("`require()`, which the runtime doesn't define")
    return modules, other


def _check_source(source: Any) -> list[tuple[ReactAppDiagnosticCode, str]]:
    if not isinstance(source, str) or not source.strip():
        return [(
            "missing_source",
            "`source` must be the app's TSX code as a non-empty string.",
        )]
    problems: list[tuple[ReactAppDiagnosticCode, str]] = []
    code = _strip_comments(source)
    if not _DEFAULT_EXPORT_RE.search(code):
        problems.append((
            "missing_default_export",
            (
                "The app must default-export its component: `export default function"
                " App() { ... }`."
            ),
        ))
    modules, other = _imported_modules(code)
    allowed = ", ".join(f"`{m}`" for m in ALLOWED_MODULES)
    for module in dict.fromkeys(modules):
        if module not in ALLOWED_MODULES:
            problems.append((
                "forbidden_import",
                f"The app imports `{module}`, but it can import only {allowed}.",
            ))
    for load in other:
        problems.append((
            "forbidden_import",
            f"The app uses {load}; import only {allowed}, with static imports.",
        ))
    if '"""' in source:
        problems.append((
            "triple_quote",
            (
                'The code contains three double quotes in a row (`"""`), which ends'
                " the raw Express string early. Use single quotes or template"
                " literals instead."
            ),
        ))
    return problems


def _check_string_list(
    value: Any, *, json_pointers: bool
) -> list[tuple[ReactAppDiagnosticCode, str]]:
    if json_pointers:
        code: ReactAppDiagnosticCode = "invalid_data_paths"
        what = "`dataPaths` must be a list of JSON pointers, such as `/loan/rate`"
    else:
        code = "invalid_functions"
        what = "`functions` must be a list of function names"
    if not isinstance(value, list):
        return [(code, f"{what}.")]
    problems: list[tuple[ReactAppDiagnosticCode, str]] = []
    for item in value:
        if not isinstance(item, str) or not item:
            problems.append((code, f"{what}; {item!r} is not one."))
        elif json_pointers and not _JSON_POINTER_RE.fullmatch(item):
            problems.append((
                code,
                (
                    f"{what}; {item!r} is not one. Start each path with `/`, and"
                    " write `~` as `~0` and `/` inside a key as `~1`."
                ),
            ))
    return problems


def _check_height(value: Any) -> list[tuple[ReactAppDiagnosticCode, str]]:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value <= 0
    ):
        return [(
            "invalid_height",
            f"`height` must be a positive number of CSS pixels, not {value!r}.",
        )]
    return []


def check_react_app(
    component: Mapping[str, Any], *, surface_id: str | None = None
) -> list[ReactAppDiagnostic]:
    """Checks the structure of one `ReactApp` component.

    The checks are cheap and need no TypeScript toolchain: `source` is a
    non-empty string that default-exports a component, imports only
    `ALLOWED_MODULES` and has no three double quotes in a row; `dataPaths`
    holds JSON pointers; `functions` holds names; `height` is positive; and
    `compiled`, which only the agent server may set, is absent. They don't
    type-check the code.

    Args:
        component: The component as a wire-format dict.
        surface_id: The surface the component is on, for the diagnostics.

    Returns:
        Every problem found, in property order. Empty when the component
        passes.
    """
    found: list[tuple[str, ReactAppDiagnosticCode, str]] = [
        ("source", code, message)
        for code, message in _check_source(component.get("source"))
    ]
    if "dataPaths" in component:
        found += [
            ("dataPaths", code, message)
            for code, message in _check_string_list(
                component["dataPaths"], json_pointers=True
            )
        ]
    if "functions" in component:
        found += [
            ("functions", code, message)
            for code, message in _check_string_list(
                component["functions"], json_pointers=False
            )
        ]
    if "compiled" in component:
        found.append((
            "compiled",
            "compiled_set",
            (
                "Don't set `compiled`; the agent server fills it in after checking"
                " `source`."
            ),
        ))
    if "height" in component:
        found += [
            ("height", code, message)
            for code, message in _check_height(component["height"])
        ]
    raw_id = component.get("id")
    component_id = raw_id if isinstance(raw_id, str) else None
    return [
        ReactAppDiagnostic(
            code=code,
            message=message,
            property_name=prop,
            component_id=component_id,
            surface_id=surface_id,
        )
        for prop, code, message in found
    ]

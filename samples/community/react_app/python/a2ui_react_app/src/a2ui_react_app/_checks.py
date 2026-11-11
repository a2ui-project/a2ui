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

"""Structural checks of one `ReactApp` component, with structured diagnostics."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
import math
import re
from typing import Any, Literal

from a2ui.core import A2uiErrorDetail, A2uiValidationError

from ._source import (
    A2UI_MODULE_EXPORTS,
    ReactAppSourceFacts,
    react_app_source_facts,
    strip_comments,
)

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
    "invalid_actions",
    "compiled_set",
    "invalid_height",
    "forbidden_api",
    "misplaced_hook",
    "unknown_function",
    "unlisted_use",
    "missing_allowlist",
    "compile_error",
    "type_error",
    "compile_unavailable",
]

# `import x from "m"`, `import {a, b} from "m"`, `import "m"`, `export ... from "m"`.
_STATIC_IMPORT_RE = re.compile(
    r"""(?:^|[\s;}])(?:import|export)\b(?:[\s\w{},*$]*?\bfrom)?\s*(['"])([^'"\n]+)\1"""
)
_DYNAMIC_IMPORT_RE = re.compile(r"""\bimport\s*\(\s*(?:(['"`])([^'"`\n]*)\1\s*\))?""")
_REQUIRE_RE = re.compile(r"""\brequire\s*\(""")
_DEFAULT_EXPORT_RE = re.compile(
    r"""\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b"""
)
_SEGMENT = r"(?:[^~/]|~[01])*"
# An absolute JSON pointer, or a path relative to the component's data context.
_DATA_PATH_RE = re.compile(rf"(?:/{_SEGMENT})*|(?:[^~/]|~[01])+(?:/{_SEGMENT})*")


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
    code = strip_comments(source)
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


_LIST_RULES: dict[str, tuple[ReactAppDiagnosticCode, str]] = {
    "dataPaths": (
        "invalid_data_paths",
        "`dataPaths` must be a list of JSON pointers, such as `/loan/rate`",
    ),
    "functions": ("invalid_functions", "`functions` must be a list of function names"),
    "actions": ("invalid_actions", "`actions` must be a list of action names"),
}


def _check_string_list(
    value: Any, prop: str
) -> list[tuple[ReactAppDiagnosticCode, str]]:
    code, what = _LIST_RULES[prop]
    json_pointers = prop == "dataPaths"
    if not isinstance(value, list):
        return [(code, f"{what}.")]
    problems: list[tuple[ReactAppDiagnosticCode, str]] = []
    for item in value:
        if not isinstance(item, str) or not item:
            problems.append((code, f"{what}; {item!r} is not one."))
        elif json_pointers and not _DATA_PATH_RE.fullmatch(item):
            problems.append((
                code,
                (
                    f"{what}; {item!r} is not one. Start each path with `/` (or"
                    " leave it off for a path relative to the component's data"
                    " context), and write `~` as `~0` and `/` inside a key as `~1`."
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


_FORBIDDEN_API_HELP = (
    "The app has no network access and can't leave its frame, so the browser"
    " blocks it. Get data through an agent function or the data model. If the"
    " user asked for data you can't get, say so in your text; never simulate it."
)


def _check_uses(
    facts: ReactAppSourceFacts,
    component: Mapping[str, Any],
    functions: Collection[str] | None,
    malformed: Collection[str],
) -> list[tuple[str, ReactAppDiagnosticCode, str]]:
    """Checks what the source does against the catalogs and the allowlists."""
    found: list[tuple[str, ReactAppDiagnosticCode, str]] = []
    for api in facts.forbidden_apis:
        found.append((
            "source",
            "forbidden_api",
            f"The app uses {api}. {_FORBIDDEN_API_HELP}",
        ))
    for hook, where in facts.misplaced_hooks:
        found.append((
            "source",
            "misplaced_hook",
            (
                f"`{hook}` is called inside {where}. Call hooks only at the top"
                " level of a component or custom hook, never inside effects,"
                " event handlers, loops or conditions; React stops the app with"
                " error #321 otherwise. To write a value from an effect or a"
                " handler, call the setter of a top-level `useData`."
            ),
        ))
    listed = component.get("functions")
    listed_names = (
        [n for n in listed if isinstance(n, str)] if isinstance(listed, list) else []
    )
    for prop, names in (
        ("source", sorted(facts.called_functions)),
        ("functions", listed_names),
    ):
        for name in names:
            if name in A2UI_MODULE_EXPORTS:
                found.append((
                    prop,
                    "unknown_function",
                    (
                        f"`{name}` is a function of the `a2ui` module, not a catalog"
                        f" function: import it from 'a2ui' and call `{name}(...)`"
                        " directly. Only catalog functions go through"
                        " `callFunction`, `useFunction`, `a2ui:bindings` or"
                        " `functions`."
                    ),
                ))
            elif functions is not None and name not in functions:
                known = ", ".join(f"`{n}`" for n in sorted(functions)) or "none"
                found.append((
                    prop,
                    "unknown_function",
                    (
                        f"`{name}` isn't a function the catalogs declare. The app can"
                        f" call only these: {known}."
                    ),
                ))
    found += _check_coverage(facts, component, malformed)
    return found


def _path_listed(path: str, entries: Sequence[str]) -> bool:
    """Whether the host's `dataPaths` check lets `path` through."""
    for entry in entries:
        prefix = entry[:-1] if entry.endswith("/") else entry
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False


def _check_coverage(
    facts: ReactAppSourceFacts,
    component: Mapping[str, Any],
    malformed: Collection[str],
) -> list[tuple[str, ReactAppDiagnosticCode, str]]:
    """Checks that the allowlists cover what the source uses.

    The surface refuses whatever an allowlist leaves out, and treats a
    missing allowlist as empty. `ReactAppTransformer` fills in a missing list
    when the source names everything it uses with string literals.
    """
    found: list[tuple[str, ReactAppDiagnosticCode, str]] = []
    uses = (
        (
            "dataPaths",
            sorted(facts.paths),
            facts.dynamic_paths,
            "paths it reads or writes",
        ),
        (
            "functions",
            sorted(facts.called_functions - set(A2UI_MODULE_EXPORTS)),
            facts.dynamic_functions,
            "functions it calls",
        ),
        (
            "actions",
            sorted(facts.actions),
            facts.dynamic_actions,
            "actions it dispatches",
        ),
    )
    for prop, used, dynamic, what in uses:
        if prop in malformed:
            continue
        entries = component.get(prop)
        if not isinstance(entries, list):
            if used or dynamic:
                found.append((
                    prop,
                    "missing_allowlist",
                    (
                        f"`{prop}` is missing, and the surface refuses everything a"
                        f" ReactApp doesn't list. List every one of the {what} in"
                        f" `{prop}`."
                    ),
                ))
            continue
        names = [e for e in entries if isinstance(e, str)]
        for item in used:
            ok = _path_listed(item, names) if prop == "dataPaths" else item in names
            if not ok:
                found.append((
                    prop,
                    "unlisted_use",
                    (
                        f"The app uses `{item}`, but `{prop}` doesn't list it, so the"
                        f" surface will refuse it. Add it to `{prop}`."
                    ),
                ))
    return found


def check_react_app(
    component: Mapping[str, Any],
    *,
    surface_id: str | None = None,
    functions: Collection[str] | None = None,
) -> list[ReactAppDiagnostic]:
    """Checks the structure of one `ReactApp` component.

    The checks are cheap and need no TypeScript toolchain:

    - `source` is a non-empty string that default-exports a component,
      imports only `ALLOWED_MODULES` and has no three double quotes in a row.
    - `source` uses no browser API the frame blocks, such as `fetch`, and
      calls no hook inside an effect, a handler or a loop callback.
    - Every function the source calls, or `functions` lists, is a catalog
      function rather than an `a2ui` module function such as `setData`, and
      one of `functions` (the declared names) when those are given.
    - `dataPaths` holds JSON pointers, and `functions` and `actions` hold
      names. Each list is present and covers the literal paths and names the
      source uses, since the surface refuses the rest.
    - `height` is positive, and `compiled`, which only the agent server may
      set, is absent.

    They don't type-check the code.

    Args:
        component: The component as a wire-format dict.
        surface_id: The surface the component is on, for the diagnostics.
        functions: The names of the functions the catalogs declare. None
            skips the check that called functions are declared.

    Returns:
        Every problem found, in property order. Empty when the component
        passes.
    """
    source = component.get("source")
    found: list[tuple[str, ReactAppDiagnosticCode, str]] = [
        ("source", code, message) for code, message in _check_source(source)
    ]
    lists = [
        (prop, code, message)
        for prop in _LIST_RULES
        if prop in component
        for code, message in _check_string_list(component[prop], prop)
    ]
    if isinstance(source, str) and source.strip():
        malformed = {prop for prop, _, _ in lists}
        found += _check_uses(
            react_app_source_facts(source), component, functions, malformed
        )
    found += lists
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
    order = {name: index for index, name in enumerate(_PROPERTY_ORDER)}
    found.sort(key=lambda item: order.get(item[0], len(order)))
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


_PROPERTY_ORDER = ("source", "dataPaths", "functions", "actions", "compiled", "height")

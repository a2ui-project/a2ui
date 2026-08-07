# Copyright 2026 Google LLC
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

"""Core engine for synthesizing A2UI Agent Skills from catalogs and examples."""

from __future__ import annotations

import glob
import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

# Imported lazily / for typing only. Generating a skill is catalog projection plus template
# filling -- it does not need the schema-validation stack, and requiring it would drag in
# dependencies (and a newer Python) that the generator itself has no use for. BasicCatalog is
# imported inside the one branch that needs it: the fallback when no catalog is supplied.
if TYPE_CHECKING:
    from ..schema.catalog import CatalogConfig, A2uiCatalog

from .config import RuntimeProfile, SkillConfig
from .templates import (
    RUNTIME_SHIM_JS,
    SKILL_MD_TEMPLATE,
    VALIDATE_UI_TEMPLATE,
)


# Declaration-only keys. They describe how to BUILD the tree and must never reach the device
# as component properties -- the renderer would pass them through to a component that has no
# idea what they mean.
_DECL_KEYS = ("when", "requires", "emptyMessage", "normalize", "resolve", "userText", "confirm")


class _Raw(str):
    """A pre-rendered JS expression, emitted verbatim instead of JSON-encoded.

    Lowering per-item logic means a prop value can be `S1 + '/label'` -- an expression, not
    data -- so props stop being pure JSON and need a serializer that can carry both.
    """


def _js_value(v: Any) -> str:
    """Serializes a prop value to JS. Matches json.dumps byte for byte on plain data, so an
    example that declares none of the computed forms generates exactly what it did before."""
    if isinstance(v, _Raw):
        return str(v)
    if isinstance(v, dict):
        return "{" + ", ".join(f"{json.dumps(k)}: {_js_value(x)}" for k, x in v.items()) + "}"
    if isinstance(v, list):
        return "[" + ", ".join(_js_value(x) for x in v) + "]"
    return json.dumps(v)


def _needs_loop(node: Any) -> bool:
    """True when a subtree cannot be rendered as a client-side List template.

    A template is ONE component repeated, so it cannot render a car hop differently from a
    flight, and it cannot compute a label. When either appears anywhere below a repetition,
    that repetition has to be expanded in code instead.
    """
    if isinstance(node, dict):
        if "when" in node:
            return True
        for k, v in node.items():
            if k in ("type", "component", "id"):
                continue
            if isinstance(v, dict) and "format" in v:
                return True
            if _needs_loop(v):
                return True
        return False
    if isinstance(node, list):
        return any(_needs_loop(x) for x in node)
    return False


class SkillGenerator:
    """Orchestrates creation of custom .agents/skills/<skill-name>/ directories."""

    def __init__(
        self,
        config: Optional[SkillConfig] = None,
        runtime: Optional[RuntimeProfile] = None,
        catalogs: Optional[List[Union[str, CatalogConfig, Dict[str, Any]]]] = None,
        capabilities: Optional[str] = None,
        examples_path: Optional[str] = None,
        examples: Optional[List[Union[str, Dict[str, Any]]]] = None,
        version: str = "0.9",
    ):
        """Initializes the generator.

        Args:
            config: What skill to build -- name, output dir, catalogs, examples.
            runtime: Which host the skill must run on (defaults to RuntimeProfile.webview()).
            catalogs: Override for config.catalogs.
            capabilities: Override for config.capabilities.
            examples_path: Override for config.examples_path.
            examples: Override for config.examples.
            version: A2UI protocol version used to resolve a default basic catalog.
        """
        self.config = config or SkillConfig()
        self.runtime = runtime or RuntimeProfile.webview()
        self.version = version
        self.catalogs_raw = catalogs or self.config.catalogs
        self.capabilities_path = capabilities or self.config.capabilities
        self.examples_path = examples_path or self.config.examples_path
        self.examples_raw = examples or self.config.examples or []
        self.parsed_catalogs: List[Dict[str, Any]] = []
        self._load_catalogs()

    def _load_catalogs(self) -> None:
        """Loads and normalizes catalog dictionary definitions."""
        if not self.catalogs_raw:
            try:
                from ..basic_catalog.provider import BasicCatalog  # lazy: see module header

                cfg = BasicCatalog.get_config(self.version)
                loaded_dict = cfg.provider.load()
                self.parsed_catalogs.append(loaded_dict)
            except Exception:
                self.parsed_catalogs.append(self._get_default_basic_catalog_dict())
        else:
            for item in self.catalogs_raw:
                if isinstance(item, str):
                    # An explicitly-passed path that does not resolve is an ERROR, not a
                    # reason to carry on. Skipping it silently produced a skill with an empty
                    # component section and a pre-flight that allowed nothing -- generated,
                    # reported as success, and unable to render anything at all.
                    if not os.path.exists(item):
                        raise FileNotFoundError(
                            f"catalog not found: {item!r} (resolved against {os.getcwd()!r}). "
                            "Pass a path that exists, or omit --catalog to use the basic catalog."
                        )
                    with open(item, "r", encoding="utf-8") as f:
                        self.parsed_catalogs.append(json.load(f))
                elif isinstance(item, dict):
                    self.parsed_catalogs.append(item)
                elif hasattr(item, "provider"):
                    self.parsed_catalogs.append(item.provider.load())

    def _get_default_basic_catalog_dict(self) -> Dict[str, Any]:
        """Provides a standard fallback basic catalog definition."""
        return {
            "catalog_id": "https://a2ui.org/catalogs/basic",
            "components": {
                "Text": {
                    "description": "Displays text content",
                    "properties": {"text": {"type": "string"}, "usage": {"type": "string"}},
                },
                "Button": {
                    "description": "Interactive action button",
                    "properties": {"label": {"type": "string"}, "action_id": {"type": "string"}},
                },
                "Card": {
                    "description": "Container card",
                    "properties": {"title": {"type": "string"}, "children": {"type": "array"}},
                },
                "Container": {
                    "description": "Generic layout container",
                    "properties": {"direction": {"type": "string"}, "children": {"type": "array"}},
                },
                "Image": {
                    "description": "Displays an image asset",
                    "properties": {"url": {"type": "string"}, "alt": {"type": "string"}},
                },
            },
        }

    def _extract_components(self) -> Dict[str, Dict[str, Any]]:
        """Consolidates all component definitions across loaded catalogs (supporting dict and list formats)."""
        components = {}
        for cat in self.parsed_catalogs:
            comps = cat.get("components", {})
            if isinstance(comps, dict):
                components.update(comps)
            elif isinstance(comps, list):
                for item in comps:
                    if isinstance(item, dict) and "name" in item:
                        c_name = item["name"]
                        props_raw = item.get("props") or item.get("properties") or {}
                        norm_props = {}
                        if isinstance(props_raw, dict):
                            for p_name, p_val in props_raw.items():
                                if isinstance(p_val, dict):
                                    norm_props[p_name] = p_val
                                else:
                                    norm_props[p_name] = {"type": str(p_val)}
                        desc = item.get("description", f"{c_name} component")
                        entry = {"description": desc, "properties": norm_props}
                        # A catalog entry may point at a full JSON Schema. The inline `props`
                        # shorthand is often lossy -- in practice it omits fields the schema
                        # marks REQUIRED (e.g. a card's `id`, which selection bindings refer
                        # to). Merge the schema so the projection documents what the
                        # component actually needs, not just what the shorthand listed.
                        self._merge_component_schema(entry, item.get("schema"))
                        components[c_name] = entry
        return components

    def _merge_component_schema(self, entry: Dict[str, Any], schema_ref: Any) -> None:
        """Folds a referenced component JSON Schema into a catalog entry, in place."""
        if not schema_ref or not isinstance(schema_ref, str):
            return
        path = schema_ref
        if not os.path.isabs(path):
            for base in self._schema_search_paths():
                candidate = os.path.join(base, schema_ref)
                if os.path.exists(candidate):
                    path = candidate
                    break
        if not os.path.exists(path):
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                schema = json.load(f)
        except Exception:
            return

        if schema.get("description") and entry.get("description", "").endswith("component"):
            entry["description"] = schema["description"].split("\n")[0].strip()

        required = set(schema.get("required") or [])
        props = entry.setdefault("properties", {})
        for name, spec in (schema.get("properties") or {}).items():
            if name == "component":  # the discriminator, not an authored prop
                continue
            if name not in props:
                kind = spec.get("type") or ("binding" if "$ref" in spec else "any")
                props[name] = {"type": str(kind)}
            if name in required:
                props[name] = {**props[name], "required": True}

    def _schema_search_paths(self) -> List[str]:
        """Directories a relative component-schema reference may resolve against."""
        bases = [os.getcwd()]
        for item in self.catalogs_raw or []:
            if isinstance(item, str) and os.path.exists(item):
                bases.append(os.path.dirname(os.path.abspath(item)))
                bases.append(os.path.dirname(os.path.dirname(os.path.abspath(item))))
        return bases

    def _build_catalog_documentation(self) -> str:
        """Generates markdown component documentation for SKILL.md."""
        comps = self._extract_components()
        lines = []
        for comp_name, comp_info in comps.items():
            desc = comp_info.get("description", "A2UI UI Component")
            props = comp_info.get("properties", {})
            lines.append(f"### `{comp_name}`")
            lines.append(f"{desc}\n")
            if props:
                lines.append("**Properties:**")
                for prop_name, prop_spec in props.items():
                    prop_type = prop_spec.get("type", "any")
                    req = " **required**" if prop_spec.get("required") else ""
                    lines.append(f"- `{prop_name}` ({prop_type}){req}")
            lines.append("")
        return "\n".join(lines)

    def _client_capability_names(self) -> List[str]:
        """Client-surface capability names, for the SKILL.md frontmatter.

        Host tooling parses this frontmatter (e.g. to decide which skills apply to which
        client), so omitting it makes a skill depend on the parser's defaults rather than
        stating its own contract.
        """
        return [
            c.get("name")
            for c in self._load_capabilities()
            if isinstance(c, dict) and c.get("name") and c.get("surface", "client") == "client"
        ]

    def _load_capabilities(self) -> List[Dict[str, Any]]:
        """Reads the capability catalog, normalizing list and map forms."""
        path = self.capabilities_path
        if not path or not os.path.exists(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return []
        caps = data.get("capabilities", [])
        if isinstance(caps, dict):
            caps = [{**v, "name": k} for k, v in caps.items()]
        return [c for c in caps if isinstance(c, dict)]

    def _build_capability_documentation(self) -> str:
        """Renders the capability catalog as markdown for SKILL.md.

        A client handshake advertises capability NAMES only, so the typed args/results are
        not otherwise reachable by the authoring agent.
        """
        caps = self._load_capabilities()
        if not caps:
            return "_No capability catalog supplied._"
        lines = []
        for c in caps:
            name = c.get("name", "?")
            lines.append(f"### `{name}`")
            summary = " ".join((c.get("summary") or c.get("description") or "").split())
            if summary:
                # Cap rather than split on ". " -- abbreviations like "e.g. " truncate a
                # sentence mid-clause and produce misleading docs.
                if len(summary) > 240:
                    cut = summary.rfind(". ", 0, 240)
                    summary = summary[: cut + 1] if cut > 80 else summary[:240].rstrip() + "..."
                lines.append(summary + "\n")
            args = (c.get("args") or {}).get("properties") or {}
            if args:
                lines.append("- args: " + ", ".join(f"`{k}`" for k in args))
            required = (c.get("args") or {}).get("required") or []
            if required:
                lines.append("- required: " + ", ".join(f"`{k}`" for k in required))
            if c.get("fallback"):
                lines.append(f"- if unavailable: {c['fallback']}")
            lines.append("")
        return "\n".join(lines) if lines else "_No capabilities declared._"

    @staticmethod
    def _parse_a2ui_example(raw: Any) -> Dict[str, Any]:
        """Normalizes an A2UI example into {components(nested root), data}.

        The canonical example IS a stream of A2UI messages -- `updateComponents` carries the
        component tree, `updateDataModel` carries the data it renders. Accepting that format
        directly means an example needs no bespoke wrapper, no separate fixture file, and no
        metadata: everything the pre-flight needs is already in the protocol.
        """
        msgs = raw if isinstance(raw, list) else [raw]
        comps, data = None, {}
        for m in msgs:
            if not isinstance(m, dict):
                continue
            if "updateComponents" in m:
                comps = m["updateComponents"].get("components")
            elif "updateDataModel" in m:
                data = m["updateDataModel"].get("value", {})
            elif "payload" in m and comps is None:   # legacy single-payload form
                comps = m["payload"]
        if isinstance(comps, list):
            by_id = {c.get("id"): c for c in comps if isinstance(c, dict)}
            root = by_id.get("root") or (comps[0] if comps else None)

            def nest(node):
                if not isinstance(node, dict):
                    return node
                out = {k: v for k, v in node.items() if k not in ("id", "children")}
                children = node.get("children")
                # A2UI TEMPLATE children: {componentId, path} means "repeat this component for
                # every item at path". Carry it through as `template` + the single child, which
                # is the form the runtime shim compiles back into the same descriptor. Treating
                # it as a plain id list drops the repeated content entirely -- the template is
                # referenced by nothing and disappears, leaving an empty list.
                if isinstance(children, dict) and children.get("componentId"):
                    tpl = by_id.get(children["componentId"])
                    if tpl is not None:
                        out["template"] = children.get("path", "")
                        out["children"] = [nest(tpl)]
                    return out
                kids = [by_id[k] for k in (children or []) if k in by_id]
                if kids:
                    out["children"] = [nest(k) for k in kids]
                return out

            comps = nest(root) if root else None
        return {"components": comps or {}, "data": data}

    def _convert_a2ui_message_to_webview_js(self, msg_data: Dict[str, Any], name: str) -> str:
        """Converts an A2UI example message into a SCAFFOLD for a classic-main host.

        The example supplies the static half -- the component tree and its binding paths.
        The dynamic half (what a selection means, derived totals, when Confirm enables) is
        not recoverable from one rendered frame, so it is left as explicit TODOs for an
        authoring agent to complete and the pre-flight to certify.
        """
        payload = msg_data.get("components", msg_data.get("payload", msg_data))
        used: set = set()
        events: list = []

        def collect_events(node):
            if isinstance(node, dict):
                act = node.get("action")
                if isinstance(act, dict):
                    ev = act.get("event")
                    if isinstance(ev, dict) and ev.get("name") and ev["name"] not in events:
                        events.append(ev["name"])
                for v in node.values():
                    collect_events(v)
            elif isinstance(node, list):
                for v in node:
                    collect_events(v)

        collect_events(payload)

        groups: list = []

        def collect_groups(node):
            if isinstance(node, dict):
                t = node.get("template")
                if isinstance(t, str) and t.startswith("/") and t not in groups:
                    groups.append(t)
                for v in node.values():
                    collect_groups(v)
            elif isinstance(node, list):
                for v in node:
                    collect_groups(v)

        collect_groups(payload)

        multi: list = []

        def collect_multi(node):
            if isinstance(node, dict):
                t = node.get("template")
                if isinstance(t, str) and t.startswith("/") and node.get("selectionMode") == "multi":
                    if t not in multi:
                        multi.append(t)
                for v in node.values():
                    collect_multi(v)
            elif isinstance(node, list):
                for v in node:
                    collect_multi(v)

        collect_multi(payload)

        # A button may declare a CAPABILITY call rather than a bare event. Invoking a
        # capability is behaviour, not a rendered value, so it cannot be read back from a
        # frame -- declaring it in the example is what lets the scaffold wire it up instead of
        # leaving a button that looks functional and does nothing.
        caps: list = []

        def collect_caps(node):
            if isinstance(node, dict):
                act = node.get("action")
                if isinstance(act, dict) and isinstance(act.get("capability"), dict):
                    c = act["capability"]
                    ev = (act.get("event") or {}).get("name") or c.get("name", "invoke")
                    entry = {"event": ev, "name": c.get("name"), "args": c.get("args") or {}}
                    if entry not in caps:
                        caps.append(entry)
                for v in node.values():
                    collect_caps(v)
            elif isinstance(node, list):
                for v in node:
                    collect_caps(v)

        collect_caps(payload)

        # SKIP an emit when the tree is unchanged -- but only because the HOST repaints
        # itself on a data write. That is load-bearing: some of what a component shows is
        # derived at render time and exists nowhere in the tree (a DateField's min/max
        # error, a `min` bound to a sibling field), so something must redraw. A first
        # attempt at this dedupe alone, without the host-side repaint, silently broke
        # validation display -- the emitted tree was identical, so nothing ever redrew.

        # CONFIRM GATING is declared, not inferred. A frame shows a repeated array; it does
        # not show whether that array is "groups that each need a pick" (one flight per leg)
        # or "options to pick one of" (four restaurants). Guessing wrong disables the button
        # forever with no explanation, which is the worst dead end a surface can have -- so
        # the default is not to gate, and a surface that needs a gate says so.
        #   all-groups: every index of every repetition needs a pick
        #   any:        at least one pick anywhere on the surface
        #   none:       never disabled (default)
        root_decl = payload if isinstance(payload, dict) else {}
        gate_mode = (root_decl.get("confirm") or {}).get("require", "none")

        # Set when any repetition had to be lowered to a code loop, or a computed value
        # appeared -- both need the data helpers in the prelude.
        state = {"lowered": False, "scopes": 0}

        def scope_expr(scope: Optional[str]) -> str:
            return scope if scope else "null"

        def prop_value(v: Any, scope: Optional[str]) -> Any:
            """Rewrites a declared prop into what the module should emit at this scope."""
            if isinstance(v, dict) and "format" in v and len(v) == 1:
                # A COMPUTED string: joined windows, ticket counts. Not a value in a frame,
                # so it is resolved here rather than bound.
                state["lowered"] = True
                return _Raw(f"fmt({json.dumps(v['format'])}, {scope_expr(scope)})")
            if isinstance(v, dict) and isinstance(v.get("path"), str):
                p = v["path"]
                path_expr = (json.dumps(p) if p.startswith("/")
                             else f"{scope} + {json.dumps('/' + p)}" if scope
                             else json.dumps(p))
                if scope and not v.get("write"):
                    # In a code loop the item is already known, so a READ resolves to its
                    # value here rather than travelling as a path. That is what makes the
                    # emitted tree say "Castelo de S. Jorge" instead of /itinerary/things/0
                    # -- the difference between a surface you can assert on and one where a
                    # silently missed lookup still looks structurally perfect.
                    return _Raw(f"read({path_expr})")
                out = dict(v)
                if scope and not p.startswith("/"):
                    # A WRITE keeps its path: the client needs somewhere to put the edit, and
                    # it has to be the item's ABSOLUTE path or every pick lands on one key.
                    out["path"] = _Raw(path_expr)
                return out
            if isinstance(v, dict):
                return {k: prop_value(x, scope) for k, x in v.items()}
            if isinstance(v, list):
                return [prop_value(x, scope) for x in v]
            return v

        def format_node(node: Any, indent_level: int = 2, scope: Optional[str] = None) -> str:
            if not isinstance(node, dict):
                return json.dumps(node)
            comp_type = node.get("type") or node.get("component")
            if not comp_type:
                return json.dumps(node)
            used.add(comp_type)
            indent = "  " * indent_level
            inner = "  " * (indent_level + 1)
            props, children = {}, []
            for k, v in node.items():
                if k in ("type", "component", "id") or k in _DECL_KEYS:
                    continue
                if k == "children" and isinstance(v, list):
                    children = v
                else:
                    props[k] = v
            # Gate the CONFIRM button on every group having a pick. The example cannot express
            # this -- "disabled until chosen" is a predicate over selection state, not a value in
            # a rendered frame -- but the groups are derivable, so the scaffold can wire it.
            act = props.get("action")
            if isinstance(act, dict) and isinstance(act.get("capability"), dict):
                cap = act["capability"]
                ev = (act.get("event") or {}).get("name") or cap.get("name", "invoke")
                props["action"] = {"event": {"name": ev}}   # the renderer only knows events
            gate = (comp_type == "Button" and gate_mode in ("all-groups", "any")
                    and (gate_mode != "all-groups" or groups)
                    and isinstance(props.get("action"), dict)
                    and (props["action"].get("event") or {}).get("name") == "confirm")

            tmpl = props.get("template")
            lower = isinstance(tmpl, str) and children and _needs_loop(node)
            if lower:
                props.pop("template")
            elif isinstance(tmpl, str) and scope and not tmpl.startswith("/"):
                # A declarative template nested inside a code loop: the client can still
                # expand it, but only against an absolute path -- there is no basePath to
                # resolve `options` against once the parent stopped being a template.
                props["template"] = _Raw(f"{scope} + {json.dumps('/' + tmpl)}")

            props = {k: prop_value(v, scope) for k, v in props.items()}
            props_str = _js_value(props) if props else "{}"
            if gate:
                props_str = (props_str[:-1] + ", " if len(props_str) > 2 else "{") \
                    + '"disabled": !ready()}'

            body = None
            if lower:
                state["lowered"] = True
                state["scopes"] += 1
                item_scope = f"S{state['scopes']}"
                if tmpl.startswith("/"):
                    base = json.dumps(tmpl)
                elif scope:
                    base = f"{scope} + {json.dumps('/' + tmpl)}"
                else:
                    base = json.dumps("/" + tmpl)
                child = format_node(children[0], indent_level + 2, item_scope)
                body = (
                    f"...itemsAt({base}).map((_item, _i) => {{\n"
                    f"{inner}  const {item_scope} = at({base}, _i);\n"
                    f"{inner}  return {child};\n"
                    f"{inner}}})"
                )
            elif children:
                # Children of a DECLARATIVE template are scoped by the client, so their
                # relative bindings stay relative.
                kid_scope = None if isinstance(tmpl, str) else scope
                kids = [format_node(c, indent_level + 1, kid_scope) for c in children]
                body = f",\n{inner}".join(kids)

            if body is None:
                out = f"{comp_type}({props_str})"
            else:
                out = f"{comp_type}({props_str},\n{inner}{body}\n{indent})"

            cond = node.get("when")
            if isinstance(cond, dict):
                # CONDITIONAL row: a ground leg is not a flight, and `h` drops null children,
                # so an unmet condition simply contributes nothing.
                state["lowered"] = True
                out = f"test({_js_value(cond)}, {scope_expr(scope)}) ? {out} : null"
            return out

        tree = format_node(payload)
        entry = self.runtime.entry or "main"
        helpers = "\n".join(
            f"  const {c} = (props, ...children) => h('{c}', props || {{}}, ...children);"
            for c in sorted(used)
        ) or "  // (no components in this example)"

        # SURFACE-level declarations live on the root component: they describe the surface as
        # a whole rather than any one node.
        root = payload if isinstance(payload, dict) else {}
        requires = root.get("requires")
        normalize = root.get("normalize")
        resolve_mode = root.get("resolve")
        user_text = root.get("userText")
        needs_data = bool(state["lowered"] or normalize or requires or user_text
                          or resolve_mode == "immediate")

        norm_js = ""
        if normalize:
            root_key = normalize.get("root")
            flat_paths = normalize.get("flatten") or []
            wrap = (f"  const out = (src[{json.dumps(root_key)}] && typeof src[{json.dumps(root_key)}] === 'object')\n"
                    f"      ? src : {{ {json.dumps(root_key)}: src }};\n") if root_key else "  const out = src;\n"
            norm_js = (
                "\n  // Input arrives in more shapes than the contract documents: the whole builder\n"
                "  // output, the bare object, a flat list where groups were expected. Normalizing\n"
                "  // once here is the difference between rendering and an empty shell that still\n"
                "  // reports ok -- which is what put the plan in the chat below a blank card.\n"
                "  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));\n"
                "  const getAt = (o, p) => String(p).replace(/^\\//, '').split('/').filter(Boolean)\n"
                "    .reduce((x, k) => (x == null ? x : x[k]), o);\n"
                "  const putAt = (o, p, v) => {\n"
                "    const ks = String(p).replace(/^\\//, '').split('/').filter(Boolean);\n"
                "    let cur = o;\n"
                "    for (const k of ks.slice(0, -1)) {\n"
                "      if (cur[k] == null || typeof cur[k] !== 'object') return;\n"
                "      cur = cur[k];\n"
                "    }\n"
                "    cur[ks[ks.length - 1]] = v;\n"
                "  };\n"
                + ("  // Groups, a flat list, or a map keyed by index all mean the same thing to the\n"
                   "  // reader: these are the picks. A group whose key matches no city still has to\n"
                   "  // appear -- dropping it silently is how the summary lost its activities.\n"
                   "  const flatten = (v) => {\n"
                   "    if (!v) return [];\n"
                   "    const arr = Array.isArray(v) ? v : (typeof v === 'object' ? Object.values(v) : []);\n"
                   "    const out = [];\n"
                   "    for (const g of arr) {\n"
                   "      if (!g) continue;\n"
                   "      if (Array.isArray(g)) out.push(...flatten(g));\n"
                   "      else if (Array.isArray(g.options)) out.push(...g.options);\n"
                   "      else out.push(g);\n"
                   "    }\n"
                   "    return out;\n"
                   "  };\n" if flat_paths else "")
                + "  const normalizeInput = (raw) => {\n"
                "    const src = clone(raw && typeof raw === 'object' ? raw : {}) || {};\n"
                + "    " + wrap.lstrip(" ").replace("\n      ", "\n        ")
                + (f"    for (const p of {json.dumps(flat_paths)}) putAt(out, p, flatten(getAt(out, p)));\n"
                   if flat_paths else "")
                + "    return out;\n"
                "  };\n"
            )

        if normalize:
            publish = ("  const model = normalizeInput(input);\n"
                       "  emit('ui.updateDataModel', { path: '/', value: model });\n")
        elif needs_data:
            publish = ("  const model = input || {};\n"
                       "  emit('ui.updateDataModel', { path: '/', value: model });\n")
        else:
            publish = "  emit('ui.updateDataModel', { path: '/', value: input || {} });\n"

        data_js = ""
        if needs_data:
            data_js = (
                "\n  // Repetition that varies per item is expanded HERE rather than handed to the\n"
                "  // client as a List template: a template is ONE component repeated, so it cannot\n"
                "  // render one item differently from another, and it cannot compute a value. Items\n"
                "  // carry ABSOLUTE binding paths, which is what makes a pick report where it landed.\n"
                "  const read = (p) => String(p == null ? '' : p).replace(/^\\//, '')\n"
                "    .split('/').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), model);\n"
                "  const at = (b, i) => b + '/' + i;\n"
                "  const itemsAt = (p) => { const a = read(p); return Array.isArray(a) ? a : []; };\n"
                "  const abs = (scope, k) => (String(k).charAt(0) === '/' ? String(k)\n"
                "    : (scope ? scope + '/' + k : '/' + k));\n"
                "  const fmt = (s, scope) => String(s).replace(/\\{([^}]+)\\}/g, (_m, k) => {\n"
                "    const v = read(abs(scope, k));\n"
                "    return v == null ? '' : String(v);\n"
                "  });\n"
                "  const test = (c, scope) => {\n"
                "    if (!c) return true;\n"
                "    const v = read(abs(scope, c.path));\n"
                "    if ('eq' in c) return v === c.eq;\n"
                "    if ('ne' in c) return v !== c.ne;\n"
                "    if ('gt' in c) return Number(v) > Number(c.gt);\n"
                "    return !!v;\n"
                "  };\n"
            )

        # A re-render whose tree is byte-identical costs a postMessage, a full rebuild of
        # every component, and changes nothing: the host has already repainted from the data
        # model. Emitting only on a real difference keeps the wire honest about what changed.
        draw_js = ("  render(build());\n" if not events else (
            "  // Emit only when the tree actually differs. Selection highlighting and field\n"
            "  // validation are redrawn by the CLIENT from the data model, so an identical\n"
            "  // tree carries no information. Every prop here is data by construction, so\n"
            "  // comparing the serialized tree is a sound identity test.\n"
            "  let __sent = '';\n"
            "  const draw = () => {\n"
            "    const t = build();\n"
            "    const s = JSON.stringify(t);\n"
            "    if (s === __sent) return false;   // nothing changed -- the client already has it\n"
            "    __sent = s;\n"
            "    render(t);\n"
            "    return true;\n"
            "  };\n\n"
            "  draw();\n"))

        requires_js = ""
        if requires:
            paths = requires.get("paths") or []
            message = requires.get("message") or "no data to render"
            requires_js = (
                "\n  // Nothing to draw. Returning ok here is what produced an empty card with the\n"
                "  // plan pasted as text underneath: the agent believed the surface had rendered.\n"
                f"  const REQUIRED = {json.dumps(paths)};\n"
                "  const present = (p) => {\n"
                "    const v = read(p);\n"
                "    return Array.isArray(v) ? v.length > 0 : (v != null && v !== '');\n"
                "  };\n"
                f"  if (!REQUIRED.some(present)) return {{ status: 'error', error: {json.dumps(message)} }};\n"
            )

        if resolve_mode == "immediate":
            # A ONE-SHOT surface that still carries a live button. Blocking on the press would
            # pause the agent until a user acts on something optional -- and a capability needs
            # the gesture the press supplies, so the button cannot simply be dropped either.
            prelude = ""
            tail = (
                "\n  // Report immediately: this surface is a deliverable, not a question, so the\n"
                "  // agent is never left waiting on a press that may never come. The listener\n"
                "  // stays registered, so a press that DOES come still runs its capability.\n"
                + (
                    f"  const CAPS = {json.dumps(caps)};\n"
                    "  onEvent(async (name) => {\n"
                    "    const c = CAPS.find((x) => x.event === name);\n"
                    "    if (!c) return;\n"
                    "    const args = {};\n"
                    "    for (const [k, v] of Object.entries(c.args)) {\n"
                    "      args[k] = (v && typeof v === 'object' && v.path) ? read(v.path) : v;\n"
                    "    }\n"
                    "    try { await invoke(c.name, args); } catch (_) {}\n"
                    "  });\n"
                    if caps else ""
                )
                + "  return { status: 'ok', displayed: true };\n"
            )
        elif events:
            names = ", ".join(json.dumps(e) for e in events)
            prelude = (
                "\n  // Track edits so validation and derived values stay live.\n"
                "  // Collect what the user writes. onUpdate fires for every write binding -- a\n"
                "  // field edit, a card toggle -- with its RESOLVED path, so this IS the surface's\n"
                "  // selection. Returning an empty object instead leaves the agent with no picks.\n"
                "  const picked = {};\n"
                + (
                    "  // GATE the button, as the example declared. `all-groups` means every index\n"
                    "  // of every repetition needs its own pick -- correct when the array is a list\n"
                    "  // of groups, wrong when it is a list of options to choose one of, which is\n"
                    "  // why it is declared rather than inferred from the shape of the data.\n"
                    f"  const GROUPS = {json.dumps(groups)};\n"
                    "  const groupItems = (g) => {\n"
                    "    const at = g.replace(/^\\//, '').split('/');\n"
                    "    let v = input || {};\n"
                    "    for (const k of at) v = (v || {})[k];\n"
                    "    return Array.isArray(v) ? v.length : 0;\n"
                    "  };\n"
                    "  const ready = () => GROUPS.every((g) => {\n"
                    "    const n = groupItems(g);\n"
                    "    if (!n) return true;                       // nothing offered -> nothing required\n"
                    "    for (let i = 0; i < n; i++) {\n"
                    "      const prefix = g + '/' + i + '/';\n"
                    "      if (!Object.keys(picked).some((k) => k.indexOf(prefix) === 0)) return false;\n"
                    "    }\n"
                    "    return true;\n"
                    "  });\n"
                    if gate_mode == "all-groups" else
                    "  // GATE the button: the example declared that SOMETHING must be picked before\n"
                    "  // the user can continue, without saying how many or from where.\n"
                    "  const ready = () => Object.values(picked).some((v) => v === true);\n"
                    if gate_mode == "any" else ""
                )
            )
            tail = (
                "\n  onUpdate((path, value) => {\n"
                "    if (value === null || value === undefined || value === false) delete picked[path];\n"
                "    else picked[path] = value;\n"
                + (
                    "    // SINGLE-SELECT: picking one item clears its siblings, which is the default\n"
                    "    // because one-per-group is the common case. Siblings are the entries sharing\n"
                    "    // this item's parent array, i.e. the path minus its trailing '<index>/<field>'.\n"
                    "    // Groups declared selectionMode:'multi' in the example are left alone.\n"
                    f"    const MULTI = {json.dumps(multi)};\n"
                    "    if (value === true && !MULTI.some((m) => path.indexOf(m + '/') === 0)) {\n"
                    "      const parent = path.split('/').slice(0, -2).join('/');\n"
                    "      for (const k of Object.keys(picked)) {\n"
                    "        if (k !== path && k.indexOf(parent + '/') === 0 && picked[k] === true) {\n"
                    "          delete picked[k];\n"
                    "          emit('ui.updateDataModel', { path: k, value: false });\n"
                    "        }\n"
                    "      }\n"
                    "    }\n"
                )
                + "    draw();\n"
                "  });\n\n"
                "  // RESOLVE on one of the buttons this surface actually renders.\n"
                "  return await new Promise((resolve) => {\n"
                "    onEvent(async (name) => {\n"
                f"      if (![{names}].includes(name)) return;\n"
                "      let capResult = null;\n"
                + (
                    "      // Declared capability calls for this surface. Resolving without making\n"
                    "      // them would leave a button that renders and does nothing.\n"
                    f"      const CAPS = {json.dumps(caps)};\n"
                    "      const c = CAPS.find((x) => x.event === name);\n"
                    "      if (c) {\n"
                    "        const args = {};\n"
                    "        for (const [k, v] of Object.entries(c.args)) {\n"
                    "          args[k] = (v && typeof v === 'object' && v.path)\n"
                    "            ? v.path.replace(/^\\//, '').split('/').reduce((o, s2) => (o || {})[s2], input || {})\n"
                    "            : v;\n"
                    "        }\n"
                    "        try { capResult = await invoke(c.name, args); } catch (_) {}\n"
                    "      }\n"
                    if caps else ""
                )
                + "      // Count SELECTIONS, not writes. `picked` holds every write binding the\n"
                "      // user touched -- a card toggle (true) and a field edit (a value) alike --\n"
                "      // so counting keys reported edits as picks. The agent still receives the\n"
                "      // full map; only the summary distinguishes them.\n"
                "      const n = Object.values(picked).filter((v) => v === true).length;\n"
                "      // A capability call reports its OWN outcome and is not a user selection,\n"
                "      // so it returns a result rather than a chat message.\n"
                "      if (capResult !== null) {\n"
                "        resolve({ status: 'ok', event: name, result: capResult, selection: picked });\n"
                "        return;\n"
                "      }\n"
                + (
                    "      // Context the selection map cannot carry: an item that is part of the\n"
                    "      // outcome even though there was nothing to pick for it. The agent plans\n"
                    "      // its next step from this text, so what is omitted here is invisible.\n"
                    f"      const PARTS = {json.dumps((user_text or {}).get('parts') or [])};\n"
                    "      const extra = [];\n"
                    "      for (const p of PARTS) {\n"
                    "        itemsAt(p.each).forEach((_x, i) => {\n"
                    "          const s = at(p.each, i);\n"
                    "          if (test(p.when, s)) extra.push(fmt(p.format, s));\n"
                    "        });\n"
                    "      }\n"
                    "      const summary = n ? (n + ' selection(s) confirmed.') : 'Confirmed.';\n"
                    "      resolve({ status: 'ok', event: name, selection: picked,\n"
                    "                userText: [summary].concat(extra).join(' · ') });\n"
                    if user_text else
                    "      resolve({ status: 'ok', event: name, selection: picked,\n"
                    "                userText: n ? (n + ' selection(s) confirmed.') : 'Confirmed.' });\n"
                )
                + "    });\n  });\n"
            )
        else:
            prelude = ""
            # ONE-SHOT surface: the example renders no button, so there is no user event to
            # wait for. Waiting anyway is a deadlock -- the agent is paused until the module
            # returns, and the device kills a module that neither draws buttons nor resolves.
            tail = (
                "\n  // One-shot surface: nothing to wait for, so report and return immediately.\n"
                "  // Awaiting an event here would stall until the client watchdog fires.\n"
                "  return { status: 'ok', displayed: true };\n"
            )

        return f"""// SCAFFOLD -- generated from an A2UI example message by a2ui_agent.skill_generator.
// RuntimeProfile: {self.runtime.name}
//
// The STRUCTURE below is derived from the example. The INTERACTION LOGIC is not derivable
// from a rendered frame -- complete each TODO, then certify with the pre-flight.
async function {entry}(input) {{
  // Helpers live INSIDE the entry function: the pre-flight evaluates only the slice
  // starting at this declaration, so anything above it is dropped.
{helpers}
{norm_js}
  // PUBLISH the input as the data model. Every {{path:'/...'}} binding in the tree below
  // resolves against this, so without it a bound surface renders empty no matter how
  // correct the tree is.
{publish}
{data_js}{requires_js}{prelude}
  const build = () => (
{tree}
  );

{draw_js}{tail}}}
"""

    def _generate_references(self, references_dir: Path) -> None:
        """Generates bespoke code snippets in references/ from provided A2UI example messages and writes README.md."""
        collected_examples: List[Dict[str, Any]] = []

        # 1. Parse example messages provided via list
        for idx, item in enumerate(self.examples_raw, 1):
            if isinstance(item, dict):
                stem = (
                    item.get("name")
                    or (item.get("payload", {}).get("type") if isinstance(item.get("payload"), dict) else None)
                    or f"example_{idx}"
                )
                collected_examples.append((str(stem), item))
            elif isinstance(item, list):
                collected_examples.append((f"example_{idx}", item))
            elif isinstance(item, str):
                if os.path.exists(item):
                    with open(item, "r", encoding="utf-8") as f:
                        collected_examples.append((
                            os.path.splitext(os.path.basename(item))[0], json.load(f)))
                else:
                    try:
                        parsed = json.loads(item)
                        stem = (
                            parsed.get("name")
                            or (parsed.get("payload", {}).get("type") if isinstance(parsed.get("payload"), dict) else None)
                            if isinstance(parsed, dict) else f"example_{idx}"
                        )
                        collected_examples.append((str(stem or f"example_{idx}"), parsed))
                    except Exception:
                        pass

        # 2. Parse example messages provided via directory path
        if self.examples_path and os.path.exists(self.examples_path):
            if os.path.isdir(self.examples_path):
                ex_files = glob.glob(os.path.join(self.examples_path, "*.json"))
                for ex_file in sorted(ex_files):
                    try:
                        with open(ex_file, "r", encoding="utf-8") as f:
                            collected_examples.append((
                                os.path.splitext(os.path.basename(ex_file))[0], json.load(f)))
                    except Exception:
                        pass
            elif os.path.isfile(self.examples_path):
                try:
                    with open(self.examples_path, "r", encoding="utf-8") as f:
                        collected_examples.append((
                            os.path.splitext(os.path.basename(self.examples_path))[0], json.load(f)))
                except Exception:
                    pass

        # 3. Generate bespoke code reference files for each collected A2UI example message
        created_files = []
        if collected_examples:
            for stem, raw in collected_examples:
                ex_msg = self._parse_a2ui_example(raw)
                msg_name = stem
                sanitized_name = f"{stem}.js"

                code_content = self._convert_a2ui_message_to_webview_js(ex_msg, str(msg_name))

                with open(references_dir / sanitized_name, "w", encoding="utf-8") as f:
                    f.write(code_content)
                created_files.append((sanitized_name, str(msg_name)))

        if not created_files:
            # Fallback reference if no example messages provided
            sanitized_name = "01_basic_reference.js"
            entry = self.runtime.entry or "main"
            ref_code = (
                "// Minimal reference for a classic-main host. Generated by "
                "a2ui_agent.skill_generator.\n"
                f"async function {entry}(input) {{\n"
                "  const Text = (props) => h('Text', props);\n"
                "  const Button = (props) => h('Button', props);\n"
                "  const Column = (props, ...kids) => h('Column', props || {}, ...kids);\n\n"
                "  render(Column({},\n"
                "    Text({ text: 'Basic A2UI Reference Example' }),\n"
                "    Button({ label: 'Continue', action: { event: { name: 'confirm' } } })\n"
                "  ));\n\n"
                "  return await new Promise((resolve) => {\n"
                "    onEvent(async (name) => {\n"
                "      if (name !== 'confirm') return;\n"
                "      resolve({ status: 'ok', userText: 'Continued.' });\n"
                "    });\n"
                "  });\n"
                "}\n"
            )
            with open(references_dir / sanitized_name, "w", encoding="utf-8") as f:
                f.write(ref_code)
            created_files.append((sanitized_name, "basic_reference"))

        # index.json -- the reference library, materialized.
        names = sorted(n for n, _ in created_files)
        with open(references_dir / "index.json", "w", encoding="utf-8") as f:
            json.dump(names, f, indent=2)
            f.write("\n")

        # 4. Generate references/README.md index file
        readme_lines = [
            "# Reference Examples Index\n",
            "This directory contains executable reference code examples demonstrating how to construct and emit A2UI components.\n",
            "## Available Reference Modules\n",
        ]

        for filename, title in created_files:
            readme_lines.append(f"- [`{filename}`]({filename}): Demonstrates `{title}` A2UI rendering flow.")

        readme_lines.extend([
            "\n## How to Execute Reference Self-Test\n",
            "You can run the pre-flight validator to test reference execution and A2UI schema compliance:\n",
            f"```bash\nnode scripts/validate_ui.mjs --code-file references/{created_files[0][0]}\n```\n",
        ])

        with open(references_dir / "README.md", "w", encoding="utf-8") as f:
            f.write("\n".join(readme_lines) + "\n")

    def _collect_examples(self):
        """(stem, raw) for every example, keyed by FILE NAME."""
        out = []
        for item in self.examples_raw:
            if isinstance(item, (dict, list)):
                out.append(("example", item))
            elif isinstance(item, str) and os.path.exists(item):
                with open(item, "r", encoding="utf-8") as f:
                    out.append((os.path.splitext(os.path.basename(item))[0], json.load(f)))
        path = self.examples_path
        if path and os.path.isdir(path):
            for f_ in sorted(glob.glob(os.path.join(path, "*.json"))):
                try:
                    with open(f_, "r", encoding="utf-8") as fh:
                        out.append((os.path.splitext(os.path.basename(f_))[0], json.load(fh)))
                except Exception:
                    pass
        return out

    def _reference_contracts(self) -> str:
        """Documents, per reference, the input each one actually reads."""
        cases = []
        for stem, raw in self._collect_examples():
            ex = self._parse_a2ui_example(raw)
            paths: set = set()

            def scan(node):
                if isinstance(node, dict):
                    p = node.get("path")
                    if isinstance(p, str) and p.startswith("/"):
                        paths.add(p)
                    t = node.get("template")
                    if isinstance(t, str) and t.startswith("/"):
                        paths.add(t)
                    f_ = node.get("format")
                    if isinstance(f_, str):
                        for m in re.findall(r"\{([^}]+)\}", f_):
                            if m.startswith("/"):
                                paths.add(m)
                    for v in node.values():
                        scan(v)
                elif isinstance(node, list):
                    for v in node:
                        scan(v)

            rel: set = set()

            def scan_rel(node, inside):
                if isinstance(node, dict):
                    t = node.get("template")
                    here = inside or isinstance(t, str)
                    p_ = node.get("path")
                    if here and isinstance(p_, str) and not p_.startswith("/"):
                        rel.add(p_)
                    f_ = node.get("format")
                    if here and isinstance(f_, str):
                        for m in re.findall(r"\{([^}]+)\}", f_):
                            if not m.startswith("/"):
                                rel.add(m)
                    for k, v in node.items():
                        scan_rel(v, here)
                elif isinstance(node, list):
                    for v in node:
                        scan_rel(v, inside)

            scan(ex.get("components"))
            scan_rel(ex.get("components"), False)
            if paths:
                roots = sorted({"/" + p.strip("/").split("/")[0] for p in paths})
                cases.append((stem, sorted(paths), roots, sorted(rel)))
        if not cases:
            return "_No references generated._"
        out = []
        for stem, paths, roots, item_fields in cases:
            out.append(f"### `{stem}`")
            out.append(f"- **requires**: {', '.join('`' + r + '`' for r in roots)}")
            shown = paths[:8]
            out.append("- reads: " + ", ".join("`" + p + "`" for p in shown)
                       + (f" (+{len(paths) - 8} more)" if len(paths) > 8 else ""))
            if item_fields:
                out.append("- each list item must have: "
                           + ", ".join("`" + f + "`" for f in item_fields))
            out.append("")
        return "\n".join(out)

    def generate(self) -> str:
        """Generates the full agent skill directory and returns its absolute path."""
        target_dir = Path(self.config.output_dir).resolve()
        target_dir.mkdir(parents=True, exist_ok=False)

        scripts_dir = target_dir / "scripts"
        references_dir = target_dir / "references"
        runtime_dir = target_dir / "runtime"

        for d in [scripts_dir, references_dir]:
            d.mkdir(exist_ok=True)

        rt = self.runtime
        components = list(self._extract_components().keys())

        # 1. Write SKILL.md
        cap_names = self._client_capability_names()
        skill_md = SKILL_MD_TEMPLATE.format(
            skill_name=self.config.skill_name,
            skill_name_title=self.config.skill_name.replace("-", " ").title(),
            description=self.config.description,
            capability_list="\n".join(f"  - {n}" for n in cap_names) or "  []",
            catalog_documentation=self._build_catalog_documentation(),
            capability_documentation=self._build_capability_documentation(),
            reference_contracts=self._reference_contracts(),
            injected_globals=", ".join(rt.injected_globals),
            entry=rt.entry or "main",
            tool_name=rt.tool_name or "the host's module tool",
            preflight_cmd=(rt.preflight_cmd or "").format(
                skill_root=rt.mount_root.rstrip("/") + "/" + self.config.skill_name,
                app="app.js",
                components=",".join(components),
            ),
        )
        with open(target_dir / "SKILL.md", "w", encoding="utf-8") as f:
            f.write(skill_md)

        # 2. Webview runtime shim
        if rt.ui_transport == "injected-emit":
            runtime_dir.mkdir(exist_ok=True)
            with open(runtime_dir / "a2ui-react.js", "w", encoding="utf-8") as f:
                f.write(RUNTIME_SHIM_JS)

        # 3. Pre-flight validation script
        globals_args = ", ".join(f"'{g}'" for g in rt.injected_globals)
        validator = VALIDATE_UI_TEMPLATE.format(
            catalog_components=json.dumps(components),
            entry=rt.entry or "main",
            globals_args=globals_args,
            globals_args_bare=", ".join(rt.injected_globals),
        )
        validator_name = "validate_ui.mjs"
        with open(scripts_dir / validator_name, "w", encoding="utf-8") as f:
            f.write(validator)
        os.chmod(scripts_dir / validator_name, 0o755)

        # 4. References
        self._generate_references(references_dir)

        return str(target_dir)


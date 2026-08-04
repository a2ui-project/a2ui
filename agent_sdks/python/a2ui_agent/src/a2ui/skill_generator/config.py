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

"""Configuration for the A2UI Skill Generator."""

from dataclasses import dataclass, field
from typing import Any, List, Optional, Union


@dataclass
class RuntimeProfile:
    """How the HOST executes a generated client module.

    The catalog says what a module may RENDER; this says how the module is shaped, how it
    reaches the renderer, and how it reports a result. Without it the generator has to
    assume a host, and a wrong assumption fails SILENTLY -- the emitted code is well formed
    and simply never reaches a renderer. So `SkillGenerator` requires one explicitly.

    Attributes:
        name: Identifier for the profile, recorded in generated headers.
        module_form: 'classic-global-main' (a plain script defining `async function
            main(input)`, injected into a <script> tag) or 'esm-toplevel' (an ES module with
            top-level statements and imports).
        entry: Name of the entry function the host calls, or None for top-level execution.
        ui_transport: 'injected-emit' (call host-provided globals) or 'stdout-markers'
            (print delimited JSON for a bridge to scrape).
        tree_encoding: 'flat-graph' ({root, components} -- A2UI v0.9+) or 'nested'.
        injected_globals: Globals the host provides; the module must not redefine them.
        bundle_builder: Whether to ship lib/builder + lib/emitter. False when the host
            already injects a compiler (e.g. a2ui-react.js provides h/render), so the module
            uses those instead of carrying a second builder.
        result_contract: 'status-result-selection-userText' or None.
        inline_helpers_in_entry: Emit helper declarations INSIDE the entry function. Some
            pre-flights evaluate only the slice starting at the entry declaration, so
            top-level helpers would be silently dropped even though they work on device.
        preflight_cmd: Command template validating one authored module before it is sent.
        tool_name: Host tool that ships a module to the device.
        mount_root: Where skills are mounted in the agent's filesystem.
    """

    name: str = "custom"
    module_form: str = "esm-toplevel"
    entry: Optional[str] = None
    ui_transport: str = "stdout-markers"
    tree_encoding: str = "nested"
    injected_globals: List[str] = field(default_factory=list)
    bundle_builder: bool = True
    result_contract: Optional[str] = None
    inline_helpers_in_entry: bool = False
    preflight_cmd: Optional[str] = None
    tool_name: Optional[str] = None
    mount_root: str = ".agents/skills"

    @property
    def is_classic_main(self) -> bool:
        """True when the module is a plain script defining an entry function."""
        return self.module_form == "classic-global-main"

    @classmethod
    def antigravity_webview(
        cls,
        tool_name: str = "send_client_app",
        bundle_builder: bool = False,
        preflight_cmd: Optional[str] = None,
        mount_root: str = ".agents/skills",
    ) -> "RuntimeProfile":
        """Managed agent ships module source; a confined webview runs it.

        The module is injected as a classic <script> under a deny-all CSP, so there is no
        module resolution and no filesystem: `import` is a syntax error and everything the
        module needs must be inline. The host injects h/render/invoke/emit/onUpdate/onEvent,
        renders the emitted A2UI tree natively, and waits for the module to resolve on a user
        event.
        """
        return cls(
            name="antigravity-webview",
            module_form="classic-global-main",
            entry="main",
            ui_transport="injected-emit",
            tree_encoding="flat-graph",
            injected_globals=["h", "render", "invoke", "emit", "onUpdate", "onEvent"],
            bundle_builder=bundle_builder,
            result_contract="status-result-selection-userText",
            inline_helpers_in_entry=True,
            preflight_cmd=preflight_cmd
            or "node {skill_root}/scripts/validate_ui.mjs --code-file {app} --client={components}",
            tool_name=tool_name,
            mount_root=mount_root,
        )

    @classmethod
    def code_mode(cls) -> "RuntimeProfile":
        """Script runs in a sandbox; a bridge scrapes delimited JSON from stdout.

        The generator's original built-in assumption (Codex-style / Cloudflare Code Mode).
        """
        return cls(
            name="code-mode",
            module_form="esm-toplevel",
            entry=None,
            ui_transport="stdout-markers",
            tree_encoding="nested",
            injected_globals=[],
            bundle_builder=True,
            result_contract=None,
            inline_helpers_in_entry=False,
        )


@dataclass
class SkillConfig:
    """Configuration options for creating an A2UI Agent Skill package.

    Attributes:
        skill_name: Unique identifier for the skill (e.g. 'render-ui' or 'render-travel-ui').
        description: Description of what the skill does, used in SKILL.md YAML frontmatter.
        output_dir: Target directory path where the skill folder will be created.
        target_language: Programming language for reference scripts and lib helpers
            (default: 'javascript' -- device modules run in a JS engine).
        catalogs: Optional list of CatalogConfig instances or catalog file paths.
        capabilities: Optional path to a capability catalog JSON. Same kind of input as
            `catalogs`: it documents invoke()'s typed args/results, which a client handshake
            (names only) does not carry.
        preserve: Names of entries under output_dir to leave untouched when regenerating
            (e.g. ['references'] to keep hand-authored modules that carry interaction logic).
        examples_path: Optional path to directory containing example A2UI JSON payloads.
        examples: Optional list of A2UI JSON messages (dicts, JSON strings, or file paths).
        include_builder_lib: Whether to generate the fluent component builder helper in lib/ (default: True).
        include_runtime_bridge: Whether to generate runtime webview bridge adapter (default: True).
        include_validation_script: Whether to generate validation CLI tool (default: True).
    """

    skill_name: str = "render-ui"
    description: str = (
        "Skill for rendering dynamic A2UI user interfaces in webview using component catalogs "
        "and function bindings."
    )
    output_dir: str = ".agents/skills/render-ui"
    target_language: str = "javascript"
    catalogs: List[Any] = field(default_factory=list)
    capabilities: Optional[str] = None
    examples_path: Optional[str] = None
    examples: Optional[List[Any]] = None
    include_builder_lib: bool = False
    include_runtime_bridge: bool = True
    include_validation_script: bool = True
    include_catalog_dump: bool = False
    preserve: List[str] = field(default_factory=list)

# PR Title: `feat(skill): Add SkillGenerator, Skill domain objects, and Gemini Managed Agents demo`

### Summary & Rationale
This PR introduces the **Skill Generator Engine** (`SkillGenerator`, `Skill`, `SkillSet`) to the A2UI Python SDK (`a2ui_agent`), expands the Spec-Driven Development feature blueprint (`blueprints/features/skill_generator.blueprint.md`), and migrates the Apex Commerce demo application to use the Gemini Managed Agents API (`antigravity-preview-05-2026`).

The `SkillGenerator` compiles component catalogs into standardized `SKILL.md` packages for managed agent platforms (Google Antigravity, Vertex AI Agent Builder, Anthropic Skills, and MCP sandboxes), supporting both monolithic (`generate()`) and modular (`generate_modular()`) skill outputs with rich domain object manipulation.

---

### Key Changes

1. **Python SDK (`agent_sdks/python/a2ui_agent/src/a2ui/skill/`)**:
   - `Skill`: Domain object encapsulating frontmatter metadata (`name`, `description`, `metadata`), body content, and YAML serialization (`to_markdown()`).
   - `SkillSet`: Domain collection encapsulating modular skills (`a2ui-core`, `a2ui-basic`, `a2ui-commerce`) with `.export_to_directory()`, `.to_dict()`, and dictionary indexing.
   - `SkillGenerator`: Core engine delegating to `InferenceFormat`/`PromptGenerator` for modular vs monolithic skill compilation.
   - `generate_skill()`: Programmatic helper function and CLI entry point (`python -m a2ui.skill`).

2. **Inference Formats & Shared Surface Support**:
   - Added `emit_create_surface=False` flag to `ExpressFormat`, `ExpressCompiler`, `ExpressParser`, and `ExpressPromptGenerator` to support client-managed shared surfaces.
   - Added automatic property pruning for protocol version `v0.9` / `v0.9.1` basic catalog compliance.

3. **Feature Blueprint (`blueprints/features/skill_generator.blueprint.md`)**:
   - Expanded cross-language API contracts (`SkillGenerator`, `Skill`, `SkillSet`).
   - Standardized remote managed agent environment target conventions (`.agents/AGENTS.md`, `.agents/skills/a2ui-core/SKILL.md`, `.agents/skills/a2ui-<catalog>/SKILL.md`).
   - Added language-agnostic conformance verification guidelines against `conformance/test_data/skills/` golden vectors.

4. **Apex Commerce Demo Migration (`samples/community/commerce_agent_demo/`)**:
   - Migrated backend (`server.py`) to use `client.interactions.create` with `agent="antigravity-preview-05-2026"` and session continuation (`previous_interaction_id`).
   - Implemented thread-safe (`BOOTSTRAP_LOCK`) multi-threaded backend request processing (`ThreadingTCPServer`).
   - Updated React frontend (`App.tsx`) with an interactive Managed Agent Bootstrap tracker, skills inspector tab, and chat loading badges.

---

### Verification & Testing

- **Unit & Conformance Test Suite**:
  - Ran `pytest agent_sdks/python/a2ui_agent/tests/` — **All 599 unit and conformance tests passed cleanly**.
  - Verified modular and monolithic skill generation conformance against `conformance/test_data/skills/` golden test vectors.
- **End-to-End Visual Verification**:
  - Ran automated Playwright integration test (`screenshot.py http://localhost:5180`).
  - Captured and verified 4 baseline visual artifacts (`app_preview.png`, `json_inspector.png`, `express_inspector.png`, `skills_inspector.png`).

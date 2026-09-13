---
name: a2ui-create-render-skill
description: Meta-Skill for creating application-specific A2UI render-ui skills for managed agents.
---

# A2UI Create Render-UI Skill Meta-Skill

This skill provides step-by-step instructions for AI Managed Agents (Antigravity, Codex, Cloudflare Code Mode) on how to generate custom `.agents/skills/<skill-name>/` skills using catalog schemas and example UI payloads.

---

## Instructions for Agent

1. **Locate Catalogs & Examples**:
   - Search the workspace for catalog definition files (`catalog.json`, `components.json`, or Pydantic models).
   - Locate any example A2UI JSON payload files in the repository.

2. **Execute SDK Generator Command**:
   Run the `a2ui` skill generator CLI command in the workspace terminal:

   ```bash
   python3 -m a2ui.skill_generator \
     --name render-ui \
     --catalog path/to/catalog.json \
     --output .agents/skills/render-ui
   ```

3. **Verify Created Skill**:
   - Ensure `.agents/skills/render-ui/SKILL.md` exists and contains catalog component specifications.
   - Verify that `lib/builder.py` and `references/` code snippets were generated.

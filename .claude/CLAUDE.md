# Claude Code Context

Repository skills live in `.agent/skills/`, shared with the other agent tools
this repo supports. Claude Code only discovers skills under `.claude/skills/`,
so symlink the skills:

```bash
ln -s ../../.agent/skills/<name> .claude/skills/<name>
```

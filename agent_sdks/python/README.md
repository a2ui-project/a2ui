# Python agent SDKs

For full release documentation and guides, see:
- **General Release Guide**: [development/docs/package_releases.md](file:///Users/jsimionato/development/a2ui_repos/release-oncall/A2UI/development/docs/package_releases.md)
- **Python Publishing Technical Guide**: [agent_sdks/python/docs/python_publishing.md](file:///Users/jsimionato/development/a2ui_repos/release-oncall/A2UI/agent_sdks/python/docs/python_publishing.md)

---

## Detect non-released changes

To check if there are new changes after [last release](https://pypi.org/project/a2ui-agent-sdk/#history), run the command from any directory:

```bash
export LAST_RELEASE_TIME=$(curl -s "https://pypi.org/pypi/a2ui-agent-sdk/json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
v = d['info']['version']
print(max(f['upload_time_iso_8601'] for f in d['releases'][v]))
")

echo "LAST_RELEASE_TIME=$LAST_RELEASE_TIME"

curl -s "https://api.github.com/repos/a2ui-project/a2ui/commits?path=agent_sdks/python&since=$LAST_RELEASE_TIME"
```

The command will return an empty list if no changes are related to the Python agent SDKs, otherwise, it returns a list of commits.

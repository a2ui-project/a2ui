# Python agent SDKs

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

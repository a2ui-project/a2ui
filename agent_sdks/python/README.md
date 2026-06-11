# Python agent SDKs

## Detect non-released changes

Run the command from any directory:

```
export LAST_RELEASE_DATE_MINUS_DAY=$(curl -s "https://pypi.org/pypi/a2ui-agent-sdk/json" | python3 -c "
import sys, json, datetime
d = json.load(sys.stdin)
v = d['info']['version']
ut = max(f['upload_time_iso_8601'] for f in d['releases'][v])
date = datetime.date.fromisoformat(ut[:10]) - datetime.timedelta(days=1)
print(date.isoformat())
")

echo "LAST_RELEASE_DATE_MINUS_DAY=$LAST_RELEASE_DATE_MINUS_DAY"

curl -s "https://api.github.com/repos/a2ui-project/a2ui/commits?path=agent_sdks/python&since=$LAST_RELEASE_DATE_MINUS_DAY"
```

# Python agent SDKs

## Detect non-released changes

1. Find the date of the last release from https://pypi.org/project/a2ui-agent-sdk/#history

2. Run the command:

```
cd agent_sdks/python

export LAST_RELEASE_DATE_MINUS_DAY=2026-06-03

curl -s "https://api.github.com/repos/a2ui-project/a2ui/commits?path=agent_sdks/python&since=$LAST_RELEASE_DATE_MINUS_DAY"
```



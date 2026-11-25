# shared

Dart code for triaging GitHub items in the A2UI repository. The blueprints in
[`../../blueprints/`](../../blueprints/) describe the triage process.

## Features

- `shared`: what the other triage packages and the triage bot have in
  common: the labels, the repository, the check for triage bot comments,
  and the GitHub client with the lookup of the person's token.
- `triage_bot`: the `TriageAnalysis` A2UI component, which the triage bot
  posts on a GitHub item and the triage UI shows to the triager, and
  `AnalysisPayload`, which reads it from an analysis comment, and the
  triage report that `bin/triage_report.dart` writes for the triage bot.

## Testing

```bash
dart test
```

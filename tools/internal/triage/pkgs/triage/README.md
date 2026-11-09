# triage

Dart code for triaging GitHub items in the A2UI repository. The blueprints in
[`../../blueprints/`](../../blueprints/) describe the triage process.

## Features

- `triage_item`: the `TriageSuggestion` A2UI component, which the advisor
  posts on a GitHub item and the triage UI shows to the triager, and
  `SuggestionPayload`, which reads it from a suggestion comment.

## Testing

```bash
dart test
```

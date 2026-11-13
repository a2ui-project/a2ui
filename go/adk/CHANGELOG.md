## Unreleased

- Initial release of `github.com/a2ui-project/a2ui/go/adk`, which connects the agent SDK to the
  Agent Development Kit (ADK) for Go v2 (`google.golang.org/adk/v2`):
  - `SendA2UIToClientToolset`, a tool that validates the A2UI payloads a model writes and returns
    errors the model can correct.
  - An instruction provider that appends the A2UI system prompt to an agent's instruction.
  - Converters from ADK events and GenAI parts to A2A parts, including streamed responses.
  - Answers to v1.0 function calls between agent and renderer without a model turn.

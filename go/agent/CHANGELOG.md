## Unreleased

- Initial release of `github.com/a2ui-project/a2ui/go/agent`:
  - Support for A2UI protocol versions v0.8, v0.9, v0.9.1, and v1.0.
  - `Generator` and `RequestProcessor`, which negotiate catalogs against renderer capabilities,
    generate system prompts, and parse model responses.
  - Express and Direct JSON inference formats, with prompt generation, batch and streaming parsing,
    compilation, and decompilation.
  - `RendererState`, which validates outgoing messages against the surfaces a renderer holds.
  - Typesafe component builders in the `builder` package and server-side macros in the `macros`
    package.
  - Skill generation and v1.0 function calls between agent and renderer.

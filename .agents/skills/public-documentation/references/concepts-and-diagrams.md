# Conceptual pages and diagrams

Apply these rules—alongside the universal standards in [`../SKILL.md`](../SKILL.md)—when creating, editing, or reviewing conceptual architecture pages, glossary definitions, or visual diagrams on documentation pages.

---

## Conceptual page structure and framing

Conceptual pages explain **how A2UI works and why it is designed that way** (protocol architecture, state models, message semantics, catalog mechanics, inference formats, SDK layers):

- **Lead with the mental model**: Open immediately with a direct, concrete statement of the architectural mechanism (for example, _"A2UI separates declarative UI structure from application state through an asynchronous, bidirectional message stream."_).
- **Separate concepts from step-by-step setup**: Keep conceptual pages focused on architecture, invariants, message semantics, and trade-offs. When readers need full project scaffolding and wiring, link them to the corresponding procedural guide rather than duplicating multi-step installation walkthroughs.
- **Custom catalog flexibility**: Whenever illustrating concepts with components from the Basic Catalog (`Text`, `Button`, `TextField`, `Card`), remind readers that A2UI catalogs are extensible and domain-specific—teams can register custom components and functions tailored to their product.
- **Terminology precision**: Match protocol terminology to the version under discussion (for example, v1.0 uses _agent_ and _renderer_, whereas v0.9.x envelopes used _server_ and _client_).

---

## Protocol version parity on concept pages (`v1.0` + `v0.9.1`)

Unlike onboarding quickstarts (which show only v1.0), conceptual pages serve as architectural references across supported protocol versions:

- **Tabbed wire JSON comparisons (`syncKey="protocol-version"`)**: Whenever showing wire-format JSON envelopes (`createSurface`, `updateComponents`, `updateDataModel`, `action`, transport metadata, or catalog definitions) that differ between v1.0 and v0.9.1:
  - List `v1.0` first and `v0.9.1` second using plain labels (`label="v1.0"`, `label="v0.9.1"`).
  - Call out structural differences clearly (such as `agent_to_renderer` / `renderer_to_agent` vs. `server_to_client` / `client_to_server`, `@path` / `@call` vs. `path` / `call`, and `a2uiRendererCapabilities` / `a2uiRendererDataModel` vs. `a2uiClientCapabilities` / `a2uiClientDataModel`).
  - When a snippet is identical in both versions, show a **single untabbed code block** instead of duplicate tabs.
- **v1.0-exclusive features**: When documenting capabilities introduced in v1.0 with no v0.9.1 counterpart (such as bidirectional function-call envelopes), render a single untabbed v1.0 JSON payload paired with `<Aside type="note" title="New in v1.0">` explaining version availability.
- **Standalone valid JSON payloads**: Every `json` code block representing a protocol message must validate standalone against its schema via `python3 docs/scripts/validate_doc_examples.py`. Never bundle multiple separate protocol messages into a synthetic outer wrapper object (such as `{ "request": {...}, "response": {...} }`); use separate code blocks instead.
- **Inference format to wire mapping**: When contrasting compact inference formats (such as Express) with compiled wire JSON, show the compiled output for both versions if the resulting JSON differs.

---

## Diagrams and visual aids (the Hybrid Diagram Pattern)

Concept pages combine visual clarity for sighted human readers with complete semantic parity for screen readers, text-only browsers, and LLM agents (`llms-full.txt`):

- **Mandatory preceding explanatory paragraph**: Every diagram on a documentation page **must** have a prose paragraph immediately before it explaining the entities, flow, and relationships depicted. A reader who cannot view the diagram must still get 100% of the conceptual information from the surrounding text.
- **Simplicity over exhaustive branching**: Keep diagrams focused on the primary mental model and happy path. Leave rare error permutations, retry backoffs, and edge cases to prose or `<Aside>` notes.
- **Choose the right diagram medium**:
  - **Themed Mermaid sequence diagrams (` ```mermaid `)**: Use for chronological message exchanges, handshakes, and bidirectional RPC lifecycles between Agent, Transport, and Renderer. Plaintext Mermaid diffs cleanly in Git as protocol schemas evolve.
  - **Bespoke Astro diagram components wrapped in `<DiagramCard>`**: Use for structural anatomy, container hierarchies, scope inheritance, and architectural taxonomies where Mermaid subgraphs look rigid. Always wrap custom HTML/CSS diagrams in `DiagramCard` (`src/components/docs/common/DiagramCard.astro`) with an accurate `mermaid` prop so machine readers and screen readers receive the structural graph:

    ```mdx
    import DiagramCard from '../../../components/docs/common/DiagramCard.astro';

    <DiagramCard
      title="Data Binding Anatomy"
      mermaid={`flowchart LR\n  DM["DataModel (/user/name)"] --> C["Text (@path)"]`}
    >
      {/* Visual HTML/CSS diagram */}
    </DiagramCard>
    ```

    If you author or modify the `.astro` component itself, also load [`components-and-landing-pages.md`](components-and-landing-pages.md) for CSS container-query, token, and screenshot verification rules.

---

## Heading anchor and schema explorer deep-linking

- **Schema Explorer permalinks**: Deep-link protocol definitions in prose using `/specification/v1_0/schemas/#<schema-file>.json/<json-pointer>` (for example, `/specification/v1_0/schemas/#agent_to_renderer.json/$defs/CreateSurfaceMessage`). Both `verify-spec-links.mjs` and `check-links.mjs` verify that the target schema alias and JSON pointer exist.
- **Heading and glossary anchor integrity**: When adding or renaming headings on glossary or concept pages, confirm that incoming `#fragment` links across the site still resolve via `npm --prefix docs/site run build`.

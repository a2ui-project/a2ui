# Guides, tutorials, and quickstarts

Apply these rules—alongside the universal standards in [`../SKILL.md`](../SKILL.md)—when creating, editing, or reviewing procedural how-to guides, integration tutorials, or onboarding quickstarts.

---

## The Lean Core Path architecture

Integration guides, tutorials, and quickstarts exist to get a developer from an empty or existing app to a working A2UI integration as fast as possible. Structure every guide around progressive disclosure:

- **Keep the core path to 4–5 steps**: Focus the primary walkthrough strictly on the minimum path to render UI and handle actions—for example:
  1. Install dependencies
  2. Initialize `MessageProcessor` (or `A2uiGenerator` on the agent)
  3. Mount surface views (or wire the prompt/stream pipeline)
  4. Connect transport and handle actions
  5. Wire everything together at the application entry point
- **Defer optional and advanced features to "Additional steps"**: Place topics such as capability advertisement/negotiation, client data-model synchronization (`sendDataModel: true`), custom CSS token theming, and custom validation rules in an **Additional steps** section at the bottom of the guide. Do not inject optional features into the middle of the core onboarding steps.
- **No upfront theoretical roadblocks**: Do not open a practical guide with protocol sequence diagrams, deep architectural walkthroughs, or table-of-contents summary tables (Starlight's right sidebar already provides page navigation). Open with a direct one-sentence purpose statement linking relevant concept or glossary definitions, then begin Step 1 immediately.
- **Application code first, wire JSON in `<details>`**: Developers reading an integration guide interact with SDK APIs, not raw wire envelopes. Always show the platform application code first. If showing the underlying wire JSON payload adds clarity, place it inside a collapsed `<details><summary>View wire payload</summary>...</details>` block **after** the application code, never before.
- **Omit redundant SDK defaults**: Do not pass configuration options that match SDK defaults (such as default streaming validation flags) across six platform tabs; keep snippets minimal and idiomatic.

---

## Implementation completeness ("No Missing Glue")

Documentation snippets are treated as copy-pasteable reference implementations:

- **End with the application entry point**: Never conclude a guide after defining isolated service or helper classes. The final step of the core path must show the concrete bootstrap file (`App.tsx`, `main.dart`, `MyApp.swift`, `MainActivity.kt`, `app.config.ts`) mounting the surface and connecting the session.
- **Include essential companion packages by default**: When standard output depends on a companion package—for example, `@a2ui/markdown-it` so basic catalog `Text` components render formatted Markdown instead of raw syntax—include that package in Step 1 installation commands and Step 2 initialization rather than burying it in troubleshooting notes.
- **Clarify domain placeholders**: When agent or client guides use an illustrative domain service class, state briefly on first mention that it represents the application's own domain logic rather than an A2UI SDK class.

---

## Protocol version focus in guides

- **Keep shared guide prose 100% on v1.0**: Main step descriptions, prose explanations, and primary code snippets in guides and quickstarts target **v1.0** exclusively. Do not clutter shared instructions with v0.9 comparisons.
- **Quickstarts omit version comparison tabs**: Onboarding quickstarts use untabbed v1.0 examples so newcomers are not confronted with legacy protocol branches during their first five minutes.
- **Isolate platform-specific version lags inside that platform's tab**: If a specific renderer package has not yet migrated to v1.0 (for example, an alpha renderer package targeting `v0.9.1`), document that constraint strictly inside that platform's `<TabItem>` (or an `<Aside type="note">` inside that tab), never in shared prose above the tabs.

---

## Code snippet robustness and runtime lifecycle

Snippets in guides must model production-safe asynchronous lifecycle and error handling rather than fragile shortcuts:

- **React hook hygiene**:
  - Avoid stale closures inside `useMemo(..., [])` by storing dynamic parent callbacks (such as `onAction`) in a `useRef` and reading `onActionRef.current` inside the memoized handler.
  - Always dispose resources on unmount inside `useEffect` (`return () => processor.dispose();`) so pending subscriptions and function calls are cleaned up.
- **Lit lifecycle hygiene**: Extract `MessageProcessor` subscription setup into a helper invoked from both `connectedCallback()` and `willUpdate(changedProperties)` (when `processor` changes), and clean up subscriptions in `disconnectedCallback()`.
- **Multi-turn agent server stubs**: When server/agent examples maintain session state across multiple turns, emit follow-up turns with `surface(..., update=true)` (or equivalent update mode) so reusing an existing surface ID does not raise `A2uiIntegrityError: Surface already exists`.
- **Defensive client transport handling**: In `fetch` or streaming transport snippets, always check `if (!response.ok)` before reading the body, and verify the response text is non-empty (`if (text.trim())`) before calling `JSON.parse` or forwarding chunks—preventing crashes or infinite retry loops on HTTP `204 No Content` acknowledgments.
- **Shell commands in playbooks and quickstarts**:
  - Never chain two blocking dev servers sequentially (`node server.js && python agent.py`); background long-running processes (`(cd server && npm start) &`) or instruct the user to open a second terminal.
  - Wrap directory-specific commands in subshells `(cd apps/web && npm install)` so the caller's working directory does not drift across steps.

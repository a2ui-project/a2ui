# Liner Notes: an A2UI v1.0 macros demo

Liner Notes answers questions about a small, fake music database. Gemini (`gemini-3.6-flash` by default) replies with a sentence or two and a block of A2UI written in the Express DSL. That block mostly calls **macros**: high-level components such as `Discography("the-beatles")` or `TourSchedule("aldous-harding")`. The Python server expands each macro into components from two catalogs, the A2UI **basic catalog** and a custom **music catalog**, and sends A2UI v1.0 messages to a React client. The client renders the basic catalog with the stock renderer and implements the music catalog itself.

The sample lives under `samples/community/` because v1.0 macro support is only in the monorepo so far. The agent uses the workspace `a2ui-agent-sdk`, and the client uses the monorepo builds of `@a2ui/react`, `@a2ui/web_core` and `@a2ui/markdown-it` through Vite aliases.

## How it fits together

```text
browser (React, :5180)                       agent (FastAPI, :8100)
  MessageProcessor([basic v1, music])  <--   Gemini + tools (find_artists, get_artist_facts)
  A2uiSurface per turn                       -> Express with macro calls
  music catalog React components             -> ExpressFormat parser (basic + music + macro sidecar)
  buttons -> POST /api/action          -->   -> MacroExpander.transform_to_transport
                                             -> a2ui.core MessageProcessor validation
```

The files that matter:

1. [`catalog/music_catalog.json`](catalog/music_catalog.json) defines the music catalog: `ArtistAvatar`, `AlbumArt`, `GenreTags`, `TrackList`, `DateBadge` and `Timeline`. The agent loads it with `Catalog.from_json`. The client mirrors it in zod, and a unit test checks that the two match.
2. [`agent/liner_notes/macros.py`](agent/liner_notes/macros.py) has eight macros. Seven take only ids and read the database while they expand, so the model never copies album lists or tour dates into the UI. `FactCard` takes text that the model writes.
3. [`agent/liner_notes/runtime.py`](agent/liner_notes/runtime.py) wires the catalogs, the `MacroExpander` and the Express format together, and validates every response before it leaves the server.
4. [`agent/liner_notes/agent.py`](agent/liner_notes/agent.py) calls Gemini with the database tools, keeps per-conversation history, and retries once with the error message if the model's A2UI fails validation.
5. [`client/src/catalog/music_catalog.tsx`](client/src/catalog/music_catalog.tsx) implements the music catalog in React, and [`client/src/conversation.ts`](client/src/conversation.ts) feeds agent messages to the `MessageProcessor` and sends button actions back.

Each assistant turn creates its own surface. Surfaces have no default catalog, and each component carries its own `catalogId`, as v1.0 allows. Buttons inside macros send v1.0 `event` actions such as `show_album`, and the server answers those without the model by expanding the matching macro.

Every turn has an "Under the hood" panel. It shows the Express that the model wrote, the expanded v1.0 messages, the tool calls and counts such as "1 macro call → 77 components".

## Running it

Build the monorepo packages that the client aliases, once, from the repository root:

```bash
yarn install
yarn workspace @a2ui/web_core run build
yarn workspace @a2ui/react run build
yarn workspace @a2ui/markdown-it run build
```

Start the agent. Without `GEMINI_API_KEY` it runs in scripted mode, which answers the example prompts and artist names from canned responses.

```bash
cd samples/community/macros-music/agent
export GEMINI_API_KEY=...            # optional
export GEMINI_MODEL=gemini-3.6-flash # optional, this is the default
uv run uvicorn liner_notes.server:app --port 8100
```

Start the client from the community Yarn root:

```bash
cd samples/community
yarn install
yarn workspace a2ui-macros-music-client dev
```

Open http://localhost:5180. The Vite dev server proxies `/api` to port 8100. Set `LINER_NOTES_API_PORT` to use another port.

## Testing

```bash
# Agent unit tests: every macro for every artist and album, actions, and the HTTP API.
uv run pytest samples/community/macros-music/agent/tests

# Client unit test: the zod schemas match music_catalog.json.
yarn workspace a2ui-macros-music-client test

# End-to-end tests. Each starts its own agent (port 8101) and client (port 5181).
yarn workspace a2ui-macros-music-client test:e2e       # scripted agent, deterministic
yarn workspace a2ui-macros-music-client test:e2e:live  # Gemini, needs GEMINI_API_KEY
```

## About the data

The database has 16 artists from different decades and regions. Biographical facts are summarized from public sources, track durations are approximate, and all tour dates are made up.

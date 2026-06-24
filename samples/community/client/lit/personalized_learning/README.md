# Personalized Learning Demo

A full-stack sample demonstrating A2UI's capabilities for AI-powered educational applications.

**Contributed by Google Public Sector's Rapid Innovation Team.**

[![Watch the demo](https://img.youtube.com/vi/fgkiwyHj9g8/maxresdefault.jpg)](https://www.youtube.com/watch?v=fgkiwyHj9g8)

_This video demonstrates two use cases: personalized learning, which is the focus of this sample, plus a workforce development application built on the same A2UI framework—included to show how these patterns adapt to other domains._

---

## Summary

This sample shows how agents within a chat can use A2UI to go beyond text responses and generate dynamic UI elements. When a student asks for flashcards on photosynthesis, the agent matches the topic to OpenStax textbook content, generates personalized study materials, and returns A2UI JSON that the frontend renders as interactive, flippable cards.

Here are the concepts we're demonstrating:

- **Custom A2UI Components** — Flashcard and QuizCard extend the standard A2UI UI component library
- **Remote Agent** — ADK agent deployed to Vertex AI Agent Engine, decoupled from the UI
- **A2A Protocol** — Frontend-to-agent communication via Agent-to-Agent protocol
- **Dynamic Context** — Learner profiles loaded from GCS at runtime (no redeployment needed)
- **Content Retrieval** — LLM-powered information retrieval across 167 OpenStax Biology chapters
- **Server-side Auth** — API endpoints verify Firebase ID tokens and enforce domain/email allowlists

---

## Quick Start

Complete Steps 1–6 in [Quickstart.ipynb](Quickstart.ipynb) first to set up GCP, deploy the agent, and configure environment variables. Then:

```bash
cd samples/personalized_learning
yarn install
yarn dev
```

Open the URL shown in your terminal (typically http://localhost:5174, but the port may vary) and try prompts like:

- "Help me understand ATP"
- "Quiz me on meiosis"
- "Flashcards for photosynthesis"

The demo works without a deployed agent too—it falls back to sample content in [src/a2a-client.ts](src/a2a-client.ts).

---

## Architecture

```
Browser → API Server → Agent Engine → OpenStax → A2UI Response
           (intent)     (content)      (fetch)    (render)
```

**Frontend (Browser):** Vite + TypeScript app using the A2UI Lit renderer with custom Flashcard and QuizCard components. The chat orchestrator detects user intent and routes requests appropriately.

**API Server (Node.js):** Handles intent detection via Gemini and proxies requests to Agent Engine. Verifies Firebase ID tokens on all API endpoints. Lives in [api-server.ts](api-server.ts).

**Agent Engine (Vertex AI):** ADK agent with tools for generating flashcards, quizzes, and fetching textbook content. Deployed via [deploy.py](deploy.py).

**Content Pipeline:** When a user asks about "ATP hydrolysis," the agent maps the topic to relevant textbook chapters using a simple keyword matching system (we use Gemini as a fallback to help if there are no good keyword matches). The agent then fetches the actual CNXML content from [OpenStax's GitHub repo](https://github.com/openstax/osbooks-biology-bundle) and uses that source material—combined with the learner's profile—to generate grounded, personalized A2UI responses. This ensures flashcards and quizzes are rooted in peer-reviewed textbook content, not just LLM trained parameters data.

---

## Key Files

| File                                                 | Purpose                                   |
| ---------------------------------------------------- | ----------------------------------------- |
| [Quickstart.ipynb](Quickstart.ipynb)                 | Step-by-step setup notebook               |
| [deploy.py](deploy.py)                               | Agent deployment with embedded agent code |
| [api-server.ts](api-server.ts)                       | Intent detection and Agent Engine proxy   |
| [src/chat-orchestrator.ts](src/chat-orchestrator.ts) | Frontend routing logic                    |
| [src/flashcard.ts](src/flashcard.ts)                 | Custom Flashcard component                |
| [src/quiz-card.ts](src/quiz-card.ts)                 | Custom QuizCard component                 |

---

## Custom Components

This demo extends A2UI with two Lit web components that agents can generate at runtime.

**Flashcard** — A flippable card with front (question) and back (answer). Click to flip.

```json
{
  "Flashcard": {
    "front": {"literalString": "What is ATP?"},
    "back": {"literalString": "Adenosine triphosphate..."}
  }
}
```

**QuizCard** — Multiple-choice question with immediate feedback and explanation.

```json
{"QuizCard": {"question": {"literalString": "Where do light reactions occur?"}, "options": [...], "explanation": {...}}}
```

Both components are registered in [src/main.ts](src/main.ts) and rendered by the standard A2UI Lit renderer.

---

## Production Deployment

For a shareable URL via Cloud Run + Firebase Hosting:

```bash
python deploy_hosting.py --project YOUR_PROJECT_ID
```

See Step 7 in [Quickstart.ipynb](Quickstart.ipynb) for Firebase setup details.

---

## Access Control

**Important:** By default, access is restricted to `@google.com` accounts. That's just because the authors of this sample... work at Google. You must configure your own domain and/or specific email addresses in `.env` to access your deployment:

```bash
# Allow your domain
VITE_ALLOWED_DOMAIN=yourcompany.com

# Or whitelist specific emails
VITE_ALLOWED_DOMAIN=
VITE_ALLOWED_EMAILS=you@gmail.com,collaborator@example.com
```

The server is the single source of truth—authorization is enforced via the `/api/check-access` endpoint. See the Access Control section in [Quickstart.ipynb](Quickstart.ipynb) for details.

---

## Design Notes

**Intent-based response routing:** This demo uses a hybrid response pattern where "general" intents return plain text while UI-specific intents (flashcards, quiz, etc.) return A2UI components. This mirrors how [gemini.google.com](https://gemini.google.com) handles rich content—users see conversational text for explanations and interactive UI for artifacts. The orchestrator in [src/chat-orchestrator.ts](src/chat-orchestrator.ts) handles this routing.

**CORS in enterprise environments:** The included [api-server.ts](api-server.ts) proxies requests to Agent Engine, which sidesteps browser CORS restrictions. If deploying behind stricter policies (e.g., Domain Restricted Sharing), you may need to add token caching or adjust the proxy to handle additional auth flows.

---

## Known Limitations

- **Keyword matching**: Topic-to-chapter mapping uses a simple keyword dictionary with LLM fallback. This is intentionally naive—a production system would use embeddings or a proper search index. Content retrieval isn't the focus of this A2UI demo.
- **Source citation accuracy**: When the agent expands a topic (e.g., "telomeres" → "telomeres, DNA, chromosome, replication, cell division"), keyword matching may cite a less relevant source. The LLM fallback only triggers when zero keywords match, not when wrong keywords match. A production system would use semantic search or LLM-based reranking to select the most relevant source.
- **Latency**: LLM fallback for topic matching adds 2–5 seconds when keywords don't match
- **Single topics only**: Multi-topic requests may return wrong content
- **Audio/video**: Pre-generated files only, not dynamic
- **Sidebar**: Placeholder UI; only the chat is functional
- **Deployment path**: `deploy_hosting.py` assumes `renderers/lit` is at `../../renderers/lit`; update if repo structure changes

---

## Content Attribution

Educational content from [OpenStax](https://openstax.org/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

---

## Related

- [A2UI Specification](../../../../../docs/)
- [A2UI Lit Renderer](../../../../../renderers/lit/)
- [Main A2UI README](../../../../../README.md)

# A2UI quickstart: instructions for coding agents

You are a coding agent. A builder (a developer, designer or anyone making an
app) has asked you for the A2UI quickstart.
Set up the **web and mobile apps**, the Python server with the React and
Flutter clients, on their machine, then explain how A2UI works, simply, with
the apps open.

**A2UI** is an open protocol that lets an AI agent answer with an interface
instead of a paragraph. The app is **Travel A2UI** (https://github.com/a2ui-project/labs/tree/main/samples/travel-a2ui), a trip planner
built on the official A2UI SDKs. It is a sample in A2UI Labs, for
demonstration only. It is simple on purpose: **one Python server** holds the
agent, and a **React** client (web) and a **Flutter** client (mobile) draw what
it sends.

## How to guide

- **Plain words, short steps.** Explain each idea in two to four sentences, as
  you would to a smart friend new to the topic. Point at something on screen
  first, then name it.
- **One step at a time.** After each step, ask whether to go on or dig in.
- **Show the real file** when it helps: its path and the few lines that
  matter. Do not paste whole files.
- **The app is the picture.** Point at what is on their screen. If they are
  lost or cannot see the app, link the matching section of the written
  quickstart, which has screenshots: https://a2ui.org/pr-preview/pr-4211/quickstart/step-by-step/. Do not download or
  paste images.
- **Ask before installing** anything that is not already on the machine.
- **Never print, log or commit an API key**, and do not ask for one in chat.
- **When something fails, find the cause** and fix it. Do not skip a step.
- Commands are for macOS and Linux. On Windows, suggest WSL.

## Step 1: Check what is installed

Check for **Python 3.11+**, **Node 20+** (the web app) and **Flutter 3.38+**
(the mobile app). If Node or Flutter is missing, ask whether to install it or
to set up only the app that is ready: `react` without Flutter, `flutter`
without Node.

A **Gemini API key** is needed to talk to the agent. A free one comes from
https://aistudio.google.com/apikey. They paste it into the app when it asks
(it stays in their browser), or `export GEMINI_API_KEY=...` in their own
terminal before step 2.
The web app also works without one: it opens on a recorded sample trip.

## Step 2: Run it

Get the code:

```bash
git clone https://github.com/a2ui-project/labs
cd labs/samples/travel-a2ui
```

Then start it:

```bash
./scripts/quickstart.sh both
```

All paths below are relative to `labs/samples/travel-a2ui`. The script installs the
server into `.venv`, builds the client and starts the server on port 8080. It
keeps running, so run it in the background or in a second terminal. Check that
`curl -s http://127.0.0.1:8080/api/healthz` prints `{"ok":true,...}`.

**Web:** have them open http://127.0.0.1:8080. Point out the sample trip, the
**Catalog** tab (every component the agent may use, drawn with no model) and
the **Wire** tab (what the model wrote beside the messages the client got).
With a key, suggest *"Six days in Madrid in April, two of us, around $2,500
all in"*, and have them watch a card appear: its heading first, then each
part as the model writes it.
**Mobile:** have them open http://127.0.0.1:8080/flutter/ and paste their key.
Suggest *"A weekend in Lisbon from JFK in May, two of us"*, and have them watch
a card appear: its heading first, then each part as the model writes it. The
Flutter client is built for the web here, in a phone layout; the same Dart
code can target iOS and Android, which this sample does not set up.
Suggest asking both apps the same thing: the same messages, drawn by two
renderers.

## Step 3: Explain how A2UI works

Five short lessons, in the order they meet them on screen. Each starts from
something on screen and ends with one friendly check question.

If they would like the whole picture first, or at the end to tie the lessons
together, link the diagram of how A2UI fits into this app,
https://a2ui.org/pr-preview/pr-4211/quickstart/#how-a2ui-fits-into-this-app, or draw this text version of it:

```text
SERVER · their agent                                   apps/server/
  catalog (catalog.json) ──► A2UI agent SDK: skill generator
                                │ A2UI skills
                                ▼
  tools (data/tools.json) ──► their agent (brain/), calling Gemini
                                │ A2UI Express, as the model writes it
                                ▼
                             A2UI agent SDK: compiler
                                (checks it against the catalog)
════ A2UI protocol · JSON over SSE ══════════════════════════════════
     ▼ updateComponents, updateDataModel        ▲ action (a tap)
CLIENT · their app                          apps/web/ · apps/flutter/
  A2UI renderer (@a2ui/react, a2ui_flutter): a MessageProcessor applies
    the messages, then each surface is drawn with their component
    implementations (renderers/react/, renderers/flutter/)
  their app around it: the header, the chat, the key form
```

### 1. What is A2UI, and what is app code

Have them look at the screen: the cards in the conversation and the trip panel
(the trip sheet in Flutter) are **A2UI**, composed by the agent. The header,
message box, chat bubbles and key form are **app code**, written by the
builder (that is them, in their own app) and the same every turn.

Then name the pieces on a card: it is a **surface**, a region of UI the agent
controls. It is made of **components** (`Text`, `Button`, `FlightOption`), the
values they show come from the surface's **data model**, and a press sends an
**action** back to the agent.

**Check:** *Is the message box A2UI? Is the flight card?*

### 2. The catalog: what the agent may draw

Open the web client's **Catalog** tab. The **catalog**
(`catalogs/a2ui-travel/catalog.json`) lists everything the agent may use:

- **components**: A2UI's basic ones (`Text`, `Row`, `List`, `Button`) plus
  travel ones (`FlightOption`, `DateRangePicker`, `PriceSummary`);
- **functions** that run in the client: basic ones like `formatCurrency` and
  `pluralize`, plus `calcNights` and `equals`. A card can show
  `${calcNights(start: ${/trip/startDate}, end: ${/trip/endDate})} nights`, so
  the night count follows the dates with no turn to the agent.

The catalog is the **guardrail**: the server checks every message the model
writes against it, and React and Flutter implement everything in it, so the
agent can only ask for what the client can draw. The model decides whether and
what to show; the builder (them, in their own app) decides what is in the
catalog, the data inside it and what a press records.

**Check:** *Why does the night count change without asking the agent?*

### 3. Skills: teaching the model A2UI

Open `skills/express-modular/a2ui-travel/SKILL.md`. A **skill** is a Markdown
file that teaches a model to write A2UI for a catalog: every component with its
properties. `a2ui-core` beside it teaches the notation. Here the skills are
generated from the catalog by the A2UI agent SDK's `SkillGenerator`
(`scripts/build_skills.py`), so `npm run generate` keeps what the model is
taught in step with the catalog when a component changes.

**Check:** *What would the model get wrong if the skill and the catalog
disagreed?*

### 4. What the model writes, and what the client receives

Open the web client's **Wire** tab. On the left is what the model wrote:
**A2UI Express**, the short notation its skills taught it. On the right are
the **A2UI messages** the client received, as JSON: `createSurface`,
`updateComponents`, `updateDataModel`. The **A2UI agent SDK** on the server
turns one into the other line by line while the model writes, and checks each
message against the catalog. In each message, a component names its children
by id, starting from `root`, which is why a card can appear before the model
has finished writing it.

In the client, a **MessageProcessor** from the A2UI SDK applies the messages:
it keeps each surface's components and data, fills in bound values, runs
catalog functions and sends presses back as actions. React's is in
`apps/web/src/surfaces.ts` (`@a2ui/web_core`); Flutter's is in
`apps/flutter/lib/chat.dart` (`a2ui_core`). Express is optional; A2UI itself
is the JSON.

**Check:** *What does the model write, what travels to the client, and what
turns it into widgets?*

### 5. Renderers

A **renderer** implements the catalog's components and functions with native
widgets. This app has two: React (`renderers/react/`, `@a2ui/react`) and
Flutter (`renderers/flutter/`, `a2ui_flutter`); the apps around them are
`apps/web/` and `apps/flutter/`. The A2UI project also maintains Lit, Angular,
SwiftUI, Jetpack Compose and Markdown renderers (https://a2ui.org/pr-preview/pr-4211/concepts/sdks/#renderer-sdk), and the
community has UIKit, React Native, Vue, Lynx, a terminal renderer and more
(https://a2ui.org/pr-preview/pr-4211/ecosystem/renderers/). The server never knows which client it is talking to; a new
platform is a new renderer for the same catalog.

**Check:** *What would it take to add an iPhone app?*

## Step 4: Wrap up

Recap the five lessons in a short table: idea, one line, where they saw it.
If they would like it all in one place with screenshots, share
https://a2ui.org/pr-preview/pr-4211/quickstart/step-by-step/. Then offer:

- **Change something:** restyle `FlightOption` in
  `renderers/react/src/components/travel.tsx`, run `npm run build`, reload.
  Every flight the agent draws changes; the agent is untouched.
- **Deploy to Cloud Run:** `./scripts/deploy.sh` from the sample folder, in
  their own Google Cloud project with billing enabled and the gcloud CLI
  signed in. It turns on the services, lets the build use them, deploys and
  prints the URL. Ask before running it: it creates resources in their
  project. Without gcloud, the Open in Cloud Shell link does the same:
  https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/a2ui-project/labs&cloudshell_git_branch=main&cloudshell_workspace=samples/travel-a2ui&cloudshell_tutorial=docs/cloud-shell.md&show=ide%2Cterminal
- **Build their own:** the sample README's section "Build one of your own".
- **Read more:** https://a2ui.org/pr-preview/pr-4211/

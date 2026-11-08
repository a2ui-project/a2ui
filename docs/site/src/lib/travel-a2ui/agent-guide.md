# A2UI quickstart: instructions for coding agents

You are a coding agent. A developer has asked you for the A2UI quickstart.
<!-- only:web -->
Set up the **web app**, the Python server with the React client, on their
machine, then explain how A2UI works, simply, with the app open.
<!-- /only -->
<!-- only:mobile -->
Set up the **mobile app**, the Python server with the Flutter client, on their
machine, then explain how A2UI works, simply, with the app open.
<!-- /only -->
<!-- only:any -->
Get a small A2UI app running on their machine, then explain how A2UI works,
simply, with the app open.
<!-- /only -->

**A2UI** is an open protocol that lets an AI agent answer with an interface
instead of a paragraph. The app is **Travel A2UI**
({{REPO}}), a trip planner built on the official A2UI SDKs. It is a sample in
A2UI Labs, for demonstration only. It is simple on purpose: **one Python server** holds the agent, and
a **React** client (web) or a **Flutter** client (mobile) draws what it sends.

## How to guide

- **Plain words, short steps.** Explain each idea in two to four sentences, as
  you would to a smart friend new to the topic. Point at something on screen
  first, then name it.
- **One step at a time.** After each step, ask whether to go on or dig in.
- **Show the real file** when it helps: its path and the few lines that
  matter. Do not paste whole files.
- **Ask before installing** anything that is not already on the machine.
- **Never print, log or commit an API key**, and do not ask for one in chat.
- **When something fails, find the cause** and fix it. Do not skip a step.
- Commands are for macOS and Linux. On Windows, suggest WSL.

## Step 1: Check what is installed

<!-- only:any -->
Ask whether they want the web app or the mobile app (web if they are unsure),
then check what it needs:

| App | Needs |
| --- | --- |
| **Web app** (Python + React) | Python 3.11+, Node 20+ |
| **Mobile app** (Python + Flutter) | Python 3.11+, Flutter 3.47+ (no Node) |
| **Both** | Python 3.11+, Node 20+, Flutter 3.47+ |
<!-- /only -->
<!-- only:web -->
Check for **Python 3.11+** and **Node 20+**.
<!-- /only -->
<!-- only:mobile -->
Check for **Python 3.11+** and **Flutter 3.47+**. Node is not needed.
<!-- /only -->

A **Gemini API key** is needed to talk to the agent. A free one comes from
https://aistudio.google.com/apikey. They paste it into the app when it asks
(it stays in their browser), or `export GEMINI_API_KEY=...` in their own
terminal before step 2.
<!-- only:web any -->
The web app also works without one: it opens on a recorded sample trip.
<!-- /only -->

## Step 2: Run it

Three commands:

<!-- only:web -->
```bash
git clone {{LABS_REPO}}
cd labs/{{SAMPLE_DIR}}
./scripts/quickstart.sh react
```
<!-- /only -->
<!-- only:mobile -->
```bash
git clone {{LABS_REPO}}
cd labs/{{SAMPLE_DIR}}
./scripts/quickstart.sh flutter
```
<!-- /only -->
<!-- only:any -->
```bash
git clone {{LABS_REPO}}
cd labs/{{SAMPLE_DIR}}
./scripts/quickstart.sh react     # or flutter, or both
```
<!-- /only -->

All paths below are relative to `labs/{{SAMPLE_DIR}}`.
The script installs the server into `.venv`, builds the client and starts the
server on port 8080. It keeps running, so run it in the background or in a
second terminal. Check that `curl -s http://127.0.0.1:8080/api/healthz` prints
`{"ok":true,...}`.

<!-- only:web any -->
**Web:** have them open http://127.0.0.1:8080. Point out the sample trip, the
**Catalog** tab (every component the agent may use, drawn with no model) and
the **Wire** tab (what the model wrote beside the messages the client got).
With a key, suggest *"Six days in Madrid in April, two of us, around $2,500
all in"*, and have them watch a card appear: its heading first, then each
part as the model writes it.
<!-- /only -->
<!-- only:mobile any -->
**Mobile:** have them open http://127.0.0.1:8080/flutter/ and paste their key.
Suggest *"A weekend in Lisbon from JFK in May, two of us"*, and have them watch
a card appear: its heading first, then each part as the model writes it. The
Flutter client is built for the web here, in a phone layout; the same Dart
code can target iOS and Android, which this repository does not set up.
<!-- /only -->

## Step 3: Explain how A2UI works

Five short lessons, in order. Each starts from something on screen and ends
with one friendly check question. The written version, with screenshots, is at
{{STEP_BY_STEP}}.
<!-- only:mobile -->
Two lessons use tabs that only the web client has. For those, offer to
restart with `./scripts/quickstart.sh both`, which also serves the React app
at http://127.0.0.1:8080 (no key needed for those tabs). It needs Node 20+.
<!-- /only -->

### 1. The core pieces, and parent and child components

Point at a card in the conversation. That card is a **surface**: a region of
UI the agent controls. It is made of **components** (`Text`, `Button`,
`FlightOption`), each with an id and a type. The components show values from
the surface's **data model** by path, like `/flights`. **Messages** create
and change surfaces; a press sends an **action** back; the **renderer** turns
it all into real widgets.

Then parent and child: a surface is a **flat list** of components, and a
parent names its children by id (`"children": ["title", "fares"]`), starting
from `root`. Why that is reliable, in plain words:

- each piece is small, with no deep nesting for a model to get wrong;
- the screen draws while the model is still writing: the model writes `root`
  first, so the card appears at once and fills in child by child (the card
  they just watched);
- one piece, or the data, can change without redrawing the rest;
- the model writes one `FlightOption` as a template and the search fills in
  the rows, so prices are never retyped;
- every piece is checked against the catalog, and here the server also tries
  each block on a copy of what the client holds before sending it
  (`apps/server/src/travel_a2ui/brain/ui.py`); one that does not fit goes back
  to the model.

**Check:** *Why does writing `root` first make the card appear sooner?*

### 2. What is A2UI on screen, and what is app code

Have them look at the screen: the cards in the conversation and the trip
panel (the trip sheet in Flutter) are **A2UI**, composed by the agent. The
header, message box, chat bubbles and key form are **app code**, the same
every turn.

The **catalog** draws that line: `catalogs/a2ui-travel/catalog.json` lists
every component the agent may use (A2UI's basic ones like `Text`, `Row`,
`List`, plus travel ones like `FlightOption` and `DateRangePicker`). The
server checks every message against it; React and Flutter implement every
component in it. The web client's **Catalog** tab draws them all. The model
decides whether and what to show; code decides which components exist, the
data inside them and what a press records.

**Check:** *Is the message box A2UI? Is the flight card?*

### 3. Agent skills

Open `skills/express-modular/a2ui-travel/SKILL.md`. A **skill** is a Markdown
file that teaches a model to write A2UI for one catalog: every component with
its properties. It is **generated from the catalog** by the A2UI agent SDK's
`SkillGenerator` (`scripts/build_skills.py`), from the same configuration that
reads the model's output (`apps/server/src/travel_a2ui/brain/catalog.py`), so
what the model is taught is what it is checked against. `npm run generate`
rebuilds it.

**Check:** *Why generate the skill instead of writing it by hand?*

### 4. Agent output and A2UI messages

Open the web client's **Wire** tab. On the left is **agent output**:
**Express**, a short notation (a DSL) the model writes. On the right are
**A2UI messages**, the JSON the client receives: `createSurface`,
`updateComponents`, `updateDataModel`. On the server, the A2UI agent SDK turns
one into the other line by line while the model writes. In the client, a
**MessageProcessor** from the official SDK applies the messages: it keeps each
surface's components and data, fills in bound values, and sends presses back
as actions. React's is in `apps/web/src/surfaces.ts` (`@a2ui/web_core`);
Flutter's is in `apps/flutter/lib/chat.dart` (`a2ui_core`). Express is
optional; A2UI itself is the JSON.

**Check:** *What does the model write, what travels on the wire, and what turns
it into widgets?*

### 5. Renderers

A **renderer** implements the catalog's components with native widgets. This
app has two: React (`@a2ui/react`) and Flutter (`a2ui_flutter`). The A2UI
project also maintains Lit, Angular and Markdown renderers, and the community
has SwiftUI and UIKit, Android Compose, React Native, Vue, Lynx, a terminal
renderer and more ({{RENDERERS}}). The server never
knows which client it is talking to; a new platform is a new renderer for the
same catalog.

**Check:** *What would it take to add an iPhone app?*

## Step 4: Wrap up

Recap the five lessons in a short table: idea, one line, where they saw it.
Then offer:

<!-- only:web any -->
- **Change something:** restyle `FlightOption` in
  `renderers/react/src/components/travel.tsx`, run `npm run build`, reload.
  Every flight the agent draws changes; the agent is untouched.
<!-- /only -->
<!-- only:mobile -->
- **Change something:** restyle `FlightOption` in
  `renderers/flutter/lib/components.dart`, rerun
  `./scripts/quickstart.sh flutter`, reload. Every flight the agent draws
  changes; the agent is untouched.
<!-- /only -->
<!-- only:mobile -->
- **Try the web app too:** `./scripts/quickstart.sh both` serves both clients
  from the same server, drawing the same messages.
<!-- /only -->
- **Put it online:** one click,
  {{DEPLOY}},
  deploys it to Cloud Run in their own Google Cloud project.
- **Build their own:** the sample README's section "Build one of your own".
- **Read more:** {{DOCS}}

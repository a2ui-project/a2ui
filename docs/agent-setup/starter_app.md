---
name: a2ui-starter-app
description: Set up and run the A2UI starter app (Actual Budget + a Gemini agent that generates its UI over A2UI v1.0), then prove that one generated UI flow works.
user-invocable: true
metadata:
  author: a2ui
  version: 0.1.0
  repository: https://github.com/a2ui-project/labs
---

# A2UI Starter App Setup

You are setting up the A2UI starter app for the user. The app is Actual Budget
(a personal finance app) with an Assistant page. On that page, an agent built on
the Gemini API generates the UI over the A2UI protocol.

The starter lives in the A2UI labs repository,
https://github.com/a2ui-project/labs, in its `typescript-starter` folder (the
web app, with the agent and the sidecar). The setup happens there.

The app has three local processes:

| Process    | Port | What it is                                                 |
| ---------- | ---- | ---------------------------------------------------------- |
| Web client | 3001 | Actual Budget in the browser (Vite dev server)             |
| Sidecar    | 5007 | Node service that holds the seeded demo budget             |
| Agent      | 8484 | Python service that calls Gemini and streams A2UI messages |

Follow the steps in order. Each step has a check, an action and a verify. Do not
continue past a verify that fails. Do not skip ahead.

The only credential is a Gemini API key. It is optional: scripted mode runs the
full app with canned answers and no key.

The full A2UI documentation index is at https://a2ui.org/llms.txt.

## Critical rules

- Never print, log or repeat the Gemini API key. Never commit it.
- Write the key only to `a2ui/agent/.env`. Never write it to any other file.
- Run every `yarn` command from `typescript-starter`, as
  `npx -y corepack@0.36.0 yarn <args>`.
- Do not run `npm install -g corepack`. On a machine with Homebrew pnpm it fails
  with `EEXIST`.
- Do not use `sudo`.
- Do not edit files under `packages/`, `a2ui/agent/` or `a2ui/sidecar/` to get
  past a failure. Report the failure instead (see "If something fails").
- Do not delete files or folders without a yes from the user.

## Before you start

1. Run `pwd`.
2. If the folder is the user's home folder or a system folder, ask the user to
   choose or create a folder for the starter app. Continue there.
3. Run `test -d a2ui-labs && echo exists || echo absent`.
4. If it prints `exists`, ask the user: reuse it, or clone again into a new
   folder name. To reuse it, run `cd a2ui-labs/typescript-starter` and go to
   Step 6. Do not delete the folder.
5. Tell the user this plan and wait for a yes:
   - Check the toolchain (Node, git, Python, Yarn through Corepack).
   - Clone the A2UI labs repository into `a2ui-labs`.
   - Install dependencies. This downloads about 400 MB, uses about 1.7 GB of
     disk, and takes from 20 seconds (warm cache) to several minutes.
   - Seed a demo budget with sample transactions.
   - Optionally, store a Gemini API key in `a2ui/agent/.env`.
   - Start the app on ports 3001, 5007 and 8484, and prove that one generated UI
     flow works.

## Step 1: Check the toolchain

Check:

```bash
node --version
git --version
python3 --version
npx -y corepack@0.36.0 --version
```

Expected output (versions can be higher):

```
v24.18.1
git version 2.54.0
Python 3.12.9
0.36.0
```

Verify:

- Node must be 22.18.0 or higher. The repo pins v24.18.1 in `.nvmrc`.
- git must be present.
- Python must be 3.12 or higher.
- `npx -y corepack@0.36.0 --version` must print `0.36.0`.

If a check fails:

- Node missing or too old: tell the user to install Node 24 from
  https://nodejs.org (or `nvm install 24`). Stop until the user confirms.
- git missing: tell the user to install git from https://git-scm.com. Stop until
  the user confirms.
- `python3` is 3.9 or lower: on macOS, `/usr/bin/python3` is 3.9.6. Run
  `ls /opt/homebrew/bin/python3.1* /usr/local/bin/python3.1* 2>/dev/null` to
  find a newer Python. If one exists, use that full path instead of `python3` in
  Step 5. If none exists, tell the user to install Python 3.12 or higher
  (`brew install python@3.12` or https://www.python.org/downloads/). Stop until
  the user confirms.
- Corepack fails: print the error verbatim and stop.

Do not install anything yourself without a yes from the user.

## Step 2: Get the labs repository

Check: `test -d a2ui-labs && echo exists || echo absent` prints `absent`.

Act:

```bash
git clone --depth 1 https://github.com/a2ui-project/labs.git a2ui-labs
cd a2ui-labs/typescript-starter
```

Verify:

```bash
ls a2ui
```

Expected output: the folder list contains at least these entries:

```
agent
doctor.mjs
run.mjs
sidecar
```

Run every later command in Steps 3 to 9 from `typescript-starter`, not from
the repository root (`a2ui-labs`). `typescript-starter` is the Yarn workspace
root of the web app.

If the clone fails, print the git error verbatim. Retry once. If it fails again,
stop.

## Step 3: Install the web client dependencies

Check: `test -f node_modules/.yarn-state.yml && echo installed || echo missing`.
If it prints `installed`, go to Step 4.

Act (from `typescript-starter`):

```bash
npx -y corepack@0.36.0 yarn install
```

Measured times: 19 seconds with a warm Yarn cache, 48 seconds on a second
machine state. With an empty cache it downloads about 400 MB, which can take 10
minutes on a slow network. Stream the output; do not stop the command early.

Verify: the command exits with code 0, and the last line looks like this:

```
➤ YN0000: · Done with warnings in 18s 140ms
```

Warnings with codes `YN0002`, `YN0060` and `YN0086` (peer dependencies) and
`YN0004`, `YN0005` and `YN0007` (build scripts) are expected. Ignore them.

If the install fails, print the last 30 lines of output. If the error is a
network error, retry once. Otherwise stop.

## Step 4: Install the sidecar and seed the demo budget

Check: `test -d a2ui/sidecar/node_modules && echo installed || echo missing`.

Act:

```bash
cd a2ui/sidecar
npm install
npm run seed
cd ../..
```

Do not use yarn in `a2ui/sidecar`. It is a standalone npm project.

`npm install` takes about 3 seconds. The npm audit summary at the end changes
as new advisories publish. A vulnerability count is not a setup failure: report
it to the user and continue. A warning
`npm warn install-scripts ... better-sqlite3@13.0.3 (install: node-gyp rebuild)`
is expected: better-sqlite3 ships prebuilt binaries. Ignore it.

`npm run seed` first prints log lines that start with `[Breadcrumb]`,
`Loading fresh spreadsheet`, and one line
`cloudStorage.upload failed during finish-import { type: 'FileUploadError', reason: 'unauthorized', ... }`.
These are expected: the seed runs without a sync server.

Verify: `npm run seed` then prints JSON. Expected output (IDs and paths differ):

```json
{
  "budgetName": "A2UI-Demo-Budget",
  "budgetId": "A2UI-Demo-Budget-e8183d2",
  "syncId": null,
  "accounts": [
    { "id": "9b181ca2-...", "name": "Checking" },
    { "id": "307036d9-...", "name": "Savings" }
  ],
  "transactions": 180,
  "schedules": 2,
  "csvPath": ".../typescript-starter/a2ui/sidecar/seed/seed.csv",
  "reused": false
}
```

- `transactions` must be greater than 0. The seed makes 180.
- If the budget already exists, the output has `"reused": true` and no
  `schedules` field. That is a pass.

If `npm install` fails with a `node-gyp` or `better-sqlite3` build error, tell
the user that native build tools are missing (macOS: `xcode-select --install`).
Stop until the user confirms, then retry once.

If `npm run seed` prints an error or `"transactions": 0`, run
`npm run seed -- --reset` once (from `a2ui/sidecar`). If it fails again, stop
and report the output.

## Step 5: Set up the agent

The agent needs Python 3.12 or higher. If Step 1 found a newer Python at a full
path, use that path instead of `python3`.

Check: `test -x a2ui/agent/.venv/bin/python && echo exists || echo missing`.

Act:

```bash
cd a2ui/agent
python3 -m venv .venv
.venv/bin/pip install --no-deps -r requirements.txt
cd ../..
```

Run the pip command from `a2ui/agent`, not from `typescript-starter`. The
`-e .[dev]` line in `requirements.txt` resolves `.` against the current folder.
The `--no-deps` flag is required: `requirements.txt` is a full lock of the
venv, and without the flag pip rejects the pinned git versions (the header of
`requirements.txt` explains why).

The first install clones the A2UI git repository and takes about a minute.
Verify: the pip output has a line that starts with `Successfully installed`,
and that line contains `a2ui-agent-sdk-0.9.1.dev171` and `google-genai-2.31.0`.
The `.dev171` suffix comes from the pinned git commit. A
`[notice] A new release of pip is available` line after it is harmless.

If pip fails, print the last 30 lines. Retry once. If it fails again, stop.

## Step 6: Run the doctor

Act:

```bash
node a2ui/doctor.mjs
```

Expected output (versions can differ):

```
PASS node: 24.18.1 (need >= 22.18.0)
PASS git: git version 2.54.0
PASS yarn: 4.17.1 via npx corepack@0.36.0 (need 4.17.1)
PASS yarn install: node_modules present
PASS sidecar deps: @actual-app/api 26.10.0
PASS seeded budget: a2ui/sidecar/data/A2UI-Demo-Budget-e8183d2
PASS agent venv: python 3.12.9, a2ui-agent-sdk 0.9.1.dev171, google-genai 2.31.0 (need python >= 3.12)
doctor: 7/7 checks passed
```

Verify: the last line is `doctor: 7/7 checks passed` and the exit code is 0.

If a line starts with `FAIL`, run the command on its `fix:` line, then run the
doctor again. Do this at most twice. If a check still fails, stop.

## Step 7: Configure the Gemini API key (optional)

Ask the user: "Do you have a Gemini API key, and do you want to use it now? You
can get a free key at https://aistudio.google.com/apikey. Without a key, the app
runs in scripted mode with canned answers."

- If the user says no, go to Step 8. The user can also enter a key later in the
  app's key drawer ("Add API key" on the Assistant page).
- If the user says yes, continue.

Act. Ask the user to run this command in their own terminal, from
`typescript-starter`. It reads the key without showing it and writes only
`a2ui/agent/.env`:

```bash
bash -c 'read -rsp "Gemini API key: " K; echo; printf "GEMINI_API_KEY=%s\n" "$K" > a2ui/agent/.env; chmod 600 a2ui/agent/.env'
```

If the user pastes the key into this conversation instead, write exactly one
line, `GEMINI_API_KEY=<the key>`, to `a2ui/agent/.env`. Do not show the key in
your reply, in a command line or in a log.

Verify:

```bash
git check-ignore a2ui/agent/.env
node a2ui/doctor.mjs --key-check
```

Expected output:

```
a2ui/agent/.env
...
PASS gemini: ok (key accepted, gemini-3.8-flash available)
doctor: 8/8 checks passed
```

- `git check-ignore` must print `a2ui/agent/.env`. If it prints nothing, the
  file is not ignored: delete the file and stop.
- If the doctor prints `FAIL gemini: invalid key`, ask the user to check the key
  and enter it again. After 2 failures, stop and point the user to
  https://aistudio.google.com/apikey.

How the key reaches the agent: the agent reads `GEMINI_API_KEY` from its
environment or from `a2ui/agent/.env` at startup. A key saved in the app's key
drawer overrides it per request. With the `.env` file written above, Step 9
needs no further key entry.

## Step 8: Start the app in scripted mode and prove the setup

Scripted mode needs no key and no network. It verifies the full setup in about a
minute.

Check: ports 3001, 5007 and 8484 are free:

```bash
lsof -nP -iTCP:3001 -iTCP:5007 -iTCP:8484 -sTCP:LISTEN
```

Expected output: nothing. Judge by the output, not the exit code: `lsof` exits
with 1 when it finds nothing. If a line shows `(LISTEN)`, show the user the
process and ask whether to stop it. Do not stop it without a yes.

Act. Start the app as a background process (it keeps running) and stream its
output:

```bash
node a2ui/run.mjs --scripted
```

Verify: the output contains these lines (times differ). The measured time to
`ready` was 5 seconds; allow up to 5 minutes on a first start:

```
[run] starting in scripted mode from /path/to/a2ui-labs/typescript-starter
[run] sidecar healthy: http://127.0.0.1:5007/healthz (1.0s)
[run] agent healthy: http://127.0.0.1:8484/healthz (1.1s)
[run] web healthy: http://localhost:3001/ (5.1s)
[run] ready: open http://localhost:3001/ (agent mode: scripted). Press Ctrl+C to stop.
```

Output lines from the processes start with `[sidecar]`, `[agent]` or `[web]`.

If a port is taken, `run.mjs` starts nothing and prints, for example:

```
[run] port in use: 5007 (sidecar), 8484 (agent). Stop the other process first (lsof -nP -iTCP:<port> -sTCP:LISTEN).
```

Show the user which process holds the port and ask whether to stop it. Do not
stop it without a yes. If the output contains `exited (code=` or
`not healthy after`, print the last 40 lines and stop.

Then prove the setup from the command line:

```bash
curl -s http://127.0.0.1:5007/admin/seed/verify
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/
curl -sN -X POST http://127.0.0.1:8484/v1/interact \
  -H 'content-type: application/json' \
  -d '{"sessionId":"starter-check","input":{"type":"text","text":"Where did my money go last month?"}}'
```

Expected output (the A2UI messages are long; this shows the start of each line,
and the surface ID differs):

```
{"rows":180}
200
event: status
data: {"state":"thinking"}

event: status
data: {"state":"streaming"}

event: a2ui
data: {"version":"1.0","createSurface":{"surfaceId":"spending-a618ab08","catalogId":"https://a2ui.org/specifi...

event: a2ui
data: {"version":"1.0","updateComponents":{"surfaceId":"spending-a618ab08","components":[{"id":"root",...

event: a2ui
data: {"version":"1.0","updateDataModel":{"surfaceId":"spending-a618ab08","path":"/","value":{"title":"Where ...

event: done
data: {"surfaceIds":["spending-a618ab08"],"model":"scripted"}
```

Verify: `rows` is greater than 0, the status code is `200`, and the stream has
at least one `event: a2ui` line and ends with `event: done`. If any check fails,
retry once after 10 seconds. If it fails again, stop.

Then show it in the browser:

1. Open http://localhost:3001 for the user.
2. On the welcome screen, click "Try the demo". This opens a demo budget named
   "Test Budget" in the browser.
3. If a "Welcome to Actual!" tour message shows, close it.
4. Click "Assistant" in the sidebar.
5. The page shows "Ask about your budget" and these 5 suggested prompts:
   - Can I afford Japan in March?
   - Where did my money go last month?
   - Find subscriptions I forgot
   - Move $200 from dining to savings
   - Monthly check-in
6. Click "Where did my money go last month?".

Verify: within a few seconds, a card titled "Where your money went in September
2026" appears. It shows "Total spent $3,184.52" and rows for Rent, Groceries,
Dining Out, Transport, Subscriptions and Other, each with a "Details" button.
This card is an A2UI surface that the agent generated.

Note: the Assistant answers from the sidecar's seeded budget
(`A2UI-Demo-Budget`), not from the demo budget that is open in the browser. The
numbers on the card do not match the browser's budget. This is expected in this
version.

## Step 9: Switch to live mode (only with a key)

Skip this step if the user has no key. Go to "After setup".

Act:

1. Stop the scripted app: send Ctrl+C (SIGINT) to the `node a2ui/run.mjs`
   process. Wait for `[run] stopped`.
2. Start the live app: `node a2ui/run.mjs`. Wait for
   `[run] ready: open http://localhost:3001/ (agent mode: live). Press Ctrl+C to stop.`
3. Check that the agent runs in live mode: `curl -s http://127.0.0.1:8484/healthz`
   must contain `"mode":"live"`. `/healthz` does not show whether a key is
   set. A missing or wrong key shows up on the first prompt: the answer fails
   with the `invalid-key` error and the key drawer opens. The user can then
   paste the key in the drawer ("Add API key" on the Assistant page). The
   drawer key overrides `.env` per request; it stays in the browser's
   localStorage and goes only to the local agent.
4. Open http://localhost:3001/assistant for the user (click "Try the demo" first
   if the welcome screen shows).
5. Ask the user to send "Where did my money go last month?".

Verify: a generated card with the user's spending by category appears. The
status line shows "thinking" or "calling-tool" while the agent works.

Free-tier reality: on a free Gemini key, the first live answer can take 1 to 3
minutes. Tell the user this before they send the prompt. Do not restart the app
while the status line is active.

If an error says the key is invalid, the key drawer opens again. Ask the user to
check the key. If an error says `rate-limited`, wait 1 minute and send the
prompt again, at most twice. Scripted mode (`node a2ui/run.mjs --scripted`)
always works offline.

## After setup

Show the user the result (the card in the browser), not only "setup complete".
Then tell the user:

- Try the other 4 suggested prompts on the Assistant page.
- Stop the app: press Ctrl+C in the terminal that runs `node a2ui/run.mjs`. It
  stops all of its processes.
- Start it again: `node a2ui/run.mjs` (live) or `node a2ui/run.mjs --scripted`
  (offline), from `typescript-starter`.
- Check the setup at any time: `node a2ui/doctor.mjs`.
- Fresh demo data: stop the app, then run `npm run seed -- --reset` in
  `a2ui/sidecar`.
- The web client listens on all network interfaces, so other devices on the
  local network can reach port 3001. The sidecar and the agent listen on
  127.0.0.1 only.

### Optional: share one budget between the browser and the agent (sync mode)

Local mode (the steps above) stays the default. In local mode, the agent and the
browser use different budgets. Sync mode adds Actual's own sync server on port
5006, so the browser opens the same budget as the agent. Then the budget pages
show the agent's changes (for example, after a confirmed "Move $200 from dining
to savings").

Only offer this if the user asks for it, or after the proof in Step 8 passed.

Check: ports 3001, 5006, 5007 and 8484 are free:

```bash
lsof -nP -iTCP:3001 -iTCP:5006 -iTCP:5007 -iTCP:8484 -sTCP:LISTEN
```

Expected output: nothing. Stop a running `node a2ui/run.mjs` first (Ctrl+C).

Act:

```bash
node a2ui/run.mjs --sync
```

Add `--scripted` for canned answers without a key
(`node a2ui/run.mjs --scripted --sync`).

Verify: the output ends with lines like these (the password and the Sync ID
differ):

```
[run] sync healthy: http://127.0.0.1:5006/health (2.0s)
[run] sync server password set from a2ui/sync-data/password
[run] sidecar healthy: http://127.0.0.1:5007/healthz (3.1s)
[run] agent healthy: http://127.0.0.1:8484/healthz (3.2s)
[run] web healthy: http://localhost:3001/ (7.2s)
[run] no demo budget on the sync server yet; seeding it (once)
[run] seeded A2UI-Demo-Budget: 180 transactions
[run] ready: open http://localhost:3001/ (agent mode: scripted, sync: on). Press Ctrl+C to stop.
[run]   sync server:   http://localhost:5006
[run]   password:      f37gNjXjPLGwIBR0_lRv  (stored in a2ui/sync-data/password)
[run]   shared budget: A2UI-Demo-Budget (Sync ID 071cd129-965b-49d7-9bf7-a89de38cc777)
```

The first `--sync` run builds the sync server (a few seconds), generates the
password, and seeds the shared budget. Later runs reuse all three, so the
"password set" and "seeding" lines do not show again.

Then verify: `curl -s http://127.0.0.1:5007/healthz` shows `"mode":"sync"` and a
`syncId`.

The password is a local, generated password for the sync server on this machine.
Show it to the user so they can sign in. It is not the Gemini key.

In the browser (give these steps to the user):

1. Open http://localhost:3001. On the welcome screen, choose "Connect to a sync
   server" and enter `http://localhost:5006`. If a budget is already open, use
   the Files screen, then the server menu at the top right, then "Start using a
   server".
2. Sign in with the password from the output.
3. Open `A2UI-Demo-Budget` from the file list.

Verify: Settings → Show advanced settings → Sync ID in the browser equals the
`syncId` from the sidecar `/healthz`.

If `run.mjs` prints
`the sync server in a2ui/sync-data/data has a different password than a2ui/sync-data/password`,
the password file was changed or lost. Ask the user before you delete anything.
With a yes, stop the app, delete `a2ui/sync-data/data` and
`a2ui/sync-data/sidecar-data`, and run `node a2ui/run.mjs --sync` again. The
browser must then sign in again and open the new budget.

## If something fails

Stop at the first verify that you cannot make pass within its retry budget. Do
not improvise a workaround. Report to the user in this format:

```
A2UI starter setup failed
Step: <number and name>
Command: <the exact command>
Output: <the full output of the failing check, with any key removed>
Retries used: <n of budget>
Toolchain: node <v>, git <v>, python <v>, corepack <v>, OS <name and version>
Doctor: <output of node a2ui/doctor.mjs, if the repo exists>
```

Then point the user to https://a2ui.org/quickstart/#troubleshooting and
https://github.com/a2ui-project/a2ui/issues. Do not hand-roll protocol code and
do not patch SDK internals to get past a failure. Report what you found.

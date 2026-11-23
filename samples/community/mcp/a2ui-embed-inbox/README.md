# Inbox decisions (`@a2ui/embed` prototype)

Internal proof of concept for [`@a2ui/embed`](../../../../typescript/embed/README.md). Not published, not for production.

An inbox assistant as an MCP App. The agent reads a demo mailbox, prepares every email decision that needs the person, and shows them in one card: each decision has the agent's pick pre-selected, a one-line reason and what happens if it's applied. The person approves, tweaks or overrides each one and confirms once. The point is decision throughput: a dozen decisions in a few minutes, with the agent doing the reading.

The mailbox is synthetic and shaped like Gmail and Calendar data (threads, labels, headers, schema.org markup for bills and trips, calendar invites, contacts, payees and per-sender open rates), so it could be wired to the real APIs later. Nothing is ever sent.

## What the card shows

One card, at most about 700 px tall, with a header ("12 emails need you · my picks are pre-selected · about 3 min"), tabs by group with counts, compact rows and an "Apply 12 decisions" button that opens a confirm step.

| Group    | Decision type      | Controls                                                                                                  | Example pick                                                            |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Reply    | Reply needed       | Send reply / Remind me tomorrow / No reply needed; "Edit reply" opens the draft with tone chips           | Send: answers Mom with the flight time from the trip confirmation email |
| Reply    | Scheduling request | Offer these times / Not now, plus free slots from next week's calendar as chips; the reply uses the picks | Offer Tue 10:00 AM and Wed 3:00 PM                                      |
| Calendar | Invite             | Accept / Maybe / Decline; the conflict in the row; a note to the organizer in Details                     | Decline: overlaps your dentist appointment; suggest Thursday            |
| Money    | Bill               | Pay now / Pay on the due date / Question it; amount, due date and change vs the last bill                 | Pay on Dec 1: 12% higher than October, worth a check                    |
| Money    | Shared expense     | Pay / Ask for details / Decline; the split and the matching calendar event                                | Pay $42.50: matches the dinner with Alex on Nov 18                      |
| Clean up | Newsletter, promo  | Unsubscribe / Archive all from them / Keep; open rate and evidence                                        | Unsubscribe: opened 0 of the last 12                                    |
| Review   | Security           | Report phishing / It's safe; red flags in Details. Never pay, sign in or open a link                      | Report: the sender's domain isn't the bank's                            |
| Review   | Document to sign   | Open to sign / Remind me Monday / Already done                                                            | Remind me Monday: due Dec 3                                             |

The recommended chip carries a star. "Details" (or "Edit reply") opens a dialog with the email as markdown (links and images removed), the evidence, the type's extra controls and "Why this pick? Ask in chat". Applying turns each row into a done row with a check and "Undo". Only groups and controls that exist in this mailbox are composed; a `focus` call shows one group without tabs.

## How it works

- `src/decisions/select.ts` picks the emails that need a decision with deterministic rules over labels, senders, headers and markup, so the demo is stable. 12 of the 30 threads qualify; receipts, confirmations, newsletters the person reads and answered threads stay out.
- `src/ai/recommend.ts` asks Gemini (`gemini-flash-latest`, JSON, thinking budget 1024) for every decision in one call: the pick among the server's options, the reason, the consequence, reply drafts, slots and invite notes. A tool call waits at most 32 s; a slower answer still fills a per-decision cache, so "Refresh" picks it up. Without a key, on errors or for any invalid item, `src/decisions/fallback.ts` gives a rule-based pick, so the card always renders.
- `src/compose/card.ts` builds the card per call; `src/decisions/plan.ts` builds the confirm summary ("Send 2 replies, decline 1 invite, schedule $84.20 on Dec 1, ...") and the plan key that ties the confirmation to what was previewed; `src/mail/store.ts` applies decisions to the in-memory mailbox and undoes them.
- The card's data model is shared with the model (`sendDataModel`): `c` holds the person's choices, drafts, notes and times by decision key, `d` what the card shows.

## Tools, actions and follow-ups

| Kind      | Name                      | What it does                                                                                  |
| --------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| Tool      | `inbox_decisions(focus?)` | The card, and a text summary of every decision with its pick, reason and other choices.       |
| Action    | `apply_decisions`         | `preview` shows the confirm step, `confirm` applies (checked against the plan key), `cancel`. |
| Action    | `undo`                    | Takes back one applied decision.                                                              |
| Action    | `refresh`                 | Rebuilds the card from the current mailbox.                                                   |
| Action    | `regenerate_draft`        | Rewrites a draft shorter, warmer or more formal, in place (Gemini, else simple rules).        |
| Action    | `open_details`            | The Details button's event; nothing to do on the server.                                      |
| Follow-up | `why_recommend`           | `Why do you recommend "Decline" for "Q1 planning offsite"?`                                   |
| Follow-up | `rewrite_reply`           | `Rewrite my reply to "Sam Rivera" to be "more formal".`                                       |

Only `inbox_decisions` is visible to the model; `a2ui_action` is visible to the app only.

## Safety

- Email text is untrusted. It only reaches the card through the data model (never in component properties), with links, images and HTML removed, and only reaches Gemini inside `<untrusted_email>` tags it can't close (angle brackets become look-alikes). The system prompt says the content is data, not instructions.
- The server defines every option; the model can only pick one. A pick of "It's safe" for an email the rules flag as phishing is replaced by "Report phishing".
- Drafts are suggestions. Nothing is applied without the confirm step, and the mailbox is a demo.

## Run it

```sh
# From the repository root: install and build the library packages.
yarn install
yarn workspace @a2ui/embed run build

# From samples/community:
yarn install
cd mcp/a2ui-embed-inbox
echo "GEMINI_API_KEY=..." > .env   # Optional: without it, picks come from simple rules.
yarn build
yarn test
yarn e2e                           # Screenshots and report in /tmp/a2ui-embed-inbox-e2e
```

To try it in an MCP host, run `node --preserve-symlinks dist/server.js` over stdio. `INBOX_ENV_FILE`, `INBOX_APP_HTML` and `INBOX_FIXTURE` override the `.env`, app HTML and mailbox paths, which helps when the host starts the server in another directory.

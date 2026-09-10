# Draft replies — PR #2538

Threads 1, 3 and 4 are answered and outdated. These are the four still open.

---

## Why not reuse `processMessages` for validation?

https://github.com/a2ui-project/a2ui/pull/2538#discussion_r3973746777 (blueprint:463) and https://github.com/a2ui-project/a2ui/pull/2538#discussion_r3973892318 (processor.dart:172)

> Why not reusing the `processMessages` method? We can leverage the surface state to do more checks, like parent-child references. State can be updated internally on the agent side.

Agreed on the direction, and `validatePayload` is gone: the agent keeps a processor for the session and checks its own output through `processMessages`, exactly as a renderer checks what it receives.

Two things came out of doing it. `processMessages` never required a root or rejected an unreachable component (`requireRoot: false, allowOrphans: true`), correctly, since either may be settled by a later message — so completeness is now an explicit `checkSurfaceComplete(surfaceId)`, which an agent runs over the surfaces its turn built.

The second is a real bug this surfaced: `processMessages` checks each batch against what the surface already holds plus the batch itself, so a forward reference inside one payload reads as dangling. That rejects our own published `00_incremental.json`, where `root` points at `restaurant_card` one message before it is declared. `validatePayload` never hit it because it merged the payload per surface first. I am moving reference resolution out of the per-batch check and into `checkSurfaceComplete`; duplicate ids and cycles stay per batch.

---

## When would we call `processPayload`?

https://github.com/a2ui-project/a2ui/pull/2538#discussion_r3973890171 (processor.dart:147)

Whenever the caller has raw JSON rather than typed messages, which is the renderer's normal case: the payload arrives over the wire and has to be parsed before anything can be routed. It is now just `processMessages(A2uiMessage.parseAll(payload))`, kept because that pairing is the common one and the version check belongs with it.

Happy to drop it and let callers write the two calls, if you would rather have one entry point.

---

## Why a static `parseMessages` on the validator?

https://github.com/a2ui-project/a2ui/pull/2538#discussion_r3962381565 (blueprint:495)

> It also feels weird for a validator to parse messages.

Agreed, and it has moved to `A2uiMessage.parseAll(payload, protocolVersion:)`. `A2uiMessage.fromJson` already existed and already parsed the version, so turning a list of envelopes into messages is the message model's job and the validator no longer parses anything.

It cannot live only in the agent SDK's `Parser`, though: a renderer receives raw payloads over the wire with no agent SDK present, which is what `processPayload` is for. Keeping it on the message model serves both sides.

---

## Status

Implemented on the branch: `A2uiMessage.parseAll`; `validatePayload`, `validateStructure` and `validateCatalogs` removed; `checkSurfaceComplete` added; `payload_structure.dart` deleted, since the payload-wide walk was its only caller.

Still in progress: moving reference resolution from the per-batch check into `checkSurfaceComplete`, and the test and blueprint updates that follow. `dart analyze` is clean; 13 tests still fail, all of them the forward-reference case above.

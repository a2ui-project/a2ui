# A2UI Standard Triage Replies

Canonical replies the team has agreed on for recurring triage cases. Check this list
**before** drafting a new response.

## How to use these replies

1. **Match first.** If the issue or PR fits one of the cases below, use that reply.
2. **Verbatim by default.** Post the reply as written when the case matches cleanly. These
   texts encode team policy and agreed tone, so do not rewrite them for style — the
   [natural-writing](../../natural-writing/SKILL.md) guidance applies to replies you draft
   yourself, not to these.
3. **Modify only when the case needs it.** Fill in every placeholder (`<link to new PR>`,
   canonical issue number, the specific missing detail), and add at most one or two
   sentences of issue-specific context. Keep the policy sentences intact.
4. **Apply the paired triage fields.** Each case lists the priority and action that go with
   it, so the reply and the labels stay consistent.
5. **Fall back deliberately.** If no case matches, draft a reply following the response
   guidelines in [triage_criteria.md](triage_criteria.md), and say in your summary that no
   standard reply applied.

---

## Issues

### Weekly A2UI Compliance Report

**Case**: AI-generated compliance report issues, such as
[Weekly A2UI Compliance Report](https://github.com/a2ui-project/a2ui/issues/2025).

**Triage**: priority `P3`, action `investigate` (keeps the issue open).

> As agreed, this has been assigned a P3 priority. Once the current triage queue is cleared,
> we will begin reviewing AI-generated issues.

### Assigned issue without a priority

**Case**: The issue already has an assignee but no priority label, so it sits in the triage
queue with nothing else to decide.

**Triage**: priority `P2`, action `assign_and_fix`, keeping the existing assignee.

> I assigned a P2 priority to move this out of the triage queue. Please adjust the priority
> if needed to better reflect the issue's status.

---

## Pull requests

These cases are handled by the oncall engineer directly. The dashboard and apply script
cover issues only, so the actions below are performed by hand.

### Superseded PR

**Case**: A valid contribution that has gone stale and was replaced by a newer PR carrying
the original commit.

**Triage**: close the PR, linking the superseding one.

> Thank you for your contribution! We apologize that this PR has become outdated. To
> expedite the process, I created a superseding PR based on your analysis and changes. Your
> original commit is included to ensure your contribution is properly recorded.
> `<link to new PR>`

### Complex PR without an associated issue

**Case**: A complex PR that does not address a prioritized issue, or whose author is not the
assignee of that issue. Straightforward and minor PRs are exempt.

**Triage**: close the PR.

> To optimize our team's limited resources, our policy is to prioritize the review of PRs
> that address an issue, prioritized by the team and assigned to the PR author, unless the
> PR is straightforward and minor. While we appreciate your intent to help and your
> contribution, we must decline this PR at this time.

### PR outside the project's scope

**Case**: The change targets functionality the maintenance team cannot support long-term.

**Triage**: close the PR.

> Thank you for your contribution to the A2UI ecosystem! Unfortunately, we must decline this
> PR as the scope of this repository is restricted to features the maintenance team can
> support long-term. We encourage you to find a more suitable repository for this code or to
> consider launching your own repository to support this segment of the A2UI ecosystem.

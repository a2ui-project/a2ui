/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Reconciles the 'status: needs-triage' and 'status:
// waiting-for-author-response' labels across all open issues and PRs.
//
// For detailed rules and documentation on how the triage automation works, see:
// https://github.com/a2ui-project/a2ui/blob/main/docs/contributing/triage.md#how-the-automated-triage-bot-works
//
// Implementation notes:
// - Items are selected by query, but the query alone is not trusted: GitHub's
//   search index can lag behind reality. Before changing any label, the script
//   re-reads the item and confirms it still matches.

export const WAITING_LABEL = 'status: waiting-for-author-response';
export const FLAG_LABEL = 'status: needs-triage';
export const PRIORITY_LABELS = ['P0', 'P1', 'P2', 'P3', 'P4'];

// Priorities urgent enough that an unassigned issue is flagged immediately
// (rule 2b). Every entry must be one of PRIORITY_LABELS.
export const ASSIGNEE_REQUIRED_PRIORITIES = new Set(['P0', 'P1']);

// Days of inactivity before a prioritized issue is considered stale (rule 2c).
// Keys must be a subset of PRIORITY_LABELS; priorities absent here are never
// flagged for staleness.
export const STALE_DAYS = {P0: 1, P1: 30};

const DAY_MS = 24 * 60 * 60 * 1000;

// Author associations that count as an internal maintainer response.
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// A deleted account surfaces as a null `user`; treat that as a human so their
// past contributions still count, rather than silently classifying them as a bot.
export const isBot = user =>
  Boolean(user) && (user.type === 'Bot' || /\[bot\]$/.test(user.login || ''));

const labelNames = item =>
  (item.labels || []).map(label => (typeof label === 'string' ? label : label.name));

const ageInDays = (isoTimestamp, now) => (now - new Date(isoTimestamp).getTime()) / DAY_MS;

/**
 * Returns the most recent human contribution to an item: either its newest
 * non-bot contribution (a comment, or — on PRs — a review or inline review
 * comment), or, if there are none, the opening post itself. Used both to measure
 * staleness and to decide whether an external author is still awaiting a
 * maintainer response.
 *
 * `contributions` is the merged, normalized event list from `fetchContributions`.
 * On PRs it comes from three different endpoints so it is not sorted; the scan
 * picks the latest regardless of order.
 */
export function lastHumanContribution(item, contributions) {
  let latest = {
    createdAt: item.created_at,
    association: item.author_association,
    user: item.user,
  };

  for (const event of contributions) {
    if (isBot(event.user)) continue;
    if (event.createdAt >= latest.createdAt) {
      latest = event;
    }
  }

  return latest;
}

/**
 * True when the request WAITING_LABEL is tracking has been answered: an external
 * contributor — the item's author or anyone else outside the team — contributed
 * at least once at or after `waitingSince`, the moment the label was added. Used
 * to clear the label.
 *
 * Maintainer contributions never count: the team asked the question, so its own
 * follow-ups do not answer it. Neither do contributions from before the label
 * went on — the opening post predates it, so an item with no replies is exactly
 * the one still waiting.
 *
 * `waitingSince` is null when the labeling could not be read — see
 * `waitingLabelAddedAt`. The label is then left for a human to clear rather than
 * guessed at.
 */
export function externalHasResponded(contributions, waitingSince) {
  if (!waitingSince) return false;
  return contributions.some(
    event =>
      event.createdAt >= waitingSince &&
      !MAINTAINER_ASSOCIATIONS.has(event.association) &&
      !isBot(event.user),
  );
}

/**
 * Returns a human-readable reason why a single open item should carry the flag
 * label, or null if it should not. The reason is logged for visibility.
 */
export function flagReason(item, contributions, now) {
  const labels = labelNames(item);
  const isPR = Boolean(item.pull_request);
  const assigneeCount = item.assignees?.length ?? 0;

  // Rule 1: items the automation stays out of altogether.

  // 1a. A parked item is off the triage queue entirely, whatever the rules
  // below would say.
  if (labels.includes(WAITING_LABEL)) {
    return null;
  }

  // 1b. An assigned issue already has a team member on it, so there is nothing
  // to triage. PRs are excluded: an assignee there is the reviewer, and rule 3
  // is precisely about the reviewer having gone quiet on the author.
  if (!isPR && assigneeCount > 0) {
    return null;
  }

  const latest = lastHumanContribution(item, contributions);

  // True when the most recent human contribution is from outside the team — no
  // internal member has commented after the external author's last word.
  const awaitingMember = !MAINTAINER_ASSOCIATIONS.has(latest.association) && !isBot(latest.user);

  // Rule 3: PRs. Only external contributors' PRs are watched; maintainers
  // manage their own, so an internally-authored PR is never flagged. There is
  // no grace period: a PR counts as needing triage from the moment the author
  // has the last word, opening it included.
  if (isPR) {
    if (MAINTAINER_ASSOCIATIONS.has(item.author_association)) {
      return null;
    }
    return awaitingMember ? 'no maintainer has responded to the author.' : null;
  }

  // Rule 2: issues. Rule 1b means every issue reaching here is unassigned; the
  // rules below still state their own conditions rather than lean on that.

  const priority = PRIORITY_LABELS.find(p => labels.includes(p));

  // 2a. No priority assigned yet.
  if (!priority) {
    return 'this issue has no priority label yet.';
  }

  // 2b. Urgent work with nobody on it.
  if (ASSIGNEE_REQUIRED_PRIORITIES.has(priority) && assigneeCount === 0) {
    return `this ${priority} issue has no assignee.`;
  }

  // 2c. Prioritized but stale beyond its threshold.
  const threshold = STALE_DAYS[priority];
  if (threshold !== undefined && ageInDays(latest.createdAt, now) > threshold) {
    const unit = threshold === 1 ? 'day' : 'days';
    return `this ${priority} issue has had no human activity for more than ${threshold} ${unit}.`;
  }

  // 2d. The last word on the issue is an external one. Like rule 3, this
  // carries no grace period: it fires as soon as the comment lands.
  if (awaitingMember) {
    return 'the latest contribution is from an external contributor and has gone unanswered.';
  }

  return null;
}

// Max concurrent API calls per phase. Keeps us fast without tripping GitHub's
// secondary (abuse) rate limits, which a single huge Promise.all can hit.
const BATCH_SIZE = 10;

/**
 * Maps `items` through async `fn` in concurrent batches of `BATCH_SIZE` rather
 * than all at once, bounding the number of in-flight requests.
 */
async function mapInBatches(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

// Normalizes the different GitHub contribution shapes into a common
// `{createdAt, association, user}` event. Reviews stamp their submission time in
// `submitted_at`; issue and inline review comments use `created_at`.
const toEvent = contribution => ({
  createdAt: contribution.created_at || contribution.submitted_at,
  association: contribution.author_association,
  user: contribution.user,
});

/**
 * Gathers every human-visible contribution to an item as a flat list of
 * normalized events. For issues that is just the top-level comments. PRs also
 * accrue formal reviews and inline review comments, which live on separate
 * endpoints: a maintainer often responds by submitting a review or leaving
 * inline comments without a separate top-level comment, so considering only
 * issue comments would wrongly treat the PR as unanswered. A failure for one
 * source must not abort the whole run, so errors fall back to an empty list for
 * that source.
 */
async function fetchContributions({github, owner, repo}, item) {
  const number = item.number;

  const fetchAll = async (label, endpoint, params) => {
    try {
      return await github.paginate(endpoint, {owner, repo, per_page: 100, ...params});
    } catch (error) {
      console.error(`Failed to fetch ${label} for #${number}:`, error);
      return [];
    }
  };

  // Fetch all three sources concurrently to minimize network round-trips. The
  // issue-comment count is on the list item, so skip that call when it is zero;
  // reviews and inline review comments only exist on PRs and have no count hint,
  // so they are always fetched for PRs.
  const [issueComments, reviews, reviewComments] = await Promise.all([
    item.comments
      ? fetchAll('comments', github.rest.issues.listComments, {issue_number: number})
      : [],
    item.pull_request
      ? fetchAll('reviews', github.rest.pulls.listReviews, {pull_number: number})
      : [],
    item.pull_request
      ? fetchAll('review comments', github.rest.pulls.listReviewComments, {pull_number: number})
      : [],
  ]);

  return [...issueComments, ...reviews, ...reviewComments].map(toEvent);
}

/**
 * Returns when WAITING_LABEL was most recently added to an item, or null when
 * that cannot be established — the event fetch failed, or the item's history has
 * no record of the label going on. Callers must read null as "leave the label
 * alone": with no start of the waiting period there is nothing to measure a
 * response against.
 *
 * Only the newest labeling counts. An item can be parked, answered, and parked
 * again, and each round has to be answered on its own; the reply that cleared the
 * first round must not clear the second.
 */
async function waitingLabelAddedAt({github, owner, repo}, item) {
  let addedAt = null;
  try {
    const events = await github.paginate(github.rest.issues.listEvents, {
      owner,
      repo,
      issue_number: item.number,
      per_page: 100,
    });
    for (const event of events) {
      if (event.event !== 'labeled' || event.label?.name !== WAITING_LABEL) continue;
      if (!addedAt || event.created_at > addedAt) {
        addedAt = event.created_at;
      }
    }
  } catch (error) {
    console.error(`Failed to fetch label events for #${item.number}:`, error);
    return null;
  }

  if (!addedAt) {
    console.log(`No '${WAITING_LABEL}' labeling recorded on ${item.html_url}; keeping the label.`);
  }
  return addedAt;
}

export default async function issueTriage({github, context}) {
  console.log('A2UI triage-flag reconciliation started');

  const {owner, repo} = context.repo;
  const now = Date.now();

  // `listForRepo` returns both issues and PRs; PRs carry a `pull_request` key.
  const openItems = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });

  // Fetch each item's contributions in bounded concurrent batches to avoid a
  // slow serial loop without flooding the API. The label's event history is only
  // needed for the items actually parked, so it costs an extra call on those
  // alone.
  const itemsWithContributions = await mapInBatches(openItems, async item => {
    const client = {github, owner, repo};
    const [contributions, waitingSince] = await Promise.all([
      fetchContributions(client, item),
      labelNames(item).includes(WAITING_LABEL) ? waitingLabelAddedAt(client, item) : null,
    ]);
    return {item, contributions, waitingSince};
  });

  // Decide each item's desired state from the snapshot, and keep only those
  // whose labels need to change. The snapshot from `listForRepo` can be stale —
  // another run (the daily schedule overlapping an issue event) may have changed
  // a label, and GitHub's index can still list an item that is already closed —
  // so the mutation below re-reads each item and decides again on live data.
  // Contributions are carried along for that second pass.
  const itemsToUpdate = itemsWithContributions
    .map(({item, contributions, waitingSince}) => {
      const labels = labelNames(item);
      const clearWaiting =
        labels.includes(WAITING_LABEL) && externalHasResponded(contributions, waitingSince);

      // Score the item as it will look once the waiting label is gone: a label
      // this run clears must not also inhibit flagging until the next run.
      const scored = clearWaiting
        ? {...item, labels: labels.filter(label => label !== WAITING_LABEL)}
        : item;

      // Retain contributions so the mutation step can recompute the
      // desired flag state from the live issue snapshot (avoids flip-flops).
      return {
        item,
        contributions,
        clearWaiting,
        reason: flagReason(scored, contributions, now),
      };
    })
    .filter(
      ({item, clearWaiting, reason}) =>
        clearWaiting || Boolean(reason) !== labelNames(item).includes(FLAG_LABEL),
    );

  let added = 0;
  let removed = 0;
  let waitingCleared = 0;

  await mapInBatches(itemsToUpdate, async ({item, contributions, clearWaiting, reason}) => {
    const target = {owner, repo, issue_number: item.number};
    try {
      // Re-read the item so every decision below rests on live data rather than
      // on the listing, which a concurrent run or a lagging index can outdate.
      const {data: fresh} = await github.rest.issues.get(target);

      // Confirm it still matches the query it came from. An item the index
      // reported as open may already be closed, and a closed item is nobody's
      // triage work.
      if (fresh.state !== 'open') {
        console.log(`Skipped ${item.html_url} — no longer open.`);
        return;
      }

      const freshLabels = labelNames(fresh);

      // Check the waiting label against the live labels too. Contributions are
      // not re-fetched, so whether an external contributor has responded is
      // unchanged from the snapshot.
      const clearWaitingNow = clearWaiting && freshLabels.includes(WAITING_LABEL);

      if (clearWaitingNow) {
        await github.rest.issues.removeLabel({...target, name: WAITING_LABEL});
        waitingCleared += 1;
        console.log(
          `Cleared ${WAITING_LABEL} on ${item.html_url} — an external contributor responded.`,
        );
      }

      // Recompute desired flag state from the fresh issue snapshot (with the
      // waiting label removed if we just cleared it) to avoid flip-flopping when
      // runs overlap.
      const scoredFresh = clearWaitingNow
        ? {...fresh, labels: freshLabels.filter(l => l !== WAITING_LABEL)}
        : fresh;
      const freshReason = flagReason(scoredFresh, contributions, now);
      const wantsFlag = Boolean(freshReason);

      if (wantsFlag === freshLabels.includes(FLAG_LABEL)) {
        return; // Another run already reconciled the flag or no change needed.
      }

      if (wantsFlag) {
        await github.rest.issues.addLabels({...target, labels: [FLAG_LABEL]});
        added += 1;
        console.log(`Flagged ${item.html_url} — ${freshReason}`);
      } else {
        await github.rest.issues.removeLabel({...target, name: FLAG_LABEL});
        removed += 1;
        console.log(`Unflagged ${item.html_url} — no longer matches any triage rule.`);
      }
    } catch (error) {
      console.error(`Failed to update #${item.number}:`, error);
    }
  });

  console.log(
    `A2UI triage-flag reconciliation completed: ${openItems.length} items, ` +
      `+${added} / -${removed} '${FLAG_LABEL}', -${waitingCleared} '${WAITING_LABEL}'`,
  );
}

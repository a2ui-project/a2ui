/*
 * Copyright 2026 Google LLC
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

// Reconciles the 'status: needs-triage' label across all open issues and PRs. The label
// is fully owned by this automation: it is added to every item that matches a
// rule below and removed from every item that does not, on each run.
//
// An item is flagged when:
//   1. It is an issue without 'status: waiting-for-user-response' that is:
//      a. without a priority label, or
//      b. P0/P1 without an assignee, or
//      c. P0 and stale for more than 1 day, or
//      d. P1 and stale for more than 30 days, or
//      e. P2 and stale for more than 90 days.
//   2. It is a stale PR opened by an external contributor (PRs from
//      maintainers are managed by their authors).
//   3. It is an issue whose latest human comment is from an external author
//      and has gone unanswered for more than 1 day.
//
// "Stale" is measured from the last human contribution (a comment, or — on PRs —
// a review or inline review comment, or the opening post if there are none)
// rather than `updated_at`, so the bot's own label edits never reset the clock.
// A PR is "stale" when no internal member has responded after the external
// author's last contribution for more than a day.
//
// Flagged issues and PRs:
// https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20label%3A%22status%3A%20needs-triage%22
//
// The job prints to console what items are flagged/unflagged and why. To see the
// history of runs see:
// https://github.com/a2ui-project/a2ui/actions/workflows/triage.yml

export const WAITING_LABEL = 'status: waiting-for-user-response';
export const FLAG_LABEL = 'status: needs-triage';
export const PRIORITY_LABELS = ['P0', 'P1', 'P2', 'P3', 'P4'];

// Priorities urgent enough that an unassigned issue is flagged immediately
// (rule 1b). Every entry must be one of PRIORITY_LABELS.
export const ASSIGNEE_REQUIRED_PRIORITIES = new Set(['P0', 'P1']);

// Days of inactivity before a prioritized issue / PR is considered stale
// (rules 1c-e). Keys must be a subset of PRIORITY_LABELS; priorities absent
// here are never flagged for staleness.
export const STALE_DAYS = {P0: 1, P1: 30, P2: 90};
export const PR_STALE_DAYS = 1;
export const EXTERNAL_RESPONSE_DAYS = 1;

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
 * Returns a human-readable reason why a single open item should carry the flag
 * label, or null if it should not. The reason is logged for visibility.
 */
export function flagReason(item, contributions, now) {
  const isPR = Boolean(item.pull_request);
  const labels = labelNames(item);
  const latest = lastHumanContribution(item, contributions);
  const staleDays = ageInDays(latest.createdAt, now);

  // True when the most recent human contribution is from outside the team — no
  // internal member has commented after the external author's last word.
  const awaitingMember = !MAINTAINER_ASSOCIATIONS.has(latest.association) && !isBot(latest.user);

  // Rule 2: PRs. Only external contributors' PRs are watched; maintainers
  // manage their own, so an internally-authored PR is never flagged. A PR is
  // "stale" when no internal member has commented after the external author's
  // last comment for more than a day.
  if (isPR) {
    if (MAINTAINER_ASSOCIATIONS.has(item.author_association)) {
      return null;
    }
    return awaitingMember && staleDays > PR_STALE_DAYS
      ? `no maintainer has responded to the author for more than ${PR_STALE_DAYS} day.`
      : null;
  }

  // Rule 3: an external author's latest comment has gone unanswered too long.
  if (awaitingMember && staleDays > EXTERNAL_RESPONSE_DAYS) {
    return `the latest reply is from an external contributor and has gone unanswered for more than ${EXTERNAL_RESPONSE_DAYS} day.`;
  }

  // Rule 1: issues, excluding those parked on the user's response.
  if (labels.includes(WAITING_LABEL)) {
    return null;
  }

  const priority = PRIORITY_LABELS.find(p => labels.includes(p));

  // 1a. No priority assigned yet.
  if (!priority) {
    return 'this issue has no priority label yet.';
  }

  // 1b. Urgent work with nobody on it.
  if (ASSIGNEE_REQUIRED_PRIORITIES.has(priority) && (item.assignees?.length ?? 0) === 0) {
    return `this ${priority} issue has no assignee.`;
  }

  // 1c-e. Prioritized but stale beyond its threshold.
  const threshold = STALE_DAYS[priority];
  if (threshold !== undefined && staleDays > threshold) {
    const unit = threshold === 1 ? 'day' : 'days';
    return `this ${priority} issue has had no human activity for more than ${threshold} ${unit}.`;
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
  // slow serial loop without flooding the API.
  const itemsWithContributions = await mapInBatches(openItems, async item => ({
    item,
    contributions: await fetchContributions({github, owner, repo}, item),
  }));

  // Decide each item's desired state from the snapshot, and keep only those
  // whose label needs to change. The snapshot from `listForRepo` can be stale
  // if another run (the daily schedule overlapping an issue event) already
  // changed the label, so the actual mutation re-checks the live state below.
  const itemsToUpdate = itemsWithContributions
    .map(({item, contributions}) => ({item, reason: flagReason(item, contributions, now)}))
    .filter(({item, reason}) => Boolean(reason) !== labelNames(item).includes(FLAG_LABEL));

  let added = 0;
  let removed = 0;

  await mapInBatches(itemsToUpdate, async ({item, reason}) => {
    const wantsFlag = Boolean(reason);
    try {
      // Re-read the live labels so a concurrent run cannot make us add the
      // label twice.
      const {data: fresh} = await github.rest.issues.get({
        owner,
        repo,
        issue_number: item.number,
      });
      const hasFlag = labelNames(fresh).includes(FLAG_LABEL);
      if (wantsFlag === hasFlag) {
        return; // Another run already reconciled this item.
      }

      if (wantsFlag) {
        await github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: item.number,
          labels: [FLAG_LABEL],
        });
        added += 1;
        console.log(`Flagged ${item.html_url} — ${reason}`);
      } else {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: item.number,
          name: FLAG_LABEL,
        });
        removed += 1;
        console.log(`Unflagged ${item.html_url} — no longer matches any triage rule.`);
      }
    } catch (error) {
      console.error(`Failed to update #${item.number}:`, error);
    }
  });

  console.log(
    `A2UI triage-flag reconciliation completed: ` +
      `${openItems.length} items, +${added} / -${removed} label changes`,
  );
}

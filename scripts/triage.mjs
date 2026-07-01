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

// Reconciles the 'triage: flag' label across all open issues and PRs. The label
// is fully owned by this automation: it is added to every item that matches a
// rule below and removed from every item that does not, on each run.
//
// An item is flagged when:
//   1. It is an issue without 'triage: waiting-for-user-response' that is:
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
// "Stale" is measured from the last human contribution (a comment, or the
// opening post if there are no human comments) rather than `updated_at`, so the
// bot's own label edits never reset the clock. A PR is "stale" when no internal
// member has commented after the external author's last comment for more than a
// day.
//
// Flagged issues and PRs:
// https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20label%3A%22triage%3A%20flag%22
//
// The job prints to console what items are flagged/unflagged and why. To see the
// history of runs see:
// https://github.com/a2ui-project/a2ui/actions/workflows/triage.yml

const FLAG_LABEL = 'triage: flag'; // TODO(polina-c): align on better name and change it
const WAITING_LABEL = 'triage: waiting-for-user-response';
const PRIORITY_LABELS = ['P0', 'P1', 'P2', 'P3', 'P4'];

// Days of inactivity before a prioritized issue / PR is considered stale.
const STALE_DAYS = {P0: 1, P1: 30, P2: 90};
const PR_STALE_DAYS = 1;
const EXTERNAL_RESPONSE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

// Author associations that count as an internal maintainer response.
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const isBot = user => !user || user.type === 'Bot' || /\[bot\]$/.test(user.login || '');

const labelNames = item =>
  (item.labels || []).map(label => (typeof label === 'string' ? label : label.name));

const ageInDays = (isoTimestamp, now) => (now - new Date(isoTimestamp).getTime()) / DAY_MS;

/**
 * Returns the most recent human contribution to an item: either its newest
 * non-bot comment, or — if there are none — the opening post itself. Used both
 * to measure staleness and to decide whether an external author is still
 * awaiting a maintainer response.
 */
export function lastHumanContribution(item, comments) {
  let latest = {
    createdAt: item.created_at,
    association: item.author_association,
    user: item.user,
  };

  for (const comment of comments) {
    if (isBot(comment.user)) continue;
    if (new Date(comment.created_at) >= new Date(latest.createdAt)) {
      latest = {
        createdAt: comment.created_at,
        association: comment.author_association,
        user: comment.user,
      };
    }
  }

  return latest;
}

/**
 * Returns a human-readable reason why a single open item should carry the flag
 * label, or null if it should not. The reason is logged for visibility.
 */
export function flagReason(item, comments, now) {
  const isPR = Boolean(item.pull_request);
  const labels = labelNames(item);
  const latest = lastHumanContribution(item, comments);
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
  if ((priority === 'P0' || priority === 'P1') && (item.assignees?.length ?? 0) === 0) {
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

/**
 * Fetches the comments needed to evaluate an item. We only need the most recent
 * human contribution, so we skip the API call entirely when the item has no
 * comments and otherwise fetch a single page of the newest comments (sorted
 * descending) rather than paginating through the whole history. A failure for
 * one item must not abort the whole run, so errors fall back to no comments.
 */
async function fetchComments({github, owner, repo}, item) {
  if (!item.comments) {
    return [];
  }
  try {
    const {data} = await github.rest.issues.listComments({
      owner,
      repo,
      issue_number: item.number,
      sort: 'created',
      direction: 'desc',
      per_page: 100,
    });
    return data;
  } catch (error) {
    console.error(`Failed to fetch comments for #${item.number}:`, error);
    return [];
  }
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

  // Fetch comments in bounded concurrent batches to avoid a slow serial loop
  // without flooding the API.
  const itemsWithComments = await mapInBatches(openItems, async item => ({
    item,
    comments: await fetchComments({github, owner, repo}, item),
  }));

  // Decide each item's desired state from the snapshot, and keep only those
  // whose label needs to change. The snapshot from `listForRepo` can be stale
  // if another run (the daily schedule overlapping an issue event) already
  // changed the label, so the actual mutation re-checks the live state below.
  const itemsToUpdate = itemsWithComments
    .map(({item, comments}) => ({item, reason: flagReason(item, comments, now)}))
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

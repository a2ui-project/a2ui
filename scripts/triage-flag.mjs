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

// Scans every open issue and pull request and keeps the `triage-flag` label in
// sync with the triage rules below. The label is fully owned by this
// automation: items that match a rule get the label, items that no longer match
// have it removed. See triage_flag.yml for the human-readable rule list.

const TRIAGE_FLAG = 'triage-flag';
const WAITING_LABEL = 'waiting-for-user-response';
const PRIORITY_LABELS = ['P0', 'P1', 'P2', 'P3', 'P4'];

// Staleness thresholds, in days, per priority / item type.
const P0_STALE_DAYS = 3;
const P1_STALE_DAYS = 30;
const P2_STALE_DAYS = 90;
const PR_STALE_DAYS = 30; // "more than a month"
// How long an unanswered external comment may sit before it needs triage.
const COMMENT_RESPONSE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

// GitHub `author_association` values that count as the maintainer side of the
// conversation. Anyone else (CONTRIBUTOR, NONE, FIRST_TIME_CONTRIBUTOR, ...) is
// treated as "external" for the unanswered-comment rule.
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export default async function triageFlag({github, context, core}) {
  const log = core || console;
  const {owner, repo} = context.repo;
  const now = Date.now();

  const ageInDays = (isoDate) => (now - new Date(isoDate).getTime()) / DAY_MS;
  const isMaintainer = (association) => MAINTAINER_ASSOCIATIONS.has(association);
  const isBot = (user) =>
    !!user && (user.type === 'Bot' || user.login.endsWith('[bot]'));

  log.info('A2UI triage-flag scan started');

  // `listForRepo` returns both issues and pull requests (PRs carry a
  // `pull_request` field). Paginate so we cover the whole open backlog.
  const openItems = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });

  let flagged = 0;
  let unflagged = 0;

  for (const item of openItems) {
    const number = item.number;
    const isPR = !!item.pull_request;
    const labels = (item.labels || []).map((label) =>
      typeof label === 'string' ? label : label.name,
    );
    const hasPriority = PRIORITY_LABELS.some((p) => labels.includes(p));
    const assigneeCount = (item.assignees || []).length;

    const reasons = [];

    // An item we are deliberately waiting on the reporter for is parked: it
    // should never carry the triage flag, regardless of the other rules.
    if (labels.includes(WAITING_LABEL)) {
      await reconcile(item, false, reasons);
      continue;
    }

    // --- Cheap, label-only rules (no API calls needed) ---------------------
    if (!isPR && !hasPriority) {
      reasons.push('issue without priority');
    }
    if (
      (labels.includes('P0') || labels.includes('P1')) &&
      assigneeCount === 0
    ) {
      reasons.push('P0/P1 without assignee');
    }

    // --- Rules that need the comment history (staleness + unanswered) ------
    // Only fetch comments when the cheap rules haven't already decided to flag.
    if (reasons.length === 0) {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner,
        repo,
        issue_number: number,
        per_page: 100,
      });

      // Human comments only; sorted oldest-to-newest (the API default, but we
      // sort defensively so "last comment" is unambiguous).
      const humanComments = comments
        .filter((c) => !isBot(c.user))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const lastComment = humanComments[humanComments.length - 1] || null;

      // Staleness is measured from the last human activity (a comment, or the
      // creation time if there are none) rather than `updated_at`, so our own
      // label edits don't reset the clock and make the flag flap.
      const lastActivityAt = lastComment
        ? lastComment.created_at
        : item.created_at;
      const staleDays = ageInDays(lastActivityAt);

      if (isPR) {
        if (staleDays > PR_STALE_DAYS) {
          reasons.push(`PR stale for ${Math.floor(staleDays)}d`);
        }
      } else if (labels.includes('P0') && staleDays > P0_STALE_DAYS) {
        reasons.push(`P0 stale for ${Math.floor(staleDays)}d`);
      } else if (labels.includes('P1') && staleDays > P1_STALE_DAYS) {
        reasons.push(`P1 stale for ${Math.floor(staleDays)}d`);
      } else if (labels.includes('P2') && staleDays > P2_STALE_DAYS) {
        reasons.push(`P2 stale for ${Math.floor(staleDays)}d`);
      }

      // Unanswered external comment: the most recent human comment is from a
      // non-maintainer and has gone unanswered for more than a day. (If a
      // maintainer had replied, that reply would be the last comment.)
      if (
        lastComment &&
        !isMaintainer(lastComment.author_association) &&
        ageInDays(lastComment.created_at) > COMMENT_RESPONSE_DAYS
      ) {
        reasons.push('external comment awaiting response');
      }
    }

    await reconcile(item, reasons.length > 0, reasons);
  }

  log.info(
    `A2UI triage-flag scan complete: ${flagged} flagged, ${unflagged} unflagged ` +
      `(${openItems.length} open items scanned)`,
  );

  // Add or remove the label to match `shouldFlag`, leaving already-correct
  // items untouched. Tolerates the label being concurrently added/removed.
  async function reconcile(item, shouldFlag, reasons) {
    const number = item.number;
    const hasFlag = (item.labels || [])
      .map((label) => (typeof label === 'string' ? label : label.name))
      .includes(TRIAGE_FLAG);

    if (shouldFlag && !hasFlag) {
      try {
        await github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: number,
          labels: [TRIAGE_FLAG],
        });
        flagged++;
        log.info(`Flagged #${number}: ${reasons.join('; ')}`);
      } catch (error) {
        log.warning(`Failed to flag #${number}: ${error.message}`);
      }
    } else if (!shouldFlag && hasFlag) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: number,
          name: TRIAGE_FLAG,
        });
        unflagged++;
        log.info(`Unflagged #${number}`);
      } catch (error) {
        // 404 means the label was already gone (e.g. a concurrent edit).
        if (error.status === 404) {
          log.info(`Label already absent on #${number}`);
        } else {
          log.warning(`Failed to unflag #${number}: ${error.message}`);
        }
      }
    }
  }
}

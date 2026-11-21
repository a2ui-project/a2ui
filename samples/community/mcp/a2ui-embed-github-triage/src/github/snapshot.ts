/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** Captures a trimmed {@link RepoSnapshot} from a live repository for fixture mode. */

import type {PullSnapshot, RepoSnapshot} from './fixture.js';
import {PRIORITY_LABELS} from '../triage/rules.js';
import type {GhComment, GitHubReader} from './types.js';

/** How much a snapshot keeps. */
export interface CaptureLimits {
  /** Issues with bodies and comments. */
  readonly detailedIssues: number;
  /** Pull requests with files and checks. */
  readonly pulls: number;
  /** Most recent comments kept per item. */
  readonly comments: number;
}

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = {detailedIssues: 40, pulls: 10, comments: 5};

/** Comment bodies are cut further than issue bodies in snapshots. */
const MAX_SNAPSHOT_COMMENT = 1500;

function trimComments(comments: readonly GhComment[], limit: number): GhComment[] {
  return comments.slice(-limit).map(comment => ({
    ...comment,
    body:
      comment.body.length > MAX_SNAPSHOT_COMMENT
        ? `${comment.body.slice(0, MAX_SNAPSHOT_COMMENT)}\n\n…`
        : comment.body,
  }));
}

/**
 * Reads labels, milestones, assignees, every open issue (slim), bodies and
 * comments of the newest issues (untriaged ones first), and the most recently
 * updated PRs with their files and checks.
 */
export async function captureSnapshot(
  source: GitHubReader,
  limits: CaptureLimits = DEFAULT_CAPTURE_LIMITS,
  now = new Date(),
): Promise<RepoSnapshot> {
  const [labels, milestones, assignees, issues, pullList] = await Promise.all([
    source.listLabels(),
    source.listMilestones(),
    source.listAssignees(),
    source.listOpenIssues(),
    source.listOpenPulls(),
  ]);
  const priorities = new Set<string>(PRIORITY_LABELS);
  const untriaged = issues.filter(issue => !issue.labels.some(label => priorities.has(label.name)));
  const triaged = issues.filter(issue => !untriaged.includes(issue));
  const detailed = [
    ...untriaged.slice(0, Math.ceil(limits.detailedIssues * 0.6)),
    ...triaged,
  ].slice(0, limits.detailedIssues);
  const details: Record<string, {body: string; comments: GhComment[]}> = {};
  for (const issue of detailed) {
    const [full, comments] = await Promise.all([
      source.getIssue(issue.number),
      issue.comments > 0 ? source.listComments(issue.number) : Promise.resolve([]),
    ]);
    details[String(issue.number)] = {
      body: full.body,
      comments: trimComments(comments, limits.comments),
    };
  }
  const pulls: PullSnapshot[] = [];
  for (const slim of pullList.slice(0, limits.pulls)) {
    const pull = await source.getPull(slim.number);
    const [files, checks, comments] = await Promise.all([
      source.listPullFiles(pull.number),
      source.listCheckRuns(pull.headSha),
      pull.comments > 0 ? source.listComments(pull.number) : Promise.resolve([]),
    ]);
    pulls.push({
      ...pull,
      files: files.slice(0, 60),
      checks: checks.slice(0, 30),
      commentList: trimComments(comments, limits.comments),
    });
  }
  return {
    repo: source.repo,
    capturedAt: now.toISOString(),
    labels,
    milestones,
    assignees,
    issues,
    details,
    pulls,
  };
}

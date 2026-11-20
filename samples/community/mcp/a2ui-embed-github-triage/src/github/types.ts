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

/** The trimmed GitHub data the triage tools read, shared by the REST client and fixtures. */

/** A GitHub account. */
export interface GhUser {
  readonly login: string;
  readonly avatarUrl: string;
}

/** A repository label; `color` is a 6-digit hex string without `#`. */
export interface GhLabel {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

/** An open milestone. */
export interface GhMilestone {
  readonly number: number;
  readonly title: string;
  readonly dueOn: string | null;
  readonly openIssues: number;
}

/** An issue. `body` is empty in issue lists and filled by `getIssue`. */
export interface GhIssue {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly author: GhUser;
  readonly authorAssociation: string;
  readonly labels: readonly GhLabel[];
  readonly assignees: readonly GhUser[];
  readonly milestone: {readonly number: number; readonly title: string} | null;
  readonly comments: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
  readonly body: string;
}

/** An issue or PR comment. */
export interface GhComment {
  readonly id: number;
  readonly author: GhUser;
  readonly authorAssociation: string;
  readonly body: string;
  readonly createdAt: string;
}

/** A pull request. Line counts are 0 in PR lists and filled by `getPull`. */
export interface GhPullRequest extends GhIssue {
  readonly draft: boolean;
  readonly headSha: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly requestedReviewers: readonly GhUser[];
}

/** A file changed by a pull request. */
export interface GhPullFile {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}

/** A CI check run on a commit. */
export interface GhCheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly url: string;
}

/** The review events GitHub accepts. */
export const REVIEW_EVENTS = ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'] as const;

/** A pull request review event. */
export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

/** Reads a repository. */
export interface GitHubReader {
  readonly repo: string;
  /** Open issues (never PRs), newest first, at most a few hundred. `fresh` skips caches. */
  listOpenIssues(options?: {fresh?: boolean}): Promise<GhIssue[]>;
  /** One issue or PR as an issue, with its body. */
  getIssue(number: number): Promise<GhIssue>;
  /** The most recent comments of an issue or PR, oldest first. */
  listComments(number: number): Promise<GhComment[]>;
  /** Open pull requests, most recently updated first. */
  listOpenPulls(options?: {fresh?: boolean}): Promise<GhPullRequest[]>;
  getPull(number: number): Promise<GhPullRequest>;
  listPullFiles(number: number): Promise<GhPullFile[]>;
  listCheckRuns(sha: string): Promise<GhCheckRun[]>;
  listLabels(): Promise<GhLabel[]>;
  listMilestones(): Promise<GhMilestone[]>;
  /** Users issues can be assigned to. */
  listAssignees(): Promise<GhUser[]>;
}

/** Writes to a repository. Only `TriageWriter` calls it, behind the write gate. */
export interface GitHubWriter {
  addLabels(number: number, labels: readonly string[]): Promise<void>;
  removeLabel(number: number, label: string): Promise<void>;
  addAssignees(number: number, logins: readonly string[]): Promise<void>;
  setMilestone(number: number, milestone: number | null): Promise<void>;
  addComment(number: number, body: string): Promise<void>;
  createReview(number: number, review: {event: ReviewEvent; body: string}): Promise<void>;
}

/** A source that can read and, behind the gate, write. */
export type GitHubSource = GitHubReader & GitHubWriter;

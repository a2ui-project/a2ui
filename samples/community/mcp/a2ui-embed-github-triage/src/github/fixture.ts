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

/**
 * Offline fixture mode: a captured or synthetic repository snapshot served
 * through the same interface as the REST client. Writes change the in-memory
 * copy only and are recorded, so tests can check them.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {
  GhCheckRun,
  GhComment,
  GhIssue,
  GhLabel,
  GhMilestone,
  GhPullFile,
  GhPullRequest,
  GhUser,
  GitHubReader,
  GitHubSource,
  ReviewEvent,
} from './types.js';

/** A pull request with what its view needs. */
export interface PullSnapshot extends GhPullRequest {
  readonly files: readonly GhPullFile[];
  readonly checks: readonly GhCheckRun[];
  readonly commentList: readonly GhComment[];
}

/** The fixture file format (`snapshot.json`). */
export interface RepoSnapshot {
  readonly repo: string;
  readonly capturedAt: string;
  readonly labels: readonly GhLabel[];
  readonly milestones: readonly GhMilestone[];
  readonly assignees: readonly GhUser[];
  /** Open issues, newest first, without bodies. */
  readonly issues: readonly GhIssue[];
  /** Bodies and comments of some issues, keyed by number. */
  readonly details: Readonly<Record<string, {body: string; comments: readonly GhComment[]}>>;
  readonly pulls: readonly PullSnapshot[];
}

/** File name of a snapshot inside a fixture directory. */
export const SNAPSHOT_FILE = 'snapshot.json';

/** A write a {@link FixtureGitHub} received. */
export interface RecordedWrite {
  readonly method: keyof Omit<GitHubSource, keyof GitHubReader | 'repo'>;
  readonly number: number;
  readonly value: unknown;
}

/** Reads `snapshot.json` from a fixture directory. */
export function readSnapshot(dir: string): RepoSnapshot {
  return JSON.parse(readFileSync(join(dir, SNAPSHOT_FILE), 'utf8')) as RepoSnapshot;
}

/** {@link GitHubSource} over a {@link RepoSnapshot}. */
export class FixtureGitHub implements GitHubSource {
  readonly repo: string;
  readonly writes: RecordedWrite[] = [];
  private readonly issues = new Map<number, GhIssue>();

  constructor(private readonly snapshot: RepoSnapshot) {
    this.repo = snapshot.repo;
    for (const issue of snapshot.issues) this.issues.set(issue.number, issue);
    for (const pull of snapshot.pulls) {
      if (!this.issues.has(pull.number)) this.issues.set(pull.number, pull);
    }
  }

  private find(number: number): GhIssue {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`Issue #${number} is not in the fixture snapshot of ${this.repo}.`);
    return issue;
  }

  private pull(number: number): PullSnapshot {
    const pull = this.snapshot.pulls.find(candidate => candidate.number === number);
    if (!pull) throw new Error(`PR #${number} is not in the fixture snapshot of ${this.repo}.`);
    return pull;
  }

  private update(number: number, change: Partial<GhIssue>): void {
    this.issues.set(number, {...this.find(number), ...change});
  }

  async listOpenIssues(): Promise<GhIssue[]> {
    const pulls = new Set(this.snapshot.pulls.map(pull => pull.number));
    return [...this.issues.values()]
      .filter(issue => issue.state === 'open' && !pulls.has(issue.number))
      .sort((a, b) => b.number - a.number);
  }

  async getIssue(number: number): Promise<GhIssue> {
    const issue = this.find(number);
    const pull = this.snapshot.pulls.find(candidate => candidate.number === number);
    return {...issue, body: this.snapshot.details[String(number)]?.body ?? pull?.body ?? ''};
  }

  async listComments(number: number): Promise<GhComment[]> {
    const pull = this.snapshot.pulls.find(candidate => candidate.number === number);
    return [...(this.snapshot.details[String(number)]?.comments ?? pull?.commentList ?? [])];
  }

  async listOpenPulls(): Promise<GhPullRequest[]> {
    return this.snapshot.pulls.map(pull => ({...pull, body: ''}));
  }

  async getPull(number: number): Promise<GhPullRequest> {
    const {files: _files, checks: _checks, commentList: _comments, ...pull} = this.pull(number);
    return pull;
  }

  async listPullFiles(number: number): Promise<GhPullFile[]> {
    return [...this.pull(number).files];
  }

  async listCheckRuns(sha: string): Promise<GhCheckRun[]> {
    return [...(this.snapshot.pulls.find(pull => pull.headSha === sha)?.checks ?? [])];
  }

  async listLabels(): Promise<GhLabel[]> {
    return [...this.snapshot.labels];
  }

  async listMilestones(): Promise<GhMilestone[]> {
    return [...this.snapshot.milestones];
  }

  async listAssignees(): Promise<GhUser[]> {
    return [...this.snapshot.assignees];
  }

  async addLabels(number: number, labels: readonly string[]): Promise<void> {
    this.writes.push({method: 'addLabels', number, value: labels});
    const issue = this.find(number);
    const known = new Map(this.snapshot.labels.map(label => [label.name, label]));
    const added = labels
      .filter(name => !issue.labels.some(label => label.name === name))
      .map(name => known.get(name) ?? {name, color: 'ededed', description: ''});
    this.update(number, {labels: [...issue.labels, ...added]});
  }

  async removeLabel(number: number, label: string): Promise<void> {
    this.writes.push({method: 'removeLabel', number, value: label});
    this.update(number, {labels: this.find(number).labels.filter(item => item.name !== label)});
  }

  async addAssignees(number: number, logins: readonly string[]): Promise<void> {
    this.writes.push({method: 'addAssignees', number, value: logins});
    const issue = this.find(number);
    const added = logins
      .filter(login => !issue.assignees.some(user => user.login === login))
      .map(login => ({login, avatarUrl: ''}));
    this.update(number, {assignees: [...issue.assignees, ...added]});
  }

  async setMilestone(number: number, milestone: number | null): Promise<void> {
    this.writes.push({method: 'setMilestone', number, value: milestone});
    const found = this.snapshot.milestones.find(item => item.number === milestone);
    this.update(number, {milestone: found ? {number: found.number, title: found.title} : null});
  }

  async addComment(number: number, body: string): Promise<void> {
    this.writes.push({method: 'addComment', number, value: body});
  }

  async createReview(number: number, review: {event: ReviewEvent; body: string}): Promise<void> {
    this.writes.push({method: 'createReview', number, value: review});
  }
}

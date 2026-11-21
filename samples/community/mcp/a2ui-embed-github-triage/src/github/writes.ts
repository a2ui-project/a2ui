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
 * The dry-run write layer. Every change is planned as data first; the plan is
 * shown to the user, and only `TriageWriter.apply` with an explicit confirm
 * writes, and only when the gate allows the repository.
 */

import type {GhIssue, GitHubWriter, ReviewEvent} from './types.js';
import {
  COMPONENT_PREFIX,
  FIRST_LINE_HANDLED_LABEL,
  PRIORITY_LABELS,
  TYPE_PREFIX,
} from '../triage/rules.js';

/** One change to one issue or PR. */
export type TriageChange =
  | {readonly kind: 'addLabel'; readonly label: string}
  | {readonly kind: 'removeLabel'; readonly label: string}
  | {readonly kind: 'assign'; readonly login: string}
  | {
      readonly kind: 'milestone';
      readonly from: string | null;
      readonly to: {readonly number: number; readonly title: string} | null;
    }
  | {readonly kind: 'comment'; readonly body: string}
  | {readonly kind: 'review'; readonly event: ReviewEvent; readonly body: string};

/** The changes planned for one issue or PR. */
export interface ItemPlan {
  readonly number: number;
  readonly title: string;
  readonly changes: readonly TriageChange[];
}

/** What the user wants an issue to look like after triage. Missing fields stay as they are. */
export interface TriageDecision {
  readonly priority?: string;
  /** A `type:` label; replaces the other `type:` labels. */
  readonly type?: string;
  /** `component:` labels to add. */
  readonly components?: readonly string[];
  /** Other labels to add. */
  readonly addLabels?: readonly string[];
  readonly assignee?: string;
  readonly milestone?: {readonly number: number; readonly title: string} | null;
  readonly reply?: string;
  /** Adds `status: first-line-handled`. */
  readonly markHandled?: boolean;
}

/** Plans the label, assignee, milestone and comment changes that turn `issue` into `decision`. */
export function planTriage(issue: GhIssue, decision: TriageDecision): ItemPlan {
  const current = new Set(issue.labels.map(label => label.name));
  const add = new Set<string>();
  const remove = new Set<string>();
  const priorities = new Set<string>(PRIORITY_LABELS);
  if (decision.priority) {
    add.add(decision.priority);
    for (const name of current)
      if (priorities.has(name) && name !== decision.priority) remove.add(name);
  }
  if (decision.type) {
    add.add(decision.type);
    for (const name of current) {
      if (name.toLowerCase().startsWith(TYPE_PREFIX) && name !== decision.type) remove.add(name);
    }
  }
  for (const name of decision.components ?? []) {
    if (name.toLowerCase().startsWith(COMPONENT_PREFIX)) add.add(name);
  }
  for (const name of decision.addLabels ?? []) add.add(name);
  if (decision.markHandled) add.add(FIRST_LINE_HANDLED_LABEL);

  const changes: TriageChange[] = [];
  for (const label of add) if (!current.has(label)) changes.push({kind: 'addLabel', label});
  for (const label of remove) changes.push({kind: 'removeLabel', label});
  const assignee = decision.assignee?.trim();
  if (assignee && !issue.assignees.some(user => user.login === assignee)) {
    changes.push({kind: 'assign', login: assignee});
  }
  if (decision.milestone !== undefined && decision.milestone?.number !== issue.milestone?.number) {
    changes.push({kind: 'milestone', from: issue.milestone?.title ?? null, to: decision.milestone});
  }
  const reply = decision.reply?.trim();
  if (reply) changes.push({kind: 'comment', body: reply});
  return {number: issue.number, title: issue.title, changes};
}

/** Describes a change in a few words, for diffs and summaries. */
export function describeChange(change: TriageChange): string {
  switch (change.kind) {
    case 'addLabel':
      return `+ label ${change.label}`;
    case 'removeLabel':
      return `- label ${change.label}`;
    case 'assign':
      return `+ assignee @${change.login}`;
    case 'milestone':
      return `milestone ${change.from ?? 'none'} → ${change.to?.title ?? 'none'}`;
    case 'comment':
      return `+ comment (${change.body.length} characters)`;
    case 'review':
      return `+ review ${change.event.toLowerCase().replace('_', ' ')}${change.body ? ` (${change.body.length} characters)` : ''}`;
  }
}

/** Decides whether real writes are allowed. */
export class WriteGate {
  private readonly enabled: boolean;
  private readonly allowlist: ReadonlySet<string>;

  constructor(env: NodeJS.ProcessEnv) {
    this.enabled = env['TRIAGE_WRITE'] === '1';
    this.allowlist = new Set(
      (env['TRIAGE_WRITE_REPOS'] ?? '')
        .split(',')
        .map(repo => repo.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  /** Whether writes to `repo` are real. Needs `TRIAGE_WRITE=1` and `repo` in `TRIAGE_WRITE_REPOS`. */
  allows(repo: string): boolean {
    return this.enabled && this.allowlist.has(repo.toLowerCase());
  }

  /** Why writes to `repo` are dry runs, or `undefined` when they are real. */
  dryRunReason(repo: string): string | undefined {
    if (!this.enabled) return 'writes are disabled (set TRIAGE_WRITE=1 to enable them)';
    if (!this.allowlist.has(repo.toLowerCase())) return `${repo} is not in TRIAGE_WRITE_REPOS`;
    return undefined;
  }
}

/** The outcome of applying plans. */
export interface ApplyResult {
  readonly dryRun: boolean;
  /** Why it was a dry run. */
  readonly reason?: string;
  /** Changes written (0 in a dry run). */
  readonly written: number;
  readonly planned: number;
  readonly errors: readonly string[];
}

/** Applies plans through a {@link GitHubWriter}, behind a {@link WriteGate}. */
export class TriageWriter {
  constructor(
    private readonly writer: GitHubWriter,
    private readonly gate: WriteGate,
    private readonly repo: string,
  ) {}

  get dryRun(): boolean {
    return !this.gate.allows(this.repo);
  }

  get dryRunReason(): string | undefined {
    return this.gate.dryRunReason(this.repo);
  }

  /** Writes `plans` when the gate allows the repo; otherwise writes nothing and says why. */
  async apply(plans: readonly ItemPlan[]): Promise<ApplyResult> {
    const planned = plans.reduce((count, plan) => count + plan.changes.length, 0);
    const reason = this.gate.dryRunReason(this.repo);
    if (reason !== undefined) return {dryRun: true, reason, written: 0, planned, errors: []};
    let written = 0;
    const errors: string[] = [];
    for (const plan of plans) {
      for (const change of plan.changes) {
        try {
          await this.write(plan.number, change);
          written++;
        } catch (error) {
          errors.push(`#${plan.number} ${describeChange(change)}: ${String(error)}`);
        }
      }
    }
    return {dryRun: false, written, planned, errors};
  }

  private async write(number: number, change: TriageChange): Promise<void> {
    switch (change.kind) {
      case 'addLabel':
        return this.writer.addLabels(number, [change.label]);
      case 'removeLabel':
        return this.writer.removeLabel(number, change.label);
      case 'assign':
        return this.writer.addAssignees(number, [change.login]);
      case 'milestone':
        return this.writer.setMilestone(number, change.to?.number ?? null);
      case 'comment':
        return this.writer.addComment(number, change.body);
      case 'review':
        return this.writer.createReview(number, {event: change.event, body: change.body});
    }
  }
}

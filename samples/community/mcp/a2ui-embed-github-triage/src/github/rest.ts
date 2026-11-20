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
 * GitHub REST access with `fetch`: normalizes responses into the trimmed
 * types, caches reads for a minute, and exposes writes only to the
 * `TriageWriter` gate.
 */

import type {
  GhCheckRun,
  GhComment,
  GhIssue,
  GhLabel,
  GhMilestone,
  GhPullFile,
  GhPullRequest,
  GhUser,
  GitHubSource,
  ReviewEvent,
} from './types.js';

/** Bodies longer than this are cut, to keep tool results and fixtures small. */
export const MAX_BODY_LENGTH = 6000;

/** Most open issues read for the inbox and the dashboard. */
export const MAX_OPEN_ISSUES = 300;

const CACHE_MS = 60_000;

type Json = Record<string, unknown>;

/** A GitHub API failure, with the HTTP status. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function obj(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function arr(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

/** Cuts `body` to `MAX_BODY_LENGTH` characters, marking the cut. */
export function trimBody(body: string): string {
  return body.length <= MAX_BODY_LENGTH ? body : `${body.slice(0, MAX_BODY_LENGTH)}\n\n…`;
}

export function toUser(raw: unknown): GhUser {
  const user = obj(raw);
  return {login: str(user['login']) || 'ghost', avatarUrl: str(user['avatar_url'])};
}

export function toLabel(raw: unknown): GhLabel {
  const label = obj(raw);
  return {
    name: str(label['name']),
    color: /^[0-9a-fA-F]{6}$/.test(str(label['color']))
      ? str(label['color']).toLowerCase()
      : 'ededed',
    description: str(label['description']),
  };
}

export function toIssue(raw: unknown): GhIssue {
  const issue = obj(raw);
  const milestone = issue['milestone'] ? obj(issue['milestone']) : undefined;
  return {
    number: num(issue['number']),
    title: str(issue['title']),
    state: issue['state'] === 'closed' ? 'closed' : 'open',
    author: toUser(issue['user']),
    authorAssociation: str(issue['author_association']),
    labels: arr(issue['labels']).map(toLabel),
    assignees: arr(issue['assignees']).map(toUser),
    milestone: milestone
      ? {number: num(milestone['number']), title: str(milestone['title'])}
      : null,
    comments: num(issue['comments']),
    createdAt: str(issue['created_at']),
    updatedAt: str(issue['updated_at']),
    url: str(issue['html_url']),
    body: trimBody(str(issue['body'])),
  };
}

export function toPull(raw: unknown): GhPullRequest {
  const pull = obj(raw);
  return {
    ...toIssue(raw),
    draft: pull['draft'] === true,
    headSha: str(obj(pull['head'])['sha']),
    headRef: str(obj(pull['head'])['ref']),
    baseRef: str(obj(pull['base'])['ref']),
    additions: num(pull['additions']),
    deletions: num(pull['deletions']),
    changedFiles: num(pull['changed_files']),
    requestedReviewers: arr(pull['requested_reviewers']).map(toUser),
  };
}

export function toComment(raw: unknown): GhComment {
  const comment = obj(raw);
  return {
    id: num(comment['id']),
    author: toUser(comment['user']),
    authorAssociation: str(comment['author_association']),
    body: trimBody(str(comment['body'])),
    createdAt: str(comment['created_at']),
  };
}

/** Options of {@link RestGitHub}. */
export interface RestGitHubOptions {
  readonly repo: string;
  readonly token?: string;
  readonly fetch?: typeof fetch;
  readonly apiUrl?: string;
}

/** {@link GitHubSource} over the GitHub REST API. */
export class RestGitHub implements GitHubSource {
  readonly repo: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly cache = new Map<string, {at: number; value: unknown}>();

  constructor(options: RestGitHubOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) {
      throw new Error(
        `GITHUB_REPO must look like owner/name, got ${JSON.stringify(options.repo)}.`,
      );
    }
    this.repo = options.repo;
    this.token = options.token || undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.apiUrl = options.apiUrl ?? 'https://api.github.com';
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'a2ui-embed-github-triage',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) {
      const detail = str(obj(await response.json().catch(() => ({})))['message']);
      throw new GitHubError(
        `GitHub ${method} ${path.split('?')[0]} failed with ${response.status}${detail ? `: ${detail}` : ''}.`,
        response.status,
      );
    }
    return response.status === 204 ? undefined : response.json();
  }

  private async get(path: string, fresh = false): Promise<unknown> {
    const cached = this.cache.get(path);
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const value = await this.request('GET', path);
    this.cache.set(path, {at: Date.now(), value});
    return value;
  }

  private async pages(path: string, max: number, fresh = false): Promise<Json[]> {
    const items: Json[] = [];
    const separator = path.includes('?') ? '&' : '?';
    for (let page = 1; items.length < max; page++) {
      const batch = arr(await this.get(`${path}${separator}per_page=100&page=${page}`, fresh));
      items.push(...batch);
      if (batch.length < 100) break;
    }
    return items.slice(0, max);
  }

  private repoPath(suffix: string): string {
    return `/repos/${this.repo}${suffix}`;
  }

  async listOpenIssues(options: {fresh?: boolean} = {}): Promise<GhIssue[]> {
    // The issues endpoint also lists PRs; read extra pages to make up for them.
    const items = await this.pages(
      this.repoPath('/issues?state=open&sort=created&direction=desc'),
      MAX_OPEN_ISSUES * 2,
      options.fresh,
    );
    return items
      .filter(item => !item['pull_request'])
      .slice(0, MAX_OPEN_ISSUES)
      .map(item => ({...toIssue(item), body: ''}));
  }

  async getIssue(number: number): Promise<GhIssue> {
    return toIssue(await this.get(this.repoPath(`/issues/${number}`)));
  }

  async listComments(number: number): Promise<GhComment[]> {
    const items = await this.pages(this.repoPath(`/issues/${number}/comments`), 300);
    return items.slice(-20).map(toComment);
  }

  async listOpenPulls(options: {fresh?: boolean} = {}): Promise<GhPullRequest[]> {
    const items = await this.pages(
      this.repoPath('/pulls?state=open&sort=updated&direction=desc'),
      100,
      options.fresh,
    );
    return items.map(item => ({...toPull(item), body: ''}));
  }

  async getPull(number: number): Promise<GhPullRequest> {
    return toPull(await this.get(this.repoPath(`/pulls/${number}`)));
  }

  async listPullFiles(number: number): Promise<GhPullFile[]> {
    const items = await this.pages(this.repoPath(`/pulls/${number}/files`), 100);
    return items.map(file => ({
      filename: str(file['filename']),
      status: str(file['status']),
      additions: num(file['additions']),
      deletions: num(file['deletions']),
    }));
  }

  async listCheckRuns(sha: string): Promise<GhCheckRun[]> {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return [];
    const result = obj(await this.get(this.repoPath(`/commits/${sha}/check-runs?per_page=100`)));
    return arr(result['check_runs']).map(run => ({
      name: str(run['name']),
      status: str(run['status']),
      conclusion: typeof run['conclusion'] === 'string' ? run['conclusion'] : null,
      url: str(run['html_url']),
    }));
  }

  async listLabels(): Promise<GhLabel[]> {
    return (await this.pages(this.repoPath('/labels'), 300)).map(toLabel);
  }

  async listMilestones(): Promise<GhMilestone[]> {
    return (await this.pages(this.repoPath('/milestones?state=open'), 100)).map(item => ({
      number: num(item['number']),
      title: str(item['title']),
      dueOn: typeof item['due_on'] === 'string' ? item['due_on'] : null,
      openIssues: num(item['open_issues']),
    }));
  }

  async listAssignees(): Promise<GhUser[]> {
    return (await this.pages(this.repoPath('/assignees'), 200)).map(toUser);
  }

  async addLabels(number: number, labels: readonly string[]): Promise<void> {
    await this.request('POST', this.repoPath(`/issues/${number}/labels`), {labels});
  }

  async removeLabel(number: number, label: string): Promise<void> {
    await this.request(
      'DELETE',
      this.repoPath(`/issues/${number}/labels/${encodeURIComponent(label)}`),
    );
  }

  async addAssignees(number: number, logins: readonly string[]): Promise<void> {
    await this.request('POST', this.repoPath(`/issues/${number}/assignees`), {assignees: logins});
  }

  async setMilestone(number: number, milestone: number | null): Promise<void> {
    await this.request('PATCH', this.repoPath(`/issues/${number}`), {milestone});
  }

  async addComment(number: number, body: string): Promise<void> {
    await this.request('POST', this.repoPath(`/issues/${number}/comments`), {body});
  }

  async createReview(number: number, review: {event: ReviewEvent; body: string}): Promise<void> {
    await this.request('POST', this.repoPath(`/pulls/${number}/reviews`), review);
  }
}

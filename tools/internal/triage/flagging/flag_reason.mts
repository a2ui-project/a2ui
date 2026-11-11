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

// Prints why the flagger flags each given issue or PR, with the same rules
// and data that triage.mts uses. The triage bot copies the reason into the
// `reason` property of its suggestion.
//
// Usage, from the repository root:
//
//   node tools/internal/triage/flagging/flag_reason.mts <item>...
//
// An item is a number in a2ui-project/a2ui, or the URL of an issue or PR. The
// output is a JSON array with one `{"url": ..., "reason": ...}` entry per item,
// where `reason` is null when the item should not be flagged. The script reads
// GitHub with the `gh` CLI, so it uses the account `gh` is logged in to.

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {decide, fetchHistory, type GitHubReader} from './triage.mts';

const DEFAULT_OWNER = 'a2ui-project';
const DEFAULT_REPO = 'a2ui';

/** An issue or PR, by repository and number. */
export interface ItemRef {
  owner: string;
  repo: string;
  number: number;
}

/** The flag reason of one item, as the script prints it. */
export interface ItemReason {
  url: string;
  reason: string | null;
}

/**
 * Parses an item argument: a number, optionally with `#`, in
 * a2ui-project/a2ui, or the URL of an issue or PR.
 */
export function parseItem(arg: string): ItemRef {
  const number = arg.match(/^#?(\d+)$/);
  if (number) {
    return {owner: DEFAULT_OWNER, repo: DEFAULT_REPO, number: Number(number[1])};
  }
  const url = arg.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/);
  if (url) {
    return {owner: url[1], repo: url[2], number: Number(url[3])};
  }
  throw new Error(`Not an issue or PR number or URL: ${arg}`);
}

/** Turns a reason that `flagReason` returns into a sentence. */
export const toSentence = (reason: string): string =>
  reason.charAt(0).toUpperCase() + reason.slice(1);

/** Returns why the flagger flags the item, or null if it does not. */
export async function itemReason(
  github: GitHubReader,
  {owner, repo, number}: ItemRef,
  now: number,
): Promise<ItemReason> {
  const {data: item} = await github.rest.issues.get({owner, repo, issue_number: number});
  const history = await fetchHistory({github, owner, repo}, item);
  const {reason} = decide(item, history, now);
  return {
    url: item.html_url ?? `https://github.com/${owner}/${repo}/issues/${number}`,
    reason: reason && toSentence(reason),
  };
}

const run = promisify(execFile);

/** Calls the GitHub REST API with `gh api`, and parses the JSON it returns. */
async function gh(path: string, paginate: boolean): Promise<unknown> {
  const args = ['api', ...(paginate ? ['--paginate', '--slurp'] : []), path];
  const {stdout} = await run('gh', args, {maxBuffer: 64 * 1024 * 1024});
  return JSON.parse(stdout);
}

/**
 * Fills the `{name}` parameters of `route` from `params`, and adds the other
 * params as the query.
 */
export function toPath(route: string, params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  const used = new Set<string>();
  const path = route.replace(/\{(\w+)\}/g, (_, name: string) => {
    used.add(name);
    return encodeURIComponent(String(params[name]));
  });
  for (const [name, value] of Object.entries(params)) {
    if (!used.has(name)) query.set(name, String(value));
  }
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

/** A `GitHubReader` that calls the GitHub REST API with `gh api`. */
function ghReader(): GitHubReader {
  type Endpoint = (params: Record<string, unknown>) => Promise<{data: unknown}>;
  const routes = new Map<Endpoint, string>();
  const endpoint = (route: string): Endpoint => {
    const call: Endpoint = async params => ({data: await gh(toPath(route, params), false)});
    routes.set(call, route);
    return call;
  };
  const issue = 'repos/{owner}/{repo}/issues/{issue_number}';
  const pull = 'repos/{owner}/{repo}/pulls/{pull_number}';
  const get = endpoint(issue);
  return {
    // `--slurp` wraps the pages in an array.
    paginate: async <T,>(call: Endpoint, params: Record<string, unknown>) =>
      ((await gh(toPath(routes.get(call)!, params), true)) as T[][]).flat(),
    rest: {
      issues: {
        get: get as GitHubReader['rest']['issues']['get'],
        listComments: endpoint(`${issue}/comments`),
        listEvents: endpoint(`${issue}/events`),
      },
      pulls: {
        listReviews: endpoint(`${pull}/reviews`),
        listReviewComments: endpoint(`${pull}/comments`),
      },
    },
  };
}

async function main(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: node tools/internal/triage/flagging/flag_reason.mts <item>...');
    process.exitCode = 2;
    return;
  }
  const refs = args.map(parseItem);
  // triage.mts logs progress with console.log. Send it to stderr, so that
  // stdout has only the JSON.
  console.log = console.error;
  const github = ghReader();
  const now = Date.now();
  const reasons = await Promise.all(refs.map(ref => itemReason(github, ref, now)));
  process.stdout.write(JSON.stringify(reasons, null, 2) + '\n');
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}

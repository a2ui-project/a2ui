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

// Writes the triage report: what a person triaged in a2ui-project/a2ui in a
// period, collected from GitHub, for the team chat. The triage bot runs it.
//
// Usage, from the repository root:
//
//   node .agents/skills/a2ui-triage-bot/scripts/triage_report.mts report \
//     --since <date> [--until <date>] [--login <login>] --out <dir> [--copy]
//   node .agents/skills/a2ui-triage-bot/scripts/triage_report.mts unsubscribe <dir>/items.json
//
// `report` prints the report as plain text, and writes to <dir>:
//
//   report.txt: the report as plain text.
//   report.html: the report as HTML, where "triage bot" in the last line links
//     to the triage bot skill.
//   items.json: the items in the report, with the node IDs that `unsubscribe`
//     takes.
//
// With --copy, it also puts the report on the macOS clipboard, as HTML for
// apps that paste rich text, such as the team chat, and as plain text for the
// rest.
//
// A date is YYYY-MM-DD in the local time zone, or an ISO 8601 time. The period
// includes the whole --until day, which defaults to now. The login defaults to
// the account `gh` is logged in to.
//
// `unsubscribe` unsubscribes that account from the notifications of the items
// in items.json, as the Unsubscribe button on an item does.

import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs, promisify} from 'node:util';

export const OWNER = 'a2ui-project';
export const REPO = 'a2ui';
export const SKILL_URL =
  'https://github.com/a2ui-project/a2ui/blob/main/.agents/skills/a2ui-triage-bot/SKILL.md';

const NEEDS_TRIAGE = 'status: needs-triage';
const NEEDS_TEAM_INPUT = 'status: needs-team-input';
const ASSIGNED_FOR_TRIAGE = 'status: assigned-for-triage';
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

/** The prefix of triage bot comments, which the person posts as the bot. */
const TRIAGE_BOT_HEADING = /^\*\*From triage bot:\*\*/;

/** A timeline event, as `ITEM_FRAGMENT` returns it. */
export interface RawEvent {
  __typename: string;
  createdAt: string;
  actor: {login: string} | null;
  label?: {name: string};
  assignee?: {login?: string} | null;
  stateReason?: string | null;
  closer?: {__typename: string} | null;
  duplicateOf?: {number: number} | null;
}

/** An issue or PR, as `ITEM_FRAGMENT` returns it. */
export interface RawItem {
  __typename: 'Issue' | 'PullRequest';
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  comments: {nodes: {author: {login: string} | null; body: string; createdAt: string}[]};
  timelineItems: {nodes: RawEvent[]};
}

/** A period of time, with both ends included. */
export interface Period {
  since: Date;
  until: Date;
}

/** What a person did to an item in a period. */
export interface ItemActions {
  id: string;
  number: number;
  url: string;
  title: string;
  isPullRequest: boolean;
  addedLabels: string[];
  removedLabels: string[];
  assigned: string[];
  unassigned: string[];
  closed: {reason: string | null; duplicateOf: number | null} | null;
  reopened: boolean;
  commented: boolean;
}

/** The report, before it is rendered. */
export interface Report {
  login: string;
  period: Period;
  items: ItemActions[];
  /** How many open items have `status: needs-triage` now. */
  stillNeedTriage: number;
}

/**
 * Parses a date argument. A YYYY-MM-DD date is a day in the local time zone,
 * and stands for its start, or for its end when `endOfDay` is true.
 */
export function parseDate(arg: string, endOfDay: boolean): Date {
  const day = arg.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = day
    ? endOfDay
      ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 23, 59, 59, 999)
      : new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(arg);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${arg}`);
  return date;
}

const inPeriod = (time: string, {since, until}: Period): boolean => {
  const t = new Date(time).getTime();
  return t >= since.getTime() && t <= until.getTime();
};

/**
 * The names that `events` add more often than they remove, and the names
 * they remove more often than they add, so that adding a name and removing it
 * cancel out.
 */
function netChange(
  events: RawEvent[],
  plus: string,
  minus: string,
  name: (event: RawEvent) => string | undefined,
): {added: string[]; removed: string[]} {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = name(event);
    if (key === undefined) continue;
    if (event.__typename === plus) counts.set(key, (counts.get(key) ?? 0) + 1);
    if (event.__typename === minus) counts.set(key, (counts.get(key) ?? 0) - 1);
  }
  const entries = [...counts];
  return {
    added: entries.filter(([, count]) => count > 0).map(([key]) => key),
    removed: entries.filter(([, count]) => count < 0).map(([key]) => key),
  };
}

/**
 * Returns what `login` did to `item` in `period`, or null if they did not
 * change its labels, assignees or state, or comment on it.
 *
 * These do not count:
 *
 * 1. Triage bot comments.
 * 2. Adding or removing `status: needs-triage`, which the flagger manages.
 * 3. Closes by a commit or a merged PR, and the close that merges a PR.
 */
export function itemActions(item: RawItem, login: string, period: Period): ItemActions | null {
  const events = item.timelineItems.nodes.filter(
    event =>
      event.actor?.login === login &&
      inPeriod(event.createdAt, period) &&
      event.label?.name !== NEEDS_TRIAGE,
  );
  const labels = netChange(events, 'LabeledEvent', 'UnlabeledEvent', e => e.label?.name);
  const assignees = netChange(events, 'AssignedEvent', 'UnassignedEvent', e => e.assignee?.login);
  const state = events
    .filter(
      event =>
        event.__typename === 'ReopenedEvent' ||
        (event.__typename === 'ClosedEvent' && !event.closer && item.state !== 'MERGED'),
    )
    .at(-1);
  const closed =
    state?.__typename === 'ClosedEvent'
      ? {reason: state.stateReason ?? null, duplicateOf: state.duplicateOf?.number ?? null}
      : null;
  const reopened = state?.__typename === 'ReopenedEvent';
  const changes =
    labels.added.length + labels.removed.length + assignees.added.length + assignees.removed.length;
  const commented = item.comments.nodes.some(
    comment =>
      comment.author?.login === login &&
      inPeriod(comment.createdAt, period) &&
      !TRIAGE_BOT_HEADING.test(comment.body),
  );
  if (changes === 0 && !closed && !reopened && !commented) return null;
  return {
    id: item.id,
    number: item.number,
    url: item.url,
    title: item.title,
    isPullRequest: item.__typename === 'PullRequest',
    addedLabels: labels.added,
    removedLabels: labels.removed,
    assigned: assignees.added,
    unassigned: assignees.removed,
    closed,
    reopened,
    commented,
  };
}

/** The groups of the report, in order. */
export const GROUPS = [
  'Closed',
  ...PRIORITIES.map(priority => `Assigned ${priority}`),
  'Assigned for triage',
  'Needs team input',
  'Updated',
  'Commented',
];

/** Returns the group of `GROUPS` that the item belongs to. */
export function groupOf(item: ItemActions): string {
  if (item.closed) return 'Closed';
  const priority = PRIORITIES.find(p => item.addedLabels.includes(p));
  if (priority) return `Assigned ${priority}`;
  if (item.addedLabels.includes(ASSIGNED_FOR_TRIAGE)) return 'Assigned for triage';
  if (item.addedLabels.includes(NEEDS_TEAM_INPUT)) return 'Needs team input';
  const changed =
    item.reopened ||
    item.addedLabels.length + item.removedLabels.length + item.assigned.length + item.unassigned.length > 0;
  return changed ? 'Updated' : 'Commented';
}

/** Says what the person did to the item, as in "added P3, commented". */
export function describe(item: ItemActions): string {
  const parts: string[] = [];
  if (item.closed) {
    if (item.closed.duplicateOf !== null) {
      parts.push(`closed as duplicate of #${item.closed.duplicateOf}`);
    } else if (item.isPullRequest || !item.closed.reason) {
      parts.push('closed');
    } else {
      parts.push(`closed as ${item.closed.reason.toLowerCase().replace('_', ' ')}`);
    }
  }
  if (item.reopened) parts.push('reopened');
  if (item.addedLabels.length) parts.push(`added ${item.addedLabels.join(', ')}`);
  if (item.removedLabels.length) parts.push(`removed ${item.removedLabels.join(', ')}`);
  if (item.assigned.length) parts.push(`assigned ${item.assigned.join(', ')}`);
  if (item.unassigned.length) parts.push(`unassigned ${item.unassigned.join(', ')}`);
  if (item.commented) parts.push('commented');
  return parts.join(', ');
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Counts the items by kind, as in "2 issues and 1 PR". */
function kinds(items: ItemActions[]): string {
  const prs = items.filter(item => item.isPullRequest).length;
  const issues = items.length - prs;
  return [issues && count(issues, 'issue'), prs && count(prs, 'PR')]
    .filter(Boolean)
    .join(' and ');
}

/** Formats a date as YYYY-MM-DD in the local time zone. */
const formatDate = (date: Date): string =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0'))
    .join('-');

/** The parts of the report that the text and the HTML share. */
function sections(report: Report): {
  title: string;
  summary: string[];
  groups: {heading: string; items: ItemActions[]}[];
} {
  const {items, period} = report;
  const summary: string[] = [];
  if (items.length === 0) {
    summary.push('Triaged no items.');
  } else {
    const byKind = kinds(items);
    summary.push(
      byKind.includes(' and ')
        ? `Triaged ${count(items.length, 'item')}: ${byKind}.`
        : `Triaged ${byKind}.`,
    );
  }
  const sent = items.filter(item => item.addedLabels.includes(NEEDS_TEAM_INPUT));
  if (sent.length) summary.push(`Sent ${kinds(sent)} to the team.`);
  summary.push(
    `${count(report.stillNeedTriage, 'item')} still ${report.stillNeedTriage === 1 ? 'needs' : 'need'} triage.`,
  );
  const groups = GROUPS.map(group => {
    const inGroup = items.filter(item => groupOf(item) === group);
    return {heading: `${group}: ${kinds(inGroup)}`, items: inGroup};
  }).filter(group => group.items.length > 0);
  return {
    title: `Triage report for ${report.login}, ${formatDate(period.since)} to ${formatDate(period.until)}`,
    summary,
    groups,
  };
}

/** Renders the report as plain text. */
export function renderText(report: Report): string {
  const {title, summary, groups} = sections(report);
  const lines = [title, '', ...summary];
  for (const group of groups) {
    lines.push('', `- ${group.heading}`);
    for (const item of group.items) {
      lines.push(`  - ${item.url}`, `    ${item.title}: ${describe(item)}`);
    }
  }
  lines.push('', `Created by triage bot skill (${SKILL_URL})`);
  return lines.join('\n') + '\n';
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const link = (url: string, text: string): string =>
  `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;

/** Renders the report as HTML, for apps that paste rich text. */
export function renderHtml(report: Report): string {
  const {title, summary, groups} = sections(report);
  const parts = [`<p>${escapeHtml(title)}</p>`, `<p>${summary.map(escapeHtml).join('<br>')}</p>`];
  for (const group of groups) {
    const items = group.items.map(
      item => `<li>${link(item.url, item.url)}<br>${escapeHtml(`${item.title}: ${describe(item)}`)}</li>`,
    );
    parts.push(`<p>${escapeHtml(group.heading)}</p>`, `<ul>${items.join('')}</ul>`);
  }
  parts.push(`<p>Created by ${link(SKILL_URL, 'triage bot')} skill</p>`);
  return `<meta charset="utf-8">\n${parts.join('\n')}\n`;
}

/** The fields of an issue or PR that `itemActions` reads. */
export const ITEM_FRAGMENT = `
fragment item on IssueOrPullRequest {
  __typename
  ... on Issue {
    id number title url state
    comments(last: 100) { nodes { author { login } body createdAt } }
    timelineItems(last: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
      nodes { ...issueEvent }
    }
  }
  ... on PullRequest {
    id number title url state
    comments(last: 100) { nodes { author { login } body createdAt } }
    timelineItems(last: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
      nodes { ...pullRequestEvent }
    }
  }
}

fragment issueEvent on IssueTimelineItems { ...event }
fragment pullRequestEvent on PullRequestTimelineItems { ...event }

fragment event on Node {
  __typename
  ... on LabeledEvent { createdAt actor { login } label { name } }
  ... on UnlabeledEvent { createdAt actor { login } label { name } }
  ... on AssignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
  ... on UnassignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
  ... on ClosedEvent { createdAt actor { login } stateReason closer { __typename } duplicateOf { ... on Issue { number } ... on PullRequest { number } } }
  ... on ReopenedEvent { createdAt actor { login } }
}
`;

/**
 * Builds a query that reads the items with the given numbers, each under the
 * alias `i<number>`.
 *
 * It reads the items by number rather than through `search`, because `search`
 * can return stale timelines. The timeline is the last 100 events rather than
 * the events `since` a time, because GitHub applies `since` after it takes a
 * page of events, so a long timeline can come back empty.
 */
export function itemsQuery(numbers: number[]): string {
  const fields = numbers
    .map(number => `    i${number}: issueOrPullRequest(number: ${number}) { ...item }`)
    .join('\n');
  return `query {\n  repository(owner: "${OWNER}", name: "${REPO}") {\n${fields}\n  }\n}\n${ITEM_FRAGMENT}`;
}

/** Formats a date for GitHub search, as an ISO 8601 time without milliseconds. */
export const searchTime = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const run = promisify(execFile);

/** Runs `gh` with `args`, and returns what it prints. */
async function gh(args: string[]): Promise<string> {
  const {stdout} = await run('gh', args, {maxBuffer: 256 * 1024 * 1024});
  return stdout;
}

/** GitHub search returns at most this many results for a query. */
const SEARCH_LIMIT = 1000;

/** Returns the numbers of the items updated in `period`. */
async function updatedItems(period: Period): Promise<number[]> {
  const q = `repo:${OWNER}/${REPO} updated:${searchTime(period.since)}..${searchTime(period.until)}`;
  // Sorting by creation keeps the pages stable while items are updated, so no
  // item moves to a page that was already read.
  const search = [
    'api', '-X', 'GET', 'search/issues',
    '-f', `q=${q}`, '-f', 'sort=created', '-f', 'order=asc', '-f', 'per_page=100',
  ];
  const first = JSON.parse(await gh(search)) as {total_count: number};
  if (first.total_count > SEARCH_LIMIT) {
    // Split the period in two, so that each half fits in the search limit.
    const middle = new Date((period.since.getTime() + period.until.getTime()) / 2);
    const halves = await Promise.all([
      updatedItems({since: period.since, until: middle}),
      updatedItems({since: new Date(middle.getTime() + 1000), until: period.until}),
    ]);
    return [...new Set(halves.flat())];
  }
  const pages = JSON.parse(await gh([...search, '--paginate', '--slurp'])) as {
    items: {number: number}[];
  }[];
  return [...new Set(pages.flatMap(page => page.items.map(item => item.number)))];
}

/** Runs `task` on each value, with at most `limit` tasks at a time. */
async function inParallel<T, R>(values: T[], limit: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await task(values[index]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, values.length)}, worker));
  return results;
}

const BATCH = 20;

/** Reads the items with the given numbers. */
async function readItems(numbers: number[]): Promise<RawItem[]> {
  const batches: number[][] = [];
  for (let i = 0; i < numbers.length; i += BATCH) batches.push(numbers.slice(i, i + BATCH));
  const results = await inParallel(batches, 4, async batch => {
    const response = JSON.parse(await gh(['api', 'graphql', '-f', `query=${itemsQuery(batch)}`])) as {
      data: {repository: Record<string, RawItem | null>};
    };
    return Object.values(response.data.repository).filter((item): item is RawItem => item !== null);
  });
  return results.flat();
}

/** Collects what `login` triaged in `period`. */
async function collect(login: string, period: Period): Promise<Report> {
  const [numbers, stillNeedTriage] = await Promise.all([
    updatedItems(period),
    gh([
      'api', '-X', 'GET', 'search/issues',
      '-f', `q=repo:${OWNER}/${REPO} is:open label:"${NEEDS_TRIAGE}"`,
      '-f', 'per_page=1', '-q', '.total_count',
    ]).then(Number),
  ]);
  const items = (await readItems(numbers))
    .map(item => itemActions(item, login, period))
    .filter((item): item is ItemActions => item !== null)
    .sort((a, b) => a.number - b.number);
  return {login, period, items, stillNeedTriage};
}

/** JavaScript for Automation that puts an HTML file and a text file on the clipboard. */
const COPY_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  const read = path => $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  const board = $.NSPasteboard.generalPasteboard;
  board.clearContents;
  board.setStringForType(read(argv[0]), $.NSPasteboardTypeHTML);
  board.setStringForType(read(argv[1]), $.NSPasteboardTypeString);
}
`;

/** Puts the report files on the macOS clipboard. */
async function copy(htmlPath: string, textPath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('--copy works only on macOS. Copy report.html or report.txt yourself.');
  }
  await run('osascript', ['-l', 'JavaScript', '-e', COPY_SCRIPT, htmlPath, textPath]);
}

/** An item in items.json. */
interface ItemRef {
  id: string;
  url: string;
}

const UNSUBSCRIBE = `
mutation($id: ID!) {
  updateSubscription(input: {subscribableId: $id, state: UNSUBSCRIBED}) {
    subscribable { viewerSubscription }
  }
}`;

/** Unsubscribes the `gh` account from the items, and prints the outcome. */
async function unsubscribe(items: ItemRef[]): Promise<void> {
  const failures = (
    await inParallel(items, 4, async item => {
      try {
        await gh(['api', 'graphql', '-f', `query=${UNSUBSCRIBE}`, '-f', `id=${item.id}`]);
        return null;
      } catch (error) {
        return `${item.url}: ${(error as Error).message.trim()}`;
      }
    })
  ).filter((failure): failure is string => failure !== null);
  console.log(`Unsubscribed from ${count(items.length - failures.length, 'item')}.`);
  if (failures.length) {
    console.log(`Failed for ${count(failures.length, 'item')}:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

const USAGE = `Usage:
  node .agents/skills/a2ui-triage-bot/scripts/triage_report.mts report --since <date> [--until <date>] [--login <login>] --out <dir> [--copy]
  node .agents/skills/a2ui-triage-bot/scripts/triage_report.mts unsubscribe <dir>/items.json`;

async function main(args: string[]): Promise<void> {
  const {values, positionals} = parseArgs({
    args,
    allowPositionals: true,
    options: {
      since: {type: 'string'},
      until: {type: 'string'},
      login: {type: 'string'},
      out: {type: 'string'},
      copy: {type: 'boolean', default: false},
    },
  });
  const [command, file] = positionals;
  if (command === 'unsubscribe' && file) {
    await unsubscribe(JSON.parse(await readFile(file, 'utf8')) as ItemRef[]);
    return;
  }
  if (command !== 'report' || !values.since || !values.out) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const period = {
    since: parseDate(values.since, false),
    until: values.until ? parseDate(values.until, true) : new Date(),
  };
  const login = values.login ?? (await gh(['api', 'user', '-q', '.login'])).trim();
  const report = await collect(login, period);
  await mkdir(values.out, {recursive: true});
  const textPath = join(values.out, 'report.txt');
  const htmlPath = join(values.out, 'report.html');
  const text = renderText(report);
  await writeFile(textPath, text);
  await writeFile(htmlPath, renderHtml(report));
  const refs: ItemRef[] = report.items.map(({id, url}) => ({id, url}));
  await writeFile(join(values.out, 'items.json'), JSON.stringify(refs, null, 2) + '\n');
  if (values.copy) await copy(htmlPath, textPath);
  process.stdout.write(text);
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}

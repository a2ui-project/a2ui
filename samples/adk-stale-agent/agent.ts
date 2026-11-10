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

import {FunctionTool, LlmAgent} from '@google/adk';
import {parseISO} from 'date-fns';
import {DateTime} from 'luxon';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {
  CLOSE_HOURS_AFTER_STALE_THRESHOLD,
  GITHUB_BASE_URL,
  GRAPHQL_COMMENT_LIMIT,
  GRAPHQL_EDIT_LIMIT,
  GRAPHQL_TIMELINE_LIMIT,
  LLM_MODEL_NAME,
  OWNER,
  REPO,
  REQUEST_CLARIFICATION_LABEL,
  STALE_HOURS_THRESHOLD,
  STALE_LABEL_NAME,
} from './settings.js';
import {
  deleteRequest,
  errorResponse,
  getRequest,
  patchRequest,
  postRequest,
  RequestException,
} from './utils.js';

export const BOT_ALERT_SIGNATURE = '**Notification:** The author has updated the issue description';
export const BOT_NAME = 'adk-bot';

// --- Global Cache ---
let maintainersCache: string[] | null = null;

export interface HistoryEvent {
  type: 'created' | 'commented' | 'edited_description' | 'renamed_title' | 'reopened';
  actor: string | null;
  time: Date;
  data: string | null;
}

export interface IssueState {
  last_action_role: 'author' | 'maintainer' | 'other_user';
  last_activity_time: Date;
  last_action_type: HistoryEvent['type'];
  last_comment_text: string | null;
  last_actor_name: string | null;
}

/**
 * Replays a unified, chronological history to determine the last actor and state.
 *
 * @param history Chronologically sorted events
 * @param maintainers List of GitHub maintainers
 * @param issueAuthor Username of the issue author
 * @returns The last state of the issue
 */
export function replayHistoryToFindState(
  history: HistoryEvent[],
  maintainers: string[],
  issueAuthor: string,
): IssueState {
  let last_action_role: IssueState['last_action_role'] = 'author';
  let last_activity_time: Date = history[0]?.time ?? new Date(0);
  let last_action_type: HistoryEvent['type'] = 'created';
  let last_comment_text: string | null = null;
  let last_actor_name: string | null = issueAuthor;

  for (const event of history) {
    const actor = event.actor;
    const etype = event.type;

    // Determine role
    let role: IssueState['last_action_role'] = 'other_user';
    if (actor === issueAuthor) {
      role = 'author';
    } else if (actor && maintainers.includes(actor)) {
      role = 'maintainer';
    }

    last_action_role = role;
    last_activity_time = event.time;
    last_action_type = etype;
    last_actor_name = actor;

    // Only store text if it's a comment
    if (etype === 'commented') {
      last_comment_text = event.data ?? null;
    }
  }

  return {
    last_action_role,
    last_activity_time,
    last_action_type,
    last_comment_text,
    last_actor_name,
  };
}

export interface IssueGraphQLData {
  author?: {login: string} | null;
  createdAt: string;
  comments?: {
    nodes: Array<{
      author?: {login: string} | null;
      body?: string;
      createdAt: string;
      lastEditedAt?: string | null;
    } | null>;
  };
  userContentEdits?: {
    nodes: Array<{
      editor?: {login: string} | null;
      editedAt: string;
    } | null>;
  };
  timelineItems?: {
    nodes: Array<
      | {
          __typename: 'LabeledEvent';
          createdAt: string;
          actor?: {login: string} | null;
          label?: {name: string} | null;
        }
      | {
          __typename: 'RenamedTitleEvent' | 'ReopenedEvent';
          createdAt: string;
          actor?: {login: string} | null;
        }
      | null
    >;
  };
}
/**
 * Parses raw GraphQL issue data into a normalized, chronological history.
 *
 * @param data Raw issue object from fetchGraphqlData
 * @returns [history, labelEvents, lastBotAlertTime]
 *   - history: array of HistoryEvent objects
 *   - labelEvents: array of Date when stale label was applied
 *   - lastBotAlertTime: Date of last bot alert for silent edits, or null
 */
export function buildHistoryTimeline(
  data: IssueGraphQLData,
): [HistoryEvent[], Date[], Date | null] {
  const issueAuthor = data.author?.login ?? null;
  const history: HistoryEvent[] = [];
  const labelEvents: Date[] = [];
  let lastBotAlertTime: Date | null = null;

  // 1. Baseline: Issue creation
  history.push({
    type: 'created',
    actor: issueAuthor,
    time: parseISO(data.createdAt),
    data: null,
  });

  // 2. Process comments
  for (const c of data.comments?.nodes ?? []) {
    if (!c) continue;

    const actor = c.author?.login ?? null;
    const cBody = c.body ?? '';
    const cTime = parseISO(c.createdAt);

    // Track bot alerts for spam prevention
    if (cBody.includes(BOT_ALERT_SIGNATURE)) {
      if (!lastBotAlertTime || cTime > lastBotAlertTime) {
        lastBotAlertTime = cTime;
      }
      continue;
    }

    if (actor && !actor.endsWith('[bot]') && actor !== BOT_NAME) {
      const actualTime = c.lastEditedAt ? parseISO(c.lastEditedAt) : cTime;

      history.push({
        type: 'commented',
        actor,
        time: actualTime,
        data: cBody,
      });
    }
  }

  // 3. Process userContentEdits ("Ghost Edits")
  for (const e of data.userContentEdits?.nodes ?? []) {
    if (!e) continue;
    const actor = e.editor?.login ?? null;

    if (actor && !actor.endsWith('[bot]') && actor !== BOT_NAME) {
      history.push({
        type: 'edited_description',
        actor,
        time: parseISO(e.editedAt),
        data: null,
      });
    }
  }

  // 4. Process timeline items
  for (const t of data.timelineItems?.nodes ?? []) {
    if (!t) continue;

    const etype = t.__typename;
    const actor = t.actor?.login ?? null;
    const timeVal = parseISO(t.createdAt);

    if (etype === 'LabeledEvent') {
      if (t.label?.name === STALE_LABEL_NAME) {
        labelEvents.push(timeVal);
      }
      continue;
    }

    if (actor && !actor.endsWith('[bot]') && actor !== BOT_NAME) {
      const prettyType = etype === 'RenamedTitleEvent' ? 'renamed_title' : 'reopened';

      history.push({
        type: prettyType,
        actor,
        time: timeVal,
        data: null,
      });
    }
  }

  // Sort chronologically
  history.sort((a, b) => a.time.getTime() - b.time.getTime());

  return [history, labelEvents, lastBotAlertTime];
}

interface IssueComment {
  author: {login: string} | null;
  body: string;
  createdAt: string;
  lastEditedAt: string | null;
}

interface IssueEdit {
  editor: {login: string} | null;
  editedAt: string;
}

interface TimelineItem {
  __typename: 'LabeledEvent' | 'RenamedTitleEvent' | 'ReopenedEvent';
  createdAt: string;
  actor: {login: string} | null;
  label?: {name: string};
}

interface Issue {
  author: {login: string} | null;
  createdAt: string;
  labels: {nodes: {name: string}[]};
  comments: {nodes: IssueComment[]};
  userContentEdits: {nodes: IssueEdit[]};
  timelineItems: {nodes: TimelineItem[]};
}

interface GraphqlResponse {
  data?: {
    repository?: {
      issue?: Issue;
    };
  };
  errors?: {message: string}[];
}

/**
 * Fetches raw GitHub issue data using GraphQL, including comments, edits, and timeline events.
 * Throws RequestException if the issue is not found or GraphQL errors occur.
 *
 * @param item_number The GitHub issue number
 * @returns The raw 'issue' object from the GraphQL response
 * @throws RequestException
 */
async function fetchGraphqlData(item_number: number): Promise<Issue> {
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $commentLimit: Int!, $timelineLimit: Int!, $editLimit: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) {
          author { login }
          createdAt
          labels(first: 20) { nodes { name } }

          comments(last: $commentLimit) {
            nodes {
              author { login }
              body
              createdAt
              lastEditedAt
            }
          }

          userContentEdits(last: $editLimit) {
            nodes {
              editor { login }
              editedAt
            }
          }

          timelineItems(itemTypes: [LABELED_EVENT, RENAMED_TITLE_EVENT, REOPENED_EVENT], last: $timelineLimit) {
            nodes {
              __typename
              ... on LabeledEvent {
                createdAt
                actor { login }
                label { name }
              }
              ... on RenamedTitleEvent {
                createdAt
                actor { login }
              }
              ... on ReopenedEvent {
                createdAt
                actor { login }
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    owner: OWNER,
    name: REPO,
    number: item_number,
    commentLimit: GRAPHQL_COMMENT_LIMIT,
    editLimit: GRAPHQL_EDIT_LIMIT,
    timelineLimit: GRAPHQL_TIMELINE_LIMIT,
  };

  const response = await postRequest<
    GraphqlResponse,
    {query: string; variables: Record<string, unknown>}
  >(`${GITHUB_BASE_URL}/graphql`, {query, variables});

  if (response.errors && response.errors.length > 0) {
    throw new RequestException(`GraphQL Error: ${response.errors[0].message}`);
  }

  const issue = response?.data?.repository?.issue;
  if (!issue) {
    throw new RequestException(`Issue #${item_number} not found.`);
  }

  return issue;
}

interface GitHubUser {
  login: string;
}

/**
 * Fetches the list of repository maintainers with push access.
 * Uses caching to prevent repeated API calls.
 *
 * Throws an error if API fails or returns invalid data.
 *
 * @returns {Promise<string[]>} List of GitHub usernames
 */
export async function getCachedMaintainers(): Promise<string[]> {
  if (maintainersCache) {
    return maintainersCache;
  }

  console.info('Initializing Maintainers Cache...');

  try {
    const url = `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/collaborators`;

    let page = 1;
    let hasMore = true;
    let allCollaborators: GitHubUser[] = [];

    // Loop to fetch all pages of collaborators
    while (hasMore) {
      // Set per_page to maximum (100) and request the current page number
      const params = {permission: 'push', per_page: 100, page: page};

      // Fetch the data for the current page
      const data = await getRequest<GitHubUser[]>(url, params);

      // Add the newly fetched users to our complete list
      allCollaborators = allCollaborators.concat(data);

      // If the API returns exactly 100 items, there is likely another page.
      // If it returns fewer than 100, we have reached the end of the list.
      if (data.length === 100) {
        page++;
      } else {
        hasMore = false;
      }
    }

    // Map over the completely assembled list
    maintainersCache = allCollaborators.map(u => u.login);

    console.info(`Cached ${maintainersCache.length} maintainers.`);
    return maintainersCache;
  } catch (error: unknown) {
    console.error(`FATAL: Failed to verify repository maintainers. Error:`, error);
    throw new Error('Maintainer verification failed. Processing aborted.');
  }
}

/**
 * Async function to retrieve the comprehensive state of a GitHub issue.
 */
async function getIssueState({item_number}: {item_number: number}) {
  try {
    // Maintainers cache
    const maintainers = await getCachedMaintainers();

    //  Fetch issue data via GraphQL
    const rawData = await fetchGraphqlData(item_number);

    const issueAuthor = rawData.author?.login ?? 'unknown';
    const labelsList: string[] = rawData.labels?.nodes.map(l => l.name) || [];

    //  Parse & sort history
    const [history, labelEvents, lastBotAlertTime] = buildHistoryTimeline(rawData);

    //  Replay history to determine state
    const state = replayHistoryToFindState(history, maintainers, issueAuthor);

    //  Calculate time-based metrics
    const currentTime = DateTime.utc();
    const daysSinceActivity = currentTime.diff(
      DateTime.fromJSDate(state.last_activity_time),
      'days',
    ).days;

    // Stale label logic
    const isStale = labelsList.includes(STALE_LABEL_NAME);
    let daysSinceStaleLabel = 0.0;
    if (isStale && labelEvents.length) {
      const latestLabelTime = new Date(Math.max(...labelEvents.map(d => d.getTime())));
      daysSinceStaleLabel = currentTime.diff(DateTime.fromJSDate(latestLabelTime), 'days').days;
    }

    // Silent edit alert logic
    let maintainerAlertNeeded = false;
    if (
      ['author', 'other_user'].includes(state.last_action_role) &&
      state.last_action_type === 'edited_description'
    ) {
      if (lastBotAlertTime && lastBotAlertTime > state.last_activity_time) {
        console.info(`#${item_number}: Silent edit detected, but Bot already alerted. No spam.`);
      } else {
        maintainerAlertNeeded = true;
        console.info(`#${item_number}: Silent edit detected. Alert needed.`);
      }
    }

    console.debug(
      `#${item_number} VERDICT: Role=${state.last_action_role}, Idle=${daysSinceActivity.toFixed(2)}d`,
    );

    //  Return comprehensive state
    return {
      status: 'success',
      last_action_role: state.last_action_role,
      last_action_type: state.last_action_type,
      last_actor_name: state.last_actor_name,
      maintainer_alert_needed: maintainerAlertNeeded,
      is_stale: isStale,
      days_since_activity: daysSinceActivity,
      days_since_stale_label: daysSinceStaleLabel,
      last_comment_text: state.last_comment_text,
      current_labels: labelsList,
      stale_threshold_days: STALE_HOURS_THRESHOLD / 24,
      close_threshold_days: CLOSE_HOURS_AFTER_STALE_THRESHOLD / 24,
      maintainers,
      issue_author: issueAuthor,
    };
  } catch (e: unknown) {
    if (e instanceof RequestException) {
      return errorResponse(`Network Error: ${e.message}`);
    }

    console.error(`Unexpected error analyzing #${item_number}:`, e);

    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`Analysis Error: ${message}`);
  }
}

export const get_issue_state = new FunctionTool({
  name: 'get_issue_state',
  description:
    'Retrieves the comprehensive state of a GitHub issue, including staleness, activity, and maintainer alerts.',
  parameters: z.object({
    item_number: z.number().describe('The GitHub issue number to analyze.'),
  }),
  execute: getIssueState,
});

interface CloseIssuePayload {
  state: 'closed';
}

interface SuccessResponse {
  status: 'success';
}
/**
 * Async function to close a GitHub issue as stale.
 */
async function closeAsStale({
  item_number,
}: {
  item_number: number;
}): Promise<SuccessResponse | ReturnType<typeof errorResponse>> {
  const days_str = formatDays(CLOSE_HOURS_AFTER_STALE_THRESHOLD);

  const comment = `This has been automatically closed because it has been marked as stale for over ${days_str} days.`;

  try {
    // Post closure comment — typed payload
    await postRequest<{id: number}>(
      `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}/comments`,
      {body: comment},
    );

    // Close the issue — typed payload
    await patchRequest<{number: number}, CloseIssuePayload>(
      `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}`,
      {state: 'closed'},
    );

    return {status: 'success'};
  } catch (error: unknown) {
    return errorResponse(`Error closing issue: ${error}`);
  }
}

export const close_as_stale = new FunctionTool({
  name: 'close_as_stale',
  description: 'Closes a GitHub issue that has been marked as stale.',
  parameters: z.object({
    item_number: z.number().describe('The GitHub issue number to close as stale.'),
  }),
  execute: closeAsStale,
});

/**
 * Async function to alert maintainers of an issue description edit.
 */
async function alertMaintainerOfEdit({item_number}: {item_number: number}) {
  const comment = `${BOT_ALERT_SIGNATURE}. Maintainers, please review.`;

  try {
    await postRequest<{id: number}, {body: string}>(
      `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}/comments`,
      {body: comment},
    );

    return {status: 'success'};
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`Error posting alert: ${message}`);
  }
}

export const alert_maintainer_of_edit = new FunctionTool({
  name: 'alert_maintainer_of_edit',
  description: 'Posts a comment alerting maintainers of a silent description update.',
  parameters: z.object({
    item_number: z.number().describe('The GitHub issue number to alert maintainers about.'),
  }),
  execute: alertMaintainerOfEdit,
});

/**
 * Formats a duration in hours into a clean day string.
 *
 * Examples:
 *   168 -> "7"
 *   12  -> "0.5"
 */
function formatDays(hours: number): string {
  const days = hours / 24;
  // Return integer if whole, otherwise one decimal
  return days % 1 === 0 ? `${days}` : days.toFixed(1);
}

async function addStaleLabelAndComment({item_number}: {item_number: number}) {
  const stale_days_str = formatDays(STALE_HOURS_THRESHOLD);
  const close_days_str = formatDays(CLOSE_HOURS_AFTER_STALE_THRESHOLD);

  const comment = `This issue has been automatically marked as stale because it has not had recent activity for ${stale_days_str} days after a maintainer requested clarification. It will be closed if no further activity occurs within ${close_days_str} days.`;

  try {
    // Add comment
    await postRequest<{id: number}, {body: string}>(
      `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}/comments`,
      {body: comment},
    );

    // Add stale label
    await postRequest<{name: string}[], string[]>(
      `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}/labels`,
      [STALE_LABEL_NAME],
    );

    return {status: 'success'};
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`Error marking issue as stale: ${message}`);
  }
}

const add_stale_label_and_comment = new FunctionTool({
  name: 'add_stale_label_and_comment',
  description: 'Marks a GitHub issue as stale with a comment and label.',
  parameters: z.object({
    item_number: z.number().describe('The GitHub issue number to mark as stale.'),
  }),
  execute: addStaleLabelAndComment,
});

async function addLabelToIssue({
  item_number,
  label_name,
}: {
  item_number: number;
  label_name: string;
}) {
  console.debug(`Adding label '${label_name}' to issue #${item_number}.`);

  const url = `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}/labels`;

  try {
    await postRequest<number[], string[]>(url, [label_name]);
    return {status: 'success'};
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`Error adding label: ${message}`);
  }
}

const add_label_to_issue = new FunctionTool({
  name: 'add_label_to_issue',
  description: 'Adds a label to a GitHub issue.',
  parameters: z.object({
    item_number: z.number().describe('The GitHub issue number to which the label should be added.'),
    label_name: z.string().describe('The name of the label to add.'),
  }),
  execute: addLabelToIssue,
});

export async function removeLabelFromIssue({
  item_number,
  label_name,
}: {
  item_number: number;
  label_name: string;
}) {
  console.debug(`Removing label '${label_name}' from issue #${item_number}.`);

  const url = `${GITHUB_BASE_URL}/repos/${OWNER}/${REPO}/issues/${item_number}/labels/${label_name}`;

  try {
    await deleteRequest(url);
    return {status: 'success'};
  } catch (error: unknown) {
    return errorResponse(`Error removing label: ${error}`);
  }
}

export const remove_label_from_issue = new FunctionTool({
  name: 'remove_label_from_issue',
  description: 'Removes a label from a GitHub issue.',
  parameters: z.object({
    item_number: z
      .number()
      .describe('The GitHub issue number from which the label should be removed.'),
    label_name: z.string().describe('The name of the label to remove.'),
  }),
  execute: removeLabelFromIssue,
});

/**
 * Loads the raw text content of a prompt file.
 *
 * @param filename - The name of the file (e.g., "PROMPT_INSTRUCTION.txt")
 * @returns The file content
 */
export function loadPromptTemplate(filename: string): string {
  // Resolve path relative to the current module file
  const filePath = new URL(filename, import.meta.url);
  return readFileSync(fileURLToPath(filePath), 'utf-8');
}

function formatPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

const PROMPT_TEMPLATE = loadPromptTemplate('PROMPT_INSTRUCTION.txt');

export const rootAgent = new LlmAgent({
  model: LLM_MODEL_NAME,
  name: 'adk_repository_auditor_agent',
  description: 'Audits open issues.',
  instruction: formatPrompt(PROMPT_TEMPLATE, {
    OWNER,
    REPO,
    STALE_LABEL_NAME,
    REQUEST_CLARIFICATION_LABEL,
    stale_threshold_days: STALE_HOURS_THRESHOLD / 24,
    close_threshold_days: CLOSE_HOURS_AFTER_STALE_THRESHOLD / 24,
  }),
  tools: [
    add_label_to_issue,
    add_stale_label_and_comment,
    alert_maintainer_of_edit,
    close_as_stale,
    get_issue_state,
    remove_label_from_issue,
  ],
});

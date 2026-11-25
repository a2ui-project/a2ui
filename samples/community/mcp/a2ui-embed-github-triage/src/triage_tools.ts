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
 * The triage tools and actions: reads GitHub, composes the views and
 * summaries, and routes every write through the dry-run layer.
 */

import {createHash} from 'node:crypto';

import type {JsonModel} from './ai/json_model.js';
import {MAX_SUGGESTION_ISSUES, suggestTriage, type TriageSuggestion} from './ai/suggest.js';
import {
  type A2uiMessage,
  createSurfaceMessages,
  updateComponents,
  updateData,
} from './compose/a2ui.js';
import {
  composeDashboard,
  dashboardUpdateMessages,
  summarizeDashboard,
  type DashboardInput,
} from './compose/dashboard_view.js';
import type {ActionArgs} from './compose/events.js';
import {
  emptyBulkForm,
  filterFormData,
  INBOX_SURFACE,
  composeInbox,
  inboxData,
  previewRows,
  summarizeInbox,
  type InboxInput,
} from './compose/inbox_view.js';
import {
  assigneePicker,
  backToFormMessages,
  composeIssueContent,
  composeTriageForm,
  currentForm,
  issueSurfaceId,
  previewMessages,
  replyPreviewMessages,
  sourceText,
  summarizeIssue,
  triageSurfaceId,
  type FormSource,
  type IssueInput,
  type TriageForm,
} from './compose/issue_view.js';
import {
  composePullContent,
  composeReviewForm,
  reviewBackMessages,
  reviewPreviewMessages,
  summarizePull,
  type PullInput,
} from './compose/pull_view.js';
import {
  composeSuggestions,
  suggestedForm,
  SUGGESTIONS_SURFACE,
  summarizeSuggestions,
} from './compose/suggestions_view.js';
import type {GhIssue, GitHubSource, ReviewEvent} from './github/types.js';
import {
  describeChange,
  planTriage,
  TriageWriter,
  type ApplyResult,
  type ItemPlan,
  type TriageDecision,
} from './github/writes.js';
import {type DashboardFilters, dashboardStats, normalizeFilters} from './triage/dashboard_stats.js';
import {
  filterIssues,
  INBOX_PAGE_SIZE,
  normalizeFilter,
  type InboxFilter,
  type InboxSort,
} from './triage/inbox_filter.js';
import {pickerAssignees} from './triage/assignees.js';
import {
  COMPONENT_PREFIX,
  priorityProblems,
  TRIAGE_PRIORITIES,
  TYPE_PREFIX,
} from './triage/rules.js';

/** What a tool or action returns. */
export interface TriageOutput {
  readonly text: string;
  readonly a2ui: A2uiMessage[];
}

/** Dependencies of {@link TriageTools}. */
export interface TriageToolsOptions {
  readonly github: GitHubSource;
  readonly writer: TriageWriter;
  readonly model?: JsonModel;
  /** The clock; fixture mode uses the capture time so ages stay stable. */
  readonly now?: () => Date;
}

/**
 * Longest wait for Gemini in the `suggest` action. The app gives up on a tool
 * call after about 60 seconds, so the action answers with a status first.
 */
export const SUGGEST_TIMEOUT_MS = 45_000;

/** Rejects when `promise` takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A short, stable key of a plan, so a confirm only writes what was previewed. */
export function planKey(plans: readonly ItemPlan[]): string {
  return createHash('sha256').update(JSON.stringify(plans)).digest('hex').slice(0, 16);
}

type FilterForm = ActionArgs<'filter_inbox'>['filter'];
type InboxRows = ActionArgs<'load_more'>['issues'];

function filterFromForm(form: FilterForm | undefined): InboxFilter {
  return normalizeFilter({
    labels: form?.labels,
    author: form?.author,
    text: form?.text,
    sort: form?.sort[0] as InboxSort | undefined,
    onlyUntriaged: form?.onlyUntriaged,
  });
}

function selectedNumbers(rows: InboxRows | undefined): Set<number> {
  return new Set((rows ?? []).filter(row => row.selected).map(row => row.number));
}

function describeResult(result: ApplyResult, items: number): string {
  if (result.planned === 0) return 'Nothing to change.';
  const changes = `${result.planned} change${result.planned === 1 ? '' : 's'} to ${items} item${items === 1 ? '' : 's'}`;
  if (result.dryRun) return `Dry run: ${changes} not written because ${result.reason}.`;
  const errors =
    result.errors.length > 0 ? ` ${result.errors.length} failed: ${result.errors.join('; ')}` : '';
  return `Wrote ${result.written} of ${changes}.${errors}`;
}

/** The domain behind every tool and action of the sample. */
export class TriageTools {
  private readonly github: GitHubSource;
  private readonly writer: TriageWriter;
  private readonly model: JsonModel | undefined;
  private readonly now: () => Date;

  constructor(options: TriageToolsOptions) {
    this.github = options.github;
    this.writer = options.writer;
    this.model = options.model;
    this.now = options.now ?? (() => new Date());
  }

  get repo(): string {
    return this.github.repo;
  }

  get hasModel(): boolean {
    return this.model !== undefined;
  }

  // Inbox.

  private async inboxInput(
    filter: InboxFilter,
    shown: number,
    selected: ReadonlySet<number>,
    fresh = false,
  ): Promise<InboxInput> {
    const [issues, labels, assignees] = await Promise.all([
      this.github.listOpenIssues({fresh}),
      this.github.listLabels(),
      this.github.listAssignees(),
    ]);
    return {
      repo: this.repo,
      filter,
      matching: filterIssues(issues, filter),
      shown,
      labels,
      assignees: pickerAssignees(assignees, issues),
      dryRunReason: this.writer.dryRunReason,
      now: this.now(),
      selected,
    };
  }

  /** `triage_inbox(filter?)`. */
  async inbox(filter: Partial<InboxFilter> = {}): Promise<TriageOutput> {
    const input = await this.inboxInput(normalizeFilter(filter), INBOX_PAGE_SIZE, new Set());
    return {text: summarizeInbox(input), a2ui: createSurfaceMessages(composeInbox(input))};
  }

  private inboxUpdate(surfaceId: string, input: InboxInput): A2uiMessage[] {
    return [
      updateData(surfaceId, '/filter', filterFormData(input.filter)),
      ...Object.entries(inboxData(input)).map(([key, value]) =>
        updateData(surfaceId, `/${key}`, value),
      ),
    ];
  }

  /** `filter_inbox`: applies the filter form in place; selections reset. */
  async filterInbox(args: ActionArgs<'filter_inbox'>, surfaceId: string): Promise<TriageOutput> {
    const input = await this.inboxInput(filterFromForm(args.filter), INBOX_PAGE_SIZE, new Set());
    return {
      text: summarizeInbox(input),
      a2ui: [
        ...this.inboxUpdate(surfaceId, input),
        updateData(surfaceId, '/bulk', emptyBulkForm()),
      ],
    };
  }

  /** `load_more`: shows another page, keeping selections. */
  async loadMore(args: ActionArgs<'load_more'>, surfaceId: string): Promise<TriageOutput> {
    const input = await this.inboxInput(
      filterFromForm(args.filter),
      args.issues.length + INBOX_PAGE_SIZE,
      selectedNumbers(args.issues),
    );
    return {text: summarizeInbox(input), a2ui: this.inboxUpdate(surfaceId, input)};
  }

  /** `refresh` of the inbox: re-reads GitHub, keeping the page size and selections. */
  async refreshInbox(args: ActionArgs<'refresh'>, surfaceId: string): Promise<TriageOutput> {
    const input = await this.inboxInput(
      filterFromForm(args.filter),
      Math.max(INBOX_PAGE_SIZE, args.issues?.length ?? 0),
      selectedNumbers(args.issues),
      true,
    );
    return {text: summarizeInbox(input), a2ui: this.inboxUpdate(surfaceId, input)};
  }

  /** `bulk_dialog`: names the selected issues when the dialog opens. */
  bulkDialog(args: ActionArgs<'bulk_dialog'>, surfaceId: string): TriageOutput {
    const selected = [...selectedNumbers(args.issues)];
    const selection =
      selected.length === 0
        ? 'No issue is selected yet: close this dialog and tick some issues.'
        : `${selected.length} selected: ${selected.map(number => `#${number}`).join(', ')}`;
    return {text: selection, a2ui: [updateData(surfaceId, '/bulk/selection', selection)]};
  }

  private async bulkPlans(
    numbers: readonly number[],
    bulk: ActionArgs<'bulk_apply'>['bulk'],
  ): Promise<ItemPlan[]> {
    const [issues, labels, assignees] = await Promise.all([
      this.github.listOpenIssues(),
      this.github.listLabels(),
      this.github.listAssignees(),
    ]);
    const known = new Set(labels.map(label => label.name));
    const priority = bulk.priority[0];
    const assignee = bulk.assignee[0];
    const decision: TriageDecision = {
      priority:
        priority && (TRIAGE_PRIORITIES as readonly string[]).includes(priority)
          ? priority
          : undefined,
      addLabels: bulk.labels.filter(label => known.has(label) && !/^P\d$/.test(label)),
      assignee: assignee && assignees.some(user => user.login === assignee) ? assignee : undefined,
    };
    const byNumber = new Map(issues.map(issue => [issue.number, issue]));
    return numbers.flatMap(number => {
      const issue = byNumber.get(number);
      return issue ? [planTriage(issue, decision)] : [];
    });
  }

  /** `bulk_apply`: previews (confirm false) or applies (confirm true) the bulk edit. */
  async bulkApply(args: ActionArgs<'bulk_apply'>, surfaceId: string): Promise<TriageOutput> {
    const numbers = [...selectedNumbers(args.issues)];
    const status = (text: string, extra: A2uiMessage[] = []): TriageOutput => ({
      text,
      a2ui: [updateData(surfaceId, '/bulk/status', text), ...extra],
    });
    if (numbers.length === 0) return status('Select at least one issue first.');
    const plans = await this.bulkPlans(numbers, args.bulk);
    const key = planKey(plans);
    if (!args.confirm) {
      const changes = plans.reduce((count, plan) => count + plan.changes.length, 0);
      const text = `${changes} change${changes === 1 ? '' : 's'} to ${plans.length} issue${plans.length === 1 ? '' : 's'}. ${
        this.writer.dryRun
          ? 'Confirming is a dry run: nothing will be written.'
          : 'Confirm to write them to GitHub.'
      }`;
      return status(text, [
        updateData(surfaceId, '/bulk/preview', previewRows(plans)),
        updateData(surfaceId, '/bulk/previewKey', changes > 0 ? key : ''),
      ]);
    }
    if (args.bulk.previewKey !== key) {
      return status(
        'The selection or the form changed since the preview. Preview again before confirming.',
        [updateData(surfaceId, '/bulk/previewKey', '')],
      );
    }
    const result = await this.writer.apply(plans);
    const text = describeResult(result, plans.length);
    const extra: A2uiMessage[] = [updateData(surfaceId, '/bulk/previewKey', '')];
    if (!result.dryRun) {
      const input = await this.inboxInput(normalizeFilter(), INBOX_PAGE_SIZE, new Set(), true);
      extra.push(updateData(surfaceId, '/issues', inboxData(input).issues));
    }
    return status(text, extra);
  }

  // Issue.

  private async issueInput(
    number: number,
    form?: TriageForm,
    source?: FormSource,
  ): Promise<IssueInput> {
    const [issue, comments, labels, milestones, assignees, openIssues] = await Promise.all([
      this.github.getIssue(number),
      this.github.listComments(number),
      this.github.listLabels(),
      this.github.listMilestones(),
      this.github.listAssignees(),
      this.github.listOpenIssues(),
    ]);
    const initial = form ?? currentForm(issue);
    return {
      repo: this.repo,
      issue,
      comments,
      labels,
      milestones,
      // Keep any assignable user an AI suggestion may pick later.
      assignees: pickerAssignees(assignees, openIssues, [
        ...initial.assignee,
        ...issue.assignees.map(user => user.login),
      ]),
      form: initial,
      source: source ?? {kind: 'current'},
      dryRunReason: this.writer.dryRunReason,
      now: this.now(),
    };
  }

  /** `issue(number)`. */
  async issue(number: number): Promise<TriageOutput> {
    const input = await this.issueInput(number);
    return {
      text: summarizeIssue(input),
      a2ui: [
        ...createSurfaceMessages(composeIssueContent(input)),
        ...createSurfaceMessages(composeTriageForm(input)),
      ],
    };
  }

  private async suggestionsFor(issues: readonly GhIssue[]): Promise<TriageSuggestion[]> {
    if (!this.model) {
      throw new Error('AI suggestions need GEMINI_API_KEY in the server environment or .env file.');
    }
    const [labels, assignees, comments] = await Promise.all([
      this.github.listLabels(),
      this.github.listAssignees(),
      Promise.all(issues.map(issue => this.github.listComments(issue.number))),
    ]);
    return suggestTriage(
      this.model,
      issues.map((issue, index) => ({issue, comments: comments[index] ?? []})),
      {labels, assignees},
    );
  }

  /** `suggest`: pre-fills the issue's triage form with an AI suggestion, in place. */
  async suggestForIssue(args: ActionArgs<'suggest'>): Promise<TriageOutput> {
    const issue = await this.github.getIssue(args.number);
    const surfaceId = triageSurfaceId(args.number);
    let suggestion: TriageSuggestion | undefined;
    try {
      [suggestion] = await withTimeout(
        this.suggestionsFor([issue]),
        SUGGEST_TIMEOUT_MS,
        'The AI suggestion',
      );
    } catch (error) {
      const text = `The AI suggestion failed, so the form is unchanged: ${String(error).slice(0, 160)}`;
      return {text, a2ui: [updateData(surfaceId, '/status', text)]};
    }
    if (!suggestion) {
      return {
        text: 'The model returned no suggestion.',
        a2ui: [
          updateData(
            surfaceId,
            '/status',
            'The model returned no suggestion; the form is unchanged.',
          ),
        ],
      };
    }
    const form = suggestedForm(issue, suggestion);
    const source: FormSource = {kind: 'ai', rationale: suggestion.rationale};
    const [assignees, openIssues] = await Promise.all([
      this.github.listAssignees(),
      this.github.listOpenIssues(),
    ]);
    // Rebuild the assignee picker so the suggested assignee is one of its options.
    const picker = assigneePicker(
      pickerAssignees(assignees, openIssues, [
        ...form.assignee,
        ...issue.assignees.map(u => u.login),
      ]),
    );
    return {
      text: `Pre-filled the form for #${args.number} with an AI suggestion: ${suggestion.rationale}`,
      a2ui: [
        updateData(surfaceId, '/form', form),
        updateComponents(surfaceId, [picker]),
        updateData(surfaceId, '/source', sourceText(source, form)),
        updateData(surfaceId, '/status', 'Review the AI suggestion, then Apply.'),
      ],
    };
  }

  private async issuePlan(
    number: number,
    form: TriageForm,
  ): Promise<{plan: ItemPlan; problems: string[]}> {
    const [issue, labels, milestones, assignees] = await Promise.all([
      this.github.getIssue(number),
      this.github.listLabels(),
      this.github.listMilestones(),
      this.github.listAssignees(),
    ]);
    const known = new Set(labels.map(label => label.name));
    const priority = form.priority[0];
    const type = form.type[0];
    const assignee = form.assignee[0];
    const milestone = milestones.find(item => String(item.number) === form.milestone[0]);
    const problems = [
      ...(!priority || !(TRIAGE_PRIORITIES as readonly string[]).includes(priority)
        ? ['Choose a priority.']
        : []),
      ...(assignee && !assignees.some(user => user.login === assignee)
        ? [`@${assignee} cannot be assigned.`]
        : []),
      ...priorityProblems(
        priority,
        assignee ? [assignee] : issue.assignees.map(user => user.login),
        milestone?.number ?? issue.milestone?.number,
      ),
    ];
    const plan = planTriage(issue, {
      priority,
      type:
        type && known.has(type) && type.toLowerCase().startsWith(TYPE_PREFIX) ? type : undefined,
      components: form.components.filter(
        name => known.has(name) && name.toLowerCase().startsWith(COMPONENT_PREFIX),
      ),
      assignee,
      milestone: milestone ? {number: milestone.number, title: milestone.title} : undefined,
      reply: form.reply,
      markHandled: form.markHandled,
    });
    return {plan, problems};
  }

  /** `apply_triage`: preview, confirm or cancel for the issue view or one suggestion. */
  async applyTriage(args: ActionArgs<'apply_triage'>, surfaceId: string): Promise<TriageOutput> {
    const {plan, problems} = await this.issuePlan(args.number, args.form);
    const key = planKey([plan]);
    const suggestion = args.target === 'suggestion' && args.index !== undefined;
    const itemPath = (field: string) => `/items/${args.index}/${field}`;
    const setStatus = (text: string, extra: A2uiMessage[] = []): TriageOutput => ({
      text,
      a2ui: suggestion
        ? [updateData(surfaceId, itemPath('status'), text), ...extra]
        : [...backToFormMessages(args.number, text), ...extra],
    });
    if (args.mode === 'cancel') return setStatus('');
    if (problems.length > 0) return setStatus(problems.join(' '));
    if (args.mode === 'preview') {
      const text = `${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'} planned for #${plan.number}: ${plan.changes.map(describeChange).join(', ') || 'none'}.`;
      if (suggestion) {
        return {
          text,
          a2ui: [
            updateData(
              surfaceId,
              itemPath('plan'),
              plan.changes.map(change => ({text: describeChange(change)})),
            ),
            updateData(surfaceId, itemPath('planKey'), plan.changes.length > 0 ? key : ''),
            updateData(
              surfaceId,
              itemPath('status'),
              plan.changes.length > 0
                ? this.writer.dryRun
                  ? 'Confirming is a dry run.'
                  : 'Confirm to write.'
                : 'No change needed.',
            ),
          ],
        };
      }
      return {text, a2ui: previewMessages(plan, key, this.writer.dryRunReason)};
    }
    if (args.planKey !== key) {
      return setStatus(
        'The issue or the form changed since the preview. Apply again to see the new changes.',
        suggestion ? [updateData(surfaceId, itemPath('planKey'), '')] : [],
      );
    }
    const result = await this.writer.apply([plan]);
    const text = describeResult(result, 1);
    const extra: A2uiMessage[] = [];
    if (suggestion) extra.push(updateData(surfaceId, itemPath('planKey'), ''));
    if (!result.dryRun && !suggestion) {
      const issue = await this.github.getIssue(args.number);
      extra.push(
        updateData(
          issueSurfaceId(args.number),
          '/labels',
          issue.labels.map(label => ({name: label.name, color: label.color})),
        ),
      );
    }
    return setStatus(text, extra);
  }

  /** `preview_reply`: shows a canonical reply and copies it into the reply field. */
  previewReply(args: ActionArgs<'preview_reply'>): TriageOutput {
    const template = args.template[0];
    if (!template) return {text: 'No reply chosen.', a2ui: []};
    return {
      text: `Previewed the ${template} reply.`,
      a2ui: replyPreviewMessages(args.number, template),
    };
  }

  // Pull request.

  private async pullInput(number: number): Promise<PullInput> {
    const pull = await this.github.getPull(number);
    const [files, checks] = await Promise.all([
      this.github.listPullFiles(number),
      this.github.listCheckRuns(pull.headSha),
    ]);
    return {
      repo: this.repo,
      pull,
      files,
      checks,
      dryRunReason: this.writer.dryRunReason,
      now: this.now(),
    };
  }

  /** `pull_request(number)`. */
  async pullRequest(number: number): Promise<TriageOutput> {
    const input = await this.pullInput(number);
    return {
      text: summarizePull(input),
      a2ui: [
        ...createSurfaceMessages(composePullContent(input)),
        ...createSurfaceMessages(composeReviewForm(input)),
      ],
    };
  }

  /** `submit_review`: preview, confirm or cancel a review. */
  async submitReview(args: ActionArgs<'submit_review'>): Promise<TriageOutput> {
    const pull = await this.github.getPull(args.number);
    const reviewEvent = args.review.event[0] as ReviewEvent | undefined;
    const body = args.review.body.trim();
    const back = (text: string): TriageOutput => ({
      text,
      a2ui: reviewBackMessages(args.number, text),
    });
    if (args.mode === 'cancel') return back('');
    if (!reviewEvent) return back('Choose a review decision.');
    if (reviewEvent === 'REQUEST_CHANGES' && !body) return back('Explain the changes you request.');
    if (reviewEvent === 'APPROVE' && !Object.values(args.review.checklist).every(Boolean)) {
      return back('Tick every checklist item before approving.');
    }
    const plan: ItemPlan = {
      number: pull.number,
      title: pull.title,
      changes: [{kind: 'review', event: reviewEvent, body}],
    };
    const key = planKey([plan]);
    if (args.mode === 'preview') {
      return {
        text: `Review planned for #${pull.number}: ${describeChange(plan.changes[0]!)}.`,
        a2ui: reviewPreviewMessages(plan, key, this.writer.dryRunReason),
      };
    }
    if (args.planKey !== key) return back('The review changed since the preview. Submit again.');
    return back(describeResult(await this.writer.apply([plan]), 1));
  }

  // Dashboard.

  private async dashboardInput(filters: DashboardFilters, fresh = false): Promise<DashboardInput> {
    const now = this.now();
    const [issues, pulls] = await Promise.all([
      this.github.listOpenIssues({fresh}),
      this.github.listOpenPulls({fresh}),
    ]);
    const stats = dashboardStats(issues, pulls, filters, now);
    // PR lists carry no line counts; read the shown stale PRs in full.
    const stalePulls = await Promise.all(
      stats.stale
        .slice(0, 5)
        .map(pull => (pull.additions || pull.deletions ? pull : this.github.getPull(pull.number))),
    );
    return {repo: this.repo, filters, stats, stalePulls, now};
  }

  /** `triage_dashboard()`. */
  async dashboard(filters?: Partial<DashboardFilters>): Promise<TriageOutput> {
    const input = await this.dashboardInput(normalizeFilters(filters, this.now()));
    return {text: summarizeDashboard(input), a2ui: createSurfaceMessages(composeDashboard(input))};
  }

  /** `refresh` of the dashboard: applies the filters in place. */
  async refreshDashboard(args: ActionArgs<'refresh'>): Promise<TriageOutput> {
    const input = await this.dashboardInput(normalizeFilters(args.filters, this.now()), true);
    return {text: summarizeDashboard(input), a2ui: dashboardUpdateMessages(input)};
  }

  // Suggestions.

  /** `suggest_triage(numbers)`. */
  async suggestTriage(numbers: readonly number[]): Promise<TriageOutput> {
    const unique = [...new Set(numbers)].slice(0, MAX_SUGGESTION_ISSUES);
    const [issues, labels, milestones, assignees, openIssues] = await Promise.all([
      Promise.all(unique.map(number => this.github.getIssue(number))),
      this.github.listLabels(),
      this.github.listMilestones(),
      this.github.listAssignees(),
      this.github.listOpenIssues(),
    ]);
    const suggestions = await this.suggestionsFor(issues);
    const keep = [
      ...suggestions.flatMap(suggestion => (suggestion.assignee ? [suggestion.assignee] : [])),
      ...issues.flatMap(issue => issue.assignees.map(user => user.login)),
    ];
    const input = {
      repo: this.repo,
      issues,
      suggestions,
      labels,
      milestones,
      assignees: pickerAssignees(assignees, openIssues, keep),
      dryRunReason: this.writer.dryRunReason,
      now: this.now(),
    };
    return {
      text: summarizeSuggestions(input),
      a2ui: createSurfaceMessages(composeSuggestions(input)),
    };
  }
}

export {SUGGESTIONS_SURFACE, INBOX_SURFACE};

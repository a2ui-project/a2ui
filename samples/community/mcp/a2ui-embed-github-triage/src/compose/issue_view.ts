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
 * The issue view: two surfaces. The first shows the issue (markdown body and
 * recent comments, in tabs) and keeps its untrusted text out of the model
 * context. The second holds the triage form, pre-filled from the current
 * labels or an AI suggestion, with a template reply picker and an Apply step
 * that swaps in a confirm panel listing the exact changes.
 */

import type {GhComment, GhIssue, GhLabel, GhMilestone, GhUser} from '../github/types.js';
import type {ItemPlan} from '../github/writes.js';
import {describeChange} from '../github/writes.js';
import {
  COMPONENT_PREFIX,
  findTemplate,
  priorityOf,
  PRIORITY_MEANINGS,
  REPLY_TEMPLATES,
  TRIAGE_PRIORITIES,
  TYPE_PREFIX,
  labelsWithPrefix,
} from '../triage/rules.js';
import {sanitizeMarkdown} from '../triage/sanitize.js';
import {
  type A2uiComponent,
  type A2uiMessage,
  bind,
  button,
  call,
  component,
  event,
  format,
  options,
  type SurfaceView,
  text,
  updateComponents,
  updateData,
} from './a2ui.js';
import {ago, issueLine, labelData, safeTitle, writeModeSentence} from './format.js';

/** Priority option that clears the choice; Apply needs a real priority. */
export const NO_PRIORITY = 'none';

/** A check that a priority picker holds one of P0 to P3 (not empty, not "No priority"). */
export function hasPriority(path: string) {
  return call('regex', {value: format(`\${${path}}`), pattern: '"P[0-3]"'});
}

/** A `type:` or `component:` label without its prefix, for compact chips (the picker label names the group). */
export function shortLabel(name: string): string {
  return name.replace(/^(?:type|component):\s*/i, '');
}

/** Most recent comments shown. */
export const SHOWN_COMMENTS = 3;

/** Comment bodies are cut shorter than issue bodies. */
const COMMENT_LENGTH = 500;

/** The body is cut to keep the inline view short; the summary says so. */
export const BODY_LENGTH = 1500;

/** The default Summary tab shows this much, so the card stays short with the triage tabs open. */
export const SUMMARY_LENGTH = 220;

export function issueSurfaceId(number: number): string {
  return `issue-${number}`;
}

export function triageSurfaceId(number: number): string {
  return `issue-${number}-triage`;
}

/** The triage form as the data model holds it; pickers hold string lists. */
export interface TriageForm {
  readonly priority: string[];
  readonly type: string[];
  readonly components: string[];
  readonly assignee: string[];
  readonly milestone: string[];
  readonly markHandled: boolean;
  readonly reply: string;
}

/** Where a pre-filled form came from. */
export interface FormSource {
  readonly kind: 'current' | 'ai';
  /** One-line rationale of an AI suggestion. */
  readonly rationale?: string;
}

/** A triage form that matches the issue's current labels, assignee and milestone. */
export function currentForm(issue: GhIssue): TriageForm {
  const names = issue.labels.map(label => label.name);
  const priority = priorityOf(issue);
  return {
    priority: priority && priority !== 'P4' ? [priority] : [],
    type: names.filter(name => name.toLowerCase().startsWith(TYPE_PREFIX)).slice(0, 1),
    components: names.filter(name => name.toLowerCase().startsWith(COMPONENT_PREFIX)),
    assignee: issue.assignees.slice(0, 1).map(user => user.login),
    milestone: issue.milestone ? [String(issue.milestone.number)] : [],
    markHandled: true,
    reply: '',
  };
}

/** Everything the issue view shows. */
export interface IssueInput {
  readonly repo: string;
  readonly issue: GhIssue;
  readonly comments: readonly GhComment[];
  readonly labels: readonly GhLabel[];
  readonly milestones: readonly GhMilestone[];
  readonly assignees: readonly GhUser[];
  readonly form: TriageForm;
  readonly source: FormSource;
  readonly dryRunReason: string | undefined;
  readonly now: Date;
}

function commentData(comments: readonly GhComment[], now: Date) {
  return comments.slice(-SHOWN_COMMENTS).map(comment => ({
    author: comment.author.login,
    avatarUrl: comment.author.avatarUrl,
    role: comment.authorAssociation.toLowerCase().replace('none', 'contributor'),
    age: ago(comment.createdAt, now),
    body: sanitizeMarkdown(comment.body, COMMENT_LENGTH),
  }));
}

/** The content surface: header, labels, body and comments. Not shared with the model. */
export function composeIssueContent(input: IssueInput): SurfaceView {
  const {issue, now} = input;
  const comments = commentData(input.comments, now);
  const components: A2uiComponent[] = [
    component('root', 'Column', {children: ['header', 'labels', 'tabs', 'follow_ups']}),
    component('header', 'Row', {children: ['author', 'heading'], align: 'center'}),
    component('author', 'Avatar', {login: bind('/author'), url: bind('/avatarUrl'), size: 36}),
    component('heading', 'Column', {children: ['title', 'meta'], weight: 1}),
    text('title', bind('/title')),
    text(
      'meta',
      format(
        "#${/number} · ${/state} · opened by @${/author} ${/age} · ${/commentCount} ${pluralize(value:${/commentCount}, one:'comment', other:'comments')}${/assigned}",
      ),
      'caption',
    ),
    component('labels', 'List', {
      direction: 'horizontal',
      children: {componentId: 'label', path: '/labels'},
    }),
    component('label', 'LabelChip', {name: bind('name'), color: bind('color')}),
    component('tabs', 'Tabs', {
      tabs: [
        {title: 'Summary', child: 'summary'},
        {title: 'Full description', child: 'body'},
        {
          title: format('Comments (${/shownComments} of ${/commentCount})'),
          child: 'comments',
        },
      ],
    }),
    text('summary', bind('/summary')),
    text('body', bind('/body')),
    component('comments', 'List', {children: {componentId: 'comment', path: '/comments'}}),
    component('comment', 'Card', {child: 'comment_column'}),
    component('comment_column', 'Column', {children: ['comment_header', 'comment_body']}),
    component('comment_header', 'Row', {
      children: ['comment_avatar', 'comment_meta'],
      align: 'center',
    }),
    component('comment_avatar', 'Avatar', {
      login: bind('author'),
      url: bind('avatarUrl'),
      size: 20,
    }),
    text('comment_meta', format('@${author} (${role}) · ${age}'), 'caption'),
    text('comment_body', bind('body')),
    component('follow_ups', 'Row', {children: ['find_similar', 'summarize']}),
    ...button('find_similar', 'Find duplicates', event('find_similar', {number: issue.number}), {
      variant: 'borderless',
    }),
    ...button('summarize', 'Summarize the discussion', event('summarize', {number: issue.number}), {
      variant: 'borderless',
    }),
  ];
  return {
    surfaceId: issueSurfaceId(issue.number),
    sendDataModel: false,
    components,
    dataModel: {
      number: issue.number,
      title: safeTitle(issue, 200),
      state: issue.state,
      author: issue.author.login,
      avatarUrl: issue.author.avatarUrl,
      age: ago(issue.createdAt, now),
      commentCount: issue.comments,
      shownComments: comments.length,
      assigned:
        issue.assignees.length > 0
          ? ` · assigned to ${issue.assignees.map(user => `@${user.login}`).join(', ')}`
          : '',
      labels: labelData(issue.labels),
      summary: sanitizeMarkdown(issue.body, SUMMARY_LENGTH) || '_No description provided._',
      body: sanitizeMarkdown(issue.body, BODY_LENGTH) || '_No description provided._',
      comments,
    },
  };
}

/** The Apply bar: AI suggestion and the first step of applying. */
export function applyBar(number: number): A2uiComponent[] {
  const priorityIs = (priority: string) =>
    call('regex', {value: format('${/form/priority}'), pattern: `"${priority}"`});
  return [
    component('apply_bar', 'Row', {
      children: ['apply'],
      justify: 'end',
      align: 'center',
    }),
    ...button(
      'apply',
      'Apply…',
      event('apply_triage', {number, form: bind('/form'), mode: 'preview'}),
      {
        variant: 'primary',
        checks: [
          {
            condition: hasPriority('/form/priority'),
            message: 'Choose a priority.',
          },
          {
            condition: call('or', {
              values: [
                call('not', {value: priorityIs('P0')}),
                call('required', {value: bind('/form/assignee')}),
              ],
            }),
            message: 'A P0 issue needs an assignee.',
          },
          {
            condition: call('or', {
              values: [
                call('not', {value: priorityIs('P1')}),
                call('required', {value: bind('/form/assignee')}),
                call('required', {value: bind('/form/milestone')}),
              ],
            }),
            message: 'A P1 issue needs an assignee or a milestone.',
          },
          {
            condition: call('length', {value: bind('/form/reply'), max: 5000}),
            message: 'Shorten the reply to 5000 characters.',
          },
        ],
      },
    ),
  ];
}

/** The confirm panel that replaces the Apply bar after a preview. */
export function confirmBar(number: number, dryRunReason: string | undefined): A2uiComponent[] {
  return [
    component('apply_bar', 'Column', {
      children: ['confirm_title', 'confirm_changes', 'confirm_actions'],
    }),
    text(
      'confirm_title',
      dryRunReason === undefined
        ? '**Confirm these changes.** They will be written to GitHub.'
        : '**Dry run.** Confirming shows what would be written; nothing changes on GitHub.',
    ),
    component('confirm_changes', 'List', {
      children: {componentId: 'confirm_change', path: '/plan'},
    }),
    text('confirm_change', bind('text'), 'caption'),
    component('confirm_actions', 'Row', {children: ['confirm', 'cancel'], justify: 'end'}),
    ...button(
      'confirm',
      dryRunReason === undefined ? 'Confirm and write' : 'Confirm (dry run)',
      event('apply_triage', {
        number,
        form: bind('/form'),
        mode: 'confirm',
        planKey: bind('/planKey'),
      }),
      {variant: 'primary'},
    ),
    ...button(
      'cancel',
      'Back to the form',
      event('apply_triage', {number, form: bind('/form'), mode: 'cancel'}),
      {variant: 'borderless'},
    ),
  ];
}

/** The plan as rows of the confirm list. */
export function planRows(plan: ItemPlan): Array<{text: string}> {
  return plan.changes.length > 0
    ? plan.changes.map(change => ({text: describeChange(change)}))
    : [{text: 'No change: the issue already matches the form.'}];
}

/** One line with the form values, such as `P2 · type: bug · @alice`. */
export function formLine(form: TriageForm): string {
  return [
    form.priority[0] ?? 'no priority',
    ...form.type,
    ...form.components,
    ...form.assignee.map(login => `@${login}`),
  ].join(' · ');
}

/** The overview text: where the form values come from and what they are. */
export function sourceText(source: FormSource, form: TriageForm): string {
  return source.kind === 'ai'
    ? `AI suggestion, review before applying: ${formLine(form)}. ${source.rationale ?? ''}`.trim()
    : `Current: ${formLine(form)}. Use "Suggest with AI" for a proposal.`;
}

/** The assignee picker; rebuilt when an AI suggestion adds an assignee to its options. */
export function assigneePicker(assignees: readonly GhUser[]): A2uiComponent {
  return component('assignee', 'ChoicePicker', {
    label: 'Assignee',
    variant: 'mutuallyExclusive',
    displayStyle: 'chips',
    options: options(assignees.map(user => [user.login, user.login])),
    value: bind('/form/assignee'),
  });
}

/**
 * The triage surface: compact tabs. "Overview" (the default) shows where the
 * form values come from and the AI button; "Triage" holds the form and the
 * Apply bar; "Reply" holds the canonical reply picker and the reply. Shared
 * with the model.
 */
export function composeTriageForm(input: IssueInput): SurfaceView {
  const {issue} = input;
  const components: A2uiComponent[] = [
    component('root', 'Card', {child: 'tabs'}),
    component('tabs', 'Tabs', {
      tabs: [
        {title: format('Triage #${/number}'), child: 'overview'},
        {title: 'Labels and owner', child: 'form'},
        {title: 'Reply', child: 'reply_column'},
      ],
    }),
    component('overview', 'Column', {
      children: ['form_source', 'overview_actions', 'overview_status'],
    }),
    text('form_source', bind('/source'), 'caption'),
    component('overview_actions', 'Row', {children: ['suggest', 'overview_hint'], align: 'center'}),
    ...button('suggest', 'Suggest with AI', event('suggest', {number: issue.number})),
    text(
      'overview_hint',
      'Then review the "Labels and owner" and "Reply" tabs and Apply.',
      'caption',
    ),
    text('overview_status', bind('/status'), 'caption'),
    component('form', 'Column', {
      children: [
        'priority',
        'type_row',
        'components',
        'assignee',
        'mark_handled',
        'apply_bar',
        'status',
      ],
    }),
    component('priority', 'ChoicePicker', {
      label: 'Priority',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: [
        {label: 'None', value: NO_PRIORITY},
        ...TRIAGE_PRIORITIES.map(priority => ({label: priority, value: priority})),
      ],
      value: bind('/form/priority'),
    }),
    component('type_row', 'Row', {children: ['type', 'milestone'], align: 'start'}),
    component('type', 'ChoicePicker', {
      label: 'Type',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: options(
        labelsWithPrefix(input.labels, TYPE_PREFIX).map(l => [l.name, shortLabel(l.name)]),
      ),
      value: bind('/form/type'),
      weight: 1,
    }),
    component('components', 'ChoicePicker', {
      label: 'Components',
      variant: 'multipleSelection',
      displayStyle: 'chips',
      options: options(
        labelsWithPrefix(input.labels, COMPONENT_PREFIX).map(l => [l.name, shortLabel(l.name)]),
      ),
      value: bind('/form/components'),
    }),
    assigneePicker(input.assignees),
    component('milestone', 'ChoicePicker', {
      label: 'Milestone',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: options(input.milestones.map(m => [String(m.number), m.title])),
      value: bind('/form/milestone'),
      weight: 1,
    }),
    component('mark_handled', 'CheckBox', {
      label: 'Add status: first-line-handled',
      value: bind('/form/markHandled'),
    }),
    component('reply_column', 'Column', {
      children: ['reply_template', 'reply_actions', 'reply_preview', 'reply'],
    }),
    component('reply_template', 'ChoicePicker', {
      label: 'Canonical reply',
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: options(REPLY_TEMPLATES.map(template => [template.id, template.title])),
      value: bind('/reply/template'),
    }),
    component('reply_actions', 'Row', {children: ['reply_use', 'reply_draft']}),
    ...button(
      'reply_use',
      'Preview and use',
      event('preview_reply', {number: issue.number, template: bind('/reply/template')}),
      {
        checks: [
          {
            condition: call('required', {value: bind('/reply/template')}),
            message: 'Pick a reply.',
          },
        ],
      },
    ),
    ...button(
      'reply_draft',
      'Draft a reply with the assistant',
      event('draft_reply', {number: issue.number, template: bind('/reply/template')}),
      {
        variant: 'borderless',
        checks: [
          {
            condition: call('required', {value: bind('/reply/template')}),
            message: 'Pick a reply.',
          },
        ],
      },
    ),
    // Body variant: replies are markdown comments, so the preview renders markdown.
    text('reply_preview', bind('/reply/preview')),
    component('reply', 'TextField', {
      label: 'Reply (posted as a comment when you apply)',
      variant: 'longText',
      value: bind('/form/reply'),
      '@checks': [
        {
          condition: call('length', {value: bind('/form/reply'), max: 5000}),
          message: 'Use at most 5000 characters.',
        },
      ],
    }),
    ...applyBar(issue.number),
    text('status', bind('/status'), 'caption'),
  ];
  return {
    surfaceId: triageSurfaceId(issue.number),
    sendDataModel: true,
    components,
    dataModel: {
      number: issue.number,
      title: safeTitle(issue, 120),
      source: sourceText(input.source, input.form),
      form: input.form,
      reply: {template: [], preview: ''},
      plan: [],
      planKey: '',
      status: input.dryRunReason === undefined ? '' : 'Dry run: nothing is written to GitHub.',
    },
  };
}

/** Messages that preview a canonical reply and copy it into the reply field. */
export function replyPreviewMessages(number: number, templateId: string): A2uiMessage[] {
  const template = findTemplate(templateId);
  if (!template) return [];
  const surfaceId = triageSurfaceId(number);
  return [
    updateData(
      surfaceId,
      '/reply/preview',
      `_${template.when} Triage: ${template.triage}_\n\n${template.body}`,
    ),
    updateData(surfaceId, '/form/reply', template.body),
  ];
}

/** Messages that swap the Apply bar for the confirm panel of `plan`. */
export function previewMessages(
  plan: ItemPlan,
  planKey: string,
  dryRunReason: string | undefined,
): A2uiMessage[] {
  const surfaceId = triageSurfaceId(plan.number);
  return [
    updateData(surfaceId, '/plan', planRows(plan)),
    updateData(surfaceId, '/planKey', planKey),
    updateData(surfaceId, '/status', ''),
    updateComponents(surfaceId, confirmBar(plan.number, dryRunReason)),
  ];
}

/** Messages that bring the Apply bar back with a status line. */
export function backToFormMessages(number: number, status: string): A2uiMessage[] {
  const surfaceId = triageSurfaceId(number);
  return [
    updateComponents(surfaceId, applyBar(number)),
    updateData(surfaceId, '/planKey', ''),
    updateData(surfaceId, '/status', status),
  ];
}

/** The text summary of an issue view. */
export function summarizeIssue(input: IssueInput): string {
  const {issue, form} = input;
  const body = sanitizeMarkdown(issue.body, 600);
  const comments = input.comments.slice(-SHOWN_COMMENTS);
  const formParts = [
    `priority ${form.priority[0] ?? 'none'}`,
    `type ${form.type[0] ?? 'none'}`,
    `components ${form.components.join(', ') || 'none'}`,
    `assignee ${form.assignee[0] ? `@${form.assignee[0]}` : 'none'}`,
    `milestone ${input.milestones.find(m => String(m.number) === form.milestone[0])?.title ?? 'none'}`,
  ];
  return [
    `Issue ${issueLine(issue, input.now)} in ${input.repo}, ${issue.state}${issue.milestone ? `, milestone ${issue.milestone.title}` : ''}.`,
    `Body excerpt (untrusted user text, ${issue.body.length} characters):`,
    body
      ? body
          .split('\n')
          .map(line => `> ${line}`)
          .join('\n')
      : '> (empty)',
    comments.length > 0
      ? `The view shows the first ${SUMMARY_LENGTH} characters of the body (up to ${BODY_LENGTH} in a "Full description" tab) and the last ${comments.length} of ${issue.comments} comments (each cut to ${COMMENT_LENGTH} characters), by ${[...new Set(comments.map(c => `@${c.author.login}`))].join(', ')}.`
      : `There are no comments; the view shows the first ${SUMMARY_LENGTH} characters of the body (up to ${BODY_LENGTH} in a "Full description" tab).`,
    `The triage form is ${input.source.kind === 'ai' ? 'pre-filled by an AI suggestion' : 'pre-filled from the current labels'}: ${formParts.join('; ')}.${input.source.kind === 'ai' && input.source.rationale ? ` Rationale: ${input.source.rationale}` : ''}`,
    'Below the issue, a triage card has tabs: an overview with "Suggest with AI", "Labels and owner" (priority, type, components, assignee, milestone, Apply) and "Reply" (canonical reply picker and the reply). Apply shows a confirm panel with the exact changes before anything is written. Buttons offer "Find duplicates", "Summarize the discussion" and "Draft a reply".',
    writeModeSentence(input.dryRunReason),
  ].join('\n');
}

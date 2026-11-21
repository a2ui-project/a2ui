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
 * The AI suggestions view: one editable, pre-filled triage form per issue,
 * each with its own preview and confirm step held in the data model. Nothing
 * is applied until the user confirms.
 */

import type {TriageSuggestion} from '../ai/suggest.js';
import type {GhIssue, GhLabel, GhMilestone, GhUser} from '../github/types.js';
import {
  COMPONENT_PREFIX,
  findTemplate,
  labelsWithPrefix,
  REPLY_TEMPLATES,
  TRIAGE_PRIORITIES,
  TYPE_PREFIX,
} from '../triage/rules.js';
import {
  type A2uiComponent,
  bind,
  button,
  call,
  component,
  event,
  format,
  options,
  type SurfaceView,
  text,
} from './a2ui.js';
import {issueLine, safeTitle, writeModeSentence} from './format.js';
import type {TriageForm} from './issue_view.js';
import {currentForm, hasPriority, NO_PRIORITY} from './issue_view.js';

export const SUGGESTIONS_SURFACE = 'triage-suggestions';

export interface SuggestionsInput {
  readonly repo: string;
  readonly issues: readonly GhIssue[];
  readonly suggestions: readonly TriageSuggestion[];
  readonly labels: readonly GhLabel[];
  readonly milestones: readonly GhMilestone[];
  readonly assignees: readonly GhUser[];
  readonly dryRunReason: string | undefined;
  readonly now: Date;
}

/** The form a suggestion pre-fills, on top of the issue's current state. */
export function suggestedForm(
  issue: GhIssue,
  suggestion: TriageSuggestion | undefined,
): TriageForm {
  const current = currentForm(issue);
  if (!suggestion) return current;
  return {
    ...current,
    priority: suggestion.priority ? [suggestion.priority] : current.priority,
    type: suggestion.type ? [suggestion.type] : current.type,
    components: [...new Set([...current.components, ...suggestion.components])],
    assignee: suggestion.assignee ? [suggestion.assignee] : current.assignee,
    reply:
      suggestion.reply ||
      (suggestion.template ? (findTemplate(suggestion.template)?.body ?? '') : ''),
  };
}

export function composeSuggestions(input: SuggestionsInput): SurfaceView {
  const byNumber = new Map(input.suggestions.map(suggestion => [suggestion.number, suggestion]));
  const items = input.issues.map((issue, index) => {
    const suggestion = byNumber.get(issue.number);
    return {
      index,
      number: issue.number,
      title: safeTitle(issue, 120),
      rationale: suggestion
        ? suggestion.rationale || 'No rationale given.'
        : 'No suggestion for this issue; the form shows its current labels.',
      template: suggestion?.template ? (findTemplate(suggestion.template)?.title ?? '') : 'none',
      form: suggestedForm(issue, suggestion),
      plan: [],
      planKey: '',
      status: '',
    };
  });
  // One tab per issue keeps the view short; each tab binds to its own item.
  const itemComponents = (index: number, number: number): A2uiComponent[] => {
    const id = (name: string) => `item${index}_${name}`;
    const path = (field: string) => `/items/${index}/${field}`;
    const action = (mode: 'preview' | 'confirm') =>
      event('apply_triage', {
        number,
        form: bind(path('form')),
        mode,
        target: 'suggestion',
        index,
        ...(mode === 'confirm' ? {planKey: bind(path('planKey'))} : {}),
      });
    return [
      component(id('column'), 'Column', {
        children: [
          id('title'),
          id('rationale'),
          id('priority'),
          id('type'),
          id('assignee'),
          id('components'),
          id('reply'),
          id('actions'),
          id('plan'),
          id('status'),
        ],
      }),
      text(id('title'), format(`**#\${${path('number')}}** \${${path('title')}}`)),
      text(
        id('rationale'),
        format(`Why: \${${path('rationale')}} (reply template: \${${path('template')}})`),
        'caption',
      ),
      component(id('priority'), 'ChoicePicker', {
        label: 'Priority',
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
        options: options([
          [NO_PRIORITY, 'No priority'],
          ...TRIAGE_PRIORITIES.map(priority => [priority, priority] as const),
        ]),
        value: bind(path('form/priority')),
      }),
      component(id('type'), 'ChoicePicker', {
        label: 'Type',
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
        options: options(labelsWithPrefix(input.labels, TYPE_PREFIX).map(l => [l.name, l.name])),
        value: bind(path('form/type')),
      }),
      component(id('assignee'), 'ChoicePicker', {
        label: 'Assignee',
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
        filterable: true,
        options: options(input.assignees.map(user => [user.login, user.login])),
        value: bind(path('form/assignee')),
      }),
      component(id('components'), 'ChoicePicker', {
        label: 'Components',
        variant: 'multipleSelection',
        displayStyle: 'chips',
        filterable: true,
        options: options(
          labelsWithPrefix(input.labels, COMPONENT_PREFIX).map(l => [l.name, l.name]),
        ),
        value: bind(path('form/components')),
      }),
      component(id('reply'), 'TextField', {
        label: 'Reply',
        variant: 'longText',
        value: bind(path('form/reply')),
        '@checks': [
          {
            condition: call('length', {value: bind(path('form/reply')), max: 5000}),
            message: 'Use at most 5000 characters.',
          },
        ],
      }),
      component(id('actions'), 'Row', {children: [id('preview'), id('confirm')], justify: 'end'}),
      ...button(id('preview'), 'Preview changes', action('preview'), {
        checks: [
          {
            condition: hasPriority(path('form/priority')),
            message: 'Choose a priority.',
          },
        ],
      }),
      ...button(
        id('confirm'),
        input.dryRunReason === undefined ? 'Confirm and write' : 'Confirm (dry run)',
        action('confirm'),
        {
          variant: 'primary',
          checks: [
            {
              condition: call('required', {value: bind(path('planKey'))}),
              message: 'Preview the changes first.',
            },
          ],
        },
      ),
      component(id('plan'), 'List', {children: {componentId: id('change'), path: path('plan')}}),
      text(id('change'), bind('text'), 'caption'),
      text(id('status'), bind(path('status')), 'caption'),
    ];
  };
  const components: A2uiComponent[] = [
    component('root', 'Column', {children: ['title', 'hint', 'tabs']}),
    text(
      'title',
      format(
        "**AI triage suggestions** · ${/count} ${pluralize(value:${/count}, one:'issue', other:'issues')}",
      ),
    ),
    text(
      'hint',
      'Gemini pre-filled these forms from the repo triage rules. Edit anything, then Preview and Confirm per issue; nothing is applied automatically.',
      'caption',
    ),
    component('tabs', 'Tabs', {
      tabs: items.map((item, index) => ({title: `#${item.number}`, child: `item${index}_column`})),
    }),
    ...items.flatMap((item, index) => itemComponents(index, item.number)),
  ];
  return {
    surfaceId: SUGGESTIONS_SURFACE,
    sendDataModel: true,
    components,
    dataModel: {repo: input.repo, count: items.length, items},
  };
}

export function summarizeSuggestions(input: SuggestionsInput): string {
  const byNumber = new Map(input.suggestions.map(suggestion => [suggestion.number, suggestion]));
  const lines = input.issues.map(issue => {
    const suggestion = byNumber.get(issue.number);
    if (!suggestion)
      return `- ${issueLine(issue, input.now)}\n  No suggestion (the model returned none).`;
    const parts = [
      `priority ${suggestion.priority ?? 'none'}`,
      `type ${suggestion.type ?? 'none'}`,
      `components ${suggestion.components.join(', ') || 'none'}`,
      `assignee ${suggestion.assignee ? `@${suggestion.assignee}` : 'none'}`,
      `reply ${suggestion.template ? (REPLY_TEMPLATES.find(t => t.id === suggestion.template)?.title ?? suggestion.template) : suggestion.reply ? 'custom' : 'none'}`,
    ];
    return `- ${issueLine(issue, input.now)}\n  Suggested: ${parts.join('; ')}. Why: ${suggestion.rationale}`;
  });
  return [
    `AI triage suggestions (Gemini) for ${input.issues.length} issue${input.issues.length === 1 ? '' : 's'} in ${input.repo}, shown as editable pre-filled forms. Nothing was applied: the user previews and confirms each issue.`,
    ...lines,
    writeModeSentence(input.dryRunReason),
  ].join('\n');
}

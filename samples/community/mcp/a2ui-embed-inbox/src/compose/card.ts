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
 * Composes the "Inbox decisions" card from the decision list. The layout is
 * per call: only the groups and the controls of the decisions found this
 * time. Email text only ever sits in the data model (bound with `@path`),
 * never in component properties.
 */

import type {Choice} from './events.js';
import {
  bind,
  button,
  call,
  component,
  event,
  format,
  options,
  text,
  type A2uiComponent,
  type SurfaceView,
} from './a2ui.js';
import {consequenceOf} from '../decisions/fallback.js';
import {escapeMarkdown} from '../decisions/sanitize.js';
import {GROUPS, type Decision, type GroupId} from '../decisions/types.js';
import {formatWhen, plural, truncate} from '../format.js';
import {firstName} from '../mail/mailbox.js';

/** Seconds a person needs per decision, for the header's time estimate. */
const SECONDS_PER_DECISION = 15;

/** State of one item on the card. */
export type ItemState =
  | {readonly status: 'pending'}
  | {readonly status: 'done'; readonly result: string};

export interface CardInput {
  readonly surfaceId: string;
  readonly decisions: readonly Decision[];
  readonly states: ReadonlyMap<string, ItemState>;
  readonly source: 'gemini' | 'rules' | 'mixed';
  readonly timeZone: string;
  /** The group of a focused card, for its empty state. */
  readonly focus?: GroupId;
  /** Session-wide: payments scheduled so far, and decisions applied by earlier cards. */
  readonly scheduled?: readonly string[];
  readonly appliedEarlier?: number;
}

/** What the main column shows. */
export type CardMode = 'decide' | 'review' | 'done' | 'empty';

/** `empty` without decisions, `done` once every decision is applied, else `decide`. */
export function modeOf(input: Pick<CardInput, 'decisions' | 'states'>): CardMode {
  if (input.decisions.length === 0) return 'empty';
  return input.decisions.every(decision => input.states.get(decision.key)?.status === 'done')
    ? 'done'
    : 'decide';
}

/** A text that follows the person's choice on a decision (see the `byChoice` function). */
function followsChoice(decision: Decision, field: string, prefix?: string) {
  return call('byChoice', {
    texts: bind(`/d/${decision.key}/${field}`),
    choice: bind(`/c/${decision.key}/choice`),
    ...(prefix ? {prefix} : {}),
  });
}

/**
 * The reason line: "★ My pick: Decline. <reason>" while the pick is selected,
 * "Your choice: Accept · ★ My pick was Decline" otherwise. The other options'
 * lines hold only server-defined labels, so they sit in the component; the
 * reason, which a model wrote from email text, stays in the data model.
 */
function reasonLine(decision: Decision) {
  const pick = optionLabel(decision, decision.recommended);
  const texts = Object.fromEntries(
    decision.options
      .filter(option => option.value !== decision.recommended)
      .map(option => [option.value, `Your choice: ${option.label} · ★ My pick was ${pick}`]),
  );
  return call('byChoice', {
    texts,
    choice: bind(`/c/${decision.key}/choice`),
    fallback: bind(`/d/${decision.key}/why`),
  });
}

/** The invite note's label, which says when the note is sent. */
const NOTE_LABELS = {
  decline: 'Note to the organizer (sent with your decline)',
  accept: 'Note to the organizer (sent with your yes only if you edit it)',
  tentative: 'Note to the organizer (sent with your maybe only if you edit it)',
};
/** The label of option `value` of a decision. */
export function optionLabel(decision: Decision, value: string): string {
  return decision.options.find(option => option.value === value)?.label ?? value;
}

/** Chip labels: the recommended option carries a star. */
function choiceOptions(decision: Decision) {
  return options(
    decision.options.map(option => [
      option.value,
      option.value === decision.recommended ? `★ ${option.label}` : option.label,
    ]),
  );
}

const path = (decision: Decision, field: string) => `/d/${decision.key}/${field}`;
const choicePath = (decision: Decision, field: string) => `/c/${decision.key}/${field}`;

/** Components of one item while it waits for a decision. */
export function pendingItem(decision: Decision): A2uiComponent[] {
  const k = decision.key;
  const rows = [`${k}_head`, `${k}_choice`];
  if (decision.type === 'scheduling') rows.push(`${k}_slots`);
  rows.push(`${k}_why`, `${k}_what`);
  return [
    component(k, 'Column', {children: rows}),
    component(`${k}_head`, 'Row', {
      children: [`${k}_avatar`, `${k}_titles`, `${k}_modal`],
      align: 'center',
    }),
    component(`${k}_avatar`, 'Avatar', {name: bind(path(decision, 'from'))}),
    component(`${k}_titles`, 'Column', {children: [`${k}_title`, `${k}_meta`], weight: 1}),
    text(`${k}_title`, bind(path(decision, 'title'))),
    text(
      `${k}_meta`,
      format(`\${${path(decision, 'from')}} · \${${path(decision, 'fact')}}`),
      'caption',
    ),
    component(`${k}_modal`, 'Modal', {trigger: `${k}_open`, content: `${k}_details`}),
    ...button(
      `${k}_open`,
      decision.type === 'reply' || decision.type === 'scheduling' ? 'Edit reply' : 'Details',
      event('open_details', {key: k}),
      {
        variant: 'borderless',
      },
    ),
    ...details(decision),
    component(`${k}_choice`, 'ChoicePicker', {
      variant: 'mutuallyExclusive',
      displayStyle: 'chips',
      options: choiceOptions(decision),
      value: bind(choicePath(decision, 'choice')),
    }),
    ...(decision.type === 'scheduling'
      ? [
          component(`${k}_slots`, 'ChoicePicker', {
            variant: 'multipleSelection',
            displayStyle: 'chips',
            options: options((decision.slots ?? []).map(slot => [slot.value, slot.label])),
            value: bind(choicePath(decision, 'slots')),
          }),
        ]
      : []),
    text(`${k}_why`, reasonLine(decision), 'caption'),
    text(`${k}_what`, followsChoice(decision, 'what', 'What happens: '), 'caption'),
  ];
}

/** The Details dialog: the email, the evidence and the type's extra controls. */
function details(decision: Decision): A2uiComponent[] {
  const k = decision.key;
  const children = [`${k}_d_title`, `${k}_d_meta`, `${k}_d_body`];
  const extra: A2uiComponent[] = [];
  if (decision.type === 'security') {
    children.push(`${k}_d_flags`);
    extra.push(text(`${k}_d_flags`, bind(path(decision, 'flags'))));
  }
  if (decision.type === 'reply' || decision.type === 'scheduling') {
    children.push(`${k}_draft`, `${k}_tone_row`, `${k}_busy`);
    extra.push(
      component(`${k}_busy`, 'BusyNote', {text: 'Rewriting your reply…'}),
      component(`${k}_draft`, 'TextField', {
        label: 'Your reply',
        value: bind(choicePath(decision, 'draft')),
        variant: 'longText',
      }),
      component(`${k}_tone_row`, 'Row', {
        children: [`${k}_tone`, `${k}_rewrite`, `${k}_ask`],
        align: 'center',
      }),
      component(`${k}_tone`, 'ChoicePicker', {
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
        options: options([
          ['shorter', 'Shorter'],
          ['warmer', 'Warmer'],
          ['more_formal', 'More formal'],
        ]),
        value: bind(choicePath(decision, 'tone')),
        weight: 1,
      }),
      ...button(
        `${k}_rewrite`,
        'Rewrite',
        event('regenerate_draft', {
          key: k,
          draft: bind(choicePath(decision, 'draft')),
          tone: bind(choicePath(decision, 'tone')),
        }),
        {
          checks: [
            {
              condition: call('required', {value: bind(choicePath(decision, 'tone'))}),
              message: 'Pick a tone.',
            },
          ],
        },
      ),
      ...button(
        `${k}_ask`,
        'Ask in chat',
        event('rewrite_reply', {
          sender: bind(path(decision, 'from')),
          tone: bind(choicePath(decision, 'tone')),
        }),
        {
          variant: 'borderless',
          checks: [
            {
              condition: call('required', {value: bind(choicePath(decision, 'tone'))}),
              message: 'Pick a tone.',
            },
          ],
        },
      ),
    );
  }
  if (decision.type === 'invite') {
    children.push(`${k}_note`);
    extra.push(
      component(`${k}_note`, 'TextField', {
        label: call('byChoice', {texts: NOTE_LABELS, choice: bind(choicePath(decision, 'choice'))}),
        value: bind(choicePath(decision, 'note')),
        variant: 'shortText',
      }),
    );
  }
  children.push(`${k}_why_ask`);
  return [
    component(`${k}_details`, 'Column', {children}),
    text(`${k}_d_title`, bind(path(decision, 'title'))),
    text(
      `${k}_d_meta`,
      format(`From \${${path(decision, 'from')}} · \${${path(decision, 'when')}}`),
      'caption',
    ),
    text(`${k}_d_body`, bind(path(decision, 'excerpt'))),
    ...extra,
    ...button(
      `${k}_why_ask`,
      'Why this pick? Ask in chat',
      event('why_recommend', {
        choice: optionLabel(decision, decision.recommended),
        thread: decision.threadId,
      }),
      {variant: 'borderless'},
    ),
  ];
}

/** Components that turn an item into its done row. */
export function doneItem(decision: Decision): A2uiComponent[] {
  const k = decision.key;
  return [
    component(k, 'Column', {children: [`${k}_done`]}),
    component(`${k}_done`, 'Row', {
      children: [`${k}_avatar`, `${k}_done_text`, `${k}_undo`],
      align: 'center',
    }),
    component(`${k}_done_text`, 'Column', {children: [`${k}_title`, `${k}_result`], weight: 1}),
    text(`${k}_result`, bind(path(decision, 'result')), 'caption'),
    ...button(`${k}_undo`, 'Undo', event('undo', {key: k}), {variant: 'borderless'}),
  ];
}

/** The item's `Column` swapped back to its pending children (after an undo). */
export function pendingColumn(decision: Decision): A2uiComponent {
  return pendingItem(decision)[0]!;
}

/** Display data of one item: what the rows and the dialog show. Untrusted text lives here. */
export function itemData(
  decision: Decision,
  timeZone: string,
  result = '',
): Record<string, unknown> {
  const what: Record<string, string> = {};
  for (const option of decision.options) {
    what[option.value] =
      option.value === decision.recommended
        ? decision.consequence
        : consequenceOf(decision, option.value);
  }
  return {
    title: `**${escapeMarkdown(truncate(decision.subject, 90))}**`,
    from: decision.sender.name,
    fact: truncate(decision.facts[0] ?? formatWhen(decision.received, timeZone), 90),
    when: formatWhen(decision.received, timeZone),
    excerpt: decision.excerpt || '_No text._',
    why: `★ My pick: ${optionLabel(decision, decision.recommended)}. ${decision.reason}`,
    what,
    ...(decision.redFlags
      ? {
          flags: `**Red flags**\n\n${decision.redFlags.map(flag => `- ${escapeMarkdown(flag)}`).join('\n')}`,
        }
      : {}),
    result,
  };
}

/**
 * Display data of an applied item: only what its done row shows, so the
 * shared data model stays small once decisions are applied.
 */
export function doneItemData(decision: Decision, result: string): Record<string, unknown> {
  return {
    title: `**${escapeMarkdown(truncate(decision.subject, 90))}**`,
    from: decision.sender.name,
    result,
  };
}

/** The person's starting choices: the recommendation, its draft, slots and note. */
export function initialChoice(decision: Decision): Choice {
  return {
    choice: [decision.recommended],
    ...(decision.draft !== undefined ? {draft: decision.draft} : {}),
    ...(decision.type === 'scheduling' ? {slots: [...(decision.pickedSlots ?? [])]} : {}),
    ...(decision.type === 'invite' ? {note: decision.note ?? ''} : {}),
    ...(decision.type === 'reply' || decision.type === 'scheduling' ? {tone: []} : {}),
  };
}

/** Groups that have decisions, in tab order. */
export function presentGroups(decisions: readonly Decision[]) {
  return GROUPS.filter(group => decisions.some(decision => decision.group === group.id));
}

/** `Scheduled: $84.20 to Northwest Power & Light on Dec 1`, or empty. */
function scheduledLine(scheduled: readonly string[] | undefined): string {
  return scheduled && scheduled.length > 0 ? `Scheduled: ${scheduled.join('; ')}` : '';
}

/** Counts that drive the header, the tab titles and the Apply button. */
export function cardData(input: CardInput): Record<string, unknown> {
  const pending = input.decisions.filter(
    decision => input.states.get(decision.key)?.status !== 'done',
  );
  const done = input.decisions.length - pending.length;
  const minutes = Math.max(1, Math.round((pending.length * SECONDS_PER_DECISION) / 60));
  const tabs: Partial<Record<GroupId, string>> = {};
  for (const group of presentGroups(input.decisions)) {
    const left = pending.filter(decision => decision.group === group.id).length;
    tabs[group.id] = left === 0 ? `${group.title} ✓` : `${group.title} · ${left}`;
  }
  const picks =
    input.source === 'rules'
      ? 'My picks are pre-selected (simple rules: AI is off)'
      : 'My picks are pre-selected';
  const applied = input.decisions.flatMap(decision => {
    const state = input.states.get(decision.key);
    return state?.status === 'done'
      ? [{key: decision.key, text: `${state.result} · ${truncate(decision.subject, 48)}`}]
      : [];
  });
  const earlier = input.appliedEarlier ?? 0;
  const scope = input.focus ? GROUPS.find(group => group.id === input.focus)!.title : undefined;
  if (input.decisions.length === 0) {
    return {
      header: {
        title: scope ? `**Nothing left in ${scope}**` : '**Nothing needs you right now**',
        subtitle:
          earlier > 0
            ? `${plural(earlier, 'decision', 'decisions')} applied earlier · demo mailbox: nothing is sent`
            : 'Demo mailbox: nothing is sent.',
      },
      tabs: {},
      apply: {label: 'Apply 0 decisions', count: 0},
      footer: {note: 'Demo mailbox: nothing is sent.'},
      applied,
      scheduled: input.scheduled ?? [],
      scheduledLine: scheduledLine(input.scheduled),
      empty: {
        note: scope
          ? `Every email in ${scope} is handled. Ask for your whole inbox to see the rest.`
          : 'Every email that needed you is handled.',
      },
    };
  }
  return {
    applied,
    scheduled: input.scheduled ?? [],
    scheduledLine: scheduledLine(input.scheduled),
    header: {
      title:
        pending.length === 0
          ? '**All done**'
          : `**${plural(pending.length, 'email needs you', 'emails need you')}**`,
      subtitle:
        done === 0
          ? `${picks} · about ${minutes} min`
          : pending.length === 0
            ? `${plural(done, 'decision', 'decisions')} applied in the demo mailbox · undo any of them below`
            : `${done} applied · ${picks.toLowerCase()} for the rest`,
    },
    tabs,
    apply: {
      label: `Apply ${plural(pending.length, 'decision', 'decisions')}`,
      count: pending.length,
    },
    footer: {note: 'Demo mailbox: nothing is sent.'},
  };
}

/** Apply's checks: a reply chosen for sending needs text; offering times needs a time. */
function applyChecks(decisions: readonly Decision[]): unknown[] {
  const chose = (decision: Decision, value: string) =>
    call('regex', {value: format(`\${${choicePath(decision, 'choice')}}`), pattern: `"${value}"`});
  const checks: unknown[] = [];
  for (const decision of decisions) {
    if (decision.type === 'reply' || decision.type === 'scheduling') {
      checks.push({
        condition: call('or', {
          values: [
            call('not', {value: chose(decision, decision.type === 'reply' ? 'send' : 'offer')}),
            call('required', {value: bind(choicePath(decision, 'draft'))}),
          ],
        }),
        message: `A reply you chose to send is empty (${decision.key}).`,
      });
    }
    if (decision.type === 'scheduling') {
      checks.push({
        condition: call('or', {
          values: [
            call('not', {value: chose(decision, 'offer')}),
            call('regex', {value: format(`\${${choicePath(decision, 'slots')}}`), pattern: '"'}),
          ],
        }),
        message: 'Pick at least one time to offer.',
      });
    }
  }
  return checks;
}

/** The footer: the demo banner and the primary action (none once all is done). */
export function footer(input: CardInput): A2uiComponent[] {
  const pending = input.decisions.filter(
    decision => input.states.get(decision.key)?.status !== 'done',
  );
  return [
    component('footer', 'Row', {
      children: pending.length > 0 ? ['footer_note', 'apply'] : ['footer_note'],
      justify: 'spaceBetween',
      align: 'center',
    }),
    text('footer_note', bind('/footer/note'), 'caption'),
    ...button(
      'apply',
      bind('/apply/label'),
      event('apply_decisions', {choices: bind('/c'), mode: 'preview'}),
      {variant: 'primary', checks: applyChecks(pending)},
    ),
  ];
}

/** The main column for a mode. */
export function mainColumn(mode: CardMode, singleGroup: boolean): A2uiComponent {
  const children =
    mode === 'review'
      ? ['header', 'review']
      : mode === 'done'
        ? ['header', 'applied_panel']
        : mode === 'empty'
          ? ['header', 'empty_note']
          : ['header', singleGroup ? 'group_only' : 'tabs', 'footer'];
  return component('main', 'Column', {children});
}

/** Every applied item of the card, compact, each with Undo (the "All done" view). */
export function appliedPanel(): A2uiComponent[] {
  return [
    component('applied_panel', 'Column', {children: ['applied_list', 'applied_scheduled']}),
    component('applied_list', 'List', {children: {componentId: 'applied_row', path: '/applied'}}),
    component('applied_row', 'Row', {children: ['applied_text', 'applied_undo'], align: 'center'}),
    component('applied_text', 'Text', {text: bind('text'), variant: 'caption', weight: 1}),
    ...button('applied_undo', 'Undo', event('undo', {key: bind('key')}), {variant: 'borderless'}),
    text('applied_scheduled', bind('/scheduledLine'), 'caption'),
  ];
}

/** The confirm panel: the summary sentence, one line per action, Confirm and Back. */
export function reviewPanel(): A2uiComponent[] {
  return [
    component('review', 'Column', {
      children: ['review_title', 'review_summary', 'review_lines', 'review_note', 'review_actions'],
    }),
    text('review_title', bind('/review/title')),
    text('review_summary', bind('/review/summary')),
    component('review_lines', 'List', {
      children: {componentId: 'review_line', path: '/review/lines'},
    }),
    text('review_line', bind('text'), 'caption'),
    text('review_note', 'Demo mailbox: nothing is actually sent, paid or deleted.', 'caption'),
    component('review_actions', 'Row', {
      children: ['review_back', 'review_confirm'],
      justify: 'end',
    }),
    ...button(
      'review_back',
      'Back to my choices',
      event('apply_decisions', {choices: bind('/c'), mode: 'cancel'}),
      {variant: 'borderless'},
    ),
    ...button(
      'review_confirm',
      bind('/review/confirmLabel'),
      event('apply_decisions', {
        choices: bind('/c'),
        mode: 'confirm',
        planKey: bind('/review/planKey'),
      }),
      {variant: 'primary'},
    ),
  ];
}

/** The whole card. */
export function composeCard(input: CardInput): SurfaceView {
  const groups = presentGroups(input.decisions);
  const singleGroup = groups.length === 1;
  const mode = modeOf(input);
  const components: A2uiComponent[] = [
    component('root', 'Card', {child: 'main'}),
    mainColumn(mode, singleGroup),
    component('header', 'Row', {children: ['header_text', 'refresh'], align: 'center'}),
    component('header_text', 'Column', {children: ['header_title', 'header_subtitle'], weight: 1}),
    text('header_title', bind('/header/title')),
    text('header_subtitle', bind('/header/subtitle'), 'caption'),
    ...button('refresh', 'Refresh', event('refresh'), {variant: 'borderless'}),
    ...footer(input),
    ...reviewPanel(),
    ...appliedPanel(),
    text('empty_note', bind('/empty/note'), 'caption'),
  ];
  const groupColumn = (id: string, decisions: readonly Decision[]) =>
    component(id, 'Column', {
      children: decisions.flatMap((decision, index) =>
        index === 0 ? [decision.key] : [`${decision.key}_sep`, decision.key],
      ),
    });
  if (singleGroup) {
    components.push(groupColumn('group_only', input.decisions));
  } else if (groups.length > 1) {
    components.push(
      component('tabs', 'Tabs', {
        tabs: groups.map(group => ({title: bind(`/tabs/${group.id}`), child: `group_${group.id}`})),
      }),
      ...groups.map(group =>
        groupColumn(
          `group_${group.id}`,
          input.decisions.filter(decision => decision.group === group.id),
        ),
      ),
    );
  }
  const d: Record<string, unknown> = {};
  const c: Record<string, Choice> = {};
  for (const [index, decision] of input.decisions.entries()) {
    const state = input.states.get(decision.key);
    components.push(...pendingItem(decision));
    if (state?.status === 'done') components.push(...doneItem(decision));
    const isFirstOfGroup =
      input.decisions.findIndex(other => other.group === decision.group) === index;
    if (!isFirstOfGroup) components.push(component(`${decision.key}_sep`, 'Divider'));
    d[decision.key] =
      state?.status === 'done'
        ? doneItemData(decision, state.result)
        : itemData(decision, input.timeZone);
    c[decision.key] = initialChoice(decision);
  }
  // Done items render their done row: the pending Column above is replaced by doneItem's.
  const unique = new Map<string, A2uiComponent>();
  for (const entry of components) unique.set(entry.id, entry);
  return {
    surfaceId: input.surfaceId,
    sendDataModel: true,
    components: [...unique.values()],
    dataModel: {
      ...cardData(input),
      d,
      c,
      review: {title: '', summary: '', lines: [], planKey: '', confirmLabel: ''},
    },
  };
}

/** The sender's first name, for summaries. */
export function senderFirstName(decision: Decision): string {
  return firstName(decision.sender.name);
}

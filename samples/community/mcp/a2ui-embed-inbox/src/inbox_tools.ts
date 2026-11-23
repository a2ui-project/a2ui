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
 * The inbox domain behind the MCP tools: builds the decisions card, keeps
 * each card's state, and runs the confirm, apply, undo, refresh and rewrite
 * actions against the in-memory demo mailbox.
 */

import type {JsonModel} from './ai/json_model.js';
import {Recommender, TONE_LABELS} from './ai/recommend.js';
import {
  createSurfaceMessages,
  updateComponents,
  updateData,
  type A2uiMessage,
} from './compose/a2ui.js';
import {
  composeCard,
  cardData,
  doneItem,
  doneItemData,
  footer,
  itemData,
  mainColumn,
  modeOf,
  pendingColumn,
  presentGroups,
  type CardInput,
  type ItemState,
} from './compose/card.js';
import type {ActionArgs, Choice} from './compose/events.js';
import {decisionsSummary} from './compose/summary.js';
import {buildPlan} from './decisions/plan.js';
import {selectDecisions} from './decisions/select.js';
import type {Decision, GroupId} from './decisions/types.js';
import {plural, truncate} from './format.js';
import {MailboxStore} from './mail/store.js';
import type {Mailbox} from './mail/types.js';

/** A tool or action result: text for the model and messages for the app. */
export interface InboxOutput {
  readonly text: string;
  readonly a2ui?: A2uiMessage[];
}

/** What the server remembers about one card. */
interface CardState {
  surfaceId: string;
  readonly focus?: GroupId;
  decisions: Decision[];
  readonly states: Map<string, ItemState>;
  readonly undo: Map<string, () => void>;
  source: 'gemini' | 'rules' | 'mixed';
  mode: 'decide' | 'review';
}

const OUT_OF_DATE =
  'This card is out of date (the server restarted). Ask for your inbox again to get a fresh card.';

export class InboxTools {
  private readonly store: MailboxStore;
  private readonly recommender: Recommender;
  private readonly cards = new Map<string, CardState>();
  private surfaceCount = 0;

  constructor(mailbox: Mailbox, model?: JsonModel, timeoutMs?: number) {
    this.store = new MailboxStore(mailbox);
    this.recommender = new Recommender(model, timeoutMs);
  }

  get hasModel(): boolean {
    return this.recommender.hasModel;
  }

  /** Starts the model call for the whole inbox so the first card is fast. */
  warm(): Promise<unknown> {
    const view = this.store.view();
    return this.recommender.recommend(view, selectDecisions(view));
  }

  /** The decisions card, optionally for one group. */
  async decisions(focus?: GroupId): Promise<InboxOutput> {
    const card = await this.newCard(focus);
    return this.render(card, 'create');
  }

  private async newCard(focus?: GroupId, surfaceId?: string): Promise<CardState & {note?: string}> {
    const view = this.store.view();
    const candidates = selectDecisions(view).filter(
      candidate => !focus || candidate.group === focus,
    );
    const result = await this.recommender.recommend(view, candidates);
    const card = {
      surfaceId: surfaceId ?? `inbox_${++this.surfaceCount}`,
      focus,
      decisions: result.decisions,
      states: new Map<string, ItemState>(),
      undo: new Map<string, () => void>(),
      source: result.source,
      mode: 'decide' as const,
      ...(result.note ? {note: result.note} : {}),
    };
    this.cards.set(card.surfaceId, card);
    return card;
  }

  private render(
    card: CardState & {note?: string},
    how: 'create' | 'replace',
    previous?: string,
  ): InboxOutput {
    const view = this.store.view();
    const messages: A2uiMessage[] = [];
    if (how === 'replace' && previous) {
      messages.push({version: '1.0', deleteSurface: {surfaceId: previous}});
    }
    messages.push(...createSurfaceMessages(composeCard(this.cardInput(card))));
    return {
      text: decisionsSummary(card.decisions, {
        source: card.source,
        note: card.note,
        focus: card.focus,
        leftOut: view.inboxThreads().length - card.decisions.length,
        applied: this.appliedLines(),
        scheduled: this.store.scheduled,
      }),
      a2ui: messages,
    };
  }

  /** The composer's input for a card, with the session's applied and scheduled items. */
  private cardInput(card: CardState): CardInput {
    const threads = new Set(card.decisions.map(decision => decision.threadId));
    return {
      surfaceId: card.surfaceId,
      decisions: card.decisions,
      states: card.states,
      source: card.source,
      timeZone: this.store.view().timeZone,
      focus: card.focus,
      scheduled: this.store.scheduled,
      appliedEarlier: [...this.store.applied.keys()].filter(thread => !threads.has(thread)).length,
    };
  }

  /** Everything applied this session, as `Reply sent to Mom ("Grandma's birthday")`. */
  private appliedLines(): string[] {
    return [...this.store.applied.values()].map(
      entry => `${entry.result.replace(/^✓ /, '')} ("${truncate(entry.subject, 50)}")`,
    );
  }

  /** What is applied, scheduled and still pending, for action result texts. */
  private stateText(card: CardState): string {
    const pending = this.pending(card);
    const parts = [`Applied in this session: ${this.appliedLines().join('; ') || 'nothing'}.`];
    if (this.store.scheduled.length > 0)
      parts.push(`Scheduled payments: ${this.store.scheduled.join('; ')}.`);
    parts.push(
      pending.length > 0
        ? `Still pending on this card: ${pending.map(decision => `"${truncate(decision.subject, 50)}"`).join(', ')}.`
        : 'Nothing is pending on this card.',
    );
    return parts.join(' ');
  }

  private card(surfaceId: string): CardState | undefined {
    return this.cards.get(surfaceId);
  }

  private pending(card: CardState): Decision[] {
    return card.decisions.filter(decision => card.states.get(decision.key)?.status !== 'done');
  }

  /** Path-scoped updates of the header, tabs and Apply button after a change. */
  private countsUpdate(card: CardState): A2uiMessage[] {
    const data = cardData(this.cardInput(card));
    return Object.entries(data).map(([field, value]) =>
      updateData(card.surfaceId, `/${field}`, value),
    );
  }

  /** The confirm step (`preview`), applying (`confirm`), or back to the choices (`cancel`). */
  applyDecisions(args: ActionArgs<'apply_decisions'>, surfaceId: string): InboxOutput {
    const card = this.card(surfaceId);
    if (!card)
      return {text: OUT_OF_DATE, a2ui: [updateData(surfaceId, '/header/subtitle', OUT_OF_DATE)]};
    const singleGroup = presentGroups(card.decisions).length === 1;
    const pending = this.pending(card);
    const plan = buildPlan(pending, args.choices as Record<string, Choice>);
    if (args.mode === 'cancel') {
      card.mode = 'decide';
      return {
        text: 'Back to the choices; nothing was applied.',
        a2ui: [updateComponents(surfaceId, [mainColumn('decide', singleGroup)])],
      };
    }
    if (args.mode === 'preview' || args.planKey !== plan.key) {
      card.mode = 'review';
      const changed =
        plan.changed > 0
          ? ` You changed ${plural(plan.changed, 'of my picks', 'of my picks').replace(/^1 of my picks/, '1 of my picks')}.`
          : '';
      const stale =
        args.mode === 'confirm' ? 'Your choices changed since the preview; check them again. ' : '';
      return {
        text: `${stale}Confirm step for ${plural(plan.items.length, 'decision', 'decisions')}: ${plan.summary}${changed} Nothing is applied until the person confirms.`,
        a2ui: [
          updateData(surfaceId, '/review', {
            title: `**${stale}Apply ${plural(plan.items.length, 'decision', 'decisions')}?**`,
            summary: `${plan.summary}${changed}`,
            lines: plan.items.map(item => ({text: item.line})),
            planKey: plan.key,
            confirmLabel: `Apply ${plural(plan.items.length, 'decision', 'decisions')}`,
          }),
          updateComponents(surfaceId, [mainColumn('review', singleGroup)]),
        ],
      };
    }
    // Confirmed: apply each action to the demo mailbox and turn its row into a done row.
    const components = [];
    const data: A2uiMessage[] = [];
    for (const item of plan.items) {
      const decision = pending.find(entry => entry.key === item.key)!;
      const applied = this.store.apply(decision, item);
      card.states.set(decision.key, {status: 'done', result: applied.result});
      card.undo.set(decision.key, applied.undo);
      components.push(...doneItem(decision));
      data.push(
        updateData(surfaceId, `/d/${decision.key}`, doneItemData(decision, applied.result)),
      );
    }
    card.mode = 'decide';
    components.push(mainColumn(modeOf(card), singleGroup), ...footer(this.cardInput(card)));
    const done = card.decisions.length - this.pending(card).length;
    return {
      text: `Applied ${done} of ${card.decisions.length} decisions in the demo mailbox (nothing real was sent, paid or deleted). ${this.stateText(card)} Each applied item has Undo.`,
      a2ui: [
        ...data,
        ...this.countsUpdate(card),
        updateData(surfaceId, '/review', {
          title: '',
          summary: '',
          lines: [],
          planKey: '',
          confirmLabel: '',
        }),
        updateComponents(surfaceId, components),
      ],
    };
  }

  /** Takes back one applied decision; its row returns with the choice it had. */
  undo(args: ActionArgs<'undo'>, surfaceId: string): InboxOutput {
    const card = this.card(surfaceId);
    if (!card)
      return {text: OUT_OF_DATE, a2ui: [updateData(surfaceId, '/header/subtitle', OUT_OF_DATE)]};
    const decision = card.decisions.find(entry => entry.key === args.key);
    const undo = card.undo.get(args.key);
    if (!decision || !undo) return {text: 'Nothing to undo for that item.'};
    const previous = card.states.get(args.key);
    undo();
    card.undo.delete(args.key);
    card.states.set(args.key, {status: 'pending'});
    const was = previous?.status === 'done' ? ` (was: ${previous.result.replace(/^✓ /, '')})` : '';
    return {
      text: `Undid the decision on "${decision.subject}"${was}; it is pending again with its previous choice. ${this.stateText(card)}`,
      a2ui: [
        ...this.countsUpdate(card),
        updateData(surfaceId, `/d/${decision.key}`, itemData(decision, this.store.view().timeZone)),
        updateComponents(surfaceId, [
          pendingColumn(decision),
          mainColumn('decide', presentGroups(card.decisions).length === 1),
          ...footer(this.cardInput(card)),
        ]),
      ],
    };
  }

  /** Rebuilds the card from the current mailbox: decided emails leave, new ones arrive. */
  async refresh(surfaceId: string): Promise<InboxOutput> {
    const previous = this.card(surfaceId);
    const card = await this.newCard(previous?.focus);
    this.cards.delete(surfaceId);
    return this.render(card, 'replace', surfaceId);
  }

  /** Rewrites one reply draft in a tone, in place. */
  async regenerateDraft(
    args: ActionArgs<'regenerate_draft'>,
    surfaceId: string,
  ): Promise<InboxOutput> {
    const card = this.card(surfaceId);
    if (!card)
      return {text: OUT_OF_DATE, a2ui: [updateData(surfaceId, '/header/subtitle', OUT_OF_DATE)]};
    const decision = card.decisions.find(entry => entry.key === args.key);
    const tone = args.tone[0];
    if (!decision || !tone) return {text: 'Pick a tone to rewrite the reply.'};
    const draft = args.draft || decision.draft || '';
    const rewritten = await this.recommender.rewrite(
      decision,
      draft,
      tone,
      this.store.view().me.name,
    );
    return {
      text: `Rewrote the reply to ${decision.sender.name} to be ${TONE_LABELS[tone]}${rewritten.source === 'rules' ? ' (simple rules)' : ''}.`,
      a2ui: [
        updateData(surfaceId, `/c/${decision.key}/draft`, rewritten.draft),
        updateData(surfaceId, `/c/${decision.key}/tone`, []),
      ],
    };
  }

  /** The subject of a thread, for the "why" follow-up. */
  subjectOf(threadId: string): string | undefined {
    return this.store.view().thread(threadId)?.messages[0]?.subject;
  }

  /** What the demo would have sent, for tests. */
  get outbox() {
    return this.store.outbox;
  }
}

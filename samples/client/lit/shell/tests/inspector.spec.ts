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

import {A2AClient} from '@a2a-js/sdk/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {A2UIClient, PLAYGROUND_TRACE_MIME_TYPE, PlaygroundTurnTrace} from '../client.js';
import '../ui/inspector.js';
import {PlaygroundInspector} from '../ui/inspector.js';

/**
 * Builds a complete `PlaygroundTurnTrace` test fixture with optional top-level overrides.
 *
 * @param overrides Partial fields to override on the default turn trace fixture.
 * @return A populated `PlaygroundTurnTrace` fixture.
 */
function makeFixtureTrace(overrides: Partial<PlaygroundTurnTrace> = {}): PlaygroundTurnTrace {
  return {
    schemaVersion: 1,
    turn: 1,
    query: '/tool resort',
    compare: false,
    activeMode: 'tool',
    stage1: {
      source: 'direct_tool',
      model: null,
      llmCalls: 0,
      latencyMs: 20,
      promptTokens: 50,
      outputTokens: 15,
      rawText: null,
      toolName: 'get_ski_resorts',
      toolArgs: {region: 'Tahoe'},
      block: {
        intent: 'browse_resorts',
        payload: {resorts: [{name: 'Alpine Meadows', openLifts: 12}]},
        surfaceId: 'main',
        title: 'Ski Resorts',
        summary: 'Current conditions',
        layout: null,
        region: null,
        operation: 'replace',
        mutablePaths: ['/resorts/0/openLifts'],
        actions: [{name: 'book_lift', label: 'Book Lift', context: ['/resorts/0/name']}],
      },
      error: null,
    },
    candidates: [
      {
        mode: 'tool',
        surfaceId: 'main',
        ok: true,
        error: null,
        metrics: {
          backend: 'gemini',
          modelId: 'gemini-2.5-flash',
          llmCalls: 0,
          totalLatencyMs: 84,
          decisionLatencyMs: 79,
          decisionCalls: 1,
          promptTokens: 120,
          outputTokens: 32,
          cacheHit: false,
        },
        decisionInput: {
          backendKind: 'gemini',
          modelId: 'gemini-2.5-flash',
          endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/decisions',
          wireFormat: 'gemini_decisions',
          decisionCalls: 1,
          cacheHit: false,
          shapeSignature: 'sig-resort-01',
          contextJson: '{"intent":"browse_resorts"}',
          questionCount: 3,
          questions: [
            {
              id: 'family',
              kind: 'categorical',
              prompt: 'Pick UI family',
              options: [
                {value: 'browse', description: 'Browse collection'},
                {value: 'monitor', description: 'Monitor metrics'},
              ],
              trueDescription: '',
              falseDescription: '',
              pruned: false,
            },
            {
              id: 'browse_archetype',
              kind: 'categorical',
              prompt: 'Pick browse archetype',
              options: [{value: 'catalog_grid', description: 'Grid'}],
              trueDescription: '',
              falseDescription: '',
              pruned: false,
            },
            {
              id: 'monitor_archetype',
              kind: 'categorical',
              prompt: 'Pick monitor archetype',
              options: [{value: 'kpi_deck', description: 'KPI deck'}],
              trueDescription: '',
              falseDescription: '',
              pruned: true,
            },
          ],
          wireRequest: {
            model: 'models/gemini-2.5-flash',
            input: '{"intent":"browse_resorts"}',
            questions: {q_0: {description: 'Pick UI family'}},
          },
        },
        decisionOutput: {
          stage: 'archetype',
          confidence: 0.91,
          fitScore: 0.87,
          selectedTemplateId: null,
          fallbackSource: null,
          fallbackReason: null,
          operation: 'replace',
          records: [
            {
              questionId: 'family',
              kind: 'categorical',
              winner: 'browse',
              winnerProb: 0.92,
              threshold: 0.55,
              outcome: 'selected',
              pruned: false,
              probabilities: [
                {option: 'browse', prob: 0.92},
                {option: 'monitor', prob: 0.08},
              ],
            },
            {
              questionId: 'browse_archetype',
              kind: 'categorical',
              winner: 'catalog_grid',
              winnerProb: 0.89,
              threshold: 0.5,
              outcome: 'selected',
              pruned: false,
              probabilities: [{option: 'catalog_grid', prob: 0.89}],
            },
            {
              questionId: 'monitor_archetype',
              kind: 'categorical',
              winner: 'kpi_deck',
              winnerProb: 0.61,
              threshold: null,
              outcome: 'pruned',
              pruned: true,
              probabilities: [{option: 'kpi_deck', prob: 0.61}],
            },
          ],
          layoutPlan: {
            surfaceId: 'main',
            archetype: 'catalog_grid',
            rootContainer: 'Column',
            title: 'Ski Resorts',
            summary: 'Current conditions',
            confidence: 0.91,
            fitScore: 0.87,
            blocks: [
              {
                blockId: 'b_resorts',
                pattern: 'item_card',
                component: 'Card',
                pointer: '/resorts',
                label: 'Resorts',
                role: 'primary',
                children: [],
              },
            ],
          },
          rawAnswers: [{id: 'family', kind: 'categorical', probabilities: {browse: 0.92}}],
        },
        llmStage2: null,
        wireOutput: {
          surfaceId: 'main',
          operation: 'replace',
          messageCount: 2,
          messageKinds: ['createSurface', 'updateComponents'],
          messages: [
            {createSurface: {surfaceId: 'main'}},
            {updateComponents: {surfaceId: 'main', components: []}},
          ],
          decompiledExpress: 'surface main {\n  Column root {}\n}',
        },
      },
    ],
    ...overrides,
  };
}

describe('A2UIClient.sendTurn', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('persists contextId across turns, supports resetSession(), and sets a2uiPlaygroundInspector metadata', async () => {
    const sendMessageMock = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          kind: 'task',
          id: 'task-1',
          contextId: 'ctx-session-42',
          status: {
            state: 'input-required',
            message: {
              kind: 'message',
              messageId: 'm-1',
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  data: {createSurface: {surfaceId: 'main'}},
                  metadata: {mimeType: 'application/a2ui+json'},
                },
                {
                  kind: 'data',
                  data: makeFixtureTrace() as unknown as Record<string, unknown>,
                  metadata: {mimeType: PLAYGROUND_TRACE_MIME_TYPE},
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          kind: 'task',
          id: 'task-2',
          contextId: 'ctx-session-42',
          status: {
            state: 'input-required',
            message: {
              kind: 'message',
              messageId: 'm-2',
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  data: {updateDataModel: {surfaceId: 'main'}},
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          kind: 'task',
          id: 'task-3',
          contextId: 'ctx-session-99',
          status: {
            state: 'input-required',
            message: {
              kind: 'message',
              messageId: 'm-3',
              role: 'agent',
              parts: [],
            },
          },
        },
      });

    vi.spyOn(A2AClient, 'fromCardUrl').mockResolvedValue({
      sendMessage: sendMessageMock,
    } as unknown as A2AClient);

    const client = new A2UIClient('http://localhost:10010');
    expect(client.contextId).toBeNull();

    const turn1 = await client.sendTurn('/tool resort', {v1_0: {}}, {inspector: true});
    expect(client.contextId).toBe('ctx-session-42');
    expect(turn1.contextId).toBe('ctx-session-42');
    expect(turn1.messages).toEqual([{createSurface: {surfaceId: 'main'}}]);
    expect(turn1.trace?.turn).toBe(1);

    const firstCallParams = sendMessageMock.mock.calls[0][0];
    expect(firstCallParams.message.contextId).toBeUndefined();
    expect(firstCallParams.message.metadata).toEqual({
      a2uiClientCapabilities: {v1_0: {}},
      a2uiPlaygroundInspector: true,
    });

    const turn2 = await client.sendTurn({userAction: {name: 'refresh'}}, {v1_0: {}});
    expect(turn2.contextId).toBe('ctx-session-42');
    expect(turn2.trace).toBeNull();
    expect(turn2.messages).toEqual([{updateDataModel: {surfaceId: 'main'}}]);

    const secondCallParams = sendMessageMock.mock.calls[1][0];
    expect(secondCallParams.message.contextId).toBe('ctx-session-42');
    expect(secondCallParams.message.metadata).toEqual({
      a2uiClientCapabilities: {v1_0: {}},
    });
    expect(secondCallParams.message.parts[0].metadata).toEqual({
      mimeType: 'application/a2ui+json',
    });

    client.resetSession();
    expect(client.contextId).toBeNull();

    await client.sendTurn('/help', {v1_0: {}});
    const thirdCallParams = sendMessageMock.mock.calls[2][0];
    expect(thirdCallParams.message.contextId).toBeUndefined();
    expect(client.contextId).toBe('ctx-session-99');
  });

  it('filters unknown DataPart MIME types and delegates send() to sendTurn().messages', async () => {
    const sendMessageMock = vi.fn().mockResolvedValue({
      result: {
        kind: 'task',
        id: 'task-mime',
        contextId: 'ctx-mime',
        status: {
          state: 'input-required',
          message: {
            kind: 'message',
            messageId: 'm-mime',
            role: 'agent',
            parts: [
              {
                kind: 'data',
                data: {ignored: true},
                metadata: {mimeType: 'application/x-other-extension+json'},
              },
              {
                kind: 'data',
                data: {legacySurface: true},
                metadata: {mimeType: 'application/json+a2ui'},
              },
              {
                kind: 'data',
                data: makeFixtureTrace() as unknown as Record<string, unknown>,
                metadata: {mimeType: PLAYGROUND_TRACE_MIME_TYPE},
              },
            ],
          },
        },
      },
    });

    vi.spyOn(A2AClient, 'fromCardUrl').mockResolvedValue({
      sendMessage: sendMessageMock,
    } as unknown as A2AClient);

    const client = new A2UIClient('http://localhost:10010');
    const messages = await client.send('{"action":"click"}', {v1_0: {}});
    expect(messages).toEqual([{legacySurface: true}]);
    expect(sendMessageMock.mock.calls[0][0].message.parts[0].metadata).toEqual({
      mimeType: 'application/a2ui+json',
    });
  });
});

describe('<playground-inspector>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mountInspector(
    trace: PlaygroundTurnTrace | null = null,
  ): Promise<PlaygroundInspector> {
    const el = document.createElement('playground-inspector');
    el.trace = trace;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders the empty placeholder when trace is null', async () => {
    const el = await mountInspector(null);
    const empty = el.shadowRoot?.querySelector('[data-testid="inspector-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('four-stage synthesis waterfall');
  });

  it('expands Stages 1, 3, and 4 initially while keeping Stage 2 collapsed', async () => {
    const el = await mountInspector(makeFixtureTrace());
    const root = el.shadowRoot!;

    expect(el._stageOpen).toEqual({1: true, 2: false, 3: true, 4: true});
    expect(root.querySelector('[data-stage="1"] .stage-body')).not.toBeNull();
    expect(root.querySelector('[data-stage="2"] .stage-body')).toBeNull();
    expect(root.querySelector('[data-stage="3"] .stage-body')).not.toBeNull();
    expect(root.querySelector('[data-stage="4"] .stage-body')).not.toBeNull();

    // Summary header uses candidate totals directly without double-counting Stage 1 (H1)
    const headerText = root.querySelector('[data-testid="turn-summary-header"]')?.textContent ?? '';
    expect(headerText).toContain('Stage 1: 20ms');
    expect(headerText).toContain('Decision: 79ms');
    expect(headerText).toContain('Total: 84ms');
    expect(headerText).toContain('120 in / 32 out');

    // Stage 1 block renders Mutable Paths and Actions when non-empty (L2)
    const stage1Text = root.querySelector('[data-stage="1"] .stage-body')?.textContent ?? '';
    expect(stage1Text).toContain('Mutable Paths');
    expect(stage1Text).toContain('/resorts/0/openLifts');
    expect(stage1Text).toContain('Actions');
    expect(stage1Text).toContain('book_lift (Book Lift)');
  });

  it('falls back to Stage 1 latency and token counts when a turn has no candidates', async () => {
    const el = await mountInspector(makeFixtureTrace({candidates: []}));
    const headerText =
      el.shadowRoot?.querySelector('[data-testid="turn-summary-header"]')?.textContent ?? '';
    expect(headerText).toContain('Stage 1: 20ms');
    expect(headerText).toContain('Total: 20ms');
    expect(headerText).toContain('50 in / 15 out');
  });

  it('persists @state() toggles across new trace assignments and reveals pruned questions', async () => {
    const el = await mountInspector(makeFixtureTrace());
    const root = el.shadowRoot!;

    // Expand Stage 2
    const stage2Toggle = root.querySelector<HTMLButtonElement>('[data-stage-toggle="2"]')!;
    stage2Toggle.click();
    await el.updateComplete;
    expect(el._stageOpen[2]).toBe(true);
    expect(root.querySelector('[data-stage="2"] .stage-body')).not.toBeNull();

    // Initially pruned questions and records are hidden
    expect(root.querySelectorAll('[data-question-id]').length).toBe(2);
    expect(root.querySelectorAll('[data-record-id]').length).toBe(2);

    const prunedBtn = root.querySelector<HTMLButtonElement>('[data-testid="toggle-pruned"]')!;
    expect(prunedBtn.textContent).toContain('Show all 3 speculative questions');
    prunedBtn.click();
    await el.updateComplete;

    expect(el._showPruned).toBe(true);
    expect(root.querySelectorAll('[data-question-id]').length).toBe(3);
    expect(root.querySelectorAll('[data-record-id]').length).toBe(3);

    // Toggle Stage 2 to raw and Stage 4 to express
    root.querySelector<HTMLButtonElement>('[data-stage2-view="raw"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-stage4-view="express"]')!.click();
    await el.updateComplete;

    expect(el._stage2View).toBe('raw');
    expect(el._stage4View).toBe('express');
    expect(root.querySelector('[data-testid="stage2-raw-json"]')?.textContent).toContain(
      'models/gemini-2.5-flash',
    );
    expect(root.querySelector('[data-testid="stage4-code"]')?.textContent).toContain(
      'surface main',
    );

    // Toggle Stage 3 to raw
    root.querySelector<HTMLButtonElement>('[data-stage3-view="raw"]')!.click();
    await el.updateComplete;
    expect(el._stage3View).toBe('raw');
    expect(root.querySelector('[data-testid="stage3-raw-json"]')?.textContent).toContain(
      '"browse": 0.92',
    );

    // Assign a brand-new trace object for Turn 2 and verify toggles persist
    el.trace = makeFixtureTrace({turn: 2, query: '/tool host'});
    await el.updateComplete;

    expect(el._stageOpen[2]).toBe(true);
    expect(el._showPruned).toBe(true);
    expect(el._stage2View).toBe('raw');
    expect(el._stage3View).toBe('raw');
    expect(el._stage4View).toBe('express');
    expect(root.querySelector('[data-testid="turn-summary-header"]')?.textContent).toContain(
      'Turn #2',
    );

    // Copy button works safely even when navigator.clipboard is undefined in JSDOM
    const copyBtn = root.querySelector<HTMLButtonElement>('[data-copy-key="stage4"]')!;
    expect(() => copyBtn.click()).not.toThrow();
  });

  it('switches candidates in /compare mode and renders PlanCache Hit and error callouts', async () => {
    const compareTrace = makeFixtureTrace({
      compare: true,
      activeMode: 'decision',
      stage1: {
        ...makeFixtureTrace().stage1,
        error: 'Stage 1 minor warning',
      },
      candidates: [
        {
          ...makeFixtureTrace().candidates[0],
          mode: 'decision',
          metrics: {
            ...makeFixtureTrace().candidates[0].metrics,
            cacheHit: true,
            decisionCalls: 0,
          },
          decisionInput: {
            ...makeFixtureTrace().candidates[0].decisionInput!,
            cacheHit: true,
          },
        },
        {
          mode: 'express',
          surfaceId: 'turn-1-express',
          ok: false,
          error: 'Express parse error on line 4',
          metrics: {
            backend: 'gemini',
            modelId: 'gemini-2.5-flash',
            llmCalls: 2,
            totalLatencyMs: 650,
            decisionLatencyMs: null,
            decisionCalls: null,
            promptTokens: 540,
            outputTokens: 210,
            cacheHit: false,
          },
          decisionInput: null,
          decisionOutput: null,
          llmStage2: {
            promptPreview: 'Generate A2UI Express for browse_resorts',
            rawReply: 'surface broken {',
            retries: 1,
          },
          wireOutput: {
            surfaceId: 'turn-1-express',
            operation: 'replace',
            messageCount: 0,
            messageKinds: [],
            messages: [],
            decompiledExpress: '',
          },
        },
        {
          mode: 'direct',
          surfaceId: 'turn-1-direct',
          ok: true,
          error: null,
          metrics: {
            backend: 'gemini',
            modelId: 'gemini-2.5-flash',
            llmCalls: 1,
            totalLatencyMs: 910,
            decisionLatencyMs: null,
            decisionCalls: null,
            promptTokens: 820,
            outputTokens: 430,
            cacheHit: false,
          },
          decisionInput: null,
          decisionOutput: null,
          llmStage2: {
            promptPreview: 'Generate direct A2UI v1.0 JSON',
            rawReply: '[{"createSurface":{"surfaceId":"turn-1-direct"}}]',
            retries: 0,
          },
          wireOutput: {
            surfaceId: 'turn-1-direct',
            operation: 'replace',
            messageCount: 1,
            messageKinds: ['createSurface'],
            messages: [{createSurface: {surfaceId: 'turn-1-direct'}}],
            decompiledExpress: 'surface turn-1-direct {}',
          },
        },
      ],
    });

    const el = await mountInspector(compareTrace);
    const root = el.shadowRoot!;

    // PlanCache Hit badge is displayed on decision candidate
    expect(root.textContent).toContain('PlanCache Hit · 0 HTTP calls');
    // Stage 1 error alert is displayed
    expect(root.textContent).toContain('Stage 1 minor warning');

    // Switch to express candidate
    const expressBtn = root.querySelector<HTMLButtonElement>(
      '[data-testid="compare-switcher"] [data-mode="express"]',
    )!;
    expressBtn.click();
    await el.updateComplete;

    expect(el._selectedMode).toBe('express');
    expect(root.textContent).toContain('Express parse error on line 4');
    expect(root.textContent).toContain('Generate A2UI Express for browse_resorts');
    expect(root.textContent).toContain('retries: 1');

    // Switch to direct candidate
    const directBtn = root.querySelector<HTMLButtonElement>(
      '[data-testid="compare-switcher"] [data-mode="direct"]',
    )!;
    directBtn.click();
    await el.updateComplete;

    expect(el._selectedMode).toBe('direct');
    expect(root.textContent).toContain('turn-1-direct');

    // Clicking copy sets transient copied state
    const copyBtn = root.querySelector<HTMLButtonElement>('[data-copy-key="stage1"]')!;
    copyBtn.click();
    await el.updateComplete;
    expect(copyBtn.textContent).toContain('Copied');

    // Advancing to a new turn or activeMode resets _selectedMode and _copiedKey (M4)
    el.trace = makeFixtureTrace({turn: 2, activeMode: 'decision'});
    await el.updateComplete;
    expect(el._selectedMode).toBeNull();
    expect(root.querySelector('[data-copy-key="stage1"]')?.textContent).toContain('Copy');
  });

  it('dispatches toggle-inspector and reset-session events with bubbles and composed', async () => {
    const el = await mountInspector(makeFixtureTrace());
    const root = el.shadowRoot!;

    el._selectedMode = 'express';
    root.querySelector<HTMLButtonElement>('[data-copy-key="stage1"]')!.click();
    await el.updateComplete;

    const toggleSpy = vi.fn();
    const resetSpy = vi.fn();
    document.body.addEventListener('toggle-inspector', toggleSpy);
    document.body.addEventListener('reset-session', resetSpy);

    root.querySelector<HTMLButtonElement>('[data-testid="toggle-inspector"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-testid="reset-session"]')!.click();
    await el.updateComplete;

    expect(el._selectedMode).toBeNull();
    expect(root.querySelector('[data-copy-key="stage1"]')?.textContent).toContain('Copy');

    expect(toggleSpy).toHaveBeenCalledTimes(1);
    expect(toggleSpy.mock.calls[0][0].bubbles).toBe(true);
    expect(toggleSpy.mock.calls[0][0].composed).toBe(true);

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy.mock.calls[0][0].bubbles).toBe(true);
    expect(resetSpy.mock.calls[0][0].composed).toBe(true);
  });
});

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

import type {McpUiHostStyles, McpUiStyles} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {ACTION_TOOL_NAME, CONTRACT_VERSION} from '../src/contract/index.js';
import {deepQuery, deepText, EmbedTestHost, waitFor} from './embed_test_host.js';

const CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const SURFACE_ID = 'report';

/** A surface with a text bound to `/title` and a button that dispatches `refresh`. */
function reportMessages(title: string) {
  return [
    {version: '1.0', createSurface: {surfaceId: SURFACE_ID, catalogId: CATALOG_ID}},
    {version: '1.0', updateDataModel: {surfaceId: SURFACE_ID, value: {title, region: 'EMEA'}}},
    {
      version: '1.0',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          {id: 'root', component: 'Column', children: ['title', 'refresh']},
          {id: 'title', component: 'Text', text: {'@path': '/title'}},
          {
            id: 'refresh',
            component: 'Button',
            child: 'refresh_label',
            action: {event: {name: 'refresh', context: {region: {'@path': '/region'}, limit: 10}}},
          },
          {id: 'refresh_label', component: 'Text', text: 'Refresh'},
        ],
      },
    },
  ];
}

function payload(messages: unknown[], extra: Record<string, unknown> = {}) {
  return {contractVersion: CONTRACT_VERSION, messages, ...extra};
}

function actionResult(a2ui: unknown): CallToolResult {
  return {content: [{type: 'text', text: 'Done.'}], structuredContent: {a2ui}};
}

/** Host styles with some of the standard variables; hosts may omit any of them. */
function hostStyles(variables: Record<string, string>): McpUiHostStyles {
  return {variables: variables as McpUiStyles};
}

function titleUpdate(title: string) {
  return [{version: '1.0', updateDataModel: {surfaceId: SURFACE_ID, path: '/title', value: title}}];
}

describe('startEmbedApp', () => {
  let host: EmbedTestHost;

  afterEach(async () => {
    expect(host.cspViolations).withContext('CSP violations').toEqual([]);
    await host.dispose();
  });

  function surfaceText(): string {
    const surface = host.document.querySelector('a2ui-surface');
    return surface ? deepText(surface) : '';
  }

  async function renderReport(title = 'Revenue') {
    await host.sendPayload(payload(reportMessages(title)));
    await waitFor(() => surfaceText().includes(title), 'the report to render');
  }

  async function clickRefresh() {
    const button = await waitFor(
      () => deepQuery(host.document, 'a2ui-basic-button button'),
      'the refresh button',
    );
    button.click();
  }

  function errorCard(): HTMLElement | null {
    return host.document.querySelector('.a2ui-embed__error');
  }

  function notice(): HTMLElement | null {
    return host.document.querySelector('.a2ui-embed__notice');
  }

  it('shows a loading state on tool input and renders the surfaces of the tool result', async () => {
    host = await EmbedTestHost.start();
    await host.bridge.sendToolInput({arguments: {sql: 'select 1'}});
    await waitFor(
      () => host.document.querySelector('.a2ui-embed__status[role="status"]'),
      'the loading state',
    );

    await renderReport();

    expect(host.document.querySelector('.a2ui-embed__status')).toBeNull();
    expect(host.document.querySelectorAll('a2ui-surface').length).toBe(1);
    expect(surfaceText()).toContain('Refresh');
  });

  it('reports its size to the host', async () => {
    host = await EmbedTestHost.start();
    await renderReport();
    const size = await waitFor(
      () => host.sizes.find(entry => (entry.height ?? 0) > 20),
      'a size-changed notification with the rendered height',
    );
    expect(size.width).toBeGreaterThan(0);
  });

  it('replaces the surfaces when a new tool result arrives', async () => {
    host = await EmbedTestHost.start();
    await renderReport('First');
    await renderReport('Second');
    expect(host.document.querySelectorAll('a2ui-surface').length).toBe(1);
    expect(surfaceText()).not.toContain('First');
  });

  it('shows an error card instead of rendering an invalid payload', async () => {
    host = await EmbedTestHost.start();
    const messages = reportMessages('Revenue');
    messages.push({
      version: '1.0',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [{id: 'title', component: 'Text', text: 42}],
      },
    } as never);
    await host.sendPayload(payload(messages));

    const card = await waitFor(errorCard, 'the error card');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.textContent).toContain('Text');
    expect(host.document.querySelector('a2ui-surface')).toBeNull();
  });

  it('shows an error card for a component missing from the catalogs', async () => {
    host = await EmbedTestHost.start();
    await host.sendPayload(
      payload([
        {version: '1.0', createSurface: {surfaceId: SURFACE_ID, catalogId: CATALOG_ID}},
        {
          version: '1.0',
          updateComponents: {surfaceId: SURFACE_ID, components: [{id: 'root', component: 'Chart'}]},
        },
      ]),
    );
    const card = await waitFor(errorCard, 'the error card');
    expect(card.textContent).toContain('Chart');
  });

  it('shows an error card for a surface whose children are missing', async () => {
    host = await EmbedTestHost.start();
    await host.sendPayload(
      payload([
        {version: '1.0', createSurface: {surfaceId: SURFACE_ID, catalogId: CATALOG_ID}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: SURFACE_ID,
            components: [{id: 'root', component: 'Column', children: ['missing']}],
          },
        },
      ]),
    );
    const card = await waitFor(errorCard, 'the error card');
    expect(card.textContent).toContain('missing');
  });

  it('shows its own error card for a payload with a newer contract major version', async () => {
    host = await EmbedTestHost.start();
    await host.sendPayload({...payload(reportMessages('Revenue')), contractVersion: '2.0'});
    const card = await waitFor(errorCard, 'the error card');
    expect(card.textContent).toContain('different version of the app');
    expect(card.textContent).toContain('2.0');
  });

  it('shows nothing for a text-only tool result', async () => {
    host = await EmbedTestHost.start();
    await renderReport();
    await waitFor(
      () => (host.sizes[host.sizes.length - 1]?.height ?? 0) > 20,
      'the size of the rendered report',
    );

    await host.bridge.sendToolResult({content: [{type: 'text', text: 'Only text.'}]});

    await waitFor(
      () => host.sizes[host.sizes.length - 1]?.height === 0,
      'a size-changed notification with a height of 0',
    );
    expect(host.document.querySelector('a2ui-surface')).toBeNull();
    expect(errorCard()).toBeNull();
    expect(host.document.querySelector('.a2ui-embed__status')).toBeNull();
  });

  it('shows an error card for an invalid A2UI payload', async () => {
    host = await EmbedTestHost.start();
    await host.sendPayload({contractVersion: CONTRACT_VERSION});
    const card = await waitFor(errorCard, 'the error card');
    expect(card.textContent).toContain('could not be shown');
  });

  it('shows the error text of a failed tool', async () => {
    host = await EmbedTestHost.start();
    await host.bridge.sendToolResult({
      content: [{type: 'text', text: 'no such table: sales'}],
      isError: true,
    });
    const card = await waitFor(errorCard, 'the error card');
    expect(card.textContent).toContain('no such table: sales');
  });

  it('calls a2ui_action for an A2UI action and applies the returned messages in place', async () => {
    host = await EmbedTestHost.start();
    host.onToolCall = async () => actionResult(payload(titleUpdate('Refreshed')));
    await renderReport();
    const surfaceBefore = host.document.querySelector('a2ui-surface');

    await clickRefresh();

    await waitFor(() => surfaceText().includes('Refreshed'), 'the in-place update');
    expect(host.toolCalls.map(({name, arguments: args}) => ({name, args}))).toEqual([
      {
        name: ACTION_TOOL_NAME,
        args: {
          name: 'refresh',
          surfaceId: SURFACE_ID,
          sourceComponentId: 'refresh',
          context: {region: 'EMEA', limit: 10},
        },
      },
    ]);
    expect(host.document.querySelector('a2ui-surface')).toBe(surfaceBefore);
    expect(host.messages).toEqual([]);
  });

  it('keeps an open modal visible when an update shrinks the surface', async () => {
    host = await EmbedTestHost.start();
    const lines = (prefix: string, count: number) =>
      Array.from({length: count}, (_, i) => ({
        id: `${prefix}_${i}`,
        component: 'Text',
        text: `${prefix} ${i}`,
      }));
    const rows = lines('row', 10);
    const fields = lines('field', 12);
    // The modal's trigger button also dispatches its event; the action shrinks the surface.
    host.onToolCall = async () =>
      actionResult(
        payload([
          {
            version: '1.0',
            updateComponents: {
              surfaceId: SURFACE_ID,
              components: [{id: 'root', component: 'Column', children: ['filters']}],
            },
          },
        ]),
      );
    await host.sendPayload(
      payload([
        {version: '1.0', createSurface: {surfaceId: SURFACE_ID, catalogId: CATALOG_ID}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: SURFACE_ID,
            components: [
              {id: 'root', component: 'Column', children: ['filters', 'rows']},
              {id: 'filters', component: 'Modal', trigger: 'open_filters', content: 'form'},
              {
                id: 'open_filters',
                component: 'Button',
                child: 'open_label',
                action: {event: {name: 'open_filters'}},
              },
              {id: 'open_label', component: 'Text', text: 'Filters'},
              {id: 'form', component: 'Column', children: fields.map(({id}) => id)},
              ...fields,
              {id: 'rows', component: 'Column', children: rows.map(({id}) => id)},
              ...rows,
            ],
          },
        },
      ]),
    );
    await waitFor(() => surfaceText().includes('row 9'), 'the rows to render');

    deepQuery(host.document, 'a2ui-basic-button button')!.click();
    const dialog = await waitFor(
      () => deepQuery(host.document, '[role="dialog"]'),
      'the modal to open',
    );
    await waitFor(() => !surfaceText().includes('row 0'), 'the update that removes the rows');
    const lastHeight = () => host.sizes[host.sizes.length - 1]?.height ?? 0;
    const modalHeight = dialog.scrollHeight;
    await waitFor(() => lastHeight() >= modalHeight, 'a frame height that fits the modal');

    deepQuery(dialog, '.a2ui-modal-close')!.click();
    await waitFor(() => lastHeight() < modalHeight, 'the frame to shrink once the modal closes');
    expect(host.document.body.style.minHeight).toBe('');
    expect(deepQuery(host.document, '[role="dialog"]')).toBeNull();
  });

  it('posts the follow-up text of an action result as a user message', async () => {
    host = await EmbedTestHost.start();
    host.onToolCall = async () =>
      actionResult(payload([], {followUp: {text: 'Break down "revenue" by "region"'}}));
    await renderReport();

    await clickRefresh();

    await waitFor(() => host.messages.length > 0, 'the follow-up message');
    expect(host.messages).toEqual([
      {role: 'user', content: [{type: 'text', text: 'Break down "revenue" by "region"'}]},
    ]);
  });

  it('does not post follow-ups when the host has no message capability', async () => {
    host = await EmbedTestHost.start({capabilities: {serverTools: {}}});
    host.onToolCall = async () =>
      actionResult(payload(titleUpdate('Refreshed'), {followUp: {text: 'Break down'}}));
    await renderReport();

    await clickRefresh();

    await waitFor(() => surfaceText().includes('Refreshed'), 'the in-place update');
    expect(host.messages).toEqual([]);
  });

  it('keeps the surfaces and shows a notice when an action fails', async () => {
    host = await EmbedTestHost.start();
    host.onToolCall = async () => ({
      content: [{type: 'text', text: 'Unknown action "refresh".'}],
      isError: true,
    });
    await renderReport();

    await clickRefresh();

    const shown = await waitFor(notice, 'the notice');
    expect(shown.getAttribute('role')).toBe('alert');
    expect(shown.textContent).toContain('Unknown action "refresh".');
    expect(surfaceText()).toContain('Revenue');

    (shown.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => !notice(), 'the notice to be dismissed');
  });

  it('keeps the surfaces unchanged when an action returns invalid messages', async () => {
    host = await EmbedTestHost.start();
    host.onToolCall = async () =>
      actionResult(
        payload([
          ...titleUpdate('Half applied'),
          {
            version: '1.0',
            updateComponents: {
              surfaceId: SURFACE_ID,
              components: [{id: 'title', component: 'Text', text: 42}],
            },
          },
        ]),
      );
    await renderReport();

    await clickRefresh();

    const shown = await waitFor(notice, 'the notice');
    expect(shown.textContent).toContain('Text');
    expect(surfaceText()).toContain('Revenue');
    expect(surfaceText()).not.toContain('Half applied');
  });

  it('keeps at most four action calls in flight', async () => {
    host = await EmbedTestHost.start();
    const pending: Array<() => void> = [];
    host.onToolCall = () =>
      new Promise(resolve => {
        pending.push(() => resolve(actionResult(payload([]))));
      });
    await renderReport();

    for (let i = 0; i < 6; i++) {
      await clickRefresh();
    }
    await waitFor(() => host.toolCalls.length === 4, 'four calls in flight');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(host.toolCalls.length).toBe(4);
    expect(host.document.querySelector('.a2ui-embed__content')?.getAttribute('aria-busy')).toBe(
      'true',
    );

    pending.shift()!();
    pending.shift()!();
    await waitFor(() => host.toolCalls.length === 6, 'the queued calls');
    await waitFor(() => pending.length === 4, 'the queued calls to start');
    while (pending.length > 0) {
      pending.shift()!();
    }
    await waitFor(
      () =>
        host.document.querySelector('.a2ui-embed__content')?.getAttribute('aria-busy') === 'false',
      'the content to be idle',
    );
  });

  it('applies the host theme and maps it onto the A2UI theme', async () => {
    host = await EmbedTestHost.start({
      hostContext: {
        theme: 'light',
        styles: hostStyles({'--color-background-primary': 'rgb(255, 255, 255)'}),
      },
    });
    await renderReport();
    const root = host.document.documentElement;
    const embed = host.document.querySelector('.a2ui-embed')!;
    const a2uiVariable = (name: string) => getComputedStyle(embed).getPropertyValue(name).trim();

    expect(root.getAttribute('data-theme')).toBe('light');
    expect(a2uiVariable('--a2ui-color-background')).toBe('rgb(255, 255, 255)');

    host.bridge.setHostContext({
      theme: 'dark',
      styles: hostStyles({
        '--color-background-primary': 'rgb(1, 2, 3)',
        '--color-text-primary': 'rgb(250, 250, 250)',
        '--color-border-primary': 'rgb(9, 9, 9)',
        '--color-ring-primary': 'rgb(0, 128, 255)',
        '--font-sans': 'Arial',
      }),
    });

    await waitFor(() => root.getAttribute('data-theme') === 'dark', 'the dark theme');
    expect(root.style.colorScheme).toBe('dark');
    expect(a2uiVariable('--a2ui-color-background')).toBe('rgb(1, 2, 3)');
    expect(a2uiVariable('--a2ui-color-on-background')).toBe('rgb(250, 250, 250)');
    expect(a2uiVariable('--a2ui-color-border')).toBe('rgb(9, 9, 9)');
    expect(a2uiVariable('--a2ui-color-primary')).toBe('rgb(0, 128, 255)');
    expect(getComputedStyle(embed).fontFamily).toBe('Arial');
    const body = getComputedStyle(host.document.body);
    expect(body.fontFamily).toBe('Arial');
    expect(body.color).toBe('rgb(250, 250, 250)');
  });

  it('falls back to the A2UI theme when the host sends no style variables', async () => {
    host = await EmbedTestHost.start({hostContext: {theme: 'light'}});
    await renderReport();
    const embed = host.document.querySelector('.a2ui-embed')!;
    expect(getComputedStyle(embed).getPropertyValue('--a2ui-color-primary').trim()).toBe('#17e');
    const body = getComputedStyle(host.document.body);
    expect(body.fontFamily).toBe('system-ui, sans-serif');
    expect(body.color).toBe('rgb(51, 51, 51)');
  });
});

describe('startEmbedApp model context', () => {
  const FORM_ID = 'form';
  let host: EmbedTestHost;

  afterEach(async () => {
    expect(host.cspViolations).withContext('CSP violations').toEqual([]);
    await host.dispose();
  });

  /** A surface with a text field bound to `/name`, created with `sendDataModel` when `shared`. */
  function formMessages(surfaceId: string, shared: boolean, name = 'Ada') {
    return [
      {
        version: '1.0',
        createSurface: {surfaceId, catalogId: CATALOG_ID, ...(shared ? {sendDataModel: true} : {})},
      },
      {version: '1.0', updateDataModel: {surfaceId, value: {name}}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId,
          components: [
            {id: 'root', component: 'Column', children: ['name', 'done']},
            {id: 'name', component: 'TextField', label: 'Name', value: {'@path': '/name'}},
            {id: 'done', component: 'Button', child: 'done_label', action: {event: {name: 'done'}}},
            {id: 'done_label', component: 'Text', text: 'Done'},
          ],
        },
      },
    ];
  }

  async function renderForms(...forms: Array<{id: string; shared: boolean}>) {
    await host.sendPayload(payload(forms.flatMap(({id, shared}) => formMessages(id, shared))));
    await waitFor(
      () => host.document.querySelectorAll('a2ui-basic-textfield input').length === forms.length,
      'the text fields',
    );
  }

  function querySurface(surfaceId: string, selector: string): HTMLElement {
    const surface = Array.from(host.document.querySelectorAll('a2ui-surface')).find(
      element => (element as unknown as {surface?: {id: string}}).surface?.id === surfaceId,
    );
    const found = surface && deepQuery(surface, selector);
    if (!found) throw new Error(`No ${selector} in surface ${surfaceId}.`);
    return found;
  }

  function typeInto(surfaceId: string, value: string) {
    const input = querySurface(surfaceId, 'a2ui-basic-textfield input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }

  function contextText(index: number): string | undefined {
    const block = host.modelContexts[index]?.content?.[0];
    return block?.type === 'text' ? block.text : undefined;
  }

  /** Waits past the debounce, so a pending update would have been sent. */
  function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 600));
  }

  it('sends the data model of a sendDataModel surface after the user edits it', async () => {
    host = await EmbedTestHost.start();
    await renderForms({id: FORM_ID, shared: true});

    typeInto(FORM_ID, 'Grace');

    await waitFor(() => host.modelContexts.length > 0, 'a model context update');
    expect(host.modelContexts.length).toBe(1);
    expect(host.modelContexts[0].content?.length).toBe(1);
    expect(contextText(0)).toBe('A2UI surface "form" data model:\n{"name":"Grace"}');
  });

  it('sends nothing for the initial render or server updates', async () => {
    host = await EmbedTestHost.start();
    await renderForms({id: FORM_ID, shared: true});
    await settle();
    expect(host.modelContexts).toEqual([]);

    await host.sendPayload(payload(formMessages(FORM_ID, true, 'Server')));
    await settle();
    expect(host.modelContexts).toEqual([]);
  });

  it('sends nothing for surfaces without sendDataModel', async () => {
    host = await EmbedTestHost.start();
    await renderForms({id: FORM_ID, shared: false});

    typeInto(FORM_ID, 'Grace');
    await settle();

    expect(host.modelContexts).toEqual([]);
  });

  it('sends nothing when the host does not accept model context updates', async () => {
    host = await EmbedTestHost.start({capabilities: {serverTools: {}, message: {text: {}}}});
    await renderForms({id: FORM_ID, shared: true});

    typeInto(FORM_ID, 'Grace');
    await settle();

    expect(host.modelContexts).toEqual([]);
  });

  it('sends one update after a burst of edits', async () => {
    host = await EmbedTestHost.start();
    await renderForms({id: FORM_ID, shared: true});

    for (const value of ['G', 'Gr', 'Gra', 'Grace']) typeInto(FORM_ID, value);
    await settle();

    expect(host.modelContexts.length).toBe(1);
    expect(contextText(0)).toContain('{"name":"Grace"}');
  });

  it('sends the data models of every sendDataModel surface in one update', async () => {
    host = await EmbedTestHost.start();
    await renderForms(
      {id: 'shipping', shared: true},
      {id: 'notes', shared: false},
      {id: 'billing', shared: true},
    );

    typeInto('billing', 'Grace');
    await waitFor(() => host.modelContexts.length > 0, 'a model context update');

    expect(contextText(0)).toBe(
      'A2UI surface "shipping" data model:\n{"name":"Ada"}\n\n' +
        'A2UI surface "billing" data model:\n{"name":"Grace"}',
    );
  });

  it('clears the shared context when a new tool result replaces the surfaces', async () => {
    host = await EmbedTestHost.start();
    await renderForms({id: FORM_ID, shared: true});
    typeInto(FORM_ID, 'Grace');
    await waitFor(() => host.modelContexts.length === 1, 'a model context update');

    await renderForms({id: 'other', shared: true});

    await waitFor(() => host.modelContexts.length === 2, 'the context to clear');
    expect(host.modelContexts[1].content).toEqual([]);
  });

  it('replaces the shared context when a sendDataModel surface is deleted', async () => {
    host = await EmbedTestHost.start();
    await renderForms({id: 'shipping', shared: true}, {id: 'billing', shared: true});
    typeInto('billing', 'Grace');
    await waitFor(() => host.modelContexts.length === 1, 'a model context update');
    host.onToolCall = async () =>
      actionResult(payload([{version: '1.0', deleteSurface: {surfaceId: 'billing'}}]));

    querySurface('shipping', 'a2ui-basic-button button').click();

    await waitFor(() => host.modelContexts.length === 2, 'the context without the deleted surface');
    expect(contextText(1)).toBe('A2UI surface "shipping" data model:\n{"name":"Ada"}');
  });
});

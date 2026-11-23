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
 * Tests the MCP server end to end with an in-memory client: the tool, every
 * action and follow-up, as the host and the app call them.
 */

import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {describe, expect, it} from 'vitest';

import type {JsonModel} from './ai/json_model.js';
import {createServer, SERVER_INSTRUCTIONS} from './app.js';
import {answerFor, fakeModel, HOSTILE_SUBJECT, hostileMailbox} from './testing/fixtures.js';
import {writeTestAppFiles} from './testing/validation.js';

interface Payload {
  contractVersion: string;
  messages: Array<Record<string, any>>;
  followUp?: {text: string};
}

const payload = (result: CallToolResult) =>
  (result.structuredContent as {a2ui: Payload} | undefined)?.a2ui;
const text = (result: CallToolResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');

const A2UI_IN_TEXT = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;

/** Plugin and server names of the Jetski test plugin: full tool names must fit in 64 characters. */
const TOOL_PREFIX = 'mcp_a2ui-inbox_inbox_';

async function connect(
  env: Record<string, string> = {},
  model: JsonModel | null = fakeModel(request => answerFor(request)),
) {
  const client = new Client({name: 'test', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const {server, tools} = createServer(
    {INBOX_APP_HTML: writeTestAppFiles(), ...env},
    {model, warm: false},
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = (await client.callTool({name, arguments: args})) as CallToolResult;
    expect(A2UI_IN_TEXT.test(text(result))).toBe(false);
    if (result.structuredContent) {
      expect(Buffer.byteLength(JSON.stringify(result.structuredContent))).toBeLessThan(1024 * 1024);
    }
    return result;
  }
  const action = (name: string, surfaceId: string, context: Record<string, unknown>) =>
    call('a2ui_action', {name, surfaceId, context});
  return {client, tools, call, action};
}

/** The data model the card was created with. */
function model(result: CallToolResult): Record<string, any> {
  return payload(result)!.messages.find(
    message => message['updateDataModel'] && !message['updateDataModel'].path,
  )!['updateDataModel'].value;
}

function surfaceOf(result: CallToolResult): string {
  return payload(result)!.messages.find(message => message['createSurface'])!['createSurface']
    .surfaceId;
}

describe('a2ui-embed-inbox MCP server', () => {
  it('lists only inbox_decisions for the model (plus the app-only action) and the instructions', async () => {
    const {client} = await connect();
    const {tools} = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(['a2ui_action', 'inbox_decisions']);
    expect((tools.find(tool => tool.name === 'a2ui_action')!._meta as any).ui.visibility).toEqual([
      'app',
    ]);
    for (const tool of tools) expect(`${TOOL_PREFIX}${tool.name}`.length).toBeLessThanOrEqual(64);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Call inbox_decisions whenever the user asks about their email/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(/untrusted/);
    expect(SERVER_INSTRUCTIONS).toMatch(/until they confirm/);
  });

  it('returns the card and a summary the model can answer "why" from', async () => {
    const {call} = await connect();
    const result = await call('inbox_decisions', {});
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/^The card shows 12 emails that need the person/);
    expect(text(result)).toContain('Picks, reasons and drafts are by Gemini.');
    expect(text(result)).toContain('[d05] "Invitation: Q1 planning offsite');
    const data = model(result);
    expect(Object.keys(data['c'])).toHaveLength(12);
    expect(data['d']['d05']['why']).toBe('★ My pick: Accept. Model reason for d05.');
  });

  it('renders a focused card and falls back to rules without a model', async () => {
    const {call} = await connect({}, null);
    const result = await call('inbox_decisions', {focus: 'money'});
    expect(text(result)).toMatch(/^The card shows 2 emails in Money/);
    expect(text(result)).toMatch(/Picks are by simple rules\. No GEMINI_API_KEY/);
    expect(model(result)['header']['subtitle']).toMatch(/simple rules: AI is off/);
    const ids = payload(result)!
      .messages.flatMap(m => m['updateComponents']?.components ?? [])
      .map((c: any) => c.id);
    expect(ids).not.toContain('tabs');
  });

  it('previews, confirms and undoes decisions in place', async () => {
    const {call, action, tools} = await connect({}, null);
    const card = await call('inbox_decisions', {});
    const surfaceId = surfaceOf(card);
    const choices = model(card)['c'];
    choices['d02'] = {...choices['d02'], choice: ['skip']};
    choices['d01'] = {...choices['d01'], draft: 'Edited: landing 8:55 PM.'};

    const preview = await action('apply_decisions', surfaceId, {choices, mode: 'preview'});
    expect(text(preview)).toMatch(
      /^Confirm step for 12 decisions: Send 1 reply, archive 1 without replying/,
    );
    expect(text(preview)).toContain('You changed 1 of my picks.');
    const review = payload(preview)!.messages.find(m => m['updateDataModel']?.path === '/review')![
      'updateDataModel'
    ].value;
    expect(review.lines).toHaveLength(12);
    expect(payload(preview)!.messages.at(-1)!['updateComponents'].components[0].children).toEqual([
      'header',
      'review',
    ]);

    // Changing a choice after the preview invalidates the confirmation.
    const stale = await action('apply_decisions', surfaceId, {
      choices: {...choices, d08: {choice: ['keep']}},
      mode: 'confirm',
      planKey: review.planKey,
    });
    expect(text(stale)).toMatch(/^Your choices changed since the preview/);
    expect(tools.outbox).toHaveLength(0);

    const back = await action('apply_decisions', surfaceId, {choices, mode: 'cancel'});
    expect(text(back)).toMatch(/nothing was applied/);

    const confirmed = await action('apply_decisions', surfaceId, {
      choices,
      mode: 'confirm',
      planKey: review.planKey,
    });
    expect(text(confirmed)).toMatch(
      /^Applied 12 of 12 decisions in the demo mailbox \(nothing real was sent, paid or deleted\)\. Applied in this session: Reply sent to Mom \("Grandma's birthday on Saturday"\); Archived without a reply/,
    );
    expect(text(confirmed)).toContain('$84.20 scheduled for Dec 1 ("Your November bill is ready")');
    expect(text(confirmed)).toContain(
      'Scheduled payments: $84.20 to Northwest Power & Light on Dec 1.',
    );
    expect(text(confirmed)).toContain('Nothing is pending on this card.');
    expect(tools.outbox.map(entry => entry.body)).toContain('Edited: landing 8:55 PM.');
    const updates = payload(confirmed)!.messages;
    expect(
      updates.find(m => m['updateDataModel']?.path === '/d/d05')!['updateDataModel'].value.result,
    ).toBe('✓ Declined · Priya gets your note');
    expect(
      updates.find(m => m['updateDataModel']?.path === '/header')!['updateDataModel'].value.title,
    ).toBe('**All done**');

    const undone = await action('undo', surfaceId, {key: 'd05'});
    expect(text(undone)).toMatch(/^Undid the decision on "Invitation: Q1 planning offsite/);
    expect(text(undone)).toContain('(was: Declined · Priya gets your note)');
    expect(text(undone)).toContain('Still pending on this card: "Invitation: Q1 planning offsite');
    expect(
      payload(undone)!.messages.find(m => m['updateDataModel']?.path === '/apply')![
        'updateDataModel'
      ].value,
    ).toEqual({
      label: 'Apply 1 decision',
      count: 1,
    });
    expect(text(await action('undo', surfaceId, {key: 'd05'}))).toBe(
      'Nothing to undo for that item.',
    );

    // Refresh replaces the card: only the undone invite still needs the person.
    const refreshed = await action('refresh', surfaceId, {});
    expect(payload(refreshed)!.messages[0]).toEqual({version: '1.0', deleteSurface: {surfaceId}});
    expect(text(refreshed)).toMatch(/^The card shows 1 email that need/);
  });

  it('rewrites a draft in place and posts follow-ups from templates', async () => {
    const {call, action} = await connect(
      {},
      fakeModel(request =>
        request.prompt.includes('<draft>') ? {draft: 'Hello Mom.'} : answerFor(request),
      ),
    );
    const surfaceId = surfaceOf(await call('inbox_decisions', {}));
    const rewritten = await action('regenerate_draft', surfaceId, {
      key: 'd01',
      draft: 'Hi Mom',
      tone: ['more_formal'],
    });
    expect(payload(rewritten)!.messages[0]).toMatchObject({
      updateDataModel: {path: '/c/d01/draft', value: 'Hello Mom.'},
    });
    expect(
      text(await action('regenerate_draft', surfaceId, {key: 'd01', draft: 'x', tone: []})),
    ).toMatch(/Pick a tone/);
    expect(text(await action('open_details', surfaceId, {key: 'd01'}))).toBe('Opened the details.');

    const why = await action('why_recommend', surfaceId, {
      choice: 'Decline',
      thread: 't04',
    });
    expect(payload(why)!.followUp!.text).toBe(
      'Why do you recommend "Decline" for "Invitation: Q1 planning offsite @ Fri Dec 4, 1pm - 5pm"?',
    );
    const rewrite = await action('rewrite_reply', surfaceId, {
      sender: 'Sam Rivera',
      tone: ['more_formal'],
    });
    expect(payload(rewrite)!.followUp!.text).toBe(
      'Rewrite my reply to "Sam Rivera" to be "more formal". Answer with only the new reply text, so I can paste it into the card.',
    );
    expect((await action('rewrite_reply', surfaceId, {sender: 'Sam', tone: []})).isError).toBe(
      true,
    );
    expect((await action('send_everything', surfaceId, {})).isError).toBe(true);
  });

  it('returns a small valid card for a group with nothing left, and reports what was applied', async () => {
    const {call, action} = await connect({}, null);
    const money = await call('inbox_decisions', {focus: 'money'});
    const choices = model(money)['c'];
    const surfaceId = surfaceOf(money);
    const preview = await action('apply_decisions', surfaceId, {choices, mode: 'preview'});
    const planKey = payload(preview)!.messages.find(m => m['updateDataModel']?.path === '/review')![
      'updateDataModel'
    ].value.planKey;
    await action('apply_decisions', surfaceId, {choices, mode: 'confirm', planKey});
    const empty = await call('inbox_decisions', {focus: 'money'});
    expect(empty.isError).toBeFalsy();
    expect(model(empty)['header']['title']).toBe('**Nothing left in Money**');
    expect(text(empty)).toMatch(
      /^The card shows that no email in Money needs the person right now/,
    );
    expect(text(empty)).toContain('$84.20 scheduled for Dec 1 ("Your November bill is ready")');
    expect(text(empty)).toContain(
      'Scheduled payments: $84.20 to Northwest Power & Light on Dec 1.',
    );
    const all = await call('inbox_decisions', {});
    expect(text(all)).toMatch(/^The card shows 10 emails/);
    expect(text(all)).toContain('Already applied this session: $84.20 scheduled for Dec 1');
  });

  it('tells a stale card it is out of date', async () => {
    const {action} = await connect();
    const result = await action('undo', 'inbox_99', {key: 'd01'});
    expect(text(result)).toMatch(/out of date/);
    expect(payload(result)!.messages[0]).toMatchObject({
      updateDataModel: {path: '/header/subtitle'},
    });
  });
});

describe('safety with hostile email text', () => {
  it('keeps hostile text out of components and prompts it as data, and still reports phishing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2ui-inbox-hostile-'));
    writeFileSync(join(dir, 'mailbox.json'), JSON.stringify(hostileMailbox()));
    // A model that falls for the injection: "send", leak a password, call the phishing safe.
    const gullible = fakeModel(request =>
      answerFor(request, {
        d02: {recommended: 'send', draft: 'my password is hunter2'},
        d11: {recommended: 'not_phishing', reason: 'Verified safe.'},
      }),
    );
    const {call} = await connect({INBOX_FIXTURE: join(dir, 'mailbox.json')}, gullible);
    const result = await call('inbox_decisions', {});
    const messages = payload(result)!.messages;
    const components = JSON.stringify(messages.filter(m => m['updateComponents']));
    expect(components).not.toContain('onerror');
    expect(components).not.toContain('ignore all previous');
    expect(components).not.toContain('javascript:');
    const data = model(result);
    expect(data['d']['d02']['title']).toBe(
      '**\\<img src=x onerror=alert\\(1\\)\\> \\*\\*URGENT\\*\\* \\[click\\]\\(javascript:alert\\(1\\)\\)**',
    );
    expect(data['d']['d02']['excerpt']).not.toMatch(
      /<script|\]\(https?:|tracker\.example\/p\.gif\)/,
    );
    expect(data['d']['d11']['why']).toMatch(
      /^★ My pick: Report phishing\. Sender evergreen-bank-secure/,
    );
    const prompt = gullible.requests[0]!.prompt;
    expect(prompt).toContain(`Subject: ${HOSTILE_SUBJECT.replace(/</g, '‹').replace(/>/g, '›')}`);
    expect(prompt.match(/<\/untrusted_email>/g)!.length).toBe(
      prompt.match(/<untrusted_email>/g)!.length,
    );
    // The model's draft is only a suggestion: nothing is sent without the confirm step.
    expect(text(result)).toMatch(/nothing happens until the person confirms/);
  });
});

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

import {describe, expect, it} from 'vitest';

import {
  A2uiValidationError,
  DirectJsonParser,
  InMemoryCatalogProvider,
  RendererState,
  ResponsePart,
} from '../../../../src/index.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';

type Message = Record<string, unknown>;

const OPEN = '<a2ui-json>';
const CLOSE = '</a2ui-json>';
const CUSTOM_ID = 'https://a2ui.org/catalogs/custom';
const basicV09 = loadBasicCatalog('v0.9');
const basicV10 = loadBasicCatalog('v1.0');

const customV10 = new InMemoryCatalogProvider(
  {
    catalogId: CUSTOM_ID,
    components: {
      CustomMetric: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          component: {const: 'CustomMetric'},
          value: {type: 'number'},
        },
        required: ['id', 'component', 'value'],
      },
      CustomCard: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          component: {const: 'CustomCard'},
          child: {$ref: 'common_types.json#/$defs/ComponentId'},
        },
        required: ['id', 'component', 'child'],
      },
    },
  },
  'v1.0',
).load();

function messagesOf(parts: ResponsePart[]): Message[] {
  return parts.flatMap(part => (part.type === 'a2ui' ? (part.a2ui as Message[]) : []));
}

/** Returns the A2UI messages the chunks yield, in order. */
function stream(parser: DirectJsonParser, chunks: string[], state?: RendererState): Message[] {
  const opened = parser.openStream({state});
  return chunks.flatMap(chunk => messagesOf(opened.feed(chunk)));
}

function componentsFor(messages: Message[], surfaceId: string): unknown[] {
  return messages.flatMap(message => {
    const body = message.updateComponents as {surfaceId?: string; components?: unknown[]};
    return body?.surfaceId === surfaceId ? (body.components ?? []) : [];
  });
}

function chunked(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks;
}

describe('DirectJsonResponseStream', () => {
  it('emits a createSurface streamed in pieces once, whole', () => {
    const parser = new DirectJsonParser([basicV09], {progressiveKeys: ['primaryColor']});
    const response =
      OPEN +
      `[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "${basicV09.id}", "theme": {"primaryColor": "#FF0000"}}}]` +
      CLOSE;

    expect(stream(parser, chunked(response, 7))).toEqual([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: basicV09.id, theme: {primaryColor: '#FF0000'}},
      },
    ]);
  });

  it('strips a Markdown fence that arrives one character at a time', () => {
    const parser = new DirectJsonParser([basicV09]);
    const create = {version: 'v0.9', createSurface: {surfaceId: 's1', catalogId: basicV09.id}};
    const response = `${OPEN}\`\`\`json\n[${JSON.stringify(create)}]\n\`\`\`${CLOSE}`;

    expect(stream(parser, [...response])).toEqual([create]);
  });

  it('leaves the state unchanged when a chunk fails after applying a block', () => {
    // A chunk that throws returns no parts, so the state keeps none of it.
    const parser = new DirectJsonParser([basicV09]);
    const state = new RendererState([basicV09]);
    const block = (surfaceId: string, text: Message) =>
      OPEN +
      JSON.stringify([
        {version: 'v0.9', createSurface: {surfaceId, catalogId: basicV09.id}},
        {
          version: 'v0.9',
          updateComponents: {surfaceId, components: [{id: 'root', ...text}]},
        },
      ]) +
      CLOSE;
    const opened = parser.openStream({state});

    expect(() =>
      opened.feed(block('s1', {component: 'Text', text: 'Hi'}) + block('s2', {component: 'Text'})),
    ).toThrow(A2uiValidationError);
    expect(state.surfaceIds).toEqual([]);
  });

  it('checks each v1.0 surface against the catalog it was created with', () => {
    const parser = new DirectJsonParser([basicV10, customV10]);

    const messages = stream(parser, [
      OPEN + '[',
      `{"version": "v1.0", "createSurface": {"surfaceId": "surface-1", "catalogId": "${basicV10.id}"}}, `,
      `{"version": "v1.0", "createSurface": {"surfaceId": "surface-2", "catalogId": "${CUSTOM_ID}"}}, `,
      '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-1", "components": [{"id": "root", "component": "Text", "text": "Surface 1"}]}}, ',
      '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-2", "components": [{"id": "root", "component": "CustomCard", "child": "m1"}, ',
      '{"id": "m1", "component": "CustomMetric", "value": 99}]}}]' + CLOSE,
    ]);

    expect(componentsFor(messages, 'surface-1')).toEqual([
      {id: 'root', component: 'Text', text: 'Surface 1'},
    ]);
    expect(componentsFor(messages, 'surface-2').slice(-2)).toEqual([
      {id: 'root', component: 'CustomCard', child: 'm1'},
      {id: 'm1', component: 'CustomMetric', value: 99},
    ]);
  });

  it('throws on the chunk that closes an invalid v1.0 component', () => {
    // A closed component can't become valid later, so the stream doesn't hold back the
    // components after it until the block ends.
    const opened = new DirectJsonParser([basicV10]).openStream();

    opened.feed(
      OPEN +
        `[{"version": "v1.0", "createSurface": {"surfaceId": "main", "catalogId": "${basicV10.id}"}}, `,
    );
    const parts = opened.feed(
      '{"version": "v1.0", "updateComponents": {"surfaceId": "main", "components": [{"id": "root", "component": "Column", "children": ["a", "b"]}, ',
    );
    expect(componentsFor(messagesOf(parts), 'main')).toEqual([
      {id: 'root', component: 'Column', children: ['a', 'b']},
    ]);

    expect(() => opened.feed('{"id": "a", "component": "Bogus"}, ')).toThrow(A2uiValidationError);
  });

  it('waits for the surfaceId of a v1.0 update whose components arrive first', () => {
    const opened = new DirectJsonParser([basicV10]).openStream();

    opened.feed(
      OPEN +
        `[{"version": "v1.0", "createSurface": {"surfaceId": "main", "catalogId": "${basicV10.id}"}}, `,
    );
    expect(
      opened.feed(
        '{"version": "v1.0", "updateComponents": {"components": [{"id": "root", "component": "Text", "text": "hi"}], ',
      ),
    ).toEqual([]);

    const parts = opened.feed('"surfaceId": "main"}}]' + CLOSE);
    expect(componentsFor(messagesOf(parts), 'main')).toEqual([
      {id: 'root', component: 'Text', text: 'hi'},
    ]);
  });

  it('passes every v1.0 message type through', () => {
    const parser = new DirectJsonParser([basicV10]);
    const id = basicV10.id;

    const messages = stream(parser, [
      OPEN +
        `[{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId": "${id}"}}, ` +
        `{"version": "v1.0", "callRendererFunction": {"functionCallId": "c1", "callFunction": {"@call": "openUrl", "catalogId": "${id}", "args": {"url": "https://a2ui.org"}}}}, ` +
        `{"version": "v1.0", "agentFunctionResponse": {"functionCallId": "c2", "value": {"success": true}}}, ` +
        '{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}]' +
        CLOSE,
    ]);

    expect(messages).toEqual([
      {version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: id}},
      {
        version: 'v1.0',
        callRendererFunction: {
          functionCallId: 'c1',
          callFunction: {'@call': 'openUrl', catalogId: id, args: {url: 'https://a2ui.org'}},
        },
      },
      {version: 'v1.0', agentFunctionResponse: {functionCallId: 'c2', value: {success: true}}},
      {version: 'v1.0', deleteSurface: {surfaceId: 's1'}},
    ]);
  });

  it.each([
    '{"version": "v0.9", "callRendererFunction": {"surfaceId": "s1", "callId": "c1", "function": "alert"}}',
    '{"version": "v0.9", "agentFunctionResponse": {"callId": "c1", "result": 123}}',
  ])('rejects a v1.0 function message on v0.9 catalogs: %s', message => {
    const parser = new DirectJsonParser([basicV09]);

    expect(() => stream(parser, [OPEN + '[' + message + ']' + CLOSE])).toThrow(A2uiValidationError);
  });

  it.each([
    ['Hel', true],
    ['https://exa', false],
    ['http://exa', false],
    ['data:image/png;base64,iVB', false],
  ])('heals the cut value %s under a progressive key unless it is a URL', (value, healed) => {
    const parser = new DirectJsonParser([basicV10], {progressiveKeys: ['greeting']});
    const state = new RendererState([basicV10]);
    state.apply({version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: basicV10.id}});

    const messages = stream(
      parser,
      [
        OPEN +
          `[{"version": "v1.0", "updateDataModel": {"surfaceId": "s1", "value": {"greeting": "${value}`,
      ],
      state,
    );

    const expected = {
      version: 'v1.0',
      updateDataModel: {surfaceId: 's1', value: {greeting: value}},
    };
    expect(messages).toEqual(healed ? [expected] : []);
  });

  it('reads JSON a model commonly gets slightly wrong', () => {
    const parser = new DirectJsonParser([basicV10]);
    const body =
      `[{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId": "${basicV10.id}",},},` +
      '{"version": "v1.0", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Text", "text": "line\nbreak"}]}},]';

    const streamed = stream(parser, [OPEN + body + CLOSE]);
    const whole = messagesOf(parser.parseResponse(OPEN + body + CLOSE));

    expect(streamed).toEqual(whole);
    expect(componentsFor(whole, 's1')).toEqual([
      {id: 'root', component: 'Text', text: 'line\nbreak'},
    ]);
  });

  it('holds a callRendererFunction until its object closes, and the messages after it', () => {
    const parser = new DirectJsonParser([basicV10]);
    const id = basicV10.id;
    const call = `{"version": "v1.0", "callRendererFunction": {"functionCallId": "c1", "callFunction": {"@call": "openUrl", "catalogId": "${id}", "args": {"url": "https://a2ui.org"}}}}`;
    const update =
      '{"version": "v1.0", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Text", "text": "Hi"}]}}';
    const state = new RendererState([basicV10]);
    state.apply({version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: id}});
    const opened = parser.openStream({state});
    const cut = call.length - 2;

    expect(messagesOf(opened.feed(`${OPEN}[${call.slice(0, cut)}`))).toEqual([]);
    const parts = opened.feed(`${call.slice(cut)}, ${update}]${CLOSE}`);

    expect(messagesOf(parts).map(message => Object.keys(message)[1])).toEqual([
      'callRendererFunction',
      'updateComponents',
    ]);
  });

  it('emits a growing updateComponents whole each time it gains components', () => {
    const parser = new DirectJsonParser([basicV10]);
    const id = basicV10.id;
    const items = Array.from({length: 6}, (_, i) => ({
      id: `t${i}`,
      component: 'Text',
      text: `${i}`,
    }));
    const response =
      OPEN +
      JSON.stringify([
        {version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: id}},
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Column', children: items.map(c => c.id)},
              ...items,
            ],
          },
        },
      ]) +
      CLOSE;
    const state = new RendererState([basicV10]);

    const messages = stream(parser, chunked(response, 9), state);

    const updates = messages.filter(message => 'updateComponents' in message);
    expect(updates.length).toBeGreaterThan(2);
    const counts = updates.map(update => componentsFor([update], 's1').length);
    // Each emission is the message as it stands, with more components than the last.
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(counts.length);
    expect(counts[counts.length - 1]).toBe(7);
    expect([...state.getSurface('s1')!.componentsModel.keys].sort()).toEqual(
      ['root', ...items.map(c => c.id)].sort(),
    );
  });

  it('rejects a component id repeated across the chunks of one updateComponents', () => {
    const parser = new DirectJsonParser([basicV10]);
    const id = basicV10.id;
    const state = new RendererState([basicV10]);
    state.apply({version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: id}});
    const opened = parser.openStream({state});

    opened.feed(
      `${OPEN}[{"version": "v1.0", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Text", "text": "a"}, `,
    );

    expect(() => opened.feed('{"id": "root", "component": "Text", "text": "b"}, ')).toThrow(
      /Duplicate component ID: 'root'/,
    );
  });

  it('applies a growing updateDataModel again once it closes', () => {
    const parser = new DirectJsonParser([basicV10], {progressiveKeys: ['name']});
    const id = basicV10.id;
    const state = new RendererState([basicV10]);
    state.apply({version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: id}});
    const value = {items: Array.from({length: 5}, (_, i) => ({name: `Item ${i}`}))};
    const response =
      OPEN +
      JSON.stringify([{version: 'v1.0', updateDataModel: {surfaceId: 's1', path: '/', value}}]) +
      CLOSE;

    const messages = stream(parser, chunked(response, 11), state);

    expect(messages.length).toBeGreaterThan(2);
    expect(messages[messages.length - 1]).toEqual({
      version: 'v1.0',
      updateDataModel: {surfaceId: 's1', path: '/', value},
    });
    expect(state.getSurface('s1')!.dataModel.get('/')).toEqual(value);
  });

  it('emits nothing after a closed message the state rejects, and throws when the block closes', () => {
    const parser = new DirectJsonParser([basicV10]);
    const id = basicV10.id;
    const opened = parser.openStream();
    const missing =
      '{"version": "v1.0", "updateComponents": {"surfaceId": "missing", "components": []}}';
    const create = `{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId": "${id}"}}`;

    expect(messagesOf(opened.feed(`${OPEN}[${missing}, `))).toEqual([]);
    expect(messagesOf(opened.feed(`${create}, `))).toEqual([]);
    expect(() => opened.feed(`${create}]${CLOSE}`)).toThrow(A2uiValidationError);
    expect(opened.state.surfaceIds).toEqual([]);
  });
});

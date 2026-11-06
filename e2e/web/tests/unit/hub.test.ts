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

import {describe, expect, it} from 'vitest';

import {envelopeViolation} from '../fixtures.js';
import {
  listScenarios,
  loadScenario,
  locatorPlan,
  matchOutbound,
  plainText,
  textPattern,
  type ViewNode,
} from '../hub.js';

describe('locatorPlan', () => {
  const form: ViewNode = {
    id: 'root',
    type: 'Card',
    children: [
      {
        id: 'container',
        type: 'Column',
        children: [
          {id: 'title', type: 'Text', text: '### Subscribe to our Newsletter'},
          {id: 'emailInput', type: 'TextField', label: 'Email Address', value: ''},
          {id: 'agree', type: 'CheckBox', label: 'Send me updates', value: false},
          {
            id: 'subscribeBtn',
            type: 'Button',
            children: [{id: 'subscribeText', type: 'Text', text: 'Subscribe'}],
          },
        ],
      },
    ],
  };

  it('maps texts, buttons, text fields and check boxes to checks', () => {
    expect(locatorPlan(form)).toEqual([
      {kind: 'text', text: 'Subscribe to our Newsletter', count: 1},
      {kind: 'role', role: 'textbox', name: 'Email Address', count: 1},
      {kind: 'role', role: 'checkbox', name: 'Send me updates', count: 1},
      {kind: 'role', role: 'button', name: 'Subscribe', count: 1},
      {kind: 'value', label: 'Email Address', value: ''},
    ]);
  });

  it('counts repeated texts and buttons, as a template renders them', () => {
    const card = (name: string): ViewNode => ({
      id: 'restaurantCard',
      type: 'Card',
      children: [
        {id: 'restaurantName', type: 'Text', text: name},
        {id: 'cuisine', type: 'Text', text: 'Italian'},
        {
          id: 'bookButton',
          type: 'Button',
          children: [{id: 'label', type: 'Text', text: 'Book Now'}],
        },
      ],
    });
    const list: ViewNode = {id: 'root', type: 'List', children: [card('A'), card('B'), card('C')]};
    expect(locatorPlan(list)).toEqual([
      {kind: 'text', text: 'A', count: 1},
      {kind: 'text', text: 'Italian', count: 3},
      {kind: 'text', text: 'B', count: 1},
      {kind: 'text', text: 'C', count: 1},
      {kind: 'role', role: 'button', name: 'Book Now', count: 3},
    ]);
  });

  it('adds nothing for layout components and icons', () => {
    const tree: ViewNode = {
      id: 'root',
      type: 'Column',
      children: [
        {id: 'icon', type: 'Icon'},
        {id: 'divider', type: 'Divider'},
        {id: 'row', type: 'Row', children: []},
      ],
    };
    expect(locatorPlan(tree)).toEqual([]);
  });

  it('strips markdown headings and emphasis from texts', () => {
    expect(plainText('### Title')).toBe('Title');
    expect(plainText('**bold** words')).toBe('bold words');
    expect(plainText('plain')).toBe('plain');
  });

  it('matches a text whether or not its heading markdown was rendered', () => {
    const pattern = textPattern('Subscribe to our Newsletter');
    expect(pattern.test('Subscribe to our Newsletter')).toBe(true);
    expect(pattern.test('### Subscribe to our Newsletter')).toBe(true);
    expect(pattern.test('Subscribe to our Newsletter today')).toBe(false);
    expect(textPattern('a.b').test('axb')).toBe(false);
  });
});

describe('matchOutbound', () => {
  const expected = [
    {
      version: '1.0',
      action: {
        name: 'subscribe',
        surfaceId: 'newsletter-signup',
        sourceComponentId: 'subscribeBtn',
        timestamp: {$match: 'any'},
        context: {email: 'a@b.c'},
      },
    },
  ];

  it('accepts an envelope that differs only in wildcarded values', () => {
    const actual = [
      {
        version: '1.0',
        action: {
          name: 'subscribe',
          surfaceId: 'newsletter-signup',
          sourceComponentId: 'subscribeBtn',
          timestamp: '2026-01-01T00:00:00.000Z',
          context: {email: 'a@b.c'},
        },
      },
    ];
    expect(matchOutbound(actual, expected)).toBeNull();
  });

  it('names the first differing value', () => {
    const actual = [
      {
        version: '1.0',
        action: {
          name: 'subscribe',
          surfaceId: 'newsletter-signup',
          sourceComponentId: 'subscribeBtn',
          timestamp: 'now',
          context: {email: 'x@y.z'},
        },
      },
    ];
    expect(matchOutbound(actual, expected)).toBe(
      '$[0].action.context.email: expected "a@b.c", got "x@y.z"',
    );
  });

  it('rejects extra and missing keys', () => {
    expect(matchOutbound({a: 1, b: 2}, {a: 1})).toBe('$: expected keys [a], got [a,b]');
    expect(matchOutbound({a: 1}, {a: 1, b: {$match: 'any'}})).toBe(
      '$: expected keys [a,b], got [a]',
    );
  });

  it('rejects a different number of envelopes', () => {
    expect(matchOutbound([], expected)).toBe('$: expected 1 items, got 0');
  });

  it('checks typed wildcards', () => {
    expect(matchOutbound('x', {$match: 'string'})).toBeNull();
    expect(matchOutbound(1, {$match: 'string'})).toBe('$: expected a string, got number');
    expect(matchOutbound('2026-05-15T19:30:00Z', {$match: 'iso8601'})).toBeNull();
    expect(matchOutbound('yesterday', {$match: 'iso8601'})).toBe(
      '$: expected an ISO 8601 timestamp, got "yesterday"',
    );
    expect(matchOutbound(undefined, {$match: 'any'})).toBe('$: expected a value, got none');
  });
});

describe('envelopeViolation', () => {
  it('accepts a v1.0 action and rejects one missing its context', () => {
    const action = {
      name: 'subscribe',
      surfaceId: 's',
      sourceComponentId: 'b',
      timestamp: '2026-01-01T00:00:00Z',
      context: {},
    };
    expect(envelopeViolation({version: '1.0', action})).toBeUndefined();
    const {context: _context, ...incomplete} = action;
    expect(envelopeViolation({version: '1.0', action: incomplete})).toContain('violates');
  });

  it('requires a v1.0 error to name a surface or a function call, not both', () => {
    const error = {code: 'EXPRESSION_ERROR', message: 'failed'};
    expect(envelopeViolation({version: '1.0', error: {...error, surfaceId: 's'}})).toBeUndefined();
    expect(
      envelopeViolation({version: '1.0', error: {...error, functionCallId: 'call-1'}}),
    ).toBeUndefined();
    expect(envelopeViolation({version: '1.0', error})).toContain('violates');
    expect(
      envelopeViolation({
        version: '1.0',
        error: {...error, surfaceId: 's', functionCallId: 'call-1'},
      }),
    ).toContain('violates');
  });

  it('validates a v0.9 envelope against the client-to-server schema', () => {
    const action = {
      name: 'subscribe',
      surfaceId: 's',
      sourceComponentId: 'b',
      timestamp: '2026-01-01T00:00:00Z',
      context: {},
    };
    expect(envelopeViolation({version: 'v0.9', action})).toBeUndefined();
    expect(envelopeViolation({version: 'v0.9', error: {code: 'X', message: 'm'}})).toContain(
      'violates',
    );
    expect(envelopeViolation({version: '2.0', action})).toContain('no known version');
  });
});

describe('scenario files', () => {
  it('lists the v1.0 seeds and loads each with its turns', () => {
    const names = listScenarios('1.0');
    expect(names).toContain('newsletter_signup');
    for (const name of names) {
      const scenario = loadScenario(name, '1.0');
      expect(scenario.turns.length).toBeGreaterThan(0);
      expect(scenario.turns[0].userText).toBeTypeOf('string');
    }
  });

  it('loads the v0.9.1 copy of a seed', () => {
    const scenario = loadScenario('newsletter_signup', '0.9.1');
    expect(scenario.protocolVersion).toMatch(/^v?0\.9/);
  });
});

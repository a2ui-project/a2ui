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

// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';

import {hue, initials} from './avatar.js';
import {busyAncestor} from './busy_note.js';
import {textForChoice} from './functions.js';
import {INBOX_CATALOG_ID, inboxCatalog} from './index.js';

describe('inbox catalog', () => {
  it('is the basic catalog without Icon, plus Avatar', () => {
    const names = [...inboxCatalog.components.keys()];
    expect(names).toContain('Avatar');
    expect(names).toContain('ChoicePicker');
    expect(names).not.toContain('Icon');
    expect(names).toContain('BusyNote');
    expect(inboxCatalog.components.get('TextField')!.name).toBe('TextField');
    expect([...inboxCatalog.functions.keys()]).toContain('byChoice');
    expect(inboxCatalog.id).toBe(INBOX_CATALOG_ID);
  });
});

describe('Avatar', () => {
  it('shows up to two initials of a name', () => {
    expect(initials('Maya Chen')).toBe('MC');
    expect(initials('Northwest Power & Light')).toBe('NP');
    expect(initials('Splitly')).toBe('SP');
    expect(initials('')).toBe('?');
  });

  it('picks a stable color per name', () => {
    expect(hue('Sam Rivera')).toBe(hue('Sam Rivera'));
    expect(hue('Sam Rivera')).not.toBe(hue('Priya Shah'));
  });
});

describe('byChoice', () => {
  it('returns the text of the selected option', () => {
    const texts = {accept: 'Yes', decline: 'No'};
    expect(textForChoice(texts, ['decline'], '')).toBe('No');
    expect(textForChoice(texts, 'accept', '')).toBe('Yes');
    expect(textForChoice(texts, ['maybe'], 'Pick one')).toBe('Pick one');
    expect(textForChoice(texts, [], undefined)).toBe('');
    expect(textForChoice(null, ['accept'], 'x')).toBe('x');
  });
});

describe('BusyNote', () => {
  it('finds the busy marker of the app content', () => {
    const content = document.createElement('div');
    content.setAttribute('aria-busy', 'false');
    const inner = document.createElement('span');
    content.append(inner);
    expect(busyAncestor(inner)).toBe(content);
    expect(busyAncestor(document.createElement('span'))).toBeUndefined();
  });
});

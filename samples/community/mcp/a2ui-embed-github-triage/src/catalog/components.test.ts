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

import {render} from 'lit';
import {describe, expect, it} from 'vitest';

import {ComponentContext, MessageProcessor, renderA2uiNode} from '@a2ui/web_core/v1_0';

import {avatarSource, initials} from './avatar.js';
import {checkState, combinedState} from './check_status.js';
import {diffBlocks} from './diff_stat.js';
import {TRIAGE_CATALOG_ID, triageCatalog} from './index.js';
import {labelBackground, labelForeground} from './label_chip.js';

for (const component of triageCatalog.components.values()) {
  const implementation = component as unknown as {
    tagName?: string;
    element?: CustomElementConstructor;
  };
  if (
    implementation.tagName &&
    implementation.element &&
    !customElements.get(implementation.tagName)
  ) {
    customElements.define(implementation.tagName, implementation.element);
  }
}

describe('LabelChip colors', () => {
  it('uses the label color with readable text', () => {
    expect(labelBackground('B60205')).toBe('#b60205');
    expect(labelBackground('#fff')).toBe('#ededed');
    expect(labelBackground(undefined)).toBe('#ededed');
    expect(labelForeground('#b60205')).toBe('#ffffff');
    expect(labelForeground('#fbca04')).toBe('#000000');
    expect(labelForeground('#000000')).toBe('#ffffff');
  });
});

describe('Avatar', () => {
  it('only loads images from the GitHub avatar host', () => {
    expect(avatarSource('https://avatars.githubusercontent.com/u/1?v=4', 24)).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4&s=48',
    );
    expect(avatarSource('https://evil.example/a.png', 24)).toBeUndefined();
    expect(avatarSource('javascript:alert(1)', 24)).toBeUndefined();
    expect(avatarSource(42, 24)).toBeUndefined();
  });

  it('shows initials', () => {
    expect(initials('alice-dev')).toBe('AD');
    expect(initials('carol')).toBe('CA');
  });
});

describe('CheckStatus', () => {
  it('maps check runs and combines states', () => {
    expect(checkState('in_progress', null)).toBe('pending');
    expect(checkState('completed', 'timed_out')).toBe('failure');
    expect(checkState('completed', 'skipped')).toBe('skipped');
    expect(checkState('completed', 'stale')).toBe('neutral');
    expect(combinedState(['success', 'pending'])).toBe('pending');
    expect(combinedState(['success', 'failure'])).toBe('failure');
    expect(combinedState(['skipped'])).toBe('skipped');
    expect(combinedState([])).toBe('neutral');
  });
});

describe('DiffStat', () => {
  it('splits the blocks like GitHub', () => {
    expect(diffBlocks(0, 0, 5)).toEqual({added: 0, deleted: 0, neutral: 5});
    expect(diffBlocks(100, 1, 5)).toEqual({added: 4, deleted: 1, neutral: 0});
    expect(diffBlocks(10, 10, 5)).toEqual({added: 2, deleted: 2, neutral: 1});
  });
});

describe('custom components in a surface', () => {
  it('render from the data model', async () => {
    const processor = new MessageProcessor([triageCatalog]);
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: TRIAGE_CATALOG_ID}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's',
          components: [
            {id: 'root', component: 'Row', children: ['chip', 'avatar', 'ci', 'diff']},
            {
              id: 'chip',
              component: 'LabelChip',
              name: {'@path': '/label/name'},
              color: {'@path': '/label/color'},
            },
            {
              id: 'avatar',
              component: 'Avatar',
              login: 'mallory',
              url: 'https://evil.example/a.png',
            },
            {id: 'ci', component: 'CheckStatus', state: 'failure', label: '1 failed'},
            {id: 'diff', component: 'DiffStat', additions: 12, deletions: 3},
          ],
        },
      },
      {
        version: '1.0',
        updateDataModel: {surfaceId: 's', value: {label: {name: 'type: bug', color: 'd73a4a'}}},
      },
    ] as never);
    const surface = processor.model.getSurface('s');
    const container = document.createElement('div');
    document.body.append(container);
    render(renderA2uiNode(new ComponentContext(surface!, 'root', '/'), triageCatalog), container);
    await new Promise(resolve => setTimeout(resolve, 50));
    // A2UI Lit elements render into their light DOM.
    const find = (tag: string) => container.querySelector(tag) ?? undefined;
    expect(find('a2ui-triage-label-chip')?.textContent).toContain('type: bug');
    expect(find('a2ui-triage-avatar')?.querySelector('img')).toBeNull();
    expect(find('a2ui-triage-avatar')?.textContent).toContain('MA');
    expect(
      find('a2ui-triage-check-status')?.querySelector('[data-state="failure"]'),
    ).not.toBeNull();
    expect(find('a2ui-triage-diff-stat')?.textContent?.replace(/\s+/g, '')).toContain('+12−3');
  });
});

/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect} from 'vitest';
import {render, screen} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSurfaceUpdate, createBeginRendering} from '../../utils';
import type * as Types from '@a2ui/web_core/types/types';

/**
 * Column tests following A2UI specification.
 * Required: children (object with explicitList or template)
 * Optional: distribution, alignment
 *
 * distribution: start, center, end, spaceBetween, spaceAround, spaceEvenly
 * alignment: start, center, end, stretch
 */
describe('Column Component', () => {
  describe('Basic Rendering', () => {
    it('should render a section element', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();
    });

    it('should render with wrapper div', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-column');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('Children Rendering', () => {
    it('should render child Text components', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Row 1'}, usageHint: 'body'}},
          },
          {
            id: 'text-2',
            component: {Text: {text: {literalString: 'Row 2'}, usageHint: 'body'}},
          },
          {
            id: 'col-1',
            component: {Column: {children: {explicitList: ['text-1', 'text-2']}}},
          },
        ]),
        createBeginRendering('col-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByText('Row 1')).toBeInTheDocument();
      expect(screen.getByText('Row 2')).toBeInTheDocument();
    });

    it('should render empty column with empty explicitList', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([{id: 'col-1', component: {Column: {children: {explicitList: []}}}}]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const col = container.querySelector('.a2ui-column');
      expect(col).toBeInTheDocument();
    });
  });

  describe('Alignment', () => {
    it('should default to stretch alignment', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-column');
      expect(wrapper?.getAttribute('data-alignment')).toBe('stretch');
    });

    const alignments = ['start', 'center', 'end', 'stretch'] as const;

    alignments.forEach(alignment => {
      it(`should set data-alignment="${alignment}"`, () => {
        const messages: Types.ServerToClientMessage[] = [
          createSurfaceUpdate([
            {
              id: 'text-1',
              component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
            },
            {
              id: 'col-1',
              component: {Column: {children: {explicitList: ['text-1']}, alignment}},
            },
          ]),
          createBeginRendering('col-1'),
        ];

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        const wrapper = container.querySelector('.a2ui-column');
        expect(wrapper?.getAttribute('data-alignment')).toBe(alignment);
      });
    });
  });

  describe('Distribution', () => {
    it('should default to start distribution', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-column');
      expect(wrapper?.getAttribute('data-distribution')).toBe('start');
    });

    const distributions = [
      'start',
      'center',
      'end',
      'spaceBetween',
      'spaceAround',
      'spaceEvenly',
    ] as const;

    distributions.forEach(distribution => {
      it(`should set data-distribution="${distribution}"`, () => {
        const messages: Types.ServerToClientMessage[] = [
          createSurfaceUpdate([
            {
              id: 'text-1',
              component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
            },
            {
              id: 'col-1',
              component: {Column: {children: {explicitList: ['text-1']}, distribution}},
            },
          ]),
          createBeginRendering('col-1'),
        ];

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        const wrapper = container.querySelector('.a2ui-column');
        expect(wrapper?.getAttribute('data-distribution')).toBe(distribution);
      });
    });
  });

  describe('Nested Layouts', () => {
    it('should render Row inside Column', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Nested text'}, usageHint: 'body'}},
          },
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
          {id: 'col-1', component: {Column: {children: {explicitList: ['row-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(container.querySelector('.a2ui-column')).toBeInTheDocument();
      expect(container.querySelector('.a2ui-row')).toBeInTheDocument();
      expect(screen.getByText('Nested text')).toBeInTheDocument();
    });
  });

  describe('Theme Support', () => {
    it('should apply theme classes to section', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section?.className).toBeTruthy();
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('col-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-column');
      expect(wrapper?.children.length).toBe(1);
      expect(wrapper?.children[0]?.tagName).toBe('SECTION');
    });
  });
});

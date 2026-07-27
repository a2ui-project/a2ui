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
 * Row tests following A2UI specification.
 * Required: children (object with explicitList or template)
 * Optional: distribution, alignment
 *
 * distribution: start, center, end, spaceBetween, spaceAround, spaceEvenly
 * alignment: start, center, end, stretch
 */
describe('Row Component', () => {
  describe('Basic Rendering', () => {
    it('should render a section element', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('row-1'),
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
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-row');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('Children Rendering', () => {
    it('should render child Text components', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item 1'}, usageHint: 'body'}},
          },
          {
            id: 'text-2',
            component: {Text: {text: {literalString: 'Item 2'}, usageHint: 'body'}},
          },
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1', 'text-2']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByText('Item 1')).toBeInTheDocument();
      expect(screen.getByText('Item 2')).toBeInTheDocument();
    });

    it('should render empty row with empty explicitList', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([{id: 'row-1', component: {Row: {children: {explicitList: []}}}}]),
        createBeginRendering('row-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const row = container.querySelector('.a2ui-row');
      expect(row).toBeInTheDocument();
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
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-row');
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
              id: 'row-1',
              component: {Row: {children: {explicitList: ['text-1']}, alignment}},
            },
          ]),
          createBeginRendering('row-1'),
        ];

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        const wrapper = container.querySelector('.a2ui-row');
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
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-row');
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
              id: 'row-1',
              component: {Row: {children: {explicitList: ['text-1']}, distribution}},
            },
          ]),
          createBeginRendering('row-1'),
        ];

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        const wrapper = container.querySelector('.a2ui-row');
        expect(wrapper?.getAttribute('data-distribution')).toBe(distribution);
      });
    });
  });

  describe('Nested Components', () => {
    it('should render multiple Buttons in Row', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'btn1-text',
            component: {Text: {text: {literalString: 'Button 1'}, usageHint: 'body'}},
          },
          {
            id: 'btn2-text',
            component: {Text: {text: {literalString: 'Button 2'}, usageHint: 'body'}},
          },
          {
            id: 'btn-1',
            component: {Button: {child: 'btn1-text', action: {name: 'action1'}}},
          },
          {
            id: 'btn-2',
            component: {Button: {child: 'btn2-text', action: {name: 'action2'}}},
          },
          {id: 'row-1', component: {Row: {children: {explicitList: ['btn-1', 'btn-2']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(2);
      expect(screen.getByText('Button 1')).toBeInTheDocument();
      expect(screen.getByText('Button 2')).toBeInTheDocument();
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
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      // Verify section has className that is defined and has classes applied
      expect(section?.className).toBeDefined();
      expect(typeof section?.className).toBe('string');
      expect(section?.classList.length).toBeGreaterThan(0);
    });
  });

  describe('Differential Behavior', () => {
    it('should render different alignment for different alignment inputs', () => {
      const messagesStart: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {
            id: 'row-1',
            component: {Row: {children: {explicitList: ['text-1']}, alignment: 'start'}},
          },
        ]),
        createBeginRendering('row-1'),
      ];
      const messagesEnd: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {
            id: 'row-1',
            component: {Row: {children: {explicitList: ['text-1']}, alignment: 'end'}},
          },
        ]),
        createBeginRendering('row-1'),
      ];

      const {container: containerStart} = render(
        <TestWrapper>
          <TestRenderer messages={messagesStart} />
        </TestWrapper>,
      );
      const {container: containerEnd} = render(
        <TestWrapper>
          <TestRenderer messages={messagesEnd} />
        </TestWrapper>,
      );

      const rowStart = containerStart.querySelector('.a2ui-row');
      const rowEnd = containerEnd.querySelector('.a2ui-row');

      expect(rowStart?.getAttribute('data-alignment')).toBe('start');
      expect(rowEnd?.getAttribute('data-alignment')).toBe('end');
      expect(rowStart?.getAttribute('data-alignment')).not.toBe(
        rowEnd?.getAttribute('data-alignment'),
      );
    });

    it('should render different distribution for different distribution inputs', () => {
      const messagesCenter: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {
            id: 'row-1',
            component: {Row: {children: {explicitList: ['text-1']}, distribution: 'center'}},
          },
        ]),
        createBeginRendering('row-1'),
      ];
      const messagesSpaceBetween: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
          },
          {
            id: 'row-1',
            component: {
              Row: {children: {explicitList: ['text-1']}, distribution: 'spaceBetween'},
            },
          },
        ]),
        createBeginRendering('row-1'),
      ];

      const {container: containerCenter} = render(
        <TestWrapper>
          <TestRenderer messages={messagesCenter} />
        </TestWrapper>,
      );
      const {container: containerSpaceBetween} = render(
        <TestWrapper>
          <TestRenderer messages={messagesSpaceBetween} />
        </TestWrapper>,
      );

      const rowCenter = containerCenter.querySelector('.a2ui-row');
      const rowSpaceBetween = containerSpaceBetween.querySelector('.a2ui-row');

      expect(rowCenter?.getAttribute('data-distribution')).toBe('center');
      expect(rowSpaceBetween?.getAttribute('data-distribution')).toBe('spaceBetween');
      expect(rowCenter?.getAttribute('data-distribution')).not.toBe(
        rowSpaceBetween?.getAttribute('data-distribution'),
      );
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
          {id: 'row-1', component: {Row: {children: {explicitList: ['text-1']}}}},
        ]),
        createBeginRendering('row-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-row');
      expect(wrapper?.children.length).toBe(1);
      expect(wrapper?.children[0]?.tagName).toBe('SECTION');
    });
  });
});

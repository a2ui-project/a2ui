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
import {render} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSurfaceUpdate, createBeginRendering} from '../utils';
import type * as Types from '@a2ui/web_core/types/types';
import {litTheme} from '../../../src/v0_8/theme/litTheme';

/**
 * Theme Context tests - verify components respect the theme from context.
 *
 * These tests ensure that components read theme classes from ThemeContext
 * rather than hardcoding litTheme values. This catches bugs where a component
 * imports litTheme directly instead of using useTheme().
 */

/**
 * Create a mock theme with distinctly different class values.
 * Uses "test-" prefix to make it obvious when mock theme is applied.
 */
function createMockTheme(): Types.Theme {
  return {
    components: {
      // Content
      AudioPlayer: {'test-audioplayer': true},
      Divider: {'test-divider': true},
      Icon: {'test-icon': true},
      Image: {
        all: {'test-image-all': true},
        avatar: {},
        header: {},
        icon: {},
        largeFeature: {},
        mediumFeature: {},
        smallFeature: {},
      },
      Text: {
        all: {'test-text-all': true},
        h1: {'test-text-h1': true},
        h2: {'test-text-h2': true},
        h3: {},
        h4: {},
        h5: {},
        body: {},
        caption: {},
      },
      Video: {'test-video': true},

      // Layout
      Card: {'test-card': true},
      Column: {'test-column': true},
      List: {'test-list': true},
      Modal: {
        backdrop: {},
        element: {'test-modal-element': true},
      },
      Row: {'test-row': true},
      Tabs: {
        container: {'test-tabs-container': true},
        controls: {all: {'test-tabs-control': true}, selected: {'test-tabs-selected': true}},
        element: {'test-tabs-element': true},
      },

      // Interactive
      Button: {'test-button': true},
      CheckBox: {
        container: {'test-checkbox-container': true},
        element: {},
        label: {},
      },
      DateTimeInput: {
        container: {'test-datetime-container': true},
        label: {},
        element: {},
      },
      MultipleChoice: {
        container: {'test-multiplechoice-container': true},
        label: {},
        element: {},
      },
      Slider: {
        container: {'test-slider-container': true},
        label: {},
        element: {},
      },
      TextField: {
        container: {'test-textfield-container': true},
        label: {},
        element: {},
      },
    },
    elements: {
      a: {},
      audio: {},
      body: {},
      button: {},
      h1: {},
      h2: {},
      h3: {},
      h4: {},
      h5: {},
      iframe: {},
      input: {},
      p: {},
      pre: {},
      textarea: {},
      video: {},
    },
    markdown: {
      p: [],
      h1: [],
      h2: [],
      h3: [],
      h4: [],
      h5: [],
      ul: [],
      ol: [],
      li: [],
      a: [],
      strong: [],
      em: [],
    },
  };
}

describe('ThemeContext', () => {
  describe('Theme Switching', () => {
    it('should apply litTheme classes by default', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Click'}, usageHint: 'body'}},
          },
          {id: 'btn-1', component: {Button: {child: 'text-1', action: {name: 'test'}}}},
        ]),
        createBeginRendering('btn-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = container.querySelector('.a2ui-button button');
      expect(button).toBeInTheDocument();

      // Should have litTheme classes
      const litButtonClasses = Object.keys(litTheme.components.Button);
      expect(litButtonClasses.length).toBeGreaterThan(0);

      // Verify at least one litTheme class is present
      const hasLitClass = litButtonClasses.some(cls => button?.classList.contains(cls));
      expect(hasLitClass).toBe(true);

      // Should NOT have mock theme classes
      expect(button?.classList.contains('test-button')).toBe(false);
    });

    it('should apply custom theme classes when theme prop is provided', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Click'}, usageHint: 'body'}},
          },
          {id: 'btn-1', component: {Button: {child: 'text-1', action: {name: 'test'}}}},
        ]),
        createBeginRendering('btn-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = container.querySelector('.a2ui-button button');
      expect(button).toBeInTheDocument();

      // Should have mock theme class
      expect(button?.classList.contains('test-button')).toBe(true);

      // Should NOT have litTheme classes
      const litButtonClasses = Object.keys(litTheme.components.Button);
      const hasLitClass = litButtonClasses.some(cls => button?.classList.contains(cls));
      expect(hasLitClass).toBe(false);
    });

    it('should apply custom theme to Card component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
          },
          {id: 'card-1', component: {Card: {child: 'text-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-card > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-card')).toBe(true);
    });

    it('should apply custom theme to Text component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Hello'}, usageHint: 'body'}},
          },
        ]),
        createBeginRendering('text-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-text > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-text-all')).toBe(true);
    });

    it('should apply custom theme to Column component', () => {
      const mockTheme = createMockTheme();
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
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-column > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-column')).toBe(true);
    });

    it('should apply custom theme to Row component', () => {
      const mockTheme = createMockTheme();
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
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-row > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-row')).toBe(true);
    });

    it('should apply custom theme to TextField component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'tf-1',
            component: {
              TextField: {
                value: {path: 'test.value'},
                label: {literalString: 'Name'},
              },
            },
          },
        ]),
        createBeginRendering('tf-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-textfield > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-textfield-container')).toBe(true);
    });

    it('should apply custom theme to CheckBox component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'cb-1',
            component: {
              CheckBox: {
                value: {path: 'test.checked'},
                label: {literalString: 'Accept'},
              },
            },
          },
        ]),
        createBeginRendering('cb-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-checkbox > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-checkbox-container')).toBe(true);
    });

    // Components with intentionally empty litTheme classes
    // These tests verify they still respect ThemeContext for future-proofing

    it('should apply custom theme to Tabs component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'tab-content-1',
            component: {Text: {text: {literalString: 'Tab 1 Content'}, usageHint: 'body'}},
          },
          {
            id: 'tab-content-2',
            component: {Text: {text: {literalString: 'Tab 2 Content'}, usageHint: 'body'}},
          },
          {
            id: 'tabs-1',
            component: {
              Tabs: {
                tabItems: [
                  {title: {literalString: 'Tab 1'}, child: 'tab-content-1'},
                  {title: {literalString: 'Tab 2'}, child: 'tab-content-2'},
                ],
              },
            },
          },
        ]),
        createBeginRendering('tabs-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-tabs > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-tabs-container')).toBe(true);
    });

    it('should apply custom theme to Divider component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([{id: 'div-1', component: {Divider: {}}}]),
        createBeginRendering('div-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const hr = container.querySelector('.a2ui-divider hr');
      expect(hr).toBeInTheDocument();
      expect(hr?.classList.contains('test-divider')).toBe(true);
    });

    it('should apply custom theme to Icon component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([{id: 'icon-1', component: {Icon: {name: {literalString: 'home'}}}}]),
        createBeginRendering('icon-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-icon > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-icon')).toBe(true);
    });

    it('should apply custom theme to Slider component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'slider-1',
            component: {
              Slider: {
                value: {path: 'test.slider'},
                min: {literalNumber: 0},
                max: {literalNumber: 100},
              },
            },
          },
        ]),
        createBeginRendering('slider-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-slider > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-slider-container')).toBe(true);
    });

    it('should apply custom theme to MultipleChoice component', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'mc-1',
            component: {
              MultipleChoice: {
                selections: {literalArray: []},
                options: [
                  {label: {literalString: 'Option A'}, value: 'a'},
                  {label: {literalString: 'Option B'}, value: 'b'},
                ],
              },
            },
          },
        ]),
        createBeginRendering('mc-1'),
      ];

      const {container} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-multiplechoice > section');
      expect(section).toBeInTheDocument();
      expect(section?.classList.contains('test-multiplechoice-container')).toBe(true);
    });
  });

  describe('Theme Isolation', () => {
    it('should not leak theme classes between different TestWrapper instances', () => {
      const mockTheme = createMockTheme();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Click'}, usageHint: 'body'}},
          },
          {id: 'btn-1', component: {Button: {child: 'text-1', action: {name: 'test'}}}},
        ]),
        createBeginRendering('btn-1'),
      ];

      // Render with mock theme
      const {container: mockContainer, unmount: unmountMock} = render(
        <TestWrapper theme={mockTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const mockButton = mockContainer.querySelector('.a2ui-button button');
      expect(mockButton?.classList.contains('test-button')).toBe(true);

      unmountMock();

      // Render with default theme
      const {container: defaultContainer} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const defaultButton = defaultContainer.querySelector('.a2ui-button button');
      expect(defaultButton?.classList.contains('test-button')).toBe(false);

      // Should have litTheme classes
      const litButtonClasses = Object.keys(litTheme.components.Button);
      const hasLitClass = litButtonClasses.some(cls => defaultButton?.classList.contains(cls));
      expect(hasLitClass).toBe(true);
    });
  });
});

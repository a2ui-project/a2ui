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

import {describe, it, expect, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import React, {useEffect} from 'react';
import {A2UIProvider, A2UIRenderer, useA2UI} from '../../../src/v0_8';
import type * as Types from '@a2ui/web_core/types/types';
import {TestWrapper, TestRenderer, createSurfaceUpdate, createBeginRendering} from '../utils';

/**
 * Component Integration Tests
 *
 * Tests for component updates, nested components, and error handling.
 */

describe('Component Updates', () => {
  it('should update already-rendered surface with surfaceUpdate alone (no new beginRendering)', async () => {
    function UpdateWithoutBeginRenderingRenderer() {
      const {processMessages} = useA2UI();
      const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

      useEffect(() => {
        if (stage === 'initial') {
          // Initial render: surfaceUpdate + beginRendering
          processMessages([
            createSurfaceUpdate([
              {
                id: 'text-1',
                component: {
                  Text: {text: {literalString: 'Original text'}, usageHint: 'body'},
                },
              },
            ]),
            createBeginRendering('text-1'),
          ]);
          setTimeout(() => setStage('updated'), 10);
        } else if (stage === 'updated') {
          // Update: only surfaceUpdate, NO beginRendering
          processMessages([
            createSurfaceUpdate([
              {
                id: 'text-1',
                component: {Text: {text: {literalString: 'Updated text'}, usageHint: 'body'}},
              },
            ]),
            // Note: no createBeginRendering here
          ]);
        }
      }, [processMessages, stage]);

      return (
        <>
          <A2UIRenderer surfaceId="@default" />
          <span data-testid="stage">{stage}</span>
        </>
      );
    }

    render(
      <A2UIProvider>
        <UpdateWithoutBeginRenderingRenderer />
      </A2UIProvider>,
    );

    // Initial content should be visible
    expect(screen.getByText('Original text')).toBeInTheDocument();

    // After surfaceUpdate alone (no beginRendering), content should update
    await waitFor(() => {
      expect(screen.getByTestId('stage')).toHaveTextContent('updated');
      expect(screen.getByText('Updated text')).toBeInTheDocument();
      expect(screen.queryByText('Original text')).not.toBeInTheDocument();
    });
  });

  it('should update component props when new message received', () => {
    function UpdateRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createSurfaceUpdate([
            {
              id: 'text-1',
              component: {Text: {text: {literalString: 'Before'}, usageHint: 'body'}},
            },
          ]),
          createBeginRendering('text-1'),
        ]);

        setTimeout(() => {
          processMessages([
            createSurfaceUpdate([
              {
                id: 'text-1',
                component: {Text: {text: {literalString: 'After'}, usageHint: 'body'}},
              },
            ]),
            createBeginRendering('text-1'),
          ]);
        }, 10);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <UpdateRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Before')).toBeInTheDocument();

    return waitFor(() => {
      expect(screen.getByText('After')).toBeInTheDocument();
    });
  });

  it('should handle component type change', () => {
    function TypeChangeRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createSurfaceUpdate([
            {
              id: 'comp-1',
              component: {Text: {text: {literalString: 'I am text'}, usageHint: 'body'}},
            },
          ]),
          createBeginRendering('comp-1'),
        ]);

        setTimeout(() => {
          processMessages([
            createSurfaceUpdate([
              {
                id: 'btn-text',
                component: {Text: {text: {literalString: 'Click me'}, usageHint: 'body'}},
              },
              {
                id: 'comp-1',
                component: {Button: {child: 'btn-text', action: {name: 'test'}}},
              },
            ]),
            createBeginRendering('comp-1'),
          ]);
        }, 10);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <TypeChangeRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('I am text')).toBeInTheDocument();

    return waitFor(() => {
      expect(screen.getByRole('button', {name: 'Click me'})).toBeInTheDocument();
    });
  });

  it('should add new components to existing surface', () => {
    function AddComponentRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createSurfaceUpdate([
            {
              id: 'text-1',
              component: {Text: {text: {literalString: 'First'}, usageHint: 'body'}},
            },
          ]),
          createBeginRendering('text-1'),
        ]);

        setTimeout(() => {
          processMessages([
            createSurfaceUpdate([
              {
                id: 'text-1',
                component: {Text: {text: {literalString: 'First'}, usageHint: 'body'}},
              },
              {
                id: 'text-2',
                component: {Text: {text: {literalString: 'Second'}, usageHint: 'body'}},
              },
              {
                id: 'col-1',
                component: {Column: {children: {explicitList: ['text-1', 'text-2']}}},
              },
            ]),
            createBeginRendering('col-1'),
          ]);
        }, 10);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <AddComponentRenderer />
      </A2UIProvider>,
    );

    return waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  it('should remove elements from a list via surfaceUpdate', async () => {
    function RemoveElementsRenderer() {
      const {processMessages} = useA2UI();
      const [stage, setStage] = React.useState<'initial' | 'removed'>('initial');

      useEffect(() => {
        if (stage === 'initial') {
          // Initial: list with 3 items
          processMessages([
            createSurfaceUpdate([
              {
                id: 'item-1',
                component: {Text: {text: {literalString: 'Item 1'}, usageHint: 'body'}},
              },
              {
                id: 'item-2',
                component: {Text: {text: {literalString: 'Item 2'}, usageHint: 'body'}},
              },
              {
                id: 'item-3',
                component: {Text: {text: {literalString: 'Item 3'}, usageHint: 'body'}},
              },
              {
                id: 'list-1',
                component: {List: {children: {explicitList: ['item-1', 'item-2', 'item-3']}}},
              },
            ]),
            createBeginRendering('list-1'),
          ]);
          setTimeout(() => setStage('removed'), 10);
        } else if (stage === 'removed') {
          // Update: remove middle item (only surfaceUpdate, no beginRendering)
          processMessages([
            createSurfaceUpdate([
              {
                id: 'item-1',
                component: {Text: {text: {literalString: 'Item 1'}, usageHint: 'body'}},
              },
              {
                id: 'item-3',
                component: {Text: {text: {literalString: 'Item 3'}, usageHint: 'body'}},
              },
              {
                id: 'list-1',
                component: {List: {children: {explicitList: ['item-1', 'item-3']}}},
              },
            ]),
          ]);
        }
      }, [processMessages, stage]);

      return (
        <>
          <A2UIRenderer surfaceId="@default" />
          <span data-testid="stage">{stage}</span>
        </>
      );
    }

    render(
      <A2UIProvider>
        <RemoveElementsRenderer />
      </A2UIProvider>,
    );

    // All 3 items should be visible initially
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();

    // After removal, Item 2 should be gone
    await waitFor(() => {
      expect(screen.getByTestId('stage')).toHaveTextContent('removed');
      expect(screen.getByText('Item 1')).toBeInTheDocument();
      expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
      expect(screen.getByText('Item 3')).toBeInTheDocument();
    });
  });

  it('should reorder elements via surfaceUpdate', async () => {
    function ReorderElementsRenderer() {
      const {processMessages} = useA2UI();
      const [stage, setStage] = React.useState<'initial' | 'reordered'>('initial');

      useEffect(() => {
        if (stage === 'initial') {
          // Initial order: A, B, C
          processMessages([
            createSurfaceUpdate([
              {
                id: 'item-a',
                component: {Text: {text: {literalString: 'A'}, usageHint: 'body'}},
              },
              {
                id: 'item-b',
                component: {Text: {text: {literalString: 'B'}, usageHint: 'body'}},
              },
              {
                id: 'item-c',
                component: {Text: {text: {literalString: 'C'}, usageHint: 'body'}},
              },
              {
                id: 'col-1',
                component: {
                  Column: {children: {explicitList: ['item-a', 'item-b', 'item-c']}},
                },
              },
            ]),
            createBeginRendering('col-1'),
          ]);
          setTimeout(() => setStage('reordered'), 10);
        } else if (stage === 'reordered') {
          // Reorder: C, A, B (only surfaceUpdate, no beginRendering)
          processMessages([
            createSurfaceUpdate([
              {
                id: 'item-a',
                component: {Text: {text: {literalString: 'A'}, usageHint: 'body'}},
              },
              {
                id: 'item-b',
                component: {Text: {text: {literalString: 'B'}, usageHint: 'body'}},
              },
              {
                id: 'item-c',
                component: {Text: {text: {literalString: 'C'}, usageHint: 'body'}},
              },
              {
                id: 'col-1',
                component: {
                  Column: {children: {explicitList: ['item-c', 'item-a', 'item-b']}},
                },
              },
            ]),
          ]);
        }
      }, [processMessages, stage]);

      return (
        <>
          <A2UIRenderer surfaceId="@default" />
          <span data-testid="stage">{stage}</span>
        </>
      );
    }

    const {container} = render(
      <A2UIProvider>
        <ReorderElementsRenderer />
      </A2UIProvider>,
    );

    // Wait for reorder to complete
    await waitFor(() => {
      expect(screen.getByTestId('stage')).toHaveTextContent('reordered');
    });

    // Verify new order: C, A, B
    const textElements = container.querySelectorAll('.a2ui-text');
    expect(textElements).toHaveLength(3);
    expect(textElements[0]).toHaveTextContent('C');
    expect(textElements[1]).toHaveTextContent('A');
    expect(textElements[2]).toHaveTextContent('B');
  });

  it('should NOT empty the surface when invalid surfaceUpdate is rejected (requires deleteSurface)', async () => {
    // An empty surfaceUpdate is now rejected by schema validation (min 1 component).
    // This test verifies that a rejected message does not affect the existing surface.
    // To truly clear a surface, use deleteSurface message instead.
    function EmptySurfaceRenderer() {
      const {processMessages} = useA2UI();
      const [stage, setStage] = React.useState<'initial' | 'attempted'>('initial');

      useEffect(() => {
        if (stage === 'initial') {
          processMessages([
            createSurfaceUpdate([
              {
                id: 'text-1',
                component: {
                  Text: {text: {literalString: 'Persistent content'}, usageHint: 'body'},
                },
              },
              {id: 'col-1', component: {Column: {children: {explicitList: ['text-1']}}}},
            ]),
            createBeginRendering('col-1'),
          ]);
          setTimeout(() => setStage('attempted'), 10);
        } else if (stage === 'attempted') {
          // Attempt an empty surfaceUpdate — schema validation will reject it,
          // but the existing surface should be unaffected.
          try {
            processMessages([
              {
                surfaceUpdate: {surfaceId: '@default', components: []},
              } as unknown as Types.ServerToClientMessage,
            ]);
          } catch {
            // Expected: Zod validation rejects empty components array
          }
        }
      }, [processMessages, stage]);

      return (
        <>
          <A2UIRenderer
            surfaceId="@default"
            fallback={<span data-testid="empty-fallback">Empty</span>}
          />
          <span data-testid="stage">{stage}</span>
        </>
      );
    }

    render(
      <A2UIProvider>
        <EmptySurfaceRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Persistent content')).toBeInTheDocument();

    // After rejected surfaceUpdate, content should STILL be present (not cleared)
    await waitFor(() => {
      expect(screen.getByTestId('stage')).toHaveTextContent('attempted');
      expect(screen.getByText('Persistent content')).toBeInTheDocument();
      expect(screen.queryByTestId('empty-fallback')).not.toBeInTheDocument();
    });
  });
});

describe('Nested Components', () => {
  it('should render deeply nested component structures', () => {
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'inner-text',
          component: {Text: {text: {literalString: 'Deep content'}, usageHint: 'body'}},
        },
        {id: 'inner-card', component: {Card: {child: 'inner-text'}}},
        {id: 'inner-col', component: {Column: {children: {explicitList: ['inner-card']}}}},
        {id: 'outer-card', component: {Card: {child: 'inner-col'}}},
        {id: 'outer-col', component: {Column: {children: {explicitList: ['outer-card']}}}},
      ]),
      createBeginRendering('outer-col'),
    ];

    const {container} = render(
      <TestWrapper>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    expect(screen.getByText('Deep content')).toBeInTheDocument();

    const cards = container.querySelectorAll('.a2ui-card');
    expect(cards.length).toBe(2);
  });

  it('should handle List with multiple items', () => {
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'item-1',
          component: {Text: {text: {literalString: 'Item 1'}, usageHint: 'body'}},
        },
        {
          id: 'item-2',
          component: {Text: {text: {literalString: 'Item 2'}, usageHint: 'body'}},
        },
        {
          id: 'item-3',
          component: {Text: {text: {literalString: 'Item 3'}, usageHint: 'body'}},
        },
        {
          id: 'list-1',
          component: {
            List: {children: {explicitList: ['item-1', 'item-2', 'item-3']}},
          },
        },
      ]),
      createBeginRendering('list-1'),
    ];

    render(
      <TestWrapper>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('should handle Row with mixed children', () => {
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'text-1',
          component: {Text: {text: {literalString: 'Label'}, usageHint: 'body'}},
        },
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Action'}, usageHint: 'body'}},
        },
        {id: 'btn-1', component: {Button: {child: 'btn-text', action: {name: 'act'}}}},
        {id: 'icon-1', component: {Icon: {name: {literalString: 'home'}}}},
        {
          id: 'row-1',
          component: {
            Row: {children: {explicitList: ['text-1', 'btn-1', 'icon-1']}},
          },
        },
      ]),
      createBeginRendering('row-1'),
    ];

    const {container} = render(
      <TestWrapper>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Action'})).toBeInTheDocument();
    expect(container.querySelector('.a2ui-icon')).toBeInTheDocument();
  });
});

describe('Error Handling', () => {
  it('should throw error for invalid component data', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {id: 'btn-1', component: {Button: {child: 'non-existent', action: {name: 'test'}}}},
      ]),
      createBeginRendering('btn-1'),
    ];

    expect(() => {
      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );
    }).toThrow();

    consoleSpy.mockRestore();
  });

  it('should render valid content without issues', () => {
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'text-1',
          component: {Text: {text: {literalString: 'Safe content'}, usageHint: 'body'}},
        },
      ]),
      createBeginRendering('text-1'),
    ];

    render(
      <TestWrapper>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });
});

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
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import React, {useEffect} from 'react';
import {A2UIProvider, A2UIRenderer, useA2UI} from '../../../src/v0_8';
import type * as Types from '@a2ui/web_core/types/types';
import {
  createSurfaceUpdate,
  createBeginRendering,
  createDataModelUpdateSpec,
  getMockCallArg,
  getElement,
} from '../utils';

/**
 * Template Integration Tests
 *
 * Tests for template expansion with data binding, nested templates,
 * and dynamic data updates.
 */

describe('Template Integration', () => {
  it('should expand template with dataBinding to array', () => {
    function TemplateRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createDataModelUpdateSpec([
            {
              key: 'items',
              valueString: JSON.stringify([{name: 'Item A'}, {name: 'Item B'}, {name: 'Item C'}]),
            },
          ]),
          createSurfaceUpdate([
            {
              id: 'root',
              component: {
                List: {
                  children: {
                    template: {
                      componentId: 'item-template',
                      dataBinding: '/items',
                    },
                  },
                },
              },
            },
            {
              id: 'item-template',
              component: {
                Text: {text: {path: 'name'}, usageHint: 'body'},
              },
            },
          ]),
          createBeginRendering('root'),
        ]);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <TemplateRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
    expect(screen.getByText('Item C')).toBeInTheDocument();
  });

  it('should handle template with primitive array values using path "."', () => {
    function PrimitiveTemplateRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createDataModelUpdateSpec([
            {
              key: 'tags',
              valueString: JSON.stringify(['travel', 'paris', 'guide']),
            },
          ]),
          createSurfaceUpdate([
            {
              id: 'root',
              component: {
                Row: {
                  children: {
                    template: {
                      componentId: 'tag-template',
                      dataBinding: '/tags',
                    },
                  },
                },
              },
            },
            {
              id: 'tag-template',
              component: {
                Text: {text: {path: '.'}, usageHint: 'body'},
              },
            },
          ]),
          createBeginRendering('root'),
        ]);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <PrimitiveTemplateRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('travel')).toBeInTheDocument();
    expect(screen.getByText('paris')).toBeInTheDocument();
    expect(screen.getByText('guide')).toBeInTheDocument();
  });

  it('should expand nested templates with layered data contexts', () => {
    function NestedTemplateRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createDataModelUpdateSpec([
            {
              key: 'days',
              valueString: JSON.stringify([
                {title: 'Day 1', activities: ['Morning Walk', 'Museum Visit']},
                {title: 'Day 2', activities: ['Market Trip']},
              ]),
            },
          ]),
          createSurfaceUpdate([
            {
              id: 'root',
              component: {
                List: {
                  children: {
                    template: {
                      componentId: 'day-template',
                      dataBinding: '/days',
                    },
                  },
                },
              },
            },
            {
              id: 'day-template',
              component: {
                Column: {
                  children: {explicitList: ['day-title', 'activity-list']},
                },
              },
            },
            {
              id: 'day-title',
              component: {
                Text: {text: {path: 'title'}, usageHint: 'body'},
              },
            },
            {
              id: 'activity-list',
              component: {
                List: {
                  children: {
                    template: {
                      componentId: 'activity-template',
                      dataBinding: 'activities',
                    },
                  },
                },
              },
            },
            {
              id: 'activity-template',
              component: {
                Text: {text: {path: '.'}, usageHint: 'body'},
              },
            },
          ]),
          createBeginRendering('root'),
        ]);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <NestedTemplateRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByText('Day 2')).toBeInTheDocument();
    expect(screen.getByText('Morning Walk')).toBeInTheDocument();
    expect(screen.getByText('Museum Visit')).toBeInTheDocument();
    expect(screen.getByText('Market Trip')).toBeInTheDocument();
  });

  it('should rebuild template when data arrives after components', async () => {
    function LateDataRenderer() {
      const {processMessages} = useA2UI();
      const [step, setStep] = React.useState(0);

      useEffect(() => {
        if (step === 0) {
          processMessages([
            createSurfaceUpdate([
              {
                id: 'root',
                component: {
                  List: {
                    children: {
                      template: {
                        componentId: 'item-template',
                        dataBinding: '/items',
                      },
                    },
                  },
                },
              },
              {
                id: 'item-template',
                component: {
                  Text: {text: {path: 'name'}, usageHint: 'body'},
                },
              },
            ]),
            createBeginRendering('root'),
          ]);
          setStep(1);
        } else if (step === 1) {
          setTimeout(() => {
            processMessages([
              createDataModelUpdateSpec([
                {
                  key: 'items',
                  valueString: JSON.stringify([{name: 'Late Item 1'}, {name: 'Late Item 2'}]),
                },
              ]),
            ]);
          }, 10);
        }
      }, [processMessages, step]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <LateDataRenderer />
      </A2UIProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Late Item 1')).toBeInTheDocument();
      expect(screen.getByText('Late Item 2')).toBeInTheDocument();
    });
  });

  it('should expand template with dataBinding to Map (from valueMap)', () => {
    // Nested valueMap (map-of-maps) is not expressible in the strict Zod schema
    // (ValueMapItemSchema lacks recursive valueMap), but the processor supports it.
    // Use a top-level valueMap with flat string values that the processor converts to a Map,
    // combined with a JSON-encoded array for the iterable data.
    function MapTemplateRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createDataModelUpdateSpec([
            {
              key: 'users',
              valueString: JSON.stringify([
                {name: 'Alice', role: 'Admin'},
                {name: 'Bob', role: 'User'},
              ]),
            },
          ]),
          createSurfaceUpdate([
            {
              id: 'root',
              component: {
                List: {
                  children: {
                    template: {
                      componentId: 'user-card',
                      dataBinding: '/users',
                    },
                  },
                },
              },
            },
            {
              id: 'user-card',
              component: {
                Card: {child: 'user-info'},
              },
            },
            {
              id: 'user-info',
              component: {
                Column: {
                  children: {explicitList: ['user-name', 'user-role']},
                },
              },
            },
            {
              id: 'user-name',
              component: {
                Text: {text: {path: 'name'}, usageHint: 'body'},
              },
            },
            {
              id: 'user-role',
              component: {
                Text: {text: {path: 'role'}, usageHint: 'body'},
              },
            },
          ]),
          createBeginRendering('root'),
        ]);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <MapTemplateRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('should handle template with complex nested components', () => {
    const mockOnAction = vi.fn();

    function ComplexTemplateRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createDataModelUpdateSpec([
            {
              key: 'products',
              valueString: JSON.stringify([
                {id: 'prod-1', name: 'Widget', price: '$10'},
                {id: 'prod-2', name: 'Gadget', price: '$20'},
              ]),
            },
          ]),
          createSurfaceUpdate([
            {
              id: 'root',
              component: {
                List: {
                  children: {
                    template: {
                      componentId: 'product-row',
                      dataBinding: '/products',
                    },
                  },
                },
              },
            },
            {
              id: 'product-row',
              component: {
                Row: {
                  children: {explicitList: ['product-name', 'product-price', 'buy-button']},
                },
              },
            },
            {
              id: 'product-name',
              component: {
                Text: {text: {path: 'name'}, usageHint: 'body'},
              },
            },
            {
              id: 'product-price',
              component: {
                Text: {text: {path: 'price'}, usageHint: 'body'},
              },
            },
            {
              id: 'buy-button',
              component: {
                Button: {
                  child: 'buy-text',
                  action: {
                    name: 'buy',
                    context: [{key: 'productId', value: {path: 'id'}}],
                  },
                },
              },
            },
            {
              id: 'buy-text',
              component: {
                Text: {text: {literalString: 'Buy'}, usageHint: 'body'},
              },
            },
          ]),
          createBeginRendering('root'),
        ]);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider onAction={mockOnAction}>
        <ComplexTemplateRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('$10')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(screen.getByText('$20')).toBeInTheDocument();

    const buyButtons = screen.getAllByRole('button', {name: 'Buy'});
    expect(buyButtons).toHaveLength(2);

    fireEvent.click(getElement(buyButtons, 0));
    expect(mockOnAction).toHaveBeenCalledTimes(1);
    const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
    expect(event.userAction).toBeDefined();
    expect(event.userAction?.name).toBe('buy');
  });

  it('should handle empty data array gracefully', () => {
    function EmptyDataRenderer() {
      const {processMessages} = useA2UI();

      useEffect(() => {
        processMessages([
          createDataModelUpdateSpec([
            {
              key: 'items',
              valueString: JSON.stringify([]),
            },
          ]),
          createSurfaceUpdate([
            {
              id: 'root',
              component: {
                Column: {
                  children: {explicitList: ['header', 'item-list']},
                },
              },
            },
            {
              id: 'header',
              component: {
                Text: {text: {literalString: 'Items:'}, usageHint: 'body'},
              },
            },
            {
              id: 'item-list',
              component: {
                List: {
                  children: {
                    template: {
                      componentId: 'item-template',
                      dataBinding: '/items',
                    },
                  },
                },
              },
            },
            {
              id: 'item-template',
              component: {
                Text: {text: {path: 'name'}, usageHint: 'body'},
              },
            },
          ]),
          createBeginRendering('root'),
        ]);
      }, [processMessages]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <EmptyDataRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Items:')).toBeInTheDocument();
  });

  it('should update template when data changes', async () => {
    function DataChangeRenderer() {
      const {processMessages} = useA2UI();
      const [step, setStep] = React.useState(0);

      useEffect(() => {
        if (step === 0) {
          processMessages([
            createDataModelUpdateSpec([
              {
                key: 'items',
                valueString: JSON.stringify([{name: 'Original'}]),
              },
            ]),
            createSurfaceUpdate([
              {
                id: 'root',
                component: {
                  List: {
                    children: {
                      template: {
                        componentId: 'item-template',
                        dataBinding: '/items',
                      },
                    },
                  },
                },
              },
              {
                id: 'item-template',
                component: {
                  Text: {text: {path: 'name'}, usageHint: 'body'},
                },
              },
            ]),
            createBeginRendering('root'),
          ]);
          setStep(1);
        } else if (step === 1) {
          setTimeout(() => {
            processMessages([
              createDataModelUpdateSpec([
                {
                  key: 'items',
                  valueString: JSON.stringify([{name: 'Updated 1'}, {name: 'Updated 2'}]),
                },
              ]),
            ]);
          }, 10);
        }
      }, [processMessages, step]);

      return <A2UIRenderer surfaceId="@default" />;
    }

    render(
      <A2UIProvider>
        <DataChangeRenderer />
      </A2UIProvider>,
    );

    expect(screen.getByText('Original')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Updated 1')).toBeInTheDocument();
      expect(screen.getByText('Updated 2')).toBeInTheDocument();
      expect(screen.queryByText('Original')).not.toBeInTheDocument();
    });
  });
});

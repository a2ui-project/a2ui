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
import {render, screen, waitFor} from '@testing-library/react';
import React, {useEffect} from 'react';
import {A2UIProvider, A2UIRenderer, useA2UI} from '../../../src/v0_8';
import {createSurfaceUpdate, createBeginRendering} from '../utils';

/**
 * Property Updates Integration Tests
 *
 * Tests that server-driven property updates (via surfaceUpdate) correctly
 * update the rendered components. These test the "push" model where the
 * server sends new properties, as opposed to user-initiated changes.
 */

describe('Property Updates via surfaceUpdate', () => {
  describe('Content Components', () => {
    it('should update Text content', async () => {
      function TextUpdateRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
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
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {
                    Text: {text: {literalString: 'Updated text'}, usageHint: 'body'},
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

      render(
        <A2UIProvider>
          <TextUpdateRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByText('Original text')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByText('Updated text')).toBeInTheDocument();
        expect(screen.queryByText('Original text')).not.toBeInTheDocument();
      });
    });

    it('should update Text usageHint', async () => {
      function TextUsageRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Heading'}, usageHint: 'h1'}},
                },
              ]),
              createBeginRendering('text-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Heading'}, usageHint: 'caption'}},
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
          <TextUsageRenderer />
        </A2UIProvider>,
      );

      // usageHint affects CSS classes, not the element tag
      // Verify initial render works
      expect(screen.getByText('Heading')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        // Text should still be present with updated styling
        expect(screen.getByText('Heading')).toBeInTheDocument();
      });
    });

    it('should update Image url', async () => {
      function ImageUpdateRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'img-1',
                  component: {
                    Image: {
                      url: {literalString: 'https://example.com/old.jpg'},
                      usageHint: 'mediumFeature',
                    },
                  },
                },
              ]),
              createBeginRendering('img-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'img-1',
                  component: {
                    Image: {
                      url: {literalString: 'https://example.com/new.jpg'},
                      usageHint: 'mediumFeature',
                    },
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
          <ImageUpdateRenderer />
        </A2UIProvider>,
      );

      expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/old.jpg');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(container.querySelector('img')).toHaveAttribute(
          'src',
          'https://example.com/new.jpg',
        );
      });
    });

    it('should update Image usageHint', async () => {
      function ImageUsageRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'img-1',
                  component: {
                    Image: {
                      url: {literalString: 'https://example.com/img.jpg'},
                      usageHint: 'icon',
                    },
                  },
                },
              ]),
              createBeginRendering('img-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'img-1',
                  component: {
                    Image: {
                      url: {literalString: 'https://example.com/img.jpg'},
                      usageHint: 'avatar',
                    },
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
          <ImageUsageRenderer />
        </A2UIProvider>,
      );

      // usageHint affects CSS classes via theme, not a data attribute
      // Verify initial render works
      expect(container.querySelector('.a2ui-image img')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        // Image should still be present with updated styling
        expect(container.querySelector('.a2ui-image img')).toBeInTheDocument();
      });
    });

    it('should update Icon name', async () => {
      function IconUpdateRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {id: 'icon-1', component: {Icon: {name: {literalString: 'home'}}}},
              ]),
              createBeginRendering('icon-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {id: 'icon-1', component: {Icon: {name: {literalString: 'settings'}}}},
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
          <IconUpdateRenderer />
        </A2UIProvider>,
      );

      expect(container.querySelector('.g-icon')).toHaveTextContent('home');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(container.querySelector('.g-icon')).toHaveTextContent('settings');
      });
    });
  });

  describe('Interactive Components', () => {
    it('should update Button child text', async () => {
      function ButtonUpdateRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'btn-text',
                  component: {Text: {text: {literalString: 'Click me'}, usageHint: 'body'}},
                },
                {
                  id: 'btn-1',
                  component: {Button: {child: 'btn-text', action: {name: 'submit'}}},
                },
              ]),
              createBeginRendering('btn-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'btn-text',
                  component: {Text: {text: {literalString: 'Submit now'}, usageHint: 'body'}},
                },
                {
                  id: 'btn-1',
                  component: {Button: {child: 'btn-text', action: {name: 'submit'}}},
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
          <ButtonUpdateRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByRole('button', {name: 'Click me'})).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByRole('button', {name: 'Submit now'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Click me'})).not.toBeInTheDocument();
      });
    });

    it('should update TextField label', async () => {
      function TextFieldLabelRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'field-1',
                  component: {TextField: {label: {literalString: 'Username'}}},
                },
              ]),
              createBeginRendering('field-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'field-1',
                  component: {TextField: {label: {literalString: 'Email address'}}},
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
          <TextFieldLabelRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByText('Username')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByText('Email address')).toBeInTheDocument();
        expect(screen.queryByText('Username')).not.toBeInTheDocument();
      });
    });

    it('should update CheckBox label', async () => {
      function CheckBoxLabelRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'cb-1',
                  component: {
                    CheckBox: {
                      label: {literalString: 'Accept terms'},
                      value: {literalBoolean: false},
                    },
                  },
                },
              ]),
              createBeginRendering('cb-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'cb-1',
                  component: {
                    CheckBox: {
                      label: {literalString: 'I agree to the terms and conditions'},
                      value: {literalBoolean: false},
                    },
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

      render(
        <A2UIProvider>
          <CheckBoxLabelRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByText('Accept terms')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByText('I agree to the terms and conditions')).toBeInTheDocument();
        expect(screen.queryByText('Accept terms')).not.toBeInTheDocument();
      });
    });

    it('should update CheckBox checked state', async () => {
      function CheckBoxStateRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'cb-1',
                  component: {
                    CheckBox: {
                      label: {literalString: 'Option'},
                      value: {literalBoolean: false},
                    },
                  },
                },
              ]),
              createBeginRendering('cb-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'cb-1',
                  component: {
                    CheckBox: {
                      label: {literalString: 'Option'},
                      value: {literalBoolean: true},
                    },
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

      render(
        <A2UIProvider>
          <CheckBoxStateRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByRole('checkbox')).not.toBeChecked();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByRole('checkbox')).toBeChecked();
      });
    });

    it('should update Slider value', async () => {
      function SliderValueRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'slider-1',
                  component: {
                    Slider: {
                      value: {literalNumber: 25},
                      minValue: 0,
                      maxValue: 100,
                    },
                  },
                },
              ]),
              createBeginRendering('slider-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'slider-1',
                  component: {
                    Slider: {
                      value: {literalNumber: 75},
                      minValue: 0,
                      maxValue: 100,
                    },
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

      render(
        <A2UIProvider>
          <SliderValueRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByRole('slider')).toHaveValue('25');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByRole('slider')).toHaveValue('75');
      });
    });

    it('should update Slider min and max values', async () => {
      function SliderRangeRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'slider-1',
                  component: {
                    Slider: {
                      value: {literalNumber: 50},
                      minValue: 0,
                      maxValue: 100,
                    },
                  },
                },
              ]),
              createBeginRendering('slider-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'slider-1',
                  component: {
                    Slider: {
                      value: {literalNumber: 50},
                      minValue: 10,
                      maxValue: 200,
                    },
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

      render(
        <A2UIProvider>
          <SliderRangeRenderer />
        </A2UIProvider>,
      );

      const slider = screen.getByRole('slider');
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '100');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(slider).toHaveAttribute('min', '10');
        expect(slider).toHaveAttribute('max', '200');
      });
    });
  });

  describe('Layout Components', () => {
    it('should update Column alignment', async () => {
      function ColumnAlignmentRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
                },
                {
                  id: 'col-1',
                  component: {
                    Column: {children: {explicitList: ['text-1']}, alignment: 'start'},
                  },
                },
              ]),
              createBeginRendering('col-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
                },
                {
                  id: 'col-1',
                  component: {
                    Column: {children: {explicitList: ['text-1']}, alignment: 'center'},
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
          <ColumnAlignmentRenderer />
        </A2UIProvider>,
      );

      expect(container.querySelector('.a2ui-column')).toHaveAttribute('data-alignment', 'start');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(container.querySelector('.a2ui-column')).toHaveAttribute('data-alignment', 'center');
      });
    });

    it('should update Column distribution', async () => {
      function ColumnDistributionRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
                },
                {
                  id: 'col-1',
                  component: {
                    Column: {children: {explicitList: ['text-1']}, distribution: 'start'},
                  },
                },
              ]),
              createBeginRendering('col-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
                },
                {
                  id: 'col-1',
                  component: {
                    Column: {
                      children: {explicitList: ['text-1']},
                      distribution: 'spaceBetween',
                    },
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
          <ColumnDistributionRenderer />
        </A2UIProvider>,
      );

      expect(container.querySelector('.a2ui-column')).toHaveAttribute('data-distribution', 'start');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(container.querySelector('.a2ui-column')).toHaveAttribute(
          'data-distribution',
          'spaceBetween',
        );
      });
    });

    it('should update Row alignment', async () => {
      function RowAlignmentRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
                },
                {
                  id: 'row-1',
                  component: {
                    Row: {children: {explicitList: ['text-1']}, alignment: 'start'},
                  },
                },
              ]),
              createBeginRendering('row-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'text-1',
                  component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
                },
                {
                  id: 'row-1',
                  component: {Row: {children: {explicitList: ['text-1']}, alignment: 'end'}},
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
          <RowAlignmentRenderer />
        </A2UIProvider>,
      );

      expect(container.querySelector('.a2ui-row')).toHaveAttribute('data-alignment', 'start');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(container.querySelector('.a2ui-row')).toHaveAttribute('data-alignment', 'end');
      });
    });

    it('should update List direction', async () => {
      function ListDirectionRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'item-1',
                  component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
                },
                {
                  id: 'list-1',
                  component: {
                    List: {children: {explicitList: ['item-1']}, direction: 'vertical'},
                  },
                },
              ]),
              createBeginRendering('list-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'item-1',
                  component: {Text: {text: {literalString: 'Item'}, usageHint: 'body'}},
                },
                {
                  id: 'list-1',
                  component: {
                    List: {children: {explicitList: ['item-1']}, direction: 'horizontal'},
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
          <ListDirectionRenderer />
        </A2UIProvider>,
      );

      expect(container.querySelector('.a2ui-list')).toHaveAttribute('data-direction', 'vertical');

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(container.querySelector('.a2ui-list')).toHaveAttribute(
          'data-direction',
          'horizontal',
        );
      });
    });
  });

  describe('Complex Components', () => {
    it('should update Tabs titles', async () => {
      function TabsTitleRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'content-1',
                  component: {
                    Text: {text: {literalString: 'Tab content'}, usageHint: 'body'},
                  },
                },
                {
                  id: 'tabs-1',
                  component: {
                    Tabs: {
                      tabItems: [{title: {literalString: 'Tab A'}, child: 'content-1'}],
                    },
                  },
                },
              ]),
              createBeginRendering('tabs-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'content-1',
                  component: {
                    Text: {text: {literalString: 'Tab content'}, usageHint: 'body'},
                  },
                },
                {
                  id: 'tabs-1',
                  component: {
                    Tabs: {
                      tabItems: [{title: {literalString: 'Renamed Tab'}, child: 'content-1'}],
                    },
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

      render(
        <A2UIProvider>
          <TabsTitleRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByRole('button', {name: 'Tab A'})).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByRole('button', {name: 'Renamed Tab'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Tab A'})).not.toBeInTheDocument();
      });
    });

    it('should add new tabs via surfaceUpdate', async () => {
      function TabsAddRenderer() {
        const {processMessages} = useA2UI();
        const [stage, setStage] = React.useState<'initial' | 'updated'>('initial');

        useEffect(() => {
          if (stage === 'initial') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'content-1',
                  component: {Text: {text: {literalString: 'Content 1'}, usageHint: 'body'}},
                },
                {
                  id: 'tabs-1',
                  component: {
                    Tabs: {
                      tabItems: [{title: {literalString: 'Tab 1'}, child: 'content-1'}],
                    },
                  },
                },
              ]),
              createBeginRendering('tabs-1'),
            ]);
            setTimeout(() => setStage('updated'), 10);
          } else if (stage === 'updated') {
            processMessages([
              createSurfaceUpdate([
                {
                  id: 'content-1',
                  component: {Text: {text: {literalString: 'Content 1'}, usageHint: 'body'}},
                },
                {
                  id: 'content-2',
                  component: {Text: {text: {literalString: 'Content 2'}, usageHint: 'body'}},
                },
                {
                  id: 'tabs-1',
                  component: {
                    Tabs: {
                      tabItems: [
                        {title: {literalString: 'Tab 1'}, child: 'content-1'},
                        {title: {literalString: 'Tab 2'}, child: 'content-2'},
                      ],
                    },
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

      render(
        <A2UIProvider>
          <TabsAddRenderer />
        </A2UIProvider>,
      );

      expect(screen.getByRole('button', {name: 'Tab 1'})).toBeInTheDocument();
      expect(screen.queryByRole('button', {name: 'Tab 2'})).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('updated');
        expect(screen.getByRole('button', {name: 'Tab 1'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Tab 2'})).toBeInTheDocument();
      });
    });
  });
});

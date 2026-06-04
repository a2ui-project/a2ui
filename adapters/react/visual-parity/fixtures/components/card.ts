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

/**
 * Card component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const card: ComponentFixture = {
  root: 'card-1',
  components: [
    {
      id: 'card-title',
      component: {
        Text: {text: {literalString: 'Card Title'}, usageHint: 'h2'},
      },
    },
    {
      id: 'card-body',
      component: {
        Text: {text: {literalString: 'Card body content goes here.'}},
      },
    },
    {
      id: 'card-content',
      component: {
        Column: {children: {explicitList: ['card-title', 'card-body']}},
      },
    },
    {
      id: 'card-1',
      component: {
        Card: {child: 'card-content'},
      },
    },
  ],
};

export const cardWithImage: ComponentFixture = {
  root: 'card-img',
  components: [
    {
      id: 'card-img-image',
      component: {
        Image: {
          url: {literalString: 'https://picsum.photos/seed/card/300/150'},
          usageHint: 'header',
        },
      },
    },
    {
      id: 'card-img-title',
      component: {
        Text: {text: {literalString: 'Card with Image'}, usageHint: 'h2'},
      },
    },
    {
      id: 'card-img-body',
      component: {
        Text: {text: {literalString: 'This card has a header image above the title.'}},
      },
    },
    {
      id: 'card-img-content',
      component: {
        Column: {
          children: {explicitList: ['card-img-image', 'card-img-title', 'card-img-body']},
        },
      },
    },
    {
      id: 'card-img',
      component: {
        Card: {child: 'card-img-content'},
      },
    },
  ],
};

export const cardComplex: ComponentFixture = {
  root: 'card-complex',
  components: [
    {
      id: 'card-complex-avatar',
      component: {
        Image: {
          url: {literalString: 'https://picsum.photos/seed/avatar/48/48'},
          usageHint: 'avatar',
        },
      },
    },
    {
      id: 'card-complex-name',
      component: {
        Text: {text: {literalString: 'John Doe'}, usageHint: 'h3'},
      },
    },
    {
      id: 'card-complex-role',
      component: {
        Text: {text: {literalString: 'Software Engineer'}, usageHint: 'caption'},
      },
    },
    {
      id: 'card-complex-info',
      component: {
        Column: {children: {explicitList: ['card-complex-name', 'card-complex-role']}},
      },
    },
    {
      id: 'card-complex-header',
      component: {
        Row: {children: {explicitList: ['card-complex-avatar', 'card-complex-info']}},
      },
    },
    {
      id: 'card-complex-divider',
      component: {
        Divider: {},
      },
    },
    {
      id: 'card-complex-body',
      component: {
        Text: {text: {literalString: 'Building amazing user interfaces with A2UI.'}},
      },
    },
    {
      id: 'card-complex-content',
      component: {
        Column: {
          children: {
            explicitList: ['card-complex-header', 'card-complex-divider', 'card-complex-body'],
          },
        },
      },
    },
    {
      id: 'card-complex',
      component: {
        Card: {child: 'card-complex-content'},
      },
    },
  ],
};

export const cardFixtures = {
  card,
  cardWithImage,
  cardComplex,
};

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
 * List component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const listVertical: ComponentFixture = {
  root: 'list-v',
  components: [
    {id: 'list-v-1', component: {Text: {text: {literalString: 'Item 1'}}}},
    {id: 'list-v-2', component: {Text: {text: {literalString: 'Item 2'}}}},
    {id: 'list-v-3', component: {Text: {text: {literalString: 'Item 3'}}}},
    {id: 'list-v-4', component: {Text: {text: {literalString: 'Item 4'}}}},
    {
      id: 'list-v',
      component: {
        List: {children: {explicitList: ['list-v-1', 'list-v-2', 'list-v-3', 'list-v-4']}},
      },
    },
  ],
};

export const listHorizontal: ComponentFixture = {
  root: 'list-h',
  components: [
    {id: 'list-h-1', component: {Icon: {name: {literalString: 'home'}}}},
    {id: 'list-h-2', component: {Icon: {name: {literalString: 'search'}}}},
    {id: 'list-h-3', component: {Icon: {name: {literalString: 'settings'}}}},
    {
      id: 'list-h',
      component: {
        List: {
          children: {explicitList: ['list-h-1', 'list-h-2', 'list-h-3']},
          direction: 'horizontal',
        },
      },
    },
  ],
};

export const listWithCards: ComponentFixture = {
  root: 'list-cards',
  components: [
    // Card 1
    {
      id: 'card1-title',
      component: {Text: {text: {literalString: 'Card One'}, usageHint: 'h3'}},
    },
    {id: 'card1-body', component: {Text: {text: {literalString: 'First card content'}}}},
    {
      id: 'card1-col',
      component: {Column: {children: {explicitList: ['card1-title', 'card1-body']}}},
    },
    {id: 'card1', component: {Card: {child: 'card1-col'}}},
    // Card 2
    {
      id: 'card2-title',
      component: {Text: {text: {literalString: 'Card Two'}, usageHint: 'h3'}},
    },
    {id: 'card2-body', component: {Text: {text: {literalString: 'Second card content'}}}},
    {
      id: 'card2-col',
      component: {Column: {children: {explicitList: ['card2-title', 'card2-body']}}},
    },
    {id: 'card2', component: {Card: {child: 'card2-col'}}},
    // Card 3
    {
      id: 'card3-title',
      component: {Text: {text: {literalString: 'Card Three'}, usageHint: 'h3'}},
    },
    {id: 'card3-body', component: {Text: {text: {literalString: 'Third card content'}}}},
    {
      id: 'card3-col',
      component: {Column: {children: {explicitList: ['card3-title', 'card3-body']}}},
    },
    {id: 'card3', component: {Card: {child: 'card3-col'}}},
    // List
    {
      id: 'list-cards',
      component: {
        List: {children: {explicitList: ['card1', 'card2', 'card3']}},
      },
    },
  ],
};

export const listMixed: ComponentFixture = {
  root: 'list-mixed',
  components: [
    {
      id: 'list-mixed-h',
      component: {Text: {text: {literalString: 'Feature List'}, usageHint: 'h2'}},
    },
    // Feature items with icons
    {id: 'feat1-icon', component: {Icon: {name: {literalString: 'check'}}}},
    {id: 'feat1-text', component: {Text: {text: {literalString: 'Feature One'}}}},
    {
      id: 'feat1',
      component: {Row: {children: {explicitList: ['feat1-icon', 'feat1-text']}}},
    },
    {id: 'feat2-icon', component: {Icon: {name: {literalString: 'check'}}}},
    {id: 'feat2-text', component: {Text: {text: {literalString: 'Feature Two'}}}},
    {
      id: 'feat2',
      component: {Row: {children: {explicitList: ['feat2-icon', 'feat2-text']}}},
    },
    {id: 'feat3-icon', component: {Icon: {name: {literalString: 'check'}}}},
    {id: 'feat3-text', component: {Text: {text: {literalString: 'Feature Three'}}}},
    {
      id: 'feat3',
      component: {Row: {children: {explicitList: ['feat3-icon', 'feat3-text']}}},
    },
    {
      id: 'list-mixed',
      component: {
        List: {children: {explicitList: ['list-mixed-h', 'feat1', 'feat2', 'feat3']}},
      },
    },
  ],
};

export const listFixtures = {
  listVertical,
  listHorizontal,
  listWithCards,
  listMixed,
};

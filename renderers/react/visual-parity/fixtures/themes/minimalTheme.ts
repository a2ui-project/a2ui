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
 * Minimal theme for visual parity tests.
 * A stripped-down theme using neutral colors and basic styling.
 * Tests structural correctness without style interference.
 */

import type {Types} from '@a2ui/lit/0.8';

export const minimalTheme: Types.Theme = {
  components: {
    // Content Components
    Text: {
      all: {
        'layout-w-100': true,
      },
      h1: {
        'typography-w-600': true,
        'typography-sz-hl': true,
        'layout-m-0': true,
      },
      h2: {
        'typography-w-600': true,
        'typography-sz-hm': true,
        'layout-m-0': true,
      },
      h3: {
        'typography-w-600': true,
        'typography-sz-hs': true,
        'layout-m-0': true,
      },
      h4: {
        'typography-w-500': true,
        'typography-sz-tl': true,
        'layout-m-0': true,
      },
      h5: {
        'typography-w-500': true,
        'typography-sz-tm': true,
        'layout-m-0': true,
      },
      body: {},
      caption: {
        'typography-sz-bs': true,
        'color-c-n50': true,
      },
    },

    Icon: {},

    Image: {
      all: {},
      avatar: {'border-br-50': true},
      header: {},
      icon: {},
      largeFeature: {},
      mediumFeature: {},
      smallFeature: {},
    },

    Divider: {},

    AudioPlayer: {},

    Video: {},

    // Layout Components
    Card: {
      'layout-p-3': true,
      'border-br-4': true,
      'border-bw-1': true,
      'color-bc-n80': true,
    },

    Row: {
      'layout-g-2': true,
    },

    Column: {
      'layout-g-2': true,
    },

    List: {
      'layout-g-2': true,
    },

    Modal: {
      backdrop: {},
      element: {
        'layout-p-3': true,
        'border-br-4': true,
      },
    },

    Tabs: {
      element: {},
      controls: {
        all: {},
        selected: {},
      },
      container: {},
    },

    // Interactive Components
    Button: {
      'layout-pt-2': true,
      'layout-pb-2': true,
      'layout-pl-3': true,
      'layout-pr-3': true,
      'border-br-4': true,
      'border-bw-1': true,
      'color-bc-n70': true,
    },

    CheckBox: {
      container: {
        'layout-al-c': true,
        'layout-g-2': true,
      },
      element: {},
      label: {},
    },

    TextField: {
      container: {
        'layout-g-1': true,
      },
      label: {},
      element: {
        'layout-p-2': true,
        'border-br-4': true,
        'border-bw-1': true,
        'color-bc-n70': true,
      },
    },

    Slider: {
      container: {
        'layout-g-1': true,
      },
      label: {},
      element: {},
    },

    DateTimeInput: {
      container: {
        'layout-g-1': true,
      },
      label: {},
      element: {
        'layout-p-2': true,
        'border-br-4': true,
        'border-bw-1': true,
        'color-bc-n70': true,
      },
    },

    MultipleChoice: {
      container: {
        'layout-g-2': true,
      },
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
    p: ['layout-m-0'],
    h1: ['layout-m-0'],
    h2: ['layout-m-0'],
    h3: ['layout-m-0'],
    h4: ['layout-m-0'],
    h5: ['layout-m-0'],
    ul: [],
    ol: [],
    li: [],
    a: [],
    strong: [],
    em: [],
  },
};

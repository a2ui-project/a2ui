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
 * Visual parity theme for visual parity tests.
 * This is an alternate theme designed for testing theme switching.
 */

import type {Types} from '@a2ui/lit/0.8';

export const visualParityTheme: Types.Theme = {
  components: {
    Text: {
      all: {
        'typography-f-s': true,
        'typography-fs-n': true,
        'typography-w-400': true,
        'typography-sz-bm': true,
        'color-c-n10': true,
        'layout-w-100': true,
      },
      h1: {
        'typography-f-sf': true,
        'typography-w-500': true,
        'typography-sz-hl': true,
      },
      h2: {
        'typography-f-sf': true,
        'typography-w-500': true,
        'typography-sz-hm': true,
      },
      h3: {
        'typography-f-sf': true,
        'typography-w-500': true,
        'typography-sz-hs': true,
      },
      h4: {
        'typography-f-sf': true,
        'typography-w-500': true,
        'typography-sz-tl': true,
      },
      h5: {
        'typography-f-sf': true,
        'typography-w-500': true,
        'typography-sz-tm': true,
      },
      body: {},
      caption: {
        'typography-sz-ls': true,
        'color-c-n40': true,
      },
    },
    Icon: {
      'g-icon': true,
      'filled-heavy': true,
    },
    Image: {
      all: {'layout-w-100': true},
      avatar: {'border-br-50': true},
      header: {},
      icon: {},
      largeFeature: {},
      mediumFeature: {},
      smallFeature: {},
    },
    Button: {
      'layout-dis-iflx': true,
      'layout-al-c': true,
      'layout-jc-c': true,
      'layout-g-2': true,
      'layout-pt-3': true,
      'layout-pb-3': true,
      'layout-pl-5': true,
      'layout-pr-5': true,
      'border-br-16': true,
      'border-bw-0': true,
      'color-bgc-p40': true,
      'color-c-n100': true,
      'typography-f-sf': true,
      'typography-w-500': true,
    },
    Card: {
      'layout-p-4': true,
      'layout-dis-flx': true,
      'layout-fd-c': true,
      'layout-g-3': true,
      'border-br-12': true,
      'color-bgc-n98': true,
    },
    Row: {
      'layout-dis-flx': true,
      'layout-fd-r': true,
      'layout-g-2': true,
      'layout-w-100': true,
    },
    Column: {
      'layout-dis-flx': true,
      'layout-fd-c': true,
      'layout-g-2': true,
      'layout-w-100': true,
    },
    List: {
      'layout-dis-flx': true,
      'layout-fd-c': true,
      'layout-g-2': true,
      'layout-w-100': true,
    },
    Divider: {
      'layout-w-100': true,
      'color-bgc-n90': true,
      // Note: 'layout-h-1' was removed - class doesn't exist (only layout-h-10 through layout-h-100)
    },
    TextField: {
      container: {
        'layout-dis-flx': true,
        'layout-fd-c': true,
        'layout-g-1': true,
      },
      label: {
        'typography-f-sf': true,
        'typography-sz-bm': true,
        'color-c-n40': true,
      },
      element: {
        'layout-p-3': true,
        'border-br-8': true,
        'border-bw-1': true,
        'color-bc-n80': true,
      },
    },
    CheckBox: {
      container: {
        'layout-dis-flx': true,
        'layout-al-c': true,
        'layout-g-2': true,
      },
      element: {},
      label: {
        'typography-f-s': true,
        'typography-sz-bm': true,
      },
    },
    Slider: {
      container: {
        'layout-dis-flx': true,
        'layout-fd-c': true,
        'layout-g-1': true,
        'layout-w-100': true,
      },
      label: {
        'typography-f-sf': true,
        'typography-sz-bm': true,
        'color-c-n40': true,
      },
      element: {
        'layout-w-100': true,
      },
    },
    DateTimeInput: {
      container: {
        'layout-dis-flx': true,
        'layout-fd-c': true,
        'layout-g-1': true,
      },
      label: {
        'typography-f-sf': true,
        'typography-sz-bm': true,
        'color-c-n40': true,
      },
      element: {
        'layout-p-3': true,
        'border-br-8': true,
        'border-bw-1': true,
        'color-bc-n80': true,
      },
    },
    MultipleChoice: {
      container: {
        'layout-dis-flx': true,
        'layout-fd-c': true,
        'layout-g-2': true,
      },
      label: {
        'typography-f-sf': true,
        'typography-sz-bm': true,
      },
      element: {},
    },
    AudioPlayer: {
      'layout-w-100': true,
    },
    Video: {
      'layout-w-100': true,
    },
    Modal: {
      backdrop: {
        'layout-pos-f': true,
        'layout-t-0': true,
        'layout-l-0': true,
        'layout-w-100vw': true,
        'layout-h-100vh': true,
        'color-bgc-n0': true,
        'opacity-el-50': true,
      },
      element: {
        'layout-p-4': true,
        'border-br-12': true,
        'color-bgc-n100': true,
      },
    },
    Tabs: {
      element: {
        'layout-dis-flx': true,
        'layout-fd-c': true,
        'layout-g-2': true,
      },
      controls: {
        all: {'layout-p-2': true},
        selected: {'color-bgc-p90': true, 'border-br-8': true},
      },
      container: {
        'layout-dis-flx': true,
        'layout-g-2': true,
      },
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
    // Reset p margin to match non-markdown rendering
    p: ['layout-m-0'],
    // Reset heading margins
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

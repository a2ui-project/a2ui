/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const specDir = join(rootDir, '..', '..', 'specification');

const HEADER = `/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ via scripts/generate-standard-defs.mjs

import type {ChildRefAnalysisOptions} from '../catalog/reference-map.js';
`;

/**
 * Standard v0.8 definitions dictionary (A2UI v0.8 lacked a dedicated common_types.json).
 */
const V08_DEFS = {
  ComponentId: {
    description:
      'The unique identifier for a component, used for both definitions and references within the same surface.',
    type: 'string',
  },
  TextItem: {
    additionalProperties: false,
    description:
      "The value of the text field. This can be a literal string or a reference to a value in the data model ('path', e.g. '/user/name').",
    properties: {
      literalString: {type: 'string'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  UrlItem: {
    additionalProperties: false,
    description:
      "The URL of the audio to be played. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/song/url').",
    properties: {
      literalString: {type: 'string'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  AltTextItem: {
    additionalProperties: false,
    description:
      "The alt text for the image. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/altText').",
    properties: {
      literalString: {type: 'string'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  NameItem: {
    additionalProperties: false,
    description:
      "The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/form/submit').",
    properties: {
      literalString: {
        enum: [
          'accountCircle',
          'add',
          'arrowBack',
          'arrowForward',
          'attachFile',
          'calendarToday',
          'call',
          'camera',
          'check',
          'close',
          'delete',
          'download',
          'edit',
          'event',
          'error',
          'favorite',
          'favoriteOff',
          'folder',
          'help',
          'home',
          'info',
          'locationOn',
          'lock',
          'lockOpen',
          'mail',
          'menu',
          'moreVert',
          'moreHoriz',
          'notificationsOff',
          'notifications',
          'payment',
          'person',
          'phone',
          'photo',
          'print',
          'refresh',
          'search',
          'send',
          'settings',
          'share',
          'shoppingCart',
          'star',
          'starHalf',
          'starOff',
          'upload',
          'visibility',
          'visibilityOff',
          'warning',
        ],
        type: 'string',
      },
      path: {type: 'string'},
    },
    type: 'object',
  },
  DescriptionItem: {
    additionalProperties: false,
    description:
      "A description of the audio, such as a title or summary. This can be a literal string or a reference to a value in the data model ('path', e.g. '/song/title').",
    properties: {
      literalString: {type: 'string'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  ChildrenItem: {
    additionalProperties: false,
    description:
      "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
    properties: {
      explicitList: {
        items: {type: 'string'},
        type: 'array',
      },
      template: {
        $ref: '#/$defs/TemplateItem',
        description:
          'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
      },
    },
    type: 'object',
  },
  TemplateItem: {
    additionalProperties: false,
    description:
      'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
    properties: {
      componentId: {type: 'string'},
      dataBinding: {type: 'string'},
    },
    required: ['componentId', 'dataBinding'],
    type: 'object',
  },
  TabItemItem: {
    additionalProperties: false,
    properties: {
      child: {type: 'string'},
      title: {$ref: '#/$defs/TitleItem'},
    },
    required: ['title', 'child'],
    type: 'object',
  },
  TitleItem: {
    additionalProperties: false,
    description:
      "The tab title. Defines the value as either a literal value or a path to data model value (e.g. '/options/title').",
    properties: {
      literalString: {type: 'string'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  ActionItem: {
    additionalProperties: false,
    description:
      "The client-side action to be dispatched when the button is clicked. It includes the action's name and an optional context payload.",
    properties: {
      context: {
        items: {$ref: '#/$defs/ContextItem'},
        type: 'array',
      },
      name: {type: 'string'},
    },
    required: ['name'],
    type: 'object',
  },
  ContextItem: {
    additionalProperties: false,
    properties: {
      key: {type: 'string'},
      value: {
        $ref: '#/$defs/ValueItem',
        description:
          "Defines the value to be included in the context as either a literal value or a path to a data model value (e.g. '/user/name').",
      },
    },
    required: ['key', 'value'],
    type: 'object',
  },
  ValueItem: {
    additionalProperties: false,
    description:
      "The current value of the slider. This can be a literal number ('literalNumber') or a reference to a value in the data model ('path', e.g. '/restaurant/cost').",
    properties: {
      literalNumber: {type: 'number'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  LabelItem: {
    additionalProperties: false,
    description:
      "The label for the slider. This can be a literal string or a reference to a value in the data model ('path').",
    properties: {
      literalString: {type: 'string'},
      path: {type: 'string'},
    },
    type: 'object',
  },
  OptionItem: {
    additionalProperties: false,
    properties: {
      label: {
        $ref: '#/$defs/LabelItem',
        description:
          "The text to display for this option. This can be a literal string or a reference to a value in the data model (e.g. '/option/label').",
      },
      value: {
        description: 'The value to be associated with this option when selected.',
        type: 'string',
      },
    },
    required: ['label', 'value'],
    type: 'object',
  },
  SelectionItem: {
    additionalProperties: false,
    description:
      "The currently selected values for the component. This can be a literal array of strings or a path to an array in the data model('path', e.g. '/hotel/options').",
    properties: {
      literalArray: {
        items: {type: 'string'},
        type: 'array',
      },
      path: {type: 'string'},
    },
    type: 'object',
  },
};

/**
 * Generates the standard_defs.ts source file content.
 */
function generateDefsFile(versionPrefix, versionLabel, childRefOptions, defsObj) {
  const code = `${HEADER}
/**
 * Child reference analysis configuration for A2UI ${versionLabel} schemas.
 */
export const ${versionPrefix}_CHILD_REF_OPTIONS: ChildRefAnalysisOptions = {
  childRefNames: new Set(${JSON.stringify(Array.from(childRefOptions.childRefNames))}),
  childListRefNames: new Set(${JSON.stringify(Array.from(childRefOptions.childListRefNames))}),
};

/**
 * Standard $defs dictionary for A2UI ${versionLabel} catalog JSON schemas.
 */
export const ${versionPrefix}_STANDARD_DEFS: Record<string, unknown> = ${JSON.stringify(defsObj, null, 2)};
`;
  return code;
}

console.log('Generating standard_defs.ts across protocol versions...');

// 1. v0_8 standard_defs.ts
const v08Code = generateDefsFile(
  'V08',
  'v0.8',
  {
    childRefNames: new Set(['ComponentId', 'Child', 'ChildComponentId']),
    childListRefNames: new Set(['ChildList', 'TemplateChildList']),
  },
  V08_DEFS,
);
writeFileSync(join(rootDir, 'src', 'v0_8', 'standard_defs.ts'), v08Code);

// 2. v0_9 standard_defs.ts
const v09CommonJson = JSON.parse(
  readFileSync(join(specDir, 'v0_9', 'json', 'common_types.json'), 'utf8'),
);
const v09Code = generateDefsFile(
  'V09',
  'v0.9 and v0.9.1',
  {
    childRefNames: new Set(['ComponentId', 'Child', 'ChildComponentId']),
    childListRefNames: new Set(['ChildList', 'TemplateChildList']),
  },
  v09CommonJson.$defs,
);
writeFileSync(join(rootDir, 'src', 'v0_9', 'standard_defs.ts'), v09Code);

// 3. v1_0 standard_defs.ts
const v10CommonJson = JSON.parse(
  readFileSync(join(specDir, 'v1_0', 'json', 'common_types.json'), 'utf8'),
);
const v10Code = generateDefsFile(
  'V10',
  'v1.0',
  {
    childRefNames: new Set(['ComponentId', 'Child', 'ChildComponentId']),
    childListRefNames: new Set(['ChildList', 'TemplateChildList', 'ChildrenItem', 'TemplateItem']),
  },
  v10CommonJson.$defs,
);
writeFileSync(join(rootDir, 'src', 'v1_0', 'standard_defs.ts'), v10Code);

console.log('Successfully generated standard_defs.ts for v0.8, v0.9, and v1.0.');

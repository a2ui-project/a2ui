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

import type {A2UIComponent} from '@/types/widget';

export interface ComponentProp {
  name: string;
  description: string;
  type: string;
  values?: string[];
  default?: string;
}

export interface PreviewConfig {
  root: string;
  components: A2UIComponent[];
  data?: Record<string, unknown>;
}

export interface ComponentDoc {
  name: string;
  description: string;
  usage: string;
  props: ComponentProp[];
  preview?: PreviewConfig;
}

export interface ComponentCategory {
  name: string;
  components: ComponentDoc[];
}

export const COMPONENTS_DATA_V09: ComponentCategory[] = [
  {
    name: 'Layout',
    components: [
      {
        name: 'Row',
        description:
          'Horizontal flex container that arranges children in a row with configurable alignment and justification.',
        usage: `{
  "id": "row-1",
  "component": "Row",
  "align": "center",
  "justify": "spaceBetween",
  "children": ["child-1", "child-2"]
}`,
        props: [
          {
            name: 'children',
            description: 'Array of child component IDs to render inside the row.',
            type: 'string[]',
          },
          {
            name: 'align',
            description: 'Vertical alignment of children within the row.',
            type: 'enum',
            values: ['start', 'center', 'end', 'stretch'],
            default: 'stretch',
          },
          {
            name: 'justify',
            description: 'Horizontal distribution of children along the row.',
            type: 'enum',
            values: [
              'start',
              'center',
              'end',
              'spaceBetween',
              'spaceAround',
              'spaceEvenly',
              'stretch',
            ],
            default: 'start',
          },
        ],
        preview: {
          root: 'row-1',
          components: [
            {
              id: 'row-1',
              component: 'Row',
              align: 'center',
              justify: 'spaceBetween',
              children: ['text-1', 'text-2', 'text-3'],
            } as A2UIComponent,
            {
              id: 'text-1',
              component: 'Text',
              text: 'Left',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'text-2',
              component: 'Text',
              text: 'Center',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'text-3',
              component: 'Text',
              text: 'Right',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Column',
        description:
          'Vertical flex container that arranges children in a column with configurable alignment and justification.',
        usage: `{
  "id": "column-1",
  "component": "Column",
  "align": "stretch",
  "justify": "start",
  "children": ["header", "content", "footer"]
}`,
        props: [
          {
            name: 'children',
            description: 'Array of child component IDs to render inside the column.',
            type: 'string[]',
          },
          {
            name: 'align',
            description: 'Horizontal alignment of children within the column.',
            type: 'enum',
            values: ['start', 'center', 'end', 'stretch'],
            default: 'stretch',
          },
          {
            name: 'justify',
            description: 'Vertical distribution of children along the column.',
            type: 'enum',
            values: [
              'start',
              'center',
              'end',
              'spaceBetween',
              'spaceAround',
              'spaceEvenly',
              'stretch',
            ],
            default: 'start',
          },
        ],
        preview: {
          root: 'column-1',
          components: [
            {
              id: 'column-1',
              component: 'Column',
              align: 'center',
              justify: 'start',
              children: ['text-1', 'text-2', 'text-3'],
            } as A2UIComponent,
            {
              id: 'text-1',
              component: 'Text',
              text: 'Header',
              variant: 'h3',
            } as A2UIComponent,
            {
              id: 'text-2',
              component: 'Text',
              text: 'Content goes here',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'text-3',
              component: 'Text',
              text: 'Footer',
              variant: 'caption',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'List',
        description:
          'Container for rendering lists of items, supporting both vertical and horizontal layouts.',
        usage: `{
  "id": "list-1",
  "component": "List",
  "direction": "vertical",
  "children": {
    "template": {
      "componentId": "list-item",
      "dataBinding": "/items"
    }
  }
}`,
        props: [
          {
            name: 'children',
            description:
              'Child component IDs or template for list items. Use template with dataBinding to render items from data.',
            type: 'string[] | template',
          },
          {
            name: 'direction',
            description: 'Layout direction of list items.',
            type: 'enum',
            values: ['vertical', 'horizontal'],
            default: 'vertical',
          },
          {
            name: 'align',
            description: 'Cross-axis alignment of list items.',
            type: 'enum',
            values: ['start', 'center', 'end', 'stretch'],
            default: 'stretch',
          },
        ],
        preview: {
          root: 'list-1',
          components: [
            {
              id: 'list-1',
              component: 'List',
              direction: 'vertical',
              children: ['item-1', 'item-2', 'item-3'],
            } as A2UIComponent,
            {
              id: 'item-1',
              component: 'Text',
              text: '\u2022 First item',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'item-2',
              component: 'Text',
              text: '\u2022 Second item',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'item-3',
              component: 'Text',
              text: '\u2022 Third item',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Card',
        description:
          'A styled container that provides card-like appearance with elevation and padding.',
        usage: `{
  "id": "card-1",
  "component": "Card",
  "child": "card-content"
}`,
        props: [
          {
            name: 'child',
            description: 'The component ID to render as the card content.',
            type: 'string',
          },
        ],
        preview: {
          root: 'card-1',
          components: [
            {
              id: 'card-1',
              component: 'Card',
              child: 'card-content',
            } as A2UIComponent,
            {
              id: 'card-content',
              component: 'Column',
              children: ['card-title', 'card-body'],
            } as A2UIComponent,
            {
              id: 'card-title',
              component: 'Text',
              text: 'Card Title',
              variant: 'h4',
            } as A2UIComponent,
            {
              id: 'card-body',
              component: 'Text',
              text: 'This is the card content with some descriptive text.',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
    ],
  },
  {
    name: 'Content',
    components: [
      {
        name: 'Text',
        description:
          'Display text content with semantic styling variants. Supports markdown rendering and data binding.',
        usage: `{
  "id": "text-1",
  "component": "Text",
  "text": "Hello, World!",
  "variant": "body"
}`,
        props: [
          {
            name: 'text',
            description:
              'The text content to display. Can be a plain string or a path binding to data.',
            type: 'string | { path: string }',
          },
          {
            name: 'variant',
            description:
              'Semantic variant for text styling. Determines font size, weight, and other typographic properties.',
            type: 'enum',
            values: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
          },
        ],
        preview: {
          root: 'text-container',
          components: [
            {
              id: 'text-container',
              component: 'Column',
              children: ['text-h1', 'text-h2', 'text-h3', 'text-body', 'text-caption'],
            } as A2UIComponent,
            {
              id: 'text-h1',
              component: 'Text',
              text: 'Heading 1',
              variant: 'h1',
            } as A2UIComponent,
            {
              id: 'text-h2',
              component: 'Text',
              text: 'Heading 2',
              variant: 'h2',
            } as A2UIComponent,
            {
              id: 'text-h3',
              component: 'Text',
              text: 'Heading 3',
              variant: 'h3',
            } as A2UIComponent,
            {
              id: 'text-body',
              component: 'Text',
              text: 'Body text for paragraphs and content.',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'text-caption',
              component: 'Text',
              text: 'Caption text for labels and hints',
              variant: 'caption',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Image',
        description: 'Display images with configurable sizing variants and object-fit behavior.',
        usage: `{
  "id": "image-1",
  "component": "Image",
  "url": "https://example.com/photo.jpg",
  "variant": "mediumFeature",
  "fit": "cover"
}`,
        props: [
          {
            name: 'url',
            description: 'The image URL. Can be a plain string or a path binding to data.',
            type: 'string | { path: string }',
          },
          {
            name: 'variant',
            description: 'Semantic variant for image sizing. Affects the rendered dimensions.',
            type: 'enum',
            values: ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'],
          },
          {
            name: 'fit',
            description: 'CSS object-fit value controlling how the image fills its container.',
            type: 'enum',
            values: ['contain', 'cover', 'fill', 'none', 'scaleDown'],
            default: 'fill',
          },
        ],
        preview: {
          root: 'image-1',
          components: [
            {
              id: 'image-1',
              component: 'Image',
              url: 'https://picsum.photos/200/150',
              variant: 'mediumFeature',
              fit: 'cover',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Icon',
        description:
          'Display Material Icons by name. Icons are rendered using the Google Icon font.',
        usage: `{
  "id": "icon-1",
  "component": "Icon",
  "name": "check_circle"
}`,
        props: [
          {
            name: 'name',
            description:
              'The Material Icon name (e.g., "check_circle", "home", "settings"). Uses snake_case naming.',
            type: 'string | { path: string }',
          },
        ],
        preview: {
          root: 'icon-row',
          components: [
            {
              id: 'icon-row',
              component: 'Row',
              justify: 'start',
              align: 'center',
              children: ['icon-1', 'icon-2', 'icon-3', 'icon-4', 'icon-5'],
            } as A2UIComponent,
            {
              id: 'icon-1',
              component: 'Icon',
              name: 'home',
            } as A2UIComponent,
            {
              id: 'icon-2',
              component: 'Icon',
              name: 'settings',
            } as A2UIComponent,
            {
              id: 'icon-3',
              component: 'Icon',
              name: 'check_circle',
            } as A2UIComponent,
            {
              id: 'icon-4',
              component: 'Icon',
              name: 'favorite',
            } as A2UIComponent,
            {
              id: 'icon-5',
              component: 'Icon',
              name: 'star',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Video',
        description: 'Embed video content with native HTML5 video player controls.',
        usage: `{
  "id": "video-1",
  "component": "Video",
  "url": "https://example.com/video.mp4"
}`,
        props: [
          {
            name: 'url',
            description: 'The video URL. Can be a plain string or a path binding to data.',
            type: 'string | { path: string }',
          },
        ],
        preview: {
          root: 'video-1',
          components: [
            {
              id: 'video-1',
              component: 'Video',
              url: 'https://www.w3schools.com/html/mov_bbb.mp4',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'AudioPlayer',
        description: 'Embed audio content with native HTML5 audio player controls.',
        usage: `{
  "id": "audio-1",
  "component": "AudioPlayer",
  "url": "https://example.com/audio.mp3",
  "description": "Episode 1: Introduction"
}`,
        props: [
          {
            name: 'url',
            description: 'The audio URL. Can be a plain string or a path binding to data.',
            type: 'string | { path: string }',
          },
          {
            name: 'description',
            description: 'Optional label or title for the audio content.',
            type: 'string | { path: string }',
          },
        ],
        preview: {
          root: 'audio-card',
          components: [
            {
              id: 'audio-card',
              component: 'Card',
              child: 'audio-1',
            } as A2UIComponent,
            {
              id: 'audio-1',
              component: 'AudioPlayer',
              url: 'https://www.w3schools.com/html/horse.mp3',
            } as A2UIComponent,
          ],
        },
      },
    ],
  },
  {
    name: 'Input',
    components: [
      {
        name: 'TextField',
        description: 'Text input field with label, validation, and multiple input variants.',
        usage: `{
  "id": "textfield-1",
  "component": "TextField",
  "value": { "path": "/user/name" },
  "label": "Your name",
  "variant": "shortText"
}`,
        props: [
          {
            name: 'value',
            description:
              'The current input value. Typically bound to a data path for two-way binding.',
            type: 'string | { path: string }',
          },
          {
            name: 'label',
            description: 'Placeholder or label text displayed in the field.',
            type: 'string | { path: string }',
          },
          {
            name: 'variant',
            description: 'The variant of input field, affecting keyboard and validation behavior.',
            type: 'enum',
            values: ['shortText', 'longText', 'number', 'obscured'],
            default: 'shortText',
          },
          {
            name: 'validationRegexp',
            description: 'Optional regex pattern to validate input.',
            type: 'string',
          },
        ],
        preview: {
          root: 'textfield-1',
          components: [
            {
              id: 'textfield-1',
              component: 'TextField',
              value: {path: '/name'},
              label: 'Enter your name',
              variant: 'shortText',
            } as A2UIComponent,
          ],
          data: {name: ''},
        },
      },
      {
        name: 'CheckBox',
        description: 'Boolean toggle input with an associated label.',
        usage: `{
  "id": "checkbox-1",
  "component": "CheckBox",
  "label": "I agree to the terms",
  "value": { "path": "/form/agreed" }
}`,
        props: [
          {
            name: 'label',
            description: 'Text label displayed next to the checkbox.',
            type: 'string | { path: string }',
          },
          {
            name: 'value',
            description: 'The checked state. Typically bound to a data path for two-way binding.',
            type: 'boolean | { path: string }',
          },
        ],
        preview: {
          root: 'checkbox-1',
          components: [
            {
              id: 'checkbox-1',
              component: 'CheckBox',
              label: 'I agree to the terms and conditions',
              value: {path: '/agreed'},
            } as A2UIComponent,
          ],
          data: {agreed: false},
        },
      },
      {
        name: 'Slider',
        description: 'Numeric range input with configurable min/max values.',
        usage: `{
  "id": "slider-1",
  "component": "Slider",
  "value": { "path": "/settings/volume" },
  "min": 0,
  "max": 100
}`,
        props: [
          {
            name: 'value',
            description:
              'The current slider value. Typically bound to a data path for two-way binding.',
            type: 'number | { path: string }',
          },
          {
            name: 'label',
            description: 'The label for the slider.',
            type: 'string',
          },
          {
            name: 'min',
            description: 'Minimum allowed value.',
            type: 'number',
            default: '0',
          },
          {
            name: 'max',
            description: 'Maximum allowed value.',
            type: 'number',
          },
        ],
        preview: {
          root: 'slider-1',
          components: [
            {
              id: 'slider-1',
              component: 'Slider',
              value: {path: '/volume'},
              min: 0,
              max: 100,
            } as A2UIComponent,
          ],
          data: {volume: 50},
        },
      },
      {
        name: 'DateTimeInput',
        description: 'Date and/or time picker with configurable format output.',
        usage: `{
  "id": "datetime-1",
  "component": "DateTimeInput",
  "value": { "path": "/event/startDate" },
  "enableDate": true,
  "enableTime": true,
  "outputFormat": "YYYY-MM-DD HH:mm"
}`,
        props: [
          {
            name: 'value',
            description:
              'The current date/time value in ISO format. Typically bound to a data path.',
            type: 'string | { path: string }',
          },
          {
            name: 'label',
            description: 'The text label for the input field.',
            type: 'string',
          },
          {
            name: 'enableDate',
            description: 'Whether to show the date picker.',
            type: 'boolean',
            default: 'true',
          },
          {
            name: 'enableTime',
            description: 'Whether to show the time picker.',
            type: 'boolean',
            default: 'true',
          },
          {
            name: 'outputFormat',
            description: 'Format string for the output value (e.g., "YYYY-MM-DD").',
            type: 'string',
          },
          {
            name: 'min',
            description: 'Minimum allowed date/time value (ISO 8601 format).',
            type: 'string',
          },
          {
            name: 'max',
            description: 'Maximum allowed date/time value (ISO 8601 format).',
            type: 'string',
          },
        ],
        preview: {
          root: 'datetime-1',
          components: [
            {
              id: 'datetime-1',
              component: 'DateTimeInput',
              value: {path: '/date'},
              enableDate: true,
              enableTime: false,
            } as A2UIComponent,
          ],
          data: {date: '2025-01-15'},
        },
      },
      {
        name: 'ChoicePicker',
        description:
          'Selection input for choosing from predefined options. Supports single and multiple selection via radio buttons or checkboxes.',
        usage: `{
  "id": "choice-1",
  "component": "ChoicePicker",
  "options": { "path": "/form/country" },
  "variant": "mutuallyExclusive",
  "choices": [
    { "label": "United States", "value": "US" },
    { "label": "Canada", "value": "CA" },
    { "label": "Mexico", "value": "MX" }
  ],
  "maxAllowedSelections": 1
}`,
        props: [
          {
            name: 'options',
            description: 'Currently selected value(s). Bound to a data path for two-way binding.',
            type: 'string[] | { path: string }',
          },
          {
            name: 'choices',
            description: 'Array of available choices with label and value.',
            type: 'array',
          },
          {
            name: 'variant',
            description: 'Visual variant for the choice picker.',
            type: 'enum',
            values: ['multipleSelection', 'mutuallyExclusive'],
          },
          {
            name: 'displayStyle',
            description: 'Visual display style for the choices.',
            type: 'enum',
            values: ['checkbox', 'chips'],
            default: 'checkbox',
          },
          {
            name: 'filterable',
            description: 'Whether choices can be filtered by typing.',
            type: 'boolean',
            default: 'false',
          },
          {
            name: 'maxAllowedSelections',
            description: 'Maximum number of selections allowed. Use 1 for single-select behavior.',
            type: 'number',
          },
        ],
        // No preview — ChoicePicker requires live data binding for options.
      },
    ],
  },
  {
    name: 'Navigation',
    components: [
      {
        name: 'Button',
        description:
          'Interactive button that triggers an action when clicked. Contains a child component for its content.',
        usage: `{
  "id": "button-1",
  "component": "Button",
  "child": "button-label",
  "variant": "primary",
  "action": {
    "event": {
      "name": "submit",
      "context": [
        { "key": "formId", "value": "contact-form" }
      ]
    }
  }
}`,
        props: [
          {
            name: 'child',
            description:
              'Component ID to render as the button content (typically a Text or Row with Icon + Text).',
            type: 'string',
          },
          {
            name: 'variant',
            description: 'Visual variant for the button.',
            type: 'enum',
            values: ['default', 'primary', 'borderless'],
          },
          {
            name: 'action',
            description:
              'Action configuration dispatched when the button is clicked. Contains an event object with name and optional context.',
            type: 'Action',
          },
        ],
        preview: {
          root: 'button-row',
          components: [
            {
              id: 'button-row',
              component: 'Row',
              justify: 'start',
              align: 'center',
              children: ['button-1', 'button-2'],
            } as A2UIComponent,
            {
              id: 'button-1',
              component: 'Button',
              child: 'button-label-1',
              variant: 'primary',
              action: {event: {name: 'primary-action'}},
            } as A2UIComponent,
            {
              id: 'button-label-1',
              component: 'Text',
              text: 'Submit',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'button-2',
              component: 'Button',
              child: 'button-label-2',
              variant: 'borderless',
              action: {event: {name: 'secondary-action'}},
            } as A2UIComponent,
            {
              id: 'button-label-2',
              component: 'Row',
              align: 'center',
              children: ['btn-icon', 'btn-text'],
            } as A2UIComponent,
            {
              id: 'btn-icon',
              component: 'Icon',
              name: 'add',
            } as A2UIComponent,
            {
              id: 'btn-text',
              component: 'Text',
              text: 'Add Item',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Tabs',
        description:
          'Tab navigation component with multiple panels. Each tab has a title and associated content.',
        usage: `{
  "id": "tabs-1",
  "component": "Tabs",
  "tabs": [
    { "title": "Overview", "child": "tab-overview" },
    { "title": "Details", "child": "tab-details" },
    { "title": "Reviews", "child": "tab-reviews" }
  ]
}`,
        props: [
          {
            name: 'tabs',
            description:
              'Array of tab configurations, each with a title string and child component ID.',
            type: 'array',
          },
        ],
        preview: {
          root: 'tabs-1',
          components: [
            {
              id: 'tabs-1',
              component: 'Tabs',
              tabs: [
                {title: 'Overview', child: 'tab-1'},
                {title: 'Details', child: 'tab-2'},
                {title: 'Reviews', child: 'tab-3'},
              ],
            } as A2UIComponent,
            {
              id: 'tab-1',
              component: 'Text',
              text: 'This is the overview content.',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'tab-2',
              component: 'Text',
              text: 'Here are the details.',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'tab-3',
              component: 'Text',
              text: 'User reviews go here.',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
      {
        name: 'Modal',
        description: 'Dialog/popup component with a trigger element and content panel.',
        usage: `{
  "id": "modal-1",
  "component": "Modal",
  "trigger": "open-modal-button",
  "content": "modal-content"
}`,
        props: [
          {
            name: 'trigger',
            description:
              'Component ID of the element that triggers the modal (typically a Button).',
            type: 'string',
          },
          {
            name: 'content',
            description: 'Component ID of the content to display inside the modal.',
            type: 'string',
          },
        ],
        preview: {
          root: 'modal-1',
          components: [
            {
              id: 'modal-1',
              component: 'Modal',
              trigger: 'modal-trigger',
              content: 'modal-content',
            } as A2UIComponent,
            {
              id: 'modal-trigger',
              component: 'Button',
              child: 'modal-trigger-text',
              variant: 'primary',
              action: {event: {name: 'open-modal'}},
            } as A2UIComponent,
            {
              id: 'modal-trigger-text',
              component: 'Text',
              text: 'Open Modal',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'modal-content',
              component: 'Column',
              children: ['modal-title', 'modal-body'],
            } as A2UIComponent,
            {
              id: 'modal-title',
              component: 'Text',
              text: 'Modal Title',
              variant: 'h3',
            } as A2UIComponent,
            {
              id: 'modal-body',
              component: 'Text',
              text: 'This is the modal content. Click outside or the X to close.',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
    ],
  },
  {
    name: 'Decoration',
    components: [
      {
        name: 'Divider',
        description: 'Visual separator line between content sections.',
        usage: `{
  "id": "divider-1",
  "component": "Divider",
  "axis": "horizontal"
}`,
        props: [
          {
            name: 'axis',
            description: 'Orientation of the divider line.',
            type: 'enum',
            values: ['horizontal', 'vertical'],
          },
        ],
        preview: {
          root: 'divider-demo',
          components: [
            {
              id: 'divider-demo',
              component: 'Column',
              children: ['text-above', 'divider-1', 'text-below'],
            } as A2UIComponent,
            {
              id: 'text-above',
              component: 'Text',
              text: 'Content above',
              variant: 'body',
            } as A2UIComponent,
            {
              id: 'divider-1',
              component: 'Divider',
              axis: 'horizontal',
            } as A2UIComponent,
            {
              id: 'text-below',
              component: 'Text',
              text: 'Content below',
              variant: 'body',
            } as A2UIComponent,
          ],
        },
      },
    ],
  },
];

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
 * A complex A2UI surface definition for the v0.9 demo.
 */
export const KITCHEN_SINK_SURFACE = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'demo-surface',
      catalogId: 'demo',
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'demo-surface',
      path: '/',
      value: {
        user: {
          name: 'Guest',
          email: '',
        },
        form: {
          submitted: false,
          responseMessage: '',
        },
        settings: {
          theme: 'light',
        },
      },
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'demo-surface',
      components: [
        {
          id: 'root',
          component: 'Column',
          align: 'start',
          justify: 'start',
          children: ['header', 'form-section', 'footer'],
        },
        {
          id: 'header',
          component: 'Row',
          children: ['logo', 'welcome-text'],
          align: 'center',
        },
        {
          id: 'logo',
          component: 'Text',
          text: 'A2UI v0.9',
          weight: 700,
        },
        {
          id: 'welcome-text',
          component: 'Text',
          text: {
            call: 'formatString',
            args: {
              value: 'Welcome, {{/user/name}}!',
            },
          },
        },
        {
          id: 'form-section',
          component: 'Card',
          child: 'form-column',
        },
        {
          id: 'form-column',
          component: 'Column',
          children: ['name-field', 'email-field', 'submit-btn', 'result-msg'],
        },
        {
          id: 'name-field',
          component: 'TextField',
          label: 'Your Name',
          value: {path: '/user/name'},
        },
        {
          id: 'satisfaction-slider',
          component: 'CustomSlider',
          label: 'Satisfaction Level',
          value: {path: '/user/satisfaction'},
          min: 0,
          max: 10,
        },
        {
          id: 'email-field',
          component: 'TextField',
          label: 'Email Address',
          value: {path: '/user/email'},
          variant: 'shortText',
        },
        {
          id: 'submit-btn',
          component: 'Button',
          child: 'submit-text',
          variant: 'primary',
          action: {
            event: {
              name: 'submit_form',
              context: {
                name: {path: '/user/name'},
                email: {path: '/user/email'},
              },
            },
          },
        },
        {
          id: 'submit-text',
          component: 'Text',
          text: 'Submit',
        },
        {
          id: 'result-msg',
          component: 'Text',
          text: {path: '/form/responseMessage'},
        },
        {
          id: 'footer',
          component: 'Row',
          children: ['copy-text'],
        },
        {
          id: 'copy-text',
          component: 'Text',
          text: 'Powered by web_core v0.9',
        },
      ],
    },
  },
];

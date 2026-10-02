// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:a2ui_flutter/a2ui_flutter.dart';

/// Represents a sample A2UI scenario for the Explorer app.
class ExplorerScenario {
  final String id;
  final String title;
  final String description;
  final List<Map<String, dynamic>> rawMessages;

  const ExplorerScenario({
    required this.id,
    required this.title,
    required this.description,
    required this.rawMessages,
  });

  /// The surface ID declared in the scenario's createSurface message.
  String get surfaceId {
    for (final Map<String, dynamic> raw in rawMessages) {
      if (raw.containsKey('createSurface') && raw['createSurface'] is Map) {
        return (raw['createSurface'] as Map)['surfaceId'] as String? ?? id;
      }
    }
    return id;
  }
}

/// Standard scenarios showcasing basic catalog components and progressive
/// rendering.
final List<ExplorerScenario> standardScenarios = [
  const ExplorerScenario(
    id: 'simple-text',
    title: '1. Simple Text',
    description: 'Basic Text component with heading variants.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'simple-text',
          'catalogId': basicCatalogIdV09,
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'simple-text',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['h1-text', 'body-text', 'caption-text'],
              'justify': 'start',
              'align': 'start',
            },
            {
              'id': 'h1-text',
              'component': 'Text',
              'text': 'A2UI Flutter Framework Adapter',
              'variant': 'h1',
            },
            {
              'id': 'body-text',
              'component': 'Text',
              'text':
                  'This Flutter framework adapter builds directly on the '
                  'Node API of a2ui_core, translating streaming UI trees '
                  'into native widgets.',
              'variant': 'body',
            },
            {
              'id': 'caption-text',
              'component': 'Text',
              'text': 'Protocol Version: v0.9 • Spec-Driven Development',
              'variant': 'caption',
            },
          ],
        },
      },
    ],
  ),
  const ExplorerScenario(
    id: 'row-layout',
    title: '2. Row & Card Layout',
    description: 'Horizontal Row alignment and Card containers.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'row-layout',
          'catalogId': basicCatalogIdV09,
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'row-layout',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['card-1', 'divider-1', 'stats-row'],
              'justify': 'start',
              'align': 'stretch',
            },
            {'id': 'card-1', 'component': 'Card', 'child': 'card-col'},
            {
              'id': 'card-col',
              'component': 'Column',
              'children': ['card-title', 'card-body'],
            },
            {
              'id': 'card-title',
              'component': 'Text',
              'text': 'Featured Container Card',
              'variant': 'h3',
            },
            {
              'id': 'card-body',
              'component': 'Text',
              'text':
                  'Components inside Card are padded and rendered with '
                  'subtle elevation.',
              'variant': 'body',
            },
            {'id': 'divider-1', 'component': 'Divider'},
            {
              'id': 'stats-row',
              'component': 'Row',
              'children': ['stat-a', 'stat-b', 'stat-c'],
              'justify': 'spaceBetween',
              'align': 'center',
            },
            {
              'id': 'stat-a',
              'component': 'Text',
              'text': '🚀 Latency: 12ms',
              'variant': 'body',
            },
            {
              'id': 'stat-b',
              'component': 'Text',
              'text': '⚡ Nodes: 8',
              'variant': 'body',
            },
            {
              'id': 'stat-c',
              'component': 'Text',
              'text': '✅ Status: Online',
              'variant': 'body',
            },
          ],
        },
      },
    ],
  ),
  const ExplorerScenario(
    id: 'interactive-button',
    title: '3. Interactive Button',
    description: 'Button triggers client action events with context.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'interactive-button',
          'catalogId': basicCatalogIdV09,
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'interactive-button',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['prompt-text', 'btn-primary', 'btn-borderless'],
              'justify': 'start',
              'align': 'center',
            },
            {
              'id': 'prompt-text',
              'component': 'Text',
              'text': 'Click an action button to inspect client events:',
              'variant': 'h3',
            },
            {
              'id': 'btn-primary',
              'component': 'Button',
              'child': 'lbl-primary',
              'variant': 'primary',
              'action': {
                'event': {
                  'name': 'primary_action_clicked',
                  'context': {'button': 'primary', 'priority': 'high'},
                },
              },
            },
            {
              'id': 'lbl-primary',
              'component': 'Text',
              'text': 'Primary Elevated Action',
            },
            {
              'id': 'btn-borderless',
              'component': 'Button',
              'child': 'lbl-borderless',
              'variant': 'borderless',
              'action': {
                'event': {
                  'name': 'secondary_action_clicked',
                  'context': {'button': 'borderless'},
                },
              },
            },
            {
              'id': 'lbl-borderless',
              'component': 'Text',
              'text': 'Borderless Flat Action',
            },
          ],
        },
      },
    ],
  ),
  const ExplorerScenario(
    id: 'two-way-login-form',
    title: '4. Login Form (Two-Way Binding)',
    description:
        'Two-way data binding with TextField and reactive live reflection.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'two-way-login-form',
          'catalogId': basicCatalogIdV09,
          'sendDataModel': true,
        },
      },
      {
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 'two-way-login-form',
          'path': '/',
          'value': {'username': 'ada_lovelace', 'password': ''},
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'two-way-login-form',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['form-card', 'preview-title', 'preview-username'],
              'justify': 'start',
              'align': 'stretch',
            },
            {'id': 'form-card', 'component': 'Card', 'child': 'form-col'},
            {
              'id': 'form-col',
              'component': 'Column',
              'children': [
                'title',
                'username-field',
                'password-field',
                'submit-btn',
              ],
            },
            {
              'id': 'title',
              'component': 'Text',
              'text': 'Sign In to A2UI',
              'variant': 'h2',
            },
            {
              'id': 'username-field',
              'component': 'TextField',
              'label': 'Username',
              'value': {'path': '/username'},
              'variant': 'shortText',
            },
            {
              'id': 'password-field',
              'component': 'TextField',
              'label': 'Password',
              'value': {'path': '/password'},
              'variant': 'obscured',
            },
            {
              'id': 'submit-btn',
              'component': 'Button',
              'child': 'submit-lbl',
              'variant': 'primary',
              'action': {
                'event': {
                  'name': 'login_submitted',
                  'context': {
                    'username': {'path': '/username'},
                  },
                },
              },
            },
            {
              'id': 'submit-lbl',
              'component': 'Text',
              'text': 'Submit Credentials',
            },
            {
              'id': 'preview-title',
              'component': 'Text',
              'text': 'Live Bound Data Mirror:',
              'variant': 'h4',
            },
            {
              'id': 'preview-username',
              'component': 'Text',
              'text': {'path': '/username'},
              'variant': 'body',
            },
          ],
        },
      },
    ],
  ),
  const ExplorerScenario(
    id: 'progressive-rendering',
    title: '5. Progressive Stepper',
    description:
        'Demonstrates placeholder stand-in upgraded in-place '
        'when child arrives.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'progressive-rendering',
          'catalogId': basicCatalogIdV09,
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'progressive-rendering',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['header-text', 'pending-child'],
              'justify': 'start',
              'align': 'stretch',
            },
            {
              'id': 'header-text',
              'component': 'Text',
              'text': 'Step 1: Root Column rendered with pending child below:',
              'variant': 'h3',
            },
          ],
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'progressive-rendering',
          'components': [
            {
              'id': 'pending-child',
              'component': 'Card',
              'child': 'arrived-content',
            },
            {
              'id': 'arrived-content',
              'component': 'Text',
              'text':
                  'Step 2: Concrete component definition arrived! '
                  'Placeholder upgraded in-place.',
              'variant': 'body',
            },
          ],
        },
      },
    ],
  ),
  const ExplorerScenario(
    id: 'choice-picker-demo',
    title: '6. ChoicePicker (Chips & List)',
    description:
        'Single & multiple selections using chips and radio/checkbox lists.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'choice-picker-demo',
          'catalogId': basicCatalogIdV09,
        },
      },
      {
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 'choice-picker-demo',
          'path': '/',
          'value': {
            'role': ['engineer'],
            'skills': ['flutter', 'dart'],
          },
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'choice-picker-demo',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['card-single', 'card-multi'],
              'justify': 'start',
              'align': 'stretch',
            },
            {
              'id': 'card-single',
              'component': 'Card',
              'child': 'picker-single',
            },
            {
              'id': 'picker-single',
              'component': 'ChoicePicker',
              'label': 'Select Role (Mutually Exclusive):',
              'variant': 'mutuallyExclusive',
              'displayStyle': 'checkbox',
              'options': [
                {'label': 'Software Engineer', 'value': 'engineer'},
                {'label': 'Product Designer', 'value': 'designer'},
                {'label': 'AI Researcher', 'value': 'researcher'},
              ],
              'value': {'path': '/role'},
            },
            {'id': 'card-multi', 'component': 'Card', 'child': 'picker-multi'},
            {
              'id': 'picker-multi',
              'component': 'ChoicePicker',
              'label': 'Skills (Filterable Chips):',
              'variant': 'multipleSelection',
              'displayStyle': 'chips',
              'filterable': true,
              'options': [
                {'label': 'Flutter', 'value': 'flutter'},
                {'label': 'Dart', 'value': 'dart'},
                {'label': 'TypeScript', 'value': 'ts'},
                {'label': 'Python', 'value': 'python'},
                {'label': 'SwiftUI', 'value': 'swiftui'},
              ],
              'value': {'path': '/skills'},
            },
          ],
        },
      },
    ],
  ),
  const ExplorerScenario(
    id: 'controls-and-datetime',
    title: '7. Controls & Date/Time',
    description:
        'Slider, CheckBox, and DateTimeInput inputs bound to DataModel.',
    rawMessages: [
      {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 'controls-and-datetime',
          'catalogId': basicCatalogIdV09,
        },
      },
      {
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 'controls-and-datetime',
          'path': '/',
          'value': {
            'eventDate': '2026-10-15',
            'volume': 65.0,
            'notifications': true,
          },
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'controls-and-datetime',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['date-picker', 'volume-slider', 'notif-checkbox'],
              'justify': 'start',
              'align': 'stretch',
            },
            {
              'id': 'date-picker',
              'component': 'DateTimeInput',
              'label': 'Target Launch Date',
              'enableDate': true,
              'enableTime': false,
              'value': {'path': '/eventDate'},
            },
            {
              'id': 'volume-slider',
              'component': 'Slider',
              'label': 'Notification Audio Volume (%)',
              'min': 0.0,
              'max': 100.0,
              'value': {'path': '/volume'},
            },
            {
              'id': 'notif-checkbox',
              'component': 'CheckBox',
              'label': 'Enable Real-time Push Notifications',
              'value': {'path': '/notifications'},
            },
          ],
        },
      },
    ],
  ),
];

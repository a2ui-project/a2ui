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
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Basic Catalog Components', () {
    testWidgets('renders Column, Row, Card, Divider, and Text', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'layout-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'layout-surface',
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'children': ['card-1', 'divider-1', 'row-1'],
              },
              {'id': 'card-1', 'component': 'Card', 'child': 'card-text'},
              {
                'id': 'card-text',
                'component': 'Text',
                'text': 'Inside Card',
                'variant': 'h3',
              },
              {'id': 'divider-1', 'component': 'Divider'},
              {
                'id': 'row-1',
                'component': 'Row',
                'children': ['left-text', 'right-text'],
              },
              {'id': 'left-text', 'component': 'Text', 'text': 'Left'},
              {'id': 'right-text', 'component': 'Text', 'text': 'Right'},
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.text('Inside Card'), findsOneWidget);
      expect(find.byType(Card), findsOneWidget);
      expect(find.byType(Divider), findsOneWidget);
      expect(find.text('Left'), findsOneWidget);
      expect(find.text('Right'), findsOneWidget);
      expect(find.byType(Column), findsOneWidget);
      expect(find.byType(Row), findsOneWidget);
    });

    testWidgets('Button triggers action and dispatches A2uiClientAction', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'button-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      final receivedActions = <A2uiClientAction>[];
      surface.onAction.addListener(receivedActions.add);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'button-surface',
            'components': [
              {
                'id': 'root',
                'component': 'Button',
                'child': 'btn-label',
                'variant': 'primary',
                'action': {
                  'event': {
                    'name': 'submit_pressed',
                    'context': {'testKey': 'testVal'},
                  },
                },
              },
              {'id': 'btn-label', 'component': 'Text', 'text': 'Submit Form'},
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.text('Submit Form'), findsOneWidget);
      await tester.tap(find.text('Submit Form'));
      await tester.pump();

      expect(receivedActions.length, 1);
      expect(receivedActions.first.name, 'submit_pressed');
      expect(receivedActions.first.surfaceId, 'button-surface');
      expect(receivedActions.first.context['testKey'], 'testVal');
    });

    testWidgets(
      'TextField two-way data binding updates DataModel and reactive Text',
      (WidgetTester tester) async {
        final Catalog<FlutterComponentImplementation, FunctionImplementation>
        catalog = createBasicCatalog();
        final surface = SurfaceModel<FlutterComponentImplementation>(
          'form-surface',
          catalog: catalog,
        );

        final processor = MessageProcessor<FlutterComponentImplementation>(
          catalogs: [catalog],
          protocolVersion: A2uiProtocolVersion.v0_9,
        );
        processor.groupModel.addSurface(surface);

        processor.processMessages(
          AgentToRendererMessagePayload.fromJson({
            'version': 'v0.9',
            'updateDataModel': {
              'surfaceId': 'form-surface',
              'path': '/',
              'value': {'username': 'initial_user'},
            },
          }, protocolVersion: A2uiProtocolVersion.v0_9),
        );

        processor.processMessages(
          AgentToRendererMessagePayload.fromJson({
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 'form-surface',
              'components': [
                {
                  'id': 'root',
                  'component': 'Column',
                  'children': ['input-field', 'greeting-text'],
                },
                {
                  'id': 'input-field',
                  'component': 'TextField',
                  'label': 'Username',
                  'value': {'path': '/username'},
                },
                {
                  'id': 'greeting-text',
                  'component': 'Text',
                  'text': {'path': '/username'},
                },
              ],
            },
          }, protocolVersion: A2uiProtocolVersion.v0_9),
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: A2uiSurface(surface: surface)),
          ),
        );

        expect(find.text('initial_user'), findsNWidgets(2));
        expect(surface.dataModel.get('/username'), 'initial_user');

        await tester.enterText(find.byType(TextField), 'updated_user');
        await tester.pump();

        expect(surface.dataModel.get('/username'), 'updated_user');
        expect(find.text('updated_user'), findsNWidgets(2));
      },
    );

    testWidgets('CheckBox two-way data binding toggles boolean in DataModel', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'check-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': 'check-surface',
            'path': '/',
            'value': {'agree': false},
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'check-surface',
            'components': [
              {
                'id': 'root',
                'component': 'CheckBox',
                'label': 'I agree to the terms',
                'value': {'path': '/agree'},
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.text('I agree to the terms'), findsOneWidget);
      expect(surface.dataModel.get('/agree'), false);

      await tester.tap(find.byType(CheckboxListTile));
      await tester.pump();

      expect(surface.dataModel.get('/agree'), true);
    });

    testWidgets('Icon and Slider components render correctly', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'controls-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': 'controls-surface',
            'path': '/',
            'value': {'volume': 42.0},
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'controls-surface',
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'children': ['icon-1', 'slider-1'],
              },
              {'id': 'icon-1', 'component': 'Icon', 'name': 'settings'},
              {
                'id': 'slider-1',
                'component': 'Slider',
                'label': 'Volume Level',
                'min': 0.0,
                'max': 100.0,
                'value': {'path': '/volume'},
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.byIcon(Icons.settings), findsOneWidget);
      expect(find.text('Volume Level'), findsOneWidget);
      expect(find.byType(Slider), findsOneWidget);
    });

    testWidgets('List, Tabs, and Modal components function as expected', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'containers-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'containers-surface',
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'children': ['list-1', 'tabs-1', 'modal-1'],
              },
              {
                'id': 'list-1',
                'component': 'List',
                'direction': 'vertical',
                'children': ['item-1', 'item-2'],
              },
              {'id': 'item-1', 'component': 'Text', 'text': 'Item Alpha'},
              {'id': 'item-2', 'component': 'Text', 'text': 'Item Beta'},
              {
                'id': 'tabs-1',
                'component': 'Tabs',
                'tabs': [
                  {'title': 'First Tab', 'child': 'tab-content-1'},
                  {'title': 'Second Tab', 'child': 'tab-content-2'},
                ],
              },
              {
                'id': 'tab-content-1',
                'component': 'Text',
                'text': 'Tab One Content',
              },
              {
                'id': 'tab-content-2',
                'component': 'Text',
                'text': 'Tab Two Content',
              },
              {
                'id': 'modal-1',
                'component': 'Modal',
                'trigger': 'modal-trigger',
                'content': 'modal-content',
              },
              {
                'id': 'modal-trigger',
                'component': 'Button',
                'child': 'modal-btn-text',
                'action': {
                  'event': {'name': 'dummy'},
                },
              },
              {
                'id': 'modal-btn-text',
                'component': 'Text',
                'text': 'Open Dialog',
              },
              {
                'id': 'modal-content',
                'component': 'Text',
                'text': 'Dialog Body Content',
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      // Verify List
      expect(find.text('Item Alpha'), findsOneWidget);
      expect(find.text('Item Beta'), findsOneWidget);

      // Verify Tabs
      expect(find.text('First Tab'), findsOneWidget);
      expect(find.text('Second Tab'), findsOneWidget);
      expect(find.text('Tab One Content'), findsOneWidget);

      // Verify Modal trigger & opening
      expect(find.text('Open Dialog'), findsOneWidget);
      await tester.tap(find.text('Open Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Dialog Body Content'), findsOneWidget);
    });

    testWidgets('ChoicePicker single and multiple selection works', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'choice-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': 'choice-surface',
            'path': '/',
            'value': <String, dynamic>{
              'singleChoice': <dynamic>['opt1'],
              'multiChoice': <dynamic>['optA'],
            },
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'choice-surface',
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'children': ['single-picker', 'chips-picker'],
              },
              {
                'id': 'single-picker',
                'component': 'ChoicePicker',
                'label': 'Select Plan',
                'variant': 'mutuallyExclusive',
                'displayStyle': 'checkbox',
                'options': [
                  {'label': 'Free Plan', 'value': 'opt1'},
                  {'label': 'Pro Plan', 'value': 'opt2'},
                ],
                'value': {'path': '/singleChoice'},
              },
              {
                'id': 'chips-picker',
                'component': 'ChoicePicker',
                'label': 'Select Features',
                'variant': 'multipleSelection',
                'displayStyle': 'chips',
                'options': [
                  {'label': 'Feature A', 'value': 'optA'},
                  {'label': 'Feature B', 'value': 'optB'},
                ],
                'value': {'path': '/multiChoice'},
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.text('Free Plan'), findsOneWidget);
      expect(find.text('Pro Plan'), findsOneWidget);
      expect(find.text('Feature A'), findsOneWidget);
      expect(find.text('Feature B'), findsOneWidget);

      // Select Pro Plan
      await tester.tap(find.text('Pro Plan'));
      await tester.pump();
      expect(surface.dataModel.get('/singleChoice'), ['opt2']);

      // Toggle Feature B chip
      await tester.tap(find.text('Feature B'));
      await tester.pump();
      expect(surface.dataModel.get('/multiChoice'), ['optA', 'optB']);
    });

    testWidgets('DateTimeInput updates value in DataModel', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createBasicCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'dt-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': 'dt-surface',
            'path': '/',
            'value': {'dateVal': '2026-01-01'},
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'dt-surface',
            'components': [
              {
                'id': 'root',
                'component': 'DateTimeInput',
                'label': 'Event Date',
                'enableDate': false,
                'enableTime': false,
                'value': {'path': '/dateVal'},
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.text('2026-01-01'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '2026-12-25');
      await tester.pump();

      expect(surface.dataModel.get('/dateVal'), '2026-12-25');
    });

    test('A2uiThemeAdapter parses colors and applies theme overrides', () {
      final Color? color = A2uiThemeAdapter.parseHexColor('#1A73E8');
      expect(color, isNotNull);
      expect(color!.toARGB32(), 0xFF1A73E8);

      final base = ThemeData.light();
      final ThemeData adapted = A2uiThemeAdapter.applyThemeTokens(base, {
        'primaryColor': '#E91E63',
      });
      expect(adapted.colorScheme.primary.toARGB32(), 0xFFE91E63);
    });
  });
}

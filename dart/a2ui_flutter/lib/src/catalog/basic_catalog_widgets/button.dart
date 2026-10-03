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

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_exceptions.dart';
import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../model/data_model.dart';
import '../../model/ui_models.dart';
import '../../model/validation_helper.dart';
import '../../primitives/logging.dart';
import '../../primitives/simple_items.dart';

final _schema = S.object(
  description: 'An interactive button that triggers an action when pressed.',
  properties: {
    'child': A2uiSchemas.componentReference(
      description:
          'The ID of a child widget. This should always be set, e.g. to the ID '
          'of a `Text` widget.',
    ),
    'action': A2uiSchemas.action(),
    'variant': S.string(
      description: 'A hint for the button style.',
      enumValues: ['primary', 'borderless'],
    ),
    'checks': A2uiSchemas.checkable(),
  },
  required: ['child', 'action'],
);

extension type _ButtonData.fromMap(JsonMap _json) {
  factory _ButtonData({
    required String child,
    required JsonMap action,
    String? variant,
    List<JsonMap>? checks,
  }) => _ButtonData.fromMap({
    'child': child,
    'action': action,
    'variant': variant,
    'checks': checks,
  });

  String get child {
    final Object? val = _json['child'];
    if (val is String) return val;
    throw ArgumentError('Invalid child: $val');
  }

  JsonMap get action => _json['action'] as JsonMap;
  String? get variant => _json['variant'] as String?;
  List<JsonMap>? get checks => (_json['checks'] as List?)?.cast<JsonMap>();
}

/// A Material Design elevated button.
///
/// This widget displays an interactive button. When pressed, it dispatches
/// the specified `action` event. The button's appearance can be styled as
/// a primary action.
///
/// ## Parameters:
///
/// - `child`: The ID of a child widget to display inside the button.
/// - `action`: The action to perform when the button is pressed.
/// - `variant`: A hint for the button style ('primary' or 'borderless').
final button = CatalogItem(
  name: 'Button',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final buttonData = _ButtonData.fromMap(itemContext.data as JsonMap);
    final Widget child = itemContext.buildChild(buttonData.child);
    genUiLogger.info('Building Button with child: ${buttonData.child}');
    final ColorScheme colorScheme = Theme.of(
      itemContext.buildContext,
    ).colorScheme;
    final String variant = buttonData.variant ?? '';
    final primary = variant == 'primary';
    final borderless = variant == 'borderless';

    final TextStyle? textStyle = Theme.of(itemContext.buildContext)
        .textTheme
        .bodyLarge
        ?.copyWith(
          color: primary ? colorScheme.onPrimary : colorScheme.onSurface,
        );

    final ButtonStyle style = switch (variant) {
      'primary' => ElevatedButton.styleFrom(
        backgroundColor: colorScheme.primary,
        foregroundColor: colorScheme.onPrimary,
      ),
      'borderless' => TextButton.styleFrom(
        foregroundColor: colorScheme.onSurface,
      ),
      _ => ElevatedButton.styleFrom(
        backgroundColor: colorScheme.surface,
        foregroundColor: colorScheme.onSurface,
      ),
    };

    // Validate checks to determine if button is enabled
    return StreamBuilder<String?>(
      stream: ValidationHelper.validateStream(
        buttonData.checks,
        itemContext.dataContext,
      ),
      builder: (context, snapshot) {
        final isValid = snapshot.data == null;
        final enabled = isValid;

        final Widget buttonWidget = borderless
            ? TextButton(
                onPressed: enabled
                    ? () => _handlePress(itemContext, buttonData)
                    : null,
                child: child,
              )
            : ElevatedButton(
                style: style.copyWith(
                  textStyle: WidgetStatePropertyAll(textStyle),
                ),
                onPressed: enabled
                    ? () => _handlePress(itemContext, buttonData)
                    : null,
                child: child,
              );

        return buttonWidget;
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Button",
          "child": "text",
          "action": {
            "event": {
              "name": "button_pressed"
            }
          }
        },
        {
          "id": "text",
          "component": "Text",
          "text": "Hello World"
        }
      ]
    ''',
    () => '''
      [
        {
          "id": "root",
          "component": "Column",
          "children": ["primaryButton", "secondaryButton"]
        },
        {
          "id": "primaryButton",
          "component": "Button",
          "child": "primaryText",
          "primary": true,
          "action": {
            "event": {
              "name": "primary_pressed"
            }
          }
        },
        {
          "id": "secondaryButton",
          "component": "Button",
          "child": "secondaryText",
          "action": {
            "event": {
              "name": "secondary_pressed"
            }
          }
        },
        {
          "id": "primaryText",
          "component": "Text",
          "text": "Primary Button"
        },
        {
          "id": "secondaryText",
          "component": "Text",
          "text": "Secondary Button"
        }
      ]
    ''',
  ],
);

Future<void> _handlePress(
  CatalogItemContext itemContext,
  _ButtonData buttonData,
) async {
  final JsonMap actionData = buttonData.action;
  if (actionData.containsKey('event')) {
    final eventMap = actionData['event'] as JsonMap;
    final actionName = eventMap['name'] as String;
    final contextDefinition = eventMap['context'] as JsonMap?;

    final JsonMap resolvedContext = await resolveContext(
      itemContext.dataContext,
      contextDefinition,
    );
    itemContext.dispatchEvent(
      UserActionEvent(
        name: actionName,
        sourceComponentId: itemContext.id,
        context: resolvedContext,
      ),
    );
  } else if (actionData.containsKey('functionCall')) {
    final funcMap = actionData['functionCall'] as JsonMap;
    final callName = funcMap['call'] as String;

    if (callName == 'closeModal') {
      if (itemContext.buildContext.mounted) {
        Navigator.of(itemContext.buildContext).pop();
      }
      return;
    }

    final Stream<Object?> resultStream = itemContext.dataContext.resolve(
      funcMap,
    );
    final iterator = StreamIterator<Object?>(resultStream);
    try {
      await iterator.moveNext().timeout(
        const Duration(seconds: 10),
        onTimeout: () => throw TimeoutException(
          'Function execution for $callName timed out',
        ),
      );
    } catch (exception, stackTrace) {
      genUiLogger.severe(
        'Error executing function call "$callName" on button press',
        exception,
        stackTrace,
      );

      if (exception is A2uiFunctionException) {
        itemContext.reportError(exception, stackTrace);
      } else if (exception is TimeoutException) {
        itemContext.reportError(
          A2uiFunctionException(
            'Function execution timed out.',
            functionName: callName,
            cause: exception,
          ),
          stackTrace,
        );
      } else {
        itemContext.reportError(
          A2uiFunctionException(
            'Function execution failed. Please check arguments and try again.',
            functionName: callName,
            cause: exception,
          ),
          stackTrace,
        );
      }
    } finally {
      await iterator.cancel();
    }
  } else {
    genUiLogger.warning(
      'Button action missing event or functionCall: $actionData',
    );
  }
}

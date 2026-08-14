// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:json_schema_builder/json_schema_builder.dart';

import '../primitives/cancellation.dart';
import 'catalog.dart';
import 'common_schemas.dart';
import 'contexts.dart';

class MinimalTextApi extends ComponentApi {
  @override
  String get name => 'Text';

  @override
  Schema get schema => Schema.object(
    properties: {
      'text': CommonSchemas.dynamicString,
      'variant': Schema.string(
        enumValues: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
      ),
    },
    required: ['text'],
  );
}

class MinimalRowApi extends ComponentApi {
  @override
  String get name => 'Row';

  @override
  Schema get schema => Schema.object(
    properties: {
      'children': CommonSchemas.childList,
      'justify': Schema.string(
        enumValues: [
          'center',
          'end',
          'spaceAround',
          'spaceBetween',
          'spaceEvenly',
          'start',
          'stretch',
        ],
      ),
      'align': Schema.string(enumValues: ['start', 'center', 'end', 'stretch']),
    },
    required: ['children'],
  );
}

class MinimalColumnApi extends ComponentApi {
  @override
  String get name => 'Column';

  @override
  Schema get schema => Schema.object(
    properties: {
      'children': CommonSchemas.childList,
      'justify': Schema.string(
        enumValues: [
          'start',
          'center',
          'end',
          'spaceBetween',
          'spaceAround',
          'spaceEvenly',
          'stretch',
        ],
      ),
      'align': Schema.string(enumValues: ['center', 'end', 'start', 'stretch']),
    },
    required: ['children'],
  );
}

class MinimalButtonApi extends ComponentApi {
  @override
  String get name => 'Button';

  @override
  Schema get schema => Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'child': CommonSchemas.componentId,
          'variant': Schema.string(enumValues: ['primary', 'borderless']),
          'action': CommonSchemas.action,
        },
        required: ['child', 'action'],
      ),
    ],
  );
}

class MinimalTextFieldApi extends ComponentApi {
  @override
  String get name => 'TextField';

  @override
  Schema get schema => Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'label': CommonSchemas.dynamicString,
          'value': CommonSchemas.dynamicString,
          'variant': Schema.string(
            enumValues: ['longText', 'number', 'shortText', 'obscured'],
          ),
          'validationRegexp': Schema.string(),
        },
        required: ['label'],
      ),
    ],
  );
}

class CapitalizeFunction extends FunctionImplementation {
  @override
  String get name => 'capitalize';

  @override
  A2uiReturnType get returnType => A2uiReturnType.string;

  @override
  Schema get argumentSchema => Schema.object(
    properties: {'value': CommonSchemas.dynamicString},
    required: ['value'],
  );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final String val = args['value']?.toString() ?? '';
    if (val.isEmpty) return '';
    return val[0].toUpperCase() + val.substring(1);
  }
}

class MinimalCatalog extends Catalog<ComponentApi> {
  MinimalCatalog()
    : super(
        id: 'https://a2ui.org/specification/v0_9/catalogs/minimal/minimal_catalog.json',
        components: [
          MinimalTextApi(),
          MinimalRowApi(),
          MinimalColumnApi(),
          MinimalButtonApi(),
          MinimalTextFieldApi(),
        ],
        functions: [CapitalizeFunction()],
        themeSchema: Schema.object(
          properties: {
            'primaryColor': Schema.string(pattern: r'^#[0-9a-fA-F]{6}$'),
          },
          additionalProperties: true,
        ),
      );
}

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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

class TestTextApi extends ComponentApi {
  TestTextApi()
      : super(
          name: 'Text',
          schema: Schema.object(
            properties: {
              'text': CommonSchemas.dynamicString,
              'variant': Schema.string(
                enumValues: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
              ),
            },
            required: ['text'],
          ),
        );
}

class TestRowApi extends ComponentApi {
  TestRowApi()
      : super(
          name: 'Row',
          schema: Schema.object(
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
              'align': Schema.string(
                enumValues: ['start', 'center', 'end', 'stretch'],
              ),
            },
            required: ['children'],
          ),
        );
}

class TestColumnApi extends ComponentApi {
  TestColumnApi()
      : super(
          name: 'Column',
          schema: Schema.object(
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
              'align': Schema.string(
                enumValues: ['center', 'end', 'start', 'stretch'],
              ),
            },
            required: ['children'],
          ),
        );
}

class TestButtonApi extends ComponentApi {
  TestButtonApi()
      : super(
          name: 'Button',
          schema: Schema.combined(
            allOf: [
              CommonSchemas.checkable,
              Schema.object(
                properties: {
                  'child': CommonSchemas.componentId,
                  'variant':
                      Schema.string(enumValues: ['primary', 'borderless']),
                  'action': CommonSchemas.action,
                },
                required: ['child', 'action'],
              ),
            ],
          ),
        );
}

class TestTextFieldApi extends ComponentApi {
  TestTextFieldApi()
      : super(
          name: 'TextField',
          schema: Schema.combined(
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
          ),
        );
}

class CapitalizeFunction extends FunctionImplementation {
  CapitalizeFunction()
      : super(
          name: 'capitalize',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {'value': CommonSchemas.dynamicString},
            required: ['value'],
          ),
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

class TestCatalog extends Catalog<ComponentApi, FunctionImplementation> {
  TestCatalog()
      : super(
          id: 'https://a2ui.org/specification/v0_9/catalogs/minimal/minimal_catalog.json',
          protocolVersion: A2uiProtocolVersion.v0_9,
          components: [
            TestTextApi(),
            TestRowApi(),
            TestColumnApi(),
            TestButtonApi(),
            TestTextFieldApi(),
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

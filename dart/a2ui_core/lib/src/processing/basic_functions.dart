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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../core/contexts.dart';
import '../primitives/cancellation.dart';
import '../primitives/reactivity.dart';
import 'expressions.dart';

class FormatStringFunction extends FunctionImplementation {
  FormatStringFunction()
    : super(
        name: 'formatString',
        returnType: A2uiReturnType.string,
        argumentSchema: Schema.object(
          properties: {
            'value': Schema.string(
              description: 'The string template to interpolate.',
            ),
          },
          required: ['value'],
        ),
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final template = args['value'] as String;
    final parser = ExpressionParser();
    final List<Object?> parts = parser.parse(template);

    if (parts.isEmpty) return '';
    if (parts.length == 1 && parts[0] is String) return parts[0];

    return computed(() {
      final Iterable<String> resolvedParts = parts.map((part) {
        if (part is String) return part;
        final ReadonlySignal<Object?> sig = context.resolveListenable(part);
        return sig.value?.toString() ?? '';
      });
      return resolvedParts.join('');
    });
  }
}

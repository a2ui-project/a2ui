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

import 'dart:convert';

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
    if (!parts.any((part) => part is Map)) {
      return parts.map(_stringifyPart).join('');
    }

    final List<Object?> resolvedSources = [
      for (final Object? part in parts)
        if (part is Map)
          context.resolveListenable(
            context.isV10 ? _adaptAstPartForV10(part, context) : part,
          )
        else
          part,
    ];

    return computed(() {
      final Iterable<String> resolvedParts = resolvedSources.map((source) {
        final Object? val =
            source is ReadonlySignal<Object?> ? source.value : source;
        return _stringifyPart(val);
      });
      return resolvedParts.join('');
    });
  }

  static String _stringifyPart(Object? val) {
    if (val == null) return '';
    if (val is String) return val;
    if (val is Map || val is List) return jsonEncode(val);
    return val.toString();
  }

  static Object? _adaptAstPartForV10(Object? part, DataContext context) {
    if (part is List) {
      return [
        for (final Object? item in part) _adaptAstPartForV10(item, context),
      ];
    }
    if (part is! Map) return part;
    if (part['path'] is String &&
        !part.containsKey('componentId') &&
        !part.containsKey('@path')) {
      return context.bindingFor(part['path'] as String);
    }
    if (part['call'] is String && !part.containsKey('@call')) {
      final Object? rawArgs = part['args'];
      final adaptedArgs = rawArgs is Map
          ? <String, Object?>{
              for (final MapEntry<Object?, Object?> entry in rawArgs.entries)
                entry.key.toString(): _adaptAstPartForV10(entry.value, context),
            }
          : <String, Object?>{};
      return <String, Object?>{
        '@call': part['call'],
        'args': adaptedArgs,
        'returnType': part['returnType'] ?? 'any',
      };
    }
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in part.entries)
        entry.key.toString(): _adaptAstPartForV10(entry.value, context),
    };
  }
}

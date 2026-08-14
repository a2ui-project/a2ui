// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../core/contexts.dart';
import '../primitives/cancellation.dart';
import '../primitives/reactivity.dart';
import 'expressions.dart';

class FormatStringFunction extends FunctionImplementation {
  @override
  String get name => 'formatString';

  @override
  A2uiReturnType get returnType => A2uiReturnType.string;

  @override
  Schema get argumentSchema => Schema.object(
    properties: {
      'value': Schema.string(
        description: 'The string template to interpolate.',
      ),
    },
    required: ['value'],
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

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

import '../validation/common_types.g.dart';

/// The envelope each legacy (below v1.0) inline component is wrapped in.
///
/// Below v1.0 a catalog component carries its own envelope, so every inline
/// component is `allOf: [{$ref: <envelope>}, <body>]`. From v1.0 the message
/// schema composes the envelope, and catalog components must not.
const String _legacyComponentEnvelopeRef =
    r'common_types.json#/$defs/ComponentCommon';

/// The legacy (below v1.0) inline catalog derived from the catalog
/// [document], a catalog's `validationSchema`.
Map<String, Object?> legacyInlineCatalog(Map<String, Object?> document) {
  final refs = _LegacyRefs(document);
  final components = <String, Object?>{
    if (document['components'] case final Map<String, Object?> serialized)
      for (final MapEntry<String, Object?> entry in serialized.entries)
        entry.key: <String, Object?>{
          'allOf': <Object?>[
            <String, Object?>{r'$ref': _legacyComponentEnvelopeRef},
            _legacyComponentBody(
              entry.key,
              entry.value! as Map<String, Object?>,
              refs,
            ),
          ],
        },
  };
  final functions = <Object?>[
    if (document['functions'] case final Map<String, Object?> serialized)
      for (final MapEntry<String, Object?> entry in serialized.entries)
        _legacyFunction(entry.key, entry.value! as Map<String, Object?>, refs),
  ];
  final Object? theme = switch (document[r'$defs']) {
    {'theme': {'properties': final Map<String, Object?> properties}} =>
      refs.rewrite(properties),
    _ => null,
  };
  return {
    'catalogId': document['catalogId'],
    if (components.isNotEmpty) 'components': components,
    if (functions.isNotEmpty) 'functions': functions,
    if (theme != null) 'theme': theme,
  };
}

/// The second `allOf` member of a legacy component: the serialized
/// [component]'s properties and required list, led by the `component`
/// discriminator.
///
/// The document form declares `id` and `component` itself; the legacy shape
/// leaves `id` to the envelope and keeps only the discriminator. `type` and
/// the `unevaluatedProperties`/`additionalProperties` keywords are dropped,
/// as the legacy shape never carried them.
Map<String, Object?> _legacyComponentBody(
  String name,
  Map<String, Object?> component,
  _LegacyRefs refs,
) {
  final Map<String, Object?> properties =
      (component['properties'] as Map<String, Object?>?) ?? const {};
  final List<Object?> required =
      (component['required'] as List<Object?>?) ?? const [];
  return {
    'properties': <String, Object?>{
      'component': <String, Object?>{'const': name},
      for (final MapEntry<String, Object?> entry in properties.entries)
        if (entry.key != 'id' && entry.key != 'component')
          entry.key: refs.rewrite(entry.value),
    },
    'required': <Object?>[
      'component',
      for (final Object? key in required)
        if (key != 'id' && key != 'component') key,
    ],
  };
}

/// A legacy function definition from the serialized [function], whose
/// `properties` hold the call key and `args`, and `returnType` below v1.0.
Map<String, Object?> _legacyFunction(
  String name,
  Map<String, Object?> function,
  _LegacyRefs refs,
) {
  final Map<String, Object?> properties =
      (function['properties'] as Map<String, Object?>?) ?? const {};
  return {
    'name': name,
    if (function['description'] case final String description)
      'description': description,
    // From v1.0 the return type is a keyword of the entry; below it, a
    // constant property of the call.
    'returnType': switch (properties['returnType']) {
      {'const': final Object? returnType} => returnType,
      _ => function['returnType'],
    },
    'parameters': refs.rewrite(properties['args']),
  };
}

/// Rewrites the local `#/...` references of a catalog document for the legacy
/// inline shape, which has no `$defs` to point into.
///
/// A reference to one of the bundled common types becomes the relative
/// `common_types.json#/$defs/<name>` reference again. Any other local
/// reference is inlined when it resolves within the document, and dropped
/// (its annotations kept) when it does not, so the agent never receives a
/// pointer it cannot follow.
class _LegacyRefs {
  _LegacyRefs(this.document);

  final Map<String, Object?> document;

  /// Local references being inlined, to stop a self-referential definition
  /// from recursing.
  final List<String> _inlining = [];

  static const String _defsPrefix = r'#/$defs/';

  static final Set<String> _commonDefs = ((jsonDecode(commonTypesV0_9Json)
          as Map<String, Object?>)[r'$defs']! as Map<String, Object?>)
      .keys
      .toSet();

  /// A deep copy of [node] with its local references rewritten.
  Object? rewrite(Object? node) {
    if (node is List) {
      return <Object?>[for (final Object? item in node) rewrite(item)];
    }
    if (node is! Map) return node;
    final Object? ref = node[r'$ref'];
    final rest = <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in node.entries)
        if (entry.key != r'$ref') entry.key! as String: rewrite(entry.value),
    };
    if (ref is! String || !ref.startsWith('#')) {
      return <String, Object?>{if (ref != null) r'$ref': ref, ...rest};
    }
    if (ref.startsWith(_defsPrefix) &&
        _commonDefs.contains(ref.substring(_defsPrefix.length))) {
      return <String, Object?>{
        r'$ref':
            'common_types.json#/\$defs/${ref.substring(_defsPrefix.length)}',
        ...rest,
      };
    }
    final Object? target = _resolve(ref);
    if (target is! Map || _inlining.contains(ref)) return rest;
    _inlining.add(ref);
    final inlined = rewrite(target)! as Map<String, Object?>;
    _inlining.removeLast();
    return <String, Object?>{...inlined, ...rest};
  }

  /// The node a local JSON Pointer [ref] names in [document], or null.
  Object? _resolve(String ref) {
    Object? node = document;
    if (ref == '#') return node;
    if (!ref.startsWith('#/')) return null;
    for (final String raw in ref.substring(2).split('/')) {
      final String key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      switch (node) {
        case final Map<Object?, Object?> map when map.containsKey(key):
          node = map[key];
        case final List<Object?> list:
          final int? index = int.tryParse(key);
          if (index == null || index < 0 || index >= list.length) return null;
          node = list[index];
        default:
          return null;
      }
    }
    return node;
  }
}

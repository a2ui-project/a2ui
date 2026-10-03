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

import '../primitives/errors.dart';

/// The file name a catalog refers to for the shared type definitions, however
/// the reference spells the rest of the URL.
const String _commonTypesDocument = 'common_types.json';

/// The file name `common_types.json` refers back to for the catalog's own
/// definitions, however the reference spells the rest of the URL.
const String _catalogDocument = 'catalog.json';

/// The unions a catalog document may omit when it declares nothing for them.
const Set<String> _catalogUnions = {
  r'/$defs/anyFunction',
  r'/$defs/anyComponent'
};

/// Rewrites a component schema so it can be validated without any I/O.
///
/// Every definition the schema reaches — in the catalog [document] and in
/// [commonTypes] — is copied into a single `$defs` block on the result, and
/// each `$ref` is rewritten to point there. Definitions are copied once and
/// shared, so a recursive schema stays recursive: `FunctionCall` reaches
/// `DynamicValue`, which reaches `FunctionCall` again, and the rewritten
/// schema expresses that rather than cutting it short.
///
/// Local pointers (`#/...`) resolve against the document the subschema
/// carrying them came from. Getting that wrong silently widens a schema,
/// because `DynamicString` and its neighbours reach their alternatives
/// through local pointers.
///
/// A reference to a document this SDK does not hold — an unsupplied or empty
/// `common_types.json`, or a document it would have to fetch — is dropped,
/// leaving that subschema unconstrained. The surrounding constraints still
/// apply, and validation never blocks on I/O.
///
/// A pointer into `common_types.json` that [commonTypes] does not define is
/// looked up in [fallbackCommonTypes] next, so a catalog that declares no
/// version can still use a type only the other protocol version defines (the
/// v1.0 `Child`, say).
///
/// A pointer into a document this SDK does hold must name something: one that
/// does not throws [A2uiCatalogError], because silently dropping it would
/// widen the schema. Pointers follow array indices, as in
/// `#/$defs/DynamicString/oneOf/0`.
Map<String, Object?> resolveSchemaRefs(
  Map<String, Object?> schema,
  Map<String, Object?> document, {
  Map<String, Object?>? commonTypes,
  Map<String, Object?>? fallbackCommonTypes,
}) {
  final resolver = _RefResolver(document, commonTypes, fallbackCommonTypes);
  final Map<String, Object?> rewritten = resolver.rewrite(
    schema,
    _DocumentRef(document, 'catalog'),
  );
  if (resolver.defs.isEmpty) return rewritten;
  return <String, Object?>{
    ...rewritten,
    r'$defs': <String, Object?>{
      ...?rewritten[r'$defs'] as Map<String, Object?>?,
      ...resolver.defs,
    },
  };
}

/// One of the documents references are resolved against, with a short name
/// used to build collision-free `$defs` keys.
class _DocumentRef {
  final Map<String, Object?> schema;
  final String name;

  const _DocumentRef(this.schema, this.name);
}

class _RefResolver {
  final Map<String, Object?> _document;
  final Map<String, Object?>? _commonTypes;
  final Map<String, Object?>? _fallbackCommonTypes;

  /// Definitions hoisted onto the result, keyed by their `$defs` name.
  final Map<String, Object?> defs = {};

  /// The `$defs` name already assigned to a document and pointer.
  final Map<String, String> _names = {};

  _RefResolver(this._document, this._commonTypes, this._fallbackCommonTypes);

  Map<String, Object?> rewrite(Map<String, Object?> node, _DocumentRef base) =>
      _walk(node, base) as Map<String, Object?>;

  Object? _walk(Object? node, _DocumentRef base) {
    if (node is List) {
      return [for (final Object? item in node) _walk(item, base)];
    }
    if (node is! Map) return node;

    final Map<String, Object?> object = node.cast<String, Object?>();
    final siblings = <String, Object?>{
      for (final MapEntry<String, Object?> entry in object.entries)
        if (entry.key != r'$ref') entry.key: _walk(entry.value, base),
    };

    final Object? ref = object[r'$ref'];
    if (ref is! String) return siblings;

    final String? name = _hoist(ref, base);
    // An unreachable reference leaves the subschema unconstrained.
    if (name == null) return siblings;
    return <String, Object?>{r'$ref': '#/\$defs/$name', ...siblings};
  }

  /// Copies what [ref] names into [defs], returning its `$defs` name.
  ///
  /// Returns null if this SDK cannot reach the reference.
  String? _hoist(String ref, _DocumentRef base) {
    final int hash = ref.indexOf('#');
    final String target = hash < 0 ? ref : ref.substring(0, hash);
    final String pointer = hash < 0 ? '' : ref.substring(hash + 1);

    final _DocumentRef? source = _documentFor(target, base);
    if (source == null) return null;
    if (pointer.isEmpty || pointer == '/') {
      throw A2uiCatalogError("Unresolvable schema reference: '$ref'");
    }

    final key = '${source.name}$pointer';
    final String? known = _names[key];
    if (known != null) return known;

    Object? found = followJsonPointer(source.schema, pointer);
    _DocumentRef origin = source;
    final bool localShared = found is! Map &&
        target.isEmpty &&
        source.name == 'catalog' &&
        pointer.startsWith(r'/$defs/');
    if (localShared) {
      // Catalogs may spell a shared type as a local `#/$defs/<Name>`, relying
      // on `common_types.json` to supply it.
      final Map<String, Object?>? commonTypes = _commonTypes;
      if (commonTypes == null || commonTypes.isEmpty) return null;
      origin = _DocumentRef(commonTypes, 'commonTypes');
      found = followJsonPointer(commonTypes, pointer);
    }
    if (found is! Map && _catalogUnions.contains(pointer)) {
      // A catalog without functions declares no `anyFunction`, which
      // `common_types.json` still reaches from every dynamic value.
      return null;
    }
    final Map<String, Object?>? fallback = _fallbackCommonTypes;
    if (found is! Map && origin.name == 'commonTypes' && fallback != null) {
      origin = _DocumentRef(fallback, 'fallbackCommonTypes');
      found = followJsonPointer(fallback, pointer);
    }
    if (found is! Map) {
      throw A2uiCatalogError("Unresolvable schema reference: '$ref'");
    }

    final String name = _defName(key);
    // Registered before the copy is walked, so a definition that reaches
    // itself points at the name instead of expanding forever.
    _names[key] = name;
    defs[name] = null;
    final copy = Map<String, Object?>.of(found.cast<String, Object?>())
      // A hoisted definition must not carry its own identity, which would
      // move the base every reference below it resolves against.
      ..remove(r'$id')
      ..remove(r'$schema');
    defs[name] = _walk(copy, origin);
    return name;
  }

  /// The document [target] names, as seen from [base].
  _DocumentRef? _documentFor(String target, _DocumentRef base) {
    if (target.isEmpty) return base;
    if (target.endsWith(_commonTypesDocument)) {
      final Map<String, Object?>? commonTypes = _commonTypes;
      return commonTypes == null || commonTypes.isEmpty
          ? null
          : _DocumentRef(commonTypes, 'commonTypes');
    }
    // `common_types.json` points back at `catalog.json` for the catalog's own
    // `anyComponent` and `anyFunction` unions.
    if (target.endsWith(_catalogDocument)) {
      return _DocumentRef(_document, 'catalog');
    }
    return null;
  }

  String _defName(String key) {
    final String base = key.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
    if (!defs.containsKey(base)) return base;
    for (var i = 2;; i++) {
      final candidate = '$base$i';
      if (!defs.containsKey(candidate)) return candidate;
    }
  }
}

/// Inlines a catalog document's own `#/...` references in place.
///
/// Every local pointer is replaced by what it names in [rootCatalog], so a
/// component schema stands alone once ingested and needs no document beside it
/// to be understood. References that leave the document — `common_types.json`
/// and anything else absolute — are preserved untouched, because the catalog
/// cannot reach them and dropping them would silently widen the schema. They
/// are resolved later, against the definitions the validator is given.
///
/// A pointer already being expanded is left as a reference rather than
/// followed again, so a recursive definition terminates instead of growing
/// without bound.
///
/// Throws [A2uiCatalogError] for a local pointer that names nothing. A
/// `#/$defs/<Name>` pointer the document does not define is left as a
/// reference instead, because catalogs use that spelling for shared types
/// that `common_types.json` supplies; `resolveSchemaRefs` resolves it later
/// and throws if neither document defines it.
Object? inlineLocalRefs(
  Object? node,
  Map<String, Object?> rootCatalog, [
  Set<String>? expanding,
]) {
  final Set<String> visited = expanding ?? <String>{};

  if (node is List) {
    return [
      for (final Object? item in node)
        inlineLocalRefs(item, rootCatalog, visited),
    ];
  }
  if (node is! Map) return node;

  final Map<String, Object?> object = node.cast<String, Object?>();
  final Object? ref = object[r'$ref'];

  if (ref is String && ref.startsWith('#/')) {
    if (visited.contains(ref)) return object;

    final Object? target = followJsonPointer(rootCatalog, ref.substring(1));
    if (target is! Map) {
      if (ref.startsWith(r'#/$defs/')) return object;
      throw A2uiCatalogError("Unresolvable schema reference: '$ref'");
    }

    final Object? resolved = inlineLocalRefs(
      target.cast<String, Object?>(),
      rootCatalog,
      {...visited, ref},
    );
    if (resolved is! Map) return object;

    // Keywords beside the `$ref` still apply, and win over the definition.
    return <String, Object?>{
      ...resolved.cast<String, Object?>(),
      for (final MapEntry<String, Object?> entry in object.entries)
        if (entry.key != r'$ref')
          entry.key: inlineLocalRefs(entry.value, rootCatalog, visited),
    };
  }

  return <String, Object?>{
    for (final MapEntry<String, Object?> entry in object.entries)
      entry.key: inlineLocalRefs(entry.value, rootCatalog, visited),
  };
}

/// Follows a JSON Pointer such as `/a/b/0` through [document], or returns
/// null if it names nothing.
///
/// A segment indexes into a list when it is a decimal index within range.
Object? followJsonPointer(Object? document, String pointer) {
  if (pointer.isEmpty) return document;
  if (!pointer.startsWith('/')) return null;
  var current = document;
  for (final String raw in pointer.split('/').skip(1)) {
    final String segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current is Map) {
      if (!current.containsKey(segment)) return null;
      current = current[segment];
    } else if (current is List) {
      final int? index = int.tryParse(segment);
      if (index == null || index < 0 || index >= current.length) return null;
      current = current[index];
    } else {
      return null;
    }
  }
  return current;
}

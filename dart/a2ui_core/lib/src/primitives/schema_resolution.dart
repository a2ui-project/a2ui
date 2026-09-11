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

/// The file name a catalog refers to for the shared type definitions, however
/// the reference spells the rest of the URL.
const String _commonTypesDocument = 'common_types.json';

/// The file name `common_types.json` refers back to for the catalog's own
/// definitions, however the reference spells the rest of the URL.
const String _catalogDocument = 'catalog.json';

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
/// A reference this SDK cannot reach — an unsupplied `common_types.json`, or
/// a document it would have to fetch — is dropped, leaving that subschema
/// unconstrained. The surrounding constraints still apply. Validation
/// therefore never rejects a payload because a schema was unreachable, and
/// never blocks on I/O.
Map<String, Object?> resolveSchemaRefs(
  Map<String, Object?> schema,
  Map<String, Object?> document, {
  Map<String, Object?>? commonTypes,
}) {
  final resolver = _RefResolver(document, commonTypes);
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

  /// Definitions hoisted onto the result, keyed by their `$defs` name.
  final Map<String, Object?> defs = {};

  /// The `$defs` name already assigned to a document and pointer.
  final Map<String, String> _names = {};

  _RefResolver(this._document, this._commonTypes);

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
    if (source == null || pointer.isEmpty) return null;

    final key = '${source.name}$pointer';
    final String? known = _names[key];
    if (known != null) return known;

    final Object? found = _follow(source.schema, pointer);
    if (found is! Map) return null;

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
    defs[name] = _walk(copy, source);
    return name;
  }

  /// The document [target] names, as seen from [base].
  _DocumentRef? _documentFor(String target, _DocumentRef base) {
    if (target.isEmpty) return base;
    if (target.endsWith(_commonTypesDocument)) {
      final Map<String, Object?>? commonTypes = _commonTypes;
      return commonTypes == null
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

  Object? _follow(Map<String, Object?> root, String pointer) {
    Object? current = root;
    for (final String raw in pointer.split('/').skip(1)) {
      final String segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      if (current is! Map || !current.containsKey(segment)) return null;
      current = current[segment];
    }
    return current;
  }

  String _defName(String key) {
    final String base = key.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
    if (!defs.containsKey(base)) return base;
    for (var i = 2; ; i++) {
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

    final Object? target = _followLocalPointer(ref, rootCatalog);
    if (target is! Map) return object;

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

/// Follows a `#/a/b` pointer through [document], or null if it names nothing.
Object? _followLocalPointer(String ref, Map<String, Object?> document) {
  Object? current = document;
  for (final String segment in ref.substring(2).split('/')) {
    final String key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current is! Map || !current.containsKey(key)) return null;
    current = current[key];
  }
  return current;
}

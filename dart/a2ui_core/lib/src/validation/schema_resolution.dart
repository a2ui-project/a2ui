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

import 'package:meta/meta.dart';

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
/// A reference to an unsupplied or empty `common_types.json` is dropped,
/// leaving that subschema unconstrained. The surrounding constraints still
/// apply, and validation never blocks on I/O. A reference to any other
/// document that is neither [document] itself nor one of [peers] throws
/// [A2uiCatalogError], because dropping it would accept any value.
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
  List<Map<String, Object?>> peers = const [],
}) {
  final resolver = _RefResolver(
    document,
    commonTypes,
    fallbackCommonTypes,
    peers,
  );
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

/// Whether the document part [doc] of a `$ref` names `common_types.json`.
bool _isCommonTypesDocument(String doc) =>
    doc == _commonTypesDocument || doc.endsWith('/$_commonTypesDocument');

/// Whether the document part [doc] of a `$ref` names a document other than
/// the one holding the reference, `common_types.json` or a bare
/// `catalog.json`, and so needs a peer catalog to resolve.
///
/// A reference whose document ends in `/catalog.json` counts, because it may
/// name a peer.
@internal
bool isPeerDocumentRef(String doc) =>
    doc.isNotEmpty && !_isCommonTypesDocument(doc) && doc != _catalogDocument;

/// Whether the document part [doc] of a `$ref` names the document holding
/// the reference: a bare `catalog.json`, or a path ending in `/catalog.json`
/// that no peer in [peers] matches exactly or by path suffix.
@internal
bool isSelfDocumentRef(String doc, List<Map<String, Object?>> peers) =>
    doc == _catalogDocument ||
    (doc.endsWith('/$_catalogDocument') && _exactPeerMatch(doc, peers) == null);

/// The peer in [peers] whose `catalogId` or `$id` equals [doc], or of which
/// one is a path suffix of the other.
Map<String, Object?>? _exactPeerMatch(
  String doc,
  List<Map<String, Object?>> peers,
) {
  for (final peer in peers) {
    for (final key in const ['catalogId', r'$id']) {
      final Object? candidate = peer[key];
      if (candidate is! String || candidate.isEmpty) continue;
      if (doc == candidate ||
          candidate.endsWith('/$doc') ||
          doc.endsWith('/$candidate')) {
        return peer;
      }
    }
  }
  return null;
}

/// Finds the peer catalog document the document part [doc] of a `$ref`
/// names, or null when it names none of [peers].
///
/// `common_types.json` and a bare `catalog.json` never name a peer. Otherwise
/// a peer whose `catalogId` or `$id` equals [doc], or of which one is a path
/// suffix of the other, wins, the first such peer in order. A [doc] ending in
/// `/catalog.json` that no peer matches that way names the document holding
/// the reference ([isSelfDocumentRef]). Failing that, the first peer whose
/// `$id` or `catalogId` has the same last path segment as [doc] matches.
@internal
Map<String, Object?>? findPeerCatalogDoc(
  String doc,
  List<Map<String, Object?>> peers,
) {
  if (peers.isEmpty || !isPeerDocumentRef(doc)) return null;
  final Map<String, Object?>? exact = _exactPeerMatch(doc, peers);
  if (exact != null) return exact;
  if (doc.endsWith('/$_catalogDocument')) return null;
  final String base = doc.split('/').last;
  for (final peer in peers) {
    for (final key in const [r'$id', 'catalogId']) {
      final Object? candidate = peer[key];
      if (candidate is String && candidate.split('/').last == base) {
        return peer;
      }
    }
  }
  return null;
}

/// Unique ids for the documents local references resolve against, so the
/// pointers being expanded in one document are not mistaken for the same
/// pointers in another.
final Expando<int> _documentIds = Expando('documentId');
int _nextDocumentId = 0;

/// The key [inlineLocalRefs] records a local pointer [ref] into [document]
/// under while expanding it.
@internal
String localRefVisitKey(Map<String, Object?> document, String ref) =>
    '${_documentIds[document] ??= _nextDocumentId++}:$ref';

Map<String, Object?> _stripEnvelopeFromSubschema(Map<String, Object?> sub) {
  final copy = <String, Object?>{...sub};
  final Object? props = copy['properties'];
  if (props is Map) {
    final newProps = <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in props.entries)
        if (entry.key is String &&
            entry.key != 'id' &&
            entry.key != 'component' &&
            entry.key != 'catalogId')
          entry.key! as String: entry.value,
    };
    if (newProps.isNotEmpty) {
      copy['properties'] = newProps;
    } else {
      copy.remove('properties');
    }
  }
  final Object? req = copy['required'];
  if (req is List) {
    final newReq = <Object?>[
      for (final Object? item in req)
        if (item != 'id' && item != 'component' && item != 'catalogId') item,
    ];
    if (newReq.isNotEmpty) {
      copy['required'] = newReq;
    } else {
      copy.remove('required');
    }
  }
  copy
    ..remove('unevaluatedProperties')
    ..remove('additionalProperties')
    ..remove('title');
  return copy;
}

/// Strips component-envelope fields (`id`, `component`, `catalogId`, closure
/// keywords, `title`) when inlining a top-level component definition as a base
/// schema.
Map<String, Object?> stripReferencedComponentEnvelope(
  Map<String, Object?> schema,
) {
  final Map<String, Object?> copy = _stripEnvelopeFromSubschema(schema);
  final Object? allOf = copy['allOf'];
  if (allOf is List) {
    final cleanedAllOf = <Object?>[];
    final specificSubs = <Map<String, Object?>>[];
    for (final Object? item in allOf) {
      if (item is Map) {
        final Map<String, Object?> cleaned =
            _stripEnvelopeFromSubschema(item.cast<String, Object?>());
        if (cleaned.isNotEmpty) {
          cleanedAllOf.add(cleaned);
          final Object? ref = cleaned[r'$ref'];
          if (cleaned.containsKey('properties') &&
              (ref is! String ||
                  (!ref.endsWith('/ComponentCommon') &&
                      !ref.endsWith('/Checkable')))) {
            specificSubs.add(cleaned);
          }
        }
      } else {
        cleanedAllOf.add(item);
      }
    }
    copy['allOf'] = cleanedAllOf;
    if (!copy.containsKey('properties') && specificSubs.isNotEmpty) {
      final mergedSpecificProps = <String, Object?>{};
      for (final sub in specificSubs) {
        final Object? p = sub['properties'];
        if (p is Map) {
          mergedSpecificProps.addAll(p.cast<String, Object?>());
        }
      }
      if (mergedSpecificProps.isNotEmpty) {
        copy['properties'] = mergedSpecificProps;
      }
    }
  }
  return copy;
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
  final List<Map<String, Object?>> _peers;

  /// Definitions hoisted onto the result, keyed by their `$defs` name.
  final Map<String, Object?> defs = {};

  /// The `$defs` name already assigned to a document and pointer.
  final Map<String, String> _names = {};

  _RefResolver(
    this._document,
    this._commonTypes,
    this._fallbackCommonTypes, [
    this._peers = const [],
  ]);

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
    if (source == null) {
      // A reference into another catalog document that no peer supplies is
      // a catalog error: dropping it would accept any value.
      if (isPeerDocumentRef(target)) {
        throw A2uiCatalogError("Unresolvable schema reference: '$ref'");
      }
      return null;
    }
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
        (source.name == 'catalog' || source.name.startsWith('peer_')) &&
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
    if (source.name.startsWith('peer_') &&
        pointer.startsWith('/components/') &&
        pointer.split('/').length == 3) {
      found = stripReferencedComponentEnvelope(found.cast<String, Object?>());
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
    if (_isCommonTypesDocument(target)) {
      final Map<String, Object?>? commonTypes = _commonTypes;
      return commonTypes == null || commonTypes.isEmpty
          ? null
          : _DocumentRef(commonTypes, 'commonTypes');
    }
    final Map<String, Object?>? peerDoc = findPeerCatalogDoc(target, _peers);
    if (peerDoc != null) {
      return _DocumentRef(peerDoc, 'peer_${peerDoc['catalogId'] ?? target}');
    }
    if (isSelfDocumentRef(target, _peers)) {
      // A catalog document names itself; `common_types.json` points back at
      // `catalog.json` for the catalog's own `anyComponent` and `anyFunction`
      // unions.
      return base.name == 'catalog' || base.name.startsWith('peer_')
          ? base
          : _DocumentRef(_document, 'catalog');
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
/// A reference into one of the catalog documents in [peers] is resolved in
/// place too. It names a peer when its document part equals the peer's
/// `catalogId` or `$id`, or one is a path suffix of the other; failing that,
/// when the last path segments match. A bare `catalog.json` always names the
/// document holding the reference, and so does a path ending in
/// `/catalog.json` that no peer matches exactly or by path suffix. Local
/// pointers in a peer's content resolve against that peer's document, and
/// its references to further peers against [peers].
///
/// A pointer already being expanded is left as a reference rather than
/// followed again, so a recursive definition terminates instead of growing
/// without bound. [expanding] holds the pointers being expanded, and is for
/// this function's own recursion; callers leave it out.
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
  List<Map<String, Object?>> peers = const [],
]) =>
    _inlineRefs(
      node,
      rootCatalog,
      expanding ?? <String>{},
      peers,
      inPeer: false,
    );

/// [inlineLocalRefs] within [rootCatalog], which is a peer's document when
/// [inPeer] is true.
Object? _inlineRefs(
  Object? node,
  Map<String, Object?> rootCatalog,
  Set<String> visited,
  List<Map<String, Object?>> peers, {
  required bool inPeer,
}) {
  Object? inline(Object? child) =>
      _inlineRefs(child, rootCatalog, visited, peers, inPeer: inPeer);

  if (node is List) {
    return [for (final Object? item in node) inline(item)];
  }
  if (node is! Map) return node;

  final Map<String, Object?> object = node.cast<String, Object?>();
  final Object? ref = object[r'$ref'];

  // Keywords beside the `$ref` still apply, and win over the definition.
  Map<String, Object?> mergeSiblings(Map<String, Object?> resolved) =>
      <String, Object?>{
        ...resolved,
        for (final MapEntry<String, Object?> entry in object.entries)
          if (entry.key != r'$ref') entry.key: inline(entry.value),
      };

  if (ref is String && !ref.startsWith('#')) {
    final int hash = ref.indexOf('#');
    final String doc = hash < 0 ? ref : ref.substring(0, hash);
    final String fragment = hash < 0 ? '' : ref.substring(hash + 1);
    if (fragment.startsWith('/')) {
      final Map<String, Object?>? peerDoc = findPeerCatalogDoc(doc, peers);
      if (peerDoc != null) {
        final Object? target = followJsonPointer(peerDoc, fragment);
        if (!visited.contains(ref) && target is Map) {
          final Object? resolved = _inlineRefs(
            target.cast<String, Object?>(),
            peerDoc,
            {...visited, ref},
            peers,
            inPeer: true,
          );
          if (resolved is Map) {
            Map<String, Object?> resolvedMap = resolved.cast<String, Object?>();
            if (fragment.startsWith('/components/') &&
                fragment.split('/').length == 3) {
              resolvedMap = stripReferencedComponentEnvelope(resolvedMap);
            }
            return mergeSiblings(resolvedMap);
          }
        }
      } else if (inPeer && isSelfDocumentRef(doc, peers)) {
        // A peer naming its own document: a local pointer into it.
        return inline(<String, Object?>{...object, r'$ref': '#$fragment'});
      }
    }
  }

  if (ref is String && ref.startsWith('#/')) {
    if (ref.startsWith(r'#/$defs/') &&
        isCommonTypeDef(ref.substring(8).split('/').first)) {
      return object;
    }
    final String key = localRefVisitKey(rootCatalog, ref);
    if (visited.contains(key)) return object;

    final Object? target = followJsonPointer(rootCatalog, ref.substring(1));
    if (target is! Map) {
      if (ref.startsWith(r'#/$defs/')) return object;
      throw A2uiCatalogError("Unresolvable schema reference: '$ref'");
    }

    final Object? resolved = _inlineRefs(
      target.cast<String, Object?>(),
      rootCatalog,
      {...visited, key},
      peers,
      inPeer: inPeer,
    );
    if (resolved is! Map) return object;
    return mergeSiblings(resolved.cast<String, Object?>());
  }

  return <String, Object?>{
    for (final MapEntry<String, Object?> entry in object.entries)
      entry.key: inline(entry.value),
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

/// Checks if [name] is a standard A2UI common type definition, in either the
/// v0.9 or the v1.0 `common_types.json`.
bool isCommonTypeDef(String name) => const {
      'ComponentId',
      'DynamicString',
      'DynamicNumber',
      'DynamicBoolean',
      'DynamicStringList',
      'DynamicValue',
      'DataBinding',
      'FunctionCall',
      'ChildList',
      'Action',
      'CheckRule',
      'AccessibilityAttributes',
      // Added in v1.0.
      'Child',
      'FunctionCommon',
      'IndexSystemFunction',
      'Surface',
      'CallId',
      'FunctionResponse',
      'Extensions',
    }.contains(name);

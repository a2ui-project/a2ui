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

/// Loading the shared agent suites, and running their cases in each
/// protocol version this SDK implements.
///
/// The agent suites are written against v1.0. A harness runs each case twice,
/// once in each [SuiteVersion]. Lowered to v0.9, a harness lowers what a case
/// hands the SDK to v0.9 and lifts what the SDK returns back to v1.0 before
/// comparing:
///
/// - A `version` of `1.0` becomes `v0.9`, and one of `v0.9` becomes
///   `1.0`. A case written with `v0.9` means a version other than its
///   catalog's, which for this SDK is v1.0.
/// - A catalog document's `protocolVersion` of `1.0` becomes `0.9`, and any
///   function `returnType` of `validationResult` becomes `boolean`.
/// - Capabilities keyed by `1.0` are keyed by `v0.9`.
/// - v1.0 lets `createSurface` name no catalog and v0.9 does not, so a case
///   that never names a catalog has the first catalog of the case named in
///   each `createSurface`, and removed again from what the SDK returns.
/// - A v1.0 `createSurface` carrying `components` and `dataModel` is the
///   v0.9 `createSurface` followed by the `updateComponents` and
///   `updateDataModel` that fill it. Lifting joins them back for the formats
///   whose suites use the joined form.
/// - v0.9 `createSurface` states `sendDataModel` even when it is false,
///   which v1.0 leaves out.
/// - v1.0 writes a data binding as `@path` and a function call as `@call`,
///   where v0.9 writes `path` and `call`. Only components and the function a
///   `callRendererFunction` names are renamed: a `ChildList` template
///   (`componentId` beside `path`), the `updateDataModel` envelope's `path`
///   and data model values keep their keys in both versions.
library;

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

import 'manifest.dart';

export 'manifest.dart' show harnessName, recordCase;

/// Common metadata keys allowed at the top level of every conformance case.
const Set<String> caseMetadataKeys = {
  'action',
  'description',
  'features',
  'name',
};

/// Keys recognized inside an `expect_error` block by [expectThrowsCategory].
const Set<String> knownExpectErrorKeys = {'category', 'message'};

/// Keys recognized inside a catalog expectation map by
/// [SuiteVersion.expectCatalog].
const Set<String> knownCatalogExpectKeys = {
  'catalog_id',
  'components',
  'functions',
  'protocol_version',
};

/// Fails the current test if [obj] contains any keys not in [allowed].
void assertKnownKeys(
  Map<String, Object?> obj,
  Set<String> allowed,
  String where,
) {
  final List<String> unknown =
      obj.keys.where((k) => !allowed.contains(k)).toList()..sort();
  if (unknown.isNotEmpty) {
    fail('Unhandled keys at $where: $unknown');
  }
}

/// Registers a test that fails if any key in [entries] is absent from
/// [knownCaseNames].
void verifyNoUnusedEntries(
  String label,
  Set<String> knownCaseNames,
  Iterable<String> entries,
) {
  final List<String> unused =
      entries.where((k) => !knownCaseNames.contains(k)).toList()..sort();
  if (unused.isNotEmpty) {
    test('$label: no unused skip entries', () {
      fail('Unused skip entries in $label: $unused');
    });
  }
}

/// Reads the cases of the suite at [path], relative to `conformance/`, as
/// plain Dart maps, and registers a `tearDown` recorder when called inside a
/// test group.
List<Map<String, Object?>> loadSuite(String path) {
  final String text = File('$conformanceRoot/$path').readAsStringSync();
  Object? parsed;
  try {
    parsed = loadYaml(text);
  } on YamlException {
    parsed = loadYaml(
      text.replaceAll(
        RegExp(r'\\ud[89a-f][0-9a-f]{2}', caseSensitive: false),
        r'\ufffd',
      ),
    );
  }
  final YamlList list = switch (parsed) {
    final YamlList items => items,
    final YamlMap map => map['tests']! as YamlList,
    _ => throw StateError('Unsupported suite YAML structure in $path.'),
  };
  final List<Map<String, Object?>> cases = [
    for (final Object? node in list) _plain(node)! as Map<String, Object?>,
  ];
  final Set<String> caseNames = {
    for (final Map<String, Object?> testCase in cases)
      (testCase['id'] ?? testCase['name'])! as String,
  };
  registerSuiteManifestRecorder(path, caseNames);
  return cases;
}

/// The protocol version a harness runs a suite's cases in.
enum SuiteVersion {
  /// Each case lowered to v0.9 before this SDK reads it, and what the SDK
  /// returns lifted back to v1.0, as the library comment describes.
  v0_9('lowered to v0.9'),

  /// Each case as written, and what this SDK returns as it writes it.
  v1_0('as written in v1.0');

  const SuiteVersion(this.label);

  /// How a group title names the version.
  final String label;

  bool get _lowers => this == v0_9;

  /// The catalog a suite names by [entry]; see [catalogConfig].
  CatalogConfig catalogConfig(Object? entry) =>
      _catalogConfig(entry, lower: _lowers);

  /// The catalogs a case names in [args]; see [caseCatalogs].
  List<CatalogApi> catalogs(Map<String, Object?> args) =>
      caseCatalogs(args, lower: _lowers);

  /// The renderer capabilities [json] states.
  A2uiRendererCapabilities capabilities(Map<String, Object?> json) => _lowers
      ? lowerCapabilities(json)
      : A2uiRendererCapabilities.fromJson(json);

  /// The prompt example at [path], relative to `conformance/`.
  List<AgentToRendererMessage> example(String path) =>
      _lowers ? loadExample(path) : loadExampleUnlowered(path);

  /// [json], messages a case starts from.
  List<AgentToRendererMessage> messages(List<Object?> json) => _lowers
      ? lowerMessages(json)
      : [
          for (final Object? message in json)
            AgentToRendererMessage.fromJson(
              Map<String, Object?>.from(message! as Map),
            ),
        ];

  /// [text], a payload a model wrote, given [catalogId] in each
  /// `createSurface` when it is lowered; see [lowerText].
  String text(String text, {String? catalogId}) =>
      _lowers ? lowerText(text, catalogId: catalogId) : text;

  /// A streaming text lowerer for chunked raw responses.
  SuiteTextLowerer openTextLowerer({String? catalogId}) =>
      SuiteTextLowerer(catalogId: catalogId, passthrough: !_lowers);

  /// The unlowered v1.0 catalogs named by [args] when running lowered, or
  /// empty when running as written.
  List<CatalogApi> liftCatalogs(Map<String, Object?> args) =>
      _lowers ? caseCatalogs(args, lower: false) : const [];

  /// The catalog a harness names in each `createSurface` of [testCase] when
  /// it is lowered; see [injectedCatalogId].
  String? injectedCatalog(Map<String, Object?> testCase) =>
      _lowers ? injectedCatalogId(testCase) : null;

  /// [messages] as JSON in the vocabulary of the suites; see [liftMessages].
  List<Object?> messagesJson(
    List<AgentToRendererMessage> messages, {
    bool join = false,
    String? injectedCatalogId,
    List<CatalogApi> catalogs = const [],
  }) => _lowers
      ? liftMessages(
          messages,
          join: join,
          injectedCatalogId: injectedCatalogId,
          catalogs: catalogs,
        )
      : messages.map(messageAsWritten).toList();

  /// [parts] in the vocabulary of the suites; see [liftParts].
  List<Object?> partsJson(
    List<StreamPart> parts, {
    bool join = false,
    String? injectedCatalogId,
    List<CatalogApi> catalogs = const [],
  }) => _lowers
      ? liftParts(
          parts,
          join: join,
          injectedCatalogId: injectedCatalogId,
          catalogs: catalogs,
        )
      : partsAsWritten(parts);

  /// [properties], a component's property map, with reserved keys and
  /// `Child`/`ChildList`/`Action` properties lifted to v1.0 when the suite
  /// ran lowered.
  Map<String, Object?> liftProperties(
    Map<String, Object?> properties, {
    String? componentType,
    String? catalogId,
    List<CatalogApi> catalogs = const [],
  }) => _lowers
      ? _ComponentLifter(catalogs).liftProperties(
          properties,
          componentType: componentType,
          catalogId: catalogId,
        )
      : properties;

  /// Checks the catalog-level assertions of [expected] against [catalog];
  /// see [expectCatalog]. As written, the version is checked too.
  void expectCatalog(CatalogApi catalog, Map<String, Object?> expected) {
    assertKnownKeys(expected, knownCatalogExpectKeys, 'expect.catalog');
    _expectCatalog(catalog, expected);
    if (expected['protocol_version'] case final String version when !_lowers) {
      expect(catalog.protocolVersion?.jsonValue, version);
    }
  }
}

/// Compiles one block and checks its messages on their own.
///
/// A conformance `compile` case fixes the messages an agent sends for one
/// block, so they are checked the way [validatePayload] checks a payload: a
/// surface that the block updates without creating is assumed to exist.
List<AgentToRendererMessage> compileChecked(Parser parser, String content) {
  final List<AgentToRendererMessage> messages = parser.compile(content);
  validatePayload(parser.catalogs, messages);
  return messages;
}

/// Suite-level error categories mapped onto this SDK's exception types.
final Map<String, Matcher> _errors = {
  'ParseError': isA<A2uiParseError>(),
  'ValidationError': isA<A2uiValidationError>(),
  'CatalogError': isA<A2uiCatalogError>(),
};

/// Expects [body] to throw the error category (and optional message pattern)
/// of a case's `expect_error`.
void expectThrowsCategory(
  void Function() body,
  Object? expectError, {
  String? reason,
}) {
  final error = expectError! as Map<String, Object?>;
  assertKnownKeys(error, knownExpectErrorKeys, 'expect_error');
  final category = error['category']! as String;
  final Matcher? categoryMatcher = _errors[category];
  if (categoryMatcher == null) {
    fail('Unknown error category: $category');
  }
  final Matcher matcher = switch (error['message']) {
    final String pattern => allOf(
      categoryMatcher,
      isA<A2uiError>().having(
        (e) => e.message,
        'message',
        matches(RegExp(pattern, caseSensitive: false)),
      ),
    ),
    _ => categoryMatcher,
  };
  expect(body, throwsA(matcher), reason: reason);
}

/// The catalog a suite names by [entry]: a path relative to `conformance/`,
/// a map with the path under `catalog` and the transformers registered with
/// it under `transformers`, or a catalog document written in the case.
CatalogConfig _catalogConfig(Object? entry, {required bool lower}) =>
    switch (entry) {
      final String path => CatalogConfig(
        lower ? loadCatalog(path) : loadCatalogUnlowered(path),
      ),
      {'catalog': final String path} => CatalogConfig(
        lower ? loadCatalog(path) : loadCatalogUnlowered(path),
        transformers: [
          for (final Object? transformer
              in (entry as Map)['transformers'] as List<Object?>? ?? const [])
            _transformer(transformer),
        ],
      ),
      final Map<String, Object?> document => CatalogConfig(
        lower
            ? _provide(
                lowerCatalogDocument(document),
                version: A2uiProtocolVersion.v0_9,
              )
            : _provide(document),
      ),
      _ => throw ArgumentError.value(entry, 'entry', 'Not a catalog entry'),
    };

/// The catalogs a case names in `args`, each after the transformers
/// registered with it.
List<CatalogApi> caseCatalogs(Map<String, Object?> args, {bool lower = true}) =>
    [
      if (args['catalog'] case final Object catalog)
        _catalogConfig(catalog, lower: lower).transformedCatalog,
      if (args['catalogs'] case final List<Object?> entries)
        for (final Object? entry in entries)
          _catalogConfig(entry, lower: lower).transformedCatalog,
    ];

bool _isVersionAtLeast1_0(Object? versionStr) =>
    versionStr is String && compareVersions(versionStr, '1.0') >= 0;

/// Whether a catalog the case names in `args` declares v1.0 or later before it
/// is lowered, which turns on what this SDK does only for a v1.0+ agent.
bool caseDeclaresV1(Map<String, Object?> args) =>
    [
      if (args['catalog'] case final Object catalog) catalog,
      ...?(args['catalogs'] as List<Object?>?),
    ].any((Object? entry) {
      final Object? path = entry is Map ? entry['catalog'] : entry;
      if (path is! String) return false;
      final document =
          jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
              as Map<String, Object?>;
      return _isVersionAtLeast1_0(document['protocolVersion']);
    });

/// The `protocolVersion` the first catalog a case names in `args` declares,
/// before it is lowered, or null when the case names none.
String? caseCatalogVersion(Map<String, Object?> args) {
  final Object? entry =
      args['catalog'] ?? (args['catalogs'] as List?)?.firstOrNull;
  final Object? path = entry is Map ? entry['catalog'] : entry;
  if (path is! String) return null;
  final document =
      jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
          as Map<String, Object?>;
  return document['protocolVersion']?.toString();
}

CatalogTransformer _transformer(Object? spec) => switch (spec) {
  {'component_pruning': final List<Object?>? names} =>
    ComponentPruningTransformer(names?.cast<String>()),
  {'function_pruning': final List<Object?>? names} =>
    FunctionPruningTransformer(names?.cast<String>()),
  _ => throw ArgumentError.value(spec, 'spec', 'Unknown transformer'),
};

final Map<String, CatalogApi> _catalogCache = {};
final Map<String, CatalogApi> _unloweredCatalogCache = {};

/// The catalog document at [path], lowered to v0.9 and loaded by a
/// provider.
///
/// A document that names no catalog is given its path as its id, which a
/// provider supplies the same way an agent would.
CatalogApi loadCatalog(String path) => _catalogCache.putIfAbsent(path, () {
  final Map<String, Object?> document = lowerCatalogDocument(
    jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
        as Map<String, Object?>,
  );
  return InMemoryCatalogProvider(
    document,
    protocolVersion: A2uiProtocolVersion.v0_9,
    catalogId: document.containsKey('catalogId') ? null : path,
  ).load();
});

/// The catalog document at [path], loaded as written by a provider.
///
/// A document that names no catalog is given its path as its id, and one that
/// states no version is given v1.0, the version the suites are written in.
CatalogApi loadCatalogUnlowered(String path) =>
    _unloweredCatalogCache.putIfAbsent(
      path,
      () => _provide(
        jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
            as Map<String, Object?>,
        catalogId: path,
      ),
    );

/// [document] loaded by a provider, given [catalogId] when it names no
/// catalog, and [version] when it states no version.
CatalogApi _provide(
  Map<String, Object?> document, {
  String? catalogId,
  A2uiProtocolVersion version = A2uiProtocolVersion.v1_0,
}) => InMemoryCatalogProvider(
  document,
  catalogId: document.containsKey('catalogId') ? null : catalogId,
  protocolVersion: document.containsKey('protocolVersion') ? null : version,
).load();

/// [document] with a `protocolVersion` of `1.0` or later stated as `0.9`,
/// any `common_types.json#/$defs/Child` `$ref` rewritten to `ComponentId`, and
/// any `validationResult` function return type stated as `boolean`.
Map<String, Object?> lowerCatalogDocument(Map<String, Object?> document) {
  if (!_isVersionAtLeast1_0(document['protocolVersion'])) {
    return {...document};
  }
  final rewritten = _lowerChildRefs(document)! as Map<String, Object?>;
  return {
    ...rewritten,
    'protocolVersion': '0.9',
    if (rewritten['functions'] case final Map<Object?, Object?> functions)
      'functions': {
        for (final MapEntry<Object?, Object?> entry in functions.entries)
          entry.key.toString(): switch (entry.value) {
            final Map<Object?, Object?> fn => <String, Object?>{
              for (final MapEntry<Object?, Object?> fnEntry in fn.entries)
                if (fnEntry.key != 'allowedCallers' &&
                    fnEntry.key != 'requiresUserActivation')
                  fnEntry.key.toString(): fnEntry.value,
              if (fn['returnType'] == 'validationResult')
                'returnType': 'boolean',
              if (fn['properties'] case final Map<Object?, Object?> props
                  when (props['returnType'] as Map?)?['const'] ==
                      'validationResult')
                'properties': {
                  ...props,
                  'returnType': {'const': 'boolean'},
                },
            },
            final Object? other => other,
          },
      },
  };
}

Object? _lowerChildRefs(Object? node) => switch (node) {
  final List<Object?> list => [
    for (final Object? item in list) _lowerChildRefs(item),
  ],
  final Map<Object?, Object?> map => <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in map.entries)
      entry.key.toString():
          entry.key == r'$ref' &&
              entry.value is String &&
              (entry.value! as String).endsWith(
                'common_types.json#/\$defs/Child',
              )
          ? (entry.value! as String).replaceFirst(
              'common_types.json#/\$defs/Child',
              'common_types.json#/\$defs/ComponentId',
            )
          : _lowerChildRefs(entry.value),
  },
  _ => node,
};

/// [version] swapped between the suite's version and this SDK's, in either
/// spelling; any other value is returned as it is.
Object? swapVersion(Object? version) => switch (version) {
  '1.0' || 'v1.0' => 'v0.9',
  'v0.9' => '1.0',
  _ => version,
};

// A case may write the field in curly quotes, which the parser repairs.
final RegExp _versionField = RegExp(
  '([“"]version[”"]\\s*:\\s*[“"])(v?1\\.0|v0\\.9)([”"])',
);

/// [text], a payload a model wrote, lowered to v0.9: each `version` swapped,
/// each `@path`, `@call`, `@action`, and `@functionCall` key rewritten to
/// its v0.9 spelling, each `{"@child": ...}` unwrapped or lowered to a v0.9
/// template, and each `createSurface` given [catalogId] when it is not null.
String lowerText(String text, {String? catalogId}) {
  final lowerer = SuiteTextLowerer(catalogId: catalogId);
  return '${lowerer.feed(text)}${lowerer.close()}';
}

/// Incrementally lowers raw v1.0 JSON response text (including chunked
/// streams) into v0.9 JSON text.
class SuiteTextLowerer {
  final String? catalogId;
  final bool passthrough;

  SuiteTextLowerer({this.catalogId, this.passthrough = false});

  final StringBuffer _pending = StringBuffer();
  int _braceDepth = 0;
  String? _stringOpenQuote;
  bool get _inString => _stringOpenQuote != null;
  bool _escape = false;
  bool _capturingChild = false;
  int _childBaseDepth = 0;
  int _dataModelDepth = -1;
  bool _expectKey = false;
  bool _awaitingCreateSurfaceOpen = false;
  bool _awaitingVersionValue = false;

  static bool _isJsonQuote(String ch) => ch == '"' || ch == '“' || ch == '”';

  static bool _closesQuote(String openQuote, String ch) =>
      openQuote == '"' ? ch == '"' : (ch == '”' || ch == '“');

  String feed(String chunk) {
    if (passthrough) return chunk;
    final out = StringBuffer();
    for (var i = 0; i < chunk.length; i++) {
      _consumeChar(chunk[i], out);
    }
    return out.toString();
  }

  String close() {
    if (passthrough || _pending.isEmpty) return '';
    final rest = _pending.toString();
    _pending.clear();
    return _lowerFragment(rest);
  }

  void _consumeChar(String ch, StringBuffer out) {
    if (_capturingChild) {
      _pending.write(ch);
      _advanceJsonState(ch);
      if (!_inString && _braceDepth == _childBaseDepth) {
        final raw = _pending.toString();
        _pending.clear();
        _capturingChild = false;
        out.write(_lowerCapturedChildObject(raw));
      }
      return;
    }

    if (_pending.isNotEmpty) {
      _pending.write(ch);
      _advanceJsonState(ch);
      _drainPending(out);
      return;
    }

    if (_inString) {
      _advanceJsonState(ch);
      out.write(ch);
      return;
    }

    if (ch == '{') {
      _braceDepth++;
      _expectKey = true;
      if (_dataModelDepth >= 0) {
        out.write(ch);
        return;
      }
      if (_awaitingCreateSurfaceOpen) {
        _awaitingCreateSurfaceOpen = false;
        out.write(ch);
        if (catalogId != null) {
          out.write('"catalogId": ${jsonEncode(catalogId)}, ');
        }
        return;
      }
      _pending.write(ch);
      return;
    }

    if (ch == '}' && _braceDepth > 0) {
      _braceDepth--;
      if (_braceDepth == _dataModelDepth) {
        _dataModelDepth = -1;
      }
      _expectKey = false;
      out.write(ch);
      return;
    }

    if (ch == ',' && _braceDepth > 0) {
      _expectKey = true;
      _awaitingCreateSurfaceOpen = false;
      _awaitingVersionValue = false;
      out.write(ch);
      return;
    }

    if (_braceDepth > 0 && _isJsonQuote(ch)) {
      if (_dataModelDepth < 0 && (_expectKey || _awaitingVersionValue)) {
        _pending.write(ch);
        _advanceJsonState(ch);
        return;
      }
      _advanceJsonState(ch);
      out.write(ch);
      return;
    }

    if (_awaitingCreateSurfaceOpen || _awaitingVersionValue) {
      if (!_isWhitespace(ch)) {
        _awaitingCreateSurfaceOpen = false;
        _awaitingVersionValue = false;
      }
    } else if (_expectKey && !_isWhitespace(ch)) {
      _expectKey = false;
    }
    out.write(ch);
  }

  void _drainPending(StringBuffer out) {
    final buf = _pending.toString();
    // Started with `{` outside dataModel; check whether first key is @child.
    if (buf.startsWith('{')) {
      final int firstNonWs = _skipWhitespace(buf, 1);
      if (firstNonWs >= buf.length) return;
      if (!_isJsonQuote(buf[firstNonWs])) {
        // Not an object starting with a string key (`{}` or prose `{foo}`).
        _pending.clear();
        if (_awaitingCreateSurfaceOpen) {
          _awaitingCreateSurfaceOpen = false;
          out.write(buf);
          if (catalogId != null && buf.startsWith('{')) {
            out.write('"catalogId": ${jsonEncode(catalogId)}, ');
          }
          return;
        }
        out.write(buf);
        return;
      }
      final int? keyEnd = _findQuotedStringEnd(buf, firstNonWs);
      if (keyEnd == null) return;
      final String keyText = _decodeQuotedStringOrRaw(
        buf.substring(firstNonWs, keyEnd + 1),
      );
      if (keyText != '@child') {
        _pending.clear();
        // Flush `{` + leading ws, and re-process from the first key `"`.
        out.write(buf.substring(0, firstNonWs));
        _pending.write(buf.substring(firstNonWs));
        _drainPending(out);
        return;
      }
      final int afterKey = _skipWhitespace(buf, keyEnd + 1);
      if (afterKey >= buf.length) return;
      if (buf[afterKey] == ':') {
        _capturingChild = true;
        _childBaseDepth = _braceDepth - 1;
        return;
      }
      _pending.clear();
      out.write(buf);
      return;
    }

    // Case 2: started with `"..."` (either a key or `"version"` value).
    final int? strEnd = _findQuotedStringEnd(buf, 0);
    if (strEnd == null) {
      // Flush once a long string won't match a short reserved key.
      if (buf.length > 20) {
        _pending.clear();
        _expectKey = false;
        _awaitingVersionValue = false;
        out.write(buf);
      }
      return;
    }

    final String strToken = buf.substring(0, strEnd + 1);
    final String decoded = _decodeQuotedStringOrRaw(strToken);

    if (_awaitingVersionValue) {
      _pending.clear();
      _awaitingVersionValue = false;
      out.write(_reQuote(strToken, '${swapVersion(decoded)}'));
      out.write(buf.substring(strEnd + 1));
      return;
    }

    const interestingKeys = <String>{
      '@action',
      '@functionCall',
      '@path',
      '@call',
      'version',
      'createSurface',
      'dataModel',
      'updateDataModel',
    };
    if (!interestingKeys.contains(decoded)) {
      _pending.clear();
      _expectKey = false;
      out.write(buf);
      return;
    }

    final int afterStr = _skipWhitespace(buf, strEnd + 1);
    if (afterStr >= buf.length) return;

    _pending.clear();
    _expectKey = false;
    final String rest = buf.substring(strEnd + 1);
    if (buf[afterStr] != ':') {
      out.write(buf);
      return;
    }

    switch (decoded) {
      case '@action':
        out.write(_reQuote(strToken, 'event'));
        out.write(rest);
      case '@functionCall':
        out.write(_reQuote(strToken, 'functionCall'));
        out.write(rest);
      case '@path':
        out.write(_reQuote(strToken, 'path'));
        out.write(rest);
      case '@call':
        out.write(_reQuote(strToken, 'call'));
        out.write(rest);
      case 'version':
        _awaitingVersionValue = true;
        out.write(strToken);
        out.write(rest);
      case 'createSurface':
        _awaitingCreateSurfaceOpen = true;
        out.write(strToken);
        out.write(rest);
      case 'dataModel':
      case 'updateDataModel':
        _dataModelDepth = _braceDepth;
        out.write(strToken);
        out.write(rest);
      default:
        out.write(buf);
    }
  }

  void _advanceJsonState(String ch) {
    final String? openQuote = _stringOpenQuote;
    if (openQuote != null) {
      if (_escape) {
        _escape = false;
      } else if (ch == r'\') {
        _escape = true;
      } else if (_closesQuote(openQuote, ch)) {
        _stringOpenQuote = null;
      }
      return;
    }
    if (_isJsonQuote(ch)) {
      _stringOpenQuote = ch;
    } else if (ch == '{') {
      _braceDepth++;
    } else if (ch == '}' && _braceDepth > 0) {
      _braceDepth--;
    }
  }

  String _lowerCapturedChildObject(String raw) {
    // Extract top-level key/value slices directly before invoking `jsonDecode`,
    // so raw unescaped line breaks or curly quotes inside identifier strings
    // (`{"@child": "bo\ndy"}`) pass through intact for the v0.9 parser.
    final List<(String, String)>? entries = _parseTopLevelObjectEntries(raw);
    if (entries != null) {
      if (entries.length == 1 && entries[0].$1 == '@child') {
        return entries[0].$2;
      }
      if (entries.length == 2) {
        String? childRaw;
        String? pathRaw;
        for (final (String key, String value) in entries) {
          if (key == '@child') childRaw = value;
          if (key == '@path') pathRaw = value;
        }
        if (childRaw != null && pathRaw != null) {
          return '{"componentId": $childRaw, "path": $pathRaw}';
        }
      }
    }
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?>) {
        if (decoded.length == 1 && decoded.containsKey('@child')) {
          return jsonEncode(decoded['@child']);
        }
        if (decoded.length == 2 &&
            decoded.containsKey('@child') &&
            decoded.containsKey('@path')) {
          return jsonEncode({
            'componentId': decoded['@child'],
            'path': decoded['@path'],
          });
        }
        return jsonEncode(_renameKeysIn(decoded, lower: true));
      }
    } on FormatException {
      // Incomplete or malformed object: fall back to literal key lowering.
    }
    return _lowerFragment(raw);
  }

  static List<(String, String)>? _parseTopLevelObjectEntries(String raw) {
    if (raw.length < 2 || !raw.startsWith('{') || !raw.endsWith('}')) {
      return null;
    }
    final int end = raw.length - 1;
    final entries = <(String, String)>[];
    int i = _skipWhitespace(raw, 1);
    while (i < end) {
      if (!_isJsonQuote(raw[i])) return null;
      final int? keyEnd = _findQuotedStringEnd(raw, i);
      if (keyEnd == null || keyEnd >= end) return null;
      final String key = _decodeQuotedStringOrRaw(raw.substring(i, keyEnd + 1));
      i = _skipWhitespace(raw, keyEnd + 1);
      if (i >= end || raw[i] != ':') return null;
      i = _skipWhitespace(raw, i + 1);
      if (i >= end) return null;
      final valStart = i;
      var braceDepth = 0;
      var bracketDepth = 0;
      while (i < end) {
        final String ch = raw[i];
        if (_isJsonQuote(ch)) {
          final int? strEnd = _findQuotedStringEnd(raw, i);
          if (strEnd == null || strEnd >= end) return null;
          i = strEnd + 1;
          continue;
        }
        if (ch == '{') {
          braceDepth++;
        } else if (ch == '}') {
          if (braceDepth == 0) return null;
          braceDepth--;
        } else if (ch == '[') {
          bracketDepth++;
        } else if (ch == ']') {
          if (bracketDepth == 0) return null;
          bracketDepth--;
        } else if (ch == ',' && braceDepth == 0 && bracketDepth == 0) {
          break;
        }
        i++;
      }
      if (braceDepth != 0 || bracketDepth != 0) return null;
      final String rawValue = raw.substring(valStart, i).trim();
      if (rawValue.isEmpty) return null;
      entries.add((key, rawValue));
      if (i < end && raw[i] == ',') {
        i = _skipWhitespace(raw, i + 1);
        continue;
      }
      break;
    }
    return entries;
  }

  static int? _findQuotedStringEnd(String s, int start) {
    final String open = s[start];
    var escape = false;
    for (int i = start + 1; i < s.length; i++) {
      final String ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch == r'\') {
        escape = true;
        continue;
      }
      if (_closesQuote(open, ch)) {
        return i;
      }
    }
    return null;
  }

  static String _decodeQuotedStringOrRaw(String token) {
    if (token.length < 2) return token;
    final straight = token.startsWith('"') && token.endsWith('"')
        ? token
        : '"${token.substring(1, token.length - 1).replaceAll('"', r'\"')}"';
    try {
      final Object? decoded = jsonDecode(straight);
      if (decoded is String) return decoded;
    } on FormatException {
      // Unescaped control char or partial escape: fall through to raw text.
    }
    return token.substring(1, token.length - 1);
  }

  static String _reQuote(String templateToken, String replacement) {
    final String open = templateToken[0];
    final String close = templateToken[templateToken.length - 1];
    if (open == '"' && close == '"') return jsonEncode(replacement);
    final String encoded = jsonEncode(replacement);
    return '$open${encoded.substring(1, encoded.length - 1)}$close';
  }

  String _lowerFragment(String raw) => raw
      .replaceAllMapped(_reservedKeyField, (m) => '"${_lowerKeyName(m[1]!)}"')
      .replaceAllMapped(
        _versionField,
        (m) => '${m[1]}${swapVersion(m[2])}${m[3]}',
      );

  static String _lowerKeyName(String name) => switch (name) {
    'action' => 'event',
    'functionCall' => 'functionCall',
    'path' => 'path',
    'call' => 'call',
    _ => name,
  };

  static bool _isWhitespace(String ch) =>
      ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r';

  static int _skipWhitespace(String s, int start) {
    var i = start;
    while (i < s.length && _isWhitespace(s[i])) {
      i++;
    }
    return i;
  }
}

// A single `@`: a doubled one escapes a literal key and stays as it is.
final RegExp _reservedKeyField = RegExp(
  r'"@(path|call|action|functionCall)"(?=\s*:)',
);

/// The catalog a harness names in each `createSurface` of a case that names
/// none, or null when the case names one itself.
String? injectedCatalogId(Map<String, Object?> testCase) {
  if (jsonEncode(testCase).contains('catalogId')) return null;
  final List<CatalogApi> catalogs = caseCatalogs(
    testCase['args']! as Map<String, Object?>,
  );
  return catalogs.isEmpty ? null : catalogs.first.id;
}

/// [messages], written against v1.0 as JSON, lowered to v0.9 messages.
///
/// A `createSurface` naming no catalog is given [defaultCatalogId].
List<AgentToRendererMessage> lowerMessages(
  List<Object?> messages, {
  String? defaultCatalogId,
}) {
  final lowered = <Map<String, Object?>>[];
  for (final message in messages) {
    final Map<String, Object?> json = _renameReservedKeys(
      Map<String, Object?>.from(message! as Map),
      lower: true,
    );
    json['version'] = swapVersion(json['version']);
    if (json['createSurface'] case final Map<Object?, Object?> body) {
      final create = Map<String, Object?>.from(body);
      final Object? components = create.remove('components');
      final Object? dataModel = create.remove('dataModel');
      if (defaultCatalogId != null) {
        create.putIfAbsent('catalogId', () => defaultCatalogId);
      }
      final Object? surfaceId = create['surfaceId'];
      lowered.add({'version': json['version'], 'createSurface': create});
      if (components != null) {
        lowered.add({
          'version': json['version'],
          'updateComponents': {
            'surfaceId': surfaceId,
            'components': components,
          },
        });
      }
      if (dataModel != null) {
        lowered.add({
          'version': json['version'],
          'updateDataModel': {
            'surfaceId': surfaceId,
            'path': '/',
            'value': dataModel,
          },
        });
      }
    } else {
      lowered.add(json);
    }
  }
  return AgentToRendererMessage.parseAll(
    lowered,
    protocolVersion: A2uiProtocolVersion.v0_9,
  ).messages;
}

/// The prompt example at [path], relative to `conformance/`, lowered to
/// v0.9.
List<AgentToRendererMessage> loadExample(String path) => lowerMessages(
  jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
      as List<Object?>,
);

/// The prompt example at [path], relative to `conformance/`, loaded as written
/// without lowering to v0.9.
List<AgentToRendererMessage> loadExampleUnlowered(String path) =>
    AgentToRendererMessage.parseAll([
      for (final Object? item
          in jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
              as List<Object?>)
        Map<String, Object?>.from(item! as Map),
    ], protocolVersion: A2uiProtocolVersion.v1_0).messages;

/// [messages] as JSON in the v1.0 shape the suites are written in.
///
/// When [join] is true, a surface that v0.9 creates empty and then fills
/// becomes one `createSurface` carrying its components and initial data
/// model. [injectedCatalogId], if given, is removed from each
/// `createSurface` that names it.
List<Object?> liftMessages(
  List<AgentToRendererMessage> messages, {
  bool join = false,
  String? injectedCatalogId,
  List<CatalogApi> catalogs = const [],
}) {
  final lifter = _ComponentLifter(catalogs);
  final lifted = <Map<String, Object?>>[];
  String? currentSurfaceCatalogId;
  for (final message in messages) {
    final Map<String, Object?> rawJson = message.toJson();
    if (rawJson['createSurface'] case final Map<String, Object?> cs) {
      currentSurfaceCatalogId = cs['catalogId'] as String?;
    }
    final Map<String, Object?> json = _renameReservedKeys(
      rawJson,
      lower: false,
      lifter: lifter,
      surfaceCatalogId: currentSurfaceCatalogId,
    );
    final create = lifted.lastOrNull?['createSurface'] as Map<String, Object?>?;
    final Object? surfaceId = create?['surfaceId'];
    switch (json) {
      case {
            'updateComponents': {
              'surfaceId': final Object? id,
              'components': final Object? components,
            },
          }
          when join && id == surfaceId && !create!.containsKey('components'):
        create['components'] = components;
      case {
            'updateDataModel': {
              'surfaceId': final Object? id,
              'path': '/',
              'value': final Object? value,
            },
          }
          when join && id == surfaceId && !create!.containsKey('dataModel'):
        create['dataModel'] = value;
      case {'createSurface': final Map<String, Object?> create}:
        lifted.add({
          'version': swapVersion(json['version']),
          'createSurface': {...create}
            ..removeWhere(
              (key, value) =>
                  (key == 'sendDataModel' && value == false) ||
                  (key == 'catalogId' && value == injectedCatalogId),
            ),
        });
      default:
        lifted.add({...json, 'version': swapVersion(json['version'])});
    }
  }
  return lifted;
}

/// The v1.0 spelling of each key a data binding or function call reserves,
/// mapped to its v0.9 spelling.
const Map<String, String> _reservedKeys = {'@path': 'path', '@call': 'call'};

const Map<String, String> _componentMixinKeys = {
  '@checks': 'checks',
  '@accessibility': 'accessibility',
};

/// [message] with the reserved keys of its components, and of the function
/// a `callRendererFunction` names, renamed to v0.9 when [lower] is true and
/// to v1.0 otherwise.
Map<String, Object?> _renameReservedKeys(
  Map<String, Object?> message, {
  required bool lower,
  _ComponentLifter? lifter,
  String? surfaceCatalogId,
}) => {
  for (final MapEntry<String, Object?> entry in message.entries)
    entry.key: switch (entry.value) {
      final Map<String, Object?> body => {
        for (final MapEntry<String, Object?> field in body.entries)
          field.key: switch (field.key) {
            'components' => _liftOrLowerComponents(
              field.value,
              lower: lower,
              lifter: lifter,
              surfaceCatalogId: surfaceCatalogId,
            ),
            'callFunction' => _renameKeysIn(field.value, lower: lower),
            _ => field.value,
          },
      },
      final Object? value => value,
    },
};

Object? _liftOrLowerComponents(
  Object? components, {
  required bool lower,
  _ComponentLifter? lifter,
  String? surfaceCatalogId,
}) {
  if (lower || lifter == null || components is! List<Object?>) {
    return _renameKeysIn(components, lower: lower);
  }
  return [
    for (final Object? comp in components)
      comp is Map<String, Object?>
          ? lifter.liftComponent(comp, surfaceCatalogId: surfaceCatalogId)
          : _renameKeysIn(comp, lower: false),
  ];
}

/// [node] with each reserved key renamed, and v1.0 `@child`/`@action`/
/// `@functionCall` directives lowered when [lower] is true.
Object? _renameKeysIn(Object? node, {required bool lower}) => switch (node) {
  final List<Object?> list => [
    for (final Object? item in list) _renameKeysIn(item, lower: lower),
  ],
  final Map<String, Object?> map when lower => _lowerMap(map),
  final Map<String, Object?> map => {
    for (final MapEntry<String, Object?> entry in map.entries)
      (map.containsKey('componentId')
          ? entry.key
          : _renameKey(
              entry.key,
              false,
              isComponentRoot:
                  map.containsKey('id') && map.containsKey('component'),
            )): _renameKeysIn(
        entry.value,
        lower: false,
      ),
  },
  _ => node,
};

Object? _lowerMap(Map<String, Object?> map) {
  if (map.length == 1 && map.containsKey('@child')) {
    return map['@child'];
  }
  if (map.length == 2 &&
      map.containsKey('@child') &&
      map.containsKey('@path')) {
    return <String, Object?>{
      'componentId': map['@child'],
      'path': map['@path'],
    };
  }
  if (map.length == 1 && map.containsKey('@action')) {
    return <String, Object?>{
      'event': _renameKeysIn(map['@action'], lower: true),
    };
  }
  if (map.length == 1 && map.containsKey('@functionCall')) {
    return <String, Object?>{
      'functionCall': _renameKeysIn(map['@functionCall'], lower: true),
    };
  }
  final bool isRoot = map.containsKey('id') && map.containsKey('component');
  return {
    for (final MapEntry<String, Object?> entry in map.entries)
      (map.containsKey('componentId')
              ? entry.key
              : _renameKey(entry.key, true, isComponentRoot: isRoot)):
          _renameKeysIn(entry.value, lower: true),
  };
}

/// Schema-guided lifter transforming v0.9 component properties into v1.0
/// `@child`, `@action`, and `@functionCall` wire shapes.
class _ComponentLifter {
  final List<CatalogApi> catalogs;

  _ComponentLifter(this.catalogs);

  Map<String, Object?> liftComponent(
    Map<String, Object?> comp, {
    String? surfaceCatalogId,
  }) => liftProperties(
    comp,
    componentType: comp['component'] as String?,
    catalogId: (comp['@catalogId'] ?? comp['catalogId']) as String?,
    surfaceCatalogId: surfaceCatalogId,
    isComponentRoot: true,
  );

  Map<String, Object?> liftProperties(
    Map<String, Object?> properties, {
    String? componentType,
    String? catalogId,
    String? surfaceCatalogId,
    bool isComponentRoot = true,
  }) {
    final CatalogApi? catalog = _findCatalog(
      componentType,
      catalogId: catalogId,
      surfaceCatalogId: surfaceCatalogId,
    );
    if (catalog == null || componentType == null) {
      return _renameKeysIn(properties, lower: false)! as Map<String, Object?>;
    }
    final Map<String, Object?>? rootSchema =
        (catalog.resolvedComponentSchemas[componentType] ??
                catalog.components[componentType]?.schema)
            ?.value;
    final Map<String, Object?> defs = {
      ...catalog.definitions,
      ...(catalog.toJson()[r'$defs'] as Map?)?.cast<String, Object?>() ??
          const {},
    };
    return _liftObject(
      properties,
      rootSchema,
      defs,
      isComponentRoot: isComponentRoot,
    );
  }

  CatalogApi? _findCatalog(
    String? componentType, {
    String? catalogId,
    String? surfaceCatalogId,
  }) {
    if (componentType == null) return null;
    for (final preferred in [catalogId, surfaceCatalogId]) {
      if (preferred == null) continue;
      for (final CatalogApi cat in catalogs) {
        if (cat.id == preferred && cat.components.containsKey(componentType)) {
          return cat;
        }
      }
    }
    for (final CatalogApi cat in catalogs) {
      if (cat.components.containsKey(componentType)) return cat;
    }
    return null;
  }

  Object? _liftValue(
    Object? value,
    Map<String, Object?>? schema,
    Map<String, Object?> defs, {
    bool isComponentRoot = false,
  }) {
    if (schema != null) {
      final String? commonType = _commonTypeName(schema, defs, {});
      switch (commonType) {
        case 'Child':
          return value is String ? <String, Object?>{'@child': value} : value;
        case 'ChildList':
          if (value is List) return <String, Object?>{'@child': value};
          if (value is Map<String, Object?> &&
              value.containsKey('componentId')) {
            return <String, Object?>{
              '@child': value['componentId'],
              if (value.containsKey('path')) '@path': value['path'],
            };
          }
          return value;
        case 'Action':
          if (value is Map<String, Object?>) {
            if (value.containsKey('event')) {
              return <String, Object?>{
                '@action': _renameKeysIn(value['event'], lower: false),
              };
            }
            if (value.containsKey('functionCall')) {
              return <String, Object?>{
                '@functionCall': _renameKeysIn(
                  value['functionCall'],
                  lower: false,
                ),
              };
            }
          }
          return _renameKeysIn(value, lower: false);
      }
    }

    if (value is List<Object?>) {
      final Map<String, Object?>? itemSchema = schema == null
          ? null
          : _itemsSchema(schema, defs, {});
      return [
        for (final Object? item in value) _liftValue(item, itemSchema, defs),
      ];
    }
    if (value is Map<String, Object?>) {
      return _liftObject(value, schema, defs, isComponentRoot: isComponentRoot);
    }
    return value;
  }

  Map<String, Object?> _liftObject(
    Map<String, Object?> map,
    Map<String, Object?>? schema,
    Map<String, Object?> defs, {
    required bool isComponentRoot,
  }) {
    if (map.containsKey('componentId') && map.containsKey('path')) {
      return <String, Object?>{
        '@child': map['componentId'],
        '@path': map['path'],
      };
    }
    return {
      for (final MapEntry<String, Object?> entry in map.entries)
        _renameKey(
          entry.key,
          false,
          isComponentRoot: isComponentRoot,
        ): _liftValue(
          entry.value,
          schema == null ? null : _propertySchema(schema, entry.key, defs, {}),
          defs,
        ),
    };
  }

  static String? _commonTypeName(
    Map<String, Object?> schema,
    Map<String, Object?> defs,
    Set<String> visited,
  ) {
    final ref = (schema[r'$ref'] ?? schema['commonTypesRef']) as String?;
    if (ref != null) {
      for (final name in ['Child', 'ChildList', 'Action']) {
        if (ref.endsWith('/\$defs/$name') || ref == name) return name;
      }
      if (ref.startsWith('#/\$defs/') && visited.add(ref)) {
        final Object? target = defs[ref.substring(8)];
        if (target is Map) {
          final String? resolved = _commonTypeName(
            target.cast<String, Object?>(),
            defs,
            visited,
          );
          if (resolved != null) return resolved;
        }
      }
    }
    for (final combiner in ['allOf', 'oneOf', 'anyOf']) {
      if (schema[combiner] case final List<Object?> branches) {
        for (final branch in branches) {
          if (branch is Map) {
            final String? resolved = _commonTypeName(
              branch.cast<String, Object?>(),
              defs,
              visited,
            );
            if (resolved != null) return resolved;
          }
        }
      }
    }
    return null;
  }

  static Map<String, Object?>? _propertySchema(
    Map<String, Object?> schema,
    String key,
    Map<String, Object?> defs,
    Set<String> visited,
  ) {
    if (schema['properties'] case final Map<Object?, Object?> props) {
      if (props[key] case final Map<Object?, Object?> propSchema) {
        return propSchema.cast<String, Object?>();
      }
    }
    if (schema['additionalProperties']
        case final Map<Object?, Object?> addSchema) {
      return addSchema.cast<String, Object?>();
    }
    final ref = schema[r'$ref'] as String?;
    if (ref != null && ref.startsWith('#/\$defs/') && visited.add(ref)) {
      if (defs[ref.substring(8)] case final Map<Object?, Object?> target) {
        final Map<String, Object?>? found = _propertySchema(
          target.cast<String, Object?>(),
          key,
          defs,
          visited,
        );
        if (found != null) return found;
      }
    }
    for (final combiner in ['allOf', 'oneOf', 'anyOf']) {
      if (schema[combiner] case final List<Object?> branches) {
        for (final branch in branches) {
          if (branch is Map) {
            final Map<String, Object?>? found = _propertySchema(
              branch.cast<String, Object?>(),
              key,
              defs,
              visited,
            );
            if (found != null) return found;
          }
        }
      }
    }
    return null;
  }

  static Map<String, Object?>? _itemsSchema(
    Map<String, Object?> schema,
    Map<String, Object?> defs,
    Set<String> visited,
  ) {
    if (schema['items'] case final Map<Object?, Object?> items) {
      return items.cast<String, Object?>();
    }
    final ref = schema[r'$ref'] as String?;
    if (ref != null && ref.startsWith('#/\$defs/') && visited.add(ref)) {
      if (defs[ref.substring(8)] case final Map<Object?, Object?> target) {
        final Map<String, Object?>? found = _itemsSchema(
          target.cast<String, Object?>(),
          defs,
          visited,
        );
        if (found != null) return found;
      }
    }
    for (final combiner in ['allOf', 'oneOf', 'anyOf']) {
      if (schema[combiner] case final List<Object?> branches) {
        for (final branch in branches) {
          if (branch is Map) {
            final Map<String, Object?>? found = _itemsSchema(
              branch.cast<String, Object?>(),
              defs,
              visited,
            );
            if (found != null) return found;
          }
        }
      }
    }
    return null;
  }
}

String _renameKey(String key, bool lower, {bool isComponentRoot = false}) {
  if (isComponentRoot) {
    final String? mixinKey = (lower
        ? _componentMixinKeys
        : _liftedComponentMixinKeys)[key];
    if (mixinKey != null) return mixinKey;
  }
  return (lower ? _reservedKeys : _liftedKeys)[key] ?? key;
}

final Map<String, String> _liftedKeys = {
  for (final MapEntry<String, String> entry in _reservedKeys.entries)
    entry.value: entry.key,
};

final Map<String, String> _liftedComponentMixinKeys = {
  for (final MapEntry<String, String> entry in _componentMixinKeys.entries)
    entry.value: entry.key,
};

/// [parts] in the vocabulary of the suites, with messages lifted to v1.0.
List<Object?> liftParts(
  List<StreamPart> parts, {
  bool join = false,
  String? injectedCatalogId,
  List<CatalogApi> catalogs = const [],
}) => [
  for (final StreamPart part in parts)
    switch (part) {
      TextPart(:final String text) => {'text': text},
      A2uiPart(:final List<AgentToRendererMessage> a2ui) => {
        'a2ui': liftMessages(
          a2ui,
          join: join,
          injectedCatalogId: injectedCatalogId,
          catalogs: catalogs,
        ),
      },
      ErrorPart(:final A2uiError error) => errorPartJson(error),
    },
];

/// Renderer capabilities written against v1.0, lowered to v0.9.
A2uiRendererCapabilities lowerCapabilities(Map<String, Object?> json) =>
    A2uiRendererCapabilities.fromJson({
      for (final MapEntry<String, Object?> entry in json.entries)
        '${swapVersion(entry.key)}': entry.value,
    });

/// Checks the catalog-level assertions of [expected] against [catalog],
/// except its `protocol_version`, which a lowered catalog does not have.
void _expectCatalog(CatalogApi catalog, Map<String, Object?> expected) {
  if (expected['catalog_id'] case final String id) expect(catalog.id, id);
  if (expected['components'] case final List<Object?> names) {
    expect(catalog.components.keys, unorderedEquals(names));
  }
  if (expected['functions'] case final List<Object?> names) {
    expect(catalog.functions.keys, unorderedEquals(names));
  }
}

/// Checks a prompt snippet against `expect_file`, `expect_contains` and
/// `expect_absent`, or the `prompt_snippet_` forms of them, in [expected].
void expectSnippet(String snippet, Map<String, Object?> expected) {
  if (expected['expect_file'] case final String path) {
    expect(snippet, File('$conformanceRoot/$path').readAsStringSync());
  }
  for (final key in ['expect_contains', 'prompt_snippet_contains']) {
    for (final Object? text in expected[key] as List<Object?>? ?? const []) {
      expect(snippet, contains(text));
    }
  }
  for (final key in ['expect_absent', 'prompt_snippet_absent']) {
    for (final Object? text in expected[key] as List<Object?>? ?? const []) {
      expect(snippet, isNot(contains(text)));
    }
  }
}

/// [message] as JSON, less the `sendDataModel: false` a `createSurface`
/// states, which the suites leave out.
Map<String, Object?> messageAsWritten(AgentToRendererMessage message) => {
  for (final MapEntry<String, Object?> entry in message.toJson().entries)
    entry.key: switch (entry.value) {
      final Map<String, Object?> body when entry.key == 'createSurface' => {
        ...body,
      }..removeWhere((key, value) => key == 'sendDataModel' && value == false),
      final Object? value => value,
    },
};

/// [parts] in the vocabulary of the suites, with messages as this SDK writes
/// them; see [messageAsWritten].
List<Object?> partsAsWritten(List<StreamPart> parts) => [
  for (final StreamPart part in parts)
    switch (part) {
      TextPart(:final String text) => {'text': text},
      A2uiPart(:final List<AgentToRendererMessage> a2ui) => {
        'a2ui': a2ui.map(messageAsWritten).toList(),
      },
      ErrorPart(:final A2uiError error) => errorPartJson(error),
    },
];

/// An [ErrorPart] in the vocabulary of the suites: the category of its
/// error.
Map<String, Object?> errorPartJson(A2uiError error) => {
  'error': {
    'category': _errors.entries
        .firstWhere((entry) => entry.value.matches(error, {}))
        .key,
  },
};

/// [expected] with `is_final: true` dropped, since a part is final unless it
/// says otherwise.
Object? withoutFinalFlags(Object? expected) => switch (expected) {
  List<Object?>() => expected.map(withoutFinalFlags).toList(),
  Map<String, Object?>() => {
    for (final MapEntry<String, Object?> entry in expected.entries)
      if (!(entry.key == 'is_final' && entry.value == true))
        entry.key: entry.value,
  },
  _ => expected,
};

/// [part] in the vocabulary of the suites.
Map<String, Object?> rawPartJson(RawResponsePart part) => switch (part) {
  TextPart(:final String text) => {'text': text},
  RawA2uiPart(:final String a2uiRaw, :final bool isFinal) => {
    'a2ui_raw': a2uiRaw,
    if (!isFinal) 'is_final': false,
  },
};

/// The raw parts a `wrap` case supplies.
List<RawResponsePart> rawParts(List<Object?> parts) => [
  for (final Object? part in parts)
    switch (part) {
      {'text': final String text} => TextPart(text),
      {'a2ui_raw': final String raw} => RawA2uiPart(
        raw,
        isFinal: (part as Map)['is_final'] as bool? ?? true,
      ),
      _ => throw ArgumentError.value(part, 'part'),
    },
];

/// Converts YAML nodes into plain Dart maps, lists and scalars.
Object? _plain(Object? node) => switch (node) {
  YamlMap() => {
    for (final MapEntry<Object?, Object?> entry in node.entries)
      entry.key.toString(): _plain(entry.value),
  },
  YamlList() => node.map(_plain).toList(),
  _ => node,
};

/// The `conformance/` directory, found by walking up from the working
/// directory.
final String conformanceRoot = () {
  Directory dir = Directory.current;
  while (!File(
    '${dir.path}/conformance/conformance_schema.json',
  ).existsSync()) {
    if (dir.parent.path == dir.path) {
      throw StateError('No conformance/ directory above ${Directory.current}.');
    }
    dir = dir.parent;
  }
  return '${dir.path}/conformance';
}();

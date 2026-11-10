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

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import '../support/renderer_catalog.dart';
import 'conformance_harness.dart';

const String _suite = 'core/url_security_policy.yaml';

const Map<String, Set<String>> _knownKeys = {
  'case:url_policy_check': {...caseMetadataKeys, 'policy', 'steps'},
  'checkStep': {'url', 'context', 'expect'},
  'policy': {
    'type',
    'media',
    'navigation',
    'iframe',
    'allowRelative',
    'allowSvgDataUrls',
    'rewrite',
  },
  'case:url_policy_resolution': {
    ...caseMetadataKeys,
    'protocolVersion',
    'catalogPaths',
    'catalogs',
    'policy',
    'messages',
    'expect',
    'steps',
  },
  'resolutionStep': {'messages', 'dispatchAction', 'expect'},
  'dispatchAction': {'surfaceId', 'componentId', 'userActivation'},
  'expect': {'components', 'openedUrls', 'errors'},
  'error': {'code', 'surfaceId', 'message'},
};

/// Runs the shared `conformance/core/url_security_policy.yaml` suite against
/// the URL security policies, [MessageProcessor] and [GenericBinder].
void main() {
  final List<ConformanceTestCase> cases = loadConformanceSuite(_suite);

  group('conformance $_suite', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    runConformanceSuite(cases, _runCase, suite: _suite);
  });
}

Future<void> _runCase(ConformanceTestCase testCase) async {
  final action = testCase['action']! as String;
  assertKnownKeys(testCase, _knownKeys['case:$action']!, 'case:$action');
  switch (action) {
    case 'url_policy_check':
      _runCheckCase(testCase);
    case 'url_policy_resolution':
      await _runResolutionCase(testCase);
    default:
      throw StateError('Unsupported action: $action');
  }
}

UrlContext _context(Object? value) =>
    UrlContext.tryParse(value) ?? (throw StateError('Unknown context $value'));

List<String>? _hosts(Object? value) =>
    value == null ? null : [for (final Object? host in value as List) '$host'];

/// Builds the policy a case describes.
UrlSecurityPolicy _buildPolicy(Map<String, Object?> spec) {
  assertKnownKeys(spec, _knownKeys['policy']!, 'policy');
  final bool allowSvg = spec['allowSvgDataUrls'] as bool? ?? false;
  if (spec['type'] == 'permissive') {
    return PermissiveUrlSecurityPolicy(allowSvgDataUrls: allowSvg);
  }
  expect(spec['type'], 'allowlist', reason: 'unknown policy type');
  final rewrite = <UrlContext, UrlRewriteHook>{
    for (final MapEntry<String, Object?> entry
        in ((spec['rewrite'] as Map?)?.cast<String, Object?>() ?? const {})
            .entries)
      _context(entry.key): (url, _, __) {
        // Only absolute http(s) URLs are proxied; others pass unchanged.
        final prefix = (entry.value! as Map)['prefix'] as String;
        return RegExp('^https?://', caseSensitive: false).hasMatch(url)
            ? '$prefix${Uri.encodeComponent(url)}'
            : url;
      },
  };
  return AllowlistUrlSecurityPolicy(
    media: _hosts(spec['media']),
    navigation: _hosts(spec['navigation']),
    iframe: _hosts(spec['iframe']),
    allowRelative: {
      for (final Object? context in spec['allowRelative'] as List? ?? const [])
        _context(context),
    },
    rewrite: rewrite,
    allowSvgDataUrls: allowSvg,
  );
}

/// Runs a `url_policy_check` case through a surface without a catalog, which
/// applies the baseline, the policy, and the baseline again.
void _runCheckCase(ConformanceTestCase testCase) {
  final surface = SurfaceModel<ComponentApi>(
    'check',
    urlSecurityPolicy: _buildPolicy(
      (testCase['policy']! as Map).cast<String, Object?>(),
    ),
  );
  addTearDown(surface.dispose);
  final steps = testCase['steps']! as List<Object?>;
  for (var i = 0; i < steps.length; i++) {
    final Map<String, Object?> step =
        (steps[i]! as Map).cast<String, Object?>();
    assertKnownKeys(step, _knownKeys['checkStep']!, 'steps[$i]');
    final url = step['url']! as String;
    final UrlContext context = _context(step['context']);
    expect(
      surface.sanitizeUrl(url, context),
      step['expect'],
      reason: '${testCase['name']}.steps[$i]: "$url" as ${context.jsonValue}',
    );
  }
}

/// The catalogs a resolution case loads: this SDK's basic catalog for the
/// published v1.0 basic catalog, and the document's signatures otherwise.
List<Catalog<ComponentApi, FunctionImplementation>> _catalogs(
  ConformanceTestCase testCase,
) {
  final String version = testCase['protocolVersion'] as String? ?? '1.0';
  return [
    for (final Map<String, Object?> document in [
      for (final Object? path in testCase['catalogPaths'] as List? ?? const [])
        readConformanceJson(path! as String),
      for (final Object? inline in testCase['catalogs'] as List? ?? const [])
        (inline! as Map).cast<String, Object?>(),
    ])
      document['catalogId'] == BasicCatalog.v1_0Id
          ? BasicCatalog.v1_0()
          : rendererCatalog(document, protocolVersion: version),
  ];
}

/// Copies resolved props as JSON, unwrapping bindings and dropping
/// closures.
Object? _toJson(Object? value) => switch (value) {
      ResolvedBinding(:final Object? value) => _toJson(value),
      Map() => <String, Object?>{
          for (final MapEntry<Object?, Object?> entry in value.entries)
            if (entry.value is! Function) '${entry.key}': _toJson(entry.value),
        },
      List() => [for (final Object? item in value) _toJson(item)],
      _ => value,
    };

/// Checks [actual] against [expected]: null matches an absent or null value
/// at any depth, objects check only the keys [expected] names, and
/// everything else compares as JSON.
void _expectMatches(Object? actual, Object? expected, String where) {
  if (expected == null) {
    expect(actual, isNull, reason: where);
  } else if (expected is List) {
    expect(actual, isA<List<Object?>>(), reason: where);
    final list = actual! as List<Object?>;
    expect(list, hasLength(expected.length), reason: '$where length');
    for (var i = 0; i < expected.length; i++) {
      _expectMatches(list[i], expected[i], '$where[$i]');
    }
  } else if (expected is Map) {
    expect(actual, isA<Map<String, Object?>>(), reason: where);
    final map = actual! as Map<String, Object?>;
    for (final MapEntry<Object?, Object?> entry in expected.entries) {
      _expectMatches(map[entry.key], entry.value, '$where.${entry.key}');
    }
  } else {
    expect(actual, expected, reason: where);
  }
}

/// Runs a `url_policy_resolution` case through a [MessageProcessor] and a
/// [GenericBinder] per checked component.
Future<void> _runResolutionCase(ConformanceTestCase testCase) async {
  final name = testCase['name']! as String;
  final openedUrls = <String>[];
  final errors = <A2uiRendererError>[];
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogs(testCase),
    urlSecurityPolicy: _buildPolicy(
      (testCase['policy']! as Map).cast<String, Object?>(),
    ),
    openUrlHandler: (url) => openedUrls.add('$url'),
    onError: errors.add,
  );
  addTearDown(processor.dispose);
  final binders = <String, GenericBinder>{};
  addTearDown(() {
    for (final GenericBinder binder in binders.values) {
      binder.dispose();
    }
  });

  SurfaceModel<ComponentApi> surfaceFor(String componentId) {
    for (final SurfaceModel<ComponentApi> surface
        in processor.model.allSurfaces) {
      if (surface.componentsModel.get(componentId) != null) return surface;
    }
    fail("$name: no surface has component '$componentId'");
  }

  Object? propsOf(String componentId) {
    final GenericBinder binder = binders.putIfAbsent(componentId, () {
      final SurfaceModel<ComponentApi> surface = surfaceFor(componentId);
      final ComponentModel model = surface.componentsModel.get(componentId)!;
      final ComponentApi api =
          surface.resolveCatalog(model.catalog).components[model.type]!;
      return GenericBinder(ComponentContext(surface, model), api.schema);
    });
    return _toJson(binder.resolvedProps.value);
  }

  void check(Object? rawExpect, String where, {required bool afterAction}) {
    final Map<String, Object?> expectBlock =
        (rawExpect! as Map).cast<String, Object?>();
    assertKnownKeys(expectBlock, _knownKeys['expect']!, where);
    final Map<String, Object?> components =
        (expectBlock['components'] as Map?)?.cast<String, Object?>() ??
            const {};
    for (final MapEntry<String, Object?> entry in components.entries) {
      _expectMatches(
        propsOf(entry.key),
        entry.value,
        '$where.components.${entry.key}',
      );
    }
    if (!afterAction) {
      expect(
        expectBlock.containsKey('openedUrls') ||
            expectBlock.containsKey('errors'),
        isFalse,
        reason: '$where: openedUrls and errors are only checked after '
            'dispatchAction',
      );
      return;
    }
    expect(openedUrls, expectBlock['openedUrls'] ?? const [], reason: where);
    final List<Object?> expectedErrors =
        expectBlock['errors'] as List? ?? const [];
    expect(
      errors,
      hasLength(expectedErrors.length),
      reason: '$where.errors: ${errors.map((e) => e.code).toList()}',
    );
    for (var i = 0; i < expectedErrors.length; i++) {
      final Map<String, Object?> expected =
          (expectedErrors[i]! as Map).cast<String, Object?>();
      assertKnownKeys(expected, _knownKeys['error']!, '$where.errors[$i]');
      if (expected['code'] case final String code) {
        expect(errors[i].code, code, reason: '$where.errors[$i].code');
      }
      if (expected['surfaceId'] case final String surfaceId) {
        expect(errors[i].surfaceId, surfaceId, reason: '$where.errors[$i]');
      }
      if (expected['message'] case final String pattern) {
        expect(errors[i].message, matches(RegExp(pattern)));
      }
    }
  }

  // Errors and warnings are delivered in a microtask.
  Future<void> flush() => Future<void>.delayed(Duration.zero);

  processor.processMessages(testCase['messages']);
  await flush();
  check(testCase['expect'], '$name.expect', afterAction: false);

  final List<Object?> steps = testCase['steps'] as List? ?? const [];
  for (var i = 0; i < steps.length; i++) {
    final where = '$name.steps[$i]';
    final Map<String, Object?> step =
        (steps[i]! as Map).cast<String, Object?>();
    assertKnownKeys(step, _knownKeys['resolutionStep']!, where);
    expect(
      step.containsKey('messages') != step.containsKey('dispatchAction'),
      isTrue,
      reason: '$where: a step has exactly one of messages and dispatchAction',
    );
    openedUrls.clear();
    errors.clear();
    if (step['messages'] case final Object messages) {
      processor.processMessages(messages);
      await flush();
      check(step['expect'], '$where.expect', afterAction: false);
      continue;
    }
    final Map<String, Object?> dispatch =
        (step['dispatchAction']! as Map).cast<String, Object?>();
    assertKnownKeys(dispatch, _knownKeys['dispatchAction']!, where);
    final surfaceId = dispatch['surfaceId']! as String;
    final componentId = dispatch['componentId']! as String;
    final SurfaceModel<ComponentApi>? surface =
        processor.model.getSurface(surfaceId);
    expect(surface, isNotNull, reason: "$where: no surface '$surfaceId'");
    final context = ComponentContext(
      surface!,
      surface.componentsModel.get(componentId)!,
    );
    final Object? action = context.componentModel.properties['action'];
    if (dispatch['userActivation'] as bool? ?? true) {
      final binder = GenericBinder(
        context,
        surface
            .resolveCatalog(context.componentModel.catalog)
            .components[context.componentModel.type]!
            .schema,
      );
      addTearDown(binder.dispose);
      final callback = binder.resolvedProps.value['action'] as NodeAction;
      await callback();
    } else if (action is Map && action['functionCall'] is Map) {
      await context.dataContext.evaluateFunctionCall(
        (action['functionCall']! as Map).cast<String, Object?>(),
      );
    }
    await flush();
    check(step['expect'], '$where.expect', afterAction: true);
  }
}

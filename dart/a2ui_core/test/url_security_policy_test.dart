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
import 'package:test/test.dart';

/// Completes after the microtask that delivers errors and warnings.
Future<void> _flush() => Future<void>.delayed(Duration.zero);

const String _productCatalogId = 'https://example.com/catalogs/product.json';

/// A v1.0 catalog with a `ProductCard` whose URL props use [UrlSchema].
Catalog<ComponentApi, FunctionImplementation> _productCatalog() =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: _productCatalogId,
      protocolVersion: A2uiProtocolVersion.v1_0,
      components: [
        ComponentApi(
          name: 'ProductCard',
          schema: Schema.object(
            properties: {
              'component': Schema.fromMap({'const': 'ProductCard'}),
              'title': CommonSchemasV1.dynamicString,
              'imageUrl': UrlSchema.media(description: 'Product photo.'),
              'pageUrl': UrlSchema.navigation(),
              'tileUrl': CommonSchemasV1.dynamicString,
            },
            required: ['component'],
          ),
        ),
      ],
    );

/// Resolves the props of component [id] on [surface].
Map<String, Object?> _props(SurfaceModel<ComponentApi> surface, String id) {
  final ComponentModel model = surface.componentsModel.get(id)!;
  final binder = GenericBinder(
    ComponentContext(surface, model),
    surface.resolveCatalog(model.catalog).components[model.type]!.schema,
  );
  addTearDown(binder.dispose);
  return {
    for (final MapEntry<String, dynamic> entry
        in binder.resolvedProps.value.entries)
      entry.key: entry.value is ResolvedBinding
          ? (entry.value as ResolvedBinding).value
          : entry.value,
  };
}

void main() {
  group('baseline', () {
    test('blocks http(s) URLs with a port above 65535', () {
      final surface = SurfaceModel<ComponentApi>('s');
      addTearDown(surface.dispose);
      expect(
        surface.sanitizeUrl(
            'https://cdn.example.com:65535/a.png', UrlContext.media),
        'https://cdn.example.com:65535/a.png',
      );
      expect(
        surface.sanitizeUrl(
            'https://cdn.example.com:65536/a.png', UrlContext.media),
        isNull,
      );
    });
  });

  group('AllowlistUrlSecurityPolicy', () {
    test('rejects host entries that are not hosts', () {
      for (final entry in ['https://cdn.example.com', 'a/b', '*', 'a@b', '']) {
        expect(
          () => AllowlistUrlSecurityPolicy(media: [entry]),
          throwsArgumentError,
          reason: entry,
        );
      }
    });

    test('passes the context and info to the rewrite hook', () {
      final seen = <(UrlContext, UrlCheckInfo?)>[];
      final policy = AllowlistUrlSecurityPolicy(
        rewrite: {
          UrlContext.media: (url, context, info) {
            seen.add((context, info));
            return url;
          },
        },
      );
      const info = UrlCheckInfo(propertyName: 'url');
      policy.sanitizeUrl('https://a.example/x.png', UrlContext.media,
          info: info);
      expect(seen, [(UrlContext.media, info)]);
    });
  });

  group('SurfaceModel.sanitizeUrl', () {
    test('defaults to the permissive policy', () {
      final surface = SurfaceModel<ComponentApi>('s');
      addTearDown(surface.dispose);
      expect(surface.urlSecurityPolicy, isA<PermissiveUrlSecurityPolicy>());
      expect(
        surface.sanitizeUrl('https://any.example/a.png', UrlContext.media),
        'https://any.example/a.png',
      );
      expect(
          surface.sanitizeUrl('javascript:x', UrlContext.navigation), isNull);
    });

    test('blocks a URL when the policy throws', () {
      final surface = SurfaceModel<ComponentApi>(
        's',
        urlSecurityPolicy: _ThrowingPolicy(),
      );
      addTearDown(surface.dispose);
      expect(
          surface.sanitizeUrl('https://a.example/', UrlContext.media), isNull);
    });

    test('reports a blocked URL once, redacted', () async {
      final surface = SurfaceModel<ComponentApi>(
        's',
        urlSecurityPolicy: AllowlistUrlSecurityPolicy(media: []),
      );
      addTearDown(surface.dispose);
      final warnings = <A2uiWarning>[];
      surface.onWarning.subscribe(warnings.add);
      const info = UrlCheckInfo(componentId: 'img', propertyName: 'url');
      const url = 'https://evil.example:8443/collect?d=secret#frag';
      surface.sanitizeUrl(url, UrlContext.media, info: info);
      surface.sanitizeUrl(url, UrlContext.media, info: info);
      await _flush();

      expect(warnings, hasLength(1));
      final A2uiWarning warning = warnings.single;
      expect(warning.code, 'URL_BLOCKED');
      expect(warning.surfaceId, 's');
      expect(warning.message, isNot(contains('secret')));
      expect(warning.details, {
        'surfaceId': 's',
        'componentId': 'img',
        'propertyName': 'url',
        'redactedUrl': 'https://evil.example:8443',
        'context': 'media',
      });
    });

    test('redacts data, relative and host-less URLs', () async {
      final surface = SurfaceModel<ComponentApi>('s');
      addTearDown(surface.dispose);
      final redacted = <Object?>[];
      surface.onWarning
          .subscribe((w) => redacted.add(w.details!['redactedUrl']));
      surface.sanitizeUrl('data:text/html;base64,PHA+', UrlContext.media);
      surface.sanitizeUrl('/a?d=secret', UrlContext.iframe);
      surface.sanitizeUrl('https:evil.example/?d=secret', UrlContext.media);
      surface.sanitizeUrl('javascript:alert(1)', UrlContext.navigation);
      await _flush();
      expect(redacted, ['data:text/html', 'relative', 'https:', 'javascript:']);
    });
  });

  group('contexts', () {
    test('a DataContext without a sanitizer applies the baseline', () {
      final context = DataContext(DataModel(), (_, __, ___) => null, '/');
      expect(
        context.sanitizeUrl('https://a.example/', UrlContext.iframe),
        'https://a.example/',
      );
      expect(context.sanitizeUrl('/x', UrlContext.iframe), isNull);
    });

    test('ComponentContext.sanitizeUrl fills in where the URL comes from', () {
      final infos = <UrlCheckInfo?>[];
      final surface = SurfaceModel<ComponentApi>(
        's',
        defaultCatalog: _productCatalog(),
        protocolVersion: '1.0',
        urlSecurityPolicy: _RecordingPolicy(infos),
      );
      addTearDown(surface.dispose);
      final model = ComponentModel('card', 'ProductCard', {});
      surface.componentsModel.addComponent(model);
      ComponentContext(surface, model).sanitizeUrl(
        'https://a.example/',
        UrlContext.media,
        info: const UrlCheckInfo(propertyName: 'markdown'),
      );
      expect(infos.single!.toJson(), {
        'surfaceId': 's',
        'catalogId': _productCatalogId,
        'componentType': 'ProductCard',
        'componentId': 'card',
        'propertyName': 'markdown',
      });
    });
  });

  group('URL properties', () {
    test('UrlSchema marks the property in the catalog document', () {
      final Map<String, Object?> document = _productCatalog().toJson();
      final properties = ((document['components']! as Map)['ProductCard']!
          as Map)['properties']! as Map;
      expect(properties['imageUrl'], {
        r'$ref': r'common_types.json#/$defs/DynamicString',
        'description': 'Product photo.',
        urlContextKeyword: 'media',
      });
      expect(
        (properties['pageUrl']! as Map)[urlContextKeyword],
        'navigation',
      );
      final CatalogApi read = Catalog.fromJson(document);
      expect(
        read.components['ProductCard']!.schema.value['properties'],
        containsPair('imageUrl', containsPair(urlContextKeyword, 'media')),
      );
    });

    test('the resolver filters annotated props and host-listed props', () {
      final surface = SurfaceModel<ComponentApi>(
        's',
        defaultCatalog: _productCatalog(),
        protocolVersion: '1.0',
        urlSecurityPolicy: AllowlistUrlSecurityPolicy(
          media: ['cdn.example.com'],
          navigation: ['*.example.com'],
          urlProperties: {
            _productCatalogId: {
              'ProductCard': {'tileUrl': UrlContext.media, 'pageUrl': null},
            },
          },
        ),
      );
      addTearDown(surface.dispose);
      surface.componentsModel.addComponent(
        ComponentModel('card', 'ProductCard', {
          'title': 'javascript:alert(1)',
          'imageUrl': 'https://evil.example/a.png',
          'pageUrl': 'https://evil.example/p',
          'tileUrl': 'https://evil.example/t.png',
        }),
      );
      final Map<String, Object?> props = _props(surface, 'card');
      expect(props['title'], 'javascript:alert(1)');
      expect(props['imageUrl'], isNull);
      // The host's map wins over the schema, and null means "not a URL".
      expect(props['pageUrl'], 'https://evil.example/p');
      expect(props['tileUrl'], isNull);
    });

    test('a non-string value of a URL prop resolves to null', () {
      final surface = SurfaceModel<ComponentApi>(
        's',
        defaultCatalog: _productCatalog(),
        protocolVersion: '1.0',
      );
      addTearDown(surface.dispose);
      surface.dataModel.set('/photo', 42);
      surface.componentsModel.addComponent(
        ComponentModel('card', 'ProductCard', {
          'imageUrl': {'@path': '/photo'},
        }),
      );
      expect(_props(surface, 'card')['imageUrl'], isNull);
    });
  });

  group('MessageProcessor', () {
    Map<String, Object?> createV09(Map<String, Object?> theme) => {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 'main',
            'catalogId': BasicCatalog.v0_9Id,
            'theme': theme,
          },
        };

    test('removes a blocked theme iconUrl and reports it', () async {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [BasicCatalog.v0_9()],
        urlSecurityPolicy: AllowlistUrlSecurityPolicy(media: []),
      );
      addTearDown(processor.dispose);
      final warnings = <A2uiWarning>[];
      processor.model.onSurfaceCreated.subscribe(
        (surface) => surface.onWarning.subscribe(warnings.add),
      );
      processor.processMessages(
        createV09({
          'primaryColor': '#FF0000',
          'iconUrl': 'https://evil.example/i.png?d=secret',
        }),
      );
      await _flush();
      expect(processor.model.getSurface('main')!.theme, {
        'primaryColor': '#FF0000',
      });
      expect(warnings.single.details,
          containsPair('propertyName', 'theme.iconUrl'));
    });

    test('replaces a rewritten theme iconUrl', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [BasicCatalog.v0_9()],
        urlSecurityPolicy: AllowlistUrlSecurityPolicy(
          rewrite: {
            UrlContext.media: (url, _, __) =>
                'https://proxy.example.com/?u=${Uri.encodeComponent(url)}',
          },
        ),
      );
      addTearDown(processor.dispose);
      processor.processMessages(
        createV09({'iconUrl': 'https://cdn.example.com/i.png'}),
      );
      expect(
        processor.model.getSurface('main')!.theme['iconUrl'],
        'https://proxy.example.com/?u=https%3A%2F%2Fcdn.example.com%2Fi.png',
      );
    });

    test('openUrlHandler takes the place of the catalog callback', () async {
      final fromProcessor = <Uri>[];
      final fromCatalog = <Uri>[];
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [BasicCatalog.v1_0(openUrl: fromCatalog.add)],
        openUrlHandler: fromProcessor.add,
      );
      addTearDown(processor.dispose);
      processor.processMessages({
        'version': '1.0',
        'createSurface': {
          'surfaceId': 'main',
          'catalogId': BasicCatalog.v1_0Id,
          'components': [
            {
              'id': 'root',
              'component': 'Button',
              'child': 'label',
              'action': {
                'functionCall': {
                  '@call': 'openUrl',
                  'args': {'url': 'https://example.com/'},
                },
              },
            },
            {'id': 'label', 'component': 'Text', 'text': 'Open'},
          ],
        },
      });
      final SurfaceModel<ComponentApi> surface =
          processor.model.getSurface('main')!;
      final binder = GenericBinder(
        ComponentContext(surface, surface.componentsModel.get('root')!),
        surface.defaultCatalog!.components['Button']!.schema,
      );
      addTearDown(binder.dispose);
      await (binder.resolvedProps.value['action'] as NodeAction)();
      expect(fromProcessor, [Uri.parse('https://example.com/')]);
      expect(fromCatalog, isEmpty);
    });
  });
}

class _ThrowingPolicy extends UrlSecurityPolicy {
  @override
  String? sanitizeUrl(String url, UrlContext context, {UrlCheckInfo? info}) =>
      throw StateError('policy failed');
}

class _RecordingPolicy extends UrlSecurityPolicy {
  _RecordingPolicy(this.infos);

  final List<UrlCheckInfo?> infos;

  @override
  String? sanitizeUrl(String url, UrlContext context, {UrlCheckInfo? info}) {
    infos.add(info);
    return url;
  }
}

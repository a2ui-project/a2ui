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

import '../core/common_schemas.dart';
import 'url_security_policy.dart';

/// The catalog JSON Schema keyword that marks a property as a URL.
const String urlContextKeyword = 'x-a2ui-url-context';

/// Schema helpers that mark a catalog property as a URL.
///
/// The resolver checks every value it resolves for such a property against
/// the surface's URL security policy, so the component receives only allowed
/// (or rewritten) URLs, or null when blocked. The catalog document writes the
/// property as its base type plus `"x-a2ui-url-context"`.
///
/// ```dart
/// final productCard = ComponentApi(
///   name: 'ProductCard',
///   schema: Schema.object(
///     properties: {
///       'title': CommonSchemasV1.dynamicString,
///       'imageUrl': UrlSchema.media(description: 'Product photo.'),
///       'productPageUrl': UrlSchema.navigation(
///         description: 'Opened when the card is tapped.',
///       ),
///     },
///   ),
/// );
/// ```
abstract final class UrlSchema {
  /// A property holding a URL the renderer loads automatically, such as an
  /// image or video source.
  ///
  /// [base] is the schema of the property's values, the v1.0
  /// `DynamicString` by default; pass [CommonSchemas.dynamicString] for a
  /// v0.9 catalog.
  static Schema media({String? description, Schema? base}) =>
      _mark(UrlContext.media, description, base);

  /// A property holding a URL the renderer opens when the user acts, such as
  /// a link target. See [media] for [base].
  static Schema navigation({String? description, Schema? base}) =>
      _mark(UrlContext.navigation, description, base);

  /// A property holding a URL the renderer embeds in a frame. See [media]
  /// for [base].
  static Schema iframe({String? description, Schema? base}) =>
      _mark(UrlContext.iframe, description, base);

  static Schema _mark(UrlContext context, String? description, Schema? base) =>
      Schema.fromMap(<String, Object?>{
        ...(base ?? CommonSchemasV1.dynamicString).value,
        if (description != null) 'description': description,
        urlContextKeyword: context.jsonValue,
      });
}

/// The URL annotation of a schema node: [UrlContext] for a URL, null with
/// `declared` for `"none"`, and `declared` false when the node says nothing.
///
/// Package-internal.
({bool declared, UrlContext? context}) urlAnnotationOf(Object? node) {
  if (node is! Map || !node.containsKey(urlContextKeyword)) {
    return (declared: false, context: null);
  }
  final Object? value = node[urlContextKeyword];
  final UrlContext? context = UrlContext.tryParse(value);
  // An unknown value is ignored rather than guessed at.
  return (declared: context != null || value == 'none', context: context);
}

/// URL properties of the basic catalogs, whose published documents carry no
/// `x-a2ui-url-context` annotations.
///
/// Package-internal.
const Map<String, Map<String, UrlContext>> basicComponentUrlProperties = {
  'Image': {'url': UrlContext.media},
  'Video': {'url': UrlContext.media, 'posterUrl': UrlContext.media},
  'AudioPlayer': {'url': UrlContext.media},
};

/// Identifiers of the basic catalogs, which share the theme's `iconUrl`.
///
/// Package-internal.
const Set<String> basicCatalogIds = {
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
};

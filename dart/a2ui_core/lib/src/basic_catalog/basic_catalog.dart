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

import '../core/catalog.dart';
import '../core/validation_result.dart';
import 'function_support.dart';
import 'locale_formatting.dart';
import 'v0_9/functions.dart';
import 'v1_0/functions.dart';

export 'function_support.dart' show OpenUrlCallback;

/// The A2UI basic catalog, with evaluable functions, for each protocol
/// version.
///
/// Each catalog carries the 14 functions of the published catalog document:
/// the validation rules `required`, `regex`, `length`, `numeric` and
/// `email`; the formatters `formatString`, `formatNumber`,
/// `formatCurrency`, `formatDate` and `pluralize`; `openUrl`; and the logic
/// functions `and`, `or` and `not`. It has no components yet.
///
/// Formatting follows the BCP 47 `locale` tag, `en-US` by default; an
/// unknown tag falls back to `en-US`. `openUrl` passes validated URLs to
/// the `openUrl` callback and fails without one, which a binder reports as
/// an `EXECUTION_ERROR`.
abstract final class BasicCatalog {
  /// The id of the v0.9 basic catalog.
  static const String v0_9Id =
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

  /// The id of the v1.0 basic catalog.
  static const String v1_0Id =
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

  /// The v0.9 basic catalog, whose validation rules return `bool`.
  static Catalog<ComponentApi, FunctionImplementation> v0_9({
    String locale = defaultBasicCatalogLocale,
    OpenUrlCallback? openUrl,
  }) =>
      Catalog(
        id: v0_9Id,
        schemaId: v0_9Id,
        title: 'A2UI Basic Catalog',
        components: const [],
        functions: basicFunctionsV0_9(locale: locale, openUrl: openUrl),
      );

  /// The v1.0 basic catalog, whose validation rules return a
  /// [ValidationResult].
  static Catalog<ComponentApi, FunctionImplementation> v1_0({
    String locale = defaultBasicCatalogLocale,
    OpenUrlCallback? openUrl,
  }) =>
      Catalog(
        id: v1_0Id,
        schemaId: v1_0Id,
        title: 'A2UI Basic Catalog',
        components: const [],
        functions: basicFunctionsV1_0(locale: locale, openUrl: openUrl),
      );
}

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

import '../../core/catalog.dart';
import '../../core/validation_result.dart';
import '../function_support.dart';
import '../locale_formatting.dart';
import 'catalog.g.dart';

/// The published v1.0 basic catalog, read through [Catalog.fromJson].
///
/// The function signatures come from this document rather than from a
/// hand-written copy, so every argument schema and return type is the
/// published one, and `tool/generate_basic_catalogs.dart` refreshes it.
///
/// Parsed on each call, so each catalog owns its schemas and a caller that
/// edits one cannot change another.
CatalogApi publishedBasicCatalogV1_0() => Catalog.fromJson(
      jsonDecode(basicCatalogV1_0Json) as Map<String, Object?>,
    );

/// The behaviour of the v1.0 basic catalog functions, formatting for
/// [locale].
///
/// Validation rules return a [ValidationResult] whose message explains a
/// failure, and `and`, `or` and `not` read such a result, or a map carrying
/// a `valid` key, by its validity. `openUrl` hands validated URLs to
/// [openUrl] and fails without one.
Map<String, BasicFunctionBody> basicFunctionBodiesV1_0({
  String locale = defaultBasicCatalogLocale,
  OpenUrlCallback? openUrl,
}) {
  final String intlLocale = resolveIntlLocale(locale);
  return basicFunctionBodies(
    validator: (result) => result,
    truthy: isTruthyOrValid,
    formatNumber: (value, args) => formatNumber(
      value,
      decimals: args['decimals'],
      grouping: args['grouping'],
      locale: intlLocale,
    ),
    formatCurrency: (value, args) => formatCurrency(
      value,
      currency: args['currency'],
      decimals: args['decimals'],
      grouping: args['grouping'],
      locale: intlLocale,
    ),
    formatDate: (value, args) =>
        formatDate(value, pattern: args['format'], locale: intlLocale),
    pluralize: (value, args) => pluralize(value, args, locale: intlLocale),
    onOpenUrl: openUrl,
  );
}

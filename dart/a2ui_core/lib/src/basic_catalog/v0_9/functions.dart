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

import '../../core/catalog.dart';
import '../function_support.dart';
import '../locale_formatting.dart';

/// The functions of the v0.9 basic catalog, formatting for [locale].
///
/// Validation rules return `bool`.
/// `openUrl` hands validated URLs to [openUrl] and fails without one.
List<FunctionImplementation> basicFunctionsV0_9({
  String locale = defaultBasicCatalogLocale,
  OpenUrlCallback? openUrl,
}) {
  final String intlLocale = resolveIntlLocale(locale);
  return buildBasicFunctions(
    schemas: const BasicArgumentSchemas(v10: false),
    validatorReturnType: A2uiReturnType.boolean,
    validator: (result) => result.valid,
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

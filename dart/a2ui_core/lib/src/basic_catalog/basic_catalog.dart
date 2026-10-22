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

import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;

import '../core/catalog.dart';
import '../core/validation_result.dart';
import '../primitives/cancellation.dart';
import '../resolution/data_context.dart';
import 'function_support.dart';
import 'locale_formatting.dart';
import 'v0_9/catalog.g.dart';
import 'v0_9/functions.dart';
import 'v1_0/catalog.g.dart';
import 'v1_0/functions.dart';

export 'function_support.dart' show OpenUrlCallback;

/// The A2UI basic catalog, with evaluable functions, for each protocol
/// version.
///
/// Each catalog is defined in code: its components, function signatures,
/// theme and shared definitions are generated from the published catalog
/// document (`specification/v0_9/catalogs/basic/catalog.json` and
/// `catalogs/basic/v1/catalog.json`) by `tool/generate_basic_catalogs.dart`,
/// so [Catalog.toJson] writes the published document.
///
/// Each catalog carries the 14 functions of the published document: the
/// validation rules `required`, `regex`, `length`, `numeric` and `email`;
/// the formatters `formatString`, `formatNumber`, `formatCurrency`,
/// `formatDate` and `pluralize`; `openUrl`; and the logic functions `and`,
/// `or` and `not`.
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
      basicCatalogV0_9(
        _implement(
          v0_9Id,
          basicFunctionSignaturesV0_9(),
          basicFunctionBodiesV0_9(locale: locale, openUrl: openUrl),
        ),
      );

  /// The v1.0 basic catalog, whose validation rules return a
  /// [ValidationResult].
  static Catalog<ComponentApi, FunctionImplementation> v1_0({
    String locale = defaultBasicCatalogLocale,
    OpenUrlCallback? openUrl,
  }) =>
      basicCatalogV1_0(
        _implement(
          v1_0Id,
          basicFunctionSignaturesV1_0(),
          basicFunctionBodiesV1_0(locale: locale, openUrl: openUrl),
        ),
      );

  /// Each of [signatures] evaluated by its entry in [bodies].
  ///
  /// Throws [StateError] when [signatures] and [bodies] do not name the same
  /// functions, so a change to either cannot go unnoticed.
  static List<FunctionImplementation> _implement(
    String catalogId,
    List<FunctionApi> signatures,
    Map<String, BasicFunctionBody> bodies,
  ) {
    final Set<String> names = {for (final s in signatures) s.name};
    final Set<String> unimplemented = names.difference(bodies.keys.toSet());
    final Set<String> unpublished = bodies.keys.toSet().difference(names);
    if (unimplemented.isNotEmpty || unpublished.isNotEmpty) {
      throw StateError(
        'Basic catalog $catalogId: functions without an implementation '
        '$unimplemented, implementations the document does not declare '
        '$unpublished.',
      );
    }
    return [
      for (final FunctionApi signature in signatures)
        BasicFunction(
          name: signature.name,
          argumentSchema: signature.argumentSchema,
          returnType: signature.returnType,
          description: signature.description,
          allowedCallers: signature.declaredAllowedCallers,
          requiresUserActivation: signature.declaredRequiresUserActivation,
          body: bodies[signature.name]!,
        ),
    ];
  }
}

/// The basic catalog's `formatString` function on its own, for catalogs that
/// want template interpolation without the rest of the basic catalog.
///
/// Delegates to the same implementation as [BasicCatalog]: a non-string
/// `value` is coerced to text, and on a v1.0 context the template's bindings
/// and calls resolve in their `@path`/`@call` form.
class FormatStringFunction extends FunctionImplementation {
  FormatStringFunction()
      : super(
          name: 'formatString',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {
              'value': Schema.string(
                description: 'The string template to interpolate.',
              ),
            },
            required: ['value'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      formatTemplate(args['value'], context);
}

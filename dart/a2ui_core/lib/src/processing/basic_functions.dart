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

import '../basic_catalog/function_support.dart';
import '../core/catalog.dart';
import '../core/contexts.dart';
import '../primitives/cancellation.dart';

/// The basic catalog's `formatString` function on its own, for catalogs that
/// want template interpolation without the rest of the basic catalog.
///
/// Delegates to the same implementation as `BasicCatalog`: a non-string
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

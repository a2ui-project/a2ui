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

import '../../inference_format.dart';
import '../../parser/parser.dart';
import '../../prompt/generator.dart';
import 'parser.dart';
import 'prompt_generator.dart';

/// The Express format: a compact DSL enclosed in `<a2ui>` tags, compiled into
/// A2UI messages after the response is complete.
///
/// See `specification/proposals/express/`.
///
/// The SDK calls [createFormat] with the catalogs of each request, so the
/// options of the format are given here and passed on to every format created.
class ExpressFormatFactory extends InferenceFormatFactory {
  const ExpressFormatFactory({this.allowedMessages});

  /// The message types the model may write, such as `createSurface`, or null
  /// for all of them. The prompt describes only the statements that compile
  /// to these types.
  final List<String>? allowedMessages;

  @override
  InferenceFormat createFormat(
    List<CatalogApi> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
  }) => ExpressFormat._(
    List.unmodifiable(catalogs),
    List.unmodifiable(examples),
    allowedMessages == null ? null : List.unmodifiable(allowedMessages!),
  );
}

/// The Express format bound to the catalogs of one request.
///
/// The first catalog is the default for a surface that does not name one.
class ExpressFormat extends InferenceFormat {
  ExpressFormat._(this._catalogs, this._examples, this._allowedMessages);

  final List<CatalogApi> _catalogs;
  final List<List<AgentToRendererMessage>> _examples;
  final List<String>? _allowedMessages;

  @override
  late final PromptGenerator promptGenerator = ExpressPromptGenerator(
    _catalogs,
    examples: _examples,
    allowedMessages: _allowedMessages,
  );

  @override
  Parser createParser() => ExpressParser(_catalogs);
}

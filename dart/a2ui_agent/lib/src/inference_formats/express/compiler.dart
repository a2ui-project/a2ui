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

/// Lexes and parses `<a2ui-express>` DSL expressions into A2UI messages.
///
/// The Express grammar is defined by
/// `specification/inference_formats/express/Express.g4`.
class ExpressCompiler<C extends ComponentApi, F extends FunctionApi> {
  /// The active catalogs used to resolve component and function signatures.
  final List<Catalog<C, F>> catalogs;

  ExpressCompiler({required this.catalogs});

  /// Compiles an Express DSL string into A2UI messages.
  ///
  /// Throws [A2uiCompileError] if [source] is malformed, and
  /// [A2uiValidationError] if it names components or functions the catalogs
  /// do not declare.
  List<A2uiMessage> compile(String source) {
    throw UnimplementedError('ExpressCompiler.compile');
  }
}

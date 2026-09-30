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

/// Writes v0.9 messages in Express notation: the inverse of the compiler.
///
/// Positional arguments follow the property order the catalogs declare, so
/// the decompiler needs the same catalogs the compiler reads with.
class ExpressDecompiler {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ExpressDecompiler(this.catalogs);

  final List<SchemaCatalog> catalogs;

  /// Writes [messages] as the content of one `<a2ui>` block, without the
  /// tags.
  ///
  /// Throws [A2uiValidationError] if a message has no Express notation.
  String decompile(List<AgentToRendererMessage> messages) =>
      throw UnimplementedError('ExpressDecompiler.decompile');
}

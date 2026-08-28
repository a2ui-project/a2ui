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

/// Converts A2UI messages back into Express DSL notation.
class ExpressDecompiler<C extends ComponentApi, F extends FunctionApi> {
  /// The active catalogs used to resolve positional argument order.
  final List<Catalog<C, F>> catalogs;

  ExpressDecompiler({required this.catalogs});

  /// Decompiles [a2uiPayload] into an Express DSL string.
  String decompile(List<A2uiMessage> a2uiPayload) {
    throw UnimplementedError('ExpressDecompiler.decompile');
  }
}

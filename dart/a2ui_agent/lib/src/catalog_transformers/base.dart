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

/// A rule applied to a catalog before prompting or validation.
///
/// Transformers narrow a catalog; they never widen it.
abstract class CatalogTransformer<
  C extends ComponentApi,
  F extends FunctionApi
> {
  const CatalogTransformer();

  /// Narrows [catalog], preserving its component and function types.
  Catalog<C, F> transform(Catalog<C, F> catalog);
}

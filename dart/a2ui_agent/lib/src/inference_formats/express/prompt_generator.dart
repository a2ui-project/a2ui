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

import '../../prompt/generator.dart';

/// Renders system instructions for the EXPRESS format.
///
/// Describes catalog components and functions as compact positional
/// signatures, which costs far fewer output tokens than the JSON schemas the
/// DIRECT_JSON generator emits.
class ExpressPromptGenerator<C extends ComponentApi, F extends FunctionApi>
    extends PromptGenerator<C, F> {
  ExpressPromptGenerator(super.catalogs, {super.examples});

  @override
  String generate() {
    throw UnimplementedError('ExpressPromptGenerator.generate');
  }
}

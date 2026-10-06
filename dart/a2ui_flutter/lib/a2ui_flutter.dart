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

/// The generative UI framework (GenUI) for Flutter and Dart.
///
/// This library provides the necessary components to build generative user
/// interfaces in Flutter applications. It implements the A2UI protocol
/// (https://a2ui.org), and includes an object model for UI components,
/// data handling, and provides transport for communicating with generative AI
/// services (agents and LLMs).
library;

export 'src/catalog.dart';
export 'src/development_utilities.dart';
export 'src/engine.dart' hide SurfaceAdded, SurfaceRemoved;
export 'src/facade.dart';
export 'src/functions.dart';
export 'src/interfaces.dart';
export 'src/model.dart' hide allCoreCatalogsFor, coreCatalogFor;
export 'src/primitives.dart';
export 'src/transport.dart';
export 'src/utils.dart';
export 'src/widgets.dart';

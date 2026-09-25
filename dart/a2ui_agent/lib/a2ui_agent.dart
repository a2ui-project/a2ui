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

/// The A2UI agent SDK: capability negotiation, prompting and response parsing
/// for agents that generate A2UI.
///
/// Implements protocol v0.9 and the Express inference format only.
library;

export 'src/inference_format.dart';
export 'src/inference_formats/express/format.dart';
export 'src/parser/response_part.dart';
export 'src/processor/catalog_config.dart';
export 'src/processor/generator.dart';
export 'src/processor/processor.dart';

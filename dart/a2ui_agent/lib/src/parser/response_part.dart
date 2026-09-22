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

/// A slice of a parsed LLM response: [TextPart] or [A2uiPart].
sealed class ResponsePart {
  const ResponsePart();
}

/// Conversational text from an LLM response, for display to the user.
final class TextPart extends ResponsePart {
  final String text;

  const TextPart(this.text);
}

/// A2UI messages compiled from one payload block of an LLM response, ready to
/// deliver to a renderer.
final class A2uiPart extends ResponsePart {
  final List<AgentToRendererMessage> a2ui;

  const A2uiPart(this.a2ui);
}

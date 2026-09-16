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

/// Which graph checks a surface must pass once a payload has been applied.
///
/// The three checks here are the ones a partially delivered surface cannot
/// satisfy: a surface still arriving has no root yet, references targets that
/// have not landed, and holds components nothing points at. A caller that
/// receives a whole render in one payload leaves them all on; one that streams
/// a surface across several payloads turns off the ones its transport breaks.
///
/// Everything else `MessageProcessor` checks is unconditional, because no
/// further message can make it right: a component against its catalog's
/// schema, a duplicate id, a self-reference, a cycle, an over-deep chain, and
/// a malformed data-model path.
///
/// [strict] is the default. The other SDKs spell these
/// `allow_orphan_components`, `allow_dangling_references` and
/// `allow_missing_root`, with the same defaults; `targetVersion` is not among
/// them here because a processor is built for one `A2uiProtocolVersion`
/// already.
class ValidationConfig {
  /// Whether a surface may hold a component unreachable from its root.
  ///
  /// v0.9 has no way to remove a component, so a placeholder swapped out by
  /// re-sending its parent with new children stays on the surface with nothing
  /// pointing at it. The basic catalog's `31_incremental-dashboard` example
  /// does exactly that.
  final bool allowOrphanComponents;

  /// Whether a component may reference a component the surface does not hold.
  final bool allowDanglingReferences;

  /// Whether a surface may hold components but no component with id `root`.
  final bool allowMissingRoot;

  const ValidationConfig({
    this.allowOrphanComponents = false,
    this.allowDanglingReferences = false,
    this.allowMissingRoot = false,
  });

  /// Every check on: what a payload that renders a whole surface must pass.
  static const ValidationConfig strict = ValidationConfig();

  /// Every check off, for a surface delivered across several payloads.
  ///
  /// Schema, duplicate ids, cycles and depth are still checked: those are not
  /// waiting on anything.
  static const ValidationConfig relaxed = ValidationConfig(
    allowOrphanComponents: true,
    allowDanglingReferences: true,
    allowMissingRoot: true,
  );

  @override
  String toString() =>
      'ValidationConfig(allowOrphanComponents: $allowOrphanComponents, '
      'allowDanglingReferences: $allowDanglingReferences, '
      'allowMissingRoot: $allowMissingRoot)';
}

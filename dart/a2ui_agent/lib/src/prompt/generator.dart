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
import 'package:meta/meta.dart';

/// Heading that introduces the examples in a prompt snippet or skill.
const String examplesHeading = '### Examples:\n\n';

/// Renders the system prompt snippet teaching an LLM one inference format.
///
/// Obtained from `InferenceFormat.promptGenerator`, bound to the catalogs of
/// one request.
///
/// A format implements [catalogs] and the three sections, [generateBaseRules],
/// [generateCatalogInstructions] and [generateExamples]. [generate] and
/// `SkillGenerator` both join the sections with [assembleInstructions], so a
/// prompt snippet and a monolithic skill for the same catalogs have the same
/// body.
abstract class PromptGenerator {
  const PromptGenerator();

  /// The catalogs the snippet describes, in order.
  List<CatalogApi> get catalogs;

  /// What every catalog shares: the format's syntax rules, its sentinel tags,
  /// and any protocol schemas the format shows the model.
  ///
  /// Text that combines several catalogs' instructions holds it once, so it
  /// names no single catalog's components or functions.
  String generateBaseRules() => '';

  /// The components and functions of [catalog], or of all [catalogs] when
  /// [catalog] is null, including anything the format renders once for all
  /// of them.
  String generateCatalogInstructions({CatalogApi? catalog}) => '';

  /// The example turns shown for [catalog], or for all [catalogs] when
  /// [catalog] is null.
  ///
  /// A format whose examples are not kept per catalog returns the same text
  /// for every catalog.
  String generateExamples({CatalogApi? catalog}) => '';

  /// Renders the snippet, which describes the format, the components and
  /// functions of the catalogs, and any example turns.
  ///
  /// The agent adds its own role and workflow instructions around it. This is
  /// [assembleInstructions] for [catalogs]; a format implements the sections,
  /// never this method.
  @nonVirtual
  String generate() => assembleInstructions(this);
}

/// Joins the sections [generator] renders into the instructions for
/// [catalogs], which defaults to the generator's own catalogs.
///
/// The text is the base rules, the catalog instructions, and the examples
/// after [examplesHeading], separated by blank lines. A section that renders
/// nothing is left out.
///
/// For the generator's own catalogs, the catalog instructions and the
/// examples come from one call each, so a format can render what its catalogs
/// share once. Other catalogs are rendered one at a time, and examples that a
/// catalog repeats are added once.
String assembleInstructions(
  PromptGenerator generator, {
  List<CatalogApi>? catalogs,
}) {
  final List<CatalogApi> own = generator.catalogs;
  final List<CatalogApi> targets = catalogs ?? own;
  final bool isOwn =
      targets.length == own.length &&
      [for (var i = 0; i < own.length; i++) identical(targets[i], own[i])]
          .every((same) => same);

  final parts = <String>[generator.generateBaseRules()];
  final examples = <String>[];
  if (isOwn) {
    parts.add(generator.generateCatalogInstructions());
    examples.add(generator.generateExamples());
  } else {
    for (final CatalogApi catalog in targets) {
      parts.add(generator.generateCatalogInstructions(catalog: catalog));
      final String text = generator.generateExamples(catalog: catalog);
      if (!examples.contains(text)) examples.add(text);
    }
  }
  final List<String> shown = examples.where((e) => e.isNotEmpty).toList();
  if (shown.isNotEmpty) parts.add('$examplesHeading${shown.join('\n\n')}');
  return parts.where((p) => p.isNotEmpty).join('\n\n');
}

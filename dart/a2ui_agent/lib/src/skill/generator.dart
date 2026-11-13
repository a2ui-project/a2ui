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

import '../inference_format.dart';
import '../prompt/generator.dart';
import 'skill.dart';

/// Builds [Skill]s and [SkillSet]s that teach a model [format] and its
/// catalogs, from the sections of the format's prompt.
///
/// Where a method takes catalogs, it defaults to those bound to [format].
class SkillGenerator {
  const SkillGenerator(this.format);

  /// The format whose prompt the skills carry.
  final InferenceFormat format;

  PromptGenerator get _prompt => format.promptGenerator;

  /// One skill holding everything: the format's rules, the catalogs, and the
  /// examples.
  ///
  /// For the format's own catalogs, its body is the format's prompt snippet.
  Skill generateSkill({
    String name = 'a2ui',
    String? description,
    List<CatalogApi>? catalogs,
  }) => Skill(
    name: name,
    description:
        description ??
        'Generates interactive user interface components for user requests.',
    content: '${assembleInstructions(_prompt, catalogs: catalogs)}\n',
  );

  /// A skill holding the format's rules, which every catalog shares.
  Skill generateCoreSkill({String name = 'a2ui-core', String? description}) =>
      Skill(
        name: name,
        description:
            description ??
            'Core A2UI protocol instructions and syntax rules for UI '
                'generation.',
        content: '${_prompt.generateBaseRules().trim()}\n',
      );

  /// A skill holding the components and functions of [catalog], which
  /// defaults to the format's first catalog, and the examples unless
  /// [includeExamples] is false.
  ///
  /// [name] defaults to `a2ui-<catalog name>`, where the catalog name is the
  /// last segment of the catalog's id that is not a version or a `.json`
  /// file, such as `basic`.
  ///
  /// Throws [A2uiCatalogError] if no [catalog] is given and the format has
  /// none.
  Skill generateCatalogSkill({
    CatalogApi? catalog,
    String? name,
    String? description,
    bool includeExamples = true,
  }) {
    final CatalogApi target =
        catalog ??
        _prompt.catalogs.firstOrNull ??
        (throw A2uiCatalogError(
          'No catalog was given, and the format has none to build a catalog '
          'skill from.',
        ));
    return _catalogSkill(
      target,
      includeExamples ? _prompt.generateExamples(catalog: target) : '',
      name: name,
      description: description,
    );
  }

  /// The core skill, named [coreName], and one catalog skill for each of
  /// [catalogs].
  ///
  /// Examples that are the same for several catalogs, as they are for a
  /// format that does not keep examples per catalog, go only in the first of
  /// their catalog skills.
  SkillSet generateSkillSet({
    List<CatalogApi>? catalogs,
    String coreName = 'a2ui-core',
  }) {
    final skills = SkillSet([generateCoreSkill(name: coreName)]);
    final seen = <String>{};
    for (final CatalogApi catalog in catalogs ?? _prompt.catalogs) {
      final String examples = _prompt.generateExamples(catalog: catalog);
      skills.add(_catalogSkill(catalog, seen.add(examples) ? examples : ''));
    }
    return skills;
  }

  Skill _catalogSkill(
    CatalogApi catalog,
    String examples, {
    String? name,
    String? description,
  }) {
    final String catalogName = _catalogName(catalog);
    final String instructions = _prompt.generateCatalogInstructions(
      catalog: catalog,
    );
    final body = examples.isEmpty
        ? instructions
        : '$instructions\n\n$examplesHeading$examples';
    return Skill(
      name: name ?? 'a2ui-$catalogName',
      // The catalog's own description says what it holds, not when to use
      // the skill, so it is not used here.
      description:
          description ??
          'UI component catalog signatures for $catalogName. Use when '
              'building $catalogName user interface components.',
      content: '${body.trim()}\n',
    );
  }
}

/// [catalog]'s id in lower case, or for an id that is a path or URL, its
/// last segment that is not a `.json` file, or the one before it when that is
/// a version such as `v1`; `basic` for a catalog with no id.
String _catalogName(CatalogApi catalog) {
  final String id = catalog.id.replaceAll(r'\', '/');
  if (id.isEmpty) return 'basic';
  final List<String> segments = id
      .split('/')
      .where((s) => s.isNotEmpty && !s.endsWith('.json'))
      .toList();
  var name = id;
  if (id.contains('/') && segments.isNotEmpty) {
    name = segments.last;
    if (name.startsWith('v') && segments.length > 1) {
      name = segments[segments.length - 2];
    }
  }
  return name.toLowerCase();
}

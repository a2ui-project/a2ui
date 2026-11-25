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

import 'dart:collection';

import 'package:a2ui_core/a2ui_core.dart';

import 'frontmatter.dart';
import 'skill_files_stub.dart' if (dart.library.io) 'skill_files_io.dart';

/// One skill package: a `SKILL.md` file with YAML frontmatter, as managed
/// agent platforms load them.
class Skill {
  /// [filename] defaults to `<name>/SKILL.md`.
  ///
  /// Throws [A2uiValidationError] if [filename] is absolute or has an empty,
  /// `.` or `..` segment, so [SkillSet.exportToDirectory] can rely on every
  /// filename staying inside its output directory.
  Skill({
    required this.name,
    required this.description,
    required this.content,
    Map<String, Object?> metadata = const {},
    String? filename,
  }) : metadata = Map.unmodifiable(metadata),
       filename = _checkFilename(filename ?? '$name/SKILL.md');

  /// The skill's name, such as `a2ui-core`.
  final String name;

  /// What the skill is for, as the model reads it to decide when to use it.
  final String description;

  /// The Markdown body.
  final String content;

  /// Further frontmatter fields, written under `metadata:` when not empty.
  final Map<String, Object?> metadata;

  /// The path the skill is written to, relative to the directory a [SkillSet]
  /// is exported to. Both `/` and `\` separate its segments.
  final String filename;

  /// The skill as Markdown: the frontmatter between `---` lines, a blank
  /// line, and [content] trimmed and ending with a newline.
  String toMarkdown() {
    final String frontmatter = yamlFrontmatter({
      'name': name,
      'description': description,
      if (metadata.isNotEmpty) 'metadata': metadata,
    });
    return '---\n$frontmatter\n---\n\n${content.trim()}\n';
  }

  @override
  String toString() => 'Skill($name, $filename)';
}

/// Skills keyed by filename, written together as one package.
class SkillSet {
  SkillSet([Iterable<Skill> skills = const []]) {
    skills.forEach(add);
  }

  final Map<String, Skill> _skills = {};

  /// The skills, keyed by [Skill.filename], in the order they were added.
  Map<String, Skill> get skills => UnmodifiableMapView(_skills);

  /// Adds [skill], replacing any skill with the same filename.
  void add(Skill skill) => _skills[skill.filename] = skill;

  /// The skill whose filename is [query], else the first whose name is
  /// [query], else, for a [query] of at least 3 characters, the first whose
  /// filename contains it; null if there is none.
  Skill? get(String query) {
    if (_skills[query] case final Skill skill) return skill;
    for (final Skill skill in _skills.values) {
      if (skill.name == query) return skill;
    }
    if (query.length < 3) return null;
    for (final Skill skill in _skills.values) {
      if (skill.filename.contains(query)) return skill;
    }
    return null;
  }

  /// Each skill's Markdown, keyed by filename.
  Map<String, String> toMap() => {
    for (final MapEntry(:String key, :Skill value) in _skills.entries)
      key: value.toMarkdown(),
  };

  /// Writes each skill to `<outputDir>/<filename>` and returns [toMap].
  ///
  /// The directory that holds each skill file, such as `<outputDir>/a2ui-core`
  /// for `a2ui-core/SKILL.md`, is removed first, so no file from an earlier
  /// export is left in it; a symlink or file at that path is removed, not
  /// followed. Nothing else is removed: not that directory's ancestors, other
  /// directories or files in [outputDir], nor [outputDir] itself.
  ///
  /// Throws [A2uiValidationError], before removing or writing anything, if a
  /// skill directory's parent resolves through a symlink to outside
  /// [outputDir], and [UnsupportedError] on a platform without a file system.
  Map<String, String> exportToDirectory(String outputDir) {
    final Map<String, String> files = toMap();
    writeSkillFiles(outputDir, files);
    return files;
  }

  @override
  String toString() => 'SkillSet(${_skills.keys.join(', ')})';
}

String _checkFilename(String filename) {
  final List<String> segments = filename.split(_separators);
  if (filename.isEmpty ||
      filename.startsWith(_windowsDrive) ||
      segments.any((s) => s.isEmpty || s == '.' || s == '..')) {
    throw A2uiValidationError(
      'Skill filename "$filename" must be a relative path without "." or '
      '".." segments.',
    );
  }
  return filename;
}

final RegExp _separators = RegExp(r'[\\/]');
final RegExp _windowsDrive = RegExp('^[A-Za-z]:');

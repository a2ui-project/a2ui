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

import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';

/// Writes [files], Markdown keyed by relative filename, under [outputDir],
/// after removing the directory that holds each file.
///
/// Each filename was checked to be relative with no `.` or `..` segment.
/// That check cannot see a symlinked directory under [outputDir], so each
/// skill directory's parent is resolved through symlinks, and all of them
/// are checked before anything is removed.
///
/// Throws [A2uiValidationError] if one resolves outside [outputDir].
void writeSkillFiles(String outputDir, Map<String, String> files) {
  final String root = (Directory(
    outputDir,
  )..createSync(recursive: true)).resolveSymbolicLinksSync();

  final skillDirs = <String>{};
  for (final String filename in files.keys) {
    final List<String> segments = filename.split(RegExp(r'[\\/]'));
    if (segments.length == 1) continue;
    final List<String> dirSegments = segments.sublist(0, segments.length - 1);
    _checkInside(
      _join(outputDir, dirSegments.sublist(0, dirSegments.length - 1)),
      root,
      filename,
    );
    skillDirs.add(_join(outputDir, dirSegments));
  }

  for (final dir in skillDirs) {
    switch (FileSystemEntity.typeSync(dir, followLinks: false)) {
      case FileSystemEntityType.link:
        Link(dir).deleteSync();
      case FileSystemEntityType.directory:
        Directory(dir).deleteSync(recursive: true);
      case FileSystemEntityType.notFound:
        break;
      default:
        File(dir).deleteSync();
    }
  }

  for (final MapEntry(key: String filename, value: String markdown)
      in files.entries) {
    File(_join(outputDir, filename.split(RegExp(r'[\\/]'))))
      ..parent.createSync(recursive: true)
      ..writeAsStringSync(markdown);
  }
}

String _join(String dir, List<String> segments) =>
    [dir, ...segments].join(Platform.pathSeparator);

/// Throws if the nearest existing ancestor of [path], or [path] itself,
/// resolves to outside [root].
void _checkInside(String path, String root, String filename) {
  var existing = path;
  while (FileSystemEntity.typeSync(existing, followLinks: false) ==
      FileSystemEntityType.notFound) {
    existing = Directory(existing).parent.path;
  }
  final String real = Directory(existing).resolveSymbolicLinksSync();
  if (real != root && !real.startsWith('$root${Platform.pathSeparator}')) {
    throw A2uiValidationError(
      'Skill filename "$filename" resolves through a symlink to "$real", '
      'outside the output directory.',
    );
  }
}

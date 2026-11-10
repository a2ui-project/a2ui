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

/// Reads the file at [path] as text, on a platform without `dart:io`.
///
/// Always throws, since there is no file system to read.
String readTextFile(String path) => throw _NoFileSystem(path);

class _NoFileSystem implements Exception {
  _NoFileSystem(this.path);

  final String path;

  @override
  String toString() => 'This platform has no file system to read $path from.';
}

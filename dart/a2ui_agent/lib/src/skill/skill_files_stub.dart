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

/// Writes skill files, on a platform without `dart:io`.
///
/// Always throws, since there is no file system to write to.
void writeSkillFiles(String outputDir, Map<String, String> files) =>
    throw UnsupportedError(
      'This platform has no file system to export skills to $outputDir.',
    );

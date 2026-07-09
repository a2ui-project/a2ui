// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'dart:io';

void main(List<String> args) {
  final lcovPath = args.isNotEmpty ? args[0] : 'coverage/lcov.info';
  final file = File(lcovPath);

  if (!file.existsSync()) {
    print('Error: LCOV file not found at $lcovPath');
    exit(1);
  }

  final lines = file.readAsLinesSync();
  int linesFound = 0;
  int linesHit = 0;

  for (final line in lines) {
    if (line.startsWith('LF:')) {
      linesFound += int.parse(line.substring(3).trim());
    } else if (line.startsWith('LH:')) {
      linesHit += int.parse(line.substring(3).trim());
    }
  }

  if (linesFound == 0) {
    print('Error: No lines found in LCOV report.');
    exit(1);
  }

  final coverage = (linesHit / linesFound) * 100;
  print('Dart/Flutter Code Coverage Summary:');
  print('  Lines Found: $linesFound');
  print('  Lines Hit:   $linesHit');
  print('  Overall Line Coverage: ${coverage.toStringAsFixed(2)}%');

  if (coverage < 90) {
    print('❌ FAIL: Code coverage (${coverage.toStringAsFixed(2)}%) is below the 90% target!');
    exit(1);
  } else {
    print('🟢 PASS: Code coverage (${coverage.toStringAsFixed(2)}%) meets the 90% target!');
    exit(0);
  }
}

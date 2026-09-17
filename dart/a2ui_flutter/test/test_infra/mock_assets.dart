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

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Configures a mock handler for the 'flutter/assets' channel to load assets
/// directly from the local file system.
///
/// This is necessary because PromptBuilder loads schemas from assets,
/// and Flutter tests do not load package assets automatically.
/// It automatically handles running from the package root or example directory.
void setUpMockPackageAssets() {
  final String cwd = Directory.current.path;
  String packageRoot;
  if (cwd.endsWith('dart/a2ui_flutter')) {
    packageRoot = cwd;
  } else if (cwd.endsWith('dart/a2ui_flutter/example')) {
    packageRoot = Directory(cwd).parent.path;
  } else {
    packageRoot = '$cwd/dart/a2ui_flutter';
  }

  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMessageHandler('flutter/assets', (ByteData? message) async {
        final String key = utf8.decode(message!.buffer.asUint8List());
        var relativePath = key;
        if (key.startsWith('packages/a2ui_flutter/')) {
          relativePath = key.substring('packages/a2ui_flutter/'.length);
        }
        final file = File('$packageRoot/$relativePath');
        if (file.existsSync()) {
          return ByteData.view(utf8.encode(file.readAsStringSync()).buffer);
        }
        return null;
      });
}

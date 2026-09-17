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

/// Defines the mode of the application.
enum AppMode {
  /// Agent responds with text only.
  textOnly('Text only'),

  /// Agent responds with text and the basic catalog items.
  basicCatalog('Basic catalog'),

  /// Agent responds with text and custom catalog items.
  customCatalog('Custom catalog');

  const AppMode(this.displayName);

  /// The user-friendly name of the app mode.
  final String displayName;
}

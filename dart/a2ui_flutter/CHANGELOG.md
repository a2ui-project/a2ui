<!--
 Copyright 2024 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

# a2ui_flutter Changelog

## Unreleased

- `A2uiSurface` widgets that show the same surface share one resolver, from the first widget until the surface is disposed, so remounting a surface or showing it twice does not repeat its diagnostics. The surface stays resolved while no widget shows it.
- Ignore `deprecated_member_use` warnings on `package:flutter/material.dart` imports on Flutter beta (#3235).
- Initial version.

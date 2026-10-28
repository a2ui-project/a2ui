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

# [a2ui_flutter](https://pub.dev/packages/a2ui_flutter) Changelog

## 0.0.1-wip003

- An `accessibility.live` of `polite` or `assertive` makes a component a live
  region, and an `accessibility.hidden` that is true excludes it and its
  subtree from semantics.
- `ComponentProps.asBoolean` reads a validation result as its validity.
- `ComponentProps.validationResults` holds the failing checks, and the basic
  inputs other than Button show one of `warning` or `info` severity as a
  hint.
- A Text that no `A2uiMarkdown` renders shows its text without common
  Markdown markers, and a body Text that is one Markdown heading line takes
  the style of its level.
- The v1.0 Video shows its `posterUrl` until playback starts.
- The v1.0 Slider moves in its `steps`.
- The v1.0 TextField shows its `placeholder`.
- The v1.0 TextField does not check `validationRegexp`, which v1.0 removed.
- **Breaking:** `package:a2ui_flutter/basic_catalog.dart` now implements the
  v1.0 basic catalog under the same names. v0.9 code that still imports it
  compiles, but registers the v1.0 catalog, which its v0.9 surfaces do not
  name.
- **Breaking:** The v0.9 basic catalog moved to
  `package:a2ui_flutter/v0_9/basic_catalog.dart`, under the same names.
- Error and warning listeners no longer run while an `A2uiSurface` builds, so
  they may call `setState` directly instead of deferring it to the next frame.
- Ignore `deprecated_member_use` warnings on `package:flutter/material.dart` imports on Flutter beta (#3235).
- Initial version.

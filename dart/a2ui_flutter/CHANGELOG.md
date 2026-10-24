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

- `A2uiSurface` no longer delivers diagnostics during its build. Errors and
  warnings found while it builds reach their listeners after the build, so a
  listener may call `setState` directly, and the widget requests a frame
  after they are delivered. A listener that defers its update to a later
  frame must also schedule that frame. A surface deleted in the same turn
  its `A2uiSurface` was built drops the diagnostics that build found and
  had not delivered.
- Requires the next release of `a2ui_core`, which adds
  `SurfaceModel.onReportsDelivered` and `SurfaceGroupModel.onError`, which
  the README uses. The release that publishes this version raises the
  constraint.
- Ignore `deprecated_member_use` warnings on `package:flutter/material.dart` imports on Flutter beta (#3235).
- Initial version.

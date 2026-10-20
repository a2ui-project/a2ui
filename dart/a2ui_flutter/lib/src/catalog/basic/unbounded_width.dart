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

import 'package:flutter/widgets.dart';

/// Limits [child] to the screen's width when the incoming width is
/// unbounded, and leaves a bounded width as it is.
Widget limitUnboundedWidth(BuildContext context, Widget child) => LimitedBox(
  maxWidth: MediaQuery.maybeSizeOf(context)?.width ?? 400,
  child: child,
);

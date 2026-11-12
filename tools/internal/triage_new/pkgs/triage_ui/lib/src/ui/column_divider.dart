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

import 'package:flutter/material.dart';

/// The narrowest that a column next to a [ColumnDivider] can be.
const double minColumnWidth = 240;

/// The width of the column on the left of a [ColumnDivider], [width] clamped
/// so that it and the column on the right are at least [minColumnWidth] wide
/// in [maxWidth]. When [maxWidth] is too narrow for both, the left column
/// gets half of it.
double clampColumnWidth(double width, double maxWidth) {
  if (maxWidth < 2 * minColumnWidth) return maxWidth / 2;
  return width.clamp(minColumnWidth, maxWidth - minColumnWidth);
}

/// A vertical divider between two columns, which the triager drags to resize
/// them.
class ColumnDivider extends StatelessWidget {
  const ColumnDivider({super.key, required this.label, required this.onDrag});

  /// What dragging the divider does, for screen readers.
  final String label;

  /// Called with how far the divider moved to the right.
  final void Function(double delta) onDrag;

  @override
  Widget build(BuildContext context) => Semantics(
    // A node of its own, so that the label does not merge into an ancestor.
    container: true,
    label: label,
    child: MouseRegion(
      cursor: SystemMouseCursors.resizeColumn,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragUpdate: (DragUpdateDetails d) => onDrag(d.delta.dx),
        child: const SizedBox(
          width: 9,
          child: VerticalDivider(width: 9, thickness: 1),
        ),
      ),
    ),
  );
}

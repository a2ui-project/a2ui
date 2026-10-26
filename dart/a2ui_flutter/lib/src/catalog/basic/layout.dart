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

import 'dart:math' as math;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import '../../signal_state.dart';

/// The space between the children of a basic Row or Column.
const double flexGap = 8;

/// The main-axis alignment for a basic `justify` value. `stretch` and
/// unknown values align to the start.
MainAxisAlignment justifyOf(String? justify) =>
    MainAxisAlignment.values.asNameMap()[justify] ?? MainAxisAlignment.start;

/// The cross-axis alignment for a basic `align` value, or `stretch` when the
/// value is absent or unknown.
CrossAxisAlignment alignOf(String? align) => switch (align) {
  'start' => CrossAxisAlignment.start,
  'center' => CrossAxisAlignment.center,
  'end' => CrossAxisAlignment.end,
  _ => CrossAxisAlignment.stretch,
};

/// Lays out the `children` of [props] in a [Flex] along [direction],
/// applying `justify`, `align` and each child's `weight`.
///
/// `stretch` applies only on a bounded cross axis and weights only on a
/// bounded main axis. A `justify` other than `start` fills a bounded main
/// axis. In a horizontal container with a bounded width and no
/// weighted children, icons, buttons, check boxes and icon or avatar images
/// keep their own width, up to an equal share, and the other children share
/// the rest, wrapping their content. With weighted children, each child
/// without a weight is at most an equal share of the width wide.
Widget flexContainer(
  Axis direction,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) => _FlexContainer(
  direction: direction,
  justify: justifyOf(props.string('justify')),
  align: alignOf(props.string('align')),
  children: props.children('children'),
  buildChild: buildChild,
);

/// The flex factor of a child's `weight`: 100 per unit, from 1 to 1,000,000.
int _flexOf(ComponentProps props) {
  final double weight = props.number('weight') ?? 0;
  return weight > 0 ? math.max(1, (math.min(weight, 10000) * 100).round()) : 0;
}

bool _ownWidth(String type, ComponentProps props) => switch (type) {
  'Icon' || 'Button' || 'CheckBox' => true,
  'Image' => const {'icon', 'avatar'}.contains(props.string('variant')),
  _ => false,
};

/// The flex factor of [child]'s weight, and whether it keeps its own width.
(int, bool) _slotOf(ComponentNode<ComponentImplementation> child) {
  final props = ComponentProps(child.props.peek());
  return (_flexOf(props), _ownWidth(child.type, props));
}

/// Lays out [children] in a [Flex], again each time a child's weight or own
/// width changes.
class _FlexContainer extends StatefulWidget {
  const _FlexContainer({
    required this.direction,
    required this.justify,
    required this.align,
    required this.children,
    required this.buildChild,
  });

  final Axis direction;
  final MainAxisAlignment justify;
  final CrossAxisAlignment align;
  final List<ComponentNode<ComponentImplementation>> children;
  final ChildWidgetBuilder buildChild;

  @override
  State<_FlexContainer> createState() => _FlexContainerState();
}

class _FlexContainerState extends State<_FlexContainer> with SignalState {
  List<void Function()> _unsubscribes = const [];
  List<(int, bool)> _slots = const [];

  void _subscribe() {
    _unsubscribes = [
      for (final child in widget.children)
        listenAfterFirst(child.props, (_) {
          if (!listEquals(widget.children.map(_slotOf).toList(), _slots)) {
            signalChanged();
          }
        }),
    ];
  }

  void _unsubscribe() {
    for (final void Function() unsubscribe in _unsubscribes) {
      unsubscribe();
    }
  }

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void didUpdateWidget(_FlexContainer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!listEquals(oldWidget.children, widget.children)) {
      _unsubscribe();
      _subscribe();
    }
  }

  @override
  void dispose() {
    _unsubscribe();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final horizontal = widget.direction == Axis.horizontal;
    final List<ComponentNode<ComponentImplementation>> children =
        widget.children;
    final List<(int, bool)> slots = _slots = children.map(_slotOf).toList();
    final bool weighted = slots.any((slot) => slot.$1 > 0);
    return LayoutBuilder(
      builder: (context, constraints) {
        final (bool mainBounded, bool crossBounded) = horizontal
            ? (constraints.hasBoundedWidth, constraints.hasBoundedHeight)
            : (constraints.hasBoundedHeight, constraints.hasBoundedWidth);
        final double gaps = flexGap * (children.length - 1);
        final double width = math.max(0, constraints.maxWidth - gaps);
        final double share = horizontal && mainBounded
            ? width / children.length
            : double.infinity;
        Widget item(int i) {
          final (int flex, bool ownWidth) = slots[i];
          final factor = !mainBounded
              ? 0
              : horizontal && !weighted
              ? (ownWidth ? 0 : 1)
              : flex;
          return KeyedSubtree(
            key: NodeKey(children[i].instanceId),
            child: Flexible(
              flex: factor,
              fit: flex > 0 ? FlexFit.tight : FlexFit.loose,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxWidth: horizontal && factor == 0 ? share : double.infinity,
                ),
                child: widget.buildChild(children[i]),
              ),
            ),
          );
        }

        return Flex(
          direction: widget.direction,
          mainAxisSize: mainBounded && widget.justify != MainAxisAlignment.start
              ? MainAxisSize.max
              : MainAxisSize.min,
          mainAxisAlignment: widget.justify,
          crossAxisAlignment:
              widget.align == CrossAxisAlignment.stretch && !crossBounded
              ? CrossAxisAlignment.start
              : widget.align,
          spacing: flexGap,
          children: [for (var i = 0; i < children.length; i++) item(i)],
        );
      },
    );
  }
}

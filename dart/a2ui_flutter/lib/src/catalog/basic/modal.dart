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

import 'package:a2ui_core/a2ui_core.dart' hide Action;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';

/// Builds the basic `Modal` component: its `trigger`, which opens a sheet
/// showing its `content` when tapped or activated from the keyboard. On a
/// screen at least 600 wide the content shows in a centered dialog instead.
Widget buildModal(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final ComponentNode<ComponentImplementation>? trigger = props.child(
    'trigger',
  );
  if (trigger == null) return const SizedBox.shrink();
  return _Modal(
    trigger: trigger,
    content: props.child('content'),
    buildChild: buildChild,
  );
}

class _Modal extends StatefulWidget {
  const _Modal({
    required this.trigger,
    required this.content,
    required this.buildChild,
  });

  final ComponentNode<ComponentImplementation> trigger;
  final ComponentNode<ComponentImplementation>? content;
  final ChildWidgetBuilder buildChild;

  @override
  State<_Modal> createState() => _ModalState();
}

/// Opens on a tap inside the trigger, or on Enter or Space while the focus is
/// inside it, without taking either from the trigger, unless one of the
/// trigger's checks fails.
/// The trigger's semantics merge into one node whose tap activates the
/// trigger's first focusable descendant and opens the sheet.
/// Closes on a barrier tap, the close button, a dismiss intent such as
/// Escape, or a back navigation while it is the last Modal opened. The sheet
/// or dialog holds the focus while open and gives it back to the previously
/// focused node on close.
class _ModalState extends State<_Modal> with WidgetsBindingObserver {
  // The open Modals, in the order they opened. A back navigation reaches
  // every one, and only the last one closes.
  static final List<_ModalState> _opened = [];

  final OverlayPortalController _overlay = OverlayPortalController(
    debugLabel: 'Modal',
  );
  final FocusScopeNode _sheetFocus = FocusScopeNode(debugLabel: 'Modal sheet');
  // Keeps the content's state when the sheet turns into a dialog or back.
  final GlobalKey _bodyKey = GlobalKey(debugLabel: 'Modal body');
  final FocusNode _triggerFocus = FocusNode(
    debugLabel: 'Modal trigger',
    canRequestFocus: false,
    skipTraversal: true,
  );
  FocusNode? _returnFocus;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  /// Rebuilds the open sheet when the view's metrics change, as they do when
  /// the keyboard opens or closes.
  @override
  void didChangeMetrics() {
    if (_overlay.isShowing) setState(() {});
  }

  void _open() {
    if (_overlay.isShowing) return;
    if (!ComponentProps(widget.trigger.props.peek()).isValid) return;
    _returnFocus = FocusManager.instance.primaryFocus;
    _overlay.show();
    _opened.add(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _overlay.isShowing) _sheetFocus.requestFocus();
    });
  }

  void _onSemanticsTap() {
    for (final FocusNode node in _triggerFocus.descendants) {
      final BuildContext? context = node.context;
      if (node.canRequestFocus && context != null) {
        Actions.maybeInvoke(context, const ActivateIntent());
        break;
      }
    }
    _open();
  }

  void _close() {
    if (!_overlay.isShowing) return;
    _overlay.hide();
    _opened.remove(this);
    final FocusNode? returnFocus = _returnFocus;
    _returnFocus = null;
    if (returnFocus?.context?.mounted ?? false) returnFocus!.requestFocus();
  }

  @override
  void dispose() {
    _opened.remove(this);
    WidgetsBinding.instance.removeObserver(this);
    _sheetFocus.dispose();
    _triggerFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // OverlayPortal keeps the content under the surface's inherited widgets.
    return OverlayPortal(
      controller: _overlay,
      overlayChildBuilder: _buildSheet,
      child: Focus(
        focusNode: _triggerFocus,
        includeSemantics: false,
        onKeyEvent: (_, event) {
          if (event is KeyDownEvent &&
              (event.logicalKey == LogicalKeyboardKey.enter ||
                  event.logicalKey == LogicalKeyboardKey.space)) {
            _open();
          }
          return KeyEventResult.ignored;
        },
        child: MergeSemantics(
          child: Semantics(
            onTap: _onSemanticsTap,
            child: Semantics(
              blockUserActions: true,
              // Sees a tap even when the trigger's own button wins it.
              child: RawGestureDetector(
                behavior: HitTestBehavior.translucent,
                gestures: {
                  _SimultaneousTap:
                      GestureRecognizerFactoryWithHandlers<_SimultaneousTap>(
                        _SimultaneousTap.new,
                        (recognizer) => recognizer.onTap = _open,
                      ),
                },
                child: widget.buildChild(widget.trigger),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSheet(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final MaterialLocalizations localizations = MaterialLocalizations.of(
      context,
    );
    final bool wide = MediaQuery.sizeOf(context).width >= 600;
    final double keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final double height = MediaQuery.sizeOf(context).height;
    final ComponentNode<ComponentImplementation>? content = widget.content;
    final Widget body = Column(
      key: _bodyKey,
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: CloseButton(onPressed: _close),
        ),
        Flexible(
          child: SingleChildScrollView(
            primary: false,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: content == null ? null : widget.buildChild(content),
          ),
        ),
      ],
    );
    Widget scope(Widget child) => FocusScope(
      node: _sheetFocus,
      child: Semantics(
        scopesRoute: true,
        namesRoute: true,
        explicitChildNodes: true,
        label: wide
            ? localizations.dialogLabel
            : localizations.bottomSheetLabel,
        child: child,
      ),
    );
    return Actions(
      actions: <Type, Action<Intent>>{
        DismissIntent: CallbackAction<DismissIntent>(onInvoke: (_) => _close()),
      },
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop && identical(_opened.lastOrNull, this)) _close();
        },
        child: Stack(
          children: [
            Positioned.fill(
              child: BlockSemantics(
                child: ModalBarrier(
                  color:
                      theme.bottomSheetTheme.modalBarrierColor ??
                      Colors.black54,
                  onDismiss: _close,
                  semanticsLabel: localizations.modalBarrierDismissLabel,
                ),
              ),
            ),
            if (wide)
              Dialog(
                constraints: const BoxConstraints(minWidth: 280, maxWidth: 560),
                child: scope(body),
              )
            else
              Padding(
                padding: EdgeInsets.only(bottom: keyboard),
                child: Align(
                  alignment: Alignment.bottomCenter,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: math.max(0, height - keyboard) * 0.9,
                    ),
                    child: scope(
                      BottomSheet(
                        enableDrag: false,
                        onClosing: _close,
                        builder: (context) => SafeArea(top: false, child: body),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A tap recognizer that still reports its tap when another recognizer wins
/// the arena after the pointer is up.
class _SimultaneousTap extends TapGestureRecognizer {
  @override
  void rejectGesture(int pointer) {
    if (state == GestureRecognizerState.ready) {
      acceptGesture(pointer);
    } else {
      super.rejectGesture(pointer);
    }
  }
}

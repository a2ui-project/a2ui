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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import 'demo_catalog.dart';
import 'example.dart';

/// An entry of the action log: a heading and the details under it.
typedef LogEntry = ({String heading, Map<String, Object?> details});

/// One run of an [Example]: a [MessageProcessor] over [demoCatalog] for
/// v0.9 and the v1.0 basic catalog that processes the example's messages in
/// order on request, the surfaces it creates, and a log of the actions the
/// surfaces send and the errors the surfaces and the processor report.
///
/// Notifies its listeners when a message is processed, a surface is created
/// or deleted, or an entry is logged.
class ExampleRun extends ChangeNotifier {
  ExampleRun(this.example)
    : messages = example.messages,
      _processor = MessageProcessor(
        catalogs: [demoCatalog, basicCatalog()],
        defaultVersion: example.version,
        validationConfig: const ValidationConfig(
          allowOrphanComponents: true,
          allowDanglingReferences: true,
          allowMissingRoot: true,
        ),
      ) {
    final SurfaceGroupModel<ComponentImplementation> group = _processor.model;
    group.onAction.subscribe(
      (action) => _log((heading: action.name, details: action.toJson())),
    );
    group.onSurfaceCreated.subscribe((surface) {
      surface.onError.subscribe(
        (error) =>
            _log((heading: 'Error ${error.code}', details: error.toJson())),
      );
      _surfaces.add(surface);
      _changed();
    });
    group.onSurfaceDeleted.subscribe((id) {
      _surfaces.removeWhere((surface) => surface.id == id);
      _changed();
    });
  }

  /// The example this run steps through.
  final Example example;

  /// The example's messages.
  final List<Map<String, Object?>> messages;

  /// Checks each message against the surface it leaves behind, which may
  /// lack a root, reference components a later message adds, and hold
  /// components nothing reaches.
  final MessageProcessor<ComponentImplementation> _processor;

  final List<SurfaceModel<ComponentImplementation>> _surfaces = [];
  final List<LogEntry> _entries = [];
  int _processed = 0;
  bool _disposed = false;

  /// The live surfaces, in creation order.
  List<SurfaceModel<ComponentImplementation>> get surfaces =>
      List.unmodifiable(_surfaces);

  /// The logged actions and errors, oldest first.
  List<LogEntry> get log => List.unmodifiable(_entries);

  /// How many of [messages] have been processed.
  int get processed => _processed;

  /// Whether a message is left to process.
  bool get canAdvance => _processed < messages.length;

  /// Processes the next message.
  void advance() => _processUntil(_processed + 1);

  /// Processes every message left.
  void runAll() => _processUntil(messages.length);

  void _processUntil(int end) {
    for (; _processed < end && canAdvance; _processed++) {
      try {
        _processor.processMessages(
          AgentToRendererMessagePayload.fromJson(
            messages[_processed],
            protocolVersion: example.version,
          ),
        );
      } on A2uiError catch (error) {
        _entries.add((
          heading: 'Error ${error.code}',
          details: {'message': error.message, 'messageNumber': _processed + 1},
        ));
      }
    }
    _changed();
  }

  void _log(LogEntry entry) {
    _entries.add(entry);
    _changed();
  }

  /// Notifies the listeners outside a build, since a surface can report an
  /// error while it builds.
  void _changed() => runOutsideBuild(() {
    if (!_disposed) notifyListeners();
  });

  /// Disposes the processor and its surfaces.
  @override
  void dispose() {
    _disposed = true;
    _processor.dispose();
    super.dispose();
  }
}

/// Runs [callback] now, or after the current frame while a frame builds.
void runOutsideBuild(VoidCallback callback) {
  final SchedulerBinding scheduler = SchedulerBinding.instance;
  if (scheduler.schedulerPhase == SchedulerPhase.persistentCallbacks) {
    scheduler.addPostFrameCallback((_) => callback());
  } else {
    callback();
  }
}

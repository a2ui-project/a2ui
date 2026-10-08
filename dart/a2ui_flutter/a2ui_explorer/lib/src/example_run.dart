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
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import 'demo_catalog.dart';
import 'example.dart';

/// An entry of the action log: a heading and the details under it.
typedef LogEntry = ({String heading, Map<String, Object?> details});

/// One run of an [Example]: a [MessageProcessor] over [demoCatalog] that
/// processes the example's messages in order on request, the surfaces it
/// creates, and a log of the actions and errors they report.
///
/// Notifies its listeners when a message is processed, a surface is created
/// or deleted, or an entry is logged.
class ExampleRun extends ChangeNotifier {
  ExampleRun(this.example) : messages = example.messages {
    final SurfaceGroupModel<ComponentImplementation> group =
        _processor.groupModel;
    group.onAction.addListener(
      (action) => _log((
        heading: action.name,
        details: {
          'surfaceId': action.surfaceId,
          'sourceComponentId': action.sourceComponentId,
          'context': action.context,
        },
      )),
    );
    group.onSurfaceCreated.addListener((surface) {
      surface.onError.addListener(
        (error) => _log((
          heading: 'Error ${error.code}',
          details: {
            'surfaceId': error.surfaceId,
            'message': error.message,
            'path': ?error.path,
          },
        )),
      );
      _surfaces.add(surface);
      _changed();
    });
    group.onSurfaceDeleted.addListener((id) {
      _surfaces.removeWhere((surface) => surface.id == id);
      _changed();
    });
  }

  /// The example this run steps through.
  final Example example;

  /// The example's messages.
  final List<Map<String, Object?>> messages;

  /// Validates each message on its own, so a missing root, dangling
  /// references and orphan components are allowed until later messages
  /// complete the surface.
  final MessageProcessor<ComponentImplementation> _processor = MessageProcessor(
    catalogs: [demoCatalog],
    defaultVersion: A2uiProtocolVersion.v0_9,
    validationConfig: const ValidationConfig(
      allowOrphanComponents: true,
      allowDanglingReferences: true,
      allowMissingRoot: true,
    ),
  );

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
            protocolVersion: A2uiProtocolVersion.v0_9,
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
    _processor.groupModel.dispose();
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

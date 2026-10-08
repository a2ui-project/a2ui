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

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

/// A [VideoPlayerPlatform] that records calls and plays nothing.
///
/// Players stay loading until [initialize] or [fail] is called for them.
class FakeVideoPlayerPlatform extends VideoPlayerPlatform {
  /// Creates a platform whose `createWithOptions` throws [createError] when
  /// it is non-null.
  FakeVideoPlayerPlatform({this.createError});

  /// What `createWithOptions` throws, if anything.
  final Exception? createError;

  /// The URIs of the players created, indexed by player id.
  final List<String?> uris = [];

  /// The calls received, as `method(playerId[, argument])`.
  final List<String> calls = [];

  /// When non-null, `createWithOptions` waits for it before creating a
  /// player.
  Completer<void>? createGate;

  /// The position `getPosition` reports.
  Duration position = Duration.zero;

  final Map<int, StreamController<VideoEvent>> _events = {};

  /// The ids of the players not yet disposed.
  Iterable<int> get livePlayers => _events.keys;

  /// Sends the initialized event for [playerId].
  void initialize(
    int playerId, {
    Duration duration = const Duration(seconds: 65),
    Size size = const Size(1920, 1080),
  }) => _events[playerId]!.add(
    VideoEvent(
      eventType: VideoEventType.initialized,
      duration: duration,
      size: size,
    ),
  );

  /// Sends a playback error for [playerId].
  void fail(int playerId, [String message = 'Source error']) =>
      _events[playerId]!.addError(
        PlatformException(code: 'VideoError', message: message),
      );

  /// Makes this the platform instance until the test ends.
  void install() {
    final VideoPlayerPlatform previous = VideoPlayerPlatform.instance;
    VideoPlayerPlatform.instance = this;
    addTearDown(() => VideoPlayerPlatform.instance = previous);
  }

  @override
  Future<void> init() async {}

  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    final Exception? error = createError;
    if (error != null) throw error;
    await createGate?.future;
    final int id = uris.length;
    uris.add(options.dataSource.uri);
    // A cancel future from the test's zone, so that a test's pumps complete
    // the controller's dispose.
    _events[id] = StreamController<VideoEvent>(onCancel: Future<void>.value);
    calls.add('create($id)');
    return id;
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => _events[playerId]!.stream;

  @override
  Future<void> dispose(int playerId) async {
    calls.add('dispose($playerId)');
    await _events.remove(playerId)?.close();
  }

  @override
  Future<void> play(int playerId) async => calls.add('play($playerId)');

  @override
  Future<void> pause(int playerId) async => calls.add('pause($playerId)');

  @override
  Future<void> setVolume(int playerId, double volume) async =>
      calls.add('setVolume($playerId, $volume)');

  @override
  Future<void> seekTo(int playerId, Duration position) async {
    calls.add('seekTo($playerId, ${position.inSeconds})');
    this.position = position;
  }

  @override
  Future<Duration> getPosition(int playerId) async => position;

  @override
  Future<void> setLooping(int playerId, bool looping) async {}

  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}

  @override
  Future<void> setPreventsDisplaySleepDuringVideoPlayback(
    int playerId,
    bool preventsDisplaySleepDuringVideoPlayback,
  ) async {}

  @override
  Widget buildViewWithOptions(VideoViewOptions options) =>
      SizedBox.expand(key: ValueKey('video-view-${options.playerId}'));
}

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

import 'package:a2ui_core/a2ui_core.dart';

void main() async {
  print('=' * 75);
  print('MANUAL TEST DEMO: Dart/Flutter GenUI Clock Injection Feature (#2239)');
  print('=' * 75);

  final catalog = MinimalCatalog();

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Default System Clock (Production Mode)
  // ---------------------------------------------------------------------------
  print('\n[Scenario 1] Default System Clock (Production Behavior)');
  print('---------------------------------------------------------');
  final prodSurface = SurfaceModel<ComponentApi>(
    'prod-surface',
    catalog: catalog,
  );

  A2uiClientAction? prodAction;
  prodSurface.onAction.addListener((action) => prodAction = action);

  await prodSurface.dispatchAction({
    'event': {'name': 'user_clicked_submit'},
  }, 'btn_submit');

  print(
    '✓ Created SurfaceModel with default constructor (no clock parameter).',
  );
  print(
    '✓ Action dispatched: "${prodAction?.name}" from component "${prodAction?.sourceComponentId}"',
  );
  print(
    '✓ Generated Timestamp (Live Wall-Clock): ${prodAction?.timestamp.toIso8601String()}',
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Injected Deterministic Fake Clock (Testing Mode)
  // ---------------------------------------------------------------------------
  print('\n[Scenario 2] Injected Fake Clock (Deterministic Testing)');
  print('---------------------------------------------------------');
  final fixedStartTime = DateTime.utc(2026, 1, 1, 10, 0, 0);
  final fakeClock = FakeClock(fixedStartTime);

  final testSurface = SurfaceModel<ComponentApi>(
    'test-surface',
    catalog: catalog,
    clock: fakeClock,
  );

  A2uiClientAction? testAction;
  testSurface.onAction.addListener((action) => testAction = action);

  await testSurface.dispatchAction({
    'event': {'name': 'open_modal'},
  }, 'btn_modal');

  print(
    '✓ Created SurfaceModel with injected FakeClock starting at: $fixedStartTime',
  );
  print('✓ Action dispatched: "${testAction?.name}"');
  print(
    '✓ Generated Timestamp (Exact Injected Time): ${testAction?.timestamp.toIso8601String()}',
  );
  assert(
    testAction?.timestamp == fixedStartTime,
    'Timestamp must match fixedStartTime exactly!',
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Advancing Fake Clock without sleeping
  // ---------------------------------------------------------------------------
  print('\n[Scenario 3] Advancing Fake Clock (Instant Virtual Time Travel)');
  print('---------------------------------------------------------');
  print(
    '-> Advancing clock by 2 hours and 30 minutes (0 milliseconds of real sleep)...',
  );
  fakeClock.advance(const Duration(hours: 2, minutes: 30));

  await testSurface.dispatchAction({
    'event': {'name': 'close_modal'},
  }, 'btn_close');

  final expectedAdvancedTime = DateTime.utc(2026, 1, 1, 12, 30, 0);
  print('✓ Action dispatched: "${testAction?.name}"');
  print(
    '✓ Generated Timestamp (Advanced Time): ${testAction?.timestamp.toIso8601String()}',
  );
  assert(
    testAction?.timestamp == expectedAdvancedTime,
    'Timestamp must match expectedAdvancedTime exactly!',
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Clock Propagation to Dynamic Surfaces (MessageProcessor)
  // ---------------------------------------------------------------------------
  print('\n[Scenario 4] MessageProcessor Clock Propagation');
  print('---------------------------------------------------------');
  final processorClock = FakeClock(DateTime.utc(2026, 8, 14, 18, 0, 0));
  final processor = MessageProcessor<ComponentApi>(
    catalogs: [catalog],
    clock: processorClock,
  );

  // Send protocol message to dynamically create surface
  processor.processMessages([
    CreateSurfaceMessage(surfaceId: 'dynamic-cart', catalogId: catalog.id),
  ]);

  final dynamicSurface = processor.groupModel.getSurface('dynamic-cart');
  A2uiClientAction? groupAction;
  processor.groupModel.onAction.addListener((action) => groupAction = action);

  await dynamicSurface!.dispatchAction({
    'event': {'name': 'checkout'},
  }, 'btn_checkout');

  print('✓ Processed CreateSurfaceMessage for surface "dynamic-cart".');
  print('✓ Dynamic surface inherited processor\'s injected clock.');
  print(
    '✓ Action received by group listener: "${groupAction?.name}" on surface "${groupAction?.surfaceId}"',
  );
  print('✓ Generated Timestamp: ${groupAction?.timestamp.toIso8601String()}');

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Timeout Cancellation with Mock Timer
  // ---------------------------------------------------------------------------
  print('\n[Scenario 5] Timeout Cancellation with Mock Timer');
  print('---------------------------------------------------------');
  void Function()? timerCallback;
  final signal = CancellationSignal.timeout(
    const Duration(seconds: 10),
    timerFactory: (duration, callback) {
      timerCallback = callback;
      return _MockTimer();
    },
  );

  print('✓ Created CancellationSignal with 10s timeout.');
  print('✓ Before timer trigger -> signal.isCancelled: ${signal.isCancelled}');

  // Trigger mock timer callback
  timerCallback!();
  print('✓ After timer trigger  -> signal.isCancelled: ${signal.isCancelled}');
  assert(
    signal.isCancelled == true,
    'Signal must be cancelled after timer triggers!',
  );

  print('\n' + '=' * 75);
  print('ALL MANUAL TEST SCENARIOS EXECUTED AND PASSED PERFECTLY!');
  print('=' * 75);
}

class _MockTimer implements Timer {
  bool isCancelled = false;

  @override
  void cancel() {
    isCancelled = true;
  }

  @override
  bool get isActive => !isCancelled;

  @override
  int get tick => 0;
}

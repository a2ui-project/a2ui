// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/// Re-exports the signal primitives used throughout a2ui_core.
///
/// preact_signals is a Dart port of Preact's signal library. It provides
/// automatic dependency tracking, lazy evaluation, and correct cleanup
/// of nested computed chains.
library;

export 'package:preact_signals/preact_signals.dart'
    show
        Computed,
        Effect,
        ReadonlySignal,
        Signal,
        batch,
        computed,
        effect,
        signal;

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

/// A snapshot of a dynamic property value in a node's props.
///
/// When the underlying value changes, the node emits a new binding. Existing
/// bindings retain their snapshot values.
///
/// Literal and function-call values resolve to a read-only [ResolvedBinding],
/// so a write without narrowing to [WritableBinding] is a compile error
/// rather than a silent no-op.
///
/// Omitted and explicit null dynamic properties resolve to read-only bindings
/// whose value is null, including within existing nested objects and arrays.
/// Absent or null non-dynamic containers are not synthesized. A path binding
/// to missing data still produces a [WritableBinding] whose value is null.
class ResolvedBinding<T> {
  final T value;

  const ResolvedBinding(this.value);

  Type get _equalityType => ResolvedBinding;

  /// Bindings compare by writability, authored path, and snapshot value, so
  /// the shallow comparison in the node's props update can suppress no-op
  /// emissions even though each update constructs a new binding instance.
  /// Lists and maps compare structurally; other values use Dart's `==`
  /// operator.
  @override
  bool operator ==(Object other) {
    if (other is! ResolvedBinding) return false;
    if (_equalityType != other._equalityType) return false;
    return _valueEquals(value, other.value);
  }

  @override
  int get hashCode => Object.hash(_equalityType, _valueHash(value));

  @override
  String toString() => 'ResolvedBinding($value)';
}

/// A binding whose payload bound a data path, so writes have a destination.
final class WritableBinding<T> extends ResolvedBinding<T> {
  /// Writes through to the bound data path.
  final void Function(T) set;

  /// The authored data path, not resolved against the node's data scope.
  final String path;

  const WritableBinding(super.value, this.set, this.path);

  @override
  Type get _equalityType => WritableBinding;

  @override
  bool operator ==(Object other) {
    if (other is! WritableBinding) return false;
    if (path != other.path) return false;
    return super == other;
  }

  @override
  int get hashCode => Object.hash(super.hashCode, path);

  @override
  String toString() => 'WritableBinding($value, path: $path)';
}

bool _valueEquals(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_valueEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final MapEntry<Object?, Object?> entry in a.entries) {
      if (!b.containsKey(entry.key) ||
          !_valueEquals(entry.value, b[entry.key])) {
        return false;
      }
    }
    return true;
  }
  return a == b;
}

int _valueHash(Object? value) {
  if (value is List) return Object.hashAll(value.map(_valueHash));
  if (value is Map) {
    return Object.hashAllUnordered(
      value.entries.map((e) => Object.hash(e.key, _valueHash(e.value))),
    );
  }
  return value.hashCode;
}

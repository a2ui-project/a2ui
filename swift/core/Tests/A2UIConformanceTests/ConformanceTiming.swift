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

import Foundation

/// Writes the payloads of the conformance timing cases and times the calls they make, as
/// `conformance/agent/direct_json/scaling.yaml` describes.
///
/// The timing cases are slow and depend on the machine and its load, so they run only when the
/// `A2UI_RUN_TIMING` environment variable is `1`, apart from the other tests:
///
/// ```bash
/// A2UI_RUN_TIMING=1 swift test -c release -Xswiftc -enable-testing \
///   --filter MessageProcessorScalingConformanceTests
/// ```
///
/// `A2UI_TIMING_RUNS` sets how many times each call is timed, and `A2UI_TIMING_CASE` runs only
/// the cases whose name contains its value.
public enum ConformanceTiming {
  /// Whether the timing cases run, which the `A2UI_RUN_TIMING` environment variable asks for.
  public static var isEnabled: Bool {
    ProcessInfo.processInfo.environment["A2UI_RUN_TIMING"] == "1"
  }

  /// How many times each call is timed: 5, or the value of the `A2UI_TIMING_RUNS` environment
  /// variable.
  public static var runs: Int {
    ProcessInfo.processInfo.environment["A2UI_TIMING_RUNS"].flatMap { Int($0) }.map { max($0, 1) }
      ?? 5
  }

  /// Whether the timing case named `name` runs: every case, or those whose name contains the
  /// value of the `A2UI_TIMING_CASE` environment variable.
  public static func runsCase(named name: String) -> Bool {
    guard let filter = ProcessInfo.processInfo.environment["A2UI_TIMING_CASE"], !filter.isEmpty
    else { return true }
    return name.contains(filter)
  }

  /// The median times of two calls and their ratio.
  public struct Result: Sendable {
    /// The median time of the baseline call.
    public let baseline: Duration
    /// The median time of the measured call.
    public let measured: Duration

    /// The measured median time divided by the baseline one.
    public var ratio: Double {
      let baselineSeconds = Self.seconds(baseline)
      return baselineSeconds > 0 ? Self.seconds(measured) / baselineSeconds : .infinity
    }

    private static func seconds(_ duration: Duration) -> Double {
      let components = duration.components
      return Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
  }

  /// Writes the payload of a timing case at `size`, as `PayloadTemplate` in
  /// `conformance/conformance_schema.json` describes.
  ///
  /// A string segment is written as it is. A `repeat` segment is written `size` times, with
  /// `{i}` replaced by the index of each copy and the copies joined by its `separator`.
  public static func writePayload(_ template: [Any], size: Int) throws -> String {
    var written = ""
    for segment in template {
      if let text = segment as? String {
        written += text
      } else if let repeated = segment as? [String: Any], let text = repeated["repeat"] as? String {
        let separator = repeated["separator"] as? String ?? ""
        written += (0..<size).map { text.replacingOccurrences(of: "{i}", with: "\($0)") }
          .joined(separator: separator)
      } else {
        throw ConformanceTimingError("Unknown payload segment: \(segment)")
      }
    }
    return written
  }

  /// Times `measured` against `baseline`: each runs once untimed, so that whatever runs on first
  /// use has run, then the two run in turn `runs` times each and their median times are compared.
  @MainActor
  public static func compare(
    measured: () throws -> Void,
    baseline: () throws -> Void,
    runs: Int = runs
  ) throws -> Result {
    try baseline()
    try measured()
    var baselineTimes: [Duration] = []
    var measuredTimes: [Duration] = []
    let clock = ContinuousClock()
    for _ in 0..<runs {
      baselineTimes.append(try clock.measure(baseline))
      measuredTimes.append(try clock.measure(measured))
    }
    return Result(baseline: median(baselineTimes), measured: median(measuredTimes))
  }

  private static func median(_ times: [Duration]) -> Duration {
    let sorted = times.sorted()
    return sorted[sorted.count / 2]
  }
}

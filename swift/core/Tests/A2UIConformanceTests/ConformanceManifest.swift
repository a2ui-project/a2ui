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
import Testing

/// Appends executed conformance test case records to a JSON Lines manifest file when
/// `A2UI_CONFORMANCE_MANIFEST_DIR` is set in the process environment.
public enum ConformanceManifest {
  /// Execution outcome recorded for a single conformance test case.
  public enum Status: String, Sendable {
    case passed
    case failed
    case skipped
    case xfailed
  }

  private static let harnessName = "swift-core"
  private static let lock = NSLock()

  /// Records the execution status of `testCase` to the manifest file if configured.
  public static func record(
    _ testCase: ConformanceCase,
    status: Status,
    reason: String? = nil
  ) {
    record(suite: testCase.suite, name: testCase.name, status: status, reason: reason)
  }

  /// Records the execution status of `(suite, name)` to the manifest file if configured.
  public static func record(
    suite: String,
    name: String,
    status: Status,
    reason: String? = nil
  ) {
    guard
      let manifestDir = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_MANIFEST_DIR"],
      !manifestDir.isEmpty
    else {
      return
    }

    var entry: [String: String] = [
      "harness": harnessName,
      "suite": suite,
      "case": name,
      "status": status.rawValue,
    ]
    if let reason, !reason.isEmpty {
      entry["reason"] = reason
    }

    guard
      let jsonData = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]),
      var lineData = String(data: jsonData, encoding: .utf8)?.data(using: .utf8)
    else {
      return
    }
    lineData.append(0x0A)

    lock.lock()
    defer { lock.unlock() }

    let dirURL = URL(fileURLWithPath: manifestDir, isDirectory: true)
    try? FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
    let pid = ProcessInfo.processInfo.processIdentifier
    let fileURL = dirURL.appendingPathComponent("\(harnessName)-\(pid).jsonl")

    if FileManager.default.fileExists(atPath: fileURL.path) {
      if let handle = try? FileHandle(forWritingTo: fileURL) {
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: lineData)
      }
    } else {
      try? lineData.write(to: fileURL, options: .atomic)
    }
  }

  /// Executes `body` for `testCase` and records the outcome in the conformance manifest.
  public static func run(
    _ testCase: ConformanceCase,
    skippedReason: String? = nil,
    knownIssueReason: String? = nil,
    body: () throws -> Void
  ) throws {
    if let skippedReason {
      record(testCase, status: .skipped, reason: skippedReason)
      return
    }
    if let knownIssueReason {
      withKnownIssue(Comment(rawValue: knownIssueReason)) {
        do {
          try body()
        } catch {
          Issue.record(error)
        }
      }
      record(testCase, status: .xfailed, reason: knownIssueReason)
      return
    }
    do {
      try body()
      record(testCase, status: .passed)
    } catch {
      record(testCase, status: .failed, reason: String(describing: error))
      throw error
    }
  }

  /// Executes an asynchronous `body` for `testCase` and records the outcome in the manifest.
  public static func runAsync(
    _ testCase: ConformanceCase,
    skippedReason: String? = nil,
    knownIssueReason: String? = nil,
    body: () async throws -> Void
  ) async throws {
    if let skippedReason {
      record(testCase, status: .skipped, reason: skippedReason)
      return
    }
    if let knownIssueReason {
      await withKnownIssue(Comment(rawValue: knownIssueReason)) {
        do {
          try await body()
        } catch {
          Issue.record(error)
        }
      }
      record(testCase, status: .xfailed, reason: knownIssueReason)
      return
    }
    do {
      try await body()
      record(testCase, status: .passed)
    } catch {
      record(testCase, status: .failed, reason: String(describing: error))
      throw error
    }
  }
}

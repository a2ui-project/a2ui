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

private final class IssueTracker: @unchecked Sendable {
  private let lock = NSLock()
  private var _hasRecordedIssue = false
  private var _firstFailureReason: String?
  private var _unknownKeyError: UnknownConformanceKeyError?

  var hasRecordedIssue: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _hasRecordedIssue
  }

  var firstFailureReason: String? {
    lock.lock()
    defer { lock.unlock() }
    return _firstFailureReason
  }

  var unknownKeyError: UnknownConformanceKeyError? {
    lock.lock()
    defer { lock.unlock() }
    return _unknownKeyError
  }

  func recordIssue(_ issue: Issue) {
    lock.lock()
    defer { lock.unlock() }
    _hasRecordedIssue = true
    if _firstFailureReason == nil {
      _firstFailureReason = String(describing: issue)
    }
  }

  func recordUnknownKey(_ error: UnknownConformanceKeyError) {
    lock.lock()
    defer { lock.unlock() }
    if _unknownKeyError == nil {
      _unknownKeyError = error
    }
    if _firstFailureReason == nil {
      _firstFailureReason = error.description
    }
  }
}

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
      var lineData = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
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
    let tracker = IssueTracker()
    if let knownIssueReason {
      withKnownIssue(Comment(rawValue: knownIssueReason), isIntermittent: true) {
        do {
          try body()
        } catch {
          Issue.record(error)
        }
      } matching: { issue in
        if let unknownKeyError = issue.error as? UnknownConformanceKeyError {
          tracker.recordUnknownKey(unknownKeyError)
          return false
        }
        tracker.recordIssue(issue)
        return true
      }
      if let unknownKeyError = tracker.unknownKeyError {
        record(testCase, status: .failed, reason: unknownKeyError.description)
        return
      }
      if tracker.hasRecordedIssue {
        record(testCase, status: .xfailed, reason: knownIssueReason)
      } else {
        let message = "Known issue was not recorded: \(knownIssueReason)"
        Issue.record(Comment(rawValue: message))
        record(testCase, status: .failed, reason: message)
      }
      return
    }
    withKnownIssue(isIntermittent: true) {
      do {
        try body()
      } catch {
        Issue.record(error)
      }
    } matching: { issue in
      if let unknownKeyError = issue.error as? UnknownConformanceKeyError {
        tracker.recordUnknownKey(unknownKeyError)
      } else {
        tracker.recordIssue(issue)
      }
      return false
    }
    if let failureReason = tracker.firstFailureReason {
      record(testCase, status: .failed, reason: failureReason)
      return
    }
    record(testCase, status: .passed)
  }

  /// Executes an asynchronous `body` for `testCase` and records the outcome in the manifest.
  @MainActor
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
    let tracker = IssueTracker()
    if let knownIssueReason {
      await withKnownIssue(Comment(rawValue: knownIssueReason), isIntermittent: true) {
        do {
          try await body()
        } catch {
          Issue.record(error)
        }
      } matching: { issue in
        if let unknownKeyError = issue.error as? UnknownConformanceKeyError {
          tracker.recordUnknownKey(unknownKeyError)
          return false
        }
        tracker.recordIssue(issue)
        return true
      }
      if let unknownKeyError = tracker.unknownKeyError {
        record(testCase, status: .failed, reason: unknownKeyError.description)
        return
      }
      if tracker.hasRecordedIssue {
        record(testCase, status: .xfailed, reason: knownIssueReason)
      } else {
        let message = "Known issue was not recorded: \(knownIssueReason)"
        Issue.record(Comment(rawValue: message))
        record(testCase, status: .failed, reason: message)
      }
      return
    }
    await withKnownIssue(isIntermittent: true) {
      do {
        try await body()
      } catch {
        Issue.record(error)
      }
    } matching: { issue in
      if let unknownKeyError = issue.error as? UnknownConformanceKeyError {
        tracker.recordUnknownKey(unknownKeyError)
      } else {
        tracker.recordIssue(issue)
      }
      return false
    }
    if let failureReason = tracker.firstFailureReason {
      record(testCase, status: .failed, reason: failureReason)
      return
    }
    record(testCase, status: .passed)
  }
}

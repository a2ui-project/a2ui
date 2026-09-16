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

/// Discovers and parses specification sample stream resources at runtime from the app bundle.
public enum SampleLoader: Sendable {

  /// Scans the application bundle for copied specification example folders (`examples` and `cases`),
  /// parsing `.json` message array files and `.jsonl` streaming files into structured ``SampleStream`` instances.
  public static func loadAllSamples() -> [SampleStream] {
    var streams: [SampleStream] = []
    let fm = FileManager.default

    // Search for copied folder reference named "examples" (from specification/v0_9_1/catalogs/basic/examples)
    if let examplesURL = Bundle.main.url(forResource: "examples", withExtension: nil)
      ?? findSubdirectory(named: "examples", in: Bundle.main.bundleURL)
    {
      if let files = try? fm.contentsOfDirectory(at: examplesURL, includingPropertiesForKeys: nil) {
        let jsonFiles = files.filter { $0.pathExtension.lowercased() == "json" }.sorted {
          $0.lastPathComponent < $1.lastPathComponent
        }
        for url in jsonFiles {
          if let stream = parseJSONExampleFile(at: url) {
            streams.append(stream)
          }
        }
      }
    }

    // Search for copied folder reference named "cases" (from specification/v0_9_1/test/cases)
    if let casesURL = Bundle.main.url(forResource: "cases", withExtension: nil)
      ?? findSubdirectory(named: "cases", in: Bundle.main.bundleURL)
    {
      if let files = try? fm.contentsOfDirectory(at: casesURL, includingPropertiesForKeys: nil) {
        let jsonlFiles = files.filter { $0.pathExtension.lowercased() == "jsonl" }.sorted {
          $0.lastPathComponent < $1.lastPathComponent
        }
        for url in jsonlFiles {
          if let stream = parseJSONLStreamFile(at: url) {
            streams.append(stream)
          }
        }
      }
    }

    return streams
  }

  // MARK: - Private Helpers

  private static func findSubdirectory(named name: String, in root: URL) -> URL? {
    let fm = FileManager.default
    guard let enumerator = fm.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey])
    else {
      return nil
    }
    for case let url as URL in enumerator {
      if url.lastPathComponent == name {
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
          return url
        }
      }
    }
    return nil
  }

  private static func parseJSONExampleFile(at url: URL) -> SampleStream? {
    guard let data = try? Data(contentsOf: url),
      let jsonObject = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }

    let rawSlug = url.deletingPathExtension().lastPathComponent
    let title =
      (jsonObject["name"] as? String)
      ?? rawSlug.replacingOccurrences(of: "_", with: " ").capitalized
    let description = jsonObject["description"] as? String

    guard let messagesArray = jsonObject["messages"] as? [Any] else {
      return nil
    }

    var messageLines: [String] = []
    for msg in messagesArray {
      if let msgData = try? JSONSerialization.data(withJSONObject: msg, options: []),
        let msgString = String(data: msgData, encoding: .utf8)
      {
        messageLines.append(msgString)
      }
    }

    guard !messageLines.isEmpty else { return nil }

    return SampleStream(
      id: "json-\(rawSlug)",
      title: title,
      description: description,
      category: .basicCatalog,
      rawMessages: messageLines
    )
  }

  private static func parseJSONLStreamFile(at url: URL) -> SampleStream? {
    guard let content = try? String(contentsOf: url, encoding: .utf8) else {
      return nil
    }

    let lines = content.components(separatedBy: .newlines)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }

    guard !lines.isEmpty else { return nil }

    let rawSlug = url.deletingPathExtension().lastPathComponent
    let title = rawSlug.replacingOccurrences(of: "_", with: " ").capitalized
    let description = "JSON Lines message stream case (\(rawSlug).jsonl)"

    return SampleStream(
      id: "jsonl-\(rawSlug)",
      title: title,
      description: description,
      category: .testCases,
      rawMessages: lines
    )
  }
}

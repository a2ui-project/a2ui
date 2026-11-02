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

  /// Scans the application bundle for copied specification example folders (`examples/v0_9_1`,
  /// `examples/v1_0`, and `cases`), parsing `.json` message files and `.jsonl` streaming files into
  /// structured ``SampleStream`` instances.
  public static func loadAllSamples() -> [SampleStream] {
    loadSamples(in: Bundle.main.bundleURL)
  }

  /// Scans the given bundle root directory for v0.9.1 and v1.0 basic catalog examples and test
  /// case streams.
  public static func loadSamples(in bundleURL: URL) -> [SampleStream] {
    var streams: [SampleStream] = []

    let v091ExamplesURL =
      directoryIfExists(at: bundleURL.appendingPathComponent("examples/v0_9_1/examples"))
      ?? directoryIfExists(at: bundleURL.appendingPathComponent("examples"))
    if let v091ExamplesURL {
      streams.append(
        contentsOf: loadJSONExamples(
          in: v091ExamplesURL, protocolVersion: .v091, idPrefix: "v0_9_1")
      )
    }

    if let v10ExamplesURL = directoryIfExists(
      at: bundleURL.appendingPathComponent("examples/v1_0/examples")
    ) {
      streams.append(
        contentsOf: loadJSONExamples(in: v10ExamplesURL, protocolVersion: .v10, idPrefix: "v1_0")
      )
    }

    let casesURL =
      directoryIfExists(at: bundleURL.appendingPathComponent("cases"))
      ?? findSubdirectory(named: "cases", in: bundleURL)
    if let casesURL {
      streams.append(contentsOf: loadJSONLCases(in: casesURL))
    }

    return streams
  }

  // MARK: - Private Helpers

  private static func directoryIfExists(at url: URL) -> URL? {
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue
    else {
      return nil
    }
    return url
  }

  private static func loadJSONExamples(
    in directoryURL: URL,
    protocolVersion: SampleStream.ProtocolVersion,
    idPrefix: String
  ) -> [SampleStream] {
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: directoryURL,
        includingPropertiesForKeys: nil
      )
    else {
      return []
    }
    let jsonFiles =
      files
      .filter { $0.pathExtension.lowercased() == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    return jsonFiles.compactMap { url in
      parseJSONExampleFile(at: url, protocolVersion: protocolVersion, idPrefix: idPrefix)
    }
  }

  private static func loadJSONLCases(in directoryURL: URL) -> [SampleStream] {
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: directoryURL,
        includingPropertiesForKeys: nil
      )
    else {
      return []
    }
    let jsonlFiles =
      files
      .filter { $0.pathExtension.lowercased() == "jsonl" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    return jsonlFiles.compactMap { parseJSONLStreamFile(at: $0) }
  }

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

  private static func parseJSONExampleFile(
    at url: URL,
    protocolVersion: SampleStream.ProtocolVersion,
    idPrefix: String
  ) -> SampleStream? {
    guard let data = try? Data(contentsOf: url),
      let json = try? JSONSerialization.jsonObject(with: data)
    else {
      return nil
    }

    let rawSlug = url.deletingPathExtension().lastPathComponent
    let fallbackTitle = rawSlug.replacingOccurrences(of: "_", with: " ").capitalized
    let title: String
    let description: String?
    let messagesArray: [Any]

    if let jsonObject = json as? [String: Any],
      let messages = jsonObject["messages"] as? [Any]
    {
      title = (jsonObject["name"] as? String) ?? fallbackTitle
      description = jsonObject["description"] as? String
      messagesArray = messages
    } else if let array = json as? [Any] {
      title = fallbackTitle
      description = nil
      messagesArray = array
    } else {
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
      id: "\(idPrefix)-\(rawSlug)",
      fileName: url.lastPathComponent,
      title: title,
      description: description,
      protocolVersion: protocolVersion,
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
      fileName: url.lastPathComponent,
      title: title,
      description: description,
      protocolVersion: .v091,
      category: .testCases,
      rawMessages: lines
    )
  }
}

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

import A2UICore
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Combine
import Foundation

/// A diagnostic log entry recorded during interactive stream step-through.
public struct DiagnosticLogEntry: Identifiable, Hashable, Sendable {
  public let id = UUID()
  public let timestamp = Date()
  public let type: LogType
  public let message: String

  public enum LogType: String, Sendable {
    case action = "Action"
    case error = "Validation / Error"
    case info = "Info"
  }
}

/// A dedicated nonisolated action handler bridging callbacks from the engine into `@MainActor` state updates.
final class GalleryActionHandler: ActionHandling, @unchecked Sendable {
  weak var viewModel: GalleryViewModel?

  func handle(action: ResolvedAction, from surfaceID: String) {
    let desc: String
    switch action.identity {
    case .event(let name, _):
      desc = "event=\(name)"
    case .function(let call, _):
      desc = "function=\(call)"
    }
    let entry = DiagnosticLogEntry(
      type: .action,
      message: "Action dispatched on surface '\(surfaceID)': \(desc)"
    )
    Task { @MainActor [weak self] in
      self?.viewModel?.appendLogEntry(entry)
    }
  }

  func handle(error: ClientServerError, from surfaceID: String) {
    let text: String
    switch error {
    case .validationFailed(let err):
      text = "[Validation] path=\(err.path), msg=\(err.message)"
    case .generic(let err):
      text = "[Error \(err.code)] \(err.message)"
    }
    let entry = DiagnosticLogEntry(
      type: .error,
      message: "Surface '\(surfaceID)': \(text)"
    )
    Task { @MainActor [weak self] in
      self?.viewModel?.appendLogEntry(entry)
    }
  }
}

/// The state controller driving interactive sample exploration in the Gallery app.
@MainActor
public final class GalleryViewModel: @unchecked Sendable, ObservableObject {

  @Published public var sampleStreams: [SampleStream] = []
  @Published public var selectedSample: SampleStream? = nil {
    didSet {
      if oldValue?.id != selectedSample?.id {
        resetStream()
      }
    }
  }

  @Published public private(set) var currentStepIndex: Int = 0
  @Published public private(set) var activeSurfaceViewModel: SurfaceViewModel? = nil
  @Published public private(set) var logEntries: [DiagnosticLogEntry] = []
  @Published public private(set) var dataModelString: String = "{}"

  public let catalogs: [Catalog<ComponentImplementation>]
  private var processor: MessageProcessor
  private let parser = MessageParser()
  private var surfaceSubscription: AnyCancellable?
  private let handler = GalleryActionHandler()

  public init() {
    self.catalogs = BasicCatalogImplementation.allCatalogs
    self.processor = MessageProcessor(
      catalogs: BasicCatalog.allCatalogs,
      actionHandler: self.handler
    )
    self.handler.viewModel = self
    self.loadStreams()
  }

  /// Reloads available sample streams from runtime bundle resources.
  public func loadStreams() {
    let loaded = SampleLoader.loadAllSamples()
    self.sampleStreams = loaded
    if selectedSample == nil, let first = loaded.first {
      self.selectedSample = first
    }
  }

  /// Resets the current stream state and restarts evaluation from message index 0.
  public func resetStream() {
    surfaceSubscription?.cancel()
    surfaceSubscription = nil

    self.processor = MessageProcessor(
      catalogs: BasicCatalog.allCatalogs,
      actionHandler: self.handler
    )
    self.currentStepIndex = 0
    self.activeSurfaceViewModel = nil
    self.dataModelString = "{}"
    self.logEntries = [
      DiagnosticLogEntry(
        type: .info,
        message:
          "Stream reset. Ready to process step 1 of \(selectedSample?.rawMessages.count ?? 0)."
      )
    ]
  }

  /// Advances stream processing by exactly one message step.
  public func advanceStep() {
    guard let sample = selectedSample, currentStepIndex < sample.rawMessages.count else {
      return
    }

    let rawMessage = sample.rawMessages[currentStepIndex]
    do {
      let message = try parser.parse(jsonString: rawMessage)
      processor.process(message: message)
    } catch {
      // Errors from processor are reported to GalleryActionHandler;
      // unhandled parse errors are logged here.
      if error is MessageParseError {
        appendLogEntry(
          DiagnosticLogEntry(
            type: .error,
            message: "JSON Parse Error: \(error.localizedDescription)"
          )
        )
      }
    }

    currentStepIndex += 1
    updateActiveSurfaceObservation()
  }

  /// Evaluates all remaining messages in the currently selected sample stream.
  public func playRemaining() {
    guard let sample = selectedSample else { return }
    while currentStepIndex < sample.rawMessages.count {
      advanceStep()
    }
  }

  public func appendLogEntry(_ entry: DiagnosticLogEntry) {
    self.logEntries.append(entry)
  }

  private func updateActiveSurfaceObservation() {
    if activeSurfaceViewModel == nil,
      let firstSurface = processor.surfaceGroupModel.surfacesMap.values.first
    {
      activeSurfaceViewModel = firstSurface
      firstSurface.actionHandler = self.handler

      surfaceSubscription = firstSurface.dataModel.dataPublisher
        .sink { [weak self] newJSON in
          Task { @MainActor in
            self?.updateDataModelString(from: newJSON)
          }
        }
    }
    if let currentData = activeSurfaceViewModel?.dataModel.data {
      updateDataModelString(from: currentData)
    }
  }

  private func updateDataModelString(from json: Any) {
    let text = "\(json)"
    if text == "object([:])" || text == "object(OrderedDictionary())" || text.isEmpty {
      self.dataModelString = "{}"
    } else {
      self.dataModelString = text
    }
  }
}

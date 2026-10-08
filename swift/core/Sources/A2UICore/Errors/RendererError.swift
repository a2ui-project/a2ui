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

/// Encapsulates all renderer-to-agent error types.
public enum RendererError: Equatable, Codable, Sendable, ProtocolVersioned {
  case validationFailed(ValidationFailedError)
  case generic(GenericError)

  private enum CodingKeys: String, CodingKey {
    case code
  }

  public init(from decoder: Decoder, version: A2UIProtocolVersion) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let code = try container.decode(String.self, forKey: .code)
    if ValidationFailedError.Code(rawValue: code) != nil {
      self = .validationFailed(try ValidationFailedError(from: decoder, version: version))
    } else {
      self = .generic(try GenericError(from: decoder, version: version))
    }
  }

  /// The protocol version for the outbound message envelope.
  public var version: A2UIProtocolVersion {
    get {
      switch self {
      case .validationFailed(let validation):
        return validation.version
      case .generic(let generic):
        return generic.version
      }
    }
    set {
      switch self {
      case .validationFailed(var validation):
        validation.version = newValue
        self = .validationFailed(validation)
      case .generic(var generic):
        generic.version = newValue
        self = .generic(generic)
      }
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .validationFailed(let validation):
      try container.encode(validation)
    case .generic(let generic):
      try container.encode(generic)
    }
  }
}

// MARK: - Deprecated Typealiases

@available(*, deprecated, renamed: "RendererError")
public typealias ClientServerError = RendererError

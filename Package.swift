// swift-tools-version: 6.1
// The swift-tools-version declares the minimum version of Swift required to build this package.

// Copyright 2026 Google LLC
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

import PackageDescription

let package = Package(
  name: "A2UISwiftCore",
  platforms: [
    .iOS(.v16),
    .macOS(.v13),
  ],
  products: [
    .library(
      name: "A2UISwiftCore",
      targets: ["A2UIJSON", "A2UICore"]
    ),
    .library(
      name: "A2UISwiftUI",
      targets: ["A2UISwiftUI"]
    ),
  ],
  dependencies: [
    .package(
      url: "https://github.com/ajevans99/swift-json-schema",
      from: "0.13.1"
    )
  ],
  targets: [
    // ── Core ──
    .target(
      name: "A2UIJSON",
      dependencies: [
        .product(name: "JSONSchema", package: "swift-json-schema"),
        .product(
          name: "OrderedJSON",
          package: "swift-json-schema"
        ),
      ],
      path: "swift/core/Sources/A2UIJSON"
    ),
    .target(
      name: "A2UICore",
      dependencies: [
        "A2UIJSON",
        .product(name: "JSONSchema", package: "swift-json-schema"),
        .product(
          name: "OrderedJSON",
          package: "swift-json-schema"
        ),
      ],
      path: "swift/core/Sources/A2UICore"
    ),

    // ── SwiftUI ──
    .target(
      name: "A2UISwiftUI",
      dependencies: ["A2UICore"],
      path: "swift/swiftui/Sources/A2UISwiftUI"
    ),

    // ── Sample Client ──
    .executableTarget(
      name: "A2UISampleClient",
      dependencies: ["A2UISwiftUI", "A2UICore"],
      path: "swift/sample/Sources/A2UISampleClient"
    ),

    // ── Tests ──
    .testTarget(
      name: "A2UIJSONTests",
      dependencies: ["A2UIJSON"],
      path: "swift/core/Tests/A2UIJSONTests"
    ),
    .testTarget(
      name: "A2UICoreTests",
      dependencies: ["A2UICore", "A2UIJSON"],
      path: "swift/core/Tests/A2UICoreTests"
    ),
    .testTarget(
      name: "A2UISwiftUITests",
      dependencies: ["A2UISwiftUI", "A2UICore"],
      path: "swift/swiftui/Tests/A2UISwiftUITests"
    ),
  ]
)

// swift-tools-version: 6.0
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
    .iOS(.v16)
  ],
  products: [
    .library(
      name: "A2UISwiftCore",
      targets: ["JSONSchema"]
    )
  ],
  dependencies: [],
  targets: [
    .target(
      name: "JSONSchema",
      dependencies: [],
      path: "swift/core/JSONSchema/Sources"
    ),
    .testTarget(
      name: "JSONSchemaTests",
      dependencies: [
        "JSONSchema"
      ],
      path: "swift/core/JSONSchema/Tests"
    ),
  ]
)

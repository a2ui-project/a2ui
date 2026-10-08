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
import PackagePlugin

/// SwiftPM build tool plugin that invokes `A2UISchemaGenerator` to generate
/// `A2UIJSON` and `BasicCatalog` schema definitions from `specification/` and `catalogs/`.
@main
struct A2UISchemaGeneratorPlugin: BuildToolPlugin {
  func createBuildCommands(
    context: PluginContext,
    target: Target
  ) throws -> [Command] {
    let repoRoot = context.package.directoryURL
    let inputRelativePaths = [
      "specification/v0_9_1/json/common_types.json",
      "specification/v0_9_1/json/server_to_client.json",
      "specification/v0_9_1/json/client_to_server.json",
      "specification/v0_9_1/json/client_capabilities.json",
      "specification/v0_9_1/catalogs/basic/catalog.json",
      "specification/v1_0/json/common_types.json",
      "specification/v1_0/json/catalog_definition.json",
      "specification/v1_0/json/agent_to_renderer.json",
      "specification/v1_0/json/renderer_to_agent.json",
      "specification/v1_0/json/renderer_capabilities.json",
      "catalogs/basic/v1/catalog.json",
    ]
    let inputFiles = inputRelativePaths.map {
      repoRoot.appending(path: $0)
    }

    let outputFileName: String
    switch target.name {
    case "A2UIJSON":
      outputFileName = "GeneratedA2UIJSONSchemas.swift"
    case "BasicCatalog":
      outputFileName = "GeneratedBasicCatalogComponents.swift"
    default:
      return []
    }

    let outputFile = context.pluginWorkDirectoryURL.appending(path: outputFileName)
    let generatorTool = try context.tool(named: "A2UISchemaGenerator")

    return [
      .buildCommand(
        displayName: "Generating A2UI schemas for \(target.name)",
        executable: generatorTool.url,
        arguments: [
          "--target", target.name,
          "--repo-root", repoRoot.path(percentEncoded: false),
          "--output", outputFile.path(percentEncoded: false),
        ],
        inputFiles: inputFiles,
        outputFiles: [outputFile]
      )
    ]
  }
}

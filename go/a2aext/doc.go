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

// Package a2aext provides the A2UI extension, capability negotiation, and DataPart
// conversion helpers for the Agent-to-Agent (A2A) protocol in Go.
package a2aext

const (
	// A2UIExtensionBaseURI is the canonical A2A extension URI prefix for A2UI.
	A2UIExtensionBaseURI = "https://a2ui.org/a2a-extension/a2ui"
	// A2UIMIMEType is the canonical DataPart MIME type for A2UI v0.9.1 and v1.0 payloads.
	A2UIMIMEType = "application/a2ui+json"
	// DeprecatedA2UIMIMEType is the legacy DataPart MIME type for A2UI v0.8 and v0.9 payloads.
	DeprecatedA2UIMIMEType = "application/json+a2ui"
	// MIMETypeKey is the DataPart metadata key identifying the payload MIME type.
	MIMETypeKey = "mimeType"

	// AgentExtensionSupportedCatalogIDsKey lists pre-defined catalog IDs in AgentExtension.Params.
	AgentExtensionSupportedCatalogIDsKey = "supportedCatalogIds"
	// AgentExtensionAcceptsInlineCatalogsKey indicates inline catalog support in AgentExtension.Params.
	AgentExtensionAcceptsInlineCatalogsKey = "acceptsInlineCatalogs"
	// AgentExtensionDescription is the standard description advertised on A2UI AgentExtension entries.
	AgentExtensionDescription = "Provides agent driven UI using the A2UI JSON format."
)

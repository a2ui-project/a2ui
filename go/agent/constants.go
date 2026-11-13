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

package agent

const (
	// InferenceOpenTag is the sentinel opening tag for compact inference formats such as Express DSL.
	InferenceOpenTag = "<a2ui>"
	// InferenceCloseTag is the sentinel closing tag for compact inference formats such as Express DSL.
	InferenceCloseTag = "</a2ui>"

	// JSONOpenTag is the sentinel opening tag for Direct JSON blocks.
	JSONOpenTag = "<a2ui-json>"
	// JSONCloseTag is the sentinel closing tag for Direct JSON blocks.
	JSONCloseTag = "</a2ui-json>"

	// RendererCapabilitiesKey is the v1.0 transport metadata key carrying renderer capabilities.
	RendererCapabilitiesKey = "a2uiRendererCapabilities"
	// ClientCapabilitiesKey is the pre-v1.0 transport metadata key carrying client capabilities.
	ClientCapabilitiesKey = "a2uiClientCapabilities"
	// ClientDataModelKey is the transport metadata key carrying synchronized renderer data models.
	ClientDataModelKey = "a2uiClientDataModel"

	// ExamplesHeading precedes rendered few-shot examples in generated prompts and catalog skills.
	ExamplesHeading = "### Examples:"
)

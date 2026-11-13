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

package a2aext

import (
	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// RendererCapabilitiesFromMessage reads and validates renderer capabilities for version
// from an inbound A2A Message. It checks message.Metadata first, then each DataPart's
// Metadata, and finally each DataPart's Data["metadata"] (legacy fallback).
// When version is empty, it defaults to core.Version1_0.
func RendererCapabilitiesFromMessage(message *a2a.Message, version core.ProtocolVersion) (core.RendererCapabilities, error) {
	if version == "" {
		version = core.Version1_0
	}
	return rendererCapabilities(message, version)
}

func rendererCapabilities(message *a2a.Message, version core.ProtocolVersion) (core.RendererCapabilities, error) {
	if message == nil {
		return agent.ReadRendererCapabilities(nil, version)
	}

	if message.Metadata != nil {
		caps, err := agent.ReadRendererCapabilities(message.Metadata, version)
		if err != nil {
			return nil, err
		}
		if caps != nil {
			return caps, nil
		}
	}

	dataParts := dataPartsFromMessage(message)
	for _, dp := range dataParts {
		if dp.Metadata == nil {
			continue
		}
		caps, err := agent.ReadRendererCapabilities(dp.Metadata, version)
		if err != nil {
			return nil, err
		}
		if caps != nil {
			return caps, nil
		}
	}

	for _, dp := range dataParts {
		if dp.Data == nil {
			continue
		}
		legacyMeta, ok := dp.Data["metadata"].(map[string]any)
		if !ok {
			continue
		}
		caps, err := agent.ReadRendererCapabilities(legacyMeta, version)
		if err != nil {
			return nil, err
		}
		if caps != nil {
			return caps, nil
		}
	}

	return agent.ReadRendererCapabilities(nil, version)
}

func dataPartsFromMessage(message *a2a.Message) []a2a.DataPart {
	if message == nil || len(message.Parts) == 0 {
		return nil
	}
	var out []a2a.DataPart
	for _, part := range message.Parts {
		if dp, ok := extractDataPart(part); ok {
			out = append(out, dp)
		}
	}
	return out
}

func extractDataPart(part a2a.Part) (a2a.DataPart, bool) {
	switch p := part.(type) {
	case a2a.DataPart:
		return p, true
	case *a2a.DataPart:
		if p != nil {
			return *p, true
		}
	}
	return a2a.DataPart{}, false
}

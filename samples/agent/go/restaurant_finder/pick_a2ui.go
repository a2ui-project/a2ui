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

package main

import (
	"fmt"
	"strings"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/core"
)

// pickedA2UI holds the negotiated VersionProfile and requested catalog IDs for one request.
type pickedA2UI struct {
	Profile    versionProfile
	CatalogIDs []string
}

// pickA2UI negotiates the A2UI protocol version and catalog IDs from an inbound A2A Message.
// Newest version wins ("1.0" over "v0.9"). When the message carries no capabilities metadata,
// it falls back to DefaultVersionProfile ("v0.9") for compatibility with the Lit/React/Angular clients.
func pickA2UI(message *a2a.Message, extCtx a2aext.ExtensionContext, card *a2a.AgentCard) (pickedA2UI, error) {
	// Optional A2A extension activation if client requested X-A2A-Extensions.
	activatedVer, hasActivated := a2aext.ActivateExtension(extCtx, message, card)

	for i := len(servedVersions) - 1; i >= 0; i-- {
		profile := servedVersions[i]
		caps, err := a2aext.RendererCapabilitiesFromMessage(message, profile.ProtocolVersion)
		if err != nil {
			return pickedA2UI{}, err
		}
		if caps != nil {
			ids := extractSupportedCatalogIDs(caps, profile.Version)
			return pickedA2UI{Profile: profile, CatalogIDs: ids}, nil
		}
	}

	if message != nil && message.Metadata != nil {
		var named []string
		for _, p := range servedVersions {
			if raw, ok := message.Metadata[p.CapabilitiesKey].(map[string]any); ok {
				for verKey := range raw {
					named = append(named, verKey)
				}
			}
		}
		if len(named) > 0 {
			var served []string
			for _, p := range servedVersions {
				served = append(served, p.Version)
			}
			return pickedA2UI{}, fmt.Errorf(
				"the renderer supports A2UI %s, but this agent serves only %s",
				strings.Join(named, ", "),
				strings.Join(served, ", "),
			)
		}
	}

	if hasActivated {
		for _, p := range servedVersions {
			if p.ProtocolVersion == activatedVer {
				return pickedA2UI{Profile: p, CatalogIDs: []string{p.BasicCatalogID}}, nil
			}
		}
	}

	return pickedA2UI{
		Profile:    defaultVersionProfile,
		CatalogIDs: []string{defaultVersionProfile.BasicCatalogID},
	}, nil
}

func extractSupportedCatalogIDs(caps core.RendererCapabilities, versionKey string) []string {
	if entry, ok := caps[versionKey]; ok {
		return entry.SupportedCatalogIDs
	}
	for _, entry := range caps {
		return entry.SupportedCatalogIDs
	}
	return nil
}

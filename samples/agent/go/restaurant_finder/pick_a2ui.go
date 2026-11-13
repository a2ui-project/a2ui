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
	"slices"
	"strings"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// pickedA2UI holds the negotiated VersionProfile and requested catalog IDs for one request.
type pickedA2UI struct {
	Profile    versionProfile
	CatalogIDs []string
}

// pickA2UI negotiates the A2UI protocol version and catalog IDs from an inbound A2A Message.
// Newest version wins ("1.0" over "v0.9"). When the message carries no capabilities metadata,
// it falls back to extension negotiation or DefaultVersionProfile ("v0.9") for compatibility
// with the Lit/React/Angular clients.
func pickA2UI(message *a2a.Message, extCtx a2aext.ExtensionContext, card *a2a.AgentCard) (pickedA2UI, error) {
	for i := len(servedVersions) - 1; i >= 0; i-- {
		profile := servedVersions[i]
		caps, err := a2aext.RendererCapabilitiesFromMessage(message, profile.ProtocolVersion)
		if err != nil {
			return pickedA2UI{}, err
		}
		if caps != nil {
			activateProfileExtension(extCtx, message, card, profile.ProtocolVersion)
			ids := extractSupportedCatalogIDs(caps, profile.Version)
			return pickedA2UI{Profile: profile, CatalogIDs: ids}, nil
		}
	}

	if named := collectDeclaredCapabilityVersions(message); len(named) > 0 {
		served := make([]string, len(servedVersions))
		for i, p := range servedVersions {
			served[i] = p.Version
		}
		return pickedA2UI{}, fmt.Errorf(
			"the renderer supports A2UI %s, but this agent serves only %s",
			strings.Join(named, ", "),
			strings.Join(served, ", "),
		)
	}

	if activatedVer, hasActivated := a2aext.ActivateExtension(extCtx, message, card); hasActivated {
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

func activateProfileExtension(extCtx a2aext.ExtensionContext, message *a2a.Message, card *a2a.AgentCard, version core.ProtocolVersion) {
	if card == nil {
		return
	}
	targetURI := a2aext.ExtensionURI(version)
	advertised := false
	for _, ext := range card.Capabilities.Extensions {
		if ext.URI == targetURI {
			advertised = true
			break
		}
	}
	if !advertised {
		return
	}
	singleCard := &a2a.AgentCard{
		Capabilities: a2a.AgentCapabilities{
			Extensions: []a2a.AgentExtension{{URI: targetURI}},
		},
	}
	a2aext.ActivateExtension(extCtx, message, singleCard)
}

func collectDeclaredCapabilityVersions(message *a2a.Message) []string {
	if message == nil {
		return nil
	}
	var metas []map[string]any
	if message.Metadata != nil {
		metas = append(metas, message.Metadata)
	}
	var dataParts []a2a.DataPart
	for _, part := range message.Parts {
		switch p := part.(type) {
		case a2a.DataPart:
			dataParts = append(dataParts, p)
		case *a2a.DataPart:
			if p != nil {
				dataParts = append(dataParts, *p)
			}
		}
	}
	for _, dp := range dataParts {
		if dp.Metadata != nil {
			metas = append(metas, dp.Metadata)
		}
	}
	for _, dp := range dataParts {
		if dp.Data != nil {
			if legacyMeta, ok := dp.Data["metadata"].(map[string]any); ok {
				metas = append(metas, legacyMeta)
			}
		}
	}

	seen := make(map[string]bool)
	capKeys := []string{agent.ClientCapabilitiesKey, agent.RendererCapabilitiesKey}
	for _, meta := range metas {
		for _, capKey := range capKeys {
			raw, ok := meta[capKey].(map[string]any)
			if !ok {
				continue
			}
			for verKey := range raw {
				if verKey == "supportedCatalogIds" || verKey == "inlineCatalogs" {
					seen["v0.8"] = true
					continue
				}
				seen[verKey] = true
			}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	named := make([]string, 0, len(seen))
	for v := range seen {
		named = append(named, v)
	}
	slices.Sort(named)
	return named
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

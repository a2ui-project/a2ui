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
	"slices"
	"strings"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/core"
)

const extensionURIPrefix = A2UIExtensionBaseURI + "/v"

// AgentExtensionOptions configures the optional parameters that AgentExtension advertises.
type AgentExtensionOptions struct {
	// AcceptsInlineCatalogs advertises that clients may send inline catalogs.
	AcceptsInlineCatalogs bool
	// SupportedCatalogIDs lists the catalog IDs the agent supports.
	SupportedCatalogIDs []string
}

// ExtensionContext abstracts A2A server extension negotiation state.
// *a2asrv.Extensions from github.com/a2aproject/a2a-go/a2asrv satisfies it.
type ExtensionContext interface {
	// RequestedURIs returns the extension URIs the client requested.
	RequestedURIs() []string
	// Activate marks extension as active for the response.
	Activate(extension *a2a.AgentExtension)
}

// ExtensionURI returns the A2A extension URI for an A2UI protocol version,
// for example "https://a2ui.org/a2a-extension/a2ui/v1.0" for core.Version1_0.
func ExtensionURI(version core.ProtocolVersion) string {
	return extensionURIPrefix + version.NumberString()
}

// ExtensionURIVersion returns the numeric version suffix of an A2UI extension URI,
// for example "1.0" for "https://a2ui.org/a2a-extension/a2ui/v1.0".
func ExtensionURIVersion(uri string) string {
	return strings.TrimPrefix(uri, extensionURIPrefix)
}

// AgentExtension builds the A2UI AgentExtension descriptor advertised on an AgentCard.
func AgentExtension(version core.ProtocolVersion, opts *AgentExtensionOptions) a2a.AgentExtension {
	var params map[string]any
	if opts != nil {
		if opts.AcceptsInlineCatalogs {
			params = map[string]any{AgentExtensionAcceptsInlineCatalogsKey: true}
		}
		if len(opts.SupportedCatalogIDs) > 0 {
			if params == nil {
				params = make(map[string]any)
			}
			params[AgentExtensionSupportedCatalogIDsKey] = slices.Clone(opts.SupportedCatalogIDs)
		}
	}
	return a2a.AgentExtension{
		URI:         ExtensionURI(version),
		Description: AgentExtensionDescription,
		Params:      params,
	}
}

// SelectNewestExtensionURI returns the A2UI extension URI with the highest semantic
// version that appears in both requested and advertised, or "" if none does.
func SelectNewestExtensionURI(requested, advertised []string) string {
	bestURI := ""
	var best core.SemVer
	for _, uri := range requested {
		if !strings.HasPrefix(uri, extensionURIPrefix) || !slices.Contains(advertised, uri) {
			continue
		}
		v, ok := core.ParseSemVer(ExtensionURIVersion(uri))
		if !ok {
			continue
		}
		if bestURI == "" || v.Compare(best) > 0 {
			bestURI, best = uri, v
		}
	}
	return bestURI
}

// ActivateExtension activates the newest A2UI extension that the client requested
// (through extCtx, message.Extensions, or both) and that card advertises for a
// known protocol version. It reports the activated version, or false if none matched.
func ActivateExtension(extCtx ExtensionContext, message *a2a.Message, card *a2a.AgentCard) (core.ProtocolVersion, bool) {
	if card == nil {
		return "", false
	}
	requested := requestedExtensions(extCtx, message)
	if len(requested) == 0 {
		return "", false
	}

	var advertised []string
	for _, ext := range card.Capabilities.Extensions {
		if !strings.HasPrefix(ext.URI, extensionURIPrefix) {
			continue
		}
		if _, err := core.ToProtocolVersion(ExtensionURIVersion(ext.URI)); err == nil {
			advertised = append(advertised, ext.URI)
		}
	}

	selected := SelectNewestExtensionURI(requested, advertised)
	if selected == "" {
		return "", false
	}
	version, err := core.ToProtocolVersion(ExtensionURIVersion(selected))
	if err != nil {
		return "", false
	}
	if extCtx != nil {
		extCtx.Activate(&a2a.AgentExtension{URI: selected})
	}
	return version, true
}

func requestedExtensions(extCtx ExtensionContext, message *a2a.Message) []string {
	var out []string
	add := func(raw string) {
		if uri := strings.TrimSpace(raw); strings.HasPrefix(uri, A2UIExtensionBaseURI) {
			out = append(out, uri)
		}
	}
	if extCtx != nil {
		for _, raw := range extCtx.RequestedURIs() {
			for token := range strings.SplitSeq(raw, ",") {
				add(token)
			}
		}
	}
	if message != nil {
		for _, raw := range message.Extensions {
			add(raw)
		}
	}
	return out
}

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
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// versionProfile describes one A2UI protocol version served by the sample agent.
type versionProfile struct {
	Version         string
	ProtocolVersion core.ProtocolVersion
	CapabilitiesKey string
	BasicCatalogID  string
	BasicCatalogRel string
}

var (
	// v09Profile serves A2UI v0.9 messages using the v0.9 Basic Catalog ID expected by sample web clients.
	v09Profile = versionProfile{
		Version:         "v0.9",
		ProtocolVersion: core.Version0_9,
		CapabilitiesKey: agent.ClientCapabilitiesKey,
		BasicCatalogID:  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
		BasicCatalogRel: "specification/v0_9/catalogs/basic/catalog.json",
	}

	// v10Profile serves A2UI v1.0 messages using the canonical v1.0 Basic Catalog.
	v10Profile = versionProfile{
		Version:         "1.0",
		ProtocolVersion: core.Version1_0,
		CapabilitiesKey: agent.RendererCapabilitiesKey,
		BasicCatalogID:  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
		BasicCatalogRel: "catalogs/basic/v1/catalog.json",
	}

	// servedVersions lists supported protocol versions from oldest to newest.
	servedVersions = []versionProfile{v09Profile, v10Profile}

	// defaultVersionProfile is used when a visual client sends no renderer capabilities metadata.
	defaultVersionProfile = v09Profile
)

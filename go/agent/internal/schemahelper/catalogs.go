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

package schemahelper

import (
	"fmt"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

// CheckCatalogs validates that at least one catalog is provided, catalog IDs are unique,
// and all catalogs target the same normalized protocol version.
func CheckCatalogs(catalogs []*core.Catalog) ([]*core.Catalog, error) {
	if len(catalogs) == 0 {
		return nil, core.NewCatalogError("At least one catalog must be provided.")
	}
	seen := make(map[string]bool, len(catalogs))
	versions := make(map[core.ProtocolVersion]bool)
	out := make([]*core.Catalog, 0, len(catalogs))
	for _, cat := range catalogs {
		if cat == nil {
			return nil, core.NewCatalogError("catalog must not be nil")
		}
		cid := cat.CatalogID()
		if seen[cid] {
			return nil, core.NewCatalogErrorf("Duplicate catalog ID: '%s'.", cid)
		}
		seen[cid] = true
		pv, err := core.ToProtocolVersion(string(cat.ProtocolVersion()))
		if err != nil {
			return nil, err
		}
		versions[pv] = true
		out = append(out, cat)
	}
	if len(versions) > 1 {
		var verStrs []string
		for v := range versions {
			verStrs = append(verStrs, string(v))
		}
		slices.Sort(verStrs)
		return nil, core.NewCatalogErrorf("The catalogs target incompatible protocol versions: %v.", verStrs)
	}
	return out, nil
}

// CheckMixedCatalogs validates catalogs and requires A2UI v1.0 or later when multiple catalogs are active.
func CheckMixedCatalogs(catalogs []*core.Catalog) ([]*core.Catalog, error) {
	checked, err := CheckCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	pv, err := core.ToProtocolVersion(string(checked[0].ProtocolVersion()))
	if err != nil {
		return nil, err
	}
	if len(checked) > 1 && !core.IsAtLeastVersion(string(pv), core.Version1_0) {
		return nil, core.NewCatalogErrorf(
			"Several catalogs need A2UI v1.0 or later, but the catalogs target %s.",
			pv,
		)
	}
	return checked, nil
}

// SurfaceCatalogID returns the sole catalog's ID when len(catalogs) == 1, or "" when multiple catalogs are active.
func SurfaceCatalogID(catalogs []*core.Catalog) string {
	if len(catalogs) == 1 && catalogs[0] != nil {
		return catalogs[0].CatalogID()
	}
	return ""
}

// CatalogsDefining returns the IDs of active catalogs (in catalogOrder) that define component or function name.
func CatalogsDefining(catalogOrder []string, helpers map[string]*CatalogSchemaHelper, kind, name string) []string {
	var matches []string
	for _, cid := range catalogOrder {
		h := helpers[cid]
		if h == nil {
			continue
		}
		if kind == "component" {
			if _, ok := h.Components[name]; ok {
				matches = append(matches, cid)
			}
		} else {
			if _, ok := h.Functions[name]; ok {
				matches = append(matches, cid)
			}
		}
	}
	return matches
}

// CatalogsProtocolVersion returns the wire protocol version ("1.0", "v0.9", "v0.9.1") targeted by catalogs.
func CatalogsProtocolVersion(catalogs []*core.Catalog) (string, error) {
	checked, err := CheckCatalogs(catalogs)
	if err != nil {
		return "", err
	}
	pv, err := core.ToProtocolVersion(string(checked[0].ProtocolVersion()))
	if err != nil {
		return "", err
	}
	if w := pv.WireVersion(); w != "" {
		return w, nil
	}
	return string(pv), nil
}

// BuildCatalogHelpers constructs ordered catalog IDs and CatalogSchemaHelper instances for catalogs.
func BuildCatalogHelpers(catalogs []*core.Catalog, protocolVersion string) ([]string, map[string]*CatalogSchemaHelper, error) {
	seen := make(map[string]bool, len(catalogs))
	order := make([]string, 0, len(catalogs))
	helpers := make(map[string]*CatalogSchemaHelper, len(catalogs))
	for _, cat := range catalogs {
		if cat == nil {
			return nil, nil, core.NewCatalogError("catalog must not be nil")
		}
		cid := cat.CatalogID()
		if seen[cid] {
			return nil, nil, core.NewCatalogErrorf("Duplicate catalog ID: '%s'.", cid)
		}
		seen[cid] = true
		order = append(order, cid)
		helpers[cid] = NewCatalogSchemaHelper(cat, protocolVersion)
	}
	return order, helpers, nil
}

// AgentCallableFunctions returns unique renderer function names in catalog declaration order
// on v1.0+ catalogs that allow agent invocation without user activation.
func AgentCallableFunctions(catalogs []*core.Catalog) []string {
	seen := make(map[string]bool)
	var names []string
	for _, cat := range catalogs {
		if cat == nil || !core.IsAtLeastVersion(string(cat.ProtocolVersion()), core.Version1_0) {
			continue
		}
		fns := cat.Functions()
		order := cat.FunctionNames()
		if len(order) == 0 && len(fns) > 0 {
			for k := range fns {
				order = append(order, k)
			}
			slices.Sort(order)
		}
		for _, fnName := range order {
			fn, ok := fns[fnName]
			if !ok {
				continue
			}
			if !fn.RequiresUserActivation &&
				(fn.AllowedCallers == core.AllowedCallersAgentOnly || fn.AllowedCallers == core.AllowedCallersRendererOrAgent) &&
				!seen[fnName] {
				seen[fnName] = true
				names = append(names, fnName)
			}
		}
	}
	return names
}

var (
	versionedOpKeys = []string{
		"createSurface",
		"updateComponents",
		"updateDataModel",
		"deleteSurface",
		"callFunction",
		"callRendererFunction",
	}
	v08OpKeys     = []string{"beginRendering", "surfaceUpdate", "dataModelUpdate"}
	surfaceOpKeys = []string{"createSurface", "updateComponents", "updateDataModel", "deleteSurface"}
)

// NormalizePromptExampleMessages fills missing envelope defaults in catalog prompt example JSON payloads.
func NormalizePromptExampleMessages(
	messages []map[string]any,
	version string,
	defaultCatalogID string,
	defaultSurfaceID string,
) ([]core.AgentToRendererMessage, error) {
	if defaultSurfaceID == "" {
		defaultSurfaceID = "main"
	}
	out := make([]core.AgentToRendererMessage, 0, len(messages))
	for _, item := range messages {
		d := CloneMapPreservingOrder(item)
		if rawVer, hasVer := d["version"]; hasVer {
			vStr := fmt.Sprint(rawVer)
			if rawVer == nil || vStr == "" {
				return nil, core.NewValidationError("Version cannot be None or empty.")
			}
			if strings.HasPrefix(vStr, "0.") {
				d["version"] = "v" + vStr
			}
		} else {
			hasV08 := false
			for _, k := range v08OpKeys {
				if _, ok := d[k]; ok {
					hasV08 = true
					break
				}
			}
			hasVersioned := false
			for _, k := range versionedOpKeys {
				if _, ok := d[k]; ok {
					hasVersioned = true
					break
				}
			}
			if !hasV08 && hasVersioned {
				d["version"] = version
			}
		}

		for _, k := range surfaceOpKeys {
			if subRaw, ok := d[k].(map[string]any); ok {
				sub := CloneMapPreservingOrder(subRaw)
				if _, hasSurf := sub["surfaceId"]; !hasSurf {
					sub["surfaceId"] = defaultSurfaceID
				}
				if k == "createSurface" {
					catVal, _ := sub["catalogId"].(string)
					if catVal == "" && defaultCatalogID != "" {
						sub["catalogId"] = defaultCatalogID
					}
				}
				d[k] = sub
			}
		}

		if cfRaw, hasCF := d["callFunction"]; hasCF {
			if _, hasCRF := d["callRendererFunction"]; !hasCRF {
				delete(d, "callFunction")
				if cfMap, ok := cfRaw.(map[string]any); ok {
					cfNorm := CloneMapPreservingOrder(cfMap)
					if defaultCatalogID != "" {
						if _, hasCat := cfNorm["catalogId"]; !hasCat {
							cfNorm["catalogId"] = defaultCatalogID
						}
					}
					fcID := "call_1"
					if rawID, ok := d["functionCallId"]; ok && rawID != nil {
						fcID = fmt.Sprint(rawID)
						delete(d, "functionCallId")
					}
					d["callRendererFunction"] = map[string]any{
						"functionCallId": fcID,
						"callFunction":   cfNorm,
					}
				}
			}
		}

		out = append(out, core.AgentToRendererMessage(d))
	}
	return out, nil
}

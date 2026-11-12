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

import (
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

func capabilitiesKeyForVersion(pv core.ProtocolVersion) string {
	switch pv {
	case core.Version0_8:
		return "v0.8"
	case core.Version0_9, core.Version0_9_1:
		return "v0.9"
	case core.Version1_0:
		return "1.0"
	default:
		return string(pv)
	}
}

func isBareCapabilitiesEntry(m map[string]any) bool {
	if m == nil {
		return false
	}
	_, hasSupported := m["supportedCatalogIds"]
	_, hasInline := m["inlineCatalogs"]
	return hasSupported || hasInline
}

// ReadRendererCapabilities extracts and validates version-keyed renderer capabilities from transport metadata.
func ReadRendererCapabilities(metadata map[string]any, version core.ProtocolVersion) (core.RendererCapabilities, error) {
	if version == "" {
		version = core.Version1_0
	}
	pv, err := core.ToProtocolVersion(string(version))
	if err != nil {
		return nil, wrapCatalogError(err, "unsupported protocol version %q: %v", version, err)
	}
	if metadata == nil {
		return nil, nil
	}

	metadataKey := ClientCapabilitiesKey
	if pv == core.Version1_0 {
		metadataKey = RendererCapabilitiesKey
	}
	rawVal, ok := metadata[metadataKey]
	if !ok || rawVal == nil {
		return nil, nil
	}
	rawMap, ok := rawVal.(map[string]any)
	if !ok {
		return nil, core.NewCatalogErrorf("the %q metadata value must be a JSON object", metadataKey)
	}

	entryKey := capabilitiesKeyForVersion(pv)
	entryVal, hasEntry := rawMap[entryKey]
	if (!hasEntry || entryVal == nil) && entryKey == "v0.8" && isBareCapabilitiesEntry(rawMap) {
		entryVal = rawMap
		hasEntry = true
	}
	if !hasEntry || entryVal == nil {
		return nil, nil
	}
	entryMap, ok := entryVal.(map[string]any)
	if !ok {
		return nil, core.NewCatalogErrorf("the %q capabilities entry under %q must be a JSON object", entryKey, metadataKey)
	}

	supportedIDs, _, err := parseCapabilitiesEntry(entryMap, entryKey, pv, true)
	if err != nil {
		return nil, err
	}
	if supportedIDs == nil {
		supportedIDs = []string{}
	}
	var clonedInline []map[string]any
	if rawInline, hasInline := entryMap["inlineCatalogs"]; hasInline && rawInline != nil {
		docs, _ := toMapSlice(rawInline)
		clonedInline = make([]map[string]any, len(docs))
		for i, doc := range docs {
			clonedDoc, _ := core.CloneJSONValue(doc).(map[string]any)
			clonedInline[i] = clonedDoc
		}
	}
	return core.RendererCapabilities{
		entryKey: {
			SupportedCatalogIDs: supportedIDs,
			InlineCatalogs:      clonedInline,
		},
	}, nil
}

// ParseRendererCapabilities parses and validates an untyped wire capabilities map into core.RendererCapabilities.
func ParseRendererCapabilities(raw map[string]any) (core.RendererCapabilities, error) {
	if raw == nil {
		return nil, nil
	}
	source := raw
	if isBareCapabilitiesEntry(raw) {
		if _, hasV08 := raw["v0.8"]; !hasV08 {
			source = map[string]any{"v0.8": raw}
		}
	}
	out := make(core.RendererCapabilities, len(source))
	for _, entryKey := range slices.Sorted(maps.Keys(source)) {
		entryMap, ok := source[entryKey].(map[string]any)
		if !ok || entryMap == nil {
			return nil, core.NewValidationErrorf("invalid %q renderer capabilities: entry must be an object", entryKey)
		}
		for _, k := range slices.Sorted(maps.Keys(entryMap)) {
			if k != "supportedCatalogIds" && k != "inlineCatalogs" {
				return nil, core.NewValidationError("unrecognized capabilities property: " + k)
			}
		}
		rawSupported, hasSupported := entryMap["supportedCatalogIds"]
		if !hasSupported || rawSupported == nil {
			return nil, core.NewValidationError("capabilities entry missing required 'supportedCatalogIds' list")
		}
		supportedIDs, ok := toStringSlice(rawSupported)
		if !ok {
			return nil, core.NewValidationError("'supportedCatalogIds' must be an array of strings")
		}
		if supportedIDs == nil {
			supportedIDs = []string{}
		}
		var inlineDocs []map[string]any
		if rawInline, hasInline := entryMap["inlineCatalogs"]; hasInline && rawInline != nil {
			docs, ok := toMapSlice(rawInline)
			if !ok {
				return nil, core.NewCatalogErrorf("invalid inlineCatalogs in %q renderer capabilities: expected array of objects", entryKey)
			}
			inlineDocs = make([]map[string]any, len(docs))
			for i, doc := range docs {
				clonedDoc, _ := core.CloneJSONValue(doc).(map[string]any)
				inlineDocs[i] = clonedDoc
			}
		}
		out[entryKey] = core.RendererCapabilityEntry{
			SupportedCatalogIDs: supportedIDs,
			InlineCatalogs:      inlineDocs,
		}
	}
	return out, nil
}

// ResolveCatalogs negotiates active catalogs in client preference order from registered CatalogConfigs and capabilities.
func ResolveCatalogs(configs []*CatalogConfig, capabilities core.RendererCapabilities, acceptsInlineCatalogs bool) ([]*core.Catalog, error) {
	registered := make([]*core.Catalog, 0, len(configs))
	for _, cfg := range configs {
		if cfg != nil && cfg.TransformedCatalog() != nil {
			registered = append(registered, cfg.TransformedCatalog())
		}
	}
	if capabilities == nil {
		return registered, nil
	}

	if len(registered) == 0 {
		return nil, core.NewCatalogError("no catalogs are registered, so none of the renderer's catalogs can be resolved")
	}

	pv := registered[0].ProtocolVersion()
	entryKey := capabilitiesKeyForVersion(pv)
	for _, cat := range registered[1:] {
		otherKey := capabilitiesKeyForVersion(cat.ProtocolVersion())
		if otherKey != entryKey {
			return nil, core.NewCatalogErrorf(
				"the registered catalogs read different capabilities entries: %q reads %q and %q reads %q",
				registered[0].CatalogID(), entryKey, cat.CatalogID(), otherKey,
			)
		}
	}

	entry, hasEntry := capabilities[entryKey]
	if !hasEntry {
		return nil, core.NewValidationErrorf(
			"the renderer capabilities have no %q entry, which the registered catalogs read",
			entryKey,
		)
	}

	entryMap := map[string]any{
		"supportedCatalogIds": entry.SupportedCatalogIDs,
	}
	if entry.SupportedCatalogIDs == nil {
		entryMap["supportedCatalogIds"] = []string{}
	}
	if entry.InlineCatalogs != nil {
		entryMap["inlineCatalogs"] = entry.InlineCatalogs
	}

	supportedIDs, inlineCatalogs, err := parseCapabilitiesEntry(entryMap, entryKey, pv, false)
	if err != nil {
		return nil, err
	}

	registeredByID := make(map[string]*core.Catalog, len(registered))
	registeredOrder := make([]string, 0, len(registered))
	for _, cat := range registered {
		if _, exists := registeredByID[cat.CatalogID()]; !exists {
			registeredByID[cat.CatalogID()] = cat
			registeredOrder = append(registeredOrder, cat.CatalogID())
		}
	}

	var active []*core.Catalog
	activeSet := make(map[string]bool)
	for _, cid := range supportedIDs {
		if cat, exists := registeredByID[cid]; exists && !activeSet[cid] {
			activeSet[cid] = true
			active = append(active, cat)
		}
	}
	if acceptsInlineCatalogs {
		for _, inlineCat := range inlineCatalogs {
			if !activeSet[inlineCat.CatalogID()] {
				activeSet[inlineCat.CatalogID()] = true
				active = append(active, inlineCat)
			}
		}
	}

	if len(active) == 0 {
		return nil, core.NewCatalogErrorf(
			"no client-supported catalog found on the agent side; agent-supported catalogs are: %v",
			registeredOrder,
		)
	}
	return active, nil
}

// parseCapabilitiesEntry validates a version capabilities entry.
// When allErrorsAreCatalog is true (ReadRendererCapabilities), any error is returned as *core.CatalogError.
// When false (ResolveCatalogs), inlineCatalogs errors return *core.CatalogError while outer entry errors return *core.ValidationError.
func parseCapabilitiesEntry(
	entry map[string]any,
	entryKey string,
	pv core.ProtocolVersion,
	allErrorsAreCatalog bool,
) ([]string, []*core.Catalog, error) {
	entryErr := func(msg string) error {
		if allErrorsAreCatalog {
			return core.NewCatalogError(msg)
		}
		return core.NewValidationError(msg)
	}

	for _, k := range slices.Sorted(maps.Keys(entry)) {
		if k != "supportedCatalogIds" && k != "inlineCatalogs" {
			return nil, nil, entryErr("unrecognized capabilities property: " + k)
		}
	}

	rawSupported, hasSupported := entry["supportedCatalogIds"]
	if !hasSupported || rawSupported == nil {
		return nil, nil, entryErr("capabilities entry missing required 'supportedCatalogIds' list")
	}
	supportedIDs, ok := toStringSlice(rawSupported)
	if !ok {
		return nil, nil, entryErr("'supportedCatalogIds' must be an array of strings")
	}

	var inlineCatalogs []*core.Catalog
	if rawInline, hasInline := entry["inlineCatalogs"]; hasInline {
		if rawInline == nil {
			if allErrorsAreCatalog {
				return nil, nil, core.NewCatalogErrorf("the 'inlineCatalogs' field in %q renderer capabilities must be an array", entryKey)
			}
			return supportedIDs, nil, nil
		}
		inlineDocs, ok := toMapSlice(rawInline)
		if !ok {
			return nil, nil, core.NewCatalogErrorf("invalid inlineCatalogs in %q renderer capabilities: expected array of objects", entryKey)
		}
		inlineCatalogs = make([]*core.Catalog, 0, len(inlineDocs))
		for _, doc := range inlineDocs {
			if rawDocVer, hasDocVer := doc["protocolVersion"]; hasDocVer {
				docVerStr, ok := rawDocVer.(string)
				if !ok || docVerStr == "" {
					return nil, nil, core.NewCatalogErrorf("inline catalog 'protocolVersion' in %q renderer capabilities must be a non-empty string", entryKey)
				}
				docPV, err := core.ToProtocolVersion(docVerStr)
				if err != nil {
					return nil, nil, wrapCatalogError(err, "unsupported inline catalog protocolVersion %q in %q renderer capabilities: %v", docVerStr, entryKey, err)
				}
				if capabilitiesKeyForVersion(docPV) != entryKey {
					return nil, nil, core.NewCatalogErrorf("inline catalog protocolVersion %q is incompatible with %q renderer capabilities", docVerStr, entryKey)
				}
			}
			cat, err := loadCatalogDocument(doc, pv, "", "inline catalog", nil)
			if err != nil {
				return nil, nil, err
			}
			inlineCatalogs = append(inlineCatalogs, cat)
		}
	}

	return supportedIDs, inlineCatalogs, nil
}

func toStringSlice(v any) ([]string, bool) {
	switch s := v.(type) {
	case []string:
		return append([]string(nil), s...), true
	case []any:
		out := make([]string, len(s))
		for i, item := range s {
			str, ok := item.(string)
			if !ok {
				return nil, false
			}
			out[i] = str
		}
		return out, true
	default:
		return nil, false
	}
}

func toMapSlice(v any) ([]map[string]any, bool) {
	switch s := v.(type) {
	case []map[string]any:
		for _, item := range s {
			if item == nil {
				return nil, false
			}
		}
		return s, true
	case []any:
		out := make([]map[string]any, len(s))
		for i, item := range s {
			m, ok := item.(map[string]any)
			if !ok || m == nil {
				return nil, false
			}
			out[i] = m
		}
		return out, true
	default:
		return nil, false
	}
}

// AgentCallableFunctions returns the deduplicated names of functions across v1.0+ catalogs,
// in catalog priority and function declaration order, that allow standalone agent invocation
// (allowedCallers in {"agentOnly", "rendererOrAgent"} and !requiresUserActivation).
func AgentCallableFunctions(catalogs []*core.Catalog) []string {
	seen := make(map[string]bool)
	var names []string
	for _, cat := range catalogs {
		if cat == nil || !core.IsAtLeastVersion(string(cat.ProtocolVersion()), core.Version1_0) {
			continue
		}
		fns := cat.Functions()
		for _, name := range cat.FunctionNames() {
			fn, ok := fns[name]
			if !ok || fn.RequiresUserActivation {
				continue
			}
			if fn.AllowedCallers == core.AllowedCallersAgentOnly || fn.AllowedCallers == core.AllowedCallersRendererOrAgent {
				if !seen[name] {
					seen[name] = true
					names = append(names, name)
				}
			}
		}
	}
	return names
}

// LoadExamples loads few-shot example turns from a directory or glob pattern, optionally validating against catalogs.
func LoadExamples(pathOrGlob string, catalogs []*core.Catalog, validate bool) ([][]core.AgentToRendererMessage, error) {
	if pathOrGlob == "" {
		return nil, nil
	}
	localPath, err := toLocalPath(pathOrGlob, "examples")
	if err != nil {
		return nil, err
	}
	matchedFiles, err := matchExampleFiles(localPath)
	if err != nil {
		return nil, wrapCatalogError(err, "failed to locate examples %q: %v", pathOrGlob, err)
	}
	if len(matchedFiles) == 0 {
		return nil, nil
	}
	sort.Strings(matchedFiles)

	var turns [][]core.AgentToRendererMessage
	for _, fullPath := range matchedFiles {
		info, statErr := os.Stat(fullPath)
		if statErr != nil || info.IsDir() {
			continue
		}
		data, readErr := os.ReadFile(fullPath)
		if readErr != nil {
			return nil, wrapCatalogError(readErr, "failed to read example %q: %v", fullPath, readErr)
		}
		turn, parseErr := decodeExampleTurn(data)
		if parseErr != nil {
			if validate {
				return nil, wrapCatalogError(parseErr, "failed to validate example %q: %v", fullPath, parseErr)
			}
			continue
		}
		if validate {
			if valErr := ValidatePayload(catalogs, turn); valErr != nil {
				return nil, wrapCatalogError(valErr, "failed to validate example %q: %v", fullPath, valErr)
			}
		}
		turns = append(turns, turn)
	}
	return turns, nil
}

func matchExampleFiles(pathOrGlob string) ([]string, error) {
	if info, err := os.Stat(pathOrGlob); err == nil {
		if info.IsDir() {
			return filepath.Glob(filepath.Join(pathOrGlob, "*.json"))
		}
		return []string{pathOrGlob}, nil
	}
	if strings.Contains(pathOrGlob, "**") {
		base, suffix, _ := strings.Cut(pathOrGlob, "**")
		root := filepath.Clean(base)
		if root == "" {
			root = "."
		}
		ext := strings.TrimPrefix(suffix, "/")
		ext = strings.TrimPrefix(ext, `\`)
		var matches []string
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if ext == "" {
				matches = append(matches, p)
				return nil
			}
			matched, matchErr := filepath.Match(ext, filepath.Base(p))
			if matchErr == nil && matched {
				matches = append(matches, p)
			}
			return nil
		})
		return matches, err
	}
	return filepath.Glob(pathOrGlob)
}

func decodeExampleTurn(data []byte) ([]core.AgentToRendererMessage, error) {
	raw, err := core.ParseJSON(data)
	if err != nil {
		return nil, err
	}
	switch v := raw.(type) {
	case map[string]any:
		return []core.AgentToRendererMessage{core.AgentToRendererMessage(v)}, nil
	case []any:
		out := make([]core.AgentToRendererMessage, len(v))
		for i, item := range v {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, core.NewValidationErrorf("example message %d is not a JSON object", i)
			}
			out[i] = core.AgentToRendererMessage(m)
		}
		return out, nil
	default:
		return nil, core.NewValidationError("example payload must be a JSON object or array of objects")
	}
}

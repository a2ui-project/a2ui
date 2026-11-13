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
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

// --- v0.9 Lowering & Lifting Helpers ---

func expConfSwapVersion(ver any) any {
	s, ok := ver.(string)
	if !ok {
		return ver
	}
	switch s {
	case "1.0", "v1.0":
		return "v0.9"
	case "v0.9":
		return "1.0"
	default:
		return ver
	}
}

func expConfIsVersionAtLeast10(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	return strings.HasPrefix(strings.TrimPrefix(s, "v"), "1.")
}

func expConfReplaceChildRefs(node any) any {
	switch cur := node.(type) {
	case []any:
		out := make([]any, len(cur))
		for i, item := range cur {
			out[i] = expConfReplaceChildRefs(item)
		}
		return out
	case map[string]any:
		keys := schemahelper.OrderedKeys(cur)
		out := make(map[string]any, len(cur))
		for _, k := range keys {
			v := cur[k]
			if k == "$ref" {
				if s, ok := v.(string); ok && strings.HasSuffix(s, "#/$defs/Child") {
					out[k] = strings.TrimSuffix(s, "#/$defs/Child") + "#/$defs/ComponentId"
					continue
				}
			}
			out[k] = expConfReplaceChildRefs(v)
		}
		schemahelper.SetMapKeyOrder(out, keys)
		return out
	default:
		return node
	}
}

func expConfLowerCatalogDoc(doc map[string]any, defaultCatID string) map[string]any {
	proto := doc["protocolVersion"]
	if proto != nil && !expConfIsVersionAtLeast10(proto) {
		copied := schemahelper.CloneMapPreservingOrder(doc)
		if defaultCatID != "" {
			if _, hasID := copied["catalogId"]; !hasID {
				copied["catalogId"] = defaultCatID
			}
		}
		return copied
	}
	lowered, _ := expConfReplaceChildRefs(schemahelper.CloneMapPreservingOrder(doc)).(map[string]any)
	lowered["protocolVersion"] = "0.9"
	if defaultCatID != "" {
		if _, hasID := lowered["catalogId"]; !hasID {
			lowered["catalogId"] = defaultCatID
		}
	}
	if fns, ok := lowered["functions"].(map[string]any); ok {
		fnKeys := schemahelper.OrderedKeys(fns)
		loweredFns := make(map[string]any, len(fns))
		for _, fnName := range fnKeys {
			fnMap, isMap := fns[fnName].(map[string]any)
			if !isMap {
				loweredFns[fnName] = fns[fnName]
				continue
			}
			fnCopy := schemahelper.CloneMapPreservingOrder(fnMap)
			delete(fnCopy, "allowedCallers")
			delete(fnCopy, "requiresUserActivation")
			if fnCopy["returnType"] == "validationResult" {
				fnCopy["returnType"] = "boolean"
			}
			if props, ok := fnCopy["properties"].(map[string]any); ok {
				propsCopy := schemahelper.CloneMapPreservingOrder(props)
				if atCall, hasAtCall := propsCopy["@call"]; hasAtCall {
					propsCopy["call"] = atCall
					delete(propsCopy, "@call")
				}
				if retProp, ok := propsCopy["returnType"].(map[string]any); ok && retProp["const"] == "validationResult" {
					propsCopy["returnType"] = map[string]any{"const": "boolean"}
				}
				fnCopy["properties"] = propsCopy
			}
			if reqList, ok := fnCopy["required"].([]any); ok {
				newReq := make([]any, len(reqList))
				for i, r := range reqList {
					if r == "@call" {
						newReq[i] = "call"
					} else {
						newReq[i] = r
					}
				}
				fnCopy["required"] = newReq
			}
			loweredFns[fnName] = fnCopy
		}
		schemahelper.SetMapKeyOrder(loweredFns, fnKeys)
		lowered["functions"] = loweredFns
	}
	if defs, ok := lowered["$defs"].(map[string]any); ok {
		if anyFn, ok := defs["anyFunction"].(map[string]any); ok {
			if disc, ok := anyFn["discriminator"].(map[string]any); ok && disc["propertyName"] == "@call" {
				disc["propertyName"] = "call"
			}
		}
	}
	return lowered
}

func expConfRawCatalogDoc(t *testing.T, confRoot string, entry any) (map[string]any, string) {
	t.Helper()
	if m, ok := entry.(map[string]any); ok {
		if inner, has := m["catalog"]; has {
			entry = inner
		}
	}
	switch e := entry.(type) {
	case string:
		raw, _ := expConfLoadJSONFile(t, confRoot, e)
		doc, _ := raw.(map[string]any)
		return doc, strings.TrimSuffix(filepath.Base(e), ".json")
	case map[string]any:
		return e, "inline"
	default:
		return nil, ""
	}
}

func expConfFirstCatalogID(t *testing.T, confRoot string, args map[string]any) string {
	t.Helper()
	entry := args["catalog"]
	if entry == nil {
		if cats, ok := args["catalogs"].([]any); ok && len(cats) > 0 {
			entry = cats[0]
		}
	}
	if entry == nil {
		entry = expConfDefaultCatalog
	}
	doc, defID := expConfRawCatalogDoc(t, confRoot, entry)
	if cid, ok := doc["catalogId"].(string); ok && cid != "" {
		return cid
	}
	return defID
}

func expConfV09SkipReason(t *testing.T, confRoot string, tc map[string]any) string {
	t.Helper()
	name, _ := tc["name"].(string)
	if reason, ok := expConfV1OnlyCases[name]; ok {
		return reason
	}
	args, _ := tc["args"].(map[string]any)
	catSource := tc
	if args != nil {
		catSource = args
	}
	entry := catSource["catalog"]
	if entry == nil {
		if cats, ok := catSource["catalogs"].([]any); ok && len(cats) > 0 {
			entry = cats[0]
		}
	}
	if entry != nil {
		doc, _ := expConfRawCatalogDoc(t, confRoot, entry)
		if proto, ok := doc["protocolVersion"].(string); ok {
			switch proto {
			case "0.8", "v0.8", "0.9", "v0.9":
				return fmt.Sprintf("Case already targets protocol version %s.", proto)
			}
		}
	}
	if cats, ok := catSource["catalogs"].([]any); ok && len(cats) > 1 {
		return "v0.9 names one catalog per surface."
	}
	b, _ := json.Marshal(tc)
	if strings.Contains(string(b), "callRendererFunction") {
		return "Protocol v0.9 has no callRendererFunction message."
	}
	return ""
}

func expConfLowerCatalogEntry(t *testing.T, confRoot string, entry any) any {
	t.Helper()
	if m, ok := entry.(map[string]any); ok {
		if inner, has := m["catalog"]; has {
			copied := schemahelper.CloneMapPreservingOrder(m)
			copied["catalog"] = expConfLowerCatalogEntry(t, confRoot, inner)
			return copied
		}
		return expConfLowerCatalogDoc(m, "inline")
	}
	if s, ok := entry.(string); ok {
		raw, _ := expConfLoadJSONFile(t, confRoot, s)
		doc, _ := raw.(map[string]any)
		return expConfLowerCatalogDoc(doc, strings.TrimSuffix(filepath.Base(s), ".json"))
	}
	return entry
}

func expConfRenameKeysIn(node any, lower bool) any {
	switch cur := node.(type) {
	case []any:
		out := make([]any, len(cur))
		for i, item := range cur {
			out[i] = expConfRenameKeysIn(item, lower)
		}
		return out
	case map[string]any:
		_, isTemplate := cur["componentId"]
		// The v1.0 component envelope mixins are renamed only at a component's root.
		_, hasID := cur["id"]
		_, hasComponent := cur["component"]
		isComponent := hasID && hasComponent
		keys := schemahelper.OrderedKeys(cur)
		out := make(map[string]any, len(cur))
		var outKeys []string
		for _, k := range keys {
			nk := k
			if !isTemplate {
				if lower {
					switch k {
					case "@path":
						nk = "path"
					case "@call":
						nk = "call"
					case "@checks", "@accessibility":
						if isComponent {
							nk = strings.TrimPrefix(k, "@")
						}
					}
				} else {
					switch k {
					case "path":
						nk = "@path"
					case "call":
						nk = "@call"
					case "checks", "accessibility":
						if isComponent {
							nk = "@" + k
						}
					}
				}
			}
			outKeys = append(outKeys, nk)
			out[nk] = expConfRenameKeysIn(cur[k], lower)
		}
		schemahelper.SetMapKeyOrder(out, outKeys)
		return out
	default:
		return node
	}
}

func expConfRenameReservedKeys(message map[string]any, lower bool) map[string]any {
	keys := schemahelper.OrderedKeys(message)
	out := make(map[string]any, len(message))
	for _, k := range keys {
		if vMap, ok := message[k].(map[string]any); ok {
			bKeys := schemahelper.OrderedKeys(vMap)
			body := make(map[string]any, len(vMap))
			for _, fk := range bKeys {
				fv := vMap[fk]
				if fk == "components" || fk == "callFunction" {
					body[fk] = expConfRenameKeysIn(fv, lower)
				} else {
					body[fk] = schemahelper.CloneValuePreservingOrder(fv)
				}
			}
			schemahelper.SetMapKeyOrder(body, bKeys)
			out[k] = body
		} else {
			out[k] = schemahelper.CloneValuePreservingOrder(message[k])
		}
	}
	schemahelper.SetMapKeyOrder(out, keys)
	return out
}

func expConfLowerMessages(messages []core.AgentToRendererMessage, defaultCatID string) []core.AgentToRendererMessage {
	var lowered []core.AgentToRendererMessage
	for _, rawMsg := range messages {
		msg := expConfRenameReservedKeys(map[string]any(rawMsg), true)
		msg["version"] = expConfSwapVersion(msg["version"])
		if createMap, ok := msg["createSurface"].(map[string]any); ok {
			create := schemahelper.CloneMapPreservingOrder(createMap)
			components, hasComps := create["components"]
			delete(create, "components")
			dataModel, hasDM := create["dataModel"]
			delete(create, "dataModel")
			if defaultCatID != "" {
				if _, hasCat := create["catalogId"]; !hasCat {
					create["catalogId"] = defaultCatID
				}
			}
			sid := create["surfaceId"]
			lowered = append(lowered, core.AgentToRendererMessage{
				"version":       msg["version"],
				"createSurface": create,
			})
			if hasComps && components != nil {
				lowered = append(lowered, core.AgentToRendererMessage{
					"version": msg["version"],
					"updateComponents": map[string]any{
						"surfaceId":  sid,
						"components": components,
					},
				})
			}
			if hasDM && dataModel != nil {
				lowered = append(lowered, core.AgentToRendererMessage{
					"version": msg["version"],
					"updateDataModel": map[string]any{
						"surfaceId": sid,
						"path":      "/",
						"value":     dataModel,
					},
				})
			}
		} else {
			lowered = append(lowered, core.AgentToRendererMessage(msg))
		}
	}
	return lowered
}

func expConfLiftMessages(messages []core.AgentToRendererMessage) []any {
	var lifted []map[string]any
	for _, rawMsg := range messages {
		msg := expConfRenameReservedKeys(map[string]any(rawMsg), false)
		var lastCreate map[string]any
		var lastSID any
		if len(lifted) > 0 {
			lastCreate, _ = lifted[len(lifted)-1]["createSurface"].(map[string]any)
			if lastCreate != nil {
				lastSID = lastCreate["surfaceId"]
			}
		}
		if updComp, ok := msg["updateComponents"].(map[string]any); ok && lastCreate != nil && expConfJSONEqual(updComp["surfaceId"], lastSID) {
			if _, hasComps := lastCreate["components"]; !hasComps {
				lastCreate["components"] = updComp["components"]
				continue
			}
		}
		if updDM, ok := msg["updateDataModel"].(map[string]any); ok && lastCreate != nil && expConfJSONEqual(updDM["surfaceId"], lastSID) && updDM["path"] == "/" {
			if _, hasDM := lastCreate["dataModel"]; !hasDM {
				lastCreate["dataModel"] = updDM["value"]
				continue
			}
		}
		if createMap, ok := msg["createSurface"].(map[string]any); ok {
			create := make(map[string]any)
			for _, k := range schemahelper.OrderedKeys(createMap) {
				v := createMap[k]
				if k == "sendDataModel" {
					if b, isBool := v.(bool); isBool && !b {
						continue
					}
				}
				create[k] = v
			}
			lifted = append(lifted, map[string]any{
				"version":       expConfSwapVersion(msg["version"]),
				"createSurface": create,
			})
		} else {
			liftedMsg := schemahelper.CloneMapPreservingOrder(msg)
			liftedMsg["version"] = expConfSwapVersion(msg["version"])
			lifted = append(lifted, liftedMsg)
		}
	}
	out := make([]any, len(lifted))
	for i, m := range lifted {
		out[i] = m
	}
	return out
}

func expConfLiftParts(parts []any) []any {
	out := make([]any, len(parts))
	for i, raw := range parts {
		m, _ := raw.(map[string]any)
		if a2uiRaw, has := m["a2ui"]; has {
			out[i] = map[string]any{
				"a2ui": expConfLiftMessages(expConfToMessageSlice(a2uiRaw)),
			}
		} else {
			out[i] = raw
		}
	}
	return out
}

func expConfLowerCase(t *testing.T, confRoot string, tc map[string]any) map[string]any {
	t.Helper()
	lowered := schemahelper.CloneMapPreservingOrder(tc)
	args, _ := lowered["args"].(map[string]any)
	if args == nil {
		args = map[string]any{}
	} else {
		args = schemahelper.CloneMapPreservingOrder(args)
	}
	defCatID := expConfFirstCatalogID(t, confRoot, args)
	if rawCat, hasCat := args["catalog"]; hasCat {
		args["catalog"] = expConfLowerCatalogEntry(t, confRoot, rawCat)
	} else if rawCats, ok := args["catalogs"].([]any); ok {
		lowCats := make([]any, len(rawCats))
		for i, c := range rawCats {
			lowCats[i] = expConfLowerCatalogEntry(t, confRoot, c)
		}
		args["catalogs"] = lowCats
	} else {
		args["catalog"] = expConfLowerCatalogEntry(t, confRoot, expConfDefaultCatalog)
	}
	lowered["args"] = args
	if lowered["action"] == "decompile" {
		if msgsRaw, hasMsgs := lowered["messages"]; hasMsgs {
			lowMsgs := expConfLowerMessages(expConfToMessageSlice(msgsRaw), defCatID)
			lowered["messages"] = expConfMessagesToAnySlice(lowMsgs)
		}
	}
	return lowered
}

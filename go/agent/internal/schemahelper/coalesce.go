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

import "github.com/a2ui-project/a2ui/go/core"

const (
	opCreate           = "createSurface"
	opUpdateComponents = "updateComponents"
	opUpdateData       = "updateDataModel"
	opDelete           = "deleteSurface"
)

var surfaceOperations = []string{opCreate, opUpdateComponents, opUpdateData, opDelete}

// CoalescedMessage represents a single logical unit produced by CoalesceSurfaceMessages.
type CoalescedMessage struct {
	Message          map[string]any
	SurfaceCatalogID string
}

// Operation returns the surface operation key ("createSurface", "updateComponents",
// "updateDataModel", "deleteSurface"), or "" for other messages.
func (c CoalescedMessage) Operation() string {
	for _, key := range surfaceOperations {
		if _, ok := c.Message[key]; ok {
			return key
		}
	}
	return ""
}

// SurfaceID returns the target surface ID of the message, or "" for non-surface messages.
func (c CoalescedMessage) SurfaceID() string {
	op := c.Operation()
	if op == "" {
		return ""
	}
	body, ok := c.Message[op].(map[string]any)
	if !ok {
		return ""
	}
	sid, _ := body["surfaceId"].(string)
	return sid
}

// IsUpdate reports whether this coalesced item updates an existing surface rather than creating one.
func (c CoalescedMessage) IsUpdate() bool {
	op := c.Operation()
	return op == opUpdateComponents || op == opUpdateData
}

func isRootPath(path any) bool {
	if path == nil {
		return true
	}
	s, ok := path.(string)
	return ok && (s == "" || s == "/")
}

// CoalesceSurfaceMessages folds split v0.9-style updateComponents and root updateDataModel
// messages into an open createSurface for the same surface while keeping incremental updates intact.
func CoalesceSurfaceMessages(messages []core.AgentToRendererMessage) []CoalescedMessage {
	var result []map[string]any
	var surfaceIDs []string
	var hasSurfaceID []bool
	openCreates := make(map[string]int)

	for _, rawMsg := range messages {
		msg := CloneMapPreservingOrder(map[string]any(rawMsg))
		op := ""
		for _, k := range surfaceOperations {
			if _, ok := msg[k].(map[string]any); ok {
				op = k
				break
			}
		}
		if op == "" {
			clear(openCreates)
			result = append(result, msg)
			surfaceIDs = append(surfaceIDs, "")
			hasSurfaceID = append(hasSurfaceID, false)
			continue
		}

		body := CloneMapPreservingOrder(msg[op].(map[string]any))
		msg[op] = body
		sid, sidIsStr := body["surfaceId"].(string)

		openIdx, hasOpen := -1, false
		if sidIsStr {
			openIdx, hasOpen = openCreates[sid]
		}

		if op == opCreate {
			if sidIsStr {
				openCreates[sid] = len(result)
			}
			result = append(result, msg)
			surfaceIDs = append(surfaceIDs, sid)
			hasSurfaceID = append(hasSurfaceID, sidIsStr)
			continue
		}

		if hasOpen {
			createBody := result[openIdx][opCreate].(map[string]any)
			if op == opUpdateComponents {
				if _, alreadyHasComps := createBody["components"]; !alreadyHasComps {
					if comps, ok := body["components"]; ok {
						createBody["components"] = comps
					} else {
						createBody["components"] = []any{}
					}
					continue
				}
			}
			if op == opUpdateData {
				pathVal, _ := body["path"]
				if valMap, ok := body["value"].(map[string]any); ok && isRootPath(pathVal) {
					createBody["dataModel"] = CloneMapPreservingOrder(valMap)
					continue
				}
			}
			delete(openCreates, sid)
		}

		if op == opDelete && sidIsStr {
			delete(openCreates, sid)
		}
		result = append(result, msg)
		surfaceIDs = append(surfaceIDs, sid)
		hasSurfaceID = append(hasSurfaceID, sidIsStr)
	}

	coalesced := make([]CoalescedMessage, 0, len(result))
	seenCatalogs := make(map[string]string)
	for i, msg := range result {
		sid := surfaceIDs[i]
		validSID := hasSurfaceID[i]
		if validSID {
			if createBody, ok := msg[opCreate].(map[string]any); ok {
				if catID, ok := createBody["catalogId"].(string); ok && catID != "" {
					seenCatalogs[sid] = catID
				} else {
					delete(seenCatalogs, sid)
				}
			}
		}
		surfCat := ""
		if validSID {
			surfCat = seenCatalogs[sid]
		}
		coalesced = append(coalesced, CoalescedMessage{
			Message:          msg,
			SurfaceCatalogID: surfCat,
		})
	}
	return coalesced
}

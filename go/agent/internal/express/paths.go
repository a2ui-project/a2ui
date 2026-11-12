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

package express

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
)

func stripPathPrefix(pathStr string) string {
	if strings.HasPrefix(pathStr, "$/") {
		return pathStr[2:]
	}
	if strings.HasPrefix(pathStr, "$") {
		return pathStr[1:]
	}
	return pathStr
}

func toJSONPointer(pathStr string) string {
	return "/" + stripPathPrefix(pathStr)
}

func parseArrayIndex(segment, pathStr string) (int, error) {
	if !arrayIndexRe.MatchString(segment) {
		return 0, NewValidationError(
			fmt.Sprintf("Cannot use non-numeric segment %q on an array in path %q.", segment, pathStr),
			"",
		)
	}
	idx, err := strconv.Atoi(segment)
	if err != nil || idx > maxArrayIndex {
		return 0, NewValidationError(
			fmt.Sprintf("Cannot set path %q: array index %q exceeds maximum supported index (%d).", pathStr, segment, maxArrayIndex),
			"",
		)
	}
	return idx, nil
}

func setNestedPath(d map[string]any, pathStr string, val any) error {
	cleanPath := stripPathPrefix(pathStr)
	if cleanPath == "" {
		valMap, ok := val.(map[string]any)
		if !ok {
			return NewValidationError(
				fmt.Sprintf("Cannot set root data model %q to a non-map value.", pathStr),
				"",
			)
		}
		clear(d)
		keys := schemahelper.OrderedKeys(valMap)
		for _, k := range keys {
			d[k] = valMap[k]
		}
		schemahelper.SetMapKeyOrder(d, keys)
		return nil
	}

	keys := strings.Split(cleanPath, "/")
	var current any = d
	var parentMap map[string]any
	var parentSlice []any
	var parentKey string
	var parentIdx int

	assignBack := func(updated any) {
		if parentMap != nil {
			parentMap[parentKey] = updated
		} else if parentSlice != nil {
			parentSlice[parentIdx] = updated
		}
	}

	for i := 0; i < len(keys)-1; i++ {
		seg := keys[i]
		nextSeg := keys[i+1]
		isNextIndex := arrayIndexRe.MatchString(nextSeg)

		switch cur := current.(type) {
		case map[string]any:
			existing, has := cur[seg]
			if !has || existing == nil {
				var child any
				if isNextIndex {
					child = []any{}
				} else {
					child = map[string]any{}
				}
				cur[seg] = child
				parentMap, parentSlice, parentKey = cur, nil, seg
				current = child
				continue
			}
			switch existing.(type) {
			case map[string]any, []any:
				parentMap, parentSlice, parentKey = cur, nil, seg
				current = existing
			default:
				return NewValidationError(
					fmt.Sprintf("Cannot set path %q: segment %q is a primitive value.", pathStr, seg),
					"",
				)
			}

		case []any:
			idx, err := parseArrayIndex(seg, pathStr)
			if err != nil {
				return err
			}
			for len(cur) <= idx {
				cur = append(cur, nil)
			}
			assignBack(cur)
			existing := cur[idx]
			if existing == nil {
				var child any
				if isNextIndex {
					child = []any{}
				} else {
					child = map[string]any{}
				}
				cur[idx] = child
				parentMap, parentSlice, parentIdx = nil, cur, idx
				current = child
				continue
			}
			switch existing.(type) {
			case map[string]any, []any:
				parentMap, parentSlice, parentIdx = nil, cur, idx
				current = existing
			default:
				return NewValidationError(
					fmt.Sprintf("Cannot set path %q: segment %q is a primitive value.", pathStr, seg),
					"",
				)
			}
		}
	}

	lastKey := keys[len(keys)-1]
	switch cur := current.(type) {
	case map[string]any:
		cur[lastKey] = val
		return nil
	case []any:
		idx, err := parseArrayIndex(lastKey, pathStr)
		if err != nil {
			return err
		}
		for len(cur) <= idx {
			cur = append(cur, nil)
		}
		cur[idx] = val
		assignBack(cur)
		return nil
	default:
		return NewValidationError(fmt.Sprintf("Cannot set path %q.", pathStr), "")
	}
}

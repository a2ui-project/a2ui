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
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unsafe"
	"weak"
)

// The key order registry maps each live map to the source order of its keys. Go
// randomizes map iteration, so the JSON decoders and compilers here record the
// order of every object they build, and the prompt generators and decompilers read
// it back.
//
// An entry lasts exactly as long as its map. It refers to the map through a weak
// pointer, so the registry never keeps a map alive, and a map later allocated at the
// same address does not inherit the order, because the weak pointer to a collected
// map returns nil. Entries of collected maps are dropped when an insertion finds
// that its shard has doubled in size since the last sweep.

// keyOrderShardBits sets the number of independently locked registry shards, so that
// concurrent requests rarely contend for a lock.
const keyOrderShardBits = 6

// minKeyOrderSweepSize is the shard size below which insertions never sweep.
const minKeyOrderSweepSize = 256

type keyOrderEntry struct {
	ref  weak.Pointer[byte]
	keys []string
}

type keyOrderShard struct {
	mu      sync.RWMutex
	entries map[uintptr]keyOrderEntry
	sweepAt int // an insertion that finds this many entries first drops collected ones
}

var keyOrderShards [1 << keyOrderShardBits]keyOrderShard

// mapIdentity returns a pointer to the runtime header of m, which stays fixed for
// the life of the map, or nil when m is nil.
func mapIdentity(m map[string]any) *byte {
	return (*byte)(reflect.ValueOf(m).UnsafePointer())
}

func keyOrderShardFor(addr uintptr) *keyOrderShard {
	// Fibonacci hashing spreads the aligned header addresses evenly over the shards.
	return &keyOrderShards[(uint64(addr)*0x9E3779B97F4A7C15)>>(64-keyOrderShardBits)]
}

// SetMapKeyOrder records keys as the source order of the keys of m, for as long as m
// is alive. Registering m again replaces its order.
func SetMapKeyOrder(m map[string]any, keys []string) {
	p := mapIdentity(m)
	if p == nil {
		return
	}
	addr := uintptr(unsafe.Pointer(p))
	entry := keyOrderEntry{ref: weak.Make(p), keys: slices.Clone(keys)}

	shard := keyOrderShardFor(addr)
	shard.mu.Lock()
	defer shard.mu.Unlock()
	if shard.entries == nil {
		shard.entries = make(map[uintptr]keyOrderEntry)
	}
	if _, exists := shard.entries[addr]; !exists && len(shard.entries) >= shard.sweepAt {
		for a, e := range shard.entries {
			if e.ref.Value() == nil {
				delete(shard.entries, a)
			}
		}
		shard.sweepAt = max(2*len(shard.entries), minKeyOrderSweepSize)
	}
	shard.entries[addr] = entry
}

// recordedKeyOrder returns the key order registered for m, or nil if there is none.
func recordedKeyOrder(m map[string]any) []string {
	p := mapIdentity(m)
	if p == nil {
		return nil
	}
	addr := uintptr(unsafe.Pointer(p))
	shard := keyOrderShardFor(addr)
	shard.mu.RLock()
	entry, ok := shard.entries[addr]
	shard.mu.RUnlock()
	if !ok || entry.ref.Value() != p {
		return nil
	}
	return entry.keys
}

// OrderedKeys returns the keys of m in recorded source order if registered via SetMapKeyOrder,
// appending any newly added keys in deterministic alphabetical order, or sorted keys otherwise.
func OrderedKeys(m map[string]any) []string {
	if len(m) == 0 {
		return nil
	}
	recorded := recordedKeyOrder(m)
	if len(recorded) == 0 {
		return slices.Sorted(maps.Keys(m))
	}

	out := make([]string, 0, len(m))
	seen := make(map[string]bool, len(m))
	for _, k := range recorded {
		if _, exists := m[k]; exists && !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	if len(out) < len(m) {
		var extra []string
		for k := range m {
			if !seen[k] {
				extra = append(extra, k)
			}
		}
		slices.Sort(extra)
		out = append(out, extra...)
	}
	return out
}

// CloneMapPreservingOrder deep-clones m and its nested maps/slices while preserving recorded key order.
func CloneMapPreservingOrder(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	keys := OrderedKeys(m)
	out := make(map[string]any, len(m))
	for _, k := range keys {
		out[k] = CloneValuePreservingOrder(m[k])
	}
	SetMapKeyOrder(out, keys)
	return out
}

// CloneValuePreservingOrder deep-clones any JSON-compatible value while preserving map key order.
func CloneValuePreservingOrder(v any) any {
	switch val := v.(type) {
	case map[string]any:
		return CloneMapPreservingOrder(val)
	case []any:
		out := make([]any, len(val))
		for i, item := range val {
			out[i] = CloneValuePreservingOrder(item)
		}
		return out
	default:
		return v
	}
}

// EscapePointerSegment escapes a single JSON Pointer token per RFC 6901.
func EscapePointerSegment(seg string) string {
	s := strings.ReplaceAll(seg, "~", "~0")
	return strings.ReplaceAll(s, "/", "~1")
}

// ExtractJSONKeyOrder scans raw JSON bytes and returns a map from RFC 6901 JSON Pointer
// ("" for the root object) to the exact key order of every JSON object in data.
func ExtractJSONKeyOrder(data []byte) (map[string][]string, error) {
	_, keyOrder, err := UnmarshalJSONPreservingOrder(data)
	return keyOrder, err
}

// UnmarshalJSONPreservingOrder parses JSON bytes into Go maps/slices/scalars (using int64 for exact integers
// and float64 for floating-point numbers), registering every object's key order via SetMapKeyOrder and returning
// the RFC 6901 pointer-to-keys map.
func UnmarshalJSONPreservingOrder(data []byte) (any, map[string][]string, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	keyOrder := make(map[string][]string)

	val, err := decodeJSONValue(dec, "", keyOrder)
	if err != nil {
		return nil, nil, err
	}
	// Ensure no trailing non-whitespace tokens remain.
	if tok, tailErr := dec.Token(); tailErr != io.EOF {
		if tailErr != nil {
			return nil, nil, tailErr
		}
		return nil, nil, fmt.Errorf("unexpected trailing JSON token %v", tok)
	}
	return val, keyOrder, nil
}

func decodeJSONValue(dec *json.Decoder, ptr string, keyOrder map[string][]string) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	return decodeJSONFromToken(dec, tok, ptr, keyOrder)
}

func decodeJSONFromToken(dec *json.Decoder, tok json.Token, ptr string, keyOrder map[string][]string) (any, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := make(map[string]any)
			var keys []string
			seen := make(map[string]bool)
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyTok.(string)
				if !ok {
					return nil, fmt.Errorf("expected string object key at %s, got %T", ptr, keyTok)
				}
				childPtr := ptr + "/" + EscapePointerSegment(key)
				val, err := decodeJSONValue(dec, childPtr, keyOrder)
				if err != nil {
					return nil, err
				}
				obj[key] = val
				if !seen[key] {
					seen[key] = true
					keys = append(keys, key)
				}
			}
			// Consume closing '}'
			if _, err := dec.Token(); err != nil {
				return nil, err
			}
			keyOrder[ptr] = keys
			SetMapKeyOrder(obj, keys)
			return obj, nil

		case '[':
			arr := make([]any, 0)
			idx := 0
			for dec.More() {
				childPtr := ptr + "/" + strconv.Itoa(idx)
				val, err := decodeJSONValue(dec, childPtr, keyOrder)
				if err != nil {
					return nil, err
				}
				arr = append(arr, val)
				idx++
			}
			// Consume closing ']'
			if _, err := dec.Token(); err != nil {
				return nil, err
			}
			return arr, nil

		default:
			return nil, fmt.Errorf("unexpected delimiter %q at %s", t, ptr)
		}

	case json.Number:
		s := string(t)
		if !strings.ContainsAny(s, ".eE") {
			if iv, err := strconv.ParseInt(s, 10, 64); err == nil {
				return iv, nil
			}
		}
		fv, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, err
		}
		return fv, nil

	default:
		// string, bool, or nil
		return t, nil
	}
}

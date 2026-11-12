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

package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
)

// ParseJSON decodes the single JSON value in data into the Go values the SDK uses
// for JSON: map[string]any, []any, string, bool, nil, int64 for an integer literal
// (one without '.', 'e' or 'E') that fits in an int64, and float64 for every other
// number. Keeping integers and floats apart matches how the other A2UI SDKs parse
// JSON text, so a value such as 1500.0 keeps its float form. Anything other than
// whitespace after the value is an error, as is a number too large for a float64.
// Errors are *ParseError values.
func ParseJSON(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var raw any
	if err := dec.Decode(&raw); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, NewParseError("invalid JSON: empty input")
		}
		return nil, NewParseErrorf("invalid JSON: %v", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, NewParseError("invalid JSON: unexpected data after the top-level value")
	}
	return convertJSONNumbers(raw)
}

func convertJSONNumbers(v any) (any, error) {
	switch val := v.(type) {
	case json.Number:
		return parseJSONNumber(val.String())
	case map[string]any:
		for k, item := range val {
			converted, err := convertJSONNumbers(item)
			if err != nil {
				return nil, err
			}
			val[k] = converted
		}
		return val, nil
	case []any:
		for i, item := range val {
			converted, err := convertJSONNumbers(item)
			if err != nil {
				return nil, err
			}
			val[i] = converted
		}
		return val, nil
	default:
		return v, nil
	}
}

func parseJSONNumber(literal string) (any, error) {
	if !strings.ContainsAny(literal, ".eE") {
		if i, err := strconv.ParseInt(literal, 10, 64); err == nil {
			return i, nil
		}
	}
	f, err := strconv.ParseFloat(literal, 64)
	if err != nil {
		// Underflow rounds to zero, as JSON parsers in the other SDKs do; overflow has no float64 value.
		if errors.Is(err, strconv.ErrRange) && !math.IsInf(f, 0) {
			return f, nil
		}
		return nil, NewParseErrorf("invalid JSON: number %s is out of range", literal)
	}
	return f, nil
}

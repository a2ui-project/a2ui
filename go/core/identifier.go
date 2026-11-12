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
	"unicode"
)

// IsValidUAX31Identifier reports whether s is a valid Unicode UAX #31 identifier
// (starts with '_' or XID_Start and continues with XID_Continue characters,
// excluding Pattern_Syntax and Pattern_White_Space).
func IsValidUAX31Identifier(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		if i == 0 {
			if !isXIDStartOrUnderscore(r) {
				return false
			}
		} else if !isXIDContinue(r) {
			return false
		}
	}
	return true
}

func isXIDStartOrUnderscore(r rune) bool {
	if r == '_' {
		return true
	}
	if isNFKCExcludedXIDStart(r) || unicode.In(r, unicode.Pattern_Syntax, unicode.Pattern_White_Space) {
		return false
	}
	return unicode.In(r, unicode.L, unicode.Nl, unicode.Other_ID_Start)
}

func isXIDContinue(r rune) bool {
	if r == '_' {
		return true
	}
	if isNFKCExcludedXIDContinue(r) || unicode.In(r, unicode.Pattern_Syntax, unicode.Pattern_White_Space) {
		return false
	}
	return unicode.In(
		r,
		unicode.L,
		unicode.Nl,
		unicode.Nd,
		unicode.Mn,
		unicode.Mc,
		unicode.Pc,
		unicode.Other_ID_Start,
		unicode.Other_ID_Continue,
	)
}

func isNFKCExcludedXIDStart(r rune) bool {
	switch {
	case r == 0x037A, r == 0x0E33, r == 0x0EB3, r == 0xFDFA, r == 0xFDFB:
		return true
	case r >= 0xFC5E && r <= 0xFC63:
		return true
	case r >= 0xFE70 && r <= 0xFE7F:
		return true
	default:
		return false
	}
}

func isNFKCExcludedXIDContinue(r rune) bool {
	if isNFKCExcludedXIDStart(r) {
		return true
	}
	return r == 0x309B || r == 0x309C || r == 0xFF9E || r == 0xFF9F
}

// ValidateMetadata validates a v1.0 metadata object containing optional extensions.
func ValidateMetadata(meta map[string]any, version ProtocolVersion) error {
	if meta == nil {
		return nil
	}
	if !IsAtLeastVersion(string(version), Version1_0) {
		return NewValidationErrorf("metadata requires A2UI v1.0 or later (got %s)", version)
	}
	for k := range meta {
		if k != "extensions" {
			return NewValidationErrorf("unsupported metadata property %q", k)
		}
	}
	rawExt, ok := meta["extensions"]
	if !ok {
		return nil
	}
	ext, ok := rawExt.(map[string]any)
	if !ok {
		return NewValidationError("metadata.extensions must be a JSON object")
	}
	for k := range ext {
		if !IsValidUAX31Identifier(k) {
			return NewValidationErrorf("extension key %q must be a valid UAX #31 identifier", k)
		}
	}
	return nil
}

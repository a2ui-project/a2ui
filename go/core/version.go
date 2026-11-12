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
	"fmt"
	"strconv"
	"strings"
)

// ProtocolVersion identifies an A2UI specification version.
//
// Note the protocol's wire-format version spelling: v1.0 messages carry
// "version": "1.0" (no leading "v"), v0.9 and v0.9.1 carry "v0.9" or "v0.9.1",
// and v0.8 envelopes omit the "version" property.
type ProtocolVersion string

const (
	// Version0_8 is the deprecated v0.8 protocol specification.
	Version0_8 ProtocolVersion = "v0.8"
	// Version0_9 is the v0.9 protocol specification.
	Version0_9 ProtocolVersion = "v0.9"
	// Version0_9_1 is the v0.9.1 patch specification (compatible with v0.9).
	Version0_9_1 ProtocolVersion = "v0.9.1"
	// Version1_0 is the v1.0 protocol specification.
	Version1_0 ProtocolVersion = "1.0"
)

// SemVer represents a parsed major.minor.patch semantic version.
type SemVer struct {
	Major int
	Minor int
	Patch int
}

// ParseSemVer parses a version string with an optional leading "v" or "V".
func ParseSemVer(raw string) (SemVer, bool) {
	s := strings.TrimSpace(raw)
	if len(s) > 1 && (s[0] == 'v' || s[0] == 'V') && s[1] >= '0' && s[1] <= '9' {
		s = s[1:]
	}
	parts := strings.Split(s, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return SemVer{}, false
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil || major < 0 {
		return SemVer{}, false
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil || minor < 0 {
		return SemVer{}, false
	}
	patch := 0
	if len(parts) == 3 {
		patch, err = strconv.Atoi(parts[2])
		if err != nil || patch < 0 {
			return SemVer{}, false
		}
	}
	return SemVer{Major: major, Minor: minor, Patch: patch}, true
}

// Compare compares two semantic versions, returning -1, 0, or +1.
func (v SemVer) Compare(other SemVer) int {
	if v.Major != other.Major {
		if v.Major < other.Major {
			return -1
		}
		return 1
	}
	if v.Minor != other.Minor {
		if v.Minor < other.Minor {
			return -1
		}
		return 1
	}
	if v.Patch != other.Patch {
		if v.Patch < other.Patch {
			return -1
		}
		return 1
	}
	return 0
}

// ToProtocolVersion normalizes a raw version string (such as "1.0", "v1.0",
// "0.9", "v0.9", "0.9.1", "v0.9.1", "0.8", or "v0.8") to a known ProtocolVersion.
func ToProtocolVersion(raw string) (ProtocolVersion, error) {
	sv, ok := ParseSemVer(raw)
	if !ok {
		return "", NewCatalogErrorf("unsupported protocol version %q", raw)
	}
	switch {
	case sv.Major == 0 && sv.Minor == 8 && sv.Patch == 0:
		return Version0_8, nil
	case sv.Major == 0 && sv.Minor == 9 && sv.Patch == 0:
		return Version0_9, nil
	case sv.Major == 0 && sv.Minor == 9 && sv.Patch == 1:
		return Version0_9_1, nil
	case sv.Major == 1 && sv.Minor == 0 && sv.Patch == 0:
		return Version1_0, nil
	default:
		return "", NewCatalogErrorf("unsupported protocol version %q", raw)
	}
}

// WireVersion returns the wire-envelope "version" string for this protocol version.
func (v ProtocolVersion) WireVersion() string {
	switch v {
	case Version0_8:
		return ""
	case Version0_9:
		return "v0.9"
	case Version0_9_1:
		return "v0.9.1"
	case Version1_0:
		return "1.0"
	default:
		return string(v)
	}
}

// NumberString returns the bare numeric version without any leading "v" (for example, "0.9" or "1.0").
func (v ProtocolVersion) NumberString() string {
	s := string(v)
	return strings.TrimPrefix(strings.TrimPrefix(s, "v"), "V")
}

// Label returns the "v"-prefixed version string (for example, "v0.9" or "v1.0").
func (v ProtocolVersion) Label() string {
	return fmt.Sprintf("v%s", v.NumberString())
}

// IsAtLeastVersion reports whether version is greater than or equal to target.
func IsAtLeastVersion(version string, target ProtocolVersion) bool {
	v, ok1 := ParseSemVer(version)
	t, ok2 := ParseSemVer(string(target))
	if !ok1 || !ok2 {
		return false
	}
	return v.Compare(t) >= 0
}

// AreVersionsCompatible reports whether two catalog protocol versions can share a surface or state.
func AreVersionsCompatible(a, b ProtocolVersion) bool {
	if a == b {
		return true
	}
	if (a == Version0_9 || a == Version0_9_1) && (b == Version0_9 || b == Version0_9_1) {
		return true
	}
	return false
}

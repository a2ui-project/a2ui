package a2a

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
)

const (
	A2UIExtensionBaseURI     = "https://a2ui.org/a2a-extension/a2ui"
	MIMETypeKey              = "mimeType"
	A2UIMIMETypeV09          = "application/json+a2ui"
	A2UIMIMETypeV091         = "application/a2ui+json"
	A2UIMIMETypeV010         = "application/a2ui+json"
	MIMETypeV09              = A2UIMIMETypeV09
	MIMETypeV091             = A2UIMIMETypeV091
	MIMETypeV010             = A2UIMIMETypeV010
	A2UIMIMEType             = A2UIMIMETypeV09
	A2UIMIMETypeLatest       = A2UIMIMETypeV010
	MIMEType                 = A2UIMIMEType
	MIMETypeLatest           = A2UIMIMETypeLatest
	AcceptsInlineCatalogsKey = "acceptsInlineCatalogs"
	SupportedCatalogIDsKey   = "supportedCatalogIds"
)

// DataPart is a transport-neutral A2A data part carrying A2UI JSON.
// Its shape matches the official A2A Go SDK's DataPart.
type DataPart struct {
	Data     map[string]any `json:"data"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// Part is kept as a compatibility alias for earlier versions of this package.
type Part = DataPart

// AgentExtension is a transport-neutral A2A agent extension descriptor.
// Its shape matches the official A2A Go SDK's AgentExtension.
type AgentExtension struct {
	Description string         `json:"description,omitempty"`
	Params      map[string]any `json:"params,omitempty"`
	Required    bool           `json:"required,omitempty"`
	URI         string         `json:"uri"`
}

// Extension is kept as a compatibility alias for earlier versions of this package.
type Extension = AgentExtension

// Versioned reports the A2UI protocol version carried by a payload.
type Versioned interface {
	VersionString() string
}

// Meta returns the part metadata.
func (p DataPart) Meta() map[string]any {
	return p.Metadata
}

// SetMeta sets a metadata entry.
func (p *DataPart) SetMeta(k string, v any) {
	if p.Metadata == nil {
		p.Metadata = make(map[string]any)
	}
	p.Metadata[k] = v
}

// MarshalA2UIData marshals payload into an A2A data-part payload.
// A2A data parts carry JSON objects, so payload must encode as a JSON object.
func MarshalA2UIData(payload any) (map[string]any, error) {
	if object, ok := payload.(map[string]any); ok {
		if object == nil {
			return nil, fmt.Errorf("a2a: payload must encode as a JSON object")
		}
		return maps.Clone(object), nil
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("a2a: marshal payload: %w", err)
	}
	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, fmt.Errorf("a2a: decode payload object: %w", err)
	}
	if object == nil {
		return nil, fmt.Errorf("a2a: payload must encode as a JSON object")
	}
	return object, nil
}

// CreateDataPart marshals an A2UI payload into a transport-neutral A2A data part.
func CreateDataPart(payload any) (DataPart, error) {
	return CreateDataPartForVersion(payload, "")
}

// CreateDataPartForVersion marshals an A2UI payload using the MIME type for version.
func CreateDataPartForVersion(payload any, version string) (DataPart, error) {
	if version == "" {
		if versioned, ok := payload.(Versioned); ok {
			version = versioned.VersionString()
		}
	}
	data, err := MarshalA2UIData(payload)
	if err != nil {
		return DataPart{}, err
	}
	if version == "" {
		version, _ = data["version"].(string)
	}
	part := DataPart{Data: data}
	if version == "" {
		part.SetMeta(MIMETypeKey, A2UIMIMETypeLatest)
	} else {
		part.SetMeta(MIMETypeKey, MIMETypeForVersion(version))
	}
	return part, nil
}

// CreatePart marshals an A2UI payload into a transport-neutral A2A data part.
func CreatePart(payload any) (Part, error) {
	return CreateDataPart(payload)
}

// IsA2UIPart reports whether the part carries the A2UI MIME type.
func IsA2UIPart(part DataPart) bool {
	return IsPart(part)
}

// IsPart reports whether the part carries the A2UI MIME type.
func IsPart(part DataPart) bool {
	if part.Metadata == nil {
		return false
	}
	mimeType, _ := part.Metadata[MIMETypeKey].(string)
	return IsA2UIMIMEType(mimeType)
}

// IsA2UIMIMEType reports whether mimeType is a recognized A2UI MIME type.
func IsA2UIMIMEType(mimeType string) bool {
	return mimeType == A2UIMIMETypeV09 || mimeType == A2UIMIMETypeV091 || mimeType == A2UIMIMETypeV010
}

// MIMETypeForVersion returns the A2A MIME type used by an A2UI version.
func MIMETypeForVersion(version string) string {
	switch normalizeVersion(version) {
	case "v0.9":
		return A2UIMIMETypeV09
	case "v0.9.1":
		return A2UIMIMETypeV091
	default:
		return A2UIMIMETypeLatest
	}
}

// A2UIData returns the structured A2UI payload if the part carries A2UI data.
func A2UIData(part DataPart) (map[string]any, bool) {
	return Data(part)
}

// Data returns the structured A2UI payload if the part carries A2UI data.
func Data(part DataPart) (map[string]any, bool) {
	if !IsPart(part) {
		return nil, false
	}
	return part.Data, true
}

// AgentExtensionOptions configures an A2A agent extension descriptor.
type AgentExtensionOptions struct {
	Version               string
	AcceptsInlineCatalogs bool
	SupportedCatalogIDs   []string
}

// NewAgentExtension constructs an A2UI extension descriptor.
func NewAgentExtension(opts AgentExtensionOptions) AgentExtension {
	params := make(map[string]any)
	if opts.AcceptsInlineCatalogs {
		params[AcceptsInlineCatalogsKey] = true
	}
	if len(opts.SupportedCatalogIDs) > 0 {
		params[SupportedCatalogIDsKey] = append([]string(nil), opts.SupportedCatalogIDs...)
	}
	if len(params) == 0 {
		params = nil
	}
	return AgentExtension{
		URI:         fmt.Sprintf("%s/%s", A2UIExtensionBaseURI, normalizeVersion(opts.Version)),
		Description: "Provides agent driven UI using the A2UI JSON format.",
		Params:      params,
	}
}

// NewExtension constructs an A2UI extension descriptor.
func NewExtension(opts AgentExtensionOptions) Extension {
	return NewAgentExtension(opts)
}

// SelectNewestRequestedExtension returns the newest requested extension also advertised by the agent.
func SelectNewestRequestedExtension(requested, advertised []string) (string, bool) {
	best := ""
	for _, candidate := range requested {
		if !slices.Contains(advertised, candidate) {
			continue
		}
		if best == "" || compareExtensionVersion(candidate, best) > 0 {
			best = candidate
		}
	}
	if best == "" {
		return "", false
	}
	return best, true
}

// TryActivateExtension selects and activates the newest mutually supported extension.
func TryActivateExtension(requested, advertised []string) (activated, version string, ok bool) {
	activated, ok = SelectNewestRequestedExtension(requested, advertised)
	if !ok {
		return "", "", false
	}
	version = strings.TrimPrefix(activated, A2UIExtensionBaseURI+"/")
	version = strings.TrimPrefix(version, "v")
	return activated, version, true
}

func normalizeVersion(version string) string {
	version = strings.TrimSpace(version)
	version = strings.TrimPrefix(version, "v")
	if version == "" {
		return "v0.9"
	}
	return "v" + version
}

func compareExtensionVersion(a, b string) int {
	av := strings.TrimPrefix(strings.TrimPrefix(a, A2UIExtensionBaseURI+"/"), "v")
	bv := strings.TrimPrefix(strings.TrimPrefix(b, A2UIExtensionBaseURI+"/"), "v")
	aparts := parseVersionParts(av)
	bparts := parseVersionParts(bv)
	for i := 0; i < len(aparts) || i < len(bparts); i++ {
		var ai, bi int
		if i < len(aparts) {
			ai = aparts[i]
		}
		if i < len(bparts) {
			bi = bparts[i]
		}
		switch {
		case ai < bi:
			return -1
		case ai > bi:
			return 1
		}
	}
	return 0
}

func parseVersionParts(version string) []int {
	fields := strings.Split(version, ".")
	out := make([]int, 0, len(fields))
	for _, field := range fields {
		n, err := strconv.Atoi(field)
		if err != nil {
			return []int{0}
		}
		out = append(out, n)
	}
	return out
}

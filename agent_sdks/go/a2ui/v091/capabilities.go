package v091

import "encoding/json"

// ClientCapabilities describes a client's UI rendering capabilities,
// sent as part of A2A metadata.
type ClientCapabilities struct {
	V091 *ClientCapabilitiesV091 `json:"v0.9.1,omitempty"`
}

// ClientCapabilitiesV091 is the v0.9.1 client capabilities structure.
type ClientCapabilitiesV091 struct {
	SupportedCatalogIDs []string     `json:"supportedCatalogIds"`
	InlineCatalogs      []CatalogDef `json:"inlineCatalogs,omitempty"`
}

// ServerCapabilities describes an agent's supported UI features,
// advertised via agent card or other discovery.
type ServerCapabilities struct {
	V091 *ServerCapabilitiesV091 `json:"v0.9.1,omitempty"`
}

// ServerCapabilitiesV091 is the v0.9.1 server capabilities structure.
type ServerCapabilitiesV091 struct {
	SupportedCatalogIDs   []string `json:"supportedCatalogIds,omitempty"`
	AcceptsInlineCatalogs bool     `json:"acceptsInlineCatalogs,omitempty"`
}

// CatalogDef is an inline catalog definition containing component schemas
// and function definitions.
type CatalogDef struct {
	CatalogID  string                     `json:"catalogId"`
	Components map[string]json.RawMessage `json:"components,omitempty"`
	Functions  []FunctionDefinition       `json:"functions,omitempty"`
	Theme      map[string]json.RawMessage `json:"theme,omitempty"`
}

// FunctionDefinition describes a function's interface for catalog definitions.
type FunctionDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
	ReturnType  ReturnType      `json:"returnType"`
}

// ClientDataModel carries the client data model in A2A message metadata.
type ClientDataModel struct {
	Version  string                    `json:"version"`
	Surfaces map[string]map[string]any `json:"surfaces"`
}

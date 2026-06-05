package v010

import "encoding/json"

// CallableFrom describes where a catalog function may be invoked.
// Clients determine the execution boundary at runtime from the active catalog.
type CallableFrom string

const (
	CallableFromClientOnly     CallableFrom = "clientOnly"
	CallableFromRemoteOnly     CallableFrom = "remoteOnly"
	CallableFromClientOrRemote CallableFrom = "clientOrRemote"
)

// ClientCapabilities describes a client's UI rendering capabilities,
// sent as part of A2A metadata.
type ClientCapabilities struct {
	V010 *ClientCapabilitiesV010 `json:"v0.10,omitempty"`
}

// ClientCapabilitiesV010 is the v0.10 client capabilities structure.
type ClientCapabilitiesV010 struct {
	SupportedCatalogIDs []string     `json:"supportedCatalogIds"`
	InlineCatalogs      []CatalogDef `json:"inlineCatalogs,omitempty"`
}

// ServerCapabilities describes an agent's supported UI features,
// advertised via agent card or other discovery.
type ServerCapabilities struct {
	V010 *ServerCapabilitiesV010 `json:"v0.10,omitempty"`
}

// ServerCapabilitiesV010 is the v0.10 server capabilities structure.
type ServerCapabilitiesV010 struct {
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
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	CallableFrom CallableFrom    `json:"callableFrom,omitempty"`
	Parameters   json.RawMessage `json:"parameters"`
	ReturnType   ReturnType      `json:"returnType"`
}

// ClientDataModel carries the client data model in A2A message metadata.
type ClientDataModel struct {
	Version  string                    `json:"version"`
	Surfaces map[string]map[string]any `json:"surfaces"`
}

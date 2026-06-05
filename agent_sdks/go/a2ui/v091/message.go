package v091

// Version is the A2UI wire protocol version implemented by this package.
const Version = "v0.9"

// ServerMessage is a message sent from the agent to the renderer.
// Exactly one of the payload fields is non-nil.
type ServerMessage struct {
	Version          string            `json:"version"`
	CreateSurface    *CreateSurface    `json:"createSurface,omitempty"`
	UpdateComponents *UpdateComponents `json:"updateComponents,omitempty"`
	UpdateDataModel  *UpdateDataModel  `json:"updateDataModel,omitempty"`
	DeleteSurface    *DeleteSurface    `json:"deleteSurface,omitempty"`
}

// VersionString returns the A2UI protocol version carried by m.
func (m ServerMessage) VersionString() string { return m.Version }

// CreateSurface signals the client to create a new surface.
type CreateSurface struct {
	SurfaceID     string `json:"surfaceId"`
	CatalogID     string `json:"catalogId"`
	Theme         *Theme `json:"theme,omitempty"`
	SendDataModel bool   `json:"sendDataModel,omitempty"`
}

// UpdateComponents updates a surface with a new set of components.
type UpdateComponents struct {
	SurfaceID  string      `json:"surfaceId"`
	Components []Component `json:"components"`
}

// UpdateDataModel updates the data model for a surface.
type UpdateDataModel struct {
	SurfaceID string `json:"surfaceId"`
	Path      string `json:"path,omitempty"`
	Value     any    `json:"value,omitempty"`
}

// DeleteSurface signals the client to delete a surface.
type DeleteSurface struct {
	SurfaceID string `json:"surfaceId"`
}

// ClientMessage is a message sent from the renderer to the agent.
// Exactly one of Action or Error is non-nil.
type ClientMessage struct {
	Version string       `json:"version"`
	Action  *ActionEvent `json:"action,omitempty"`
	Error   *ClientError `json:"error,omitempty"`
}

// VersionString returns the A2UI protocol version carried by m.
func (m ClientMessage) VersionString() string { return m.Version }

// ActionEvent reports a user-initiated action from a component.
type ActionEvent struct {
	Name              string         `json:"name"`
	SurfaceID         string         `json:"surfaceId"`
	SourceComponentID string         `json:"sourceComponentId"`
	Timestamp         string         `json:"timestamp"`
	Context           map[string]any `json:"context"`
}

// ClientError reports a client-side error.
type ClientError struct {
	Code      string `json:"code"`
	SurfaceID string `json:"surfaceId"`
	Message   string `json:"message"`
	Path      string `json:"path,omitempty"`
}

package v010

// Version is the A2UI protocol version implemented by this package.
const Version = "v0.10"

// ServerMessage is a message sent from the agent to the renderer.
// Exactly one of the payload fields is non-nil.
type ServerMessage struct {
	Version          string            `json:"version"`
	FunctionCallID   string            `json:"functionCallId,omitempty"`
	ActionID         string            `json:"actionId,omitempty"`
	WantResponse     bool              `json:"wantResponse,omitempty"`
	CreateSurface    *CreateSurface    `json:"createSurface,omitempty"`
	UpdateComponents *UpdateComponents `json:"updateComponents,omitempty"`
	UpdateDataModel  *UpdateDataModel  `json:"updateDataModel,omitempty"`
	DeleteSurface    *DeleteSurface    `json:"deleteSurface,omitempty"`
	CallFunction     *FunctionCall     `json:"callFunction,omitempty"`
	ActionResponse   *ActionResponse   `json:"actionResponse,omitempty"`
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

// ActionResponse is a response to a client-initiated action.
type ActionResponse struct {
	Value    any                  `json:"-"`
	HasValue bool                 `json:"-"`
	Error    *ActionResponseError `json:"-"`
}

// ActionResponseValue returns an action response with a value, including nil.
func ActionResponseValue(value any) ActionResponse {
	return ActionResponse{Value: value, HasValue: true}
}

// ActionResponseError reports a failed action response.
type ActionResponseError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ClientMessage is a message sent from the renderer to the agent.
// Exactly one of Action, FunctionResponse, or Error is non-nil.
type ClientMessage struct {
	Version          string            `json:"version"`
	Action           *ActionEvent      `json:"action,omitempty"`
	FunctionResponse *FunctionResponse `json:"functionResponse,omitempty"`
	Error            *ClientError      `json:"error,omitempty"`
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
	WantResponse      bool           `json:"wantResponse,omitempty"`
	ActionID          string         `json:"actionId,omitempty"`
}

// FunctionResponse reports the result of a server-initiated function call.
type FunctionResponse struct {
	FunctionCallID string `json:"functionCallId"`
	Call           string `json:"call"`
	Value          any    `json:"value"`
}

// ClientError reports a client-side error.
type ClientError struct {
	Code           string `json:"code"`
	SurfaceID      string `json:"surfaceId,omitempty"`
	FunctionCallID string `json:"functionCallId,omitempty"`
	Message        string `json:"message"`
	Path           string `json:"path,omitempty"`
}

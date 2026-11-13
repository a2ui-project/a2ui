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

package adk

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"

	"github.com/a2aproject/a2a-go/a2a"
	"google.golang.org/adk/v2/session"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/core"
)

// SurfaceIDAlreadyExistsError reports that a subagent attempted to create a surface ID
// already owned by another subagent in the session. It carries core.CategoryIntegrity.
type SurfaceIDAlreadyExistsError struct {
	*core.IntegrityError
	SurfaceID string
}

// NewSurfaceIDAlreadyExistsError constructs a SurfaceIDAlreadyExistsError.
func NewSurfaceIDAlreadyExistsError(surfaceID, message string) *SurfaceIDAlreadyExistsError {
	return &SurfaceIDAlreadyExistsError{
		IntegrityError: core.NewIntegrityError(message),
		SurfaceID:      surfaceID,
	}
}

// Surface ownership: when several subagents render into one client, each surface belongs
// to the subagent that created it. The functions below record that ownership in ADK
// session state under SurfaceIDKeyPrefix keys, route client events to the owning
// subagent, and keep each subagent from seeing other subagents' surfaces.

func surfaceStateKey(surfaceID string) string {
	return SurfaceIDKeyPrefix + surfaceID
}

// SurfaceOwner returns the name of the subagent that owns surfaceID in state, or ""
// if no subagent does.
func SurfaceOwner(state session.ReadonlyState, surfaceID string) string {
	if state == nil || surfaceID == "" {
		return ""
	}
	val, err := state.Get(surfaceStateKey(surfaceID))
	if err != nil {
		return ""
	}
	owner, _ := val.(string)
	return owner
}

// SurfaceOwnerForClientEvent returns the subagent that owns the surface an inbound client
// A2UI action or error refers to, or "" if part is neither or the surface is unowned.
func SurfaceOwnerForClientEvent(state session.ReadonlyState, part a2a.Part) string {
	dp, ok := a2aext.A2UIDataPart(part)
	if !ok || dp.Data == nil {
		return ""
	}
	var surfaceID string
	if actionMap, ok := dp.Data["action"].(map[string]any); ok {
		surfaceID, _ = actionMap["surfaceId"].(string)
	} else if errMap, ok := dp.Data["error"].(map[string]any); ok {
		surfaceID, _ = errMap["surfaceId"].(string)
	}
	return SurfaceOwner(state, surfaceID)
}

// SetSurfaceOwner records subagentName as the owner of surfaceID by appending a
// state-delta event authored by "system" to sess.
func SetSurfaceOwner(ctx context.Context, svc session.Service, sess session.Session, surfaceID, subagentName string) error {
	if svc == nil || sess == nil {
		return errors.New("SetSurfaceOwner needs a session service and a session")
	}
	key := surfaceStateKey(surfaceID)
	if existing, err := sess.State().Get(key); err == nil && existing == subagentName {
		return nil
	}
	return appendStateDelta(ctx, svc, sess, map[string]any{key: subagentName})
}

// RemoveSurfaceOwner clears the owner of surfaceID by appending a state-delta event
// authored by "system" to sess. It does nothing if the surface has no owner.
func RemoveSurfaceOwner(ctx context.Context, svc session.Service, sess session.Session, surfaceID string) error {
	if svc == nil || sess == nil {
		return errors.New("RemoveSurfaceOwner needs a session service and a session")
	}
	key := surfaceStateKey(surfaceID)
	if existing, err := sess.State().Get(key); err != nil || existing == nil {
		return nil
	}
	return appendStateDelta(ctx, svc, sess, map[string]any{key: nil})
}

func appendStateDelta(ctx context.Context, svc session.Service, sess session.Session, delta map[string]any) error {
	invID, err := randomHex()
	if err != nil {
		return err
	}
	ev := session.NewEvent(ctx, "e-"+invID)
	ev.Author = "system"
	ev.Actions = session.EventActions{StateDelta: delta}
	return svc.AppendEvent(ctx, sess, ev)
}

func randomHex() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate invocation ID: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

// UpdateSurfaceOwnership updates surface ownership in sess from an outbound A2UI part
// authored by author: createSurface (or v0.8 beginRendering) records author as the
// owner, and deleteSurface clears the owner. Creating a surface that another subagent
// already owns returns a *SurfaceIDAlreadyExistsError.
func UpdateSurfaceOwnership(ctx context.Context, svc session.Service, sess session.Session, part a2a.Part, author string) error {
	dp, ok := a2aext.A2UIDataPart(part)
	if !ok || len(dp.Data) == 0 {
		return nil
	}
	data := dp.Data

	createMap, ok := data["createSurface"].(map[string]any)
	if !ok {
		createMap, _ = data["beginRendering"].(map[string]any)
	}
	if surfaceID, _ := createMap["surfaceId"].(string); surfaceID != "" {
		if owner := SurfaceOwner(sess.State(), surfaceID); owner != "" {
			return NewSurfaceIDAlreadyExistsError(
				surfaceID,
				fmt.Sprintf("Surface ID %s already exists: surface was previously created by %s, and %s tried to create it again", surfaceID, owner, author),
			)
		}
		return SetSurfaceOwner(ctx, svc, sess, surfaceID, author)
	}

	if delMap, ok := data["deleteSurface"].(map[string]any); ok {
		if surfaceID, _ := delMap["surfaceId"].(string); surfaceID != "" {
			return RemoveSurfaceOwner(ctx, svc, sess, surfaceID)
		}
	}
	return nil
}

// StripUnownedSurfaces removes from clientDataModel["surfaces"] every surface that
// subagentName does not own according to state. With an empty subagentName, every
// surface is removed.
func StripUnownedSurfaces(state session.ReadonlyState, subagentName string, clientDataModel map[string]any) {
	if clientDataModel == nil {
		return
	}
	rawSurfaces, exists := clientDataModel["surfaces"]
	if !exists || rawSurfaces == nil {
		slog.Warn("The client data model has no surfaces")
		return
	}
	surfaces, ok := rawSurfaces.(map[string]any)
	if !ok {
		slog.Warn("The client data model's surfaces are not an object", "type", fmt.Sprintf("%T", rawSurfaces))
		return
	}
	if len(surfaces) == 0 {
		return
	}
	if subagentName == "" {
		clientDataModel["surfaces"] = map[string]any{}
		return
	}
	for surfaceID := range surfaces {
		if SurfaceOwner(state, surfaceID) != subagentName {
			delete(surfaces, surfaceID)
		}
	}
}

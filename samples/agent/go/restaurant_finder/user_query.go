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

package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/a2aproject/a2a-go/a2a"
)

// uiAction represents a client-originated UI action extracted from an inbound A2A DataPart.
type uiAction struct {
	Name    string
	Context map[string]any
}

// inboundMessage holds parsed text, UI action, and streaming preference from an inbound A2A Message.
type inboundMessage struct {
	Text         string
	Action       *uiAction
	UseStreaming bool
}

// userQuery holds the natural-language model prompt derived from an InboundMessage.
type userQuery struct {
	Query        string
	ActionName   string
	UseStreaming bool
}

// readInboundMessage extracts text parts, UI actions (v1.0/v0.9 "action" or legacy "userAction"),
// and the "useStreaming" toggle from message.
func readInboundMessage(message *a2a.Message, version string) inboundMessage {
	useStreaming := true
	var rawAction map[string]any
	var texts []string

	if message != nil {
		for _, part := range message.Parts {
			switch p := part.(type) {
			case a2a.TextPart:
				if p.Text != "" {
					texts = append(texts, p.Text)
				}
			case *a2a.TextPart:
				if p != nil && p.Text != "" {
					texts = append(texts, p.Text)
				}
			case a2a.DataPart:
				readDataPartAction(p.Data, version, &useStreaming, &rawAction)
			case *a2a.DataPart:
				if p != nil {
					readDataPartAction(p.Data, version, &useStreaming, &rawAction)
				}
			}
		}
	}

	var action *uiAction
	if rawAction != nil {
		name, _ := rawAction["name"].(string)
		ctxMap, _ := rawAction["context"].(map[string]any)
		if ctxMap == nil {
			ctxMap = map[string]any{}
		}
		action = &uiAction{Name: name, Context: ctxMap}
	}

	return inboundMessage{
		Text:         strings.Join(texts, ""),
		Action:       action,
		UseStreaming: useStreaming,
	}
}

func readDataPartAction(data map[string]any, version string, useStreaming *bool, rawAction *map[string]any) {
	if data == nil {
		return
	}
	if us, ok := data["useStreaming"].(bool); ok {
		*useStreaming = us
	}
	if msgVer, _ := data["version"].(string); msgVer == version {
		if act, ok := data["action"].(map[string]any); ok {
			*rawAction = act
			return
		}
	}
	if act, ok := data["action"].(map[string]any); ok && data["version"] != nil {
		*rawAction = act
		return
	}
	if ua, ok := data["userAction"].(map[string]any); ok {
		*rawAction = ua
	}
}

// buildUserQuery turns an InboundMessage into a prompt string for the LLM.
func buildUserQuery(in inboundMessage) userQuery {
	if in.Action == nil {
		q := in.Text
		if strings.TrimSpace(q) == "" {
			q = "Hello!"
		}
		return userQuery{Query: q, UseStreaming: in.UseStreaming}
	}

	actionName := in.Action.Name
	ctx := in.Action.Context
	var query string
	switch actionName {
	case "book_restaurant":
		restaurantName := stringOrDefault(ctx["restaurantName"], "Unknown Restaurant")
		address := stringOrDefault(ctx["address"], "Address not provided")
		imageURL := stringOrDefault(ctx["imageUrl"], "")
		query = fmt.Sprintf("USER_WANTS_TO_BOOK: %s, Address: %s, ImageURL: %s", restaurantName, address, imageURL)

	case "submit_booking":
		restaurantName := stringOrDefault(ctx["restaurantName"], "Unknown Restaurant")
		partySize := anyStringOrDefault(ctx["partySize"], "Unknown Size")
		reservationTime := stringOrDefault(ctx["reservationTime"], "Unknown Time")
		dietary := stringOrDefault(ctx["dietary"], "None")
		imageURL := stringOrDefault(ctx["imageUrl"], "")
		query = fmt.Sprintf(
			"User submitted a booking for %s for %s people at %s with dietary requirements: %s. The image URL is %s",
			restaurantName, partySize, reservationTime, dietary, imageURL,
		)

	default:
		encoded, _ := json.Marshal(ctx)
		query = fmt.Sprintf("User submitted an event: %s with data: %s", actionName, string(encoded))
	}

	return userQuery{
		Query:        query,
		ActionName:   actionName,
		UseStreaming: in.UseStreaming,
	}
}

func stringOrDefault(v any, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}

func anyStringOrDefault(v any, def string) string {
	if v == nil {
		return def
	}
	if s, ok := v.(string); ok {
		if s == "" {
			return def
		}
		return s
	}
	return fmt.Sprintf("%v", v)
}

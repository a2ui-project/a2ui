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
	"fmt"
	"strings"
)

// roleDescription defines the assistant's top-level behavior.
const roleDescription = "You are a helpful restaurant finding assistant. Your final output MUST be an A2UI UI definition."

// uiDescriptionDirectJSON describes domain template selection rules for Direct JSON generation.
const uiDescriptionDirectJSON = `- If the query is for a list of restaurants, first call the get_restaurants tool if needed, then use the restaurant data to populate the UI and data model.
- IMPORTANT: When using updateDataModel to update items, specify path: "/items" or "/" with an "items" array of restaurants.
- IMPORTANT: Always specify the path when using updateDataModel.
- If the number of restaurants is 5 or fewer, follow the single_column_list example structure.
- If the number of restaurants is more than 5, follow the two_column_list example structure.
- If the query is to book a restaurant (for example, "USER_WANTS_TO_BOOK..."), follow the booking_form example structure with a submit_booking button action.
- If the query is a booking submission (for example, "User submitted a booking..."), follow the confirmation example structure.`

// uiDescriptionExpress describes domain template selection rules for Express DSL generation.
const uiDescriptionExpress = `- If the query is for a list of restaurants, first call the get_restaurants tool if needed, then use the restaurant data to populate the UI and data model.
- If the number of restaurants is 5 or fewer, follow the single_column_list example structure.
- If the number of restaurants is more than 5, follow the two_column_list example structure.
- If the query is to book a restaurant (for example, "USER_WANTS_TO_BOOK..."), follow the booking_form example structure with a submit_booking button Event.
- If the query is a booking submission (for example, "User submitted a booking..."), follow the confirmation example structure.`

// fallbackText is returned when validation retries are exhausted.
const fallbackText = "I'm sorry, I'm having trouble generating the interface for that request right now. Please try again in a moment."

// buildBaseInstruction returns the domain role and UI description before appending the A2UI prompt snippet.
func buildBaseInstruction(format a2uiFormat) string {
	uiDesc := uiDescriptionExpress
	if format == formatDirectJSON {
		uiDesc = uiDescriptionDirectJSON
	}
	return strings.Join([]string{roleDescription, "## UI Description:\n" + uiDesc}, "\n\n")
}

// retryQuery constructs the self-repair prompt sent when an LLM response fails A2UI compilation or schema validation.
func retryQuery(format a2uiFormat, validationErr, originalQuery string) string {
	if format == formatDirectJSON {
		return fmt.Sprintf(
			"Your previous response was invalid. Validation failed: %s. You MUST generate a valid response "+
				"that strictly follows the A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI messages. "+
				"Ensure each JSON part is wrapped in '<a2ui-json>' and '</a2ui-json>' tags. Please retry the original request: '%s'",
			validationErr, originalQuery,
		)
	}
	return fmt.Sprintf(
		"Your previous response was invalid. Validation failed: %s. You MUST generate a valid response "+
			"that is valid A2UI Express wrapped in the '<a2ui>' and '</a2ui>' tags. Please retry the original request: '%s'",
		validationErr, originalQuery,
	)
}

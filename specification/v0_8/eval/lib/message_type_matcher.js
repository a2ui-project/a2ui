"use strict";
/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageTypeMatcher = void 0;
const schema_matcher_1 = require("./schema_matcher");
/**
 * A concrete matcher that verifies the top-level message type.
 */
class MessageTypeMatcher extends schema_matcher_1.SchemaMatcher {
    constructor(messageType) {
        super();
        this.messageType = messageType;
    }
    validate(response) {
        if (!response || typeof response !== 'object') {
            return {
                success: false,
                error: 'Response is not a valid object.',
            };
        }
        const keys = Object.keys(response);
        if (keys.length === 1 && keys[0] === this.messageType) {
            return { success: true };
        }
        else {
            return {
                success: false,
                error: `Expected top-level message type to be '${this.messageType}', but found '${keys.join(', ')}'`,
            };
        }
    }
    get description() {
        return `Expected top-level message type to be '${this.messageType}'`;
    }
}
exports.MessageTypeMatcher = MessageTypeMatcher;

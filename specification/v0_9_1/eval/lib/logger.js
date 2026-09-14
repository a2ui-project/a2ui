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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.setupLogger = setupLogger;
const winston = __importStar(require("winston"));
const path = __importStar(require("path"));
let fileTransport = null;
const consoleTransport = new winston.transports.Console({
    level: 'info', // Default to info, can be updated later
    format: winston.format.combine(winston.format.colorize(), winston.format.printf(({ timestamp, level, message }) => {
        // Clear the current line (where progress bar might be) before logging
        // \r clears the line, \x1b[K clears from cursor to end of line
        return `\r\x1b[K${timestamp} [${level}]: ${message}`;
    })),
});
// Create a default logger instance that logs to console only initially
exports.logger = winston.createLogger({
    level: 'debug', // Allow all logs to flow through (transports can filter)
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level}]: ${message}`;
    })),
    transports: [consoleTransport],
});
function setupLogger(outputDir, logLevel) {
    // Ensure the global level allows debug logs so they reach the file transport
    exports.logger.level = 'debug';
    // Update Console transport level to match user preference directly
    consoleTransport.level = logLevel;
    if (fileTransport) {
        exports.logger.remove(fileTransport);
        fileTransport = null;
    }
    if (outputDir) {
        fileTransport = new winston.transports.File({
            filename: path.join(outputDir, 'output.log'),
            level: 'debug', // Always capture everything in the file
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        });
        exports.logger.add(fileTransport);
    }
}

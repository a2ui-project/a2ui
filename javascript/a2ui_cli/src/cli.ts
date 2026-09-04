#!/usr/bin/env node
/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Command} from 'commander';
import {createCodegenCommand} from './commands/codegen.js';

const program = new Command();

program
  .name('a2ui')
  .description('A2UI CLI developer tool and typesafe component generator')
  .version('0.1.0');

// Register modular subcommands
program.addCommand(createCodegenCommand());

// Entry point execution
program.parseAsync(process.argv).catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import sys
import traceback
import argparse
from inspect_ai import eval_set
from tasks import a2ui_v0_9_eval

def main():
    parser = argparse.ArgumentParser(description="Run A2UI evaluations")
    parser.add_argument("--sanity", action="store_true", help="Run a quick sanity check (2 samples, gemini-3.1-flash-lite, 0 retry)")
    parser.add_argument("--model", type=str, default="google/gemini-3-flash-preview", help="Model used to evaluate tasks")
    parser.add_argument("--grading-model", type=str, default="google/gemini-3-flash-preview", help="Model used for grading")
    parser.add_argument("--max-retries", type=int, default=0, help="Maximum number of retries")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of samples to evaluate")
    parser.add_argument("--log-dir", type=str, default="logs", help="Directory to save logs")
    parser.add_argument("--sample-shuffle", type=int, default=None, help="Seed for shuffling samples")
    args = parser.parse_args()

    model = "google/gemini-3.1-flash-lite" if args.sanity else args.model
    limit = 2 if args.sanity else args.limit
    retry_attempts = 0 if args.sanity else args.max_retries
    sample_shuffle = None if args.sanity else args.sample_shuffle

    print("Starting evaluation for multiple strategies...")
    success, logs = eval_set(
        tasks=[
            a2ui_v0_9_eval(strategy="direct", grading_model=args.grading_model),
            a2ui_v0_9_eval(strategy="subagent_tool", grading_model=args.grading_model)
        ],
        model=model,
        log_dir=args.log_dir,
        retry_attempts=retry_attempts,
        limit=limit,
        sample_shuffle=sample_shuffle
    )
    if not success:
        print("Evaluation returned failure status!")
        sys.exit(1)
        
    print(f"\nEvaluations complete. Logs saved to: {os.path.abspath('logs')}")

if __name__ == "__main__":
    main()

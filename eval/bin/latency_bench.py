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

"""
latency_bench.py

This script evaluates multiple models and reports the average latency and success rate 
for the A2UI evaluations. 

Usage:
  uv run python3 bin/latency_bench.py

Options:
  --limit N     Specify the number of samples to evaluate. By default (0), there is 
                no limit and all samples are evaluated. Passing a limit (e.g. --limit 2) 
                can make the evaluation significantly faster for debugging or quick benchmarking.
  --models      Comma-separated list of model names to evaluate.
  --log-dir     Directory where the inspect logs are saved and analyzed.
"""

import sys
import os
import subprocess
import argparse
from pathlib import Path
from datetime import datetime, timezone
from inspect_ai.log import read_eval_log

def main():
    parser = argparse.ArgumentParser(description="Run benchmarks for multiple models and report latency.")
    parser.add_argument("--models", type=str, default="google/gemini-3-flash-preview,google/gemini-3.1-flash-lite,google/gemini-3.1-pro-preview", help="Comma-separated list of models to evaluate.")
    parser.add_argument("--log-dir", type=str, default="bench_logs", help="Directory to save logs.")
    parser.add_argument("--limit", type=int, default=0, help="Number of samples to evaluate. 0 for no limit.")
    args = parser.parse_args()

    # Create log directory if it doesn't exist
    os.makedirs(args.log_dir, exist_ok=True)

    print(f"Running main.py with models: {args.models}")
    # Run main.py using uv
    main_script = Path(__file__).parent.parent / "main.py"
    
    cmd = [
        "uv", "run", "python3", str(main_script),
        "--log-dir", args.log_dir
    ]
    for m in args.models.split(","):
        cmd.extend(["--model", m.strip()])

    if args.limit > 0:
        cmd.extend(["--limit", str(args.limit)])
    
    print(f"Executing: {' '.join(cmd)}")
    bench_start_time = datetime.now(timezone.utc)
    subprocess.run(cmd, check=True)
    
    # Analyze logs
    print("\n" + "="*40)
    print("Latency Benchmark Results")
    print("="*40)
    log_files = list(Path(args.log_dir).glob("*.eval")) + list(Path(args.log_dir).glob("*.json"))
    
    # Keep track of the most recent log per task and model
    model_stats = {}
    
    for log_file in log_files:
        try:
            log = read_eval_log(str(log_file))
            if not log or not log.eval or not log.stats:
                continue
            
            task_name = log.eval.task
            model_name = log.eval.model
            started_at = datetime.fromisoformat(log.stats.started_at.replace('Z', '+00:00'))
            completed_at = datetime.fromisoformat(log.stats.completed_at.replace('Z', '+00:00'))
            duration = (completed_at - started_at).total_seconds()
            
            # Extract success rate (accuracy)
            success_rate = None
            if log.results and log.results.scores:
                for score in log.results.scores:
                    if score.metrics and 'accuracy' in score.metrics:
                        success_rate = score.metrics['accuracy'].value
                        break
            
            key = (task_name, model_name)
            # Save the latest duration
            if started_at < bench_start_time:
                continue
            if key not in model_stats or model_stats[key]['started_at'] < started_at:
                model_stats[key] = {
                    'started_at': started_at,
                    'duration': duration,
                    'samples': len(log.samples) if log.samples else 0,
                    'success_rate': success_rate
                }
        except Exception as e:
            print(f"Failed to read {log_file}: {e}")

    for (task, model), stats in sorted(model_stats.items()):
        print(f"Task: {task} | Model: {model}")
        print(f"  Total Duration (s) : {stats['duration']:.2f}")
        print(f"  Total Samples      : {stats['samples']}")
        if stats['samples'] > 0:
            print(f"  Avg Latency/Sample : {stats['duration'] / stats['samples']:.2f} s")
        if stats['success_rate'] is not None:
            print(f"  Success Rate       : {stats['success_rate']*100:.1f}%")
        print("-" * 40)

if __name__ == "__main__":
    main()

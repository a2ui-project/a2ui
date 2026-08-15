#!/usr/bin/env bash
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -eEuo pipefail

failure() {
  local exit_code=$?
  echo "===================================================="
  echo "❌ ERROR: fix_format.sh failed on line ${BASH_LINENO[0]} with exit status $exit_code"
  echo "Command: ${BASH_COMMAND}"
  echo "===================================================="
  exit "$exit_code"
}
trap 'failure' ERR

usage() {
  cat <<'EOF'
Usage: fix_format.sh [--check] [--changed] [--base <ref>] [--plan]

Formats (or checks) the repository with Prettier, Pyink, dart format,
swift-format, and ktfmt.

Options:
  --check        Report formatting problems instead of rewriting files.
  --changed      Only consider files that differ from the base ref. Formatters
                 whose languages are untouched are skipped entirely, so a
                 TypeScript-only change is never blocked by, say, unrelated
                 Dart formatting drift.
  --base <ref>   Base ref used by --changed. Defaults to the first of
                 origin/main, upstream/main, or main that exists locally.
                 Implies --changed.
  --plan         Print which formatters would run, and over how many files,
                 then exit without invoking any formatter. Requires no
                 language toolchains, so it is safe to run anywhere.
  -h, --help     Show this message.

With no options the whole repository is formatted, which remains the correct
behaviour for scheduled and post-submit runs.
EOF
}

CHECK_ONLY=false
CHANGED_ONLY=false
PLAN_ONLY=false
BASE_REF=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=true
      shift
      ;;
    --changed)
      CHANGED_ONLY=true
      shift
      ;;
    --base)
      if [[ $# -lt 2 ]]; then
        echo "❌ --base requires a git ref argument." >&2
        exit 2
      fi
      BASE_REF="$2"
      CHANGED_ONLY=true
      shift 2
      ;;
    --base=*)
      BASE_REF="${1#--base=}"
      CHANGED_ONLY=true
      shift
      ;;
    --plan)
      PLAN_ONLY=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "❌ Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Get repo root
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

YARN_CMD=(yarn)
if command -v corepack >/dev/null 2>&1; then
  YARN_CMD=(corepack yarn)
fi

# ---------------------------------------------------------------------------
# Changed-file discovery
# ---------------------------------------------------------------------------

# Picks the base ref to diff against when the caller did not name one.
detect_base_ref() {
  local candidate
  for candidate in origin/main upstream/main main; do
    if git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# Emits the repo-relative path of every file that differs from the base ref,
# including staged, unstaged, and untracked work so that local runs match what
# CI will see. Deleted paths are dropped: there is nothing left to format.
collect_changed_files() {
  local base="$1"
  local diff_point

  # Comparing against the merge base rather than the branch tip keeps unrelated
  # commits that landed on main out of the changed set.
  if ! diff_point="$(git merge-base HEAD "$base" 2>/dev/null)"; then
    diff_point="$base"
  fi

  {
    git diff --name-only --diff-filter=ACMRT "$diff_point" --
    git diff --name-only --diff-filter=ACMRT --
    git diff --cached --name-only --diff-filter=ACMRT --
    git ls-files --others --exclude-standard
  } | sort -u | while IFS= read -r path; do
    [[ -n "$path" && -f "$path" ]] && echo "$path"
  done
}

CHANGED_FILES=""
if [ "$CHANGED_ONLY" = true ]; then
  if [ -z "$BASE_REF" ]; then
    if ! BASE_REF="$(detect_base_ref)"; then
      echo "❌ --changed could not find a base ref (tried origin/main, upstream/main, main)." >&2
      echo "   Pass one explicitly, e.g. --base origin/main." >&2
      exit 2
    fi
  fi
  if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
    echo "❌ --base ref '$BASE_REF' does not exist locally." >&2
    exit 2
  fi
  echo "Scoping to files changed against '$BASE_REF'."
  CHANGED_FILES="$(collect_changed_files "$BASE_REF")"
  if [ -z "$CHANGED_FILES" ]; then
    echo "No changed files detected; nothing to format."
  fi
fi

# Filters the changed set by an extended regex. In whole-repo mode this yields
# nothing, and callers fall back to their existing directory-wide invocation.
select_changed() {
  local pattern="$1"
  [ -n "$CHANGED_FILES" ] || return 0
  printf '%s\n' "$CHANGED_FILES" | grep -E "$pattern" || true
}

# True when a formatter has no work to do and should be skipped outright.
should_skip() {
  local label="$1" selected="$2"
  if [ "$CHANGED_ONLY" = true ] && [ -z "$selected" ]; then
    echo "Skipping $label: no matching files changed."
    return 0
  fi
  return 1
}

count_lines() {
  local value="$1"
  [ -n "$value" ] || {
    echo 0
    return 0
  }
  printf '%s\n' "$value" | wc -l | tr -d ' '
}

# Splits a newline-delimited string into the global array SELECTED_TARGETS.
# Written the long way rather than with mapfile so the script keeps working on
# the bash 3.2 that ships with macOS.
split_into_targets() {
  local line
  SELECTED_TARGETS=()
  while IFS= read -r line; do
    [ -n "$line" ] && SELECTED_TARGETS+=("$line")
  done <<<"$1"
}

# ---------------------------------------------------------------------------
# Per-language file selection
#
# Each selector mirrors the directory scope used by the corresponding
# whole-repo run below, so --changed can never widen what a formatter touches.
# ---------------------------------------------------------------------------

# Prettier's built-in parsers. Matching on extension rather than handing over
# the whole changed set is what lets a Swift-only or Dart-only change report
# "prettier: 0" and skip installing Node altogether. Anything Prettier gains a
# parser for through a plugin would need adding here; until then the
# whole-repo post-submit run remains the backstop.
PRETTIER_EXTENSIONS='\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|json|jsonc|json5|css|scss|less|html|htm|vue|md|markdown|mdx|ya?ml|graphql|gql|hbs|handlebars)$'
PRETTIER_FILES="$(select_changed "$PRETTIER_EXTENSIONS|(^|/)\.(prettierrc|babelrc)$")"
# pyink's extend-exclude in pyproject.toml is not applied to explicitly listed
# files, only to directory walks, so /generated/ is filtered out here to keep
# both modes consistent.
PYTHON_FILES="$(select_changed '\.py$' | { grep -vE '(^|/)generated/' || true; })"
DART_FILES="$(select_changed '^(samples/client/flutter|renderers/flutter)/.*\.dart$')"
SWIFT_FILES="$(select_changed '^(Package\.swift$|swift/.*\.swift$)')"
KOTLIN_FILES="$(select_changed '\.(kt|kts)$')"

# Maps changed Kotlin sources onto the Gradle modules that own them. ktfmt is a
# Gradle task rather than a file-level binary, so the finest granularity
# available is "run only the modules that actually changed".
kotlin_modules_for_files() {
  local file dir
  local modules=""
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    dir="$(dirname "$file")"
    while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
      if [ -f "$dir/build.gradle.kts" ] && grep -q "ktfmt" "$dir/build.gradle.kts" 2>/dev/null; then
        modules+="$dir"$'\n'
        break
      fi
      dir="$(dirname "$dir")"
    done
  done <<<"$1"
  printf '%s' "$modules" | sort -u | { grep -v '^$' || true; }
}

KOTLIN_MODULES=""
if [ -n "$KOTLIN_FILES" ]; then
  KOTLIN_MODULES="$(kotlin_modules_for_files "$KOTLIN_FILES")"
fi

if [ "$PLAN_ONLY" = true ]; then
  echo "--- formatting plan ---"
  if [ "$CHANGED_ONLY" = true ]; then
    echo "mode: changed (base: $BASE_REF)"
  else
    echo "mode: all"
  fi
  if [ "$CHANGED_ONLY" = true ]; then
    echo "prettier: $(count_lines "$PRETTIER_FILES") file(s)"
    echo "pyink: $(count_lines "$PYTHON_FILES") file(s)"
    echo "dart: $(count_lines "$DART_FILES") file(s)"
    echo "swift: $(count_lines "$SWIFT_FILES") file(s)"
    echo "ktfmt: $(count_lines "$KOTLIN_MODULES") module(s)"
  else
    echo "prettier: all"
    echo "pyink: all"
    echo "dart: all"
    echo "swift: all"
    echo "ktfmt: all"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Prettier
# ---------------------------------------------------------------------------

if should_skip "Prettier" "$PRETTIER_FILES"; then
  :
else
  echo "Running Prettier formatting for Node/Web assets..."

  prettier_targets=(.)
  prettier_extra=()
  if [ "$CHANGED_ONLY" = true ]; then
    split_into_targets "$PRETTIER_FILES"
    prettier_targets=("${SELECTED_TARGETS[@]}")
    # Explicit paths may include extensions Prettier has no parser for; skip
    # them instead of failing the run. .prettierignore still applies.
    prettier_extra=(--ignore-unknown)
  fi

  if [ -f ".yarn/install-state.gz" ]; then
    # Local Node environment already installed; invoke standard script targets
    if [ "$CHANGED_ONLY" = false ]; then
      if [ "$CHECK_ONLY" = true ]; then
        "${YARN_CMD[@]}" format:check:all
      else
        "${YARN_CMD[@]}" format:all | sed '/ (unchanged)$/d'
      fi
    else
      if [ "$CHECK_ONLY" = true ]; then
        "${YARN_CMD[@]}" prettier --config .prettierrc "${prettier_extra[@]}" --check "${prettier_targets[@]}"
      else
        "${YARN_CMD[@]}" prettier --config .prettierrc "${prettier_extra[@]}" --write "${prettier_targets[@]}" | sed '/ (unchanged)$/d'
      fi
    fi
  else
    # Non-Node contributor or CI; run standalone Prettier via dlx without full monorepo install
    if [ "$CHECK_ONLY" = true ]; then
      "${YARN_CMD[@]}" dlx prettier@3.8.4 --config .prettierrc ${prettier_extra[@]+"${prettier_extra[@]}"} --check "${prettier_targets[@]}"
    else
      "${YARN_CMD[@]}" dlx prettier@3.8.4 --config .prettierrc ${prettier_extra[@]+"${prettier_extra[@]}"} --write "${prettier_targets[@]}" | sed '/ (unchanged)$/d'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Pyink
# ---------------------------------------------------------------------------

if should_skip "Pyink" "$PYTHON_FILES"; then
  :
else
  echo "Running Pyink for Python files..."
  pyink_targets=(.)
  if [ "$CHANGED_ONLY" = true ]; then
    split_into_targets "$PYTHON_FILES"
    pyink_targets=("${SELECTED_TARGETS[@]}")
  fi
  if [ "$CHECK_ONLY" = true ]; then
    uv run pyink --check "${pyink_targets[@]}"
  else
    uv run pyink "${pyink_targets[@]}"
  fi
fi

# ---------------------------------------------------------------------------
# Dart
# ---------------------------------------------------------------------------

if should_skip "Dart format" "$DART_FILES"; then
  :
else
  echo "Running Dart format..."
  cd "$REPO_ROOT"
  # Check if dart is available before running
  if command -v dart >/dev/null 2>&1; then

    # Run "dart pub get" silently, to resolve Dart dependencies. This will resolve
    # the analysis_options.yaml includes if the person running this script hasn't
    # run dart or flutter "pub get" yet.
    #
    # Running "dart pub get" is not a NECESSARY thing for the formatting to work
    # (dart format is entirely AST-based), but if someone runs the formatting
    # script locally, then we don't want confusion about the warnings if they
    # haven't run "dart pub get" (which is equivalent to "flutter pub get" if the
    # dart executable is in a Flutter SDK directory).
    #
    # In CI, we want to be able to only install the lightweight Dart image, not
    # the much heavier Flutter image, which quadruples the time it takes to run
    # the formatting check. In that case, since the dart executable isn't part of
    # a Flutter SDK directory, "dart pub get" will give errors about the monorepo
    # depending on Flutter and not running "flutter pub get", so we want to
    # suppress that failure here so it doesn't cause the fix_format.sh script to
    # exit. The dart format run will still have warnings because pub get wasn't
    # run, but it won't affect the CI build outcome.
    if [ ! -f ".dart_tool/package_config.json" ]; then
      dart pub get >/dev/null 2>&1 || true
    fi

    dart_targets=(samples/client/flutter renderers/flutter)
    if [ "$CHANGED_ONLY" = true ]; then
      split_into_targets "$DART_FILES"
      dart_targets=("${SELECTED_TARGETS[@]}")
    fi

    if [ "$CHECK_ONLY" = true ]; then
      dart format --output=none --set-exit-if-changed "${dart_targets[@]}"
    else
      dart format "${dart_targets[@]}"
    fi
  else
    echo "Warning: dart command not found. Skipping Dart formatting."
  fi
fi

# ---------------------------------------------------------------------------
# swift-format
# ---------------------------------------------------------------------------

if should_skip "swift-format" "$SWIFT_FILES"; then
  :
else
  echo "Running swift-format..."
  if command -v swift-format >/dev/null 2>&1; then
    swift_targets=(-r Package.swift swift/)
    if [ "$CHANGED_ONLY" = true ]; then
      split_into_targets "$SWIFT_FILES"
      swift_targets=("${SELECTED_TARGETS[@]}")
    fi
    if [ "$CHECK_ONLY" = true ]; then
      echo "Linting Swift files..."
      swift-format lint "${swift_targets[@]}"
    else
      echo "Formatting Swift files..."
      swift-format format -i "${swift_targets[@]}"
    fi
  else
    echo "Warning: swift-format command not found. Skipping Swift formatting."
  fi
fi

# ---------------------------------------------------------------------------
# ktfmt
# ---------------------------------------------------------------------------

if [ "$CHANGED_ONLY" = true ] && [ -z "$KOTLIN_MODULES" ]; then
  echo "Skipping ktfmt: no matching files changed."
else
  echo "Running ktfmt for Kotlin files..."
  cd "$REPO_ROOT"
  if command -v java >/dev/null 2>&1; then
    run_ktfmt_in_dir() {
      local dir="$1"
      (
        cd "$dir"
        if [ -x "./gradlew" ]; then
          GRADLE_CMD=(./gradlew)
        elif command -v gradle >/dev/null 2>&1; then
          GRADLE_CMD=(gradle)
        else
          echo "Warning: Neither ./gradlew nor gradle command found in $dir. Skipping."
          exit 0
        fi

        if [ "$CHECK_ONLY" = true ]; then
          "${GRADLE_CMD[@]}" -q ktfmtCheck
        else
          "${GRADLE_CMD[@]}" -q ktfmtFormat
        fi
      )
    }

    if [ "$CHANGED_ONLY" = true ]; then
      while IFS= read -r module_dir; do
        [ -n "$module_dir" ] || continue
        run_ktfmt_in_dir "$module_dir"
      done <<<"$KOTLIN_MODULES"
    else
      while IFS= read -r -d '' build_file; do
        dir="$(dirname "$build_file")"
        if grep -q "ktfmt" "$build_file" 2>/dev/null; then
          run_ktfmt_in_dir "$dir"
        fi
      done < <(find "$REPO_ROOT" \( -name build -o -name .gradle -o -name node_modules -o -name .git -o -name .yarn -o -name .dart_tool \) -prune -o -name "build.gradle.kts" -print0)
    fi
  else
    echo "Warning: java command not found. Skipping Kotlin formatting."
  fi
fi

echo "Done."

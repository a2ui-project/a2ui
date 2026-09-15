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

"""Output formatting utilities with graceful rich fallback."""

from __future__ import annotations

import json
import sys
from typing import Any, List, Optional

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.text import Text

    HAS_RICH = True
    console = Console()
except ImportError:
    HAS_RICH = False
    console = None  # type: ignore


def print_json(data: Any) -> None:
    """Prints formatted JSON to stdout."""
    print(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
            default=lambda o: sorted(list(o))
            if isinstance(o, (set, frozenset))
            else str(o),
        )
    )


def print_header(title: str, subtitle: Optional[str] = None) -> None:
    """Prints a section header."""
    if HAS_RICH and console:
        text = Text(title, style="bold cyan")
        if subtitle:
            text.append(f"\n{subtitle}", style="dim")
        console.print(Panel(text, expand=False))
    else:
        print(f"\n=== {title} ===")
        if subtitle:
            print(f"    {subtitle}")


def print_success(message: str) -> None:
    """Prints a success message."""
    if HAS_RICH and console:
        console.print(f"[bold green]✓[/bold green] {message}")
    else:
        print(f"✓ {message}")


def print_error(message: str) -> None:
    """Prints an error message."""
    if HAS_RICH and console:
        console.print(f"[bold red]✗ Error:[/bold red] {message}")
    else:
        print(f"✗ Error: {message}")


def print_warning(message: str) -> None:
    """Prints a warning message."""
    if HAS_RICH and console:
        console.print(f"[bold yellow]![/bold yellow] {message}")
    else:
        print(f"! {message}")


def print_info(message: str) -> None:
    """Prints an informational line."""
    if HAS_RICH and console:
        console.print(f"[dim]•[/dim] {message}")
    else:
        print(f"• {message}")


def print_table(title: str, columns: List[str], rows: List[List[str]]) -> None:
    """Prints a formatted table."""
    if HAS_RICH and console:
        table = Table(title=title, show_header=True, header_style="bold magenta")
        for col in columns:
            table.add_column(col)
        for row in rows:
            table.add_row(*row)
        console.print(table)
    else:
        print(f"\n--- {title} ---")
        if not rows:
            print("(empty)")
            return

        # Compute column widths
        widths = [len(c) for c in columns]
        for row in rows:
            for i, cell in enumerate(row):
                if i < len(widths):
                    widths[i] = max(widths[i], len(str(cell)))

        fmt = "  ".join(f"{{:<{w}}}" for w in widths)
        print(fmt.format(*columns))
        print("  ".join("-" * w for w in widths))
        for row in rows:
            cells = [str(r) for r in row]
            # Pad row if missing columns
            while len(cells) < len(widths):
                cells.append("")
            print(fmt.format(*cells[: len(widths)]))
        print()

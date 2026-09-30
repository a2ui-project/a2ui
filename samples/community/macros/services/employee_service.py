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

"""Employee compensation database service.

Provides structured mock data access with support for both synchronous macro
evaluation and asynchronous simulated I/O lookups.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional


EMPLOYEE_COMPENSATION_DB: dict[str, dict[str, Any]] = {
    "emp_101": {
        "employeeName": "Dr. Elena Vance",
        "role": "Principal Systems Architect",
        "baseSalary": "$215,000",
        "annualBonus": "$45,000",
        "equity": "3,500 RSUs",
        "clearanceLevel": "Level 5 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_102": {
        "employeeName": "Marcus Vance",
        "role": "Streaming & Protocols Lead",
        "baseSalary": "$195,000",
        "annualBonus": "$38,000",
        "equity": "2,800 RSUs",
        "clearanceLevel": "Level 4 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_103": {
        "employeeName": "Aria Chen",
        "role": "Head of Design Systems",
        "baseSalary": "$205,000",
        "annualBonus": "$42,000",
        "equity": "3,100 RSUs",
        "clearanceLevel": "Level 5 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_104": {
        "employeeName": "Liam Kjell",
        "role": "Senior Framework Engineer",
        "baseSalary": "$180,000",
        "annualBonus": "$32,000",
        "equity": "2,200 RSUs",
        "clearanceLevel": "Level 3 - Internal",
        "verifiedAt": "2026-08-13",
    },
}


class EmployeeDatabaseService:
    """Service encapsulating mock HR employee compensation lookups.

    Supports synchronous lookups for immediate macro expansion and asynchronous
    lookups for simulated database or microservice queries.
    """

    def __init__(self, records: Optional[dict[str, dict[str, Any]]] = None) -> None:
        self._records = records if records is not None else EMPLOYEE_COMPENSATION_DB

    def get_employee(self, employee_id: str) -> dict[str, Any]:
        """Synchronously fetch verified employee compensation package."""
        if employee_id not in self._records:
            raise ValueError(
                f"Employee ID '{employee_id}' not found in HR compensation records. "
                f"Available: {list(self._records.keys())}"
            )
        return self._records[employee_id]

    async def get_employee_async(
        self, employee_id: str, delay_seconds: float = 0.02
    ) -> dict[str, Any]:
        """Asynchronously fetch verified employee compensation package with simulated I/O latency."""
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
        return self.get_employee(employee_id)

    def get_all(self) -> dict[str, dict[str, Any]]:
        """Return all employee compensation records."""
        return self._records

    async def get_all_async(
        self, delay_seconds: float = 0.02
    ) -> dict[str, dict[str, Any]]:
        """Asynchronously return all employee compensation records with simulated I/O latency."""
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
        return self.get_all()


employee_service = EmployeeDatabaseService()


def fetch_employee_compensation(employee_id: str) -> dict[str, Any]:
    """Convenience helper delegating to the employee database service."""
    return employee_service.get_employee(employee_id)

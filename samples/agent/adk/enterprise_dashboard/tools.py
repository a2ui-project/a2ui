# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Mock analytics tools for the enterprise dashboard sample."""

import json


def get_kpi_summary(period: str = "weekly") -> str:
  """Returns key performance indicators for the requested time period.

  Args:
    period: Time period for the KPIs. One of 'daily', 'weekly', 'monthly'.

  Returns:
    JSON string with KPI metrics including revenue, transactions,
    average order value, and customer satisfaction.
  """
  data = {
      "period": period,
      "metrics": [
          {
              "name": "Revenue",
              "value": "$284,500",
              "change": "+8.3%",
              "trend": "up",
          },
          {
              "name": "Transactions",
              "value": "12,450",
              "change": "+5.1%",
              "trend": "up",
          },
          {
              "name": "Avg Order Value",
              "value": "$22.85",
              "change": "-1.2%",
              "trend": "down",
          },
          {
              "name": "Customer Satisfaction",
              "value": "4.6/5",
              "change": "+0.2",
              "trend": "up",
          },
      ],
  }
  return json.dumps(data)


def get_store_comparison() -> str:
  """Returns performance comparison data across all store locations.

  Returns:
    JSON string with per-store revenue, transactions, average basket
    size, and growth metrics.
  """
  data = {
      "stores": [
          {
              "name": "Downtown Market",
              "revenue": "$112,400",
              "transactions": "5,100",
              "avg_basket": "$22.04",
              "growth": "+12.3%",
          },
          {
              "name": "Westside Market",
              "revenue": "$95,200",
              "transactions": "4,200",
              "avg_basket": "$22.67",
              "growth": "+6.1%",
          },
          {
              "name": "Lakefront Market",
              "revenue": "$76,900",
              "transactions": "3,150",
              "avg_basket": "$24.41",
              "growth": "+3.8%",
          },
      ],
  }
  return json.dumps(data)


def get_product_rankings(limit: int = 5) -> str:
  """Returns top-performing products ranked by weekly unit sales.

  Args:
    limit: Maximum number of products to return.

  Returns:
    JSON string with ranked products including name, category,
    unit sales, revenue, and week-over-week growth.
  """
  products = [
      {
          "rank": 1,
          "name": "Organic Apples",
          "category": "Produce",
          "units_sold": "1,240",
          "revenue": "$3,720",
          "growth": "+12.4%",
      },
      {
          "rank": 2,
          "name": "Whole Milk 1gal",
          "category": "Dairy",
          "units_sold": "1,180",
          "revenue": "$5,310",
          "growth": "+3.2%",
      },
      {
          "rank": 3,
          "name": "Sourdough Bread",
          "category": "Bakery",
          "units_sold": "980",
          "revenue": "$4,900",
          "growth": "+8.7%",
      },
      {
          "rank": 4,
          "name": "Free Range Eggs",
          "category": "Dairy",
          "units_sold": "920",
          "revenue": "$5,520",
          "growth": "+1.5%",
      },
      {
          "rank": 5,
          "name": "Avocados",
          "category": "Produce",
          "units_sold": "870",
          "revenue": "$2,610",
          "growth": "-2.1%",
      },
      {
          "rank": 6,
          "name": "Greek Yogurt",
          "category": "Dairy",
          "units_sold": "810",
          "revenue": "$4,050",
          "growth": "+5.6%",
      },
      {
          "rank": 7,
          "name": "Chicken Breast",
          "category": "Meat",
          "units_sold": "750",
          "revenue": "$6,750",
          "growth": "+2.8%",
      },
  ]
  return json.dumps({"products": products[:limit]})

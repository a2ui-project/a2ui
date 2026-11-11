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

/** The use cases offered as suggested starter prompts. */

export interface UseCase {
  readonly id: 'retire' | 'website' | 'companies' | 'sales' | 'loan' | 'trip';
  readonly title: string;
  readonly blurb: string;
  readonly prompt: string;
}

export const USE_CASES: readonly UseCase[] = [
  {
    id: 'retire',
    title: 'Retirement planner',
    blurb: '50-year accumulation & drawdown; color-coded phases and interactive sliders.',
    prompt:
      'Plan my retirement over 50 years. I work for 20 years, then spend for 30, at a lower rate. Ensure I can adjust all variables. Color code the two parts of this',
  },
  {
    id: 'website',
    title: 'Website styling',
    blurb: 'A2UI style dropdowns with an embedded interactive color picker iframe.',
    prompt: 'Help me style a website',
  },
  {
    id: 'companies',
    title: 'Sortable sales explorer',
    blurb: 'Sortable table querying agent data functions with Explore buttons to drill down.',
    prompt:
      'Show me a table of companies sortable by total spend with an explore button for each company',
  },
];

export const LOAN_USE_CASE: UseCase = {
  id: 'loan',
  title: 'Loan explorer',
  blurb: 'Sliders drive a balance chart; click a year to see what is left.',
  prompt:
    "I borrowed $250,000. Show me how the balance goes down over 10 years, and let me play with the interest rate and how much I pay per year. When I click a year, tell me what's left. Add a button to email me the plan.",
};

export const TRIP_USE_CASE: UseCase = {
  id: 'trip',
  title: 'Itinerary planner',
  blurb: 'Drag stops into order; the agent estimates the travel time.',
  prompt:
    "I'm visiting the Louvre, Montmartre, the Eiffel Tower and Notre-Dame tomorrow. Let me drag them into the order I want and tell me how long the travel takes. Then let me book that order.",
};

export const SALES_USE_CASE: UseCase = {
  id: 'sales',
  title: 'Sales explorer',
  blurb: 'Brush a month range to see every order in that window.',
  prompt:
    'Plot our 2025 sales by month and amount for each region. Let me drag over the chart to pick a region and a few months, and list the matching orders below.',
};

/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Curated v0.8 scenarios — verified working, distinct, showcase-worthy
import restaurantBooking from './restaurant-booking.json';
import restaurantConfirmation from './restaurant-confirmation.json';
import restaurantFinder from './restaurant-finder.json';
import floorPlan from './floor-plan.json';

export const scenarios = {
  'restaurant-finder': restaurantFinder,
  'restaurant-booking': restaurantBooking,
  'restaurant-confirmation': restaurantConfirmation,
  'floor-plan': floorPlan,
};

export type ScenarioId = keyof typeof scenarios;

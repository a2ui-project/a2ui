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

import flightStatus from '../../../../../specification/v0_9/catalogs/basic/examples/01_flight-status.json';
import restaurantCard from '../../../../../specification/v0_9/catalogs/basic/examples/20_restaurant-card.json';
import contactCard from '../../../../../specification/v0_9/catalogs/basic/examples/25_contact-card.json';
import liveInvitationBuilder from '../../../../../specification/v0_9/catalogs/basic/examples/30_live-invitation-builder.json';
import incrementalDashboard from '../../../../../specification/v0_9/catalogs/basic/examples/31_incremental-dashboard.json';

export const scenarios = {
  'incremental-dashboard': incrementalDashboard.messages,
  'live-invitation-builder': liveInvitationBuilder.messages,
  'flight-status': flightStatus.messages,
  'restaurant-card': restaurantCard.messages,
  'contact-card': contactCard.messages,
};

export type ScenarioId = keyof typeof scenarios;

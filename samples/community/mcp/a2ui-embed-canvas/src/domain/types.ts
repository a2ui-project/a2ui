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

/**
 * Shared spatial and seating domain models used by both the server-side
 * scenario composer and the browser-side custom catalog components/functions.
 *
 * Note: Never name any data-model key `"path"` or start keys with `"@"`.
 */

export const SCENARIO_IDS = ['bedroom_office', 'dinner_seating', 'patio_garden'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export type WallSide = 'top' | 'bottom' | 'left' | 'right';

export type PieceAccent = 'indigo' | 'teal' | 'amber' | 'sage' | 'slate' | 'rose';

export type PieceKind =
  | 'bed'
  | 'desk'
  | 'storage'
  | 'chair'
  | 'crib'
  | 'plant'
  | 'table'
  | 'firepit'
  | 'lounger';

export interface DoorSpec {
  readonly wall: WallSide;
  readonly offsetIn: number;
  readonly widthIn: number;
  readonly swingIn: number;
  readonly hinge: 'start' | 'end';
  readonly label: string;
}

export interface WindowZoneSpec {
  readonly wall: WallSide;
  readonly offsetIn: number;
  readonly widthIn: number;
  readonly reachIn: number;
  readonly label: string;
}

export interface PointFeatureSpec {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly label: string;
  readonly kind: 'outlet' | 'shade' | 'grill';
}

export interface FloorplanScene {
  readonly mode: 'floorplan';
  readonly scenarioId: 'bedroom_office' | 'patio_garden';
  readonly title: string;
  readonly subtitle: string;
  readonly roomW: number;
  readonly roomH: number;
  readonly snapIn: number;
  readonly door: DoorSpec;
  readonly windowZone: WindowZoneSpec;
  readonly features?: readonly PointFeatureSpec[];
}

export interface FloorplanPlacement {
  readonly id: string;
  readonly pieceId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly kind: PieceKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot: number;
  readonly clearanceIn: number;
  readonly accent: PieceAccent;
  readonly slotGroup?: string;
  readonly optional?: boolean;
  readonly note: string;
}

export interface TableSpec {
  readonly id: string;
  readonly label: string;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly seatCount: number;
  readonly zone: 'quiet' | 'lively';
}

export interface LandmarkSpec {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly kind: 'kitchen' | 'music' | 'terrace';
}

export interface SeatingScene {
  readonly mode: 'seating';
  readonly scenarioId: 'dinner_seating';
  readonly title: string;
  readonly subtitle: string;
  readonly stageW: number;
  readonly stageH: number;
  readonly tables: readonly TableSpec[];
  readonly landmarks: readonly LandmarkSpec[];
}

export type GuestGroup = 'hosts' | 'family' | 'friends' | 'kids';
export type DietaryTag = 'vegan' | 'gf' | 'kid' | 'none';

export interface SeatPlacement {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly initials: string;
  readonly group: GuestGroup;
  readonly diet: DietaryTag;
  readonly tableId: string;
  readonly seatIdx: number;
  readonly note: string;
}

export type PlanScene = FloorplanScene | SeatingScene;
export type PlacementItem = FloorplanPlacement | SeatPlacement;

export type FloorplanRule =
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'door_clear';
      readonly bufferIn: number;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'walkway_clear';
      readonly minGapIn: number;
      readonly pair?: readonly [string, string];
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'window_light';
      readonly targetKind: PieceKind;
      readonly maxDistIn: number;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'side_access';
      readonly targetId: string;
      readonly minSideIn: number;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'clearance_halo';
      readonly targetKind: PieceKind;
      readonly minClearIn: number;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'feature_zone';
      readonly targetKind: PieceKind;
      readonly featureKind: 'outlet' | 'shade' | 'grill';
      readonly maxDistIn: number;
    };

export type SeatingRule =
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'apart_table';
      readonly guestA: string;
      readonly guestB: string;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'adjacent_pairs';
      readonly pairs: ReadonlyArray<readonly [string, string]>;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'dietary_cluster';
      readonly diet: DietaryTag;
      readonly minTogether: number;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'quiet_table';
      readonly guestId: string;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'host_balance';
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'affinity_pair';
      readonly guestA: string;
      readonly guestB: string;
    };

export type PlanRule = FloorplanRule | SeatingRule;

export interface TrayPiece {
  readonly pieceId: string;
  readonly placementId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly badge: string;
  readonly recommended?: boolean;
  readonly kind: PieceKind;
  readonly w: number;
  readonly h: number;
  readonly defaultX: number;
  readonly defaultY: number;
  readonly defaultRot: number;
  readonly clearanceIn: number;
  readonly accent: PieceAccent;
  readonly slotGroup?: string;
  readonly optional?: boolean;
  readonly note: string;
}

export interface PlanPreset {
  readonly id: string;
  readonly label: string;
  readonly tagline: string;
  readonly recommended?: boolean;
  readonly placements: readonly PlacementItem[];
}

export type RuleStatus = 'pass' | 'warn' | 'fail';

export interface RuleResult {
  readonly id: string;
  readonly label: string;
  readonly status: RuleStatus;
  readonly detail: string;
  readonly focusId?: string;
}

export interface SocialArc {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: 'conflict' | 'affinity';
  readonly satisfied: boolean;
  readonly label: string;
}

export interface PlanEvaluation {
  readonly score: number;
  readonly passCount: number;
  readonly totalCount: number;
  readonly status: RuleStatus;
  readonly summary: string;
  readonly results: readonly RuleResult[];
  readonly violatingIds: readonly string[];
  readonly arcs: readonly SocialArc[];
}

export interface InspectedItem {
  readonly found: boolean;
  readonly mode: 'floorplan' | 'seating';
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly badge: string;
  readonly metrics: ReadonlyArray<{readonly label: string; readonly value: string}>;
  readonly note: string;
  readonly optional?: boolean;
}

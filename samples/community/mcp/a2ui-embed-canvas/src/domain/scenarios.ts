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
 * Rich spatial floorplan and banquet seating scenarios, candidate piece trays,
 * 1-click layout presets, prompt-to-scenario classification, and conflict
 * auto-resolution.
 */

import {clampFloorplanPlacement, evaluatePlanData} from './geometry.js';
import type {
  FloorplanPlacement,
  FloorplanRule,
  FloorplanScene,
  PlacementItem,
  PlanPreset,
  PlanRule,
  PlanScene,
  ScenarioId,
  SeatPlacement,
  SeatingRule,
  SeatingScene,
  TrayPiece,
} from './types.js';

export interface ScenarioBundle {
  readonly scenarioId: ScenarioId;
  readonly scene: PlanScene;
  readonly initialPlacements: readonly PlacementItem[];
  readonly initialSelectedId: string;
  readonly initialPresetId: string;
  readonly rules: readonly PlanRule[];
  readonly presets: readonly PlanPreset[];
  readonly pieces: readonly TrayPiece[];
  readonly followUpLabel: string;
}

/** Classifies a natural-language prompt into one of the 3 planning scenarios. */
export function resolveScenarioId(prompt: string, explicit?: ScenarioId): ScenarioId {
  if (explicit) return explicit;
  const lower = prompt.toLowerCase();
  if (
    /\b(seat|seating|guest|guests|dinner|banquet|wedding|table|tables|vegan|dietary|host)\b/.test(
      lower,
    )
  ) {
    return 'dinner_seating';
  }
  if (
    /\b(patio|garden|courtyard|outdoor|deck|pergola|fire\s*pit|bistro|terrace|backyard)\b/.test(
      lower,
    )
  ) {
    return 'patio_garden';
  }
  return 'bedroom_office';
}

// ---------------------------------------------------------------------------
// Scenario 1: Bedroom + Home Office (12' x 10' = 144" x 120" floorplan)
// ---------------------------------------------------------------------------

function bedroomOfficeBundle(): ScenarioBundle {
  const bedroomScene: FloorplanScene = {
    mode: 'floorplan',
    scenarioId: 'bedroom_office',
    title: 'Bedroom + Standing Desk Fit',
    subtitle:
      '14\' 0" × 10\' 0" room · Drag the standing desk out of the door swing into the daylight cone',
    roomW: 168,
    roomH: 120,
    snapIn: 2,
    door: {
      wall: 'bottom',
      offsetIn: 12,
      widthIn: 32,
      swingIn: 32,
      hinge: 'start',
      label: '32" entry door',
    },
    windowZone: {
      wall: 'left',
      offsetIn: 12,
      widthIn: 54,
      reachIn: 46,
      label: '54" daylight window',
    },
    features: [{x: 4, y: 38, r: 8, label: 'Quad outlet', kind: 'outlet'}],
  };

  const basePieces: FloorplanPlacement[] = [
    {
      id: 'bed_queen',
      pieceId: 'queen_bed',
      label: 'Queen Bed (60×80 in)',
      shortLabel: 'Queen Bed',
      kind: 'bed',
      x: 84,
      y: 6,
      w: 60,
      h: 80,
      rot: 0,
      clearanceIn: 22,
      accent: 'indigo',
      note: 'Centered on north wall with 24 in right-side access and 34 in foot walkway.',
    },
    {
      id: 'nightstand_main',
      pieceId: 'nightstand_18',
      label: 'Oak Nightstand (18×18 in)',
      shortLabel: 'Nightstand',
      kind: 'storage',
      x: 146,
      y: 6,
      w: 18,
      h: 18,
      rot: 0,
      clearanceIn: 12,
      accent: 'amber',
      note: 'Tucked beside headboard without blocking bed side entry.',
    },
    {
      id: 'wardrobe_tall',
      pieceId: 'wardrobe_36',
      label: 'Sliding Wardrobe (36×20 in)',
      shortLabel: 'Wardrobe',
      kind: 'storage',
      x: 116,
      y: 96,
      w: 36,
      h: 20,
      rot: 0,
      clearanceIn: 18,
      accent: 'slate',
      note: 'Sliding doors require zero swing arc along the south wall.',
    },
  ];

  const initialPlacements: FloorplanPlacement[] = [
    ...basePieces,
    {
      id: 'desk_active',
      pieceId: 'desk_60',
      label: '60 in Standing Desk',
      shortLabel: '60" Desk',
      kind: 'desk',
      x: 14,
      y: 58,
      w: 60,
      h: 26,
      rot: 90,
      clearanceIn: 24,
      accent: 'teal',
      slotGroup: 'desk',
      note: 'Currently clips the 32 in entry door swing; drag north into the window cone.',
    },
  ];

  const daylightPresetPlacements: FloorplanPlacement[] = [
    ...basePieces,
    {
      id: 'desk_active',
      pieceId: 'desk_60',
      label: '60 in Standing Desk',
      shortLabel: '60" Desk',
      kind: 'desk',
      x: 4,
      y: 10,
      w: 60,
      h: 26,
      rot: 90,
      clearanceIn: 24,
      accent: 'teal',
      slotGroup: 'desk',
      note: 'Aligned to the 54 in window for glare-free side light and direct quad-outlet reach.',
    },
  ];

  const cornerLDeskPlacements: FloorplanPlacement[] = [
    ...basePieces,
    {
      id: 'desk_active',
      pieceId: 'desk_72_l',
      label: '72 in L-Desk (tight)',
      shortLabel: '72" L-Desk',
      kind: 'desk',
      x: 4,
      y: 8,
      w: 72,
      h: 30,
      rot: 90,
      clearanceIn: 24,
      accent: 'teal',
      slotGroup: 'desk',
      note: 'Maximizes dual-monitor surface while staying 8 in clear of the entry door arc.',
    },
  ];

  const nurseryComboPlacements: FloorplanPlacement[] = [
    ...daylightPresetPlacements,
    {
      id: 'crib_mini',
      pieceId: 'crib_52',
      label: 'Mini Crib (28×52 in)',
      shortLabel: 'Mini Crib',
      kind: 'crib',
      x: 46,
      y: 8,
      w: 28,
      h: 52,
      rot: 0,
      clearanceIn: 18,
      accent: 'rose',
      optional: true,
      note: 'Fits between desk zone and queen bed while preserving a 30+ in walkway.',
    },
    {
      id: 'plant_fiddle',
      pieceId: 'plant_16',
      label: 'Fiddle Fig Plant (16 in)',
      shortLabel: 'Plant',
      kind: 'plant',
      x: 4,
      y: 72,
      w: 16,
      h: 16,
      rot: 0,
      clearanceIn: 6,
      accent: 'sage',
      optional: true,
      note: 'Bright indirect corner south of the window, clear of door hinge.',
    },
  ];

  const rules: FloorplanRule[] = [
    {id: 'r_door', label: 'Door swing clear', kind: 'door_clear', bufferIn: 6},
    {
      id: 'r_walkway',
      label: '30 in walkway',
      kind: 'walkway_clear',
      minGapIn: 30,
      pair: ['bed_queen', 'desk_active'],
    },
    {
      id: 'r_window',
      label: 'Window desk light',
      kind: 'window_light',
      targetKind: 'desk',
      maxDistIn: 16,
    },
    {
      id: 'r_bed_sides',
      label: 'Bed side access',
      kind: 'side_access',
      targetId: 'bed_queen',
      minSideIn: 22,
    },
    {
      id: 'r_outlet',
      label: 'Outlet reach',
      kind: 'feature_zone',
      targetKind: 'desk',
      featureKind: 'outlet',
      maxDistIn: 24,
    },
  ];

  const pieces: TrayPiece[] = [
    {
      pieceId: 'desk_60',
      placementId: 'desk_active',
      label: '60 in desk (fits)',
      shortLabel: '60" Desk',
      badge: 'fits',
      recommended: true,
      kind: 'desk',
      w: 60,
      h: 26,
      defaultX: 4,
      defaultY: 10,
      defaultRot: 90,
      clearanceIn: 24,
      accent: 'teal',
      slotGroup: 'desk',
      note: '60×26 in standing desk leaves 54 in aisle to bed and full door clearance.',
    },
    {
      pieceId: 'desk_72_l',
      placementId: 'desk_active',
      label: '72 in L-desk (tight)',
      shortLabel: '72" L-Desk',
      badge: 'tight',
      kind: 'desk',
      w: 72,
      h: 30,
      defaultX: 4,
      defaultY: 8,
      defaultRot: 90,
      clearanceIn: 24,
      accent: 'teal',
      slotGroup: 'desk',
      note: '72×30 in L-return desk; fits north-west wall if kept above y=8 in.',
    },
    {
      pieceId: 'crib_52',
      placementId: 'crib_mini',
      label: 'Crib (28×52)',
      shortLabel: 'Mini Crib',
      badge: 'toggle',
      kind: 'crib',
      w: 28,
      h: 52,
      defaultX: 46,
      defaultY: 8,
      defaultRot: 0,
      clearanceIn: 18,
      accent: 'rose',
      optional: true,
      note: 'Optional nursery crib; tuck along top wall x=46 in to keep door clear.',
    },
    {
      pieceId: 'plant_16',
      placementId: 'plant_fiddle',
      label: 'Plant (16 in)',
      shortLabel: 'Plant',
      badge: 'toggle',
      kind: 'plant',
      w: 16,
      h: 16,
      defaultX: 4,
      defaultY: 72,
      defaultRot: 0,
      clearanceIn: 6,
      accent: 'sage',
      optional: true,
      note: '16 in planter pot for indirect window light.',
    },
  ];

  const presets: PlanPreset[] = [
    {
      id: 'preset_daylight',
      label: 'Daylight Studio',
      tagline: '60 in desk on window · 54 in aisle',
      recommended: true,
      placements: daylightPresetPlacements,
    },
    {
      id: 'preset_l_desk',
      label: '72 in L-Desk Fit',
      tagline: 'Deep studio desk · 50 in aisle',
      placements: cornerLDeskPlacements,
    },
    {
      id: 'preset_nursery',
      label: 'Desk + Crib + Plant',
      tagline: 'Full nursery & office combo',
      placements: nurseryComboPlacements,
    },
  ];

  return {
    scenarioId: 'bedroom_office',
    scene: bedroomScene,
    initialPlacements,
    initialSelectedId: 'desk_active',
    initialPresetId: '',
    rules,
    presets,
    pieces,
    followUpLabel: 'Ask ergonomics & lighting',
  };
}

// ---------------------------------------------------------------------------
// Scenario 2: 16-Guest Dinner Seating (2 round 8-seat banquet tables)
// ---------------------------------------------------------------------------

function dinnerSeatingBundle(): ScenarioBundle {
  const scene: SeatingScene = {
    mode: 'seating',
    scenarioId: 'dinner_seating',
    title: '16-Guest Harvest Dinner Seating',
    subtitle:
      'Click two seats or drag a guest token to swap · Separate Maya & Dan while keeping kids with parents',
    stageW: 660,
    stageH: 242,
    tables: [
      {
        id: 'table_a',
        label: 'Table A · Conservatory (Quiet)',
        cx: 182,
        cy: 118,
        radius: 52,
        seatCount: 8,
        zone: 'quiet',
      },
      {
        id: 'table_b',
        label: 'Table B · Sonos Terrace (Lively)',
        cx: 478,
        cy: 118,
        radius: 52,
        seatCount: 8,
        zone: 'lively',
      },
    ],
    landmarks: [
      {label: 'Kitchen pass', x: 56, y: 22, kind: 'kitchen'},
      {label: 'Garden terrace', x: 330, y: 22, kind: 'terrace'},
      {label: 'Sonos speaker', x: 604, y: 22, kind: 'music'},
    ],
  };

  // 16 guests:
  // Table A (Conservatory - quiet):
  //   0: Host Sam (hosts, none)
  //   1: Kid Leo (kids, kid) -> adjacent to Sam (0)!
  //   2: Grandpa Arthur (family, gf) -> quiet table!
  //   3: Grandma Rose (family, none)
  //   4: Maya Lin (friends, vegan)
  //   5: Dan Mercer (friends, none) -> CONFLICT in initial draft! Adjacent to Maya at Table A!
  //   6: Nina Patel (friends, vegan)
  //   7: Omar Hassan (friends, vegan) -> 3 vegans (Maya, Nina, Omar) together at Table A!
  // Table B (Terrace - lively):
  //   0: Host Priya (hosts, none)
  //   1: Kid Zoe (kids, kid) -> adjacent to Priya (0)!
  //   2: Elena Soto (friends, gf)
  //   3: Carlos Soto (friends, none) -> affinity couple together!
  //   4: Tariq Al-Mansoor (friends, none) -> swapping Dan (#5 Table A) with Hana (#7 Table B, vegan!) or Tariq (#4 Table B):
  //      Wait! Look what happens if Dan (#5 Table A) swaps with Tariq (#4 Table B):
  //      - Maya (#4 Table A) and Dan (#4 Table B) are now at SEPARATE TABLES -> `Maya away from Dan` = PASS!
  //      - Kids Leo (#1 Table A, next to Sam #0) & Zoe (#1 Table B, next to Priya #0) stay adjacent -> `Kids near parents` = PASS!
  //      - Vegans Maya, Nina, Omar stay together at Table A (3/3) -> `Vegan grouping` = PASS!
  //      - Grandpa Arthur stays at Table A (`quiet`) -> `Grandpa quiet table` = PASS!
  //      - Sam (Table A) & Priya (Table B) -> `Host at each table` = PASS!
  //      - Elena & Carlos stay together at Table B -> `Elena with Carlos` = PASS!
  //      Every swap of Dan to Table B (seats 4, 5, 6, 7) immediately turns the whole board 100% GREEN!

  const initialGuests: SeatPlacement[] = [
    {
      id: 'g_sam',
      name: 'Sam Rivera (Host)',
      shortName: 'Sam',
      initials: 'SR',
      group: 'hosts',
      diet: 'none',
      tableId: 'table_a',
      seatIdx: 0,
      note: 'Co-host anchoring Conservatory Table A; seated next to son Leo.',
    },
    {
      id: 'g_leo',
      name: 'Leo Rivera (Age 6)',
      shortName: 'Leo',
      initials: 'LR',
      group: 'kids',
      diet: 'kid',
      tableId: 'table_a',
      seatIdx: 1,
      note: 'Keep adjacent to parent Sam for kid courses.',
    },
    {
      id: 'g_arthur',
      name: 'Grandpa Arthur',
      shortName: 'Arthur',
      initials: 'GA',
      group: 'family',
      diet: 'gf',
      tableId: 'table_a',
      seatIdx: 2,
      note: 'Hearing aid sensitive to music; needs quiet Conservatory table.',
    },
    {
      id: 'g_rose',
      name: 'Grandma Rose',
      shortName: 'Rose',
      initials: 'GR',
      group: 'family',
      diet: 'none',
      tableId: 'table_a',
      seatIdx: 3,
      note: 'Seated beside Arthur in the quiet zone.',
    },
    {
      id: 'g_maya',
      name: 'Maya Lin',
      shortName: 'Maya',
      initials: 'ML',
      group: 'friends',
      diet: 'vegan',
      tableId: 'table_a',
      seatIdx: 4,
      note: 'Co-founder dispute with Dan — seat at separate tables. Shares vegan platter.',
    },
    {
      id: 'g_dan',
      name: 'Dan Mercer',
      shortName: 'Dan',
      initials: 'DM',
      group: 'friends',
      diet: 'none',
      tableId: 'table_a',
      seatIdx: 5,
      note: 'Currently seated next to Maya! Swap Dan with Tariq or Ben at Table B.',
    },
    {
      id: 'g_nina',
      name: 'Nina Patel',
      shortName: 'Nina',
      initials: 'NP',
      group: 'friends',
      diet: 'vegan',
      tableId: 'table_a',
      seatIdx: 6,
      note: 'Vegan family-style platter group with Maya and Omar.',
    },
    {
      id: 'g_omar',
      name: 'Omar Hassan',
      shortName: 'Omar',
      initials: 'OH',
      group: 'friends',
      diet: 'vegan',
      tableId: 'table_a',
      seatIdx: 7,
      note: 'Vegan platter group at Table A.',
    },
    {
      id: 'g_priya',
      name: 'Priya Shah (Host)',
      shortName: 'Priya',
      initials: 'PS',
      group: 'hosts',
      diet: 'none',
      tableId: 'table_b',
      seatIdx: 0,
      note: 'Co-host anchoring Terrace Table B; seated next to daughter Zoe.',
    },
    {
      id: 'g_zoe',
      name: 'Zoe Shah (Age 7)',
      shortName: 'Zoe',
      initials: 'ZS',
      group: 'kids',
      diet: 'kid',
      tableId: 'table_b',
      seatIdx: 1,
      note: 'Keep adjacent to parent Priya.',
    },
    {
      id: 'g_elena',
      name: 'Elena Soto',
      shortName: 'Elena',
      initials: 'ES',
      group: 'friends',
      diet: 'gf',
      tableId: 'table_b',
      seatIdx: 2,
      note: 'Celebrating anniversary with partner Carlos.',
    },
    {
      id: 'g_carlos',
      name: 'Carlos Soto',
      shortName: 'Carlos',
      initials: 'CS',
      group: 'friends',
      diet: 'none',
      tableId: 'table_b',
      seatIdx: 3,
      note: 'Seated beside Elena at the lively Terrace table.',
    },
    {
      id: 'g_tariq',
      name: 'Tariq Al-Mansoor',
      shortName: 'Tariq',
      initials: 'TA',
      group: 'friends',
      diet: 'none',
      tableId: 'table_b',
      seatIdx: 4,
      note: 'Easygoing conversationalist — great swap candidate for Table A.',
    },
    {
      id: 'g_chloe',
      name: 'Chloe Park',
      shortName: 'Chloe',
      initials: 'CP',
      group: 'friends',
      diet: 'none',
      tableId: 'table_b',
      seatIdx: 5,
      note: 'College friend of Priya and Dan.',
    },
    {
      id: 'g_ben',
      name: 'Ben Gallagher',
      shortName: 'Ben',
      initials: 'BG',
      group: 'family',
      diet: 'none',
      tableId: 'table_b',
      seatIdx: 6,
      note: 'Cousin who loves music and lively conversation.',
    },
    {
      id: 'g_hana',
      name: 'Hana Kim',
      shortName: 'Hana',
      initials: 'HK',
      group: 'friends',
      diet: 'gf',
      tableId: 'table_b',
      seatIdx: 7,
      note: 'Gluten-free menu; enjoys Terrace table.',
    },
  ];

  const harmoniousGuests: SeatPlacement[] = swapGuestSeats(initialGuests, 'g_dan', 'g_tariq');

  const veganTableBGuests: SeatPlacement[] = initialGuests.map(g => {
    if (g.id === 'g_maya') return {...g, tableId: 'table_b', seatIdx: 4};
    if (g.id === 'g_nina') return {...g, tableId: 'table_b', seatIdx: 5};
    if (g.id === 'g_omar') return {...g, tableId: 'table_b', seatIdx: 6};
    if (g.id === 'g_tariq') return {...g, tableId: 'table_a', seatIdx: 4};
    if (g.id === 'g_chloe') return {...g, tableId: 'table_a', seatIdx: 6};
    if (g.id === 'g_ben') return {...g, tableId: 'table_a', seatIdx: 7};
    return g;
  });

  const rules: SeatingRule[] = [
    {
      id: 's_maya_dan',
      label: 'Maya away from Dan',
      kind: 'apart_table',
      guestA: 'g_maya',
      guestB: 'g_dan',
    },
    {
      id: 's_kids',
      label: 'Kids near parents',
      kind: 'adjacent_pairs',
      pairs: [
        ['g_leo', 'g_sam'],
        ['g_zoe', 'g_priya'],
      ],
    },
    {
      id: 's_vegan',
      label: 'Vegan grouping',
      kind: 'dietary_cluster',
      diet: 'vegan',
      minTogether: 3,
    },
    {id: 's_quiet', label: 'Grandpa quiet seat', kind: 'quiet_table', guestId: 'g_arthur'},
    {id: 's_hosts', label: 'Host at each table', kind: 'host_balance'},
  ];

  const presets: PlanPreset[] = [
    {
      id: 'preset_harmonious',
      label: 'Harmonious Banquet',
      tagline: 'Dan at Table B · Vegans & family intact',
      recommended: true,
      placements: harmoniousGuests,
    },
    {
      id: 'preset_vegans_b',
      label: 'Vegans on Terrace',
      tagline: 'Vegan trio at Table B · Dan at Table A',
      placements: veganTableBGuests,
    },
    {
      id: 'preset_draft_conflict',
      label: 'Original RSVP Order',
      tagline: 'Shows Maya × Dan seat conflict',
      placements: initialGuests,
    },
  ];

  return {
    scenarioId: 'dinner_seating',
    scene,
    initialPlacements: initialGuests,
    initialSelectedId: 'g_dan',
    initialPresetId: '',
    rules,
    presets,
    pieces: [],
    followUpLabel: 'Ask host & menu tips',
  };
}

// ---------------------------------------------------------------------------
// Scenario 3: Courtyard Patio & Garden (15' x 11' = 180" x 132" floorplan)
// ---------------------------------------------------------------------------

function patioGardenBundle(): ScenarioBundle {
  const scene: FloorplanScene = {
    mode: 'floorplan',
    scenarioId: 'patio_garden',
    title: 'Courtyard Patio & Fire Pit',
    subtitle:
      '15\' 0" × 11\' 0" terrace · Keep 36 in fire-pit halo clear and French doors unobstructed',
    roomW: 180,
    roomH: 132,
    snapIn: 2,
    door: {
      wall: 'left',
      offsetIn: 16,
      widthIn: 36,
      swingIn: 34,
      hinge: 'start',
      label: '36" French door',
    },
    windowZone: {
      wall: 'bottom',
      offsetIn: 52,
      widthIn: 84,
      reachIn: 48,
      label: 'South sun exposure',
    },
    features: [{x: 132, y: 34, r: 28, label: 'Pergola shade', kind: 'shade'}],
  };

  // Clean resolved positions:
  // - Teak Bistro / Dining Table (54x36) under top-right Pergola shade at x=108, y=14 (x=[108..162], y=[14..50]):
  //   dist to Pergola (132, 34) = 0" (<= 18" -> PASS)!
  // - Cedar Herb Planter (42x16) along sunny south edge at x=68, y=110 (x=[68..110], y=[110..126]):
  //   dist to South sun windowZone (y=132, x=[52..136]) = 6" (<= 18" -> PASS)!
  // - Solo Fire Pit (30x30):
  //   Clean spot: x=44, y=54 (x=[44..74], y=[54..84]):
  //     Wall gaps: left=44", top=54", right=180-74=106", bottom=132-84=48" -> all >= 36"!
  //     Gap to Dining Table (x=[108..162], y=[14..50]): dx=34, dy=4 -> hypot(34,4) = 34.2"... make x=40, y=56 (x=[40..70], y=[56..86]):
  //       Wall gaps: left=40", top=56", right=110", bottom=46" -> all >= 36"!
  //       Gap to French door sector (x=[0..34], y=[16..52]): dx=6, dy=4 -> 7.2" (> 6" door buffer -> PASS)!
  //       Gap to Dining Table (112, 12 -> x=[112..166], y=[12..48]): dx=42, dy=8 -> 42.7" (>= 36" -> PASS)!
  //       Gap to Herb Planter (112, 108 -> x=[112..154], y=[108..124]): dx=42, dy=22 -> 47.4" (>= 36" -> PASS)!
  //   Initial draft conflict spot: Fire Pit starts too close to Dining Table at x=84, y=38 (only ~12" from table -> FAIL 36 in fire halo!).

  const initialPlacements: FloorplanPlacement[] = [
    {
      id: 'patio_table',
      pieceId: 'table_teak_54',
      label: 'Teak Dining Set (54×36 in)',
      shortLabel: 'Teak Table',
      kind: 'table',
      x: 112,
      y: 12,
      w: 54,
      h: 36,
      rot: 0,
      clearanceIn: 24,
      accent: 'amber',
      slotGroup: 'dining',
      note: 'Shaded beneath the cedar pergola in the northeast corner.',
    },
    {
      id: 'fire_pit',
      pieceId: 'firepit_30',
      label: 'Smokeless Fire Pit (30 in)',
      shortLabel: 'Fire Pit',
      kind: 'firepit',
      x: 82,
      y: 36,
      w: 30,
      h: 30,
      rot: 0,
      clearanceIn: 36,
      accent: 'rose',
      note: 'Needs a full 36 in safety halo from walls, table, and planters — drag southwest to (40, 56).',
    },
    {
      id: 'herb_bed',
      pieceId: 'planter_42',
      label: 'Cedar Herb Planter (42×16 in)',
      shortLabel: 'Herb Planter',
      kind: 'plant',
      x: 112,
      y: 108,
      w: 42,
      h: 16,
      rot: 0,
      clearanceIn: 12,
      accent: 'sage',
      note: 'Placed along the sunny south wall for rosemary, basil, and thyme.',
    },
  ];

  const resolvedPatio: FloorplanPlacement[] = initialPlacements.map(item =>
    item.id === 'fire_pit' ? {...item, x: 40, y: 56} : item,
  );

  const rules: FloorplanRule[] = [
    {id: 'p_door', label: 'French door clear', kind: 'door_clear', bufferIn: 6},
    {
      id: 'p_fire',
      label: '36 in fire pit halo',
      kind: 'clearance_halo',
      targetKind: 'firepit',
      minClearIn: 36,
    },
    {
      id: 'p_shade',
      label: 'Dining shade cover',
      kind: 'feature_zone',
      targetKind: 'table',
      featureKind: 'shade',
      maxDistIn: 18,
    },
    {
      id: 'p_sun',
      label: 'Herb sun exposure',
      kind: 'window_light',
      targetKind: 'plant',
      maxDistIn: 24,
    },
    {
      id: 'p_walk',
      label: '32 in terrace path',
      kind: 'walkway_clear',
      minGapIn: 32,
      pair: ['patio_table', 'herb_bed'],
    },
  ];

  const pieces: TrayPiece[] = [
    {
      pieceId: 'table_teak_54',
      placementId: 'patio_table',
      label: '54 in Teak Table',
      shortLabel: 'Teak Table',
      badge: 'fits',
      recommended: true,
      kind: 'table',
      w: 54,
      h: 36,
      defaultX: 112,
      defaultY: 12,
      defaultRot: 0,
      clearanceIn: 24,
      accent: 'amber',
      slotGroup: 'dining',
      note: 'Seats 4–6 comfortably under the pergola shade.',
    },
    {
      pieceId: 'bistro_32',
      placementId: 'patio_table',
      label: '32 in Bistro Set',
      shortLabel: 'Bistro Set',
      badge: 'compact',
      kind: 'table',
      w: 32,
      h: 32,
      defaultX: 120,
      defaultY: 16,
      defaultRot: 0,
      clearanceIn: 20,
      accent: 'teal',
      slotGroup: 'dining',
      note: 'Compact café table opening extra lounge floor space.',
    },
    {
      pieceId: 'lounger_64',
      placementId: 'sun_lounger',
      label: 'Sun Lounger (28×64)',
      shortLabel: 'Lounger',
      badge: 'toggle',
      kind: 'lounger',
      w: 64,
      h: 28,
      defaultX: 112,
      defaultY: 66,
      defaultRot: 0,
      clearanceIn: 18,
      accent: 'indigo',
      optional: true,
      note: 'Optional teak chaise lounger between pergola and south sun.',
    },
  ];

  const presets: PlanPreset[] = [
    {
      id: 'preset_patio_safe',
      label: 'Safe Fire Halo',
      tagline: '40 in fire clearance + shaded dining',
      recommended: true,
      placements: resolvedPatio,
    },
  ];

  return {
    scenarioId: 'patio_garden',
    scene,
    initialPlacements,
    initialSelectedId: 'fire_pit',
    initialPresetId: '',
    rules,
    presets,
    pieces,
    followUpLabel: 'Ask shade & planting tips',
  };
}

export function swapGuestSeats(
  guests: readonly SeatPlacement[],
  guestIdA: string,
  guestIdB: string,
): SeatPlacement[] {
  if (guestIdA === guestIdB) return [...guests];
  const a = guests.find(g => g.id === guestIdA);
  const b = guests.find(g => g.id === guestIdB);
  if (!a || !b) return [...guests];
  return guests.map(g => {
    if (g.id === a.id) return {...g, tableId: b.tableId, seatIdx: b.seatIdx};
    if (g.id === b.id) return {...g, tableId: a.tableId, seatIdx: a.seatIdx};
    return g;
  });
}

export function buildScenarioBundle(scenarioId: ScenarioId): ScenarioBundle {
  switch (scenarioId) {
    case 'dinner_seating':
      return dinnerSeatingBundle();
    case 'patio_garden':
      return patioGardenBundle();
    case 'bedroom_office':
    default:
      return bedroomOfficeBundle();
  }
}

/**
 * Resolves conflicts in `currentPlacements` while preserving any optional
 * pieces the user added or swapped from `PieceTray`.
 */
export function autoResolvePlacements(
  bundle: ScenarioBundle,
  currentPlacements: readonly PlacementItem[],
): PlacementItem[] {
  const recommended = bundle.presets.find(p => p.recommended) ?? bundle.presets[0];
  if (bundle.scene.mode === 'seating') {
    const currentGuests = currentPlacements as SeatPlacement[];
    // First check if current layout already passes 100%.
    if (evaluatePlanData(bundle.scene, currentGuests, bundle.rules).status === 'pass') {
      return [...currentGuests];
    }
    // Try single swap of violating guest with another guest to reach 100% while keeping user edits.
    const evalNow = evaluatePlanData(bundle.scene, currentGuests, bundle.rules);
    for (const badId of evalNow.violatingIds) {
      for (const candidate of currentGuests) {
        if (candidate.id === badId) continue;
        const swapped = swapGuestSeats(currentGuests, badId, candidate.id);
        if (evaluatePlanData(bundle.scene, swapped, bundle.rules).status === 'pass') {
          return swapped;
        }
      }
    }
    return recommended ? [...recommended.placements] : [...currentGuests];
  }

  // Floorplan mode: snap each present piece to its conflict-free anchor while keeping active pieceIds/optionals.
  const fpScene = bundle.scene;
  const currentFp = currentPlacements as FloorplanPlacement[];
  const recMap = new Map<string, FloorplanPlacement>();
  for (const preset of bundle.presets) {
    for (const item of preset.placements as FloorplanPlacement[]) {
      if (!recMap.has(item.id)) recMap.set(item.id, item);
    }
  }
  const pieceDefaults = new Map<string, TrayPiece>();
  for (const piece of bundle.pieces) {
    pieceDefaults.set(piece.pieceId, piece);
  }

  return currentFp.map(item => {
    const trayDef = pieceDefaults.get(item.pieceId);
    if (trayDef) {
      return clampFloorplanPlacement(
        {
          ...item,
          x: trayDef.defaultX,
          y: trayDef.defaultY,
          rot: trayDef.defaultRot,
        },
        fpScene.roomW,
        fpScene.roomH,
        fpScene.snapIn,
      );
    }
    const anchor = recMap.get(item.id);
    if (anchor) {
      return clampFloorplanPlacement(
        {
          ...item,
          x: anchor.x,
          y: anchor.y,
          rot: anchor.rot,
        },
        fpScene.roomW,
        fpScene.roomH,
        fpScene.snapIn,
      );
    }
    return clampFloorplanPlacement(item, fpScene.roomW, fpScene.roomH, fpScene.snapIn);
  });
}

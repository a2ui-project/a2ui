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
 * Pure 2D spatial floorplan and banquet seating geometry + constraint evaluator.
 * Runs identically in the browser (inside `evaluatePlan` / `inspectItem` catalog
 * functions at 60fps mid-drag) and on the Node MCP server.
 */

import type {
  DoorSpec,
  FloorplanPlacement,
  FloorplanRule,
  FloorplanScene,
  InspectedItem,
  PlacementItem,
  PlanEvaluation,
  PlanRule,
  PlanScene,
  RuleResult,
  RuleStatus,
  SeatPlacement,
  SeatingRule,
  SeatingScene,
  SocialArc,
  TableSpec,
  WindowZoneSpec,
} from './types.js';

export interface Box2D {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
}

export interface DoorComputed {
  readonly hx: number;
  readonly hy: number;
  readonly openX: number;
  readonly openY: number;
  readonly tipX: number;
  readonly tipY: number;
  readonly sectorBox: Box2D;
  readonly sweepFlag: 0 | 1;
}

export function isFloorplanScene(scene: unknown): scene is FloorplanScene {
  return (
    typeof scene === 'object' &&
    scene !== null &&
    !Array.isArray(scene) &&
    (scene as Record<string, unknown>)['mode'] === 'floorplan'
  );
}

export function isSeatingScene(scene: unknown): scene is SeatingScene {
  return (
    typeof scene === 'object' &&
    scene !== null &&
    !Array.isArray(scene) &&
    (scene as Record<string, unknown>)['mode'] === 'seating'
  );
}

export function footprintBox(item: FloorplanPlacement): Box2D {
  const rotated = Math.abs(item.rot % 180) === 90;
  const w = rotated ? item.h : item.w;
  const h = rotated ? item.w : item.h;
  return {
    x1: item.x,
    y1: item.y,
    x2: item.x + w,
    y2: item.y + h,
    w,
    h,
    cx: item.x + w / 2,
    cy: item.y + h / 2,
  };
}

export function snapValue(value: number, snapIn: number): number {
  const step = snapIn > 0 ? snapIn : 1;
  return Math.round(value / step) * step;
}

export function clampFloorplanPlacement(
  item: FloorplanPlacement,
  roomW: number,
  roomH: number,
  snapIn = 2,
): FloorplanPlacement {
  const rotated = Math.abs(item.rot % 180) === 90;
  const effW = rotated ? item.h : item.w;
  const effH = rotated ? item.w : item.h;
  const maxX = Math.max(0, roomW - effW);
  const maxY = Math.max(0, roomH - effH);
  const x = Math.min(maxX, Math.max(0, snapValue(item.x, snapIn)));
  const y = Math.min(maxY, Math.max(0, snapValue(item.y, snapIn)));
  return {...item, x, y};
}

export function rotateFloorplanPlacement(
  item: FloorplanPlacement,
  roomW: number,
  roomH: number,
  snapIn = 2,
): FloorplanPlacement {
  const prev = footprintBox(item);
  const nextRot = (item.rot + 90) % 360;
  const rotated = Math.abs(nextRot % 180) === 90;
  const nextW = rotated ? item.h : item.w;
  const nextH = rotated ? item.w : item.h;
  return clampFloorplanPlacement(
    {
      ...item,
      rot: nextRot,
      x: prev.cx - nextW / 2,
      y: prev.cy - nextH / 2,
    },
    roomW,
    roomH,
    snapIn,
  );
}

/** Signed edge-to-edge gap between two axis-aligned boxes (`< 0` when overlapping). */
export function boxGap(a: Box2D, b: Box2D): number {
  const dx = Math.max(0, a.x1 - b.x2, b.x1 - a.x2);
  const dy = Math.max(0, a.y1 - b.y2, b.y1 - a.y2);
  if (dx > 0 || dy > 0) {
    return Math.hypot(dx, dy);
  }
  const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return -Math.min(overlapX, overlapY);
}

export function pointToBoxDistance(px: number, py: number, box: Box2D): number {
  const dx = Math.max(0, box.x1 - px, px - box.x2);
  const dy = Math.max(0, box.y1 - py, py - box.y2);
  return Math.hypot(dx, dy);
}

export function doorGeometry(door: DoorSpec, roomW: number, roomH: number): DoorComputed {
  const r = door.swingIn;
  if (door.wall === 'bottom') {
    const xStart = door.offsetIn;
    const xEnd = door.offsetIn + door.widthIn;
    const hx = door.hinge === 'start' ? xStart : xEnd;
    const hy = roomH;
    const openX = door.hinge === 'start' ? xStart + r : xEnd - r;
    const openY = roomH;
    const tipX = hx;
    const tipY = roomH - r;
    const x1 = Math.min(hx, openX);
    const x2 = Math.max(hx, openX);
    const y1 = roomH - r;
    const y2 = roomH;
    return {
      hx,
      hy,
      openX,
      openY,
      tipX,
      tipY,
      sectorBox: {x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2},
      sweepFlag: door.hinge === 'start' ? 0 : 1,
    };
  }
  if (door.wall === 'top') {
    const xStart = door.offsetIn;
    const xEnd = door.offsetIn + door.widthIn;
    const hx = door.hinge === 'start' ? xStart : xEnd;
    const hy = 0;
    const openX = door.hinge === 'start' ? xStart + r : xEnd - r;
    const openY = 0;
    const tipX = hx;
    const tipY = r;
    const x1 = Math.min(hx, openX);
    const x2 = Math.max(hx, openX);
    return {
      hx,
      hy,
      openX,
      openY,
      tipX,
      tipY,
      sectorBox: {x1, y1: 0, x2, y2: r, w: x2 - x1, h: r, cx: (x1 + x2) / 2, cy: r / 2},
      sweepFlag: door.hinge === 'start' ? 1 : 0,
    };
  }
  if (door.wall === 'left') {
    const yStart = door.offsetIn;
    const yEnd = door.offsetIn + door.widthIn;
    const hx = 0;
    const hy = door.hinge === 'start' ? yStart : yEnd;
    const openX = 0;
    const openY = door.hinge === 'start' ? yStart + r : yEnd - r;
    const tipX = r;
    const tipY = hy;
    const y1 = Math.min(hy, openY);
    const y2 = Math.max(hy, openY);
    return {
      hx,
      hy,
      openX,
      openY,
      tipX,
      tipY,
      sectorBox: {x1: 0, y1, x2: r, y2, w: r, h: y2 - y1, cx: r / 2, cy: (y1 + y2) / 2},
      sweepFlag: door.hinge === 'start' ? 0 : 1,
    };
  }
  const yStart = door.offsetIn;
  const yEnd = door.offsetIn + door.widthIn;
  const hx = roomW;
  const hy = door.hinge === 'start' ? yStart : yEnd;
  const openX = roomW;
  const openY = door.hinge === 'start' ? yStart + r : yEnd - r;
  const tipX = roomW - r;
  const tipY = hy;
  const y1 = Math.min(hy, openY);
  const y2 = Math.max(hy, openY);
  return {
    hx,
    hy,
    openX,
    openY,
    tipX,
    tipY,
    sectorBox: {
      x1: roomW - r,
      y1,
      x2: roomW,
      y2,
      w: r,
      h: y2 - y1,
      cx: roomW - r / 2,
      cy: (y1 + y2) / 2,
    },
    sweepFlag: door.hinge === 'start' ? 1 : 0,
  };
}

export function windowSegmentBox(win: WindowZoneSpec, roomW: number, roomH: number): Box2D {
  if (win.wall === 'top') {
    return {
      x1: win.offsetIn,
      y1: 0,
      x2: win.offsetIn + win.widthIn,
      y2: 0,
      w: win.widthIn,
      h: 0,
      cx: win.offsetIn + win.widthIn / 2,
      cy: 0,
    };
  }
  if (win.wall === 'bottom') {
    return {
      x1: win.offsetIn,
      y1: roomH,
      x2: win.offsetIn + win.widthIn,
      y2: roomH,
      w: win.widthIn,
      h: 0,
      cx: win.offsetIn + win.widthIn / 2,
      cy: roomH,
    };
  }
  if (win.wall === 'left') {
    return {
      x1: 0,
      y1: win.offsetIn,
      x2: 0,
      y2: win.offsetIn + win.widthIn,
      w: 0,
      h: win.widthIn,
      cx: 0,
      cy: win.offsetIn + win.widthIn / 2,
    };
  }
  return {
    x1: roomW,
    y1: win.offsetIn,
    x2: roomW,
    y2: win.offsetIn + win.widthIn,
    w: 0,
    h: win.widthIn,
    cx: roomW,
    cy: win.offsetIn + win.widthIn / 2,
  };
}

export function formatInches(inches: number): string {
  const rounded = Math.round(inches);
  if (rounded >= 36 && rounded % 12 === 0) {
    return `${rounded / 12} ft`;
  }
  return `${rounded} in`;
}

export function formatRoomFeet(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rem = Math.round(inches % 12);
  return rem === 0 ? `${ft}' 0"` : `${ft}' ${rem}"`;
}

export function seatPosition(
  table: TableSpec,
  seatIdx: number,
): {readonly x: number; readonly y: number; readonly angle: number} {
  const count = Math.max(1, table.seatCount);
  const angle = -Math.PI / 2 + (2 * Math.PI * (seatIdx % count)) / count;
  const orbit = table.radius + 27;
  return {
    x: Math.round(table.cx + Math.cos(angle) * orbit),
    y: Math.round(table.cy + Math.sin(angle) * orbit),
    angle,
  };
}

export function areSeatsAdjacent(a: SeatPlacement, b: SeatPlacement, seatCount: number): boolean {
  if (a.tableId !== b.tableId) return false;
  const diff = Math.abs(a.seatIdx - b.seatIdx);
  return diff === 1 || diff === seatCount - 1;
}

function evaluateFloorplan(
  scene: FloorplanScene,
  placements: readonly FloorplanPlacement[],
  rules: readonly FloorplanRule[],
): PlanEvaluation {
  const results: RuleResult[] = [];
  const violating = new Set<string>();
  const boxes = new Map<string, Box2D>();
  for (const item of placements) {
    boxes.set(item.id, footprintBox(item));
  }

  // Detect any direct physical overlaps first so violatingIds always marks collisions.
  let worstOverlapPair: [FloorplanPlacement, FloorplanPlacement] | undefined;
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]!;
    const boxA = boxes.get(a.id)!;
    if (
      boxA.x1 < -0.5 ||
      boxA.y1 < -0.5 ||
      boxA.x2 > scene.roomW + 0.5 ||
      boxA.y2 > scene.roomH + 0.5
    ) {
      violating.add(a.id);
    }
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]!;
      const boxB = boxes.get(b.id)!;
      if (boxGap(boxA, boxB) < -0.5) {
        violating.add(a.id);
        violating.add(b.id);
        worstOverlapPair ??= [a, b];
      }
    }
  }

  const door = doorGeometry(scene.door, scene.roomW, scene.roomH);
  const winBox = windowSegmentBox(scene.windowZone, scene.roomW, scene.roomH);

  for (const rule of rules) {
    if (rule.kind === 'door_clear') {
      let minClear = Infinity;
      let culprit: FloorplanPlacement | undefined;
      for (const item of placements) {
        const box = boxes.get(item.id)!;
        // Distance to quarter-circle swing: check overlap with sector bounding box first.
        const sectorGap = boxGap(box, door.sectorBox);
        const hingeDist = pointToBoxDistance(door.hx, door.hy, box) - scene.door.swingIn;
        const clear = Math.max(sectorGap, hingeDist);
        if (clear < minClear) {
          minClear = clear;
          culprit = item;
        }
      }
      if (minClear < 0 && culprit) {
        violating.add(culprit.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: `${culprit.shortLabel} blocks swing`,
          focusId: culprit.id,
        });
      } else if (minClear < rule.bufferIn && culprit) {
        violating.add(culprit.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: `${Math.max(0, Math.round(minClear))} in buffer (tight)`,
          focusId: culprit.id,
        });
      } else {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: Number.isFinite(minClear) ? `+${Math.round(minClear)} in clear` : 'Clear',
        });
      }
    } else if (rule.kind === 'walkway_clear') {
      if (worstOverlapPair) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: `${worstOverlapPair[0].shortLabel} overlaps ${worstOverlapPair[1].shortLabel}`,
          focusId: worstOverlapPair[0].id,
        });
        continue;
      }
      let measuredGap = Infinity;
      let focusId: string | undefined;
      if (rule.pair) {
        const a = placements.find(p => p.id === rule.pair![0]);
        const b = placements.find(p => p.id === rule.pair![1]);
        if (a && b) {
          measuredGap = boxGap(boxes.get(a.id)!, boxes.get(b.id)!);
          focusId = b.id;
        }
      }
      if (!Number.isFinite(measuredGap)) {
        const major = placements.filter(p => p.kind !== 'plant' && p.w >= 24);
        for (let i = 0; i < major.length; i++) {
          for (let j = i + 1; j < major.length; j++) {
            const gap = boxGap(boxes.get(major[i]!.id)!, boxes.get(major[j]!.id)!);
            if (gap < measuredGap) {
              measuredGap = gap;
              focusId = major[j]!.id;
            }
          }
        }
      }
      if (!Number.isFinite(measuredGap)) {
        results.push({id: rule.id, label: rule.label, status: 'pass', detail: 'Open floor'});
      } else if (measuredGap >= rule.minGapIn) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: `${Math.round(measuredGap)} in aisle`,
        });
      } else if (measuredGap >= rule.minGapIn - 6) {
        if (focusId) violating.add(focusId);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: `${Math.round(measuredGap)} in (< ${rule.minGapIn} in)`,
          focusId,
        });
      } else {
        if (focusId) violating.add(focusId);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: `${Math.max(0, Math.round(measuredGap))} in (< ${rule.minGapIn} in)`,
          focusId,
        });
      }
    } else if (rule.kind === 'window_light') {
      const target = placements.find(p => p.kind === rule.targetKind);
      if (!target) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: `No ${rule.targetKind} placed`,
        });
      } else {
        const dist = boxGap(boxes.get(target.id)!, winBox);
        if (dist <= rule.maxDistIn) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'pass',
            detail: `${Math.round(dist)} in to light`,
            focusId: target.id,
          });
        } else if (dist <= rule.maxDistIn + 22) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'warn',
            detail: `${Math.round(dist)} in · side light`,
            focusId: target.id,
          });
        } else {
          violating.add(target.id);
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'fail',
            detail: `${Math.round(dist)} in · out of light`,
            focusId: target.id,
          });
        }
      }
    } else if (rule.kind === 'side_access') {
      const target = placements.find(p => p.id === rule.targetId);
      if (!target) {
        results.push({id: rule.id, label: rule.label, status: 'pass', detail: 'N/A'});
      } else {
        const box = boxes.get(target.id)!;
        const vertical = Math.abs(target.rot % 180) === 0;
        const sideA = vertical ? box.x1 : box.y1;
        const sideB = vertical ? scene.roomW - box.x2 : scene.roomH - box.y2;
        const minSide = Math.min(sideA, sideB);
        if (minSide >= rule.minSideIn) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'pass',
            detail: `${Math.round(minSide)} in min side`,
            focusId: target.id,
          });
        } else if (minSide >= rule.minSideIn - 8) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'warn',
            detail: `${Math.round(minSide)} in tight side`,
            focusId: target.id,
          });
        } else {
          violating.add(target.id);
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'fail',
            detail: `Pushed to wall (${Math.round(minSide)} in)`,
            focusId: target.id,
          });
        }
      }
    } else if (rule.kind === 'clearance_halo') {
      const target = placements.find(p => p.kind === rule.targetKind);
      if (!target) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: 'Not placed (clear)',
        });
      } else {
        const tBox = boxes.get(target.id)!;
        let minGap = Math.min(tBox.x1, tBox.y1, scene.roomW - tBox.x2, scene.roomH - tBox.y2);
        let closeId = target.id;
        for (const other of placements) {
          if (other.id === target.id) continue;
          const gap = boxGap(tBox, boxes.get(other.id)!);
          if (gap < minGap) {
            minGap = gap;
            closeId = other.id;
          }
        }
        if (minGap >= rule.minClearIn) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'pass',
            detail: `${Math.round(minGap)} in clear`,
            focusId: target.id,
          });
        } else if (minGap >= rule.minClearIn - 8) {
          violating.add(target.id);
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'warn',
            detail: `${Math.round(minGap)} in (< ${rule.minClearIn} in)`,
            focusId: closeId,
          });
        } else {
          violating.add(target.id);
          violating.add(closeId);
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'fail',
            detail: `${Math.max(0, Math.round(minGap))} in (< ${rule.minClearIn} in)`,
            focusId: target.id,
          });
        }
      }
    } else if (rule.kind === 'feature_zone') {
      const target = placements.find(p => p.kind === rule.targetKind);
      const feature = scene.features?.find(f => f.kind === rule.featureKind);
      if (!target || !feature) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: 'Optional',
        });
      } else {
        const dist = pointToBoxDistance(feature.x, feature.y, boxes.get(target.id)!);
        if (dist <= rule.maxDistIn) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'pass',
            detail: `${Math.round(dist)} in from ${feature.label.toLowerCase()}`,
            focusId: target.id,
          });
        } else if (dist <= rule.maxDistIn + 18) {
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'warn',
            detail: `${Math.round(dist)} in stretch`,
            focusId: target.id,
          });
        } else {
          violating.add(target.id);
          results.push({
            id: rule.id,
            label: rule.label,
            status: 'fail',
            detail: `${Math.round(dist)} in · too far`,
            focusId: target.id,
          });
        }
      }
    }
  }

  return summarizeResults(results, [...violating], []);
}

function evaluateSeating(
  scene: SeatingScene,
  guests: readonly SeatPlacement[],
  rules: readonly SeatingRule[],
): PlanEvaluation {
  const results: RuleResult[] = [];
  const violating = new Set<string>();
  const arcs: SocialArc[] = [];
  const byId = new Map<string, SeatPlacement>();
  for (const g of guests) byId.set(g.id, g);
  const tableById = new Map<string, TableSpec>();
  for (const t of scene.tables) tableById.set(t.id, t);

  for (const rule of rules) {
    if (rule.kind === 'apart_table') {
      const a = byId.get(rule.guestA);
      const b = byId.get(rule.guestB);
      if (!a || !b) continue;
      const seatCount = tableById.get(a.tableId)?.seatCount ?? 8;
      if (a.tableId !== b.tableId) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: 'Separate tables',
          focusId: a.id,
        });
      } else if (areSeatsAdjacent(a, b, seatCount)) {
        violating.add(a.id);
        violating.add(b.id);
        arcs.push({
          fromId: a.id,
          toId: b.id,
          kind: 'conflict',
          satisfied: false,
          label: `${a.shortName} × ${b.shortName}`,
        });
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: `Seated adjacent at ${tableById.get(a.tableId)?.label ?? a.tableId}`,
          focusId: a.id,
        });
      } else {
        violating.add(a.id);
        violating.add(b.id);
        arcs.push({
          fromId: a.id,
          toId: b.id,
          kind: 'conflict',
          satisfied: false,
          label: `${a.shortName} × ${b.shortName}`,
        });
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: 'Same table · move apart',
          focusId: a.id,
        });
      }
    } else if (rule.kind === 'adjacent_pairs') {
      let okPairs = 0;
      let sameTablePairs = 0;
      let brokenGuestId: string | undefined;
      for (const [childId, parentId] of rule.pairs) {
        const child = byId.get(childId);
        const parent = byId.get(parentId);
        if (!child || !parent) continue;
        const seatCount = tableById.get(child.tableId)?.seatCount ?? 8;
        const adj = areSeatsAdjacent(child, parent, seatCount);
        arcs.push({
          fromId: child.id,
          toId: parent.id,
          kind: 'affinity',
          satisfied: adj,
          label: `${child.shortName} + ${parent.shortName}`,
        });
        if (adj) {
          okPairs++;
          sameTablePairs++;
        } else {
          brokenGuestId ??= child.id;
          violating.add(child.id);
          if (child.tableId === parent.tableId) sameTablePairs++;
        }
      }
      if (okPairs === rule.pairs.length) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: `${okPairs}/${rule.pairs.length} beside parent`,
        });
      } else if (sameTablePairs === rule.pairs.length) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: `${okPairs}/${rule.pairs.length} adjacent`,
          focusId: brokenGuestId,
        });
      } else {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: 'Child separated from parent',
          focusId: brokenGuestId,
        });
      }
    } else if (rule.kind === 'dietary_cluster') {
      const matching = guests.filter(g => g.diet === rule.diet);
      const counts = new Map<string, number>();
      for (const g of matching) {
        counts.set(g.tableId, (counts.get(g.tableId) ?? 0) + 1);
      }
      const best = Math.max(0, ...counts.values());
      if (best >= matching.length || best >= rule.minTogether) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: `${best}/${matching.length} ${rule.diet.toUpperCase()} share platter`,
        });
      } else if (best >= Math.max(1, rule.minTogether - 1)) {
        const lone = matching.find(g => (counts.get(g.tableId) ?? 0) === 1);
        if (lone) violating.add(lone.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: `Split ${best}/${matching.length} across tables`,
          focusId: lone?.id,
        });
      } else {
        const first = matching[0];
        if (first) violating.add(first.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: 'Isolated platters',
          focusId: first?.id,
        });
      }
    } else if (rule.kind === 'quiet_table') {
      const guest = byId.get(rule.guestId);
      const table = guest ? tableById.get(guest.tableId) : undefined;
      if (!guest || !table) continue;
      if (table.zone === 'quiet') {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: `${guest.shortName} in quiet zone`,
          focusId: guest.id,
        });
      } else {
        violating.add(guest.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: `${guest.shortName} near speaker`,
          focusId: guest.id,
        });
      }
    } else if (rule.kind === 'host_balance') {
      const missingTable = scene.tables.find(
        table => !guests.some(g => g.tableId === table.id && g.group === 'hosts'),
      );
      if (!missingTable) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: 'Host at every table',
        });
      } else {
        const host = guests.find(g => g.group === 'hosts');
        if (host) violating.add(host.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'fail',
          detail: `No host at ${missingTable.label}`,
          focusId: host?.id,
        });
      }
    } else if (rule.kind === 'affinity_pair') {
      const a = byId.get(rule.guestA);
      const b = byId.get(rule.guestB);
      if (!a || !b) continue;
      const same = a.tableId === b.tableId;
      arcs.push({
        fromId: a.id,
        toId: b.id,
        kind: 'affinity',
        satisfied: same,
        label: `${a.shortName} + ${b.shortName}`,
      });
      if (same) {
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'pass',
          detail: 'Seated together',
          focusId: a.id,
        });
      } else {
        violating.add(a.id);
        results.push({
          id: rule.id,
          label: rule.label,
          status: 'warn',
          detail: 'At separate tables',
          focusId: a.id,
        });
      }
    }
  }

  return summarizeResults(results, [...violating], arcs);
}

function summarizeResults(
  results: readonly RuleResult[],
  violatingIds: readonly string[],
  arcs: readonly SocialArc[],
): PlanEvaluation {
  const totalCount = results.length;
  if (totalCount === 0) {
    return {
      score: 100,
      passCount: 0,
      totalCount: 0,
      status: 'pass',
      summary: 'Ready',
      results: [],
      violatingIds: [],
      arcs: [],
    };
  }
  let points = 0;
  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;
  for (const r of results) {
    if (r.status === 'pass') {
      points += 1;
      passCount++;
    } else if (r.status === 'warn') {
      points += 0.5;
      warnCount++;
    } else {
      failCount++;
    }
  }
  const score = Math.round((points / totalCount) * 100);
  const status: RuleStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';
  const issueCount = failCount + warnCount;
  const summary =
    issueCount === 0
      ? `${passCount}/${totalCount} clear · ${score}%`
      : `${passCount}/${totalCount} clear · ${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`;
  return {
    score,
    passCount,
    totalCount,
    status,
    summary,
    results,
    violatingIds,
    arcs,
  };
}

export function evaluatePlanData(
  scene: unknown,
  placements: unknown,
  rules: unknown,
): PlanEvaluation {
  const itemList = Array.isArray(placements) ? (placements as PlacementItem[]) : [];
  const ruleList = Array.isArray(rules) ? (rules as PlanRule[]) : [];
  if (isFloorplanScene(scene)) {
    return evaluateFloorplan(scene, itemList as FloorplanPlacement[], ruleList as FloorplanRule[]);
  }
  if (isSeatingScene(scene)) {
    return evaluateSeating(scene, itemList as SeatPlacement[], ruleList as SeatingRule[]);
  }
  return summarizeResults([], [], []);
}

export function inspectItemData(
  scene: unknown,
  placements: unknown,
  selectedId: unknown,
): InspectedItem {
  const items = Array.isArray(placements) ? (placements as PlacementItem[]) : [];
  const sel = typeof selectedId === 'string' ? selectedId : '';

  if (isFloorplanScene(scene)) {
    const fpItems = items as FloorplanPlacement[];
    const match = fpItems.find(item => item.id === sel) ?? fpItems[0];
    if (!match) {
      return {
        found: false,
        mode: 'floorplan',
        id: '',
        title: scene.title,
        subtitle: `${formatRoomFeet(scene.roomW)} × ${formatRoomFeet(scene.roomH)}`,
        badge: 'Floorplan',
        metrics: [],
        note: 'Click or drag any piece on the blueprint to inspect clearances.',
      };
    }
    const box = footprintBox(match);
    return {
      found: true,
      mode: 'floorplan',
      id: match.id,
      title: match.label,
      subtitle: `${Math.round(box.w)}" × ${Math.round(box.h)}" footprint · ${match.rot}°`,
      badge: match.optional ? 'Optional piece' : 'Core piece',
      metrics: [
        {label: 'Pos', value: `${Math.round(match.x)}", ${Math.round(match.y)}"`},
        {label: 'Halo', value: `${match.clearanceIn}" clear`},
        {label: 'Rot', value: `${match.rot}°`},
      ],
      note: match.note,
      ...(match.optional ? {optional: true} : {}),
    };
  }

  if (isSeatingScene(scene)) {
    const guests = items as SeatPlacement[];
    const match = guests.find(g => g.id === sel) ?? guests[0];
    if (!match) {
      return {
        found: false,
        mode: 'seating',
        id: '',
        title: scene.title,
        subtitle: `${guests.length} guests`,
        badge: 'Seating',
        metrics: [],
        note: 'Click two seats or drag a guest token onto another seat to swap.',
      };
    }
    const table = scene.tables.find(t => t.id === match.tableId);
    const dietBadge =
      match.diet === 'vegan'
        ? 'Vegan'
        : match.diet === 'gf'
          ? 'Gluten-free'
          : match.diet === 'kid'
            ? 'Kid menu'
            : 'Standard';
    return {
      found: true,
      mode: 'seating',
      id: match.id,
      title: match.name,
      subtitle: `${table?.label ?? match.tableId} · Seat ${match.seatIdx + 1}`,
      badge: `${match.group[0]!.toUpperCase()}${match.group.slice(1)} · ${dietBadge}`,
      metrics: [
        {label: 'Table', value: table?.label ?? match.tableId},
        {label: 'Seat', value: `#${match.seatIdx + 1} (${table?.zone ?? 'main'})`},
        {label: 'Menu', value: dietBadge},
      ],
      note: match.note,
    };
  }

  return {
    found: false,
    mode: 'floorplan',
    id: '',
    title: 'Space & Seating Planner',
    subtitle: 'Select an item',
    badge: 'Ready',
    metrics: [],
    note: 'Click any item on the canvas to inspect dimensions and constraints.',
  };
}

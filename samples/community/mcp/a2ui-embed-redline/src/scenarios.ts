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
 * Negotiation scenarios and prompt router for leases, contractor quotes, and
 * freelance/consulting agreements.
 */

import type {ClauseModelItem, MilestoneSegment, Stance} from './catalog/types.js';

export const SCENARIO_IDS = ['apartment_lease', 'contractor_quote', 'freelance_agreement'] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface BenchmarkSpec {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly normLow: number;
  readonly normHigh: number;
  readonly normLabel: string;
  readonly theirs: number;
  readonly theirsLabel: string;
  readonly ours?: number;
  readonly oursLabel?: string;
}

export interface ClauseSpec extends ClauseModelItem {
  readonly componentId: string;
  readonly riskBadge: string;
  readonly theirsText: string;
  readonly counterText: string;
  readonly fallbackText: string;
  readonly rationale: string;
  readonly recommended: Stance;
  readonly initialStance: Stance;
  readonly inlineBenchmark?: BenchmarkSpec;
}

export interface MilestoneSpec {
  readonly title: string;
  readonly totalAmount: number;
  readonly stanceClauseId: string;
  readonly theirsMilestones: readonly MilestoneSegment[];
  readonly recommendedMilestones: readonly MilestoneSegment[];
}

export interface NegotiationScenario {
  readonly id: ScenarioId;
  readonly docTitle: string;
  readonly subtitle: string;
  readonly summaryBadge: string;
  readonly standaloneBenchmarks: readonly BenchmarkSpec[];
  readonly clauses: readonly ClauseSpec[];
  readonly milestones?: MilestoneSpec;
  /** Layout order of top-level sections to demonstrate genuine agent composability. */
  readonly layoutOrder: readonly (
    | 'metrics_row'
    | 'standalone_benchmarks'
    | 'milestones'
    | 'clauses'
  )[];
}

/** Sanitizes a short untrusted hint from user prompt text for safe display in subtitles. */
function cleanPromptHint(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/[<>\r\n`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > 72 ? `${cleaned.slice(0, 69).trimEnd()}...` : cleaned;
}

/** Infers the best-fit negotiation scenario when `scenario` is omitted. */
export function resolveScenarioId(prompt: string, explicit?: ScenarioId): ScenarioId {
  if (explicit) return explicit;
  const lower = prompt.toLowerCase();
  if (
    /\b(remodel|contractor|kitchen|bath|bathroom|cabinet|renovation|quote|estimate|rough-in|punch\s*list|general\s*contractor|construction)\b/.test(
      lower,
    )
  ) {
    return 'contractor_quote';
  }
  if (
    /\b(freelance|consulting|consultant|sow|msa|ip\b|intellectual\s*property|indemnit|retainer|net[-\s]?60|kill\s*fee|client\s*contract)\b/.test(
      lower,
    )
  ) {
    return 'freelance_agreement';
  }
  return 'apartment_lease';
}

const APARTMENT_LEASE: NegotiationScenario = {
  id: 'apartment_lease',
  docTitle: '245 Valencia St Apt 4B — 12-Month Lease',
  subtitle: 'Harborview Property Mgmt · $3,200/mo rent · Reviewing off-market risk clauses',
  summaryBadge: 'Residential Lease · 3 Clauses',
  standaloneBenchmarks: [],
  layoutOrder: ['metrics_row', 'clauses'],
  clauses: [
    {
      id: 'deposit',
      componentId: 'clause_deposit',
      section: '§4',
      title: 'Security Deposit & Move-In Hold',
      riskBadge: '$4,800 excess lockup',
      exposureAccept: 4800,
      exposureFallback: 1600,
      exposureCounter: 0,
      frictionCounter: 28,
      frictionFallback: 12,
      theirsText:
        'Tenant shall pay 2.5 months security deposit ($8,000), including a $650 non-refundable redecorating fee.',
      counterText:
        'Tenant shall pay 1.0 month refundable security deposit ($3,200), returned within 21 days less itemized statutory wear-and-tear exclusions.',
      fallbackText:
        'Tenant shall pay 1.5 months fully refundable deposit ($4,800) with no non-refundable fees and a pre-move-out walkthrough.',
      rationale:
        'CA AB 12 caps standard unfurnished residential deposits at 1.0 month rent; non-refundable fees are unenforceable.',
      counterAsk:
        'Cap the security deposit at 1.0 month ($3,200) fully refundable per CA Civil Code §1950.5 and remove the $650 non-refundable fee.',
      fallbackAsk:
        'Remove the $650 non-refundable fee and cap the refundable deposit at 1.5 months ($4,800) with a joint walkthrough.',
      recommended: 'counter',
      initialStance: 'counter',
      inlineBenchmark: {
        id: 'bench_deposit',
        label: 'Security Deposit Multiple (CA / Local Market)',
        min: 0,
        max: 3,
        normLow: 1.0,
        normHigh: 1.25,
        normLabel: '1.0 mo norm',
        theirs: 2.5,
        theirsLabel: '2.5 mo theirs',
        ours: 1.0,
        oursLabel: '1.0 mo ask',
      },
    },
    {
      id: 'late_fee',
      componentId: 'clause_late_fee',
      section: '§7',
      title: 'Late Fee & Grace Period',
      riskBadge: '$1,800 penalty risk',
      exposureAccept: 1800,
      exposureFallback: 450,
      exposureCounter: 120,
      frictionCounter: 24,
      frictionFallback: 10,
      theirsText:
        'Rent unpaid on the 2nd incurs an immediate 10% fee ($320) plus $25/day compounding late charge.',
      counterText:
        '5-day grace period through the 5th, followed by a flat 4% late fee ($128 max) with one annual ACH-delay courtesy waiver.',
      fallbackText:
        '4-day grace period through the 4th, followed by a flat 5% late fee ($160 max) and zero daily compounding.',
      rationale:
        'Compounding per-diem late penalties exceed liquidated-damages standards; 5-day grace + 3–5% flat cap is local norm.',
      counterAsk:
        'Add a 5-day grace period and replace the 10% + $25/day penalty with a flat 4% cap ($128) and one bank-delay waiver per year.',
      fallbackAsk:
        'Eliminate the $25/day charge and set a 4-day grace period with a flat 5% ($160) cap.',
      recommended: 'counter',
      initialStance: 'counter',
      inlineBenchmark: {
        id: 'bench_late_fee',
        label: 'Effective Monthly Late Penalty (% of Rent)',
        min: 0,
        max: 16,
        normLow: 3,
        normHigh: 5,
        normLabel: '3–5% norm',
        theirs: 14,
        theirsLabel: '14%+ theirs',
        ours: 4,
        oursLabel: '4% cap ask',
      },
    },
    {
      id: 'renewal_notice',
      componentId: 'clause_renewal_notice',
      section: '§14',
      title: 'Auto-Renewal & Early Exit Window',
      riskBadge: '$3,200 rollover risk',
      exposureAccept: 3200,
      exposureFallback: 800,
      exposureCounter: 0,
      frictionCounter: 24,
      frictionFallback: 10,
      theirsText:
        'Lease auto-renews for a full 12-month term unless Tenant gives written notice 60 days prior; early exit forfeits 2 months rent.',
      counterText:
        'Converts automatically to month-to-month after Month 12 with 30 days notice; landlord duty to mitigate on early relocation.',
      fallbackText:
        '30-day renewal notice window; mutual option to convert to month-to-month at +3% or assign/sublet without fee.',
      rationale:
        'Soft fallback keeps acceptance odds high while cutting the 60-day lock-in trap down to standard 30-day notice.',
      counterAsk:
        'Convert automatically to month-to-month after the initial 12-month term on 30 days written notice.',
      fallbackAsk:
        'Shorten the renewal notice window from 60 days to 30 days and permit lease assignment without penalty.',
      recommended: 'fallback',
      initialStance: 'fallback',
    },
  ],
};

const CONTRACTOR_QUOTE: NegotiationScenario = {
  id: 'contractor_quote',
  docTitle: 'Oak & Tile Builders — Kitchen Remodel Quote #Q-418',
  subtitle: ' Scope: Semi-custom cabinetry, quartz counters & rough-in · $38,500 quoted',
  summaryBadge: 'Contractor Quote · Milestones + 2 Clauses',
  layoutOrder: ['metrics_row', 'standalone_benchmarks', 'milestones', 'clauses'],
  standaloneBenchmarks: [
    {
      id: 'bench_cabinetry',
      label: 'Cabinetry & Install Rate ($/lin ft)',
      min: 200,
      max: 750,
      normLow: 380,
      normHigh: 500,
      normLabel: '$380–$500 norm',
      theirs: 640,
      theirsLabel: '$640 theirs',
      ours: 475,
      oursLabel: '$475 ask',
    },
    {
      id: 'bench_markup',
      label: 'Change-Order O&P Markup (%)',
      min: 0,
      max: 35,
      normLow: 10,
      normHigh: 15,
      normLabel: '10–15% norm',
      theirs: 28,
      theirsLabel: '28% theirs',
      ours: 12,
      oursLabel: '12% cap ask',
    },
  ],
  milestones: {
    title: 'Draw Schedule: Front-Loaded Quote vs Inspection-Gated Holdback',
    totalAmount: 38500,
    stanceClauseId: 'payment_schedule',
    theirsMilestones: [
      {label: 'Signing', percent: 60},
      {label: 'Rough-In', percent: 35},
      {label: 'Final', percent: 5},
    ],
    recommendedMilestones: [
      {label: 'Deposit', percent: 20},
      {label: 'Rough-In Pass', percent: 35},
      {label: 'Cabinets Set', percent: 30},
      {label: 'Punch-List', percent: 15},
    ],
  },
  clauses: [
    {
      id: 'payment_schedule',
      componentId: 'clause_payment_schedule',
      section: 'Draw §2',
      title: 'Upfront Deposit & Punch-List Holdback',
      riskBadge: '$15,400 prepay exposure',
      exposureAccept: 15400,
      exposureFallback: 4800,
      exposureCounter: 950,
      frictionCounter: 32,
      frictionFallback: 14,
      theirsText:
        '60% due upon signing ($23,100), 35% at rough-in start, and 5% upon cabinet delivery prior to punch-list.',
      counterText:
        '20% deposit ($7,700), 35% after city rough-in sign-off, 30% on cabinet/counter install, and 15% ($5,775) after final punch-list + lien waivers.',
      fallbackText:
        '25% deposit + direct material vendor escrow, 35% rough-in pass, 30% install, and 10% final walkthrough holdback.',
      rationale:
        'Front-loading 60% leaves only $1,925 leverage for finish defects; 15% punch-list + unconditional lien waivers protects completion.',
      counterAsk:
        'Restructure draws to 20% deposit, 35% post-rough-in inspection, 30% cabinet/counter install, and 15% upon punch-list completion and lien waivers.',
      fallbackAsk:
        'Cap signing draw at 25% (paying cabinet fabricator invoice directly) and hold 10% until final punch-list sign-off.',
      recommended: 'counter',
      initialStance: 'counter',
    },
    {
      id: 'change_orders',
      componentId: 'clause_change_orders',
      section: 'Scope §6',
      title: 'Change Orders, Allowances & Schedule Cap',
      riskBadge: '$6,200 overrun risk',
      exposureAccept: 6200,
      exposureFallback: 1900,
      exposureCounter: 400,
      frictionCounter: 44,
      frictionFallback: 18,
      theirsText:
        'Unforeseen field work or material substitutions billed at time-and-materials plus 28% overhead & profit; verbal approval valid.',
      counterText:
        'No extra charges without pre-signed written Change Order stating fixed cost and days added; O&P markup capped at 12% on verified invoices.',
      fallbackText:
        'Written email/text confirmation required for extras over $250; O&P markup capped at 15% with shared receipts.',
      rationale:
        'Verbal extras + 28% markup is the #1 remodel budget blowup; requiring pre-signed fixed-price COs at 12% O&P aligns incentives.',
      counterAsk:
        'Require pre-signed written change orders for any scope change and cap overhead/profit markup at 12% on documented receipts.',
      fallbackAsk:
        'Require written approval for any item above $250 and cap change-order markup at 15% with supplier invoices.',
      recommended: 'fallback',
      initialStance: 'fallback',
    },
  ],
};

const FREELANCE_AGREEMENT: NegotiationScenario = {
  id: 'freelance_agreement',
  docTitle: 'Northstar Labs — Product Design & Engineering SOW',
  subtitle: 'Counterparty: Northstar Enterprise Procurement · $24,000 fixed-fee SOW',
  summaryBadge: 'Consulting MSA/SOW · 3 Clauses + Schedule',
  standaloneBenchmarks: [],
  layoutOrder: ['metrics_row', 'clauses', 'milestones'],
  milestones: {
    title: 'Billing Schedule: Net-60 Back-Loaded vs 40/30/30 Net-15',
    totalAmount: 24000,
    stanceClauseId: 'net_terms',
    theirsMilestones: [{label: '100% Net-60 post-signoff', percent: 100}],
    recommendedMilestones: [
      {label: 'Kickoff', percent: 40},
      {label: 'Beta Handoff', percent: 30},
      {label: 'Final Net-15', percent: 30},
    ],
  },
  clauses: [
    {
      id: 'ip_scope',
      componentId: 'clause_ip_scope',
      section: '§5',
      title: 'Pre-Existing Tools & IP Transfer Timing',
      riskBadge: '$12,000 IP risk',
      exposureAccept: 12000,
      exposureFallback: 2500,
      exposureCounter: 0,
      frictionCounter: 24,
      frictionFallback: 10,
      theirsText: 'Consultant assigns all reusable code, tools, and inventions upon creation.',
      counterText:
        'Client owns SOW deliverables upon full payment; Consultant retains pre-existing tools with perpetual license.',
      fallbackText:
        'Schedule A carves out background libraries; SOW deliverables assign upon payment.',
      rationale:
        'Carving out background tools preserves future client work while granting Client full product rights.',
      counterAsk:
        'Carve out Consultant pre-existing tools (granting Client a perpetual license) and condition deliverable IP assignment on full payment.',
      fallbackAsk:
        'List pre-existing libraries in Schedule A as retained background IP with a non-exclusive license to Client.',
      recommended: 'counter',
      initialStance: 'counter',
    },
    {
      id: 'liability_cap',
      componentId: 'clause_liability_cap',
      section: '§9',
      title: 'Indemnity Cap & Convenience Kill-Fee',
      riskBadge: '$18,000 uncapped tail',
      exposureAccept: 18000,
      exposureFallback: 4000,
      exposureCounter: 500,
      frictionCounter: 28,
      frictionFallback: 12,
      theirsText:
        'Uncapped indemnification; Client may cancel on 2 days notice paying only accepted milestones.',
      counterText:
        'Liability capped at 1× SOW ($24,000); convenience cancellation pays work-to-date plus 25% kill fee.',
      fallbackText:
        'Liability capped at 2× SOW fees; 14-day cancellation notice paying all work-in-progress.',
      rationale:
        'Uncapped liability + 0% kill fee exposes personal assets if procurement cancels mid-sprint.',
      counterAsk:
        'Cap aggregate liability at 1× SOW fees ($24,000) and include a 25% kill fee on unbilled scope if terminated for convenience.',
      fallbackAsk:
        'Cap total liability at 2× SOW fees and require 14 days written termination notice with pro-rata payment for work in progress.',
      recommended: 'counter',
      initialStance: 'counter',
      inlineBenchmark: {
        id: 'bench_kill_fee',
        label: 'Early Cancellation Kill-Fee (% Remaining SOW)',
        min: 0,
        max: 60,
        normLow: 25,
        normHigh: 50,
        normLabel: '25–50% norm',
        theirs: 0,
        theirsLabel: '0% theirs',
        ours: 25,
        oursLabel: '25% ask',
      },
    },
    {
      id: 'net_terms',
      componentId: 'clause_net_terms',
      section: '§3',
      title: 'Payment Schedule & Deemed Acceptance',
      riskBadge: '$9,600 cashflow drag',
      exposureAccept: 9600,
      exposureFallback: 2400,
      exposureCounter: 300,
      frictionCounter: 24,
      frictionFallback: 10,
      theirsText: '100% payable Net-60 after written sign-off, with unlimited revisions.',
      counterText:
        '40/30/30 milestones payable Net-15; deemed accepted after 7 business days without defect notice.',
      fallbackText:
        '50% kickoff / 50% delivery Net-30, with 2 revision rounds and 10-day deemed acceptance.',
      rationale:
        'Net-60 gated on open-ended sign-off delays cash 90+ days; 40/30/30 + 7-day window bounds scope.',
      counterAsk:
        'Move to 40/30/30 milestone billing on Net-15 terms with 7-business-day deemed acceptance and 2 included revision rounds.',
      fallbackAsk:
        'Split billing 50% at kickoff and 50% on delivery (Net-30) with a 10-business-day acceptance window.',
      recommended: 'fallback',
      initialStance: 'fallback',
    },
  ],
};

const SCENARIO_MAP: Record<ScenarioId, NegotiationScenario> = {
  apartment_lease: APARTMENT_LEASE,
  contractor_quote: CONTRACTOR_QUOTE,
  freelance_agreement: FREELANCE_AGREEMENT,
};

export function getScenario(prompt: string, explicit?: ScenarioId): NegotiationScenario {
  const id = resolveScenarioId(prompt, explicit);
  const base = SCENARIO_MAP[id];
  const hint = cleanPromptHint(prompt);
  if (!hint) return base;
  return {
    ...base,
    subtitle: `${base.subtitle.trim()} · Focus: "${hint}"`,
  };
}

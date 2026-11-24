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
 * Composes scenario-specific A2UI v1.0 component trees and compact data models
 * using ONLY `redlineCatalog` components.
 */

import {computeNegotiationMetrics, formatDollars} from '../catalog/functions.js';
import type {ClauseModelItem, NegotiationTone, Stance} from '../catalog/types.js';
import type {BenchmarkSpec, NegotiationScenario} from '../scenarios.js';
import {
  bind,
  call,
  component,
  createSurfaceMessages,
  event,
  type A2uiComponent,
  type SurfaceView,
} from './a2ui.js';

function benchmarkComponent(spec: BenchmarkSpec): A2uiComponent {
  return component(spec.id, 'BenchmarkBullet', {
    label: spec.label,
    min: spec.min,
    max: spec.max,
    normLow: spec.normLow,
    normHigh: spec.normHigh,
    normLabel: spec.normLabel,
    theirs: spec.theirs,
    theirsLabel: spec.theirsLabel,
    ...(spec.ours !== undefined ? {ours: spec.ours} : {}),
    ...(spec.oursLabel !== undefined ? {oursLabel: spec.oursLabel} : {}),
  });
}

export function defaultStancesFor(scenario: NegotiationScenario): Record<string, Stance> {
  const stances: Record<string, Stance> = {};
  for (const clause of scenario.clauses) {
    stances[clause.id] = clause.initialStance;
  }
  return stances;
}

export function clauseModelsFor(scenario: NegotiationScenario): ClauseModelItem[] {
  return scenario.clauses.map(clause => ({
    id: clause.id,
    section: clause.section,
    title: clause.title,
    exposureAccept: clause.exposureAccept,
    exposureFallback: clause.exposureFallback,
    exposureCounter: clause.exposureCounter,
    frictionCounter: clause.frictionCounter,
    frictionFallback: clause.frictionFallback,
    counterAsk: clause.counterAsk,
    fallbackAsk: clause.fallbackAsk,
  }));
}

/** Builds the scenario's distinct component topology and initial data model. */
export function composeSurfaceView(
  surfaceId: string,
  scenario: NegotiationScenario,
  tone: NegotiationTone = 'collaborative',
): SurfaceView {
  const components: A2uiComponent[] = [];
  const rootChildren: string[] = [];

  const metricsCall = call('negotiationMetrics', {
    clauses: bind('/clauses'),
    stances: bind('/stances'),
  });

  for (const block of scenario.layoutOrder) {
    if (block === 'metrics_row') {
      rootChildren.push('metrics_row');
      components.push(
        component('metrics_row', 'TwoUpRow', {
          children: ['exposure_meter', 'leverage_gauge'],
        }),
        component('exposure_meter', 'ExposureMeter', {
          label: 'Downside Exposure',
          metrics: metricsCall,
        }),
        component('leverage_gauge', 'LeverageGauge', {
          label: 'Deal Friction & Odds',
          metrics: metricsCall,
        }),
      );
    } else if (block === 'standalone_benchmarks' && scenario.standaloneBenchmarks.length > 0) {
      rootChildren.push('line_benchmarks_row');
      components.push(
        component('line_benchmarks_row', 'TwoUpRow', {
          children: scenario.standaloneBenchmarks.map(item => item.id),
        }),
        ...scenario.standaloneBenchmarks.map(benchmarkComponent),
      );
    } else if (block === 'milestones' && scenario.milestones) {
      rootChildren.push('milestone_schedule');
      components.push(
        component('milestone_schedule', 'MilestoneScheduleBar', {
          title: scenario.milestones.title,
          totalAmount: bind('/milestones/totalAmount'),
          activeStance: bind(`/stances/${scenario.milestones.stanceClauseId}`),
          theirsMilestones: bind('/milestones/theirs'),
          recommendedMilestones: bind('/milestones/recommended'),
        }),
      );
    } else if (block === 'clauses') {
      for (const clause of scenario.clauses) {
        rootChildren.push(clause.componentId);
        if (clause.inlineBenchmark) {
          components.push(benchmarkComponent(clause.inlineBenchmark));
        }
        components.push(
          component(clause.componentId, 'ClauseRedline', {
            clauseId: clause.id,
            section: clause.section,
            title: clause.title,
            riskBadge: clause.riskBadge,
            theirsText: clause.theirsText,
            counterText: clause.counterText,
            fallbackText: clause.fallbackText,
            rationale: clause.rationale,
            recommended: clause.recommended,
            stance: bind(`/stances/${clause.id}`),
            ...(clause.inlineBenchmark ? {evidenceChild: clause.inlineBenchmark.id} : {}),
          }),
        );
      }
    }
  }

  components.push(
    component('counter_letter', 'CounterLetterPreview', {
      title: 'Live Counter-Offer Email',
      tone: bind('/tone'),
      emailBody: call('composeCounterEmail', {
        docTitle: bind('/docTitle'),
        clauses: bind('/clauses'),
        stances: bind('/stances'),
        tone: bind('/tone'),
      }),
      finalizeAction: event('finalize_counter', {
        stances: bind('/stances'),
        tone: bind('/tone'),
      }),
      resetAction: event('reset_picks', {}),
      strategyFollowUp: event('ask_clause_strategy', {
        docTitle: bind('/docTitle'),
        tone: bind('/tone'),
      }),
    }),
  );

  components.unshift(
    component('root', 'NegotiationBoard', {
      title: bind('/docTitle'),
      subtitle: bind('/subtitle'),
      summaryBadge: bind('/summaryBadge'),
      statusBanner: bind('/statusBanner'),
      children: rootChildren,
      footer: 'counter_letter',
    }),
  );

  const dataModel: Record<string, unknown> = {
    scenario: scenario.id,
    docTitle: scenario.docTitle,
    subtitle: scenario.subtitle,
    summaryBadge: scenario.summaryBadge,
    statusBanner: '',
    tone,
    stances: defaultStancesFor(scenario),
    clauses: clauseModelsFor(scenario),
    ...(scenario.milestones
      ? {
          milestones: {
            totalAmount: scenario.milestones.totalAmount,
            theirs: scenario.milestones.theirsMilestones,
            recommended: scenario.milestones.recommendedMilestones,
          },
        }
      : {}),
  };

  return {
    surfaceId,
    sendDataModel: true,
    components,
    dataModel,
  };
}

/** Builds validated A2UI messages and a complete plain-text summary for the model. */
export function composeNegotiationResponse(surfaceId: string, scenario: NegotiationScenario) {
  const view = composeSurfaceView(surfaceId, scenario);
  const messages = createSurfaceMessages(view);
  const metrics = computeNegotiationMetrics(view.dataModel['clauses'], view.dataModel['stances']);

  const benchmarkLines = scenario.standaloneBenchmarks.map(
    bench =>
      `- Benchmark (${bench.label}): ${bench.theirsLabel} vs ${bench.normLabel}${bench.oursLabel ? `, counter target ${bench.oursLabel}` : ''}.`,
  );

  const milestoneLine = scenario.milestones
    ? (() => {
        const total = scenario.milestones.totalAmount;
        const theirs = scenario.milestones.theirsMilestones
          .map(m => `${m.percent}% ${m.label} (${formatDollars((total * m.percent) / 100)})`)
          .join(' / ');
        const ours = scenario.milestones.recommendedMilestones
          .map(m => `${m.percent}% ${m.label} (${formatDollars((total * m.percent) / 100)})`)
          .join(' / ');
        return `- Payment Schedule (${formatDollars(total)} total): Theirs [${theirs}] -> Recommended Counter [${ours}].`;
      })()
    : undefined;

  const clauseLines = scenario.clauses.map(clause => {
    const benchNote = clause.inlineBenchmark
      ? ` [Benchmark: ${clause.inlineBenchmark.theirsLabel} vs ${clause.inlineBenchmark.normLabel}]`
      : '';
    return [
      `- ${clause.section} ${clause.title} (★ pre-selected: ${clause.initialStance}; risk if accepted: ${formatDollars(clause.exposureAccept)}, fallback: ${formatDollars(clause.exposureFallback)}, counter: ${formatDollars(clause.exposureCounter)})${benchNote}:`,
      `  • Theirs: ${clause.theirsText}`,
      `  • Recommended Counter: ${clause.counterAsk}`,
      `  • Soft Fallback: ${clause.fallbackAsk}`,
      `  • Rationale: ${clause.rationale}`,
    ].join('\n');
  });

  const text = [
    `Rendered Redline Negotiator inline for "${scenario.docTitle}" (${scenario.summaryBadge}).`,
    `Exposure & Leverage Summary: Signing as-is carries ${formatDollars(metrics.maxExposure)} worst-case downside (floor: ${formatDollars(metrics.minExposure)}). The pre-selected stances reduce downside to ${formatDollars(metrics.currentExposure)} (cutting ${formatDollars(metrics.savedDollars)}) at ${metrics.frictionScore}/100 deal friction (${metrics.frictionLabel}).`,
    ...benchmarkLines,
    ...(milestoneLine ? [milestoneLine] : []),
    ...clauseLines,
    'The interactive studio also includes a live Collaborative/Firm counter-offer email draft and Lock/Reset controls; nothing is sent externally until the user acts.',
    "IMPORTANT: Make redline_negotiator the final tool call of your turn: never call read_file, run_command, update_focus, or any other tool after redline_negotiator returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this text summary.",
  ].join('\n');

  return {view, messages, text};
}

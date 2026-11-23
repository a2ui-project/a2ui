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
 * Rule-based recommendations for every decision type: used when there is no
 * Gemini key, when the call fails or runs out of time, and for any item the
 * model's answer leaves out or gets wrong. Simpler reasons, but always valid.
 */

import {formatMoney, joinList} from '../format.js';
import {firstName} from '../mail/mailbox.js';
import type {DecisionCandidate, Recommendation} from './types.js';

/** What happens when the person applies `choice` on `decision`. */
export function consequenceOf(decision: DecisionCandidate, choice: string): string {
  const who = firstName(decision.sender.name);
  const details = decision.details;
  switch (`${decision.type}:${choice}`) {
    case 'reply:send':
      return `${who} gets your reply now.`;
    case 'reply:later':
    case 'scheduling:skip':
      return 'It comes back to the top of your inbox tomorrow at 9 AM.';
    case 'reply:skip':
      return 'Archived without a reply.';
    case 'scheduling:offer':
      return `${who} gets a reply offering the times you picked.`;
    case 'invite:accept':
      return `Added to your calendar; ${who} sees you're going.`;
    case 'invite:tentative':
      return `Stays on your calendar as maybe; ${who} sees a tentative reply.`;
    case 'invite:decline':
      return `${who} gets your decline${details['alternative'] ? ' with your note' : ''}.`;
    case 'bill:pay_now':
      return `Pays ${formatMoney(Number(details['amount']))} from checking today.`;
    case 'bill:schedule':
      return `Pays ${formatMoney(Number(details['amount']))} on ${String(details['due'])}; you can cancel until then.`;
    case 'bill:dispute':
      return `Nothing is paid; ${String(details['payee'])} gets a question about the amount.`;
    case 'shared_expense:pay':
      return `Sends ${formatMoney(Number(details['amount']))} to ${who}.`;
    case 'shared_expense:ask':
      return `${who} gets a message asking what it covers; nothing is paid.`;
    case 'shared_expense:decline':
      return `The request is declined and ${who} is notified.`;
    case 'cleanup:unsubscribe':
      return 'Unsubscribes and archives what is in your inbox from them.';
    case 'cleanup:archive_all':
      return 'Archives their emails now and skips the inbox for new ones.';
    case 'cleanup:keep':
      return 'Nothing changes.';
    case 'security:report':
      return 'Reported as phishing and moved out of your inbox; nothing is opened.';
    case 'security:not_phishing':
      return 'Stays in your inbox and is marked safe.';
    case 'document:open':
      return 'Marks it opened; sign from the link in the email.';
    case 'document:remind':
      return `Comes back Monday at 9 AM, before it's due ${String(details['due'])}.`;
    case 'document:done':
      return 'Archived as done.';
    default:
      return 'Applies your choice.';
  }
}

/** The rule-based recommendation for one decision. */
export function fallbackRecommendation(
  decision: DecisionCandidate,
  myName: string,
): Recommendation {
  const recommendation = recommend(decision, firstName(myName));
  return {...recommendation, consequence: consequenceOf(decision, recommendation.recommended)};
}

function recommend(decision: DecisionCandidate, me: string): Omit<Recommendation, 'consequence'> {
  const who = String(decision.details['person'] ?? firstName(decision.sender.name));
  const details = decision.details;
  switch (decision.type) {
    case 'reply': {
      const related = decision.related?.[0];
      const arrival = related ? /lands (.+?) \(/.exec(related)?.[1] : undefined;
      return arrival
        ? {
            recommended: 'send',
            reason: `Answers with your flight time from your trip confirmation.`,
            draft: `Hi ${who},\n\nYes! I land ${arrival.replace(/^\w+ \w+ \d+, /, 'at ')} on Friday. See you soon!\n\n${me}`,
          }
        : {
            recommended: 'send',
            reason: `${who} asked you a question; this is a short holding reply to edit.`,
            draft: `Hi ${who},\n\nThanks for asking. Yes, that works for me.\n\n${me}`,
          };
    }
    case 'scheduling': {
      const picks = pickSpreadSlots(decision);
      const labels =
        decision.slots?.filter(slot => picks.includes(slot.value)).map(slot => slot.label) ?? [];
      return {
        recommended: 'offer',
        reason: `You're free ${joinList(labels)}.`,
        pickedSlots: picks,
        draft: `Hi ${who},\n\nGreat to hear from you! Would ${joinList(labels)} work for coffee?\n\n${me}`,
      };
    }
    case 'invite':
      return details['conflict']
        ? {
            recommended: 'decline',
            reason: `Overlaps your ${String(details['conflict'])
              .replace(/ \(.*\)$/, '')
              .toLowerCase()} appointment${details['alternative'] ? `; suggest ${String(details['alternative']).split(' ')[0]}` : ''}.`,
            note: details['alternative']
              ? `Sorry, I have a conflict then. Could we do ${String(details['alternative'])} instead?`
              : 'Sorry, I have a conflict then.',
          }
        : {recommended: 'accept', reason: `You're free ${String(details['when'])}.`};
    case 'bill': {
      const change = Number(details['change']);
      if (Number(details['daysLeft']) <= 2) {
        return {
          recommended: 'pay_now',
          reason: `Due ${String(details['due'])}, in ${String(details['daysLeft'])} days or less.`,
        };
      }
      return {
        recommended: 'schedule',
        reason:
          change > 10
            ? `It's ${change}% higher than ${String(details['previousMonth'])} (${formatMoney(Number(details['previousAmount']))}); worth a check before it's paid.`
            : `About the same as usual; paying on the due date keeps the money in checking longer.`,
      };
    }
    case 'shared_expense':
      return details['matched']
        ? {
            recommended: 'pay',
            reason: `Matches ${String(details['matched'])}${Number(details['total']) > 0 ? `, your half of ${formatMoney(Number(details['total']))}` : ''}.`,
          }
        : {recommended: 'ask', reason: `Nothing on your calendar explains this request.`};
    case 'cleanup':
      if (details['onCalendar']) {
        return {
          recommended: 'keep',
          reason: `"${String(details['onCalendar'])}" is on your calendar.`,
        };
      }
      if (Number(details['opened']) === 0) {
        return {
          recommended: 'unsubscribe',
          reason: `Opened 0 of the last ${String(details['received'])}.`,
        };
      }
      return details['hasOrders']
        ? {
            recommended: 'archive_all',
            reason: `Opened ${String(details['opened'])} of ${String(details['received'])}; archiving keeps your order emails coming.`,
          }
        : {
            recommended: 'unsubscribe',
            reason: `Opened ${String(details['opened'])} of the last ${String(details['received'])}.`,
          };
    case 'security':
      return {recommended: 'report', reason: decision.redFlags?.[0] ?? 'It looks like phishing.'};
    case 'document':
      return Number(details['daysLeft']) > 3
        ? {
            recommended: 'remind',
            reason: `Due ${String(details['due'])}, so there's time; it comes back Monday.`,
          }
        : {
            recommended: 'open',
            reason: `Due ${String(details['due'])}, in ${String(details['daysLeft'])} days.`,
          };
  }
}

/** Up to two slot values on different days, earliest first. */
export function pickSpreadSlots(decision: DecisionCandidate): string[] {
  const picks: string[] = [];
  const days = new Set<string>();
  for (const slot of decision.slots ?? []) {
    const day = slot.label.split(' ')[0]!;
    if (days.has(day)) continue;
    days.add(day);
    picks.push(slot.value);
    if (picks.length === 2) break;
  }
  return picks;
}

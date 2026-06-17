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

import {App} from '@modelcontextprotocol/ext-apps';

let currentInput = '';
let previousInput = '';
let operator: string | null = null;
let displayElement: HTMLElement | null = null;

const app = new App({name: 'MCP Calculator', version: '1.0.0'});

function updateDisplay() {
  if (displayElement) {
    displayElement.textContent = currentInput || '0';
  }
}

function appendNumber(number: string) {
  if (currentInput === '0' && number !== '.') {
    currentInput = number;
  } else {
    currentInput += number;
  }
  updateDisplay();
}

function appendPoint() {
  if (!currentInput.includes('.')) {
    currentInput += '.';
    updateDisplay();
  }
}

function appendOperator(op: string) {
  if (currentInput === '') return;
  if (previousInput !== '') {
    calculateJavascript();
  }
  operator = op;
  previousInput = currentInput;
  currentInput = '';
}

function clearDisplay() {
  currentInput = '';
  previousInput = '';
  operator = null;
  updateDisplay();
}

function calculateJavascript() {
  if (previousInput === '' || currentInput === '') return;
  let result: number;
  const prevVal = parseFloat(previousInput);
  const currentVal = parseFloat(currentInput);
  if (isNaN(prevVal) || isNaN(currentVal)) return;

  switch (operator) {
    case '+':
      result = prevVal + currentVal;
      break;
    case '-':
      result = prevVal - currentVal;
      break;
    case '*':
      result = prevVal * currentVal;
      break;
    case '/':
      if (currentVal === 0) {
        currentInput = 'Error';
        operator = null;
        previousInput = '';
        updateDisplay();
        return;
      }
      result = prevVal / currentVal;
      break;
    default:
      return;
  }
  currentInput = result.toString();
  updateDisplay();

  // Log calculation to host
  app.sendLog({
    level: 'info',
    data: `Calculated: ${prevVal} ${operator} ${currentVal} = ${result}`,
  });

  operator = null;
  previousInput = '';
}

async function calculateToolCall() {
  if (previousInput === '' || currentInput === '') return;
  const prevVal = parseFloat(previousInput);
  const currentVal = parseFloat(currentInput);
  if (isNaN(prevVal) || isNaN(currentVal)) return;

  let opName = '';
  switch (operator) {
    case '+':
      opName = 'add';
      break;
    case '-':
      opName = 'subtract';
      break;
    case '*':
      opName = 'multiply';
      break;
    case '/':
      opName = 'divide';
      break;
    default:
      return;
  }

  try {
    console.log('Calling tool calculate...');
    const result = await app.callServerTool({
      name: 'calculate',
      arguments: {
        operation: opName,
        a: prevVal,
        b: currentVal,
      },
    });
    console.log('Tool call result:', result);
  } catch (err) {
    console.error('Tool call failed:', err);
  }

  // Reset state locally as per user requirement (UI can forget about it)
  currentInput = '';
  previousInput = '';
  operator = null;
  updateDisplay();
}

function init() {
  displayElement = document.getElementById('display');
  updateDisplay();

  // Attach to window for HTML onclick handlers
  (window as any).appendNumber = appendNumber;
  (window as any).appendPoint = appendPoint;
  (window as any).appendOperator = appendOperator;
  (window as any).clearDisplay = clearDisplay;
  (window as any).calculateJavascript = calculateJavascript;
  (window as any).calculateToolCall = calculateToolCall;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Connect to host
app
  .connect()
  .then(() => {
    console.log('MCP App Connected');
  })
  .catch(err => {
    console.error('Failed to connect to host:', err);
  });

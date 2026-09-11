// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {chromium} from 'playwright';

async function runE2ETest() {
  console.log(
    '🚀 Starting A2UI Templates End-to-End Test (Presets + Inspector + Template Library + Live LLM)...',
  );

  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', err => {
    console.error('❌ Page Error:', err.message);
    pageErrors.push(err.message);
  });

  try {
    // 1. Navigate to client
    console.log('🌐 Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', {waitUntil: 'networkidle', timeout: 15000});

    const title = await page.textContent('h1');
    console.log(`✅ Loaded application: "${title?.trim()}"`);

    // Helper to verify a preset button
    async function testPreset(buttonText, expectedContents) {
      console.log(`\n👉 Clicking preset: "${buttonText}"...`);
      const btn = page.locator(`button:has-text("${buttonText}")`);
      await btn.click();

      // Wait for assistant response and surface to render
      await page.waitForTimeout(1000);

      const bodyText = await page.textContent('body');
      if (
        bodyText.includes('Error contacting server:') ||
        bodyText.includes('Validation failed') ||
        bodyText.includes('Catalog not found')
      ) {
        throw new Error(`Client reported error after clicking "${buttonText}":\n${bodyText}`);
      }

      for (const expected of expectedContents) {
        if (!bodyText.includes(expected)) {
          throw new Error(
            `Expected text "${expected}" not found in rendered DOM for preset "${buttonText}".`,
          );
        }
        console.log(`   ✓ Found rendered text: "${expected}"`);
      }
      console.log(`✅ Preset "${buttonText}" passed!`);
    }

    // 2. Test Presets
    await testPreset('🔒 Verified Salary', [
      'Verified Compensation',
      'Marcus Vance',
      '$195,000',
      '$38,000',
      '2,800 RSUs',
    ]);
    await testPreset('💰 Payroll Summary', [
      'Payroll & Compensation Summary',
      'TOTAL PAYROLL',
      '$795,000',
      'Total Budget: $952,000',
    ]);
    await testPreset('👤 User Profile', ['Alice Smith', 'Lead Architect']);
    await testPreset('👥 Team Roster', [
      'Organization Directory',
      'Core Architecture',
      'Dr. Elena Vance',
      'Design Systems',
      'Aria Chen',
    ]);
    await testPreset('🎯 Team Goals', [
      'Strategic Objectives: Core Protocol Engineering',
      'Deliver synchronous template expansion engine',
      'High',
    ]);
    await testPreset('💬 Feedback Board', [
      'Feedback & Retrospective: Frontend & Protocols Guild',
      'Dr. Elena Vance',
      'Marcus Vance',
    ]);
    await testPreset('⭐ Competency Panel', [
      'Competency: Alice Smith',
      'Lead Systems Architect',
      '9 Yrs',
      '142 Done',
    ]);

    // 3. Test Inspector UI on Turn
    console.log('\n👉 Testing Format & JSON Inspector Drawer...');
    const inspectBtn = page.locator('button:has-text("Inspect Format")').last();
    await inspectBtn.click();
    await page.waitForTimeout(500);

    // Verify Express DSL is visible
    let inspectorContent = await page.textContent('body');
    if (
      !inspectorContent.includes('<a2ui>') &&
      !inspectorContent.includes('UserProfile') &&
      !inspectorContent.includes('EmployeeSalaryCard')
    ) {
      throw new Error(`Expected Express DSL content in inspector drawer:\n${inspectorContent}`);
    }
    console.log('   ✓ Raw Express DSL displayed in inspector drawer');

    // Switch to Expanded JSON Tab
    const jsonTabBtn = page.locator('button:has-text("Expanded A2UI JSON")');
    await jsonTabBtn.click();
    await page.waitForTimeout(500);

    inspectorContent = await page.textContent('body');
    if (
      !inspectorContent.includes('createSurface') ||
      !inspectorContent.includes('updateComponents')
    ) {
      throw new Error(`Expected expanded JSON messages in inspector drawer:\n${inspectorContent}`);
    }
    console.log('   ✓ Expanded A2UI JSON displayed in inspector drawer');
    console.log('✅ Inspector Drawer Test Passed!');

    // 4. Test Template Library Screen
    console.log('\n👉 Testing Template Library Studio...');
    const libraryTabBtn = page.locator('button:has-text("Template Library")');
    await libraryTabBtn.click();
    await page.waitForTimeout(1000);

    let libraryBody = await page.textContent('body');
    if (
      !libraryBody.includes('Registered Templates') ||
      (!libraryBody.includes('Inflated UI Preview') &&
        !libraryBody.includes('Inflated Output Preview'))
    ) {
      throw new Error(`Template Library studio failed to load:\n${libraryBody}`);
    }
    console.log('   ✓ Template Library screen mounted');

    // Click EmployeeSalaryCard dynamic template in library list
    console.log('\n👉 Testing Dynamic Template 3-Stage Studio...');
    const salaryCardBtn = page.locator('button:has-text("EmployeeSalaryCard")').first();
    await salaryCardBtn.click();
    await page.waitForTimeout(600);

    libraryBody = await page.textContent('body');
    if (
      !libraryBody.includes('Dynamic Server Resolver') ||
      !libraryBody.includes('Step 1: Simple LLM Input Interface')
    ) {
      throw new Error(`Dynamic template studio failed to mount:\n${libraryBody}`);
    }
    console.log('   ✓ Dynamic Template 3-Stage Studio mounted');

    // Test dropdown selection to Marcus Vance
    const empSelect = page.locator('select');
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/resolve') && resp.status() === 200),
      empSelect.selectOption('emp_102'),
    ]);
    await page.waitForTimeout(800);

    libraryBody = await page.textContent('body');
    if (!libraryBody.includes('Marcus Vance') || !libraryBody.includes('$195,000')) {
      throw new Error(`Dynamic resolver execution for emp_102 failed:\n${libraryBody}`);
    }
    console.log('   ✓ Dynamic server resolver executed and updated preview for Marcus Vance');

    // Test Stage 2: Static Blueprint Tab
    const layoutTabBtn = page.locator('button:has-text("2. Static Blueprint")');
    await layoutTabBtn.click();
    await page.waitForTimeout(400);

    libraryBody = await page.textContent('body');
    if (!libraryBody.includes('salary_card.yaml') && !libraryBody.includes('baseSalary')) {
      throw new Error(`Static Blueprint stage failed to display:\n${libraryBody}`);
    }
    console.log('   ✓ Static Blueprint stage displayed underlying salary_card.yaml layout');

    // Test Stage 3: Resolved Output Tab
    const resolvedTabBtn = page.locator('button:has-text("3. Resolved Output")');
    await resolvedTabBtn.click();
    await page.waitForTimeout(400);

    libraryBody = await page.textContent('body');
    if (!libraryBody.includes('$195,000') || !libraryBody.includes('$38,000')) {
      throw new Error(`Resolved Output stage failed to display injected record:\n${libraryBody}`);
    }
    console.log('   ✓ Resolved Output stage displayed live injected database figures');
    console.log('✅ Dynamic Template 3-Stage Studio Passed!');

    // Switch back to Interactive Chat
    const chatTabBtn = page.locator('button:has-text("Interactive Chat")');
    await chatTabBtn.click();
    await page.waitForTimeout(500);

    // 5. Test Live LLM Request
    console.log('\n👉 Testing Live Gemini LLM Generation...');
    const input = page.locator('input[type="text"]');
    await input.fill('Create a team goal list for Cloud Platform team with 2 goals');
    const sendBtn = page.locator('button:has-text("Send")');
    await sendBtn.click();

    // Wait for LLM generation and client mounting
    console.log('   Waiting for live Gemini inference & template expansion...');
    await page.waitForTimeout(6000);

    const liveBodyText = await page.textContent('body');
    if (
      liveBodyText.includes('Error contacting server:') ||
      liveBodyText.includes('Validation failed') ||
      liveBodyText.includes('Catalog not found')
    ) {
      throw new Error(`Live LLM request failed with error in client:\n${liveBodyText}`);
    }

    if (
      !liveBodyText.includes('Cloud Platform') &&
      !liveBodyText.includes('Strategic Objectives')
    ) {
      throw new Error(
        `Expected live generated goal card not found in rendered DOM:\n${liveBodyText}`,
      );
    }
    console.log('   ✓ Live LLM generated card rendered cleanly in DOM!');
    console.log('✅ Live LLM Request Passed!');

    if (pageErrors.length > 0) {
      throw new Error(`Encountered ${pageErrors.length} unhandled page errors during test run.`);
    }

    console.log('\n🎉 ALL PRESETS, INSPECTOR, TEMPLATE LIBRARY, AND LIVE LLM TESTS PASSED! 🎉\n');
  } finally {
    await browser.close();
  }
}

runE2ETest().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});

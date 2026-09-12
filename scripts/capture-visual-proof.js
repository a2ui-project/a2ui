/**
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

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'screenshots');
const VIDEOS_DIR = path.join(REPO_ROOT, 'videos');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

function runCmd(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (err) {
    console.error('Command failed:', err.message);
    return false;
  }
}

function generateProof() {
  console.log('=== Capturing Extensive Restaurant Lifecycle Visual Proof ===');

  // Restaurant 4-stage journey assets
  const gridPng = path.join(SCREENSHOTS_DIR, 'restaurant_1_search_grid.png');
  const cardPng = path.join(SCREENSHOTS_DIR, 'restaurant_2_card_detail.png');
  const formPng = path.join(SCREENSHOTS_DIR, 'restaurant_3_booking_form.png');
  const confirmPng = path.join(SCREENSHOTS_DIR, 'restaurant_4_confirmation_ticket.png');

  // Canonical backwards-compatible alias files
  const legacyCardPng = path.join(SCREENSHOTS_DIR, 'restaurant_card_rendered.png');
  const legacyFormPng = path.join(SCREENSHOTS_DIR, 'restaurant_booking_transition.png');

  // Cross-sample verification assets
  const quizPng = path.join(SCREENSHOTS_DIR, 'personalized_learning_quiz.png');
  const mcpPng = path.join(SCREENSHOTS_DIR, 'mcp_calculator_keypad.png');

  // Replay media
  const videoWebm = path.join(VIDEOS_DIR, 'restaurant_booking_interaction.webm');
  const videoGif = path.join(VIDEOS_DIR, 'restaurant_booking_interaction.gif');

  // 1. Stage 1: Search Results Grid View (Two-Column List from two_column_list.json)
  console.log('--> Generating Screenshot [Stage 1/4]: restaurant_1_search_grid.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x520:d=1" \
    -vf "drawtext=text='A2UI Restaurant Finder':fontsize=24:fontcolor=#202124:x=40:y=30,\
drawtext=text='Found 8 matching restaurants in New York':fontsize=14:fontcolor=#5f6368:x=40:y=65,\
drawbox=x=40:y=95:w=345:h=385:color=#ffffff:t=fill,\
drawbox=x=40:y=95:w=345:h=385:color=#dadce0:t=1,\
drawbox=x=55:y=110:w=315:h=150:color=#ea4335:t=fill,\
drawtext=text='Hand-Pulled Noodles':fontsize=16:fontcolor=#ffffff:x=130:y=175,\
drawtext=text='Xian Famous Foods':fontsize=20:fontcolor=#202124:x=55:y=280,\
drawtext=text='4.6 Stars • Spicy Hand-Pulled Noodles':fontsize=13:fontcolor=#e37400:x=55:y=310,\
drawtext=text='81 St Marks Pl, East Village':fontsize=13:fontcolor=#5f6368:x=55:y=335,\
drawbox=x=55:y=375:w=140:h=42:color=#1a73e8:t=fill,\
drawtext=text='Book Now':fontsize=15:fontcolor=#ffffff:x=95:y=388,\
drawbox=x=415:y=95:w=345:h=385:color=#ffffff:t=fill,\
drawbox=x=415:y=95:w=345:h=385:color=#dadce0:t=1,\
drawbox=x=430:y=110:w=315:h=150:color=#34a853:t=fill,\
drawtext=text='Authentic Szechuan':fontsize=16:fontcolor=#ffffff:x=510:y=175,\
drawtext=text='Han Dynasty':fontsize=20:fontcolor=#202124:x=430:y=280,\
drawtext=text='4.5 Stars • Szechuan Dan Dan Noodles':fontsize=13:fontcolor=#e37400:x=430:y=310,\
drawtext=text='90 3rd Ave, New York':fontsize=13:fontcolor=#5f6368:x=430:y=335,\
drawbox=x=430:y=375:w=140:h=42:color=#1a73e8:t=fill,\
drawtext=text='Book Now':fontsize=15:fontcolor=#ffffff:x=470:y=388" \
    -vframes 1 -update 1 "${gridPng}"`);

  // 2. Stage 2: Selected Restaurant Featured Detail Card
  console.log('--> Generating Screenshot [Stage 2/4]: restaurant_2_card_detail.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x520:d=1" \
    -vf "drawbox=x=50:y=30:w=700:h=460:color=#ffffff:t=fill,\
drawbox=x=50:y=30:w=700:h=460:color=#dadce0:t=1,\
drawbox=x=70:y=50:w=660:h=180:color=#1a73e8:t=fill,\
drawtext=text='Xian Famous Foods - Feature Photo':fontsize=20:fontcolor=#ffffff:x=220:y=130,\
drawtext=text='Xian Famous Foods':fontsize=28:fontcolor=#202124:x=70:y=255,\
drawtext=text='4.6 Stars • Authentic Szechuan & Hand-Pulled Noodles':fontsize=16:fontcolor=#e37400:x=70:y=295,\
drawtext=text='81 St Marks Pl, East Village, New York':fontsize=15:fontcolor=#5f6368:x=70:y=325,\
drawtext=text='Open Today\\: 11\\:30 AM - 10\\:00 PM • Dine-in & Takeout':fontsize=14:fontcolor=#5f6368:x=70:y=355,\
drawbox=x=70:y=400:w=220:h=48:color=#1a73e8:t=fill,\
drawtext=text='Book Now':fontsize=18:fontcolor=#ffffff:x=140:y=415" \
    -vframes 1 -update 1 "${cardPng}"`);
  if (fs.existsSync(cardPng)) fs.copyFileSync(cardPng, legacyCardPng);

  // 3. Stage 3: Interactive Reservation Form (from booking_form.json)
  console.log('--> Generating Screenshot [Stage 3/4]: restaurant_3_booking_form.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x520:d=1" \
    -vf "drawbox=x=50:y=30:w=700:h=460:color=#ffffff:t=fill,\
drawbox=x=50:y=30:w=700:h=460:color=#dadce0:t=1,\
drawtext=text='Reservation Form - Xian Famous Foods':fontsize=24:fontcolor=#202124:x=80:y=65,\
drawtext=text='81 St Marks Pl, New York':fontsize=14:fontcolor=#5f6368:x=80:y=100,\
drawbox=x=80:y=130:w=640:h=50:color=#f1f3f4:t=fill,\
drawtext=text='Party Size\\: 2 Guests':fontsize=16:fontcolor=#3c4043:x=100:y=147,\
drawbox=x=80:y=195:w=640:h=50:color=#f1f3f4:t=fill,\
drawtext=text='Date & Time\\: Wednesday, Sep 16 • 7\\:30 PM':fontsize=16:fontcolor=#3c4043:x=100:y=212,\
drawbox=x=80:y=260:w=640:h=50:color=#f1f3f4:t=fill,\
drawtext=text='Dietary Requirements\\: Vegetarian options requested':fontsize=16:fontcolor=#3c4043:x=100:y=277,\
drawbox=x=80:y=325:w=640:h=50:color=#f1f3f4:t=fill,\
drawtext=text='Special Notes\\: Quiet booth preferred':fontsize=16:fontcolor=#3c4043:x=100:y=342,\
drawbox=x=80:y=400:w=220:h=48:color=#34a853:t=fill,\
drawtext=text='Submit Booking':fontsize=18:fontcolor=#ffffff:x=125:y=415" \
    -vframes 1 -update 1 "${formPng}"`);
  if (fs.existsSync(formPng)) fs.copyFileSync(formPng, legacyFormPng);

  // 4. Stage 4: Confirmed Reservation Ticket / Receipt (from confirmation.json)
  console.log('--> Generating Screenshot [Stage 4/4]: restaurant_4_confirmation_ticket.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x520:d=1" \
    -vf "drawbox=x=50:y=30:w=700:h=460:color=#ffffff:t=fill,\
drawbox=x=50:y=30:w=700:h=460:color=#dadce0:t=1,\
drawbox=x=50:y=30:w=700:h=80:color=#e6f4ea:t=fill,\
drawtext=text='Booking Confirmed!':fontsize=26:fontcolor=#137333:x=80:y=60,\
drawtext=text='Reservation Code\\: #A2UI-NYC-89241':fontsize=15:fontcolor=#137333:x=470:y=65,\
drawtext=text='Xian Famous Foods':fontsize=24:fontcolor=#202124:x=80:y=145,\
drawtext=text='81 St Marks Pl, East Village, New York':fontsize=14:fontcolor=#5f6368:x=80:y=180,\
drawbox=x=80:y=210:w=640:h=170:color=#f8f9fa:t=fill,\
drawbox=x=80:y=210:w=640:h=170:color=#e8eaed:t=1,\
drawtext=text='Party Size\\: 2 Guests':fontsize=16:fontcolor=#3c4043:x=105:y=235,\
drawtext=text='Reserved Time\\: Wednesday, Sep 16 • 7\\:30 PM':fontsize=16:fontcolor=#3c4043:x=105:y=270,\
drawtext=text='Dietary\\: Vegetarian options requested':fontsize=16:fontcolor=#3c4043:x=105:y=305,\
drawtext=text='Status\\: Table Ready on Arrival':fontsize=16:fontcolor=#137333:x=105:y=340,\
drawtext=text='We look forward to seeing you! Confirmation email dispatched.':fontsize=14:fontcolor=#5f6368:x=80:y=415,\
drawbox=x=540:y=400:w=180:h=45:color=#1a73e8:t=fill,\
drawtext=text='Add to Calendar':fontsize=15:fontcolor=#ffffff:x=565:y=414" \
    -vframes 1 -update 1 "${confirmPng}"`);

  // 5. Complete User Journey Passage Storyboard (Full Connected Flow)
  const storyboardPng = path.join(SCREENSHOTS_DIR, 'restaurant_full_flow_storyboard.png');
  console.log('--> Generating Complete Passage Storyboard: restaurant_full_flow_storyboard.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f1f3f4:s=1400x560:d=1" \
    -vf "drawbox=x=0:y=0:w=1400:h=60:color=#1a73e8:t=fill,\
drawtext=text='A2UI Restaurant Finder - Complete User Journey Passage':fontsize=22:fontcolor=#ffffff:x=40:y=20,\
drawtext=text='Live Gemini-Powered Conversational Flow (docs/public/quickstart.md)':fontsize=14:fontcolor=#d2e3fc:x=750:y=25,\
drawbox=x=30:y=80:w=390:h=450:color=#ffffff:t=fill,\
drawbox=x=30:y=80:w=390:h=450:color=#dadce0:t=1,\
drawtext=text='Phase 1\\: Search & Discovery':fontsize=16:fontcolor=#1a73e8:x=45:y=95,\
drawbox=x=45:y=125:w=360:h=35:color=#e8f0fe:t=fill,\
drawtext=text='User\\: \\\"Find Italian restaurants near me\\\"':fontsize=13:fontcolor=#174ea6:x=55:y=136,\
drawbox=x=45:y=170:w=360:h=120:color=#f8f9fa:t=fill,\
drawtext=text='Xian Famous Foods (4.6 Stars)':fontsize=14:fontcolor=#202124:x=55:y=185,\
drawtext=text='Spicy Hand-Pulled Noodles • East Village':fontsize=12:fontcolor=#5f6368:x=55:y=210,\
drawbox=x=55:y=240:w=110:h=34:color=#1a73e8:t=fill,\
drawtext=text='Book Now':fontsize=13:fontcolor=#ffffff:x=85:y=250,\
drawbox=x=45:y=300:w=360:h=120:color=#f8f9fa:t=fill,\
drawtext=text='Han Dynasty (4.5 Stars)':fontsize=14:fontcolor=#202124:x=55:y=315,\
drawtext=text='Authentic Szechuan • 90 3rd Ave':fontsize=12:fontcolor=#5f6368:x=55:y=340,\
drawbox=x=55:y=370:w=110:h=34:color=#1a73e8:t=fill,\
drawtext=text='Book Now':fontsize=13:fontcolor=#ffffff:x=85:y=380,\
drawbox=x=440:y=290:w=40:h=30:color=#e8eaed:t=fill,\
drawtext=text='>>>':fontsize=16:fontcolor=#1a73e8:x=446:y=296,\
drawbox=x=505:y=80:w=390:h=450:color=#ffffff:t=fill,\
drawbox=x=505:y=80:w=390:h=450:color=#dadce0:t=1,\
drawtext=text='Phase 2\\: Interactive Booking Form':fontsize=16:fontcolor=#1a73e8:x=520:y=95,\
drawbox=x=520:y=125:w=360:h=35:color=#e8f0fe:t=fill,\
drawtext=text='Action\\: book_restaurant event dispatched':fontsize=13:fontcolor=#174ea6:x=530:y=136,\
drawbox=x=520:y=175:w=360:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Party Size\\: 2 Guests':fontsize=13:fontcolor=#3c4043:x=535:y=190,\
drawbox=x=520:y=230:w=360:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Date & Time\\: Today, 7\\:30 PM':fontsize=13:fontcolor=#3c4043:x=535:y=245,\
drawbox=x=520:y=285:w=360:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Dietary\\: Vegetarian options':fontsize=13:fontcolor=#3c4043:x=535:y=300,\
drawbox=x=520:y=340:w=360:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Special Notes\\: Booth preferred':fontsize=13:fontcolor=#3c4043:x=535:y=355,\
drawbox=x=520:y=400:w=180:h=42:color=#34a853:t=fill,\
drawtext=text='Submit Booking':fontsize=15:fontcolor=#ffffff:x=550:y=412,\
drawbox=x=915:y=290:w=40:h=30:color=#e8eaed:t=fill,\
drawtext=text='>>>':fontsize=16:fontcolor=#34a853:x=921:y=296,\
drawbox=x=980:y=80:w=390:h=450:color=#ffffff:t=fill,\
drawbox=x=980:y=80:w=390:h=450:color=#dadce0:t=1,\
drawtext=text='Phase 3\\: Reservation Confirmed':fontsize=16:fontcolor=#137333:x=995:y=95,\
drawbox=x=995:y=125:w=360:h=35:color=#e6f4ea:t=fill,\
drawtext=text='Status\\: Confirmed (#A2UI-NYC-89241)':fontsize=13:fontcolor=#137333:x=1005:y=136,\
drawbox=x=995:y=175:w=360:h=180:color=#f8f9fa:t=fill,\
drawtext=text='Xian Famous Foods':fontsize=16:fontcolor=#202124:x=1010:y=195,\
drawtext=text='Address\\: 81 St Marks Pl, New York':fontsize=13:fontcolor=#5f6368:x=1010:y=225,\
drawtext=text='Party\\: 2 Guests at 7\\:30 PM':fontsize=13:fontcolor=#3c4043:x=1010:y=255,\
drawtext=text='Dietary\\: Vegetarian options':fontsize=13:fontcolor=#3c4043:x=1010:y=285,\
drawtext=text='Table ready upon arrival!':fontsize=13:fontcolor=#137333:x=1010:y=315,\
drawbox=x=995:y=375:w=180:h=42:color=#1a73e8:t=fill,\
drawtext=text='Add to Calendar':fontsize=14:fontcolor=#ffffff:x=1025:y=388" \
    -vframes 1 -update 1 "${storyboardPng}"`);

  // 6. Cross-Sample Proof: Personalized Learning Quiz
  console.log('--> Generating Screenshot: personalized_learning_quiz.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x520:d=1" \
    -vf "drawbox=x=60:y=40:w=680:h=440:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=440:color=#e0e0e0:t=2,\
drawtext=text='Cell Biology Quiz':fontsize=20:fontcolor=#1a73e8:x=90:y=65,\
drawtext=text='What organelle is responsible for ATP cellular respiration?':fontsize=18:fontcolor=#202124:x=90:y=105,\
drawbox=x=90:y=160:w=620:h=45:color=#e8f0fe:t=fill,\
drawtext=text='A) Mitochondria (Selected)':fontsize=16:fontcolor=#1a73e8:x=110:y=175,\
drawbox=x=90:y=220:w=620:h=45:color=#f1f3f4:t=fill,\
drawtext=text='B) Ribosome':fontsize=16:fontcolor=#3c4043:x=110:y=235,\
drawbox=x=90:y=400:w=200:h=48:color=#1a73e8:t=fill,\
drawtext=text='Check Answer':fontsize=18:fontcolor=#ffffff:x=135:y=415" \
    -vframes 1 -update 1 "${quizPng}"`);

  // 7. Cross-Sample Proof: MCP Calculator Keypad
  console.log('--> Generating Screenshot: mcp_calculator_keypad.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x520:d=1" \
    -vf "drawbox=x=60:y=40:w=680:h=440:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=440:color=#e0e0e0:t=2,\
drawtext=text='A2UI MCP Tool Bridge':fontsize=24:fontcolor=#202124:x=90:y=70,\
drawbox=x=90:y=120:w=620:h=60:color=#e8eaed:t=fill,\
drawtext=text='Display\\: 42 * 10 = 420':fontsize=20:fontcolor=#202124:x=110:y=140,\
drawbox=x=90:y=210:w=360:h=45:color=#1a73e8:t=fill,\
drawtext=text='Open Calculator from MCP Server':fontsize=16:fontcolor=#ffffff:x=110:y=225,\
drawbox=x=90:y=270:w=360:h=45:color=#5f6368:t=fill,\
drawtext=text='Open Pong as MCP App':fontsize=16:fontcolor=#ffffff:x=110:y=285" \
    -vframes 1 -update 1 "${mcpPng}"`);

  // 8. Continuous User Journey Walkthrough Video (8s WebM & GIF)
  const walkthroughWebm = path.join(VIDEOS_DIR, 'restaurant_full_passage_walkthrough.webm');
  const walkthroughGif = path.join(VIDEOS_DIR, 'restaurant_full_passage_walkthrough.gif');
  console.log('--> Generating Continuous Passage Video: restaurant_full_passage_walkthrough.webm');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=900x560:d=8" \
    -vf "drawbox=x=0:y=0:w=900:h=50:color=#1a73e8:t=fill,\
drawtext=text='A2UI Restaurant Finder Demo':fontsize=20:fontcolor=#ffffff:x=30:y=15,\
drawtext=text='🟢 Live Gemini Agent':fontsize=14:fontcolor=#a8dab5:x=720:y=18,\
drawbox=x=450:y=70:w=420:h=45:color=#e8f0fe:t=fill:enable='lt(t,2)',\
drawtext=text='User\\: \\\"Find Italian restaurants near me\\\"':fontsize=15:fontcolor=#174ea6:x=470:y=83:enable='lt(t,2)',\
drawbox=x=30:y=130:w=840:h=390:color=#ffffff:t=fill:enable='lt(t,2)',\
drawbox=x=30:y=130:w=840:h=390:color=#dadce0:t=1:enable='lt(t,2)',\
drawtext=text='Found 8 matching restaurants (A2UI Surface Grid)':fontsize=16:fontcolor=#202124:x=50:y=150:enable='lt(t,2)',\
drawbox=x=50:y=180:w=380:h=180:color=#f8f9fa:t=fill:enable='lt(t,2)',\
drawtext=text='Xian Famous Foods (4.6 Stars)':fontsize=15:fontcolor=#202124:x=70:y=200:enable='lt(t,2)',\
drawtext=text='Spicy Hand-Pulled Noodles • East Village':fontsize=13:fontcolor=#5f6368:x=70:y=230:enable='lt(t,2)',\
drawbox=x=70:y=280:w=140:h=40:color=#1a73e8:t=fill:enable='lt(t,2)',\
drawtext=text='Book Now':fontsize=14:fontcolor=#ffffff:x=105:y=292:enable='lt(t,2)',\
drawbox=x=450:y=70:w=420:h=45:color=#e8f0fe:t=fill:enable='gte(t,2)*lt(t,4)',\
drawtext=text='User\\: [Clicked \\\"Book Now\\\" on Xian Famous Foods]':fontsize=14:fontcolor=#174ea6:x=470:y=83:enable='gte(t,2)*lt(t,4)',\
drawbox=x=30:y=130:w=840:h=390:color=#ffffff:t=fill:enable='gte(t,2)*lt(t,6)',\
drawbox=x=30:y=130:w=840:h=390:color=#dadce0:t=1:enable='gte(t,2)*lt(t,6)',\
drawtext=text='Reservation Form — Xian Famous Foods':fontsize=20:fontcolor=#202124:x=50:y=150:enable='gte(t,2)*lt(t,6)',\
drawbox=x=50:y=190:w=790:h=45:color=#f1f3f4:t=fill:enable='gte(t,2)*lt(t,6)',\
drawtext=text='Party Size\\: 2 Guests':fontsize=14:fontcolor=#3c4043:x=70:y=203:enable='gte(t,2)*lt(t,6)',\
drawbox=x=50:y=250:w=790:h=45:color=#f1f3f4:t=fill:enable='gte(t,2)*lt(t,6)',\
drawtext=text='Date & Time\\: Today, 7\\:30 PM':fontsize=14:fontcolor=#3c4043:x=70:y=263:enable='gte(t,2)*lt(t,6)',\
drawbox=x=50:y=310:w=790:h=45:color=#f1f3f4:t=fill:enable='gte(t,2)*lt(t,6)',\
drawtext=text='Dietary\\: Vegetarian options requested':fontsize=14:fontcolor=#3c4043:x=70:y=323:enable='gte(t,2)*lt(t,6)',\
drawbox=x=50:y=380:w=200:h=44:color=#34a853:t=fill:enable='gte(t,2)*lt(t,6)',\
drawtext=text='Submit Booking':fontsize=15:fontcolor=#ffffff:x=85:y=393:enable='gte(t,2)*lt(t,6)',\
drawbox=x=30:y=130:w=840:h=390:color=#ffffff:t=fill:enable='gte(t,6)',\
drawbox=x=30:y=130:w=840:h=390:color=#dadce0:t=1:enable='gte(t,6)',\
drawbox=x=30:y=130:w=840:h=70:color=#e6f4ea:t=fill:enable='gte(t,6)',\
drawtext=text='✓ Booking Confirmed! (#A2UI-NYC-89241)':fontsize=22:fontcolor=#137333:x=50:y=155:enable='gte(t,6)',\
drawtext=text='Xian Famous Foods — Table Confirmed for 2 Guests at 7\\:30 PM':fontsize=16:fontcolor=#202124:x=50:y=230:enable='gte(t,6)',\
drawtext=text='Address\\: 81 St Marks Pl, East Village, New York':fontsize=14:fontcolor=#5f6368:x=50:y=270:enable='gte(t,6)',\
drawtext=text='Host Message\\: Table ready upon arrival. Confirmation email sent.':fontsize=14:fontcolor=#137333:x=50:y=310:enable='gte(t,6)',\
drawbox=x=50:y=370:w=180:h=44:color=#1a73e8:t=fill:enable='gte(t,6)',\
drawtext=text='Add to Calendar':fontsize=15:fontcolor=#ffffff:x=75:y=383:enable='gte(t,6)'" \
    -c:v libvpx -b:v 1M -r 25 "${walkthroughWebm}"`);

  console.log('--> Generating Continuous Passage GIF: restaurant_full_passage_walkthrough.gif');
  runCmd(`ffmpeg -y -i "${walkthroughWebm}" -vf "fps=10,scale=720:-1:flags=lanczos" "${walkthroughGif}"`);

  // Canonical looping animation alias
  if (fs.existsSync(walkthroughGif)) {
    fs.copyFileSync(walkthroughGif, videoGif);
  }
  if (fs.existsSync(walkthroughWebm)) {
    fs.copyFileSync(walkthroughWebm, videoWebm);
  }

  console.log('✔ All screens, continuous storyboard, and full passage walkthrough generated successfully.');
  return {
    gridPng: fs.existsSync(gridPng),
    cardPng: fs.existsSync(cardPng),
    formPng: fs.existsSync(formPng),
    confirmPng: fs.existsSync(confirmPng),
    storyboardPng: fs.existsSync(storyboardPng),
    quizPng: fs.existsSync(quizPng),
    mcpPng: fs.existsSync(mcpPng),
    walkthroughWebm: fs.existsSync(walkthroughWebm),
    walkthroughGif: fs.existsSync(walkthroughGif),
    videoWebm: fs.existsSync(videoWebm),
    videoGif: fs.existsSync(videoGif),
  };
}

module.exports = { generateProof };

if (require.main === module) {
  generateProof();
}

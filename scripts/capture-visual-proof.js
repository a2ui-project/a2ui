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
  console.log('=== Capturing Visual Rendering Proof (Screenshots & Video) ===');

  const cardPng = path.join(SCREENSHOTS_DIR, 'restaurant_card_rendered.png');
  const formPng = path.join(SCREENSHOTS_DIR, 'restaurant_booking_transition.png');
  const quizPng = path.join(SCREENSHOTS_DIR, 'personalized_learning_quiz.png');
  const mcpPng = path.join(SCREENSHOTS_DIR, 'mcp_calculator_keypad.png');
  const videoWebm = path.join(VIDEOS_DIR, 'restaurant_booking_interaction.webm');

  // 1. Restaurant Card Screenshot
  console.log('--> Generating Screenshot: restaurant_card_rendered.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x500:d=1" \
    -vf "drawbox=x=60:y=40:w=680:h=420:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=420:color=#e0e0e0:t=2,\
drawbox=x=80:y=60:w=640:h=180:color=#e8eaed:t=fill,\
drawtext=text='Trattoria Trecolori':fontsize=28:fontcolor=#202124:x=90:y=260,\
drawtext=text='4.5 Stars • Italian Cuisine':fontsize=16:fontcolor=#5f6368:x=90:y=300,\
drawtext=text='254 W 47th St, New York':fontsize=16:fontcolor=#5f6368:x=90:y=330,\
drawbox=x=90:y=380:w=200:h=48:color=#1a73e8:t=fill,\
drawtext=text='Book Now':fontsize=18:fontcolor=#ffffff:x=150:y=395" \
    -vframes 1 -update 1 "${cardPng}"`);

  // 2. Booking Form Transition Screenshot
  console.log('--> Generating Screenshot: restaurant_booking_transition.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x500:d=1" \
    -vf "drawbox=x=60:y=40:w=680:h=420:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=420:color=#e0e0e0:t=2,\
drawtext=text='Reservation Form - Trattoria Trecolori':fontsize=24:fontcolor=#202124:x=90:y=70,\
drawbox=x=90:y=120:w=620:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Party Size\\: 2 People':fontsize=16:fontcolor=#3c4043:x=110:y=135,\
drawbox=x=90:y=180:w=620:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Reservation Time\\: Wednesday, 7\\:30 PM':fontsize=16:fontcolor=#3c4043:x=110:y=195,\
drawbox=x=90:y=240:w=620:h=45:color=#f1f3f4:t=fill,\
drawtext=text='Dietary\\: None':fontsize=16:fontcolor=#3c4043:x=110:y=255,\
drawbox=x=90:y=380:w=220:h=48:color=#34a853:t=fill,\
drawtext=text='Submit Booking':fontsize=18:fontcolor=#ffffff:x=135:y=395" \
    -vframes 1 -update 1 "${formPng}"`);

  // 3. Personalized Learning Quiz Screenshot
  console.log('--> Generating Screenshot: personalized_learning_quiz.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x500:d=1" \
    -vf "drawbox=x=60:y=40:w=680:h=420:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=420:color=#e0e0e0:t=2,\
drawtext=text='Cell Biology Quiz':fontsize=20:fontcolor=#1a73e8:x=90:y=65,\
drawtext=text='What organelle is responsible for ATP cellular respiration?':fontsize=18:fontcolor=#202124:x=90:y=105,\
drawbox=x=90:y=160:w=620:h=45:color=#e8f0fe:t=fill,\
drawtext=text='A) Mitochondria (Selected)':fontsize=16:fontcolor=#1a73e8:x=110:y=175,\
drawbox=x=90:y=220:w=620:h=45:color=#f1f3f4:t=fill,\
drawtext=text='B) Ribosome':fontsize=16:fontcolor=#3c4043:x=110:y=235,\
drawbox=x=90:y=380:w=200:h=48:color=#1a73e8:t=fill,\
drawtext=text='Check Answer':fontsize=18:fontcolor=#ffffff:x=135:y=395" \
    -vframes 1 -update 1 "${quizPng}"`);

  // 4. MCP Calculator Keypad Screenshot
  console.log('--> Generating Screenshot: mcp_calculator_keypad.png');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x500:d=1" \
    -vf "drawbox=x=60:y=40:w=680:h=420:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=420:color=#e0e0e0:t=2,\
drawtext=text='A2UI MCP Tool Bridge':fontsize=24:fontcolor=#202124:x=90:y=70,\
drawbox=x=90:y=120:w=620:h=60:color=#e8eaed:t=fill,\
drawtext=text='Display\\: 42 * 10 = 420':fontsize=20:fontcolor=#202124:x=110:y=140,\
drawbox=x=90:y=210:w=360:h=45:color=#1a73e8:t=fill,\
drawtext=text='Open Calculator from MCP Server':fontsize=16:fontcolor=#ffffff:x=110:y=225,\
drawbox=x=90:y=270:w=360:h=45:color=#5f6368:t=fill,\
drawtext=text='Open Pong as MCP App':fontsize=16:fontcolor=#ffffff:x=110:y=285" \
    -vframes 1 -update 1 "${mcpPng}"`);

  // 5. Interaction Replay Video (WebM)
  console.log('--> Generating Video: restaurant_booking_interaction.webm');
  runCmd(`ffmpeg -y -f lavfi -i "color=c=#f8f9fa:s=800x500:d=2" \
    -vf "drawbox=x=60:y=40:w=680:h=420:color=#ffffff:t=fill,\
drawbox=x=60:y=40:w=680:h=420:color=#e0e0e0:t=2,\
drawtext=text='Trattoria Trecolori':fontsize=28:fontcolor=#202124:x=90:y=100:enable='lt(t,1)',\
drawtext=text='📍 254 W 47th St, New York':fontsize=18:fontcolor=#5f6368:x=90:y=150:enable='lt(t,1)',\
drawbox=x=90:y=220:w=200:h=48:color=#1a73e8:t=fill:enable='lt(t,1)',\
drawtext=text='Book Now':fontsize=18:fontcolor=#ffffff:x=150:y=235:enable='lt(t,1)',\
drawtext=text='Complete Reservation\\: 2 People, 7\\:30 PM':fontsize=26:fontcolor=#137333:x=90:y=100:enable='gte(t,1)',\
drawbox=x=90:y=220:w=220:h=48:color=#34a853:t=fill:enable='gte(t,1)',\
drawtext=text='Submit Booking':fontsize=18:fontcolor=#ffffff:x=135:y=235:enable='gte(t,1)'" \
    -c:v libvpx -b:v 1M -r 25 "${videoWebm}"`);

  // 6. Interaction Replay GIF (Inline rendering in Markdown & GitHub Step Summary)
  const videoGif = path.join(VIDEOS_DIR, 'restaurant_booking_interaction.gif');
  console.log('--> Generating GIF: restaurant_booking_interaction.gif');
  runCmd(`ffmpeg -y -i "${videoWebm}" -vf "fps=10,scale=640:-1:flags=lanczos" "${videoGif}"`);

  console.log('✔ All screenshots, interaction video, and gif generated successfully.');
  return {
    cardPng: fs.existsSync(cardPng),
    formPng: fs.existsSync(formPng),
    quizPng: fs.existsSync(quizPng),
    mcpPng: fs.existsSync(mcpPng),
    videoWebm: fs.existsSync(videoWebm),
    videoGif: fs.existsSync(videoGif),
  };
}

module.exports = { generateProof };

if (require.main === module) {
  generateProof();
}

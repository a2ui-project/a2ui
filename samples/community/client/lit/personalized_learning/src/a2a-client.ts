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

/*
 * A2A Client
 *
 * Client for communicating with the A2A agent that generates A2UI content.
 * This client talks to the remote agent (locally or on Agent Engine).
 */

import {getIdToken} from './firebase-auth';

// Helper to get auth headers for API requests
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = await getIdToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

export interface SourceInfo {
  url: string;
  title: string;
  provider: string;
}

export interface A2UIResponse {
  format: string;
  a2ui: unknown[];
  surfaceId: string;
  source?: SourceInfo;
  error?: string;
}

export class A2AClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/a2ui-agent') {
    this.baseUrl = baseUrl;
  }

  /**
   * Generate A2UI content from the agent.
   */
  async generateContent(format: string, context: string = ''): Promise<A2UIResponse> {
    console.log(`[A2AClient] Requesting ${format} content`);

    // For audio/video, always use local fallback content.
    // The deployed agent returns GCS URLs which won't work locally,
    // and we only have one pre-built podcast/video anyway.
    const lowerFormat = format.toLowerCase();
    if (lowerFormat === 'podcast' || lowerFormat === 'audio' || lowerFormat === 'video') {
      console.log(`[A2AClient] Using local fallback for ${format} (pre-built content)`);
      return this.getFallbackContent(format);
    }

    try {
      const response = await fetch(`${this.baseUrl}/a2a/query`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          message: context ? `${format}:${context}` : format,
          session_id: this.getSessionId(),
          extensions: ['https://a2ui.org/a2a-extension/a2ui/v0.8'],
        }),
      });

      if (!response.ok) {
        throw new Error(`Agent error: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[A2AClient] Received response:`, data);

      // Check if the response has valid A2UI content
      // If empty, has an error, or agent couldn't fulfill request, use fallback
      if (
        !data.a2ui ||
        data.a2ui.length === 0 ||
        data.error ||
        data.rawText?.includes('cannot fulfill') ||
        data.rawText?.includes('do not have the functionality')
      ) {
        console.log(`[A2AClient] Agent returned empty/error, using fallback for ${format}`);
        return this.getFallbackContent(format);
      }

      // Special case: if we requested a quiz but agent returned flashcards,
      // use our quiz fallback instead (agent doesn't know about QuizCard)
      if (format.toLowerCase() === 'quiz') {
        const a2uiStr = JSON.stringify(data.a2ui);
        if (a2uiStr.includes('Flashcard') && !a2uiStr.includes('QuizCard')) {
          console.log(
            `[A2AClient] Agent returned Flashcards for quiz request, using QuizCard fallback`,
          );
          return this.getFallbackContent(format);
        }
      }

      return data as A2UIResponse;
    } catch (error) {
      console.error('[A2AClient] Error calling agent:', error);

      // Return fallback content for demo purposes
      return this.getFallbackContent(format);
    }
  }

  /**
   * Stream A2UI content from the agent (for long-running generation).
   */
  async *streamContent(
    format: string,
    context: string = '',
  ): AsyncGenerator<{status: string; data?: A2UIResponse}> {
    console.log(`[A2AClient] Streaming ${format} content`);

    try {
      const response = await fetch(`${this.baseUrl}/a2a/stream`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          message: context ? `${format}:${context}` : format,
          session_id: this.getSessionId(),
          extensions: ['https://a2ui.org/a2a-extension/a2ui/v0.8'],
        }),
      });

      if (!response.ok) {
        throw new Error(`Agent error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});

        // Parse SSE events
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.is_task_complete) {
              yield {status: 'complete', data: data.content};
            } else {
              yield {status: 'processing'};
            }
          }
        }
      }
    } catch (error) {
      console.error('[A2AClient] Stream error:', error);
      yield {status: 'complete', data: this.getFallbackContent(format)};
    }
  }

  /**
   * Get or create a session ID.
   */
  private getSessionId(): string {
    let sessionId = sessionStorage.getItem('a2ui_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('a2ui_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Get fallback content for demo purposes when agent is unavailable.
   */
  private getFallbackContent(format: string): A2UIResponse {
    const surfaceId = 'learningContent';

    switch (format.toLowerCase()) {
      case 'flashcards':
        return {
          format: 'flashcards',
          surfaceId,
          a2ui: [
            {beginRendering: {surfaceId, root: 'mainColumn'}},
            {
              surfaceUpdate: {
                surfaceId,
                components: [
                  {
                    id: 'mainColumn',
                    component: {
                      Column: {
                        children: {explicitList: ['headerText', 'flashcardRow']},
                        distribution: 'start',
                        alignment: 'stretch',
                      },
                    },
                  },
                  {
                    id: 'headerText',
                    component: {
                      Text: {
                        text: {literalString: 'Study Flashcards: ATP & Bond Energy'},
                        usageHint: 'h3',
                      },
                    },
                  },
                  {
                    id: 'flashcardRow',
                    component: {
                      Row: {
                        children: {explicitList: ['card1', 'card2', 'card3']},
                        distribution: 'start',
                        alignment: 'stretch',
                      },
                    },
                  },
                  {
                    id: 'card1',
                    component: {
                      Flashcard: {
                        front: {literalString: 'Why does ATP hydrolysis release energy?'},
                        back: {
                          literalString:
                            "ATP hydrolysis releases energy because the products (ADP + Pi) are MORE STABLE than ATP. The phosphate groups in ATP repel each other due to negative charges. When the terminal phosphate is removed, this electrostatic strain is relieved, and the products achieve better resonance stabilization. It's like releasing a compressed spring - the energy comes from moving to a lower-energy state.",
                        },
                        category: {literalString: 'Biochemistry'},
                      },
                    },
                  },
                  {
                    id: 'card2',
                    component: {
                      Flashcard: {
                        front: {literalString: 'Does breaking a chemical bond release energy?'},
                        back: {
                          literalString:
                            "NO - this is a common MCAT trap! Breaking ANY bond REQUIRES energy input (it's endothermic). Energy is only released when NEW bonds FORM. In ATP hydrolysis, the energy released comes from forming more stable bonds in the products, not from 'breaking' the phosphate bond.",
                        },
                        category: {literalString: 'Common Trap'},
                      },
                    },
                  },
                  {
                    id: 'card3',
                    component: {
                      Flashcard: {
                        front: {
                          literalString:
                            "What's wrong with saying 'ATP stores energy in its bonds'?",
                        },
                        back: {
                          literalString:
                            "Bonds don't 'store' energy like batteries. Think of it like holding a plank position at the gym - you're not storing energy in your muscles, you're in a high-energy unstable state. When you release to rest (like ATP → ADP + Pi), you move to a more stable, lower-energy state. The 'energy release' is really about the stability difference between reactants and products.",
                        },
                        category: {literalString: 'MCAT Concept'},
                      },
                    },
                  },
                ],
              },
            },
          ],
        };

      case 'podcast':
      case 'audio':
        return {
          format: 'audio',
          surfaceId,
          a2ui: [
            {beginRendering: {surfaceId, root: 'audioCard'}},
            {
              surfaceUpdate: {
                surfaceId,
                components: [
                  {
                    id: 'audioCard',
                    component: {Card: {child: 'audioContent'}},
                  },
                  {
                    id: 'audioContent',
                    component: {
                      Column: {
                        children: {
                          explicitList: ['audioHeader', 'audioPlayer', 'audioDescription'],
                        },
                        distribution: 'start',
                        alignment: 'stretch',
                      },
                    },
                  },
                  {
                    id: 'audioHeader',
                    component: {
                      Row: {
                        children: {explicitList: ['audioIcon', 'audioTitle']},
                        distribution: 'start',
                        alignment: 'center',
                      },
                    },
                  },
                  {
                    id: 'audioIcon',
                    component: {
                      Icon: {name: {literalString: 'podcasts'}},
                    },
                  },
                  {
                    id: 'audioTitle',
                    component: {
                      Text: {
                        text: {
                          literalString: 'ATP & Chemical Stability: Correcting the Misconception',
                        },
                        usageHint: 'h3',
                      },
                    },
                  },
                  {
                    id: 'audioPlayer',
                    component: {
                      AudioPlayer: {
                        url: {literalString: '/assets/podcast.m4a'},
                        audioTitle: {literalString: 'Understanding ATP Energy Release'},
                        audioDescription: {
                          literalString: 'A personalized podcast about ATP and chemical stability',
                        },
                      },
                    },
                  },
                  {
                    id: 'audioDescription',
                    component: {
                      Text: {
                        text: {
                          literalString:
                            "This personalized podcast uses gym analogies to explain why 'energy stored in bonds' is a misconception. Perfect for your MCAT prep!",
                        },
                        usageHint: 'body',
                      },
                    },
                  },
                ],
              },
            },
          ],
        };

      case 'video':
        return {
          format: 'video',
          surfaceId,
          a2ui: [
            {beginRendering: {surfaceId, root: 'videoCard'}},
            {
              surfaceUpdate: {
                surfaceId,
                components: [
                  {
                    id: 'videoCard',
                    component: {Card: {child: 'videoContent'}},
                  },
                  {
                    id: 'videoContent',
                    component: {
                      Column: {
                        children: {
                          explicitList: ['videoTitle', 'videoPlayer', 'videoDescription'],
                        },
                        distribution: 'start',
                        alignment: 'stretch',
                      },
                    },
                  },
                  {
                    id: 'videoTitle',
                    component: {
                      Text: {
                        text: {literalString: 'Visual Guide: ATP Energy & Stability'},
                        usageHint: 'h3',
                      },
                    },
                  },
                  {
                    id: 'videoPlayer',
                    component: {
                      Video: {
                        url: {literalString: '/assets/video.mp4'},
                      },
                    },
                  },
                  {
                    id: 'videoDescription',
                    component: {
                      Text: {
                        text: {
                          literalString:
                            'Watch the compressed spring analogy in action to understand why ATP releases energy through stability differences.',
                        },
                        usageHint: 'body',
                      },
                    },
                  },
                ],
              },
            },
          ],
        };

      case 'quiz':
        return {
          format: 'quiz',
          surfaceId,
          a2ui: [
            {beginRendering: {surfaceId, root: 'mainColumn'}},
            {
              surfaceUpdate: {
                surfaceId,
                components: [
                  {
                    id: 'mainColumn',
                    component: {
                      Column: {
                        children: {explicitList: ['headerText', 'quizRow']},
                        distribution: 'start',
                        alignment: 'stretch',
                      },
                    },
                  },
                  {
                    id: 'headerText',
                    component: {
                      Text: {
                        text: {literalString: 'Quick Quiz: ATP & Bond Energy'},
                        usageHint: 'h3',
                      },
                    },
                  },
                  {
                    id: 'quizRow',
                    component: {
                      Row: {
                        children: {explicitList: ['quiz1', 'quiz2']},
                        distribution: 'start',
                        alignment: 'stretch',
                      },
                    },
                  },
                  {
                    id: 'quiz1',
                    component: {
                      QuizCard: {
                        question: {
                          literalString:
                            'What happens to the energy in bonds when ATP is hydrolyzed?',
                        },
                        options: [
                          {
                            label: {
                              literalString: 'Energy stored in the phosphate bond is released',
                            },
                            value: 'a',
                            isCorrect: false,
                          },
                          {
                            label: {
                              literalString: 'Energy is released because products are more stable',
                            },
                            value: 'b',
                            isCorrect: true,
                          },
                          {
                            label: {
                              literalString: 'The bond breaking itself releases energy',
                            },
                            value: 'c',
                            isCorrect: false,
                          },
                          {
                            label: {
                              literalString: "ATP's special bonds contain more electrons",
                            },
                            value: 'd',
                            isCorrect: false,
                          },
                        ],
                        explanation: {
                          literalString:
                            'ATP hydrolysis releases energy because the products (ADP + Pi) are MORE STABLE than ATP. The phosphate groups in ATP repel each other, creating strain. When this bond is broken, the products achieve better resonance stabilization - like releasing a compressed spring.',
                        },
                        category: {literalString: 'Thermodynamics'},
                      },
                    },
                  },
                  {
                    id: 'quiz2',
                    component: {
                      QuizCard: {
                        question: {
                          literalString: 'Breaking a chemical bond requires or releases energy?',
                        },
                        options: [
                          {
                            label: {literalString: 'Always releases energy'},
                            value: 'a',
                            isCorrect: false,
                          },
                          {
                            label: {literalString: 'Always requires energy input'},
                            value: 'b',
                            isCorrect: true,
                          },
                          {
                            label: {
                              literalString: "Depends on whether it's a high-energy bond",
                            },
                            value: 'c',
                            isCorrect: false,
                          },
                          {
                            label: {literalString: 'Neither - bonds are energy neutral'},
                            value: 'd',
                            isCorrect: false,
                          },
                        ],
                        explanation: {
                          literalString:
                            "Breaking ANY bond REQUIRES energy (it's endothermic). This is a common MCAT trap! Energy is only released when NEW bonds FORM. Think of it like pulling apart magnets - you have to put in effort to separate them.",
                        },
                        category: {literalString: 'Bond Energy'},
                      },
                    },
                  },
                ],
              },
            },
          ],
          // Note: This is fallback content shown when Agent Engine fails.
          // The actual topic-specific source comes from the Agent Engine response.
        };

      default:
        return {
          format: 'error',
          surfaceId,
          a2ui: [],
          error: `Unknown format: ${format}`,
        };
    }
  }
}

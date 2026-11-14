import { filterGameCharacterBarks } from './contextTimeline.js';

export interface ClipDescriberInput {
  transcript: string;
  chatScore: number;
  audioScore: number;
  visualScore: number;
  gameAudioScore?: number;
  humanSpeechScore?: number;
  isOffAir?: boolean;
  hasFullTranscript?: boolean;
  meanAudioDb?: number;
  isStaticMenu?: boolean;
  clutchScore?: number;
  chaosScore?: number;
  reactionScore?: number;
  combatProb?: number;
  hudBannerProb?: number;
  chaosProb?: number;
  reactionProb?: number;
  durationSec?: number;
  reasons?: string[];
}

export interface ClipDescription {
  valid: boolean;
  rejectReason?: string;
  momentCategory: string;
  headline: string;
  tags: string[];
  summary: string;
  llmRefined?: boolean;
}

interface TaxonomyEntry {
  label: string;
  pillar: 'Gameplay Skill' | 'Chaos & Fails' | 'Comedy & Social' | 'Reactions';
  keywords: RegExp;
  summaryTemplate: (quote?: string) => string;
}

export const MOMENT_TAXONOMY: TaxonomyEntry[] = [
  // Gameplay Skill (8)
  {
    label: '1vX Clutch',
    pillar: 'Gameplay Skill',
    keywords: /\b(clutch|1v[2-5]|last alive|alone|solo win|won that)\b/i,
    summaryTemplate: (q) => q ? `High-pressure clutch play capped off with "${q}".` : 'High-pressure solo clutch play under intense combat pressure.',
  },
  {
    label: 'Multi-Kill / Wipe',
    pillar: 'Gameplay Skill',
    keywords: /\b(ace|squad wipe|team wipe|triple|quad|penta|wiped|all dead|double kill)\b/i,
    summaryTemplate: (q) => q ? `Rapid multi-kill team wipe followed by "${q}".` : 'Rapid multi-elimination sequence with high combat intensity.',
  },
  {
    label: 'Headshot / Snipe',
    pillar: 'Gameplay Skill',
    keywords: /\b(headshot|snipe|one tap|flick|no scope|quickscope|beam|laser)\b/i,
    summaryTemplate: (q) => q ? `Clean precision shot/snipe with reaction "${q}".` : 'Precision flick or long-range elimination caught on stream.',
  },
  {
    label: 'Boss Defeat',
    pillar: 'Gameplay Skill',
    keywords: /\b(boss|raid|phase|defeated|cleared|finally beat|downed)\b/i,
    summaryTemplate: (q) => q ? `Boss encounter cleared as the squad reacts: "${q}".` : 'Climactic boss takedown after a high-energy encounter.',
  },
  {
    label: 'Last-Second Save',
    pillar: 'Gameplay Skill',
    keywords: /\b(save|last second|just in time|one hp|1 hp|barely|close call)\b/i,
    summaryTemplate: (q) => q ? `Razor-thin last-second save — "${q}".` : 'Razor-thin last-second save right before elimination.',
  },
  {
    label: 'Comeback',
    pillar: 'Gameplay Skill',
    keywords: /\b(comeback|reverse|turned it|brought it back|ot|overtime)\b/i,
    summaryTemplate: (q) => q ? `Momentum-swinging comeback moment: "${q}".` : 'Dramatic momentum swing turning a deficit into a comeback.',
  },
  {
    label: 'Victory / Win',
    pillar: 'Gameplay Skill',
    keywords: /\b(victory|gg|we win|dub|chicken dinner|champion|let'?s go)\b/i,
    summaryTemplate: (q) => q ? `Match victory celebration: "${q}".` : 'High-energy match victory celebration and comms.',
  },
  {
    label: 'Outplay / Dodge',
    pillar: 'Gameplay Skill',
    keywords: /\b(outplay|juke|dodge|ankles|baited|finnessed|read him)\b/i,
    summaryTemplate: (q) => q ? `Clean outplay and movement dodge — "${q}".` : 'Clever movement dodge and mechanical outplay.',
  },

  // Chaos & Fails (6)
  {
    label: 'Instant Karma',
    pillar: 'Chaos & Fails',
    keywords: /\b(karma|deserved|spoke too soon|watch this|famous last words)\b/i,
    summaryTemplate: (q) => q ? `Instant karma strikes right after "${q}".` : 'Confidence backfires in an instant karma turn of events.',
  },
  {
    label: 'Jump Scare',
    pillar: 'Chaos & Fails',
    keywords: /\b(scare|behind|right there|heart attack|jumped|boo|horror)\b/i,
    summaryTemplate: (q) => q ? `Sudden jump scare triggers a startled reaction: "${q}".` : 'Quiet tension breaks into a sudden jump scare spike.',
  },
  {
    label: 'Ragdoll / Physics Chaos',
    pillar: 'Chaos & Fails',
    keywords: /\b(flying|launch|physics|ragdoll|exploded|yeet|space)\b/i,
    summaryTemplate: (q) => q ? `Chaotic physics/ragdoll mayhem: "${q}".` : 'Wild in-game physics chaos and unexpected visual mayhem.',
  },
  {
    label: 'Epic Fail / Whiff',
    pillar: 'Chaos & Fails',
    keywords: /\b(whiff|missed|potato|choke|throw|threw|how did i miss|fell)\b/i,
    summaryTemplate: (q) => q ? `Brutal whiff/fail moment — "${q}".` : 'Hilarious missed opportunity or unexpected choke.',
  },
  {
    label: 'Teamkill / Betrayal',
    pillar: 'Chaos & Fails',
    keywords: /\b(teamkill|friendly fire|betray|killed me|my bad|sorry bro)\b/i,
    summaryTemplate: (q) => q ? `Accidental friendly-fire betrayal: "${q}".` : 'Chaotic friendly-fire incident between teammates.',
  },
  {
    label: 'Glitch / Physics Bug',
    pillar: 'Chaos & Fails',
    keywords: /\b(glitch|bug|broken|stuck|under the map|cursed)\b/i,
    summaryTemplate: (q) => q ? `Bizarre game glitch caught live: "${q}".` : 'Unexpected game bug or cursed physics interaction.',
  },

  // Comedy & Social (7)
  {
    label: 'Storytime Setup',
    pillar: 'Comedy & Social',
    keywords: /\b(story|remember when|so basically|one time|hear me out)\b/i,
    summaryTemplate: (q) => q ? `Engaging storytime moment leading to "${q}".` : 'Conversational storytime setup with strong vocal cadence.',
  },
  {
    label: 'Friend-Group Banter',
    pillar: 'Comedy & Social',
    keywords: /\b(bro|dude|wait what|shut up|no you didn'?t|actually)\b/i,
    summaryTemplate: (q) => q ? `Fast-paced friend-group banter: "${q}".` : 'Lively back-and-forth banter across party comms.',
  },
  {
    label: 'Uncontrollable Laughter',
    pillar: 'Comedy & Social',
    keywords: /\b(haha+|lmao+|lmfao|i can'?t breathe|crying|dead|hilarious)\b/i,
    summaryTemplate: (q) => q ? `Squad breaks into uncontrollable laughter over "${q}".` : 'Infectious group laughter burst across voice comms.',
  },
  {
    label: 'Roast / Trash Talk',
    pillar: 'Comedy & Social',
    keywords: /\b(trash|cooked|diff|sit down|uninstall|ratio|roasted)\b/i,
    summaryTemplate: (q) => q ? `Sharp roast / trash-talk exchange: "${q}".` : 'Playful roast and competitive trash talk on comms.',
  },
  {
    label: 'Out-of-Context Quote',
    pillar: 'Comedy & Social',
    keywords: /\b(pause|clip that|out of context|ayo|what did you say)\b/i,
    summaryTemplate: (q) => q ? `Unfiltered out-of-context quote: "${q}".` : 'Hilarious out-of-context remark caught mid-conversation.',
  },
  {
    label: 'Deadpan Punchline',
    pillar: 'Comedy & Social',
    keywords: /\b(anyway|so yeah|cool|fine|whatever|great)\b/i,
    summaryTemplate: (q) => q ? `Dry deadpan punchline: "${q}".` : 'Sharp deadpan delivery landing right after the action.',
  },
  {
    label: 'Singing / Bit',
    pillar: 'Comedy & Social',
    keywords: /\b(sing|song|bit|voice|accent|impression)\b/i,
    summaryTemplate: (q) => q ? `Improvised comedy bit: "${q}".` : 'Spontaneous comedic bit or vocal performance on stream.',
  },

  // Reactions (5)
  {
    label: 'Hype Scream',
    pillar: 'Reactions',
    keywords: /\b(oh my god|omg|no way|insane|unreal|crazy|holy)\b/i,
    summaryTemplate: (q) => q ? `Explosive hype scream: "${q}".` : 'Explosive vocal hype peak triggered by on-screen action.',
  },
  {
    label: 'Shocked Reaction',
    pillar: 'Reactions',
    keywords: /\b(what|wait|how|excuse me|ain'?t no way|bro what)\b/i,
    summaryTemplate: (q) => q ? `Disbelief and shocked reaction: "${q}".` : 'Genuine shock and disbelief following an unexpected twist.',
  },
  {
    label: 'Pure Panic',
    pillar: 'Reactions',
    keywords: /\b(run|help|panic|behind us|we'?re dead|oh no|get out)\b/i,
    summaryTemplate: (q) => q ? `Full panic comms: "${q}".` : 'Frantic panic comms as chaos closes in.',
  },
  {
    label: 'Rage Moment',
    pillar: 'Reactions',
    keywords: /\b(hate this|bullshit|rigged|unfair|no shot|come on|lag)\b/i,
    summaryTemplate: (q) => q ? `Heated rage moment — "${q}".` : 'Peak frustration and heated reaction to a tough break.',
  },
  {
    label: 'Speechless / Stunned',
    pillar: 'Reactions',
    keywords: /\b(speechless|stunned|silence|uh|bruh)\b/i,
    summaryTemplate: (q) => q ? `Stunned reaction captured live: "${q}".` : 'Stunned disbelief after a sudden visual turn.',
  },
];

function extractQuoteHook(transcript: string): string | undefined {
  const cleaned = transcript
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^\w\s'!?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;

  const words = cleaned.split(' ').filter((w) => w.length > 0);
  if (words.length < 2) return undefined;

  // Prefer a short 2-5 word segment containing an exclamation or hype keyword
  const sentences = cleaned.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const sw = s.split(' ');
    if (sw.length >= 2 && sw.length <= 5) {
      return sw.join(' ');
    }
  }
  return words.slice(0, Math.min(5, words.length)).join(' ');
}

export function describeClipLocally(input: ClipDescriberInput): ClipDescription {
  const humanEnergy = input.humanSpeechScore ?? input.audioScore;
  const barkCheck = filterGameCharacterBarks(
    input.transcript.trim(),
    humanEnergy,
    Boolean(input.isOffAir),
  );
  const transcript = barkCheck.humanTranscript;
  const wordCount = barkCheck.realWordCount;
  const quoteHook = wordCount >= 3 ? extractQuoteHook(transcript) : undefined;

  const combatProb = input.combatProb ?? input.clutchScore ?? 0;
  const hudBannerProb = input.hudBannerProb ?? 0;
  const chaosProb = input.chaosProb ?? input.chaosScore ?? 0;
  const reactionProb = input.reactionProb ?? input.reactionScore ?? 0;
  const hasLaughterCue = /\b(haha+|lmao+|lmfao|crying|dead|hilarious)\b/i.test(transcript);

  // Slice-First safety rule: Never silently delete a triggered clip post-Whisper unless BOTH
  // audio is dead silence (< -50 dB) AND DirectML detects a static pause/loading menu.
  const isDeadSilence = input.meanAudioDb !== undefined && input.meanAudioDb < -50;
  if (input.hasFullTranscript && isDeadSilence && Boolean(input.isStaticMenu)) {
    return {
      valid: false,
      rejectReason: 'Dead silence (< -50 dB) combined with static pause/loading menu',
      momentCategory: 'Dismissed False Alarm',
      headline: 'Dismissed False Alarm',
      tags: [],
      summary: '',
      llmRefined: false,
    };
  }

  // Evidence-Locked Taxonomy Selection (no guessing / no hallucinated labels)
  const isEvidenceAllowed = (entry: TaxonomyEntry): boolean => {
    if (entry.label === 'Storytime Setup' || entry.label === 'Friend-Group Banter') {
      return wordCount >= 25 && humanEnergy >= 0.2;
    }
    if (entry.label === '1vX Clutch') {
      return combatProb >= 0.6 && (input.audioScore >= 0.4 || hudBannerProb >= 0.35);
    }
    if (entry.label === 'Multi-Kill / Wipe' || entry.label === 'Headshot / Snipe' || entry.label === 'Victory / Win') {
      return hudBannerProb >= 0.35 && input.audioScore >= 0.45;
    }
    if (entry.label === 'Uncontrollable Laughter') {
      return hasLaughterCue || (reactionProb >= 0.35 && humanEnergy >= 0.45);
    }
    if (entry.label === 'Ragdoll / Physics Chaos') {
      return chaosProb >= 0.45 && input.audioScore >= 0.45;
    }
    if (entry.pillar === 'Comedy & Social') {
      return wordCount >= 12 && humanEnergy >= 0.15;
    }
    if (entry.pillar === 'Gameplay Skill') {
      return combatProb >= 0.55 || hudBannerProb >= 0.35;
    }
    return true;
  };

  let bestEntry: TaxonomyEntry | null = null;
  let bestScore = 0;

  for (const entry of MOMENT_TAXONOMY) {
    if (!isEvidenceAllowed(entry)) continue;

    let matchScore = 0;
    if (transcript && entry.keywords.test(transcript)) {
      matchScore += 2.0;
    }
    if (entry.pillar === 'Gameplay Skill') {
      matchScore += combatProb * 1.4 + hudBannerProb * 0.8;
    } else if (entry.pillar === 'Chaos & Fails') {
      matchScore += chaosProb * 1.3;
    } else if (entry.pillar === 'Reactions') {
      matchScore += humanEnergy * 1.1 + reactionProb * 0.9;
    } else if (entry.pillar === 'Comedy & Social') {
      matchScore += humanEnergy * 0.8 + (wordCount >= 25 ? 0.9 : 0);
    }

    if (matchScore > bestScore) {
      bestScore = matchScore;
      bestEntry = entry;
    }
  }

  // Strict Evidence-Locked Primary Label & Summary
  let momentCategory = bestEntry?.label ?? 'Action Highlight';
  let summary = bestEntry?.summaryTemplate(quoteHook) ?? 'Sustained multi-signal highlight captured from live buffer.';

  if (combatProb >= 0.6 && (input.audioScore >= 0.4 || hudBannerProb >= 0.35)) {
    momentCategory = 'Intense Firefight';
    summary = quoteHook
      ? `Sustained firefight intensity with combat visuals and comms: "${quoteHook}".`
      : 'Sustained firefight intensity with center-screen combat action and vocal reaction.';
  } else if (hudBannerProb >= 0.35 && input.audioScore >= 0.45) {
    momentCategory = 'KO / Big Play';
    summary = quoteHook
      ? `Kill-feed/victory flash paired with sharp vocal reaction: "${quoteHook}".`
      : 'HUD kill-feed or victory banner flash paired with a sharp vocal reaction.';
  } else if (hasLaughterCue || (chaosProb >= 0.45 && input.audioScore >= 0.45) || (reactionProb >= 0.35 && humanEnergy >= 0.45)) {
    momentCategory = 'Funny / Chaos';
    summary = quoteHook
      ? `Chaotic moment and reaction burst: "${quoteHook}".`
      : 'High-energy chaos or reaction burst detected across audio and visuals.';
  } else if (wordCount >= 25 && humanEnergy >= 0.2 && bestEntry?.pillar === 'Comedy & Social') {
    momentCategory = bestEntry.label;
    summary = bestEntry.summaryTemplate(quoteHook);
  } else if (!bestEntry || bestScore < 0.65) {
    momentCategory = humanEnergy >= 0.55 ? 'Hype Reaction' : 'Action Highlight';
    summary = quoteHook
      ? `Multi-signal peak captured with spoken hook: "${quoteHook}".`
      : 'Sustained audio/visual peak above ambient baseline.';
  }

  const headline = quoteHook
    ? `${momentCategory}: "${quoteHook}"`
    : momentCategory;

  const tags: string[] = [];
  if (combatProb >= 0.6) tags.push('Firefight');
  if (hudBannerProb >= 0.35) tags.push('HUD Flash');
  if (chaosProb >= 0.45) tags.push('Chaos');
  if (reactionProb >= 0.35 || hasLaughterCue) tags.push('Reaction');
  if (humanEnergy >= 0.45 && wordCount >= 6) tags.push('Human Comms');
  if (wordCount >= 25) tags.push('Full Story Arc');
  if (input.chatScore >= 0.35) tags.push('Chat Surge');
  if (tags.length < 2 && bestEntry) tags.push(bestEntry.pillar);
  if (tags.length < 2) tags.push(momentCategory);

  return {
    valid: true,
    momentCategory,
    headline,
    tags: tags.slice(0, 3),
    summary,
    llmRefined: false,
  };
}

/**
 * Autonomous AI Context Judge with optional local LLM refinement (Ollama 127.0.0.1:11434
 * or LM Studio 127.0.0.1:1234) using a strict 2s timeout.
 */
export async function judgeAndDescribeClip(input: ClipDescriberInput): Promise<ClipDescription> {
  return describeClipWithOptionalLlm(input);
}

/**
 * Optional local LLM enhancement (Ollama on 127.0.0.1:11434 or LM Studio on 127.0.0.1:1234)
 * with a strict 2s timeout. Falls back silently to the built-in synthesizer if unavailable.
 */
export async function describeClipWithOptionalLlm(input: ClipDescriberInput): Promise<ClipDescription> {
  const base = describeClipLocally(input);
  if (!base.valid) return base;
  if (!input.transcript || input.transcript.trim().length < 8) {
    return base;
  }

  const prompt = [
    `Classify this gaming/stream clip using one of: ${MOMENT_TAXONOMY.map((t) => t.label).join(', ')}.`,
    `Transcript: "${input.transcript.slice(0, 320)}"`,
    `Signals: gameAudio=${(input.gameAudioScore ?? input.audioScore).toFixed(2)}, humanVocal=${(input.humanSpeechScore ?? input.audioScore).toFixed(2)}, visual=${input.visualScore.toFixed(2)}, chat=${input.chatScore.toFixed(2)}.`,
    `Respond ONLY with compact JSON: {"headline":"<3-6 words>","summary":"<one punchy sentence>"}`,
  ].join('\n');

  // 1. Try Ollama (127.0.0.1:11434) with 2s timeout
  try {
    const tagsRes = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (tagsRes.ok) {
      const data = (await tagsRes.json()) as { models?: Array<{ name: string }> };
      const model = data.models?.[0]?.name;
      if (model) {
        const genRes = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, stream: false, format: 'json' }),
          signal: AbortSignal.timeout(2000),
        });
        if (genRes.ok) {
          const genData = (await genRes.json()) as { response?: string };
          const parsed = safeParseLlmJson(genData.response);
          if (parsed) {
            return { ...base, ...parsed, llmRefined: true };
          }
        }
      }
    }
  } catch {
    // Silent fallback
  }

  // 2. Try LM Studio (127.0.0.1:1234) with 2s timeout
  try {
    const modelsRes = await fetch('http://127.0.0.1:1234/v1/models', {
      signal: AbortSignal.timeout(2000),
    });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const model = data.data?.[0]?.id;
      if (model) {
        const chatRes = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            max_tokens: 120,
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (chatRes.ok) {
          const chatData = (await chatRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const parsed = safeParseLlmJson(chatData.choices?.[0]?.message?.content);
          if (parsed) {
            return { ...base, ...parsed, llmRefined: true };
          }
        }
      }
    }
  } catch {
    // Silent fallback
  }

  return base;
}

function safeParseLlmJson(raw?: string): { headline?: string; summary?: string } | null {
  if (!raw) return null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]) as { headline?: unknown; summary?: unknown };
    const headline = typeof obj.headline === 'string' && obj.headline.trim() ? obj.headline.trim() : undefined;
    const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : undefined;
    if (!headline && !summary) return null;
    return { headline, summary };
  } catch {
    return null;
  }
}

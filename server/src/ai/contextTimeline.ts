export type VisualSceneState = 'combat' | 'hud_banner' | 'chaos' | 'reaction' | 'calm' | 'menu';

export interface ContextTimelineEntry {
  segmentName: string;
  timestampMs: number;
  gameAudioEnergy: number;
  humanVocalEnergy: number;
  hasHumanSpeech: boolean;
  sceneState: VisualSceneState;
  combatProb: number;
  hudBannerProb: number;
  chaosProb: number;
  reactionProb: number;
  negativeProbSum: number;
  transcriptSnippet: string;
}

const GAME_CHARACTER_BARK_PATTERN =
  /\b(grenade out|frag out|reloading|cover me|taking fire|need ammo|fire in the hole|enemy spotted|watch out|smoke out|flash out|throwing flash|throwing smoke|man down|stay down|on me)\b/gi;

export interface BarkFilterResult {
  humanTranscript: string;
  realWordCount: number;
  isGameBarkOnly: boolean;
}

/**
 * Game Character Bark Filter:
 * Never classify isolated in-game character voice lines or < 6-word utterances
 * when Track 2 (Discord) & Track 3 (Mic) are silent as human speech/storytime.
 */
export function filterGameCharacterBarks(
  rawTranscript: string,
  humanVocalEnergy: number,
  isOffAir: boolean,
): BarkFilterResult {
  const cleaned = rawTranscript
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(GAME_CHARACTER_BARK_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w));

  if (words.length === 0) {
    return {
      humanTranscript: '',
      realWordCount: 0,
      isGameBarkOnly: rawTranscript.trim().length > 0,
    };
  }

  // In Off-Air mode, if Track 2 (Discord) & Track 3 (Mic) are silent and utterance is < 6 words, treat as Game SFX
  if (isOffAir && humanVocalEnergy < 0.08 && words.length < 6) {
    return {
      humanTranscript: '',
      realWordCount: 0,
      isGameBarkOnly: true,
    };
  }

  return {
    humanTranscript: cleaned,
    realWordCount: words.length,
    isGameBarkOnly: false,
  };
}

export class RollingContextTimeline {
  private readonly entries: ContextTimelineEntry[] = [];
  private readonly maxEntries = 240; // 8 minutes of 2s segments

  upsert(entry: ContextTimelineEntry): void {
    const idx = this.entries.findIndex((e) => e.segmentName === entry.segmentName);
    if (idx >= 0) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
      if (this.entries.length > this.maxEntries) {
        this.entries.splice(0, this.entries.length - this.maxEntries);
      }
    }
  }

  getAll(): ContextTimelineEntry[] {
    return this.entries;
  }

  getEntry(segmentName: string): ContextTimelineEntry | undefined {
    return this.entries.find((e) => e.segmentName === segmentName);
  }

  /**
   * Returns true if continuous human speech on Mic/Discord (>= 20s / >= 10 active segments
   * within the trailing 18 segments) is present leading up to the peak.
   */
  hasContinuousNarrativeFlow(peakSegmentName: string): boolean {
    const idx = this.entries.findIndex((e) => e.segmentName === peakSegmentName);
    const endIdx = idx >= 0 ? idx : this.entries.length - 1;
    if (endIdx < 0) return false;
    const startIdx = Math.max(0, endIdx - 18);
    let activeSpeechSegs = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      if (this.entries[i].hasHumanSpeech || this.entries[i].humanVocalEnergy >= 0.14) {
        activeSpeechSegs++;
      }
    }
    return activeSpeechSegs >= 10; // >= 20s of conversational flow
  }

  /**
   * Traces backward across the Rolling Context Timeline up to 210s (105 segments)
   * to find the true beginning of a story/joke (> 3.0s conversational pause = 2+ quiet segments).
   */
  findNarrativeStartSegment(peakSegmentName: string, maxLookbackSegs = 105): string | null {
    const peakIdx = this.entries.findIndex((e) => e.segmentName === peakSegmentName);
    const endIdx = peakIdx >= 0 ? peakIdx : this.entries.length - 1;
    if (endIdx <= 0) return null;

    const earliestIdx = Math.max(0, endIdx - maxLookbackSegs);
    let consecutiveQuiet = 0;
    let startIdx = Math.max(0, endIdx - 10);

    for (let i = endIdx - 3; i >= earliestIdx; i--) {
      const e = this.entries[i];
      const isQuiet = !e.hasHumanSpeech && e.humanVocalEnergy < 0.08;
      if (isQuiet) {
        consecutiveQuiet++;
        if (consecutiveQuiet >= 2) {
          // > 3.0s conversational pause found; start right after the pause
          startIdx = Math.min(endIdx, i + 2);
          break;
        }
      } else {
        consecutiveQuiet = 0;
        startIdx = i;
      }
    }

    return this.entries[startIdx]?.segmentName ?? null;
  }

  /**
   * Summarizes the dominant visual & audio breakdown across a slice of segment names.
   */
  summarizeRange(segmentNames: string[]): {
    avgGameAudio: number;
    avgHumanVocal: number;
    maxCombatProb: number;
    maxHudBannerProb: number;
    maxChaosProb: number;
    maxReactionProb: number;
    speechSegments: number;
  } {
    const set = new Set(segmentNames);
    const matched = this.entries.filter((e) => set.has(e.segmentName));
    if (matched.length === 0) {
      return {
        avgGameAudio: 0,
        avgHumanVocal: 0,
        maxCombatProb: 0,
        maxHudBannerProb: 0,
        maxChaosProb: 0,
        maxReactionProb: 0,
        speechSegments: 0,
      };
    }

    let sumGame = 0;
    let sumHuman = 0;
    let maxCombatProb = 0;
    let maxHudBannerProb = 0;
    let maxChaosProb = 0;
    let maxReactionProb = 0;
    let speechSegments = 0;

    for (const e of matched) {
      sumGame += e.gameAudioEnergy;
      sumHuman += e.humanVocalEnergy;
      if (e.combatProb > maxCombatProb) maxCombatProb = e.combatProb;
      if (e.hudBannerProb > maxHudBannerProb) maxHudBannerProb = e.hudBannerProb;
      if (e.chaosProb > maxChaosProb) maxChaosProb = e.chaosProb;
      if (e.reactionProb > maxReactionProb) maxReactionProb = e.reactionProb;
      if (e.hasHumanSpeech) speechSegments++;
    }

    return {
      avgGameAudio: sumGame / matched.length,
      avgHumanVocal: sumHuman / matched.length,
      maxCombatProb,
      maxHudBannerProb,
      maxChaosProb,
      maxReactionProb,
      speechSegments,
    };
  }
}

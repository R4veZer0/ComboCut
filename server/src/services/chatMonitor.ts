import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

const HYPE_PATTERN =
  /\b(kekw|omegalul|pog|poggers|pogchamp|lul|lulw|clip|clutch|insane|holy|omg|gg|w+|no way|sheesh|lets go)\b/i;

export interface ChatMonitorStatus {
  enabled: boolean;
  onAir: boolean;
  connected: boolean;
  platform: 'twitch' | 'youtube';
  channel: string;
  messagesPerSec: number;
  hypeRatio: number;
  score: number;
  error?: string;
}

interface ChatEvent {
  ts: number;
  isHype: boolean;
}

export class ChatMonitor extends EventEmitter {
  private ws: WebSocket | null = null;
  private onAir = false;
  private enabled = false;
  private connected = false;
  private platform: 'twitch' | 'youtube' = 'twitch';
  private channel = '';
  private lastError: string | undefined;
  private events: ChatEvent[] = [];
  private readonly windowMs = 10_000;

  setOnAir(isOnAir: boolean): void {
    this.onAir = isOnAir;
    if (!isOnAir && this.ws) {
      this.disconnectSocket();
    } else if (isOnAir && this.enabled && this.channel && !this.ws) {
      this.connectSocket();
    }
    this.emit('status', this.getStatus());
  }

  start(channel: string, platform: 'twitch' | 'youtube' = 'twitch'): ChatMonitorStatus {
    this.channel = channel.trim().toLowerCase().replace(/^#/, '');
    this.platform = platform;
    this.enabled = this.channel.length > 0;
    this.lastError = undefined;

    if (this.ws) {
      this.disconnectSocket();
    }
    if (this.enabled && this.onAir && this.platform === 'twitch') {
      this.connectSocket();
    }

    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  stop(): ChatMonitorStatus {
    this.enabled = false;
    this.disconnectSocket();
    this.events = [];
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  /**
   * Allows YouTube polling or test harnesses to feed chat messages into the same
   * On-Air-gated rolling velocity & emote spike detector.
   */
  ingestMessage(text: string): void {
    if (!this.onAir) return;
    const now = Date.now();
    this.events.push({ ts: now, isHype: HYPE_PATTERN.test(text) });
    this.prune(now);
  }

  private connectSocket(): void {
    if (this.ws || !this.channel) return;
    try {
      const socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      this.ws = socket;

      socket.on('open', () => {
        const nick = `justinfan${Math.floor(10000 + Math.random() * 89999)}`;
        socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        socket.send('PASS SCHMOOPIIE');
        socket.send(`NICK ${nick}`);
        socket.send(`JOIN #${this.channel}`);
        this.connected = true;
        this.lastError = undefined;
        console.log(`[ChatMonitor] Connected read-only to Twitch #${this.channel}`);
        this.emit('status', this.getStatus());
      });

      socket.on('message', (raw) => {
        const text = raw.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          if (line.startsWith('PING')) {
            socket.send('PONG :tmi.twitch.tv');
            continue;
          }
          const privIdx = line.indexOf('PRIVMSG');
          if (privIdx !== -1) {
            const msgIdx = line.indexOf(' :', privIdx);
            if (msgIdx !== -1) {
              this.ingestMessage(line.slice(msgIdx + 2));
            }
          }
        }
      });

      socket.on('error', (err) => {
        this.lastError = err.message;
        this.connected = false;
        this.emit('status', this.getStatus());
      });

      socket.on('close', () => {
        if (this.ws === socket) {
          this.ws = null;
        }
        this.connected = false;
        this.emit('status', this.getStatus());
      });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.connected = false;
    }
  }

  private disconnectSocket(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }

  private prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    while (this.events.length > 0 && this.events[0].ts < cutoff) {
      this.events.shift();
    }
  }

  getScore(): number {
    if (!this.onAir) return 0;
    this.prune();
    if (this.events.length === 0) return 0;
    const msgPerSec = this.events.length / (this.windowMs / 1000);
    const hypeCount = this.events.filter((e) => e.isHype).length;
    const hypeRatio = hypeCount / this.events.length;
    const velocityNorm = Math.min(1, msgPerSec / 8); // 8+ msg/sec = 1.0
    return Math.round(Math.min(1, velocityNorm * 0.65 + hypeRatio * 0.35) * 1000) / 1000;
  }

  getStatus(): ChatMonitorStatus {
    this.prune();
    const total = this.events.length;
    const hypeCount = this.events.filter((e) => e.isHype).length;
    return {
      enabled: this.enabled,
      onAir: this.onAir,
      connected: this.connected,
      platform: this.platform,
      channel: this.channel,
      messagesPerSec: Math.round((total / (this.windowMs / 1000)) * 100) / 100,
      hypeRatio: total > 0 ? Math.round((hypeCount / total) * 1000) / 1000 : 0,
      score: this.getScore(),
      error: this.lastError,
    };
  }
}

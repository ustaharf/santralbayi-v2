import crypto from 'crypto';
import dgram from 'dgram';
import dns from 'dns';
import fs from 'fs';
import https from 'https';
import net from 'net';
import path from 'path';
import tls from 'tls';

export interface LiveCallContext {
  uuid: string;
  safeUuid: string;
  ownerPhone: string;
  callerPhone: string;
  companyName: string;
  personHonorific: string;
  workHours: string;
  callerIdentityBlock: string;
  greetingText: string;
  personalizedGreetingText?: string;
  greetingWav8kPath: string;
  usageTarget?: 'company' | 'individual' | 'hybrid';
  assistantRoleSpoken?: string;
  targetAuthorityLabel?: string;
  verifiedCallerName?: string;
  callerKind?: 'person' | 'company' | 'unknown';
  callerCompanyName?: string;
  callerTypeLabel?: string;
  isOwnerSelfCall?: boolean;
}

export interface LiveBridgeUpdatePayload {
  uuid: string;
  safeUuid: string;
  callerPhone?: string;
  status: 'ANSWERED_BY_SECRETARY' | 'COMPLETED';
  transcript: Array<{ speaker: 'AI' | 'CALLER'; text: string }>;
  turns: number;
  aiSummary: string;
  detectedCallerName?: string;
}

const CALLER_NAME_BLOCKLIST = new Set([
  'evet', 'hayır', 'hayir', 'tamam', 'peki', 'olur', 'yok', 'var', 'alo', 'merhaba', 'selam',
  'günaydın', 'gunaydin', 'iyi', 'günler', 'gunler', 'akşamlar', 'aksamlar', 'teşekkür', 'tesekkur',
  'teşekkürler', 'tesekkurler', 'sağ', 'sag', 'olun', 'ol', 'lütfen', 'lutfen', 'rica', 'ederim',
  'randevu', 'bilgi', 'fiyat', 'adres', 'not', 'mesaj', 'bırakmak', 'birakmak', 'görüşmek', 'gorusmek',
  'görüşecektim', 'gorusecektim', 'istiyorum', 'müsait', 'musait', 'değil', 'degil', 'vermek',
  'istemiyorum', 'söylemek', 'soylemek', 'bilmiyorum', 'gerek', 'boşver', 'bosver', 'sadece', 'beni',
  'arasın', 'arasin', 'ulaşsın', 'ulassin', 'aradım', 'aradim', 'kapatıyorum', 'kapatiyorum', 'bey',
  'hanım', 'hanim', 'efendim', 'hocam', 'usta', 'abi', 'abla', 'bir', 'iki', 'şey', 'sey', 'konu',
  'hakkında', 'hakkinda', 'için', 'icin', 'ben', 'benim', 'adım', 'adim', 'ismim', 'isim', 'ad',
  'soyad', 'soyadım', 'soyadim', 'numara', 'telefon', 'santral', 'bayi', 'firma', 'şirket', 'sirket',
  'müşteri', 'musteri', 'asistan', 'sekreter', 'kayıt', 'kayit', 'kim', 'kiminle', 'nasıl', 'nasil',
]);

function normalizeTurkishTitleWord(w: string): string {
  const cleaned = w.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');
  if (!cleaned) return '';
  return cleaned.charAt(0).toLocaleUpperCase('tr-TR') + cleaned.slice(1).toLocaleLowerCase('tr-TR');
}

function extractTurkishCallerName(callerText: string, prevAiText: string, ownerHonorific = ''): string | null {
  const raw = String(callerText || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 2 || raw.length > 140) return null;
  const low = raw.toLocaleLowerCase('tr-TR');
  if (/(vermek istem|söylemek istem|gerek yok|isim yok|isimsiz|gizli|anonim)/i.test(low)) return null;

  const ownerFirst = String(ownerHonorific || '')
    .trim()
    .split(/\s+/)[0]
    ?.toLocaleLowerCase('tr-TR') || '';

  const validateWords = (candidate: string): string | null => {
    const words = candidate
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, ''))
      .filter((w) => w.length >= 2 && w.length <= 22);
    if (words.length === 0 || words.length > 3) return null;
    const filtered: string[] = [];
    for (const w of words) {
      const wl = w.toLocaleLowerCase('tr-TR');
      if (CALLER_NAME_BLOCKLIST.has(wl)) break;
      if (ownerFirst && wl === ownerFirst && /(ile|görüş|bağla|not|arasın|ulaşsın)/i.test(low)) {
        return null;
      }
      filtered.push(normalizeTurkishTitleWord(w));
    }
    if (filtered.length === 0) return null;
    const joined = filtered.slice(0, 2).join(' ');
    return joined.length >= 2 ? joined : null;
  };

  // 1. Açık kendini tanıtma kalıpları
  const explicitPatterns = [
    /(?:benim\s+adım|adım|ismim)\s+([a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20}(?:\s+[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20})?)/i,
    /(?:^|[,!.?]\s*)ben\s+([a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20}(?:\s+[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20})?)/i,
    /([a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20}(?:\s+[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20})?)\s+ben(?:\s|$|[,.!?])/i,
    /([a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20}(?:\s+[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,20})?)\s+arıyor(?:\s|$|[,.!?])/i,
  ];
  for (const rx of explicitPatterns) {
    const m = raw.match(rx);
    if (m && m[1]) {
      const valid = validateWords(m[1]);
      if (valid) return valid;
    }
  }

  // 2. Asistan az önce arayanın adını sorduysa kısa doğrudan cevap ("Ahmet Yılmaz" / "Mehmet")
  const aiAskedName = /(adınızı|isminizi|kiminle görüşüyorum|kim arıyor|adınız nedir|isminiz nedir|isminizle hitap)/i.test(
    String(prevAiText || '')
  );
  if (aiAskedName) {
    const stripped = raw
      .replace(/^(?:evet|merhaba|tabii|tabi|şey|hmm|benim adım|adım|ismim|ben)\s+/i, '')
      .replace(/\s+(?:ben|bey|hanım|efendim)[,.!?]*$/i, '')
      .trim();
    if (stripped.split(/\s+/).length <= 3) {
      const valid = validateWords(stripped);
      if (valid) return valid;
    }
  }

  return null;
}

// ITU-T G.711 A-law (PCMA) decode table (256 entries -> Int16)
const ALAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const val = i ^ 0x55;
  let t = (val & 0x0f) << 4;
  const seg = (val & 0x70) >> 4;
  if (seg === 0) {
    t += 8;
  } else if (seg === 1) {
    t += 0x108;
  } else {
    t += 0x108;
    t <<= seg - 1;
  }
  ALAW_DECODE_TABLE[i] = (val & 0x80) ? t : -t;
}

// ITU-T G.711 u-law (PCMU) decode table (256 entries -> Int16)
const ULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  ULAW_DECODE_TABLE[i] = (u & 0x80) ? (0x84 - t) : (t - 0x84);
}

export function linearToAlaw(sample: number): number {
  let pcm = Math.max(-32768, Math.min(32767, sample | 0));
  let mask = 0xd5;
  if (pcm < 0) {
    pcm = -pcm - 1;
    mask = 0x55;
  }
  if (pcm > 32767) pcm = 32767;
  let aval = 0;
  if (pcm >= 256) {
    let seg = 1;
    let v = pcm >> 8;
    while (v > 1 && seg < 7) {
      v >>= 1;
      seg++;
    }
    aval = (seg << 4) | ((pcm >> (seg + 3)) & 0x0f);
  } else {
    aval = (pcm >> 4) & 0x0f;
  }
  return aval ^ mask;
}

const PURE_ZERO_1920 = Buffer.alloc(1920);

function boostQuietPcm16k(pcm16k: Buffer, frameRms: number): Buffer {
  // Sakin/alçak konuşmalarda ("Hayır, teşekkür ediyorum" vb.) bağırmaya gerek kalmadan kelimeleri cam gibi netleştirir
  if (frameRms < 75 || frameRms >= 580) return pcm16k;
  const gain = Math.min(2.6, 780 / Math.max(120, frameRms));
  if (gain <= 1.08) return pcm16k;
  const out = Buffer.allocUnsafe(pcm16k.length);
  for (let i = 0; i + 1 < pcm16k.length; i += 2) {
    const v = Math.round(pcm16k.readInt16LE(i) * gain);
    out.writeInt16LE(Math.max(-30500, Math.min(30500, v)), i);
  }
  return out;
}

export function linearToUlaw(sample: number): number {
  let pcm = Math.max(-32768, Math.min(32767, sample | 0));
  let sign = 0;
  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }
  if (pcm > 32635) pcm = 32635;
  pcm += 0x84;
  let exp = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exp > 0; mask >>= 1) {
    exp--;
  }
  const mant = (pcm >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mant)) & 0xff;
}

function readWav8kPcmSamples(wavPath: string): Int16Array | null {
  try {
    if (!wavPath || !fs.existsSync(wavPath)) return null;
    const raw = fs.readFileSync(wavPath);
    if (raw.length < 64) return null;
    const dataIdx = raw.subarray(0, Math.min(raw.length, 512)).indexOf(Buffer.from('data'));
    const offset = dataIdx >= 12 && dataIdx + 8 < raw.length ? dataIdx + 8 : 44;
    const pcmBytes = raw.subarray(offset);
    const sampleCount = Math.floor(pcmBytes.length / 2);
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = pcmBytes.readInt16LE(i * 2);
    }
    return out;
  } catch {
    return null;
  }
}

const LIVE_KORE_CLIP_CACHE = new Map<string, Int16Array>();
const LIVE_KORE_CACHE_DIR = '/var/lib/freeswitch/sounds/santralbayi';
const LIVE_KORE_FALLBACK_DIR = path.resolve(process.cwd(), 'data', 'live-voice-cache');

function getWritableLiveCacheDirs(): string[] {
  const dirs: string[] = [];
  try {
    if (fs.existsSync(LIVE_KORE_CACHE_DIR)) dirs.push(LIVE_KORE_CACHE_DIR);
  } catch {}
  try {
    fs.mkdirSync(LIVE_KORE_FALLBACK_DIR, { recursive: true });
    dirs.push(LIVE_KORE_FALLBACK_DIR);
  } catch {}
  return dirs;
}

function filterDownsample24kTo8kSinglePass(pcm24kBuf: Buffer): Int16Array {
  const usableBytes = Math.floor(pcm24kBuf.length / 6) * 6;
  const outCount = usableBytes / 6;
  const out = new Int16Array(outCount);
  const b0 = 0.119611;
  const b1 = 0.239222;
  const b2 = 0.119611;
  const a1 = -0.812277;
  const a2 = 0.290721;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let dcPrevX = 0;
  let dcPrevY = 0;

  for (let i = 0; i < outCount; i++) {
    const base = i * 6;
    let y = 0;
    for (let sub = 0; sub < 3; sub++) {
      const x0 = pcm24kBuf.readInt16LE(base + sub * 2);
      y = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y;
    }
    const dcClean = y - dcPrevX + 0.988 * dcPrevY;
    dcPrevX = y;
    dcPrevY = dcClean;
    const scaled = Math.round(dcClean * 0.82);
    out[i] = Math.max(-32767, Math.min(32767, scaled));
  }

  // Son 20 ms yumuşak kapanış (sıfır çıtırtı)
  const fadeLen = Math.min(160, out.length);
  for (let k = 0; k < fadeLen; k++) {
    const idx = out.length - 1 - k;
    const factor = 0.5 * (1 - Math.cos((Math.PI * k) / fadeLen));
    out[idx] = Math.round(out[idx] * factor);
  }
  return out;
}

export function getCachedLiveVoiceClip8k(
  textToSpeak: string,
  voiceName: 'Kore' | 'Orus' = 'Kore'
): Int16Array | null {
  const cleanText = String(textToSpeak || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return null;
  const hash = crypto.createHash('sha1').update(cleanText.toLocaleLowerCase('tr-TR')).digest('hex').slice(0, 16);
  const toneVer = voiceName === 'Kore' ? 'v9' : 'v7';
  const memKey = `${voiceName}_${toneVer}_${hash}`;
  const fileName = `live_${voiceName.toLowerCase()}_${toneVer}_${hash}.pcm`;
  const minSamples8k = Math.max(4800, Math.min(24000, cleanText.length * 160));
  const memHit = LIVE_KORE_CLIP_CACHE.get(memKey);
  if (memHit && memHit.length >= minSamples8k) {
    return memHit;
  }
  for (const dir of getWritableLiveCacheDirs()) {
    try {
      const candidatePath = path.join(dir, fileName);
      if (fs.existsSync(candidatePath)) {
        const raw = fs.readFileSync(candidatePath);
        if (raw.length >= minSamples8k * 2) {
          const samples = new Int16Array(Math.floor(raw.length / 2));
          for (let i = 0; i < samples.length; i++) samples[i] = raw.readInt16LE(i * 2);
          LIVE_KORE_CLIP_CACHE.set(memKey, samples);
          return samples;
        }
      }
    } catch {}
  }
  return null;
}

export async function ensureLiveVoiceClip8k(
  textToSpeak: string,
  voiceName: 'Kore' | 'Orus' = 'Kore',
  forceFresh = false
): Promise<{ pcm8k: Int16Array; firstAudioMs: number; fromCache: boolean } | null> {
  const cleanText = String(textToSpeak || '').replace(/\s+/g, ' ').trim();
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!cleanText) return null;

  const hash = crypto.createHash('sha1').update(cleanText.toLocaleLowerCase('tr-TR')).digest('hex').slice(0, 16);
  const toneVer = voiceName === 'Kore' ? 'v9' : 'v7';
  const memKey = `${voiceName}_${toneVer}_${hash}`;
  const fileName = `live_${voiceName.toLowerCase()}_${toneVer}_${hash}.pcm`;
  const diskPath = `${LIVE_KORE_CACHE_DIR}/${fileName}`;
  const minSamples8k = Math.max(4800, Math.min(24000, cleanText.length * 160));

  if (!forceFresh) {
    const memHit = LIVE_KORE_CLIP_CACHE.get(memKey);
    if (memHit && memHit.length >= minSamples8k) {
      return { pcm8k: memHit, firstAudioMs: 1, fromCache: true };
    }
    for (const dir of getWritableLiveCacheDirs()) {
      try {
        const candidatePath = path.join(dir, fileName);
        if (fs.existsSync(candidatePath)) {
          const raw = fs.readFileSync(candidatePath);
          if (raw.length >= minSamples8k * 2) {
            const samples = new Int16Array(Math.floor(raw.length / 2));
            for (let i = 0; i < samples.length; i++) samples[i] = raw.readInt16LE(i * 2);
            LIVE_KORE_CLIP_CACHE.set(memKey, samples);
            return { pcm8k: samples, firstAudioMs: 2, fromCache: true };
          }
        }
      } catch {}
    }
  }

  if (!apiKey) return null;

  const synthesizeOnce = () =>
    new Promise<{ pcm8k: Int16Array; firstAudioMs: number; fromCache: boolean } | null>((resolve) => {
      const t0 = Date.now();
      let firstAudioMs = 0;
      const chunks24k: Buffer[] = [];
      let sawTurnComplete = false;
      let settled = false;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close(1000, 'clip_done');
        } catch {}
        // Yarım kalmış sesi KESİNLİKLE diske veya önbelleğe kaydetme!
        if (!ok || !sawTurnComplete || chunks24k.length === 0) {
          resolve(null);
          return;
        }
        const full24k = Buffer.concat(chunks24k);
        const pcm8k = filterDownsample24kTo8kSinglePass(full24k);
        if (pcm8k.length < minSamples8k) {
          resolve(null);
          return;
        }
        LIVE_KORE_CLIP_CACHE.set(memKey, pcm8k);
        const rawOut = Buffer.allocUnsafe(pcm8k.length * 2);
        for (let i = 0; i < pcm8k.length; i++) rawOut.writeInt16LE(pcm8k[i], i * 2);
        for (const dir of getWritableLiveCacheDirs()) {
          try {
            fs.writeFileSync(path.join(dir, fileName), rawOut);
          } catch {}
        }
        try {
          if (fs.existsSync(LIVE_KORE_CACHE_DIR)) fs.writeFileSync(diskPath, rawOut);
        } catch {}
        resolve({ pcm8k, firstAudioMs: firstAudioMs || Date.now() - t0, fromCache: false });
      };

      const timer = setTimeout(() => finish(false), 9000);

      const personaLine =
        voiceName === 'Orus'
          ? 'Sen enerjik, güler yüzlü, sıcak, tok ve ilgi çekici ses tonuna sahip bir Türk erkek kayıt asistanısın. Düz veya yorgun değil; canlı, sakin, tane tane, samimi ve güven veren bir tonlamayla konuşursun.'
          : 'Sen oturaklı, kendinden emin, kararlı, diksiyonu kusursuz, olgun ve prestijli bir Türk iş kadınısın. Acele etmeden, sakin ve tane tane konuşursun; hiçbir kelimeyi ve özellikle firma adını asla yutmaz, birleştirmez veya hızlı geçmezsin. Tok, dengeli, net ve güven veren üst düzey kurumsal iş kadını ses tonuyla konuşursun.';

      const speakPrompt =
        voiceName === 'Orus'
          ? `Şu sözü canlı, sıcak, sakin ve tane tane (acele etmeden, ekstra söz eklemeden, baştan sona eksiksiz) söyle: "${cleanText}"`
          : `Şu sözü oturaklı, kendinden emin, tok, sakin ve tane tane bir kurumsal iş kadını ses tonuyla (acele etmeden, hiçbir kelimeyi ve özellikle firma adını yutmadan, virgüllerde hafif nefes vererek, ekstra söz eklemeden, baştan sona eksiksiz) söyle: "${cleanText}"`;

      const ws = new NativeIpv4GeminiLiveWs({
        apiKey,
        model: 'gemini-3.8-live',
        voiceName,
        systemInstruction: personaLine,
        useFastVad: false,
        onSetupComplete: () => {
          ws.sendRealtimeText(speakPrompt);
        },
        onMessage: (msg: any) => {
          const sc = msg?.serverContent;
          if (!sc) return;
          for (const p of sc.modelTurn?.parts ?? []) {
            if (p?.inlineData?.data) {
              if (!firstAudioMs) firstAudioMs = Date.now() - t0;
              chunks24k.push(Buffer.from(p.inlineData.data, 'base64'));
            }
          }
          if (sc.turnComplete && chunks24k.length > 0) {
            sawTurnComplete = true;
            finish(true);
          }
        },
        onError: () => finish(false),
        onClose: () => finish(sawTurnComplete && chunks24k.length > 0),
      });
    });

  const first = await synthesizeOnce();
  if (first) return first;
  return synthesizeOnce();
}

export async function ensureLiveKoreClip8k(
  textToSpeak: string,
  forceFresh = false
): Promise<{ pcm8k: Int16Array; firstAudioMs: number; fromCache: boolean } | null> {
  return ensureLiveVoiceClip8k(textToSpeak, 'Kore', forceFresh);
}

interface NativeLiveWsOptions {
  apiKey: string;
  model: string;
  voiceName: string;
  systemInstruction: string;
  useFastVad?: boolean;
  silenceDurationMs?: number;
  manualVad?: boolean;
  transcribeOnly?: boolean;
  onSetupComplete: () => void;
  onMessage: (msg: any) => void;
  onError: (errMsg: string) => void;
  onClose: (code: number, reason: string) => void;
}

const GEMINI_HOST = 'generativelanguage.googleapis.com';
let cachedGeminiIpv4 = '';
let cachedGeminiIpv4At = 0;
let cachedGeminiFamily: 4 | 6 = 4;
let lastDnsCandidates: string[] = [];
let pendingGeminiDnsPromise: Promise<string> | null = null;

function invalidateGeminiIpv4Cache(): void {
  cachedGeminiIpv4 = '';
  cachedGeminiIpv4At = 0;
}

function probeTcp443Reachable(ip: string, family: 4 | 6, timeoutMs = 1800): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(tm);
      try {
        s.destroy();
      } catch {}
      resolve(ok ? ip : null);
    };
    const s = net.connect({ host: ip, port: 443, family });
    const tm = setTimeout(() => done(false), timeoutMs);
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

function resolveGeminiIpv4Fast(): Promise<string> {
  const now = Date.now();
  if (cachedGeminiIpv4 && now - cachedGeminiIpv4At < 10 * 60 * 1000) {
    return Promise.resolve(cachedGeminiIpv4);
  }
  if (pendingGeminiDnsPromise) return pendingGeminiDnsPromise;

  pendingGeminiDnsPromise = (async () => {
    try {
      const resolveHostFrom = (host: string, servers: string[], timeoutMs = 1100): Promise<string[]> =>
        new Promise((resolve) => {
          let done = false;
          const finish = (list: string[]) => {
            if (done) return;
            done = true;
            clearTimeout(tm);
            resolve(list);
          };
          const tm = setTimeout(() => finish([]), timeoutMs);
          try {
            const r = new dns.Resolver();
            r.setServers(servers);
            r.resolve4(host, (err, addrs) => {
              finish(!err && Array.isArray(addrs) ? addrs : []);
            });
          } catch {
            finish([]);
          }
        });

      const lookupSys4 = (host: string, timeoutMs = 1100): Promise<string[]> =>
        new Promise((resolve) => {
          let done = false;
          const finish = (list: string[]) => {
            if (done) return;
            done = true;
            clearTimeout(tm);
            resolve(list);
          };
          const tm = setTimeout(() => finish([]), timeoutMs);
          try {
            dns.lookup(host, { family: 4, all: true }, (err, addrs) => {
              finish(!err && Array.isArray(addrs) ? addrs.map((a) => a.address) : []);
            });
          } catch {
            finish([]);
          }
        });

      const resolveV6 = (servers: string[], timeoutMs = 1100): Promise<string[]> =>
        new Promise((resolve) => {
          let done = false;
          const finish = (list: string[]) => {
            if (done) return;
            done = true;
            clearTimeout(tm);
            resolve(list);
          };
          const tm = setTimeout(() => finish([]), timeoutMs);
          try {
            const r = new dns.Resolver();
            r.setServers(servers);
            r.resolve6(GEMINI_HOST, (err, addrs) => {
              finish(!err && Array.isArray(addrs) ? addrs : []);
            });
          } catch {
            finish([]);
          }
        });

      const [sysGem, sysWww, g8Gem, cf1Gem, g8Www, g8Oauth, v6List] = await Promise.all([
        lookupSys4(GEMINI_HOST),
        lookupSys4('www.googleapis.com'),
        resolveHostFrom(GEMINI_HOST, ['8.8.8.8']),
        resolveHostFrom(GEMINI_HOST, ['1.1.1.1']),
        resolveHostFrom('www.googleapis.com', ['8.8.8.8']),
        resolveHostFrom('oauth2.googleapis.com', ['1.1.1.1']),
        resolveV6(['8.8.8.8', '1.1.1.1']),
      ]);

      // Farklı Google alt ağlarından dengeli aday seçimi (tek bir alt ağ diğerlerini asla eleyemez)
      const rawPool = [
        ...sysGem.slice(0, 2),
        ...g8Gem.slice(0, 2),
        ...cf1Gem.slice(0, 2),
        ...sysWww.slice(0, 2),
        ...g8Www.slice(0, 2),
        ...g8Oauth.slice(0, 2),
        '74.125.71.95',
        '172.253.120.95',
      ];
      const prefixCount = new Map<string, number>();
      const v4Candidates: string[] = [];
      const seen = new Set<string>();
      for (const ip of rawPool) {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || seen.has(ip)) continue;
        const pfx = ip.split('.').slice(0, 2).join('.');
        const cnt = prefixCount.get(pfx) || 0;
        if (cnt >= 2) continue;
        seen.add(ip);
        prefixCount.set(pfx, cnt + 1);
        v4Candidates.push(ip);
        if (v4Candidates.length >= 12) break;
      }
      lastDnsCandidates = v4Candidates;

      // Tüm aday IPv4 adreslerine paralel 443 bağlantı yarışı -> ilk açılan kazanır (~20-70 ms)!
      const winnerV4 = await new Promise<string | null>((resolve) => {
        if (v4Candidates.length === 0) {
          resolve(null);
          return;
        }
        let remaining = v4Candidates.length;
        let settled = false;
        for (const ip of v4Candidates) {
          void probeTcp443Reachable(ip, 4, 2000).then((okIp) => {
            if (settled) return;
            if (okIp) {
              settled = true;
              resolve(okIp);
              return;
            }
            remaining--;
            if (remaining <= 0) {
              settled = true;
              resolve(null);
            }
          });
        }
      });

      if (winnerV4) {
        cachedGeminiFamily = 4;
        cachedGeminiIpv4 = winnerV4;
        cachedGeminiIpv4At = Date.now();
        return winnerV4;
      }

      // Tüm IPv4'ler kapalıysa IPv6 dene
      for (const ip6 of v6List.slice(0, 3)) {
        const ok6 = await probeTcp443Reachable(ip6, 6, 1500);
        if (ok6) {
          cachedGeminiFamily = 6;
          cachedGeminiIpv4 = ok6;
          cachedGeminiIpv4At = Date.now();
          return ok6;
        }
      }

      cachedGeminiFamily = 4;
      return v4Candidates[0] || GEMINI_HOST;
    } finally {
      pendingGeminiDnsPromise = null;
    }
  })();

  return pendingGeminiDnsPromise;
}

const fastKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 45000,
  maxSockets: 8,
  maxFreeSockets: 4,
});

function prewarmTranscribeKeepAlive(): void {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return;
  void resolveGeminiIpv4Fast().then((targetIp) => {
    try {
      const req = https.request(
        {
          host: targetIp,
          servername: GEMINI_HOST,
          port: 443,
          path: `/v1beta/models/gemini-3.1-flash-lite?key=${encodeURIComponent(apiKey)}`,
          method: 'GET',
          agent: fastKeepAliveAgent,
          headers: {
            Host: GEMINI_HOST,
            'User-Agent': 'aistudio-build',
          },
          timeout: 2500,
        },
        (res) => {
          res.resume();
        }
      );
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
      req.end();
    } catch {}
  });
}

function buildTrimmedWav8kBuffer(pcm16k: Buffer): Buffer {
  // 16kHz -> 8kHz mono (yarı boyut = 2 kat hızlı aktarım) + baş/son boş sessizlik kırpma
  const totalSamples8k = Math.floor(pcm16k.length / 4);
  if (totalSamples8k <= 0) return Buffer.alloc(0);

  const frameLen = 160; // 20ms @ 8kHz
  const frameCount = Math.ceil(totalSamples8k / frameLen);
  let firstVoiceFrame = -1;
  let lastVoiceFrame = -1;

  for (let f = 0; f < frameCount; f++) {
    const startS = f * frameLen;
    const endS = Math.min(totalSamples8k, startS + frameLen);
    let sumSq = 0;
    for (let s = startS; s < endS; s++) {
      const v = pcm16k.readInt16LE(s * 4 + 2);
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, endS - startS));
    if (rms >= 135) {
      if (firstVoiceFrame < 0) firstVoiceFrame = f;
      lastVoiceFrame = f;
    }
  }

  const startSample = firstVoiceFrame >= 0 ? Math.max(0, (firstVoiceFrame - 3) * frameLen) : 0;
  const endSample =
    lastVoiceFrame >= 0
      ? Math.min(totalSamples8k, (lastVoiceFrame + 4) * frameLen)
      : totalSamples8k;
  const outSamples = Math.max(0, endSample - startSample);
  if (outSamples < 400) return Buffer.alloc(0);

  const pcm8kBytes = outSamples * 2;
  const out = Buffer.allocUnsafe(44 + pcm8kBytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + pcm8kBytes, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(16000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(pcm8kBytes, 40);

  for (let i = 0; i < outSamples; i++) {
    const s = pcm16k.readInt16LE((startSample + i) * 4 + 2);
    out.writeInt16LE(s, 44 + i * 2);
  }
  return out;
}

async function transcribePcm16kFastIpv4(pcm16k: Buffer, timeoutMs = 2800): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || pcm16k.length < 3200) return '';
  const wavBuf = buildTrimmedWav8kBuffer(pcm16k);
  if (wavBuf.length < 900) return '';
  const targetIp = await resolveGeminiIpv4Fast();
  const payload = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: wavBuf.toString('base64'),
            },
          },
          {
            text: 'Sadece telefona doğrudan ve net konuşan kişinin Türkçe sözünü yaz. Arka plan, televizyon, sokak, rüzgar, öksürük veya uzaktaki diğer kişilerin seslerini dikkate alma; ses boşsa veya doğrudan konuşma yoksa HİÇBİR ŞEY YAZMA, asla açıklama veya sohbet yanıtı üretme.',
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 64,
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    },
  });

  return new Promise<string>((resolve) => {
    let settled = false;
    const done = (txt: string) => {
      if (settled) return;
      settled = true;
      resolve(txt);
    };

    const req = https.request(
      {
        host: targetIp,
        servername: GEMINI_HOST,
        port: 443,
        path: `/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
        method: 'POST',
        agent: fastKeepAliveAgent,
        headers: {
          Host: GEMINI_HOST,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'aistudio-build',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
            const rawTxt = parts
              .map((p: any) => String(p?.text || ''))
              .join(' ')
              .replace(/\s+/g, ' ')
              .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
              .trim();
            const isMetaHallucination =
              !rawTxt ||
              rawTxt.length > 220 ||
              /(konuşmanın içeriğini|ses kaydını|benimle paylaşın|size yardımcı olabilirim|nasıl yardımcı olabilirim|dinleyemiyorum|ses dosyası|ses yok|konuşma yok|anlaşılamadı|boş ses|transkript|yazıya dök|yapay zeka|gizlilik kuralları|lütfen.*paylaşın)/i.test(
                rawTxt
              );
            done(isMetaHallucination ? '' : rawTxt);
          } catch {
            done('');
          }
        });
        res.on('error', () => done(''));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      done('');
    });
    req.on('error', () => done(''));
    req.write(payload);
    req.end();
  });
}

/**
 * Saf IPv4 (family: 4) sıfır bağımlılıklı RFC-6455 canlı ses WebSocket istemcisi.
 * Sunucudaki eski SDK, DNS (5 sn) veya IPv6 gecikme sorunlarından %100 bağımsızdır.
 */
class NativeIpv4GeminiLiveWs {
  private socket: tls.TLSSocket | null = null;
  private handshakeDone = false;
  private rxBuf = Buffer.alloc(0);
  private fragChunks: Buffer[] = [];
  private fragOpcode = 0;
  private closed = false;
  private setupSent = false;
  private setupConfirmed = false;
  private readonly opts: NativeLiveWsOptions;

  constructor(opts: NativeLiveWsOptions) {
    this.opts = opts;
    void this.connect();
  }

  public isReady(): boolean {
    return !this.closed && this.handshakeDone && this.setupConfirmed;
  }

  private async connect() {
    const host = GEMINI_HOST;
    const wsPath = `/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.opts.apiKey)}`;
    const wsKey = crypto.randomBytes(16).toString('base64');
    const targetIp = await resolveGeminiIpv4Fast();
    if (this.closed) return;

    const tcpSock = net.connect({
      host: targetIp,
      port: 443,
      family: cachedGeminiFamily,
    });
    tcpSock.setNoDelay(true);
    tcpSock.on('error', (err: any) => {
      invalidateGeminiIpv4Cache();
      if (!this.closed) {
        this.opts.onError(String(err?.message || err || 'tcp_error'));
        this.close(1006, 'tcp_error');
      }
    });
    const sock = tls.connect({
      socket: tcpSock,
      servername: host,
      rejectUnauthorized: true,
    });
    this.socket = sock;
    sock.setNoDelay(true);

    sock.on('secureConnect', () => {
      if (this.closed) {
        sock.destroy();
        return;
      }
      const req = [
        `GET ${wsPath} HTTP/1.1`,
        `Host: ${host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        'User-Agent: aistudio-build',
        '',
        '',
      ].join('\r\n');
      sock.write(req);
    });

    sock.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      this.rxBuf = this.rxBuf.length > 0 ? Buffer.concat([this.rxBuf, chunk]) : chunk;

      if (!this.handshakeDone) {
        const hdrEnd = this.rxBuf.indexOf('\r\n\r\n');
        if (hdrEnd < 0) return;
        const headerStr = this.rxBuf.subarray(0, hdrEnd).toString('utf8');
        this.rxBuf = this.rxBuf.subarray(hdrEnd + 4);
        const firstLine = headerStr.split('\r\n')[0] || '';
        if (!firstLine.includes(' 101 ')) {
          this.opts.onError(`ws_handshake_failed:${firstLine.slice(0, 120)}`);
          this.close(1002, 'handshake_failed');
          return;
        }
        this.handshakeDone = true;
        this.sendSetup();
      }

      this.parseFrames();
    });

    sock.on('error', (err: any) => {
      if (!this.closed) {
        this.opts.onError(String(err?.message || err || 'tls_error'));
      }
    });

    sock.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.opts.onClose(1006, 'socket_closed');
      }
    });
  }

  private sendSetup() {
    if (this.setupSent || this.closed) return;
    this.setupSent = true;
    if (this.opts.transcribeOnly) {
      const setupBody: Record<string, any> = {
        model: this.opts.model.startsWith('models/') ? this.opts.model : `models/${this.opts.model}`,
        generationConfig: {
          responseModalities: ['TEXT'],
        },
        inputAudioTranscription: {
          languageCodes: ['tr'],
        },
      };
      this.sendJson({ setup: setupBody });
      return;
    }
    const setupBody: Record<string, any> = {
      model: this.opts.model.startsWith('models/') ? this.opts.model : `models/${this.opts.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.opts.voiceName },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: this.opts.systemInstruction }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    if (this.opts.manualVad) {
      setupBody.realtimeInputConfig = {
        automaticActivityDetection: {
          disabled: true,
        },
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
      };
    } else if (this.opts.useFastVad !== false) {
      setupBody.realtimeInputConfig = {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          prefixPaddingMs: 100,
          silenceDurationMs: this.opts.silenceDurationMs ?? 200,
        },
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
      };
    }
    this.sendJson({ setup: setupBody });
  }

  private sendRawFrame(opcode: number, payload: Buffer) {
    if (this.closed || !this.socket || !this.handshakeDone) return;
    const len = payload.length;
    let headerLen = 2 + 4;
    if (len >= 126 && len <= 65535) headerLen += 2;
    else if (len > 65535) headerLen += 8;

    const frame = Buffer.allocUnsafe(headerLen + len);
    frame[0] = 0x80 | (opcode & 0x0f);
    let offset = 2;
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len <= 65535) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
      offset = 4;
    } else {
      frame[1] = 0x80 | 127;
      frame.writeUInt32BE(0, 2);
      frame.writeUInt32BE(len >>> 0, 6);
      offset = 10;
    }

    const mask = crypto.randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i++) {
      frame[offset + i] = payload[i] ^ mask[i & 3];
    }

    try {
      this.socket.write(frame);
    } catch {}
  }

  public sendJson(obj: Record<string, any>) {
    this.sendRawFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  public sendAudioPcm16k(pcm16k: Buffer) {
    if (!this.isReady() || pcm16k.length === 0) return;
    this.sendJson({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: pcm16k.toString('base64'),
        },
      },
    });
  }

  public sendAudioStreamEnd() {
    if (!this.isReady()) return;
    this.sendJson({
      realtimeInput: {
        audioStreamEnd: true,
      },
    });
  }

  public sendActivityStart() {
    if (!this.isReady()) return;
    this.sendJson({
      realtimeInput: {
        activityStart: {},
      },
    });
  }

  public sendActivityEnd() {
    if (!this.isReady()) return;
    this.sendJson({
      realtimeInput: {
        activityEnd: {},
      },
    });
  }

  public sendRealtimeText(text: string) {
    if (!this.isReady() || !text) return;
    this.sendJson({
      realtimeInput: {
        text,
      },
    });
  }

  public sendClientTurnText(text: string) {
    if (!this.isReady() || !text) return;
    this.sendJson({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      },
    });
  }

  private parseFrames() {
    while (!this.closed && this.rxBuf.length >= 2) {
      const b0 = this.rxBuf[0];
      const b1 = this.rxBuf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.rxBuf.length < 4) return;
        payloadLen = this.rxBuf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.rxBuf.length < 10) return;
        const hi = this.rxBuf.readUInt32BE(2);
        const lo = this.rxBuf.readUInt32BE(6);
        payloadLen = hi * 0x100000000 + lo;
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = offset + maskLen + payloadLen;
      if (this.rxBuf.length < totalLen) return;

      let payload = this.rxBuf.subarray(offset + maskLen, totalLen);
      if (masked) {
        const maskKey = this.rxBuf.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i & 3];
        }
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }

      this.rxBuf = this.rxBuf.subarray(totalLen);

      if (opcode === 0x9) {
        // Ping -> Pong
        this.sendRawFrame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) {
        continue;
      }
      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        this.closed = true;
        try {
          this.socket?.end();
        } catch {}
        this.opts.onClose(code, reason);
        return;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) {
          this.handleCompleteMessage(payload);
        } else {
          this.fragOpcode = opcode;
          this.fragChunks = [payload];
        }
      } else if (opcode === 0x0) {
        this.fragChunks.push(payload);
        if (fin && (this.fragOpcode === 0x1 || this.fragOpcode === 0x2)) {
          const full = Buffer.concat(this.fragChunks);
          this.fragChunks = [];
          this.fragOpcode = 0;
          this.handleCompleteMessage(full);
        }
      }
    }
  }

  private handleCompleteMessage(buf: Buffer) {
    if (this.closed || buf.length === 0) return;
    try {
      const json = JSON.parse(buf.toString('utf8'));
      if (json && Object.prototype.hasOwnProperty.call(json, 'setupComplete')) {
        if (!this.setupConfirmed) {
          this.setupConfirmed = true;
          this.opts.onSetupComplete();
        }
        return;
      }
      this.opts.onMessage(json);
    } catch {}
  }

  public close(code = 1000, reason = 'normal') {
    if (this.closed) return;
    if (this.handshakeDone && this.socket && !this.socket.destroyed) {
      try {
        const reasonBuf = Buffer.from(reason.slice(0, 80), 'utf8');
        const closePayload = Buffer.allocUnsafe(2 + reasonBuf.length);
        closePayload.writeUInt16BE(code, 0);
        reasonBuf.copy(closePayload, 2);
        this.sendRawFrame(0x8, closePayload);
      } catch {}
    }
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {}
    this.socket = null;
  }
}

interface ParsedSipMessage {
  isRequest: boolean;
  method: string;
  requestUri: string;
  statusCode: number;
  headers: Record<string, string>;
  vias: string[];
  body: string;
}

function parseSipMessage(raw: string): ParsedSipMessage {
  const splitIdx = raw.indexOf('\r\n\r\n');
  const headerPart = splitIdx >= 0 ? raw.slice(0, splitIdx) : raw;
  const body = splitIdx >= 0 ? raw.slice(splitIdx + 4) : '';
  const lines = headerPart.split(/\r?\n/);
  const firstLine = (lines[0] || '').trim();
  const isRequest = !firstLine.startsWith('SIP/2.0');
  let method = '';
  let requestUri = '';
  let statusCode = 0;
  if (isRequest) {
    const parts = firstLine.split(/\s+/);
    method = (parts[0] || '').toUpperCase();
    requestUri = parts[1] || '';
  } else {
    const parts = firstLine.split(/\s+/);
    statusCode = Number(parts[1] || 0);
  }
  const headers: Record<string, string> = {};
  const vias: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const k = line.slice(0, colon).trim().toLowerCase();
    const v = line.slice(colon + 1).trim();
    if (k === 'via' || k === 'v') {
      vias.push(v);
    } else if (!headers[k]) {
      headers[k] = v;
    }
  }
  return { isRequest, method, requestUri, statusCode, headers, vias, body };
}

function parseSdpRemote(sdp: string): { ip: string; port: number; payloadType: 8 | 0 } {
  let ip = '127.0.0.1';
  let port = 0;
  let payloadType: 8 | 0 = 8;
  for (const line of sdp.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('c=IN IP4 ')) {
      ip = trimmed.slice('c=IN IP4 '.length).split('/')[0].trim();
    } else if (trimmed.startsWith('m=audio ')) {
      const parts = trimmed.split(/\s+/);
      port = Number(parts[1] || 0);
      const pts = parts.slice(3);
      if (pts.includes('8')) {
        payloadType = 8;
      } else if (pts.includes('0')) {
        payloadType = 0;
      }
    }
  }
  return { ip, port, payloadType };
}

function extractAngleUri(headerVal: string): string {
  const m = headerVal.match(/<([^>]+)>/);
  return m ? m[1] : headerVal.split(';')[0].trim();
}

function isMeaningfulTurkishSpeech(raw: string): boolean {
  const clean = String(raw || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length < 2) return false;
  if (/^(m+h+m*|h+m+|u+h+|ı+h+|a+h+|e+h+|ö+h+|o+h+|e+|a+|ı+|hm+|mm+)$/i.test(clean)) return false;
  return true;
}

interface ActiveLiveCall {
  sipCallId: string;
  ctx: LiveCallContext;
  remoteSipIp: string;
  remoteSipPort: number;
  remoteContactUri: string;
  fromHeader: string;
  toHeaderWithTag: string;
  localIp: string;
  remoteRtpIp: string;
  remoteRtpPort: number;
  payloadType: 8 | 0;
  rtpSock: dgram.Socket;
  rtpTimer: ReturnType<typeof setTimeout> | null;
  silenceWatchdog: ReturnType<typeof setInterval> | null;
  rtpSeq: number;
  rtpTs: number;
  rtpSsrc: number;
  outPcm8kChunks: Int16Array[];
  outChunkIdx: number;
  outSampleOffset: number;
  outTotalQueuedSamples: number;
  outStreamActive: boolean;
  out24kCarry: Buffer;
  lpX1: number;
  lpX2: number;
  lpY1: number;
  lpY2: number;
  dcPrevX: number;
  dcPrevY: number;
  outGateGain: number;
  lastOutSample: number;
  fadeFromSample: number;
  prevInSample: number;
  in16kAccum: Buffer[];
  in16kAccumBytes: number;
  callStartedAt: number;
  greetingTriggered: boolean;
  greetingEnqueued: boolean;
  greetingStartedAt: number;
  greetingDone: boolean;
  loudBargeStreak: number;
  voiceFrameStreak: number;
  quietFrameStreak: number;
  ambientNoiseRms: number;
  turnPeakRms: number;
  lastLoudVoiceAt: number;
  echoGuardUntil: number;
  outAudioWasPlaying: boolean;
  turnEpoch: number;
  callerHadSpeechSinceReply: boolean;
  lastVoiceFrameAt: number;
  audioEndNudgeSent: boolean;
  audioEndSentAt: number;
  recentSpeechPcm16k: Buffer[];
  preRollPcm16k: Buffer[];
  replayOnConnectPcm16k: Buffer[];
  activityOpen: boolean;
  activityOpenedAt: number;
  rescueInFlight: boolean;
  reconnectAttempts: number;
  duetRole: 'female' | 'male_note' | 'female_after_note';
  maleNoteTurns: number;
  handoverInProgress: boolean;
  handoverEnqueued: boolean;
  handoverStartedAt: number;
  liveWs: NativeIpv4GeminiLiveWs | null;
  sttWs: NativeIpv4GeminiLiveWs | null;
  sttReady: boolean;
  sttFinalText: string;
  sttInterimText: string;
  sttLastUpdateAt: number;
  sttPendingChunks: Buffer[];
  turnFinalizeTimer: ReturnType<typeof setTimeout> | null;
  lastSubmittedTurnText: string;
  geminiReady: boolean;
  geminiSpeaking: boolean;
  lastCallerSpeechAt: number;
  lastAiActivityAt: number;
  silentNudgeCount: number;
  pendingCallerText: string;
  pendingAiText: string;
  transcript: Array<{ speaker: 'AI' | 'CALLER'; text: string }>;
  turns: number;
  shouldHangupAfterDrain: boolean;
  closed: boolean;
  okResponseRaw: string;
  ownerAudioActive?: boolean;
  ownerAudioCb?: ((pcm8k: Buffer) => void) | null;
  ownerEndedCb?: (() => void) | null;
}

function fixOwnerNamePhoneticSlip(spoken: string, ownerHonorific: string): string {
  const raw = String(spoken || '').trim();
  const honor = String(ownerHonorific || '').trim();
  if (!raw || !honor) return raw;
  const parts = honor.split(/\s+/).filter(Boolean);
  const ownerFirst = parts[0] || '';
  if (ownerFirst.length < 4) return raw;
  const ownerLow = ownerFirst.toLocaleLowerCase('tr-TR');
  const rawLow = raw.toLocaleLowerCase('tr-TR');
  if (rawLow.includes(ownerLow)) return raw;

  const normPhonetic = (w: string) =>
    w
      .toLocaleLowerCase('tr-TR')
      .replace(/e/g, 'a')
      .replace(/m/g, 'n')
      .replace(/ı/g, 'i');

  const editDist = (a: string, b: string): number => {
    const m = a.length;
    const n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  };

  const ownerNorm = normPhonetic(ownerLow);
  const ownerEndNasal = /[nm]$/.test(ownerLow);
  const ownerPrefix2 = ownerLow.slice(0, 2);

  return raw.replace(
    /\b([A-Za-zÇĞİÖŞÜçğıöşü]{4,16})(\s+(?:Bey|Hanım|Hanim|Usta|Hocam)(?:['’][A-Za-zÇĞİÖŞÜçğıöşü]+|[a-zçğıöşü]*)?)/gi,
    (full, cand: string, suffix: string, offset: number) => {
      const afterSlice = raw.slice(offset + full.length, offset + full.length + 18).toLocaleLowerCase('tr-TR');
      if (/\bdeğil\b|\bdegil\b/.test(afterSlice)) return full;
      const candLow = cand.toLocaleLowerCase('tr-TR');
      if (candLow === ownerLow) return full;
      if (candLow.slice(0, 2) !== ownerPrefix2) return full;
      if (Math.abs(candLow.length - ownerLow.length) > 1) return full;
      if (ownerEndNasal && !/[nm]$/.test(candLow)) return full;
      const d = editDist(normPhonetic(candLow), ownerNorm);
      if (d <= 1) {
        return `${ownerFirst}${suffix}`;
      }
      return full;
    }
  );
}

export class SantralBayiLiveBridge {
  private sipSock: dgram.Socket | null = null;
  private readonly port: number;
  private readonly allowedIps = new Set(['127.0.0.1', '178.208.187.42']);
  private readonly pendingBySafeUuid = new Map<string, { ctx: LiveCallContext; createdAt: number }>();
  private readonly activeBySipCallId = new Map<string, ActiveLiveCall>();
  private readonly onCallUpdate: (payload: LiveBridgeUpdatePayload) => void;
  private ready = false;
  private lastDiag = 'not_started';

  constructor(port: number, onCallUpdate: (payload: LiveBridgeUpdatePayload) => void) {
    this.port = port;
    this.onCallUpdate = onCallUpdate;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public getStatus() {
    return {
      ready: this.ready,
      port: this.port,
      activeCalls: this.activeBySipCallId.size,
      pendingCalls: this.pendingBySafeUuid.size,
      lastDiag: this.lastDiag,
    };
  }

  public registerPendingCall(ctx: LiveCallContext) {
    const now = Date.now();
    for (const [k, v] of this.pendingBySafeUuid.entries()) {
      if (now - v.createdAt > 120_000) this.pendingBySafeUuid.delete(k);
    }
    this.pendingBySafeUuid.set(ctx.safeUuid, { ctx, createdAt: now });
  }

  public start() {
    if (this.sipSock) return;
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sipSock = sock;
      sock.on('error', (err) => {
        this.lastDiag = `sip_err:${err?.message || err}`;
        this.ready = false;
      });
      sock.on('listening', () => {
        this.ready = true;
        this.lastDiag = `listening_0.0.0.0:${this.port}`;
      });
      sock.on('message', (msgBuf, rinfo) => {
        if (!this.allowedIps.has(rinfo.address)) return;
        this.handleSipPacket(msgBuf.toString('utf8'), rinfo);
      });
      sock.bind(this.port, '0.0.0.0');
    } catch (e: any) {
      this.lastDiag = `start_fail:${e?.message || e}`;
      this.ready = false;
    }
  }

  public stop() {
    for (const call of Array.from(this.activeBySipCallId.values())) {
      this.teardownCall(call, false);
    }
    if (this.sipSock) {
      try {
        this.sipSock.close();
      } catch {}
      this.sipSock = null;
    }
    this.ready = false;
  }

  private sendSip(raw: string, ip: string, port: number) {
    if (!this.sipSock) return;
    const buf = Buffer.from(raw, 'utf8');
    try {
      this.sipSock.send(buf, 0, buf.length, port, ip);
    } catch {}
  }

  private handleSipPacket(raw: string, rinfo: dgram.RemoteInfo) {
    const parsed = parseSipMessage(raw);
    if (!parsed.isRequest) return;

    const sipCallId = parsed.headers['call-id'] || parsed.headers['i'] || '';
    const fromHeader = parsed.headers['from'] || parsed.headers['f'] || '';
    const toHeader = parsed.headers['to'] || parsed.headers['t'] || '';
    const cseqHeader = parsed.headers['cseq'] || '';
    const viaLines = parsed.vias.map((v) => `Via: ${v}`).join('\r\n');
    const localIp = rinfo.address === '127.0.0.1' ? '127.0.0.1' : '178.208.187.42';

    if (parsed.method === 'OPTIONS') {
      const resp = [
        'SIP/2.0 200 OK',
        viaLines,
        `From: ${fromHeader}`,
        `To: ${toHeader};tag=sbopt${Date.now().toString(36)}`,
        `Call-ID: ${sipCallId}`,
        `CSeq: ${cseqHeader}`,
        'Content-Length: 0',
        '',
        '',
      ].join('\r\n');
      this.sendSip(resp, rinfo.address, rinfo.port);
      return;
    }

    if (parsed.method === 'ACK') {
      return;
    }

    if (parsed.method === 'BYE' || parsed.method === 'CANCEL') {
      const existing = this.activeBySipCallId.get(sipCallId);
      const toResp = existing ? existing.toHeaderWithTag : toHeader;
      const resp = [
        'SIP/2.0 200 OK',
        viaLines,
        `From: ${fromHeader}`,
        `To: ${toResp}`,
        `Call-ID: ${sipCallId}`,
        `CSeq: ${cseqHeader}`,
        'Content-Length: 0',
        '',
        '',
      ].join('\r\n');
      this.sendSip(resp, rinfo.address, rinfo.port);
      if (existing) {
        this.teardownCall(existing, false);
      }
      return;
    }

    if (parsed.method === 'INVITE') {
      const existing = this.activeBySipCallId.get(sipCallId);
      if (existing) {
        this.sendSip(existing.okResponseRaw, rinfo.address, rinfo.port);
        return;
      }

      const trying = [
        'SIP/2.0 100 Trying',
        viaLines,
        `From: ${fromHeader}`,
        `To: ${toHeader}`,
        `Call-ID: ${sipCallId}`,
        `CSeq: ${cseqHeader}`,
        'Content-Length: 0',
        '',
        '',
      ].join('\r\n');
      this.sendSip(trying, rinfo.address, rinfo.port);

      const uriMatch = parsed.requestUri.match(/sip:live_([a-zA-Z0-9_-]+)@/i);
      const safeUuid = uriMatch ? uriMatch[1] : '';
      const pending = safeUuid ? this.pendingBySafeUuid.get(safeUuid) : undefined;
      if (safeUuid) this.pendingBySafeUuid.delete(safeUuid);

      const ctx: LiveCallContext = pending?.ctx || {
        uuid: safeUuid || sipCallId,
        safeUuid: safeUuid || sipCallId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48),
        ownerPhone: '05376031645',
        callerPhone: '05000000000',
        companyName: 'Santral Bayi Genel Merkez',
        personHonorific: 'Kenan Bey',
        workHours: '09:00 - 19:00',
        callerIdentityBlock: 'Arayan kişi kayıtlı değil. Arayan adını söylemeden asla isim uydurma.',
        greetingText: 'Merhaba, Santral Bayi firmasına hoş geldiniz! Ben asistanınızım. Size nasıl yardımcı olabilirim?',
        greetingWav8kPath: '',
      };

      const sdpRemote = parseSdpRemote(parsed.body);
      if (!sdpRemote.port) {
        const errResp = [
          'SIP/2.0 488 Not Acceptable Here',
          viaLines,
          `From: ${fromHeader}`,
          `To: ${toHeader};tag=sberr${Date.now().toString(36)}`,
          `Call-ID: ${sipCallId}`,
          `CSeq: ${cseqHeader}`,
          'Content-Length: 0',
          '',
          '',
        ].join('\r\n');
        this.sendSip(errResp, rinfo.address, rinfo.port);
        return;
      }

      const rtpSock = dgram.createSocket('udp4');
      rtpSock.bind(0, '0.0.0.0', () => {
        const localRtpPort = rtpSock.address().port;
        const localTag = `sblive${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const toWithTag = toHeader.includes('tag=') ? toHeader : `${toHeader};tag=${localTag}`;
        const codecRtpmap = sdpRemote.payloadType === 8 ? '8 PCMA/8000' : '0 PCMU/8000';
        const sdpBody = [
          'v=0',
          `o=SantralBayiLive ${Date.now()} 1 IN IP4 ${localIp}`,
          's=SantralBayiLive',
          `c=IN IP4 ${localIp}`,
          't=0 0',
          `m=audio ${localRtpPort} RTP/AVP ${sdpRemote.payloadType}`,
          `a=rtpmap:${codecRtpmap}`,
          'a=ptime:20',
          'a=sendrecv',
          '',
        ].join('\r\n');

        const okResp = [
          'SIP/2.0 200 OK',
          viaLines,
          `From: ${fromHeader}`,
          `To: ${toWithTag}`,
          `Call-ID: ${sipCallId}`,
          `CSeq: ${cseqHeader}`,
          `Contact: <sip:live_${ctx.safeUuid}@${localIp}:${this.port}>`,
          'Content-Type: application/sdp',
          `Content-Length: ${Buffer.byteLength(sdpBody, 'utf8')}`,
          '',
          sdpBody,
        ].join('\r\n');

        const contactHeader = parsed.headers['contact'] || parsed.headers['m'] || '';
        const remoteContactUri = contactHeader
          ? extractAngleUri(contactHeader)
          : `sip:freeswitch@${rinfo.address}:${rinfo.port}`;

        const call: ActiveLiveCall = {
          sipCallId,
          ctx,
          remoteSipIp: rinfo.address,
          remoteSipPort: rinfo.port,
          remoteContactUri,
          fromHeader,
          toHeaderWithTag: toWithTag,
          localIp,
          remoteRtpIp: sdpRemote.ip || rinfo.address,
          remoteRtpPort: sdpRemote.port,
          payloadType: sdpRemote.payloadType,
          rtpSock,
          rtpTimer: null,
          silenceWatchdog: null,
          rtpSeq: Math.floor(Math.random() * 30000),
          rtpTs: Math.floor(Math.random() * 1000000),
          rtpSsrc: Math.floor(Math.random() * 0x7fffffff),
          outPcm8kChunks: [],
          outChunkIdx: 0,
          outSampleOffset: 0,
          outTotalQueuedSamples: 0,
          outStreamActive: false,
          out24kCarry: Buffer.alloc(0),
          lpX1: 0,
          lpX2: 0,
          lpY1: 0,
          lpY2: 0,
          dcPrevX: 0,
          dcPrevY: 0,
          outGateGain: 0,
          lastOutSample: 0,
          fadeFromSample: 0,
          prevInSample: 0,
          in16kAccum: [],
          in16kAccumBytes: 0,
          callStartedAt: Date.now(),
          greetingTriggered: false,
          greetingEnqueued: false,
          greetingStartedAt: 0,
          greetingDone: false,
          loudBargeStreak: 0,
          voiceFrameStreak: 0,
          quietFrameStreak: 0,
          ambientNoiseRms: 180,
          turnPeakRms: 0,
          lastLoudVoiceAt: 0,
          echoGuardUntil: 0,
          outAudioWasPlaying: false,
          turnEpoch: 0,
          callerHadSpeechSinceReply: false,
          lastVoiceFrameAt: 0,
          audioEndNudgeSent: false,
          audioEndSentAt: 0,
          recentSpeechPcm16k: [],
          preRollPcm16k: [],
          replayOnConnectPcm16k: [],
          activityOpen: false,
          activityOpenedAt: 0,
          rescueInFlight: false,
          reconnectAttempts: 0,
          duetRole: 'female',
          maleNoteTurns: 0,
          handoverInProgress: false,
          handoverEnqueued: false,
          handoverStartedAt: 0,
          liveWs: null,
          sttWs: null,
          sttReady: false,
          sttFinalText: '',
          sttInterimText: '',
          sttLastUpdateAt: 0,
          sttPendingChunks: [],
          turnFinalizeTimer: null,
          lastSubmittedTurnText: '',
          geminiReady: false,
          geminiSpeaking: false,
          lastCallerSpeechAt: Date.now(),
          lastAiActivityAt: Date.now(),
          silentNudgeCount: 0,
          pendingCallerText: '',
          pendingAiText: '',
          transcript: [],
          turns: 0,
          shouldHangupAfterDrain: false,
          closed: false,
          okResponseRaw: okResp,
        };

        this.activeBySipCallId.set(sipCallId, call);
        this.sendSip(okResp, rinfo.address, rinfo.port);
        this.startMediaAndGemini(call);
      });
    }
  }

  private enqueueOutPcm8k(call: ActiveLiveCall, samples: Int16Array) {
    if (call.closed || samples.length === 0) return;
    call.outPcm8kChunks.push(samples);
    call.outTotalQueuedSamples += samples.length;
  }

  private flushOutAudio(call: ActiveLiveCall) {
    call.outPcm8kChunks = [];
    call.outChunkIdx = 0;
    call.outSampleOffset = 0;
    call.outTotalQueuedSamples = 0;
    call.outStreamActive = false;
    call.out24kCarry = Buffer.alloc(0);
    call.lpX1 = 0;
    call.lpX2 = 0;
    call.lpY1 = 0;
    call.lpY2 = 0;
    call.dcPrevX = 0;
    call.dcPrevY = 0;
    call.outGateGain = 0;
    call.fadeFromSample = call.lastOutSample;
    call.lastOutSample = 0;
  }

  private applySmoothTurnTailFade(call: ActiveLiveCall) {
    // Cümle bittiğinde kuyruğun sonundaki çok hafif nefes/hışırtı kuyruğunu kırp ve son 20 ms'yi yumuşakça sıfıra indir
    let totalTail = 0;
    for (let i = call.outPcm8kChunks.length - 1; i >= call.outChunkIdx; i--) {
      const ch = call.outPcm8kChunks[i];
      const start = i === call.outChunkIdx ? call.outSampleOffset : 0;
      totalTail += ch.length - start;
      if (totalTail >= 240) break;
    }
    const fadeLen = Math.min(160, totalTail); // 20 ms yumuşak kapanış
    if (fadeLen <= 8) return;
    let remainingFromEnd = fadeLen;
    for (let i = call.outPcm8kChunks.length - 1; i >= call.outChunkIdx && remainingFromEnd > 0; i--) {
      const ch = call.outPcm8kChunks[i];
      const start = i === call.outChunkIdx ? call.outSampleOffset : 0;
      for (let j = ch.length - 1; j >= start && remainingFromEnd > 0; j--) {
        // Kuyruğun en sonu -> 0.0, fadeLen kadar öncesi -> 1.0 (yumuşak yarım kosinüs eğrisi)
        const distFromEnd = fadeLen - remainingFromEnd;
        const factor = 0.5 * (1 - Math.cos((Math.PI * distFromEnd) / fadeLen));
        ch[j] = Math.round(ch[j] * factor);
        remainingFromEnd--;
      }
    }
  }

  private hasQueuedOutAudio(call: ActiveLiveCall): boolean {
    return call.outTotalQueuedSamples > 0 && call.outChunkIdx < call.outPcm8kChunks.length;
  }

  private pullOutFrame8k(call: ActiveLiveCall, frameSamples = 160): Int16Array | null {
    // Söz kesme sonrası tek seferlik 4 ms yumuşak çıtırtısız sönümleme
    if (call.fadeFromSample !== 0 && !this.hasQueuedOutAudio(call)) {
      const decay = new Int16Array(frameSamples);
      const startVal = call.fadeFromSample;
      call.fadeFromSample = 0;
      const ramp = 32; // 4 ms
      for (let i = 0; i < ramp; i++) {
        decay[i] = Math.round(startVal * (1 - (i + 1) / ramp));
      }
      return decay;
    }

    if (call.outChunkIdx >= call.outPcm8kChunks.length || call.outTotalQueuedSamples <= 0) {
      if (!call.geminiSpeaking) {
        call.outStreamActive = false;
        call.outGateGain = 0;
      }
      if (call.lastOutSample !== 0) {
        const decay = new Int16Array(frameSamples);
        const startVal = call.lastOutSample;
        call.lastOutSample = 0;
        const ramp = 32; // 4 ms yumuşak geçiş (çıtırtısız)
        for (let i = 0; i < ramp; i++) {
          decay[i] = Math.round(startVal * (1 - (i + 1) / ramp));
        }
        return decay;
      }
      return null;
    }

    // Yeni konuşma başlarken 40 ms (320 örnek = 2 tam paket) temiz akış tamponu -> 1 sn altı hızlı tepki + sıfır kesilme!
    if (!call.outStreamActive && call.geminiSpeaking && call.outTotalQueuedSamples < 320) {
      return null;
    }
    call.outStreamActive = true;

    const out = new Int16Array(frameSamples);
    let filled = 0;
    while (filled < frameSamples && call.outChunkIdx < call.outPcm8kChunks.length) {
      const cur = call.outPcm8kChunks[call.outChunkIdx];
      const avail = cur.length - call.outSampleOffset;
      const take = Math.min(avail, frameSamples - filled);
      out.set(cur.subarray(call.outSampleOffset, call.outSampleOffset + take), filled);
      filled += take;
      call.outSampleOffset += take;
      call.outTotalQueuedSamples = Math.max(0, call.outTotalQueuedSamples - take);
      if (call.outSampleOffset >= cur.length) {
        call.outChunkIdx++;
        call.outSampleOffset = 0;
      }
    }

    const queueDrained = call.outChunkIdx >= call.outPcm8kChunks.length || call.outTotalQueuedSamples <= 0;
    if (queueDrained) {
      call.outPcm8kChunks = [];
      call.outChunkIdx = 0;
      call.outSampleOffset = 0;
      call.outTotalQueuedSamples = 0;
      // Konuşma sürerken geçici anlık boşlukta akışı sıfırlama; yalnızca konuşma tamamen bittiğinde sıfırla
      if (!call.geminiSpeaking) {
        call.outStreamActive = false;
      }
    }

    // Yalnızca sessizlikten konuşmaya ilk girişte 6 ms yumuşak açılış yap; konuşma içindeki hiçbir harfe/heceye dokunma!
    if (call.outGateGain < 1.0 && filled > 0) {
      const rampCount = Math.min(48, filled);
      const startGain = call.outGateGain;
      for (let i = 0; i < rampCount; i++) {
        const g = startGain + (1.0 - startGain) * ((i + 1) / rampCount);
        out[i] = Math.round(out[i] * g);
      }
      call.outGateGain = 1.0;
    }

    // Konuşma tamamen bittiyse son kısmi parçada ani sıfıra düşüşü önlemek için 6 ms yumuşak kapanış
    if (filled > 8 && filled < frameSamples && !call.geminiSpeaking) {
      const tailLen = Math.min(48, filled);
      for (let k = 0; k < tailLen; k++) {
        const idx = filled - tailLen + k;
        const f = 0.5 * (1 + Math.cos((Math.PI * (k + 1)) / tailLen));
        out[idx] = Math.round(out[idx] * f);
      }
      call.outGateGain = 0;
    }

    call.lastOutSample = out[frameSamples - 1] || 0;
    return out;
  }

  private downsample24kTo8k(call: ActiveLiveCall, pcm24kBuf: Buffer): Int16Array {
    // 2. derece Butterworth 3.4 kHz alçak geçiren anti-alias süzgeci (24 kHz -> 8 kHz):
    // Sesi %0 bozmadan ince tiz "s/ş/nefes" telsiz hışırtısını temizler + DC ofseti kaldırır!
    const combined = call.out24kCarry.length > 0 ? Buffer.concat([call.out24kCarry, pcm24kBuf]) : pcm24kBuf;
    const usableBytes = Math.floor(combined.length / 6) * 6;
    call.out24kCarry = combined.subarray(usableBytes);
    const outCount = usableBytes / 6;
    const out = new Int16Array(outCount);

    // Butterworth LP @ fc=3400 Hz, fs=24000 Hz (birim ses kazancı = 1.0000)
    const b0 = 0.119611;
    const b1 = 0.239222;
    const b2 = 0.119611;
    const a1 = -0.812277;
    const a2 = 0.290721;

    let x1 = call.lpX1;
    let x2 = call.lpX2;
    let y1 = call.lpY1;
    let y2 = call.lpY2;
    let dcPrevX = call.dcPrevX;
    let dcPrevY = call.dcPrevY;

    for (let i = 0; i < outCount; i++) {
      const base = i * 6;
      let y = 0;
      for (let sub = 0; sub < 3; sub++) {
        const x0 = combined.readInt16LE(base + sub * 2);
        y = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y;
      }
      // 8 kHz DC temizleyici (sıcak bas tonları koruyarak cümle sonu çıtırtısını önler)
      const dcClean = y - dcPrevX + 0.988 * dcPrevY;
      dcPrevX = y;
      dcPrevY = dcClean;

      const scaled = Math.round(dcClean * 0.82);
      out[i] = Math.max(-32767, Math.min(32767, scaled));
    }

    call.lpX1 = x1;
    call.lpX2 = x2;
    call.lpY1 = y1;
    call.lpY2 = y2;
    call.dcPrevX = dcPrevX;
    call.dcPrevY = dcPrevY;
    return out;
  }

  private sendRtpFrame(call: ActiveLiveCall, pcm8k: Int16Array | null) {
    if (call.closed) return;
    const pkt = Buffer.allocUnsafe(12 + 160);
    pkt[0] = 0x80;
    pkt[1] = call.payloadType & 0x7f;
    pkt.writeUInt16BE(call.rtpSeq & 0xffff, 2);
    pkt.writeUInt32BE(call.rtpTs >>> 0, 4);
    pkt.writeUInt32BE(call.rtpSsrc >>> 0, 8);

    if (pcm8k) {
      if (call.payloadType === 8) {
        for (let i = 0; i < 160; i++) pkt[12 + i] = linearToAlaw(pcm8k[i]);
      } else {
        for (let i = 0; i < 160; i++) pkt[12 + i] = linearToUlaw(pcm8k[i]);
      }
    } else {
      const silentByte = call.payloadType === 8 ? 0xd5 : 0xff;
      pkt.fill(silentByte, 12, 172);
    }

    call.rtpSeq = (call.rtpSeq + 1) & 0xffff;
    call.rtpTs = (call.rtpTs + 160) >>> 0;

    try {
      call.rtpSock.send(pkt, 0, pkt.length, call.remoteRtpPort, call.remoteRtpIp);
    } catch {}
  }

  private startMediaAndGemini(call: ActiveLiveCall) {
    // 1. Yüksek hassasiyetli (hrtime) sabit 20.000 ms tek-paket RTP gönderim saati:
    // Gelen cep hattındaki dalgalanmadan %100 bağımsız, tek seferde asla 1 paketten fazla basmaz (0 yığılma, 0 hece atlama!)
    const FRAME_NS = 20_000_000n;
    let nextTickNs = process.hrtime.bigint() + FRAME_NS;
    let drainHangupAt = 0;

    const rtpLoop = () => {
      if (call.closed) return;
      const nowNs = process.hrtime.bigint();
      if (nowNs >= nextTickNs - 1_500_000n) {
        const frame = this.pullOutFrame8k(call, 160);
        this.sendRtpFrame(call, frame);
        nextTickNs += FRAME_NS;
        // Olay döngüsü 60ms'den fazla gecikirse paketleri üst üste basıp kesilme yaratma, saati yumuşakça hizala
        if (nowNs - nextTickNs > 60_000_000n) {
          nextTickNs = nowNs + FRAME_NS;
        }

        const now = Date.now();
        // GERÇEK GSM HAT GECİKMESİ + YANKI KORUMASI: 650 ms hat ulaşım payı + 1650 ms sessizlik -> siz konuşmaya başlarken ASLA "Alo?" araya girmez!
        const gsmEarOffsetMs = 650;
        if (call.greetingEnqueued && !call.greetingDone && !this.hasQueuedOutAudio(call)) {
          call.greetingDone = true;
          call.echoGuardUntil = now + 260;
          call.preRollPcm16k = [];
          call.in16kAccum = [];
          call.in16kAccumBytes = 0;
          call.sttFinalText = '';
          call.sttInterimText = '';
          call.lastAiActivityAt = now + gsmEarOffsetMs;
          call.lastCallerSpeechAt = now + gsmEarOffsetMs;
        }

        if (call.handoverInProgress && call.handoverEnqueued && !this.hasQueuedOutAudio(call)) {
          call.handoverInProgress = false;
          call.handoverEnqueued = false;
          call.echoGuardUntil = now + 220;
          call.preRollPcm16k = [];
          call.in16kAccum = [];
          call.in16kAccumBytes = 0;
          call.sttFinalText = '';
          call.sttInterimText = '';
          call.lastAiActivityAt = now + gsmEarOffsetMs;
          call.lastCallerSpeechAt = now + gsmEarOffsetMs;
        }

        const nowPlayingOut = call.geminiSpeaking || this.hasQueuedOutAudio(call);
        if (call.outAudioWasPlaying && !nowPlayingOut) {
          // Asistan sustuğu anda 260 ms telefon yankı koruması aç + kendi yankısını ASLA canlı kulağa akıtma!
          call.echoGuardUntil = now + 260;
          call.preRollPcm16k = [];
          call.in16kAccum = [];
          call.in16kAccumBytes = 0;
          call.sttFinalText = '';
          call.sttInterimText = '';
          call.lastAiActivityAt = now + gsmEarOffsetMs;
          call.lastCallerSpeechAt = now + gsmEarOffsetMs;
        }
        call.outAudioWasPlaying = nowPlayingOut;

        if (call.shouldHangupAfterDrain && !this.hasQueuedOutAudio(call) && !call.geminiSpeaking) {
          if (!drainHangupAt) {
            drainHangupAt = now + 220;
          } else if (now >= drainHangupAt) {
            this.teardownCall(call, true);
            return;
          }
        }
      }

      const remMs = Number((nextTickNs - process.hrtime.bigint()) / 1_000_000n);
      const waitMs = Math.max(1, Math.min(18, remMs - 1));
      call.rtpTimer = setTimeout(rtpLoop, waitMs);
    };
    call.rtpTimer = setTimeout(rtpLoop, 20);

    // 2. Gelen arayan sesini (RTP) kesintisiz tam çift yönlü SAF SES kanalına akıt!
    call.rtpSock.on('message', (pkt, rinfo) => {
      if (call.closed || call.shouldHangupAfterDrain || pkt.length < 13) return;
      if (rinfo.address === '127.0.0.1' || rinfo.address === '178.208.187.42') {
        call.remoteRtpIp = rinfo.address;
        call.remoteRtpPort = rinfo.port;
      }

      const pt = pkt[1] & 0x7f;
      if (pt !== 8 && pt !== 0) return;

      const csrcCount = pkt[0] & 0x0f;
      const hasExt = (pkt[0] & 0x10) !== 0;
      let headerLen = 12 + csrcCount * 4;
      if (hasExt && pkt.length >= headerLen + 4) {
        headerLen += 4 + pkt.readUInt16BE(headerLen + 2) * 4;
      }
      if (pkt.length <= headerLen) return;

      const payload = pkt.subarray(headerLen);
      const n = payload.length;
      const table = pt === 8 ? ALAW_DECODE_TABLE : ULAW_DECODE_TABLE;

      // Sıfır kontör canlı hat sahibi internet görüşmesi aktifse arayanın 8kHz sesini doğrudan telefon ahizesine akıt
      if (call.ownerAudioActive) {
        if (call.ownerAudioCb) {
          const pcm8kBuf = Buffer.allocUnsafe(n * 2);
          for (let i = 0; i < n; i++) {
            pcm8kBuf.writeInt16LE(table[payload[i]], i * 2);
          }
          try {
            call.ownerAudioCb(pcm8kBuf);
          } catch {}
        }
        return;
      }

      // 8kHz -> 16kHz lineer ara değerleme (2x)
      const pcm16k = Buffer.allocUnsafe(n * 4);
      let sumSq = 0;
      let prev = call.prevInSample;
      for (let i = 0; i < n; i++) {
        const s = table[payload[i]];
        sumSq += s * s;
        const mid = (prev + s) >> 1;
        pcm16k.writeInt16LE(mid, i * 4);
        pcm16k.writeInt16LE(s, i * 4 + 2);
        prev = s;
      }
      call.prevInSample = prev;
      const frameRms = Math.sqrt(sumSq / n);

      const nowMs = Date.now();
      const aiAudioPlaying = call.geminiSpeaking || this.hasQueuedOutAudio(call);

      // 1) Açılış anonsu veya düet devri sürerken hoparlör yankısı anonsu ASLA kesmesin
      if (!call.greetingDone) {
        if (call.greetingStartedAt > 0 && nowMs - call.greetingStartedAt > 12000) {
          call.greetingDone = true;
        } else {
          call.loudBargeStreak = 0;
          call.voiceFrameStreak = 0;
          call.preRollPcm16k = [];
          return;
        }
      }
      if (call.handoverInProgress) {
        if (call.handoverStartedAt > 0 && nowMs - call.handoverStartedAt > 12000) {
          call.handoverInProgress = false;
          call.handoverEnqueued = false;
        } else {
          call.loudBargeStreak = 0;
          call.voiceFrameStreak = 0;
          call.preRollPcm16k = [];
          call.in16kAccum = [];
          call.in16kAccumBytes = 0;
          return;
        }
      }

      // 2) Asistan konuşurken: sözünü tamamen bitirmeden arayan bir şey söylese bile ASLA sözünü kesmez, dinlemeye geçmez ve cevap vermez!
      if (aiAudioPlaying) {
        call.loudBargeStreak = 0;
        call.voiceFrameStreak = 0;
        call.preRollPcm16k = [];
        call.in16kAccum = [];
        call.in16kAccumBytes = 0;
        return;
      }

      call.loudBargeStreak = 0;

      // 2b) Asistan sustuktan sonraki 260 ms telefon yankı koruması: yankı kulağa girip saçma cümle oluşturamasın!
      if (nowMs < call.echoGuardUntil) {
        const directOverrideThresh = Math.max(780, Math.round(call.ambientNoiseRms * 2.5));
        if (frameRms < directOverrideThresh) {
          return;
        }
        call.echoGuardUntil = 0;
      }

      // 3) KÖKTEN ÇÖZÜM — SÜREKLİ CANLI KELİME ALGILAMA + GERÇEK ODA TABANI + TEPE-GÖRECELİ SÖZ BİTİŞİ!
      // Oda uğultusu 50 de olsa 350 de olsa 700 de olsa:
      // - Ses sürekli canlı kelime kulağına (sttWs) akar; gerçek Türkçe kelime gelmedikçe 1 sn "Alo?" ASLA engellenmez!
      // - Gerçek kelime geldikten sonra ses tepe değerinden oda tabanına düştüğü an (veya 420 ms yeni kelime gelmeyince) 11 sn beklemeden ANINDA yanıtlanır!
      const liveTextSoFar = `${call.sttFinalText} ${call.sttInterimText}`.trim();
      const hasLiveWords = isMeaningfulTurkishSpeech(liveTextSoFar);
      const isMaleNote = call.duetRole === 'male_note';

      // Gerçek kelime akmıyorken oda gürültü tabanını (850'ye kadar) doğal olarak ölç ve öğren
      if (!hasLiveWords && !call.activityOpen) {
        const clampedFloor = Math.min(frameRms, 850);
        call.ambientNoiseRms = call.ambientNoiseRms * 0.90 + clampedFloor * 0.10;
      }

      // Doğrudan konuşma (oda uğultusunun belirgin üstünde)
      const loudVoiceThresh = Math.max(340, Math.min(1400, Math.round(call.ambientNoiseRms * 1.95)));
      if (frameRms >= loudVoiceThresh) {
        call.voiceFrameStreak++;
        if (call.activityOpen || call.voiceFrameStreak >= 2) {
          call.lastVoiceFrameAt = nowMs;
          call.lastLoudVoiceAt = nowMs;
          if (frameRms > call.turnPeakRms) call.turnPeakRms = frameRms;
          call.quietFrameStreak = 0;
          call.audioEndNudgeSent = false;
          if (call.turnFinalizeTimer) {
            clearTimeout(call.turnFinalizeTimer);
            call.turnFinalizeTimer = null;
          }
          if (!call.activityOpen) {
            call.turnEpoch++;
            call.activityOpen = true;
            call.activityOpenedAt = nowMs;
            call.recentSpeechPcm16k = [];
            if (!call.sttWs) {
              this.openFreshSttWs(call);
            }
          }
        }
      } else {
        call.voiceFrameStreak = 0;
      }

      // Ses tepe değerinden oda gürültüsüne indi mi? (Örn: ses 2500 -> oda 290'a düştüğü an söz bitmiştir!)
      const dropThresh = Math.max(
        Math.round(call.ambientNoiseRms * 1.38),
        Math.round(call.turnPeakRms * 0.28),
        220
      );
      if (call.activityOpen || hasLiveWords) {
        if (frameRms < dropThresh) {
          call.quietFrameStreak++;
        } else {
          call.quietFrameStreak = 0;
          call.lastVoiceFrameAt = nowMs;
          if (frameRms > call.turnPeakRms) call.turnPeakRms = frameRms;
        }
      }

      // Dinleme modundayken gelen sesi kesintisiz olarak canlı kelime kulağına (sttWs) akıt!
      const outChunk16k = boostQuietPcm16k(pcm16k, frameRms);
      call.in16kAccum.push(outChunk16k);
      call.in16kAccumBytes += outChunk16k.length;
      if (call.in16kAccumBytes >= 1920) {
        // 60ms @ 16kHz mono 16-bit = 1920 byte
        const merged = Buffer.concat(call.in16kAccum);
        call.in16kAccum = [];
        call.in16kAccumBytes = 0;

        if (!call.sttWs) {
          this.openFreshSttWs(call);
        }
        if (call.turnFinalizeTimer && call.sttReady && call.sttWs && call.sttWs.isReady()) {
          call.sttWs.sendAudioPcm16k(PURE_ZERO_1920);
        } else {
          this.sendChunkToStt(call, merged);
        }

        if (call.activityOpen || hasLiveWords) {
          call.recentSpeechPcm16k.push(merged);
          if (call.recentSpeechPcm16k.length > 90) {
            call.recentSpeechPcm16k.shift();
          }
        } else {
          call.preRollPcm16k.push(merged);
          if (call.preRollPcm16k.length > 4) {
            call.preRollPcm16k.shift();
          }
        }
      }

      // SÖZ BİTİŞİ (Cümleyi ASLA ortadan bölmeden doğal bitişi bekler, bittiği anda da bekletmeden yanıtlar!):
      // 1) Canlı kelimeler geldiyse: ses oda tabanına 540 ms (not modunda 640 ms) inince VEYA yeni kelime 820 ms (not: 1050 ms) durunca gönder!
      const quietFramesNeeded = isMaleNote ? 32 : 27;
      const wordPauseMs = isMaleNote ? 1050 : 820;
      const sinceStt = call.sttLastUpdateAt > 0 ? nowMs - call.sttLastUpdateAt : 9999;

      if (hasLiveWords && !call.turnFinalizeTimer) {
        if (
          (call.quietFrameStreak >= quietFramesNeeded && sinceStt >= (isMaleNote ? 520 : 380)) ||
          sinceStt >= wordPauseMs ||
          (call.activityOpenedAt > 0 && nowMs - call.activityOpenedAt >= 12000)
        ) {
          call.activityOpen = true;
          this.finishCallerTurnNow(call, nowMs);
        }
      } else if (
        call.activityOpen &&
        !hasLiveWords &&
        !call.turnFinalizeTimer &&
        ((call.quietFrameStreak >= 12 && nowMs - call.activityOpenedAt >= 260) ||
          nowMs - call.activityOpenedAt >= 2200)
      ) {
        // Sadece oda gürültüsü müydü yoksa kısa bir söz mü?
        if (call.turnPeakRms >= Math.max(520, Math.round(call.ambientNoiseRms * 2.2))) {
          this.finishCallerTurnNow(call, nowMs);
        } else {
          call.activityOpen = false;
          call.turnPeakRms = 0;
          call.quietFrameStreak = 0;
          call.recentSpeechPcm16k = [];
        }
      }
    });

    // 3. Hassas 50 ms bekçi: kopma kurtarıcı + kelime durunca anında gönderici + ŞAŞMAZ 1.0 sn "Alo?" yoklayıcı!
    call.silenceWatchdog = setInterval(() => {
      if (call.closed || call.shouldHangupAfterDrain || call.ownerAudioActive) return;
      const now = Date.now();

      // A) Çıkan ses bittiği halde konuşuyor bayrağı takılı kaldıysa anında aç
      if (call.geminiSpeaking && !this.hasQueuedOutAudio(call) && now - call.lastAiActivityAt >= 1800) {
        call.geminiSpeaking = false;
        call.greetingDone = true;
      }

      // B) Canlı bağlantı beklenmedik şekilde düştüyse anında yenile
      if ((!call.geminiReady || !call.liveWs || !call.liveWs.isReady()) && call.greetingTriggered) {
        if (now - call.lastAiActivityAt >= 1400 && call.reconnectAttempts < 4) {
          this.reconnectGeminiMidCall(call, call.callerHadSpeechSinceReply && call.recentSpeechPcm16k.length > 0);
        }
        return;
      }

      if (!call.geminiReady || !call.liveWs || !call.liveWs.isReady()) return;

      const isMaleNote = call.duetRole === 'male_note';
      const hasLiveWords = isMeaningfulTurkishSpeech(`${call.sttFinalText} ${call.sttInterimText}`);

      // C) Canlı kelimeler geldi ve cümle tamamlanıp durduysa 820 ms'de (not: 1050 ms) gönder!
      if (hasLiveWords && !call.turnFinalizeTimer && !call.geminiSpeaking && !this.hasQueuedOutAudio(call)) {
        const sinceStt = call.sttLastUpdateAt > 0 ? now - call.sttLastUpdateAt : 9999;
        if (sinceStt >= (isMaleNote ? 1050 : 820)) {
          call.activityOpen = true;
          this.finishCallerTurnNow(call, now);
          return;
        }
        return;
      }

      // C1) Kelime gelmeden açık kalmış ham ses varsa 1.2 sn'de temizle ki 1 sn "Alo?"yu ASLA tıkamasın
      if (call.activityOpen && !hasLiveWords && !call.turnFinalizeTimer) {
        const openDur = now - call.activityOpenedAt;
        const sinceLoud = now - call.lastLoudVoiceAt;
        if (sinceLoud >= 320 && openDur >= 320) {
          if (call.turnPeakRms >= Math.max(520, Math.round(call.ambientNoiseRms * 2.2))) {
            this.finishCallerTurnNow(call, now);
            return;
          }
          call.activityOpen = false;
          call.turnPeakRms = 0;
          call.quietFrameStreak = 0;
          call.recentSpeechPcm16k = [];
        } else if (openDur >= 1500) {
          call.activityOpen = false;
          call.turnPeakRms = 0;
          call.quietFrameStreak = 0;
          call.recentSpeechPcm16k = [];
        }
      }

      // C2) Canlı ses bağlantısı 2.4 sn içinde yanıt başlatmazsa bağlantıyı tazele ve arayanın son sözünü otomatik tekrar ilet
      if (
        call.greetingDone &&
        !call.handoverInProgress &&
        !call.geminiSpeaking &&
        !this.hasQueuedOutAudio(call) &&
        call.audioEndNudgeSent &&
        !call.rescueInFlight &&
        now - call.audioEndSentAt >= 2400
      ) {
        call.audioEndNudgeSent = false;
        if (call.reconnectAttempts < 4) {
          const shouldReplay = call.callerHadSpeechSinceReply && call.recentSpeechPcm16k.length > 0;
          call.callerHadSpeechSinceReply = false;
          this.reconnectGeminiMidCall(call, shouldReplay);
        } else {
          call.callerHadSpeechSinceReply = false;
        }
        return;
      }

      // Aktif konuşma yeni başlamışsa (son 900 ms'de ses geldiyse) "Alo?" ASLA araya girmesin!
      const activelySpeakingLoud = now - call.lastLoudVoiceAt < 900 || now - call.lastVoiceFrameAt < 900;
      if (
        !call.greetingDone ||
        call.handoverInProgress ||
        call.geminiSpeaking ||
        this.hasQueuedOutAudio(call) ||
        hasLiveWords ||
        activelySpeakingLoud ||
        call.turnFinalizeTimer ||
        call.audioEndNudgeSent ||
        call.rescueInFlight
      ) {
        return;
      }

      // D) MÜHÜRLÜ GERÇEK SESSİZLİK UYARISI (650 ms hat ulaşım payı + 1650 ms sessizlik -> siz konuşmaya başlarken ASLA araya girmez!)
      const silentFor = Math.min(now - call.lastCallerSpeechAt, now - call.lastAiActivityAt);
      const silenceNudgeMs = isMaleNote ? 2100 : 1650;
      if (silentFor >= silenceNudgeMs) {
        call.activityOpen = false;
        call.turnPeakRms = 0;
        call.quietFrameStreak = 0;
        call.recentSpeechPcm16k = [];
        call.sttFinalText = '';
        call.sttInterimText = '';
        call.lastAiActivityAt = now;
        call.lastCallerSpeechAt = now;
        call.silentNudgeCount++;
        const nudgeText =
          call.silentNudgeCount === 1
            ? 'Alo? Beni duyabiliyor musunuz, buyurun?'
            : call.silentNudgeCount === 2
            ? 'Alo, sesiniz gelmiyor sanırım, hatta mısınız?'
            : 'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.';
        const isFinalSilenceHangup = call.silentNudgeCount >= 3;
        if (isFinalSilenceHangup) {
          this.lockForHangup(call, true);
        }
        const nudgeVoice: 'Kore' | 'Orus' = isMaleNote && !isFinalSilenceHangup ? 'Orus' : 'Kore';
        const instantNudge = getCachedLiveVoiceClip8k(nudgeText, nudgeVoice);
        if (instantNudge) {
          this.enqueueOutPcm8k(call, instantNudge);
          call.lastAiActivityAt = Date.now();
          call.lastCallerSpeechAt = Date.now();
          call.transcript.push({ speaker: 'AI', text: nudgeText });
          this.persistTranscript(call, false);
        } else {
          call.geminiSpeaking = true;
          void ensureLiveVoiceClip8k(nudgeText, nudgeVoice).then((clip) => {
            if (call.closed) return;
            if (clip) {
              this.enqueueOutPcm8k(call, clip.pcm8k);
              call.lastAiActivityAt = Date.now();
              call.lastCallerSpeechAt = Date.now();
              call.transcript.push({ speaker: 'AI', text: nudgeText });
              this.persistTranscript(call, false);
            }
            call.geminiSpeaking = false;
          });
        }
      }
    }, 50);

    // 4. Çift kanallı milisaniye motorunu hemen aç: (A) gemini-3.8-live sesli beyin + (B) gemini-3.5-transcribe-live canlı kulak!
    call.greetingTriggered = true;
    call.greetingStartedAt = Date.now();
    this.connectGeminiLive(call, false, false, false);
    this.openFreshSttWs(call);
    // Kısa veda, dinleme karşılığı ve 3 sessizlik uyarı sesini arka planda önceden hazır tut (0 ms anında tepki için)
    void ensureLiveVoiceClip8k('Rica ederim, iyi günler dilerim.', 'Kore');
    void ensureLiveVoiceClip8k('Buyurun, sizi dinliyorum, size nasıl yardımcı olabilirim?', 'Kore');
    void ensureLiveVoiceClip8k('Buyurun, hangi konuda görüşmek istemiştiniz?', 'Kore');
    void ensureLiveVoiceClip8k('Tabii, bekliyorum, buyurun.', 'Kore');
    void ensureLiveVoiceClip8k('Alo? Beni duyabiliyor musunuz, buyurun?', 'Kore');
    void ensureLiveVoiceClip8k('Alo, sesiniz gelmiyor sanırım, hatta mısınız?', 'Kore');
    void ensureLiveVoiceClip8k(
      'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.',
      'Kore'
    );

    const startGreetingImmediately = async () => {
      // MÜHÜRLÜ AÇILIŞ KURALI: Başta arayan kişinin adı KULLANILMAZ; herkese doğrudan temiz kurumsal açılış çalınır!
      let chosenClip: Int16Array | null = null;
      const spokenText = call.ctx.greetingText;

      const instantBase = getCachedLiveVoiceClip8k(spokenText, 'Kore');
      if (instantBase) {
        chosenClip = instantBase;
      } else {
        const fetched = await ensureLiveKoreClip8k(spokenText);
        chosenClip = fetched?.pcm8k || null;
      }

      if (call.closed) return;
      if (chosenClip && !call.greetingDone) {
        // 760 ms temiz GSM hat oturma payı -> telefon açıldığında "Merhaba" ve firma adı ("Santral Bayi") ASLA yutulmaz, baştan sona net duyulur!
        this.enqueueOutPcm8k(call, new Int16Array(6080));
        this.enqueueOutPcm8k(call, chosenClip);
        call.greetingEnqueued = true;
        call.greetingStartedAt = Date.now();
        call.lastAiActivityAt = Date.now();
        call.lastCallerSpeechAt = Date.now();
        call.ctx.greetingText = spokenText;
        call.transcript.push({ speaker: 'AI', text: spokenText });
        this.persistTranscript(call, false);
      } else {
        call.greetingEnqueued = true;
        call.greetingDone = true;
      }
    };

    void startGreetingImmediately();
  }

  private openFreshSttWs(call: ActiveLiveCall) {
    if (call.closed || !process.env.GEMINI_API_KEY) return;
    if (call.sttWs) {
      try {
        call.sttWs.close(1000, 'next_turn');
      } catch {}
      call.sttWs = null;
    }
    call.sttReady = false;
    call.sttFinalText = '';
    call.sttInterimText = '';
    call.sttLastUpdateAt = 0;

    const sttWs = new NativeIpv4GeminiLiveWs({
      apiKey: process.env.GEMINI_API_KEY.trim(),
      model: 'gemini-3.5-transcribe-live',
      voiceName: 'Kore',
      systemInstruction: '',
      transcribeOnly: true,
      onSetupComplete: () => {
        if (call.closed || call.sttWs !== sttWs) return;
        call.sttReady = true;
        if (call.sttPendingChunks.length > 0) {
          const queued = call.sttPendingChunks.splice(0, call.sttPendingChunks.length);
          for (const chunk of queued) {
            sttWs.sendAudioPcm16k(chunk);
          }
        }
      },
      onMessage: (msg: any) => {
        if (call.closed || call.sttWs !== sttWs) return;
        const sc = msg?.serverContent;
        if (!sc) return;
        if (sc.interimInputTranscription?.text) {
          const piece = String(sc.interimInputTranscription.text).trim();
          call.sttInterimText = piece;
          if (isMeaningfulTurkishSpeech(piece)) {
            call.sttLastUpdateAt = Date.now();
            call.lastCallerSpeechAt = Date.now();
            call.silentNudgeCount = 0;
            call.callerHadSpeechSinceReply = true;
            if (!call.activityOpen) {
              call.activityOpen = true;
              call.activityOpenedAt = Date.now();
            }
          }
        }
        if (sc.inputTranscription?.text) {
          const piece = String(sc.inputTranscription.text).trim();
          if (piece) {
            call.sttFinalText = (call.sttFinalText ? `${call.sttFinalText} ${piece}` : piece).trim();
            call.sttInterimText = '';
            if (isMeaningfulTurkishSpeech(piece)) {
              call.sttLastUpdateAt = Date.now();
              call.lastCallerSpeechAt = Date.now();
              call.silentNudgeCount = 0;
              call.callerHadSpeechSinceReply = true;
              if (!call.activityOpen) {
                call.activityOpen = true;
                call.activityOpenedAt = Date.now();
              }
            }
          }
        }
      },
      onError: () => {},
      onClose: () => {
        if (call.sttWs === sttWs) {
          call.sttReady = false;
          call.sttWs = null;
        }
      },
    });
    call.sttWs = sttWs;
  }

  private sendChunkToStt(call: ActiveLiveCall, chunk16k: Buffer) {
    if (call.closed || chunk16k.length === 0) return;
    if (call.sttReady && call.sttWs && call.sttWs.isReady()) {
      call.sttWs.sendAudioPcm16k(chunk16k);
    } else {
      call.sttPendingChunks.push(chunk16k);
      if (call.sttPendingChunks.length > 45) {
        call.sttPendingChunks.shift();
      }
    }
  }

  private lockForHangup(call: ActiveLiveCall, closeLiveVoice = false) {
    call.shouldHangupAfterDrain = true;
    call.activityOpen = false;
    call.voiceFrameStreak = 0;
    call.quietFrameStreak = 0;
    call.loudBargeStreak = 0;
    call.in16kAccum = [];
    call.in16kAccumBytes = 0;
    call.recentSpeechPcm16k = [];
    call.preRollPcm16k = [];
    call.sttPendingChunks = [];
    if (call.turnFinalizeTimer) {
      clearTimeout(call.turnFinalizeTimer);
      call.turnFinalizeTimer = null;
    }
    if (call.sttWs) {
      try {
        call.sttWs.close(1000, 'hangup_locked');
      } catch {}
      call.sttWs = null;
      call.sttReady = false;
    }
    if (closeLiveVoice && call.liveWs) {
      try {
        call.liveWs.close(1000, 'instant_farewell_hangup');
      } catch {}
      call.liveWs = null;
      call.geminiReady = false;
    }
  }

  private finishCallerTurnNow(call: ActiveLiveCall, nowMs: number) {
    if (call.closed || call.shouldHangupAfterDrain || !call.activityOpen) return;
    if (call.in16kAccumBytes > 0) {
      const tail = Buffer.concat(call.in16kAccum);
      call.in16kAccum = [];
      call.in16kAccumBytes = 0;
      this.sendChunkToStt(call, tail);
      call.recentSpeechPcm16k.push(tail);
    }
    this.sendChunkToStt(call, PURE_ZERO_1920);
    call.activityOpen = false;
    call.turnPeakRms = 0;
    call.quietFrameStreak = 0;
    call.audioEndNudgeSent = true;
    call.audioEndSentAt = nowMs;

    const myEpoch = call.turnEpoch;
    const speechSnapshot = call.recentSpeechPcm16k.length > 0 ? Buffer.concat(call.recentSpeechPcm16k) : Buffer.alloc(0);

    if (call.turnFinalizeTimer) {
      clearTimeout(call.turnFinalizeTimer);
      call.turnFinalizeTimer = null;
    }

    // MÜHÜRLÜ 1.0 SN CEVAP DENGESİ: Canlı kulak son kelimeyi tamamlayınca (20 ms tarama, en fazla 95 ms) anında sesli beyne gönder!
    const startedWaitAt = Date.now();
    const checkAndDispatch = () => {
      call.turnFinalizeTimer = null;
      if (call.closed || call.shouldHangupAfterDrain || call.turnEpoch !== myEpoch || call.activityOpen) return;
      const nowCheck = Date.now();
      const hasFinal = isMeaningfulTurkishSpeech(call.sttFinalText);
      const hasInterim = isMeaningfulTurkishSpeech(call.sttInterimText);
      const quietSinceStt = call.sttLastUpdateAt > 0 ? nowCheck - call.sttLastUpdateAt : 999;
      const waitedMs = nowCheck - startedWaitAt;
      if (
        (hasFinal && quietSinceStt >= 45) ||
        (hasInterim && quietSinceStt >= 60) ||
        waitedMs >= 95
      ) {
        void this.submitCallerTurnToLiveVoice(call, myEpoch, speechSnapshot);
        return;
      }
      call.turnFinalizeTimer = setTimeout(checkAndDispatch, 20);
    };

    const alreadySettled =
      (isMeaningfulTurkishSpeech(call.sttFinalText) || isMeaningfulTurkishSpeech(call.sttInterimText)) &&
      call.sttLastUpdateAt > 0 &&
      nowMs - call.sttLastUpdateAt >= 60;
    call.turnFinalizeTimer = setTimeout(checkAndDispatch, alreadySettled ? 15 : 25);
  }

  private async submitCallerTurnToLiveVoice(call: ActiveLiveCall, myEpoch: number, speechBuf: Buffer) {
    if (call.closed || call.shouldHangupAfterDrain || call.turnEpoch !== myEpoch || call.activityOpen) return;

    let spoken = `${call.sttFinalText} ${call.sttInterimText}`.replace(/\s+/g, ' ').trim();

    // Canlı kulakta anlamlı kelime henüz yoksa YALNIZCA gerçekten oda gürültüsünün 2.2 katı üstünde net ses varsa yedek çözümleyiciyle kontrol et!
    if (!isMeaningfulTurkishSpeech(spoken) && speechBuf.length >= 640) {
      let peakRms = 0;
      for (let off = 0; off + 640 <= speechBuf.length; off += 640) {
        let s2 = 0;
        for (let j = 0; j < 640; j += 2) {
          const v = speechBuf.readInt16LE(off + j);
          s2 += v * v;
        }
        const r = Math.sqrt(s2 / 320);
        if (r > peakRms) peakRms = r;
      }
      if (peakRms >= Math.max(520, Math.round(call.ambientNoiseRms * 2.1))) {
        call.rescueInFlight = true;
        try {
          const fb = await transcribePcm16kFastIpv4(speechBuf);
          if (call.closed || call.shouldHangupAfterDrain || call.turnEpoch !== myEpoch || call.activityOpen) return;
          spoken = fb.trim();
        } finally {
          call.rescueInFlight = false;
        }
      } else {
        spoken = '';
      }
    }

    if (call.closed || call.shouldHangupAfterDrain || call.turnEpoch !== myEpoch || call.activityOpen) return;

    if (!isMeaningfulTurkishSpeech(spoken)) {
      // Sadece oda uğultusu / anlamsız nefes ("Mhm.") -> sessizlik sayacını ASLA sıfırlama!
      call.audioEndNudgeSent = false;
      call.callerHadSpeechSinceReply = false;
      call.sttFinalText = '';
      call.sttInterimText = '';
      call.sttPendingChunks = [];
      return;
    }

    // 8 kHz telefon hattında yetkili adındaki yakın harf kaymalarını ("Kerem Bey" -> "Kenan Bey") anında doğru ada çevir!
    spoken = fixOwnerNamePhoneticSlip(spoken, call.ctx.personHonorific);

    // Arayan konuyu bitirdiğinde ("hayır teşekkürler, yok, bu kadar, tamam sağ ol, iyi günler, kapat...")
    // gereksiz sohbete hiç girmeden dinlemeyi anında kilitle, tek kısa veda söyle ve telefonu doğrudan kapat!
    const hasSubstantiveRequest =
      /(fiyat|ücret|kaç para|ne kadar|adres|nerede|konum|randevu|sipariş|not bırak|not al|söyle|ilet|mesaj|görüşebilir|bağlar|aktar|soru|bilgi|öğrenmek|sormak|yardım|istiyorum|lazım|arıyorum|hakkında|saat kaç|açık mı)/i.test(
        spoken
      );
    const isDirectFarewell =
      /(iyi günler|iyi akşamlar|iyi geceler|hoşça kal|görüşürüz|görüşmek üzere|kolay gelsin|eyvallah|kapatıyorum|kapatalım|kapatsana|kapasana|kapatabilirsin|kapat artık|telefonu kapat|bitirelim|sağ olun.*iyi|teşekkür.*iyi|hayır.*teşekkür|hayır.*sağ|yok.*teşekkür|yok.*sağ|yok.*gerek|gerek yok|başka.*yok|başka bir.*yok|hepsi bu kadar|bu kadar.*teşekkür|bu kadar.*sağ|tamam.*teşekkür|tamam.*sağ|tamam.*yok|tamam.*kapat)/i.test(
        spoken
      );
    const lastAiText = [...call.transcript].reverse().find((t) => t.speaker === 'AI')?.text || '';
    const aiJustAskedClosingQ =
      call.duetRole === 'female_after_note' ||
      /(başka.*(konu|isteğiniz|yardımcı|bir şey).*var mı|not bırakmak ister misiniz|eklemek istediğiniz)/i.test(
        lastAiText
      );
    const isShortNoThanks =
      aiJustAskedClosingQ &&
      spoken.length <= 65 &&
      /(hayır|yok|yoktur|tamam|bu kadar|yeterli|gerek yok|istemiyorum|sağ ol|sağol|teşekkür|mersi|eyvallah|kapat)/i.test(
        spoken
      );
    const allowCloseInCurrentRole =
      call.duetRole !== 'male_note' ||
      /(kapat|kapatsana|kapasana|iyi günler|iyi akşamlar|hoşça kal|görüşürüz|gerek yok)/i.test(spoken);

    if (!hasSubstantiveRequest && allowCloseInCurrentRole && (isDirectFarewell || isShortNoThanks)) {
      const farewellText = 'Rica ederim, iyi günler dilerim.';
      call.transcript.push({ speaker: 'CALLER', text: spoken });
      call.pendingCallerText = '';
      call.pendingAiText = '';
      call.turns++;
      this.lockForHangup(call, true);
      call.geminiSpeaking = true;
      const instantFarewell = getCachedLiveVoiceClip8k(farewellText, 'Kore');
      if (instantFarewell) {
        this.enqueueOutPcm8k(call, instantFarewell);
        call.geminiSpeaking = false;
        call.transcript.push({ speaker: 'AI', text: farewellText });
        this.persistTranscript(call, false);
      } else {
        void ensureLiveVoiceClip8k(farewellText, 'Kore').then((clip) => {
          if (call.closed) return;
          if (clip) {
            this.enqueueOutPcm8k(call, clip.pcm8k);
          }
          call.geminiSpeaking = false;
          call.transcript.push({ speaker: 'AI', text: farewellText });
          this.persistTranscript(call, false);
        });
      }
      return;
    }

    // Arayan sadece "Alo / Efendim / Buyurun" gibi hat kontrol sözü söylediyse başka konuya atlamadan 0 ms'de "Buyurun, sizi dinliyorum..." de!
    const isPureCheckIn =
      call.duetRole !== 'male_note' &&
      spoken.length <= 28 &&
      /^(alo|efendim|buyurun|buyrun|merhaba|selam|evet alo|alo efendim|duyuyorum|buradayım|hattayım|dinliyorum|evet buyurun)[.?!,\s]*$/i.test(
        spoken
      );
    if (isPureCheckIn) {
      const listenPrompt = /(sizi dinliyorum|nasıl yardımcı olabilirim)/i.test(lastAiText)
        ? 'Buyurun, hangi konuda görüşmek istemiştiniz?'
        : 'Buyurun, sizi dinliyorum, size nasıl yardımcı olabilirim?';
      call.transcript.push({ speaker: 'CALLER', text: spoken });
      call.pendingCallerText = '';
      call.pendingAiText = '';
      call.turns++;
      call.audioEndNudgeSent = false;
      call.callerHadSpeechSinceReply = false;
      call.silentNudgeCount = 0;
      call.sttPendingChunks = [];
      this.openFreshSttWs(call);
      const instantListen = getCachedLiveVoiceClip8k(listenPrompt, 'Kore');
      if (instantListen) {
        this.enqueueOutPcm8k(call, instantListen);
        call.lastAiActivityAt = Date.now();
        call.lastCallerSpeechAt = Date.now();
        call.transcript.push({ speaker: 'AI', text: listenPrompt });
        this.persistTranscript(call, false);
      } else {
        call.geminiSpeaking = true;
        void ensureLiveVoiceClip8k(listenPrompt, 'Kore').then((clip) => {
          if (call.closed) return;
          if (clip) {
            this.enqueueOutPcm8k(call, clip.pcm8k);
            call.lastAiActivityAt = Date.now();
            call.lastCallerSpeechAt = Date.now();
            call.transcript.push({ speaker: 'AI', text: listenPrompt });
            this.persistTranscript(call, false);
          }
          call.geminiSpeaking = false;
        });
      }
      return;
    }

    // Arayan "Dur / Bekle / Bir saniye / Pardon" dediğinde ASLA veda edip kapatma; nazikçe bekle!
    const isShortWaitPause =
      call.duetRole !== 'male_note' &&
      spoken.length <= 28 &&
      /^(dur|durun|bekle|bekleyin|bir saniye|bi saniye|bir dakika|bi dakika|bir dk|pardon|saniye)[.?!,\s]*$/i.test(
        spoken
      );
    if (isShortWaitPause) {
      const waitPrompt = 'Tabii, bekliyorum, buyurun.';
      call.transcript.push({ speaker: 'CALLER', text: spoken });
      call.pendingCallerText = '';
      call.pendingAiText = '';
      call.turns++;
      call.audioEndNudgeSent = false;
      call.callerHadSpeechSinceReply = false;
      call.silentNudgeCount = 0;
      call.sttPendingChunks = [];
      this.openFreshSttWs(call);
      const instantWait = getCachedLiveVoiceClip8k(waitPrompt, 'Kore');
      if (instantWait) {
        this.enqueueOutPcm8k(call, instantWait);
        call.lastAiActivityAt = Date.now();
        call.lastCallerSpeechAt = Date.now();
        call.transcript.push({ speaker: 'AI', text: waitPrompt });
        this.persistTranscript(call, false);
      } else {
        call.geminiSpeaking = true;
        void ensureLiveVoiceClip8k(waitPrompt, 'Kore').then((clip) => {
          if (call.closed) return;
          if (clip) {
            this.enqueueOutPcm8k(call, clip.pcm8k);
            call.lastAiActivityAt = Date.now();
            call.lastCallerSpeechAt = Date.now();
            call.transcript.push({ speaker: 'AI', text: waitPrompt });
            this.persistTranscript(call, false);
          }
          call.geminiSpeaking = false;
        });
      }
      return;
    }

    // Bir sonraki konuşma turu için taze canlı kulak bağlantısını arka planda 0 ms gecikmeyle hemen hazırla!
    call.sttPendingChunks = [];
    this.openFreshSttWs(call);

    call.pendingCallerText = spoken;
    call.lastSubmittedTurnText = spoken;
    call.lastCallerSpeechAt = Date.now();
    call.audioEndNudgeSent = true;
    call.audioEndSentAt = Date.now();
    call.silentNudgeCount = 0;

    if (call.geminiReady && call.liveWs && call.liveWs.isReady()) {
      call.liveWs.sendClientTurnText(spoken);
    } else if (call.reconnectAttempts < 4) {
      this.reconnectGeminiMidCall(call, true);
    }
  }

  private reconnectGeminiMidCall(call: ActiveLiveCall, replayRecentSpeech: boolean) {
    if (call.closed || call.reconnectAttempts >= 4) return;
    call.reconnectAttempts++;
    call.lastAiActivityAt = Date.now();
    call.geminiReady = false;
    call.geminiSpeaking = false;
    call.activityOpen = false;
    call.greetingDone = true;
    if (!replayRecentSpeech) {
      call.lastSubmittedTurnText = '';
    }
    call.recentSpeechPcm16k = [];
    call.preRollPcm16k = [];
    if (call.liveWs) {
      try {
        call.liveWs.close(1000, 'midcall_refresh');
      } catch {}
      call.liveWs = null;
    }
    this.lastDiag = `live_midcall_reconnect_${call.reconnectAttempts}`;
    this.connectGeminiLive(call, false, true, replayRecentSpeech);
  }

  private triggerDuetHandover(call: ActiveLiveCall, nextRole: 'male_note' | 'female_after_note') {
    if (call.closed || call.duetRole === nextRole) return;
    call.duetRole = nextRole;
    call.handoverInProgress = true;
    call.handoverEnqueued = false;
    call.handoverStartedAt = Date.now();
    call.geminiReady = false;
    call.geminiSpeaking = false;
    call.activityOpen = false;
    call.callerHadSpeechSinceReply = false;
    call.audioEndNudgeSent = false;
    call.lastSubmittedTurnText = '';
    if (call.turnFinalizeTimer) {
      clearTimeout(call.turnFinalizeTimer);
      call.turnFinalizeTimer = null;
    }
    call.recentSpeechPcm16k = [];
    call.preRollPcm16k = [];
    call.replayOnConnectPcm16k = [];
    call.sttPendingChunks = [];
    call.reconnectAttempts = 0;
    this.openFreshSttWs(call);

    if (call.liveWs) {
      try {
        call.liveWs.close(1000, `duet_to_${nextRole}`);
      } catch {}
      call.liveWs = null;
    }

    this.lastDiag = `duet_handover_${nextRole}`;
    this.connectGeminiLive(call, true, true, false);

    const introText =
      nextRole === 'male_note'
        ? 'Merhaba, notunuzu ben kaydedeceğim. Buyurun, ne iletmemi istersiniz?'
        : 'Başka yardımcı olabileceğim bir konu var mı?';
    const introVoice: 'Kore' | 'Orus' = nextRole === 'male_note' ? 'Orus' : 'Kore';

    const playHandoverIntro = (pcm8k: Int16Array | null) => {
      if (call.closed) return;
      if (pcm8k) {
        // İki ses arasında doğal 220 ms nefes boşluğu + yeni sesin giriş cümlesi
        this.enqueueOutPcm8k(call, new Int16Array(1760));
        this.enqueueOutPcm8k(call, pcm8k);
        call.handoverEnqueued = true;
        call.lastAiActivityAt = Date.now();
        call.lastCallerSpeechAt = Date.now();
        call.transcript.push({
          speaker: 'AI',
          text: nextRole === 'male_note' ? `[Erkek Kayıt Asistanı] ${introText}` : introText,
        });
        this.persistTranscript(call, false);
      } else {
        call.handoverEnqueued = true;
        call.handoverInProgress = false;
      }
    };

    const instantIntro = getCachedLiveVoiceClip8k(introText, introVoice);
    if (instantIntro) {
      playHandoverIntro(instantIntro);
    } else {
      void ensureLiveVoiceClip8k(introText, introVoice).then((clip) => {
        playHandoverIntro(clip ? clip.pcm8k : null);
      });
    }
  }

  private connectGeminiLive(
    call: ActiveLiveCall,
    useFastVad: boolean,
    isReconnect = false,
    replayBuffered = false
  ) {
    if (call.closed || !process.env.GEMINI_API_KEY) return;
    const { ctx } = call;
    const activeVoice: 'Kore' | 'Orus' = call.duetRole === 'male_note' ? 'Orus' : 'Kore';

    const historyLines =
      call.transcript.length > 0
        ? call.transcript
            .slice(-8)
            .map((t) => `${t.speaker === 'AI' ? 'Asistan' : 'Arayan'}: ${t.text}`)
            .join('\n')
        : '';

    const livelyVoiceStyle =
      call.duetRole === 'male_note'
        ? 'CİDDİ, NET, SAKİN VE SAYGILI ÜSLUP: Acele etmeden, sakin ve tane tane konuş; kelimeleri ve firma adını asla yutma. Profesyonel, ciddi, net ve doğrudan konuya giren bir üslupla konuş; lafı dolandırma, abartılı samimiyet veya gereksiz süslü cümle kurma. Her zaman saygılı ve ölçülü hitap et ("Kenan Bey", "Ahmet Bey", "Ayşe Hanım" gibi). ASLA "beyciğim", "hanımcığım", "canım", "tatlım", "harika bir gün" gibi laubali ifadeler kullanma!'
        : 'İŞ KADINI SES TONU, SAKİN TEMPO & KISA-ÖZ ÜSLUP: Oturaklı, kendinden emin, kararlı, diksiyonu kusursuz, olgun, tok ve prestijli bir Türk iş kadını ses tonuyla konuş. Acele etmeden, sakin ve tane tane konuş; firma adını ve hiçbir kelimeyi asla yutma. Abartılı neşe, tiz heyecan, laf dolandırma veya yapmacık samimiyet kesinlikle kullanma. Doğrudan soruya birebir, kısa ve öz yanıt ver. Her zaman saygılı ve ölçülü hitap et ("Kenan Bey", "Ahmet Bey", "Ayşe Hanım" gibi). ASLA "beyciğim", "hanımcığım", "canım", "tatlım", "harika bir gün" gibi laubali ifadeler kullanma!';

    const strictLangRule =
      'DİL VE DIŞ SES FİLTRESİ: Sadece doğal Türkiye Türkçesi konuş; başka dilden tek kelime etme. Sadece telefona doğrudan seninle konuşan kişiyi dikkate al; arka plandaki televizyon, sokak, rüzgar, yan oda veya başka kişilerin seslerini tamamen yoksay ve cevap verme. Doğrudan konuşan kişinin sesi anlaşılmazsa sadece "Kusura bakmayın, sesiniz net gelmedi, tekrar eder misiniz?" de.';

    const usageTarget = ctx.usageTarget || 'company';
    const authorityRef =
      ctx.targetAuthorityLabel ||
      (usageTarget === 'company' ? `${ctx.companyName} yetkilimiz` : ctx.personHonorific);

    const kurulumHitapBridge =
      usageTarget === 'company'
        ? `1. ÖNCE KURULUM HİTAP SEÇİMİ (SADECE FİRMA İSMİ): Kurulumda "Sadece Firma İsmiyle Hitap" işaretli. Hattı "${ctx.companyName}" firması adına temsil ediyorsun; kendiliğinden şahıs adı ("${ctx.personHonorific}") karıştırma, "yetkilimiz" veya "${ctx.companyName} yetkilimiz" de (yalnızca arayan bizzat isim sorarsa saygıyla yanıtla).`
        : usageTarget === 'hybrid'
        ? `1. ÖNCE KURULUM HİTAP SEÇİMİ (FİRMA + İSİM): Kurulumda "Firma İsmi + Kişi Hitap" işaretli. "${ctx.companyName}" firmasından ${ctx.personHonorific} adına konuşuyorsun.`
        : `1. ÖNCE KURULUM HİTAP SEÇİMİ (SADECE İSİM): Kurulumda "Sadece Şahıs İsmiyle Hitap" işaretli. Doğrudan ${ctx.personHonorific} adına konuşuyorsun; gereksiz firma adı vurgulama.`;

    let systemInstruction = '';
    if (call.duetRole === 'male_note') {
      const knownNameInfo =
        ctx.callerKind === 'company' && ctx.callerCompanyName
          ? ctx.verifiedCallerName
            ? `"${ctx.callerCompanyName}" firmasından "${ctx.verifiedCallerName}" (saygıyla ismiyle hitap et, asla tekrar isim sorma).`
            : `"${ctx.callerCompanyName}" firması (firma adına asla Bey/Hanım deme, tekrar isim/soyisim sorma).`
          : ctx.verifiedCallerName
          ? `"${ctx.verifiedCallerName}" (saygıyla "Bey/Hanım" diye hitap et, asla "beyciğim" deme, asla tekrar isim sorma).`
          : `Belirtilmedi (ASLA isim/soyisim sorma, sadece notu al).`;

      systemInstruction = `Sen ciddi, net, tok sesli, profesyonel ve saygılı Türk ERKEK KAYIT ASİSTANISIN.
${livelyVoiceStyle}
${kurulumHitapBridge}
2. SONRA ARAYAN BİLGİSİ (Sana Arka Planda Bildirildi): ${knownNameInfo} | Tel: ${ctx.callerPhone || 'Bilinmiyor'}
Çalışma saatleri: ${ctx.workHours}.
Önceki konuşma:
${historyLines}
Az önce "Merhaba, notunuzu ben kaydedeceğim. Buyurun, ne iletmemi istersiniz?" dedin; tekrar tanıtma.

GÖREVİN:
- ${strictLangRule}
- Kısa, ciddi, net ve doğrudan cevap ver (1 cümle). Lafı uzatma.
- İsim/soyisim KESİNLİKLE SORMA! Sadece notunu/talebini al.
- Notu aldığında net ve saygılı onayla: "Anlaşıldı, notunuzu eksiksiz kaydettim, ${authorityRef} ile hemen paylaşıyorum."
- ASLA "asistan hanıma devrediyorum / yönlendiriyorum" deme; onayı ver ve dur.`;
    } else if (call.duetRole === 'female_after_note') {
      const knownAfterName =
        ctx.callerKind === 'company' && ctx.callerCompanyName && !ctx.verifiedCallerName
          ? `Arayan firma: "${ctx.callerCompanyName}" (firma adına Bey/Hanım deme).`
          : ctx.verifiedCallerName
          ? `Arayan kişi: "${ctx.verifiedCallerName}" (saygılı hitap et, adını tekrar sorma).`
          : ctx.callerIdentityBlock;

      systemInstruction = `Sen ciddi, net, profesyonel ve saygılı Türk KADIN SEKRETERİSİN.
${livelyVoiceStyle}
${kurulumHitapBridge}
2. SONRA ARAYAN BİLGİSİ: ${knownAfterName}
Çalışma saatleri: ${ctx.workHours}.
Kayıt asistanı notu aldı ve sen doğrudan tekrar devreye girip "Başka yardımcı olabileceğim bir konu var mı?" dedin.
Önceki konuşma:
${historyLines}

GÖREVİN:
- ${strictLangRule}
- Kısa, ciddi ve net cevap ver (1 cümle). "Yönlendirildiniz / devraldım" deme.
- Arayan başka soru sorarsa doğrudan yanıtla; konuyu bitirirse ("hayır", "yok", "tamam", "bu kadar", "teşekkürler", "iyi günler", "sağ olun", "kolay gelsin") lafı uzatmadan sadece şunu söyle ve kapat: "Rica ederim, iyi günler dilerim."`;
    } else {
      const historySnippet =
        isReconnect && historyLines
          ? `\nÖnceki konuşma:\n${historyLines}\nKaldığın yerden devam et, tekrar karşılama yapma.`
          : `\nAçılışta az önce şunu söyledin: "${ctx.greetingText}". Tekrar "Merhaba, hoş geldiniz" deme; doğrudan arayanın sözüne ciddi, net ve kısa cevap ver.`;

      const callerRule =
        ctx.callerKind === 'company' && ctx.callerCompanyName && !ctx.verifiedCallerName
          ? `2. SONRA ARAYAN BİLGİSİ (FİRMA KAYDI): Rehberde kişi adı yerine "${ctx.callerCompanyName}" firma adıyla kayıtlı! ASLA "${ctx.callerCompanyName} Bey/Hanım" deme; duruma göre "${ctx.callerCompanyName}'den arıyorsunuz, kiminle görüşüyorum?" diye sorup arayan kişinin adını öğren.`
          : ctx.verifiedCallerName || ctx.isOwnerSelfCall
          ? `2. SONRA ARAYAN BİLGİSİ (KAYITLI KİŞİ): Arayan "${ctx.verifiedCallerName || ctx.personHonorific}". Saygılı ve ölçülü şekilde ("Kenan Bey", "Ahmet Bey", "Ayşe Hanım" gibi, ASLA "beyciğim" demeden) hitap et, adını tekrar sorma.`
          : `2. SONRA ARAYAN BİLGİSİ (YENİ ARAYAN): Rehberde kayıtlı değil. Arayan henüz adını söylemediyse ve vermek istemediğini belirtmediyse, uygun ilk anda saygılıca bir kez sor: "Size ileride tekrar aradığınızda isminizle hitap edebilmem için adınızı öğrenebilir miyim?"`;

      systemInstruction = `Sen ciddi, net, profesyonel ve saygılı Türk KADIN SEKRETERSİN.
${livelyVoiceStyle}
${kurulumHitapBridge}
İŞLETME YETKİLİSİ / HAT SAHİBİ: "${ctx.personHonorific}" (Firma: "${ctx.companyName}").
${callerRule}
Çalışma saatleri: ${ctx.workHours}.${historySnippet}

GÖREVİN:
- ${strictLangRule}
- BİREBİR, KISA VE ÖZ CEVAP + TEK SORU KURALI: Arayanın sorduğu soruya veya söylediği derde **birebir doğrudan, kısa ve öz** (en fazla 1-2 kısa cümle) cevap ver; hemen ardından konuyu netleştiren **tek kısa ve yerinde bir soru sor**. Acele etme, uzun resmi kalıplar kurma, lafı uzatma!
- ANLAŞILMAYAN SÖZDE UYDURMAMA & DOĞRU İSİM KURALI: Arayanın sözü telefonda kopuk, bozuk veya alakasız/anlamsız geldiyse ASLA tahmin yürütüp garip bir cevap verme; kısaca "Kusura bakmayın, tam duyamadım, tekrar eder misiniz?" de. Firmadaki yetkili kişi sadece "${ctx.personHonorific}" olup benzer telaffuzlu isim sorulduğunda "${ctx.personHonorific}" kastedildiğini bil ve ASLA yanlış isimle tekrar etme!
- TEKRAR VE SOĞUK KALIP YASAĞI: ASLA üst üste "Size nasıl yardımcı olabilirim?" veya "Lütfen talebinizi belirtin" gibi klişe cümleleri tekrarlama. Arayan sabırsızlansa, sitem etse veya sert konuşsa bile ASLA "Bu üsluba yanıt veremem" gibi ders verici/soğuk cevaplar verme; sakin, saygılı kal ve doğrudan derdini çözen kısa bir yanıt + soru ver.
- Arayan açıkça bir kişiyle veya yetkiliyle görüşmek istediğini söylemedikçe ASLA "müsait değil" veya "not bırakmak ister misiniz" deme!
- Arayan kendi derdini, sorununu, hizmet/fiyat/bilgi talebini anlattığında AYNI KONU ÜZERİNDE KALARAK doğrudan o konuya kısa-öz cevap ver ve sadece o konuyla ilgili tek kısa soru sor.
- YETKİLİ VE NOT AKIŞI (YALNIZCA ARAYAN YETKİLİYİ/KİŞİYİ SORARSA):
  1) Arayan "${ctx.personHonorific}" (veya benzer telaffuzları) ile görüşmek istediğini söylediğinde — arayanın kendi adı da "${ctx.personHonorific}" ile aynı olsa bile — BUNU KESİNLİKLE YETKİLİYLE GÖRÜŞME TALEBİ SAY! Uzun firma kalıbı kurmadan doğrudan sorduğu isme kısa ve öz cevap ver: "${ctx.personHonorific} şu an müsait değil. Not bırakmak ister misiniz?" (İsim söylemeden sadece "yetkili/müdür" derse: "${authorityRef} şu an müsait değil. Not bırakmak ister misiniz?")
  2) Arayan açıkça not/mesaj/geri arama/randevu istediğinde kendin not alma ve ASLA "yönlendiriyorum / aktarıyorum / devrediyorum" deme! Sadece kısa ve net şekilde "Tabii, hemen alalım." de ve dur.
- VEDA YASAĞI: Arayan açıkça "hayır, yok, gerek yok, teşekkürler, sağ olun, iyi günler, görüşürüz, kapatıyorum" demedikçe ASLA "Rica ederim, iyi günler dilerim" deme ve görüşmeyi bitirme! "Dur / bekle / bir saniye / olur / evet" asla veda değildir.
- Arayan açıkça konuyu sonlandırdığında ("tamam teşekkürler", "hayır yok", "bu kadar", "teşekkürler", "sağ olun", "kolay gelsin", "iyi günler", "görüşürüz", "kapatıyorum") lafı uzatma, sadece "Rica ederim, iyi günler dilerim." de ve görüşmeyi bitir.`;
    }

    const ws = new NativeIpv4GeminiLiveWs({
      apiKey: process.env.GEMINI_API_KEY.trim(),
      model: 'gemini-3.8-live',
      voiceName: activeVoice,
      systemInstruction,
      useFastVad: false,
      manualVad: false,
      onSetupComplete: () => {
        if (call.closed || call.liveWs !== ws) return;
        call.geminiReady = true;
        call.activityOpen = false;
        call.lastAiActivityAt = Date.now();
        call.lastCallerSpeechAt = Date.now();
        this.lastDiag = `live_ready_${call.duetRole}_${activeVoice}${isReconnect ? '_reconn' : ''}`;
        if (replayBuffered && call.lastSubmittedTurnText) {
          const textToSend = call.lastSubmittedTurnText;
          call.audioEndNudgeSent = true;
          call.audioEndSentAt = Date.now();
          ws.sendClientTurnText(textToSend);
        }
      },
      onMessage: (message: any) => {
        if (call.liveWs !== ws) return;
        this.handleGeminiMessage(call, message);
      },
      onError: (errMsg: string) => {
        if (call.liveWs !== ws) return;
        this.lastDiag = `live_ws_err:${errMsg.slice(0, 110)}`;
      },
      onClose: (code: number, reason: string) => {
        if (call.liveWs !== ws) return;
        call.geminiReady = false;
        call.geminiSpeaking = false;
        this.lastDiag = `live_ws_close:${code}:${reason.slice(0, 90)}`;
        if (call.closed) return;
        if (!isReconnect && useFastVad && (code === 1007 || code === 1008)) {
          this.connectGeminiLive(call, false, false, false);
        } else if (call.reconnectAttempts < 4) {
          this.reconnectGeminiMidCall(call, false);
        }
      },
    });
    call.liveWs = ws;
  }

  private handleGeminiMessage(call: ActiveLiveCall, message: any) {
    if (call.closed) return;
    const sc = message?.serverContent;
    if (!sc) return;

    // Arayan sözü kesti (BARGE-IN!): Çıkan tüm sesi 0 ms'de sil ve hemen sus!
    if (sc.interrupted) {
      this.flushOutAudio(call);
      call.geminiSpeaking = false;
      call.greetingDone = true;
      call.handoverInProgress = false;
      call.callerHadSpeechSinceReply = true;
      call.lastVoiceFrameAt = Date.now();
      call.audioEndNudgeSent = false;
      call.lastCallerSpeechAt = Date.now();
      call.silentNudgeCount = 0;
      if (call.pendingCallerText.trim()) {
        call.transcript.push({ speaker: 'CALLER', text: call.pendingCallerText.trim() });
        call.pendingCallerText = '';
      }
      if (call.pendingAiText.trim()) {
        const prefix = call.duetRole === 'male_note' ? '[Erkek Kayıt Asistanı] ' : '';
        call.transcript.push({ speaker: 'AI', text: `${prefix}${call.pendingAiText.trim()}` });
        call.pendingAiText = '';
      }
      return;
    }

    if (sc.inputTranscription?.text) {
      call.pendingCallerText += sc.inputTranscription.text;
      call.lastCallerSpeechAt = Date.now();
      call.silentNudgeCount = 0;
    }

    if (sc.outputTranscription?.text) {
      call.pendingAiText += sc.outputTranscription.text;
    }

    const parts = sc.modelTurn?.parts ?? [];
    for (const part of parts) {
      const b64 = part?.inlineData?.data;
      if (b64) {
        call.geminiSpeaking = true;
        call.activityOpen = false;
        call.callerHadSpeechSinceReply = false;
        call.audioEndNudgeSent = false;
        call.recentSpeechPcm16k = [];
        call.preRollPcm16k = [];
        call.lastAiActivityAt = Date.now();
        const pcm24k = Buffer.from(b64, 'base64');
        const pcm8k = this.downsample24kTo8k(call, pcm24k);
        this.enqueueOutPcm8k(call, pcm8k);
      }
    }

    if (sc.turnComplete) {
      call.geminiSpeaking = false;
      call.activityOpen = false;
      call.greetingDone = true;
      call.callerHadSpeechSinceReply = false;
      call.audioEndNudgeSent = false;
      call.preRollPcm16k = [];
      this.applySmoothTurnTailFade(call);
      call.lastAiActivityAt = Date.now();
      call.lastCallerSpeechAt = Date.now();
      const cTxt = call.pendingCallerText.replace(/\s+/g, ' ').trim();
      const aTxt = call.pendingAiText.replace(/\s+/g, ' ').trim();
      call.pendingCallerText = '';
      call.pendingAiText = '';

      const prevAiTurnText =
        [...call.transcript].reverse().find((t) => t.speaker === 'AI')?.text || '';

      if (cTxt) {
        call.transcript.push({ speaker: 'CALLER', text: cTxt });
        call.turns++;
        if (call.duetRole === 'male_note') {
          call.maleNoteTurns++;
        }
        // Rehberde/hafızada olmayan arayan adını söylediyse anında yakala ve kalıcı hafızaya aktar!
        if (!call.ctx.verifiedCallerName && !call.ctx.isOwnerSelfCall) {
          const learnedName = extractTurkishCallerName(cTxt, prevAiTurnText, call.ctx.personHonorific);
          if (learnedName) {
            call.ctx.verifiedCallerName = learnedName;
            call.ctx.callerTypeLabel = 'Asistan Hafızasına Yeni Kaydedildi';
            call.ctx.callerIdentityBlock = `Arayan kişi adını az önce söyledi ve hafızaya kaydedildi: "${learnedName}". Kendisine ismiyle sıcakça hitap et ve adını tekrar sorma.`;
          }
        }
      }
      if (aTxt) {
        const prefix = call.duetRole === 'male_note' ? '[Erkek Kayıt Asistanı] ' : '';
        call.transcript.push({ speaker: 'AI', text: `${prefix}${aTxt}` });
      }

      // DÜET DEVİR KONTROLÜ (Hemen atlamadan, yalnızca arayan not/mesaj/geri arama istediğinde "yönlendiriyorum" demeden geçiş!):
      // 1) Kadın sekreter soru soruyorsa ("ister misiniz?", "adınızı öğrenebilir miyim?") ASLA erken geçme!
      if (call.duetRole === 'female') {
        const aiStillAsking = /(adınızı|isminizi|kiminle görüşüyorum|isminizle hitap|ister misiniz|yardımcı olayım|yardımcı olabilir|duyamadım|anlayamadım|anlaşılmadı|net gelmedi|tekrar eder misiniz|tekrarlar mısınız|kusura bakmayın)/i.test(
          aTxt
        );
        const callerExplicitlyWantsNote =
          /(not bırak|not al|mesaj bırak|mesaj ilet|beni arasın|geri arasın|ulaşsın|randevu|notum var|not ilet|haber ver)/i.test(
            cTxt
          );
        const aiOfferedNoteBefore =
          /(not bırakmak|not bırak|mesaj bırak|not alalım|notunuzu al)/i.test(prevAiTurnText);
        const callerAgreedToNote =
          aiOfferedNoteBefore &&
          /(evet|olur|tamam|tabii|tabi|istiyorum|bırakayım|bırakacağım|lütfen|iyi olur|sevinirim|yazın|alın|arasın|ilet)/i.test(
            cTxt
          );
        const aiConfirmedTakingNote =
          /(hemen alalım|notunuzu al|kayıt arkadaş|kaydedelim|tabii, buyurun|tabi, buyurun)/i.test(aTxt);

        if (!aiStillAsking && (callerExplicitlyWantsNote || callerAgreedToNote || aiConfirmedTakingNote)) {
          this.persistTranscript(call, false);
          this.triggerDuetHandover(call, 'male_note');
          return;
        }
      }

      // 2) Erkek Kayıt Asistanı notu kaydettikten sonra "devrediyorum" demeden doğrudan Kadın Sekreter devreye girer
      if (call.duetRole === 'male_note') {
        const maleConfirmedNote =
          /(kaydettim|not.*aldım|notunuzu.*(aldım|kaydettim|iletiyorum)|kaydınız.*(alındı|oluşturuldu)|hemen iletiyorum|iletilecektir|asistan hanım|devrediyorum)/i.test(
            aTxt
          );
        const callerDoneWithNote =
          call.maleNoteTurns >= 2 && /(tamam|teşekkür|sağ ol|başka.*yok|bu kadar|yeterli|hayır)/i.test(cTxt);
        if ((maleConfirmedNote && (call.maleNoteTurns >= 1 || cTxt.length >= 4)) || callerDoneWithNote) {
          this.persistTranscript(call, false);
          this.triggerDuetHandover(call, 'female_after_note');
          return;
        }
      }

      if (call.duetRole !== 'male_note') {
        const aiSaidFarewell =
          /(iyi günler|iyi akşamlar|hoşça kal|görüşmek üzere|iyi çalışmalar|iyi geceler|müsait olduğunuzda tekrar)/i.test(
            aTxt
          );
        const aiAskedFollowup = /\?/.test(aTxt);
        const callerClosing =
          /(iyi günler|iyi akşamlar|görüşürüz|hoşça kal|teşekkür|sağ ol|sağol|eyvallah|kolay gelsin|kapatıyorum|kapatalım|kapasana|kapatabilirsin|bitirelim|bu kadar|başka.*yok|tamam.*yok|yok.*teşekkür|yok.*sağ|hayır.*teşekkür|hayır.*sağ)/i.test(
            cTxt
          );
        const callerClosedAfterNote =
          call.duetRole === 'female_after_note' &&
          /(hayır|yok|yoktur|tamam|bu kadar|yeterli|gerek yok|sağ ol|sağol|teşekkür|iyi günler|kolay gelsin|görüşürüz|eyvallah|kapat)/i.test(
            cTxt
          ) &&
          !/(fiyat|ücret|adres|randevu|soru|bilgi|öğrenmek|sormak)/i.test(cTxt);

        const callerExplicitlyClosed =
          callerClosing ||
          callerClosedAfterNote ||
          /(hayır|yok|yoktur|gerek yok|istemiyorum|kapat|bitirelim)/i.test(cTxt);

        if ((aiSaidFarewell && !aiAskedFollowup && callerExplicitlyClosed) || (callerClosing && !aiAskedFollowup) || callerClosedAfterNote) {
          this.lockForHangup(call, false);
        }
      }

      this.persistTranscript(call, false);
    }
  }

  private persistTranscript(call: ActiveLiveCall, completed: boolean) {
    const cFinal = call.pendingCallerText.replace(/\s+/g, ' ').trim();
    const aFinal = call.pendingAiText.replace(/\s+/g, ' ').trim();
    if (completed) {
      if (cFinal) call.transcript.push({ speaker: 'CALLER', text: cFinal });
      if (aFinal) call.transcript.push({ speaker: 'AI', text: aFinal });
      call.pendingCallerText = '';
      call.pendingAiText = '';
    }
    const callerLines = call.transcript.filter((t) => t.speaker === 'CALLER').map((t) => t.text);
    const summary =
      callerLines.length > 0
        ? `Canlı görüşme (${callerLines.length} söz): ${callerLines.slice(-2).join(' — ').slice(0, 180)}`
        : 'Canlı sekreter karşılama yaptı.';
    try {
      this.onCallUpdate({
        uuid: call.ctx.uuid,
        safeUuid: call.ctx.safeUuid,
        callerPhone: call.ctx.callerPhone,
        status: completed ? 'COMPLETED' : 'ANSWERED_BY_SECRETARY',
        transcript: [...call.transcript],
        turns: Math.max(call.turns, callerLines.length),
        aiSummary: summary,
        detectedCallerName: call.ctx.verifiedCallerName || undefined,
      });
    } catch {}
  }

  private sendByeToFreeSwitch(call: ActiveLiveCall) {
    const branch = `z9hG4bKsb${Date.now().toString(36)}`;
    const byeReq = [
      `BYE ${call.remoteContactUri} SIP/2.0`,
      `Via: SIP/2.0/UDP ${call.localIp}:${this.port};rport;branch=${branch}`,
      `From: ${call.toHeaderWithTag}`,
      `To: ${call.fromHeader}`,
      `Call-ID: ${call.sipCallId}`,
      'CSeq: 2 BYE',
      'Max-Forwards: 70',
      'Content-Length: 0',
      '',
      '',
    ].join('\r\n');
    this.sendSip(byeReq, call.remoteSipIp, call.remoteSipPort);
  }

  public findActiveCallByUuid(uuidOrSafeUuid: string): ActiveLiveCall | null {
    const target = String(uuidOrSafeUuid || '').trim();
    if (!target) return null;
    for (const call of Array.from(this.activeBySipCallId.values())) {
      if (call.closed) continue;
      if (call.ctx.uuid === target || call.ctx.safeUuid === target || call.sipCallId === target) {
        return call;
      }
    }
    return null;
  }

  public isCallLiveByUuid(uuidOrSafeUuid: string): boolean {
    return Boolean(this.findActiveCallByUuid(uuidOrSafeUuid));
  }

  public attachOwnerInternetAudio(
    uuidOrSafeUuid: string,
    ownerPhone11: string,
    onCallerPcm8k: (pcm8k: Buffer) => void,
    onEnded: () => void,
    transferWav8kPath?: string
  ): { ok: boolean; error?: string; uuid?: string; safeUuid?: string; callerPhone?: string } {
    const call = this.findActiveCallByUuid(uuidOrSafeUuid);
    if (!call) {
      return { ok: false, error: 'call_not_live' };
    }
    const cleanExpected = String(call.ctx.ownerPhone || '').replace(/\D/g, '').slice(-10);
    const cleanReq = String(ownerPhone11 || '').replace(/\D/g, '').slice(-10);
    if (cleanExpected && cleanReq && cleanExpected !== cleanReq) {
      return { ok: false, error: 'forbidden_owner' };
    }

    // Yapay zeka sekreteri sessizce devreden çıkar, canlı telefon hattı açık kalsın!
    call.ownerAudioActive = true;
    call.ownerAudioCb = onCallerPcm8k;
    call.ownerEndedCb = onEnded;
    call.geminiSpeaking = false;
    call.shouldHangupAfterDrain = false;
    call.greetingDone = true;
    call.handoverInProgress = false;

    if (call.silenceWatchdog) {
      clearInterval(call.silenceWatchdog);
      call.silenceWatchdog = null;
    }
    if (call.turnFinalizeTimer) {
      clearTimeout(call.turnFinalizeTimer);
      call.turnFinalizeTimer = null;
    }
    if (call.sttWs) {
      try {
        call.sttWs.close(1000, 'owner_takeover');
      } catch {}
      call.sttWs = null;
    }
    if (call.liveWs) {
      try {
        call.liveWs.close(1000, 'owner_takeover');
      } catch {}
      call.liveWs = null;
    }

    this.flushOutAudio(call);

    // Arayana tek seferlik yumuşak geçiş anonsu ("Bir saniye lütfen, hemen bağlıyorum.")
    if (transferWav8kPath) {
      try {
        if (fs.existsSync(transferWav8kPath)) {
          const wav = fs.readFileSync(transferWav8kPath);
          const dataIdx = wav.indexOf(Buffer.from('data', 'ascii'));
          if (dataIdx >= 12 && dataIdx + 8 < wav.length) {
            const dataLen = wav.readUInt32LE(dataIdx + 4);
            const pcmStart = dataIdx + 8;
            const pcmEnd = Math.min(wav.length, pcmStart + dataLen);
            const sampleCount = Math.floor((pcmEnd - pcmStart) / 2);
            if (sampleCount > 400) {
              const samples = new Int16Array(sampleCount);
              for (let i = 0; i < sampleCount; i++) {
                samples[i] = wav.readInt16LE(pcmStart + i * 2);
              }
              this.enqueueOutPcm8k(call, samples);
            }
          }
        }
      } catch {}
    }

    return {
      ok: true,
      uuid: call.ctx.uuid,
      safeUuid: call.ctx.safeUuid,
      callerPhone: call.ctx.callerPhone,
    };
  }

  public pushOwnerPcm8k(uuidOrSafeUuid: string, pcm8kBuf: Buffer): boolean {
    const call = this.findActiveCallByUuid(uuidOrSafeUuid);
    if (!call || !call.ownerAudioActive || call.closed) return false;
    const sampleCount = Math.floor(pcm8kBuf.length / 2);
    if (sampleCount <= 0) return false;

    // 160 ms üstü gecikme birikirse en eski paketi düşürerek anlık telefon hissi koru
    if (call.outTotalQueuedSamples > 2400) {
      this.flushOutAudio(call);
    }

    const samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = pcm8kBuf.readInt16LE(i * 2);
    }
    this.enqueueOutPcm8k(call, samples);
    return true;
  }

  public detachOwnerInternetAudio(uuidOrSafeUuid: string, hangupCaller = true): boolean {
    const call = this.findActiveCallByUuid(uuidOrSafeUuid);
    if (!call) return false;
    call.ownerAudioCb = null;
    call.ownerEndedCb = null;
    if (hangupCaller) {
      this.teardownCall(call, true);
    }
    return true;
  }

  public hangupCallByUuid(uuidOrSafeUuid: string): boolean {
    const target = String(uuidOrSafeUuid || '').trim();
    if (!target) return false;
    for (const call of Array.from(this.activeBySipCallId.values())) {
      if (call.ctx.uuid === target || call.ctx.safeUuid === target || call.sipCallId === target) {
        this.teardownCall(call, true);
        return true;
      }
    }
    return false;
  }

  private teardownCall(call: ActiveLiveCall, sendBye: boolean) {
    if (call.closed) return;
    call.closed = true;
    this.activeBySipCallId.delete(call.sipCallId);
    const endedCb = call.ownerEndedCb;
    call.ownerAudioCb = null;
    call.ownerEndedCb = null;
    if (call.rtpTimer) {
      clearTimeout(call.rtpTimer);
      call.rtpTimer = null;
    }
    if (call.silenceWatchdog) {
      clearInterval(call.silenceWatchdog);
      call.silenceWatchdog = null;
    }
    if (sendBye) {
      this.sendByeToFreeSwitch(call);
    }
    if (call.turnFinalizeTimer) {
      clearTimeout(call.turnFinalizeTimer);
      call.turnFinalizeTimer = null;
    }
    if (call.sttWs) {
      try {
        call.sttWs.close(1000, 'call_ended');
      } catch {}
      call.sttWs = null;
    }
    if (call.liveWs) {
      try {
        call.liveWs.close(1000, 'call_ended');
      } catch {}
      call.liveWs = null;
    }
    try {
      call.rtpSock.close();
    } catch {}
    if (endedCb) {
      try {
        endedCb();
      } catch {}
    }
    this.persistTranscript(call, true);
  }
}

/**
 * Gerçek uçtan uca canlı ses testi:
 * 1) Saf IPv4 bağlantısı + setupComplete süresi
 * 2) Açılış anonsu ilk ses geliş süresi (ms)
 * 3) Gerçek Türkçe 16kHz konuşma gönderimi -> söz bitişinden ilk cevap sesine geçen tam milisaniye süresi!
 */
export async function testGeminiLiveConnectivity(
  sampleWav8kPath?: string,
  requestedMode?: string
): Promise<{
  ok: boolean;
  connectMs: number;
  greetingFirstAudioMs: number;
  greetingAudioBytes: number;
  greetingText: string;
  replyFirstAudioMs: number;
  replyAudioBytes: number;
  inTranscript: string;
  outTranscript: string;
  fastVadAccepted: boolean;
  closeInfo: string;
  error?: string;
}> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      connectMs: 0,
      greetingFirstAudioMs: 0,
      greetingAudioBytes: 0,
      greetingText: '',
      replyFirstAudioMs: 0,
      replyAudioBytes: 0,
      inTranscript: '',
      outTranscript: '',
      fastVadAccepted: false,
      closeInfo: 'no_key',
      error: 'missing_key',
    };
  }

  const tDns = Date.now();
  const resolvedIp = await resolveGeminiIpv4Fast();
  const dnsMs = Date.now() - tDns;
  const tcpProbe = await new Promise<{ ok: boolean; ms: number; err?: string }>((resolve) => {
    const tTcp = Date.now();
    let doneFlag = false;
    const finishProbe = (ok: boolean, err?: string) => {
      if (doneFlag) return;
      doneFlag = true;
      try {
        s.destroy();
      } catch {}
      resolve({ ok, ms: Date.now() - tTcp, ...(err ? { err } : {}) });
    };
    const s = net.connect({ host: resolvedIp, port: 443, family: cachedGeminiFamily });
    const tm = setTimeout(() => finishProbe(false, 'tcp_timeout_3s'), 3000);
    s.on('connect', () => {
      clearTimeout(tm);
      finishProbe(true);
    });
    s.on('error', (e: any) => {
      clearTimeout(tm);
      finishProbe(false, String(e?.code || e?.message || 'tcp_err'));
    });
  });

  const greetingTextFixed = 'Merhaba, Santral Bayi firmasına hoş geldiniz! Ben asistanınızım. Size nasıl yardımcı olabilirim?';
  if (!tcpProbe.ok) {
    const [cfOk, g8Ok, altOk] = await Promise.all([
      probeTcp443Reachable('1.1.1.1', 4, 1500),
      probeTcp443Reachable('8.8.8.8', 4, 1500),
      probeTcp443Reachable('74.125.71.95', 4, 1500),
    ]);
    return {
      ok: false,
      connectMs: 0,
      greetingFirstAudioMs: 0,
      greetingAudioBytes: 0,
      greetingText: greetingTextFixed,
      replyFirstAudioMs: 0,
      replyAudioBytes: 0,
      inTranscript: '',
      outTranscript: '',
      fastVadAccepted: false,
      closeInfo: `dns:${resolvedIp}(f${cachedGeminiFamily},${dnsMs}ms)|tcp:${tcpProbe.err || 'fail'}(${tcpProbe.ms}ms)|net:cf=${cfOk ? 'ok' : 'no'},g8=${g8Ok ? 'ok' : 'no'},alt=${altOk ? 'ok' : 'no'}|cands:${lastDnsCandidates.slice(0, 8).join(',')}`,
      error: `outbound_tcp_blocked:${resolvedIp}:${tcpProbe.err}`,
    };
  }

  const [greetingClip, maleIntroClip, femaleReturnClip] = await Promise.all([
    ensureLiveVoiceClip8k(greetingTextFixed, 'Kore'),
    ensureLiveVoiceClip8k('Merhaba, notunuzu ben kaydedeceğim. Buyurun, ne iletmemi istersiniz?', 'Orus'),
    ensureLiveVoiceClip8k('Başka yardımcı olabileceğim bir konu var mı?', 'Kore'),
    ensureLiveVoiceClip8k('Rica ederim, iyi günler dilerim.', 'Kore'),
    ensureLiveVoiceClip8k('Buyurun, sizi dinliyorum, size nasıl yardımcı olabilirim?', 'Kore'),
    ensureLiveVoiceClip8k('Buyurun, hangi konuda görüşmek istemiştiniz?', 'Kore'),
    ensureLiveVoiceClip8k('Tabii, bekliyorum, buyurun.', 'Kore'),
    ensureLiveVoiceClip8k('Alo? Beni duyabiliyor musunuz, buyurun?', 'Kore'),
    ensureLiveVoiceClip8k('Alo, sesiniz gelmiyor sanırım, hatta mısınız?', 'Kore'),
    ensureLiveVoiceClip8k('Alo? Beni duyabiliyor musunuz, buyurun?', 'Orus'),
    ensureLiveVoiceClip8k('Alo, sesiniz gelmiyor sanırım, hatta mısınız?', 'Orus'),
    ensureLiveVoiceClip8k(
      'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.',
      'Kore'
    ),
  ]);
  const greetingAudioBytes = greetingClip ? greetingClip.pcm8k.length * 2 : 0;
  const maleIntroAudioBytes = maleIntroClip ? maleIntroClip.pcm8k.length * 2 : 0;
  const femaleReturnAudioBytes = femaleReturnClip ? femaleReturnClip.pcm8k.length * 2 : 0;
  const greetingFirstAudioMs = greetingClip ? greetingClip.firstAudioMs : 0;

  const makeRandomWhiteSilence = (bytes: number) => {
    const b = Buffer.allocUnsafe(bytes);
    for (let i = 0; i + 1 < bytes; i += 2) {
      b.writeInt16LE(Math.floor((Math.random() - 0.5) * 24), i);
    }
    return b;
  };

  const runOnce = (opts: {
    label: string;
    useFastVad: boolean;
    silenceDurationMs?: number;
    chunkMs: number;
    useWhiteNoise: boolean;
    maxAudioSec: number;
  }) =>
    new Promise<{
      ok: boolean;
      connectMs: number;
      greetingFirstAudioMs: number;
      greetingAudioBytes: number;
      maleIntroAudioBytes: number;
      femaleReturnAudioBytes: number;
      greetingText: string;
      replyFirstAudioMs: number;
      replyAudioBytes: number;
      inTranscript: string;
      outTranscript: string;
      fastVadAccepted: boolean;
      closeInfo: string;
      wavSamples?: number;
      wavRms?: number;
      rawMsgCount?: number;
      rawMsgKeys?: string[];
      error?: string;
    }>((resolve) => {
      const tStart = Date.now();
      let connectMs = 0;
      let speechEndedAt = 0;
      let replyFirstAudioMs = 0;
      let replyAudioBytes = 0;
      let inTranscript = '';
      let outTranscript = '';
      let closeInfo = '';
      let errText = '';
      let wavSamples = 0;
      let wavRms = 0;
      let rawMsgCount = 0;
      let speechChunksSent = 0;
      let silenceChunksSent = 0;
      const rawMsgKeys: string[] = [];
      let settled = false;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        try {
          ws.close(1000, 'test_done');
        } catch {}
        resolve({
          ok,
          connectMs,
          greetingFirstAudioMs,
          greetingAudioBytes,
          maleIntroAudioBytes,
          femaleReturnAudioBytes,
          greetingText: greetingTextFixed,
          replyFirstAudioMs,
          replyAudioBytes,
          inTranscript: inTranscript.trim(),
          outTranscript: outTranscript.trim() || `[${opts.label}] sp=${speechChunksSent},sil=${silenceChunksSent}`,
          fastVadAccepted: opts.useFastVad && connectMs > 0,
          closeInfo,
          wavSamples,
          wavRms,
          rawMsgCount,
          rawMsgKeys,
          ...(errText ? { error: errText } : {}),
        });
      };

      const overallTimer = setTimeout(() => {
        errText = errText || `timeout_14s_${opts.label}_sp${speechChunksSent}_sil${silenceChunksSent}`;
        finish(replyAudioBytes > 4000 && turn2AudioBytes > 4000);
      }, 14000);

      let activeTestTurn = 1;
      let turn2StartedAt = 0;
      let turn2FirstAudioMs = 0;
      let turn2AudioBytes = 0;
      let turn2OutTranscript = '';

      const streamSampleSpeech = (turnNo = 1) => {
        const wav8k = sampleWav8kPath ? readWav8kPcmSamples(sampleWav8kPath) : null;
        if (!wav8k || wav8k.length < 1600) {
          speechEndedAt = Date.now();
          ws.sendRealtimeText(turnNo === 1 ? 'Kenan Bey ile görüşebilir miyiz?' : 'Evet, not bırakmak istiyorum.');
          return;
        }
        wavSamples = wav8k.length;
        const maxSamples8k = Math.min(wav8k.length, Math.round(8000 * opts.maxAudioSec));
        let sumSq = 0;
        const pcm16k = Buffer.allocUnsafe(maxSamples8k * 4);
        let prev = 0;
        for (let i = 0; i < maxSamples8k; i++) {
          const s = wav8k[i];
          sumSq += s * s;
          const mid = (prev + s) >> 1;
          pcm16k.writeInt16LE(mid, i * 4);
          pcm16k.writeInt16LE(s, i * 4 + 2);
          prev = s;
        }
        wavRms = Math.round(Math.sqrt(sumSq / Math.max(1, maxSamples8k)));
        const chunkBytes = Math.round((16000 * 2 * opts.chunkMs) / 1000);
        const makeSil = () => (opts.useWhiteNoise ? makeRandomWhiteSilence(chunkBytes) : Buffer.alloc(chunkBytes));
        let leadSilenceLeft = 2;
        let offset = 0;
        let silenceChunksLeft = Math.ceil(3500 / opts.chunkMs);
        const sendTick = setInterval(() => {
          if (
            settled ||
            !ws.isReady() ||
            (turnNo === 1 && replyAudioBytes > 0) ||
            (turnNo === 2 && turn2AudioBytes > 0)
          ) {
            clearInterval(sendTick);
            return;
          }
          if (leadSilenceLeft > 0) {
            ws.sendAudioPcm16k(makeSil());
            leadSilenceLeft--;
          } else if (offset < pcm16k.length) {
            const slice = pcm16k.subarray(offset, Math.min(offset + chunkBytes, pcm16k.length));
            ws.sendAudioPcm16k(slice);
            speechChunksSent++;
            offset += chunkBytes;
            if (offset >= pcm16k.length) {
              if (turnNo === 1) speechEndedAt = Date.now();
              else turn2StartedAt = Date.now();
            }
          } else if (silenceChunksLeft > 0) {
            ws.sendAudioPcm16k(makeSil());
            silenceChunksSent++;
            silenceChunksLeft--;
          } else {
            clearInterval(sendTick);
          }
        }, opts.chunkMs);
      };

      const ws = new NativeIpv4GeminiLiveWs({
        apiKey,
        model: 'gemini-3.8-live',
        voiceName: 'Kore',
        systemInstruction:
          'Sen Santral Bayi kadın sekreterisin. Arayanı az önce "Merhaba, Santral Bayi, buyurun?" diye karşıladın. Her turda SADECE 1 kısa Türkçe cümle kur. İlk soruda "Kenan Bey şu an müsait değil, not bırakmak ister misiniz?" de; ikinci konuşmada "Tabii, hemen alalım." de.',
        useFastVad: opts.useFastVad,
        silenceDurationMs: opts.silenceDurationMs,
        manualVad: false,
        onSetupComplete: () => {
          connectMs = Date.now() - tStart;
          streamSampleSpeech(1);
        },
        onMessage: (msg: any) => {
          rawMsgCount++;
          if (rawMsgKeys.length < 14 && msg && typeof msg === 'object') {
            const detail = msg.voiceActivity
              ? `voiceActivity:${JSON.stringify(msg.voiceActivity)}`
              : msg.serverContent
              ? `sc[${Object.keys(msg.serverContent).join(',')}]`
              : Object.keys(msg).join(',');
            rawMsgKeys.push(detail);
          }
          const sc = msg?.serverContent;
          if (!sc) return;
          if (sc.inputTranscription?.text) {
            inTranscript += sc.inputTranscription.text;
          }
          if (sc.outputTranscription?.text) {
            if (activeTestTurn === 1) outTranscript += sc.outputTranscription.text;
            else turn2OutTranscript += sc.outputTranscription.text;
          }
          for (const p of sc.modelTurn?.parts ?? []) {
            if (p?.inlineData?.data) {
              const len = Buffer.from(p.inlineData.data, 'base64').length;
              if (activeTestTurn === 1) {
                if (!replyFirstAudioMs && speechEndedAt) {
                  replyFirstAudioMs = Math.max(1, Date.now() - speechEndedAt);
                }
                replyAudioBytes += len;
              } else {
                if (!turn2FirstAudioMs && turn2StartedAt) {
                  turn2FirstAudioMs = Math.max(1, Date.now() - turn2StartedAt);
                }
                turn2AudioBytes += len;
              }
            }
          }
          if (sc.turnComplete) {
            if (activeTestTurn === 1 && replyAudioBytes > 4000) {
              activeTestTurn = 2;
              setTimeout(() => {
                if (!settled && ws.isReady()) streamSampleSpeech(2);
              }, 120);
            } else if (activeTestTurn === 2 && turn2AudioBytes > 4000) {
              outTranscript = `[${opts.label}] T1(${replyFirstAudioMs}ms): ${outTranscript.trim()} || T2(${turn2FirstAudioMs}ms): ${turn2OutTranscript.trim()}`;
              finish(true);
            }
          }
        },
        onError: (e: string) => {
          errText = e;
        },
        onClose: (code: number, reason: string) => {
          closeInfo = `${code}:${reason}`;
          finish(replyAudioBytes > 4000 && turn2AudioBytes > 4000);
        },
      });
    });

  void resolveGeminiIpv4Fast();
  const modeUpper = String(requestedMode || 'DUAL_LIVE').toUpperCase();

  if (modeUpper === 'DUAL_LIVE') {
    // Gerçek çağrıdaki çift kanallı milisaniye motorunun birebir uçtan uca 2 turlu doğrulama testi!
    return new Promise((resolve) => {
      const tStart = Date.now();
      let connectMs = 0;
      let turnNo = 1;
      let speechEndedAt = 0;
      const turnMs: number[] = [0, 0];
      const turnBytes: number[] = [0, 0];
      const turnInTexts: string[] = ['', ''];
      const turnOutTexts: string[] = ['', ''];
      let closeInfo = '';
      let errText = '';
      let settled = false;
      let activeSttWs: NativeIpv4GeminiLiveWs | null = null;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { activeSttWs?.close(1000, 'done'); } catch {}
        try { voiceWs.close(1000, 'done'); } catch {}
        resolve({
          ok,
          connectMs,
          greetingFirstAudioMs,
          greetingAudioBytes,
          greetingText: greetingTextFixed,
          replyFirstAudioMs: turnMs[0],
          replyAudioBytes: turnBytes[0] + turnBytes[1],
          inTranscript: `T1: ${turnInTexts[0]} || T2: ${turnInTexts[1]}`,
          outTranscript: `[DUAL_LIVE] T1(${turnMs[0]}ms): ${turnOutTexts[0].trim()} || T2(${turnMs[1]}ms): ${turnOutTexts[1].trim()}`,
          fastVadAccepted: true,
          closeInfo,
          ...(errText ? { error: errText } : {}),
        });
      };

      const timer = setTimeout(() => {
        errText = errText || `timeout_dual_live_turn${turnNo}`;
        finish(false);
      }, 15000);

      const wav8k = sampleWav8kPath ? readWav8kPcmSamples(sampleWav8kPath) : null;
      const maxSamples8k = wav8k ? Math.min(wav8k.length, 8000 * 2) : 0;
      const pcm16k = Buffer.allocUnsafe(maxSamples8k * 4);
      if (wav8k && maxSamples8k > 0) {
        let prev = 0;
        for (let i = 0; i < maxSamples8k; i++) {
          const s = wav8k[i];
          pcm16k.writeInt16LE((prev + s) >> 1, i * 4);
          pcm16k.writeInt16LE(s, i * 4 + 2);
          prev = s;
        }
      }

      const runSttTurn = (tNo: number) => {
        if (settled) return;
        try { activeSttWs?.close(1000, 'next'); } catch {}
        let sttFinal = '';
        let sttInterim = '';
        const sttWs = new NativeIpv4GeminiLiveWs({
          apiKey,
          model: 'gemini-3.5-transcribe-live',
          voiceName: 'Kore',
          systemInstruction: '',
          transcribeOnly: true,
          onSetupComplete: () => {
            if (settled || activeSttWs !== sttWs) return;
            if (pcm16k.length < 3200) {
              speechEndedAt = Date.now();
              const txt = tNo === 1 ? 'Kenan Bey ile görüşebilir miyiz?' : 'Evet, not bırakmak istiyorum.';
              turnInTexts[tNo - 1] = txt;
              voiceWs.sendClientTurnText(txt);
              return;
            }
            let offset = 0;
            const iv = setInterval(() => {
              if (settled || !sttWs.isReady()) { clearInterval(iv); return; }
              if (offset < pcm16k.length) {
                sttWs.sendAudioPcm16k(pcm16k.subarray(offset, Math.min(offset + 1920, pcm16k.length)));
                offset += 1920;
              } else {
                clearInterval(iv);
                sttWs.sendAudioPcm16k(PURE_ZERO_1920);
                speechEndedAt = Date.now();
                setTimeout(() => {
                  if (settled) return;
                  const captured = `${sttFinal} ${sttInterim}`.replace(/\s+/g, ' ').trim() || (tNo === 1 ? 'Kenan Bey ile görüşebilir miyiz?' : 'Evet, not bırakmak istiyorum.');
                  turnInTexts[tNo - 1] = captured;
                  try { sttWs.close(1000, 'turn_done'); } catch {}
                  voiceWs.sendClientTurnText(captured);
                }, 140);
              }
            }, 60);
          },
          onMessage: (m: any) => {
            const sc = m?.serverContent;
            if (!sc) return;
            if (sc.interimInputTranscription?.text) sttInterim = String(sc.interimInputTranscription.text).trim();
            if (sc.inputTranscription?.text) {
              sttFinal = `${sttFinal} ${String(sc.inputTranscription.text).trim()}`.trim();
              sttInterim = '';
            }
          },
          onError: () => {},
          onClose: () => {},
        });
        activeSttWs = sttWs;
      };

      const voiceWs = new NativeIpv4GeminiLiveWs({
        apiKey,
        model: 'gemini-3.8-live',
        voiceName: 'Kore',
        systemInstruction:
          'Sen Santral Bayi kadın sekreterisin. Her mesaja SADECE 1 çok kısa Türkçe cümleyle yanıt ver.',
        useFastVad: false,
        manualVad: false,
        onSetupComplete: () => {
          connectMs = Date.now() - tStart;
          runSttTurn(1);
        },
        onMessage: (msg: any) => {
          const sc = msg?.serverContent;
          if (!sc) return;
          if (sc.outputTranscription?.text) {
            turnOutTexts[turnNo - 1] += sc.outputTranscription.text;
          }
          for (const p of sc.modelTurn?.parts ?? []) {
            if (p?.inlineData?.data) {
              if (!turnMs[turnNo - 1] && speechEndedAt) {
                turnMs[turnNo - 1] = Math.max(1, Date.now() - speechEndedAt);
              }
              turnBytes[turnNo - 1] += Buffer.from(p.inlineData.data, 'base64').length;
            }
          }
          if (sc.turnComplete && turnBytes[turnNo - 1] > 2000) {
            if (turnNo === 1) {
              turnNo = 2;
              runSttTurn(2);
            } else {
              finish(true);
            }
          }
        },
        onError: (e: string) => { errText = e; },
        onClose: (c: number, r: string) => { closeInfo = `${c}:${r}`; finish(false); },
      });
    });
  }

  if (modeUpper === 'TEXT_LIVE') {
    return new Promise((resolve) => {
      const tStart = Date.now();
      let connectMs = 0;
      let turnNo = 1;
      let turnSentAt = 0;
      const turnMs: number[] = [0, 0, 0];
      const turnBytes: number[] = [0, 0, 0];
      const turnTexts: string[] = ['', '', ''];
      const prompts = [
        'Kenan Bey ile görüşebilir miyiz?',
        'Evet, acil not bırakmak istiyorum.',
        'Teşekkürler, başka bir isteğim yok, iyi günler.',
      ];
      let closeInfo = '';
      let errText = '';
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(1000, 'done'); } catch {}
        resolve({
          ok,
          connectMs,
          greetingFirstAudioMs,
          greetingAudioBytes,
          greetingText: greetingTextFixed,
          replyFirstAudioMs: turnMs[0],
          replyAudioBytes: turnBytes[0] + turnBytes[1] + turnBytes[2],
          inTranscript: prompts.join(' | '),
          outTranscript: `T1(${turnMs[0]}ms): ${turnTexts[0].trim()} || T2(${turnMs[1]}ms): ${turnTexts[1].trim()} || T3(${turnMs[2]}ms): ${turnTexts[2].trim()}`,
          fastVadAccepted: true,
          closeInfo,
          ...(errText ? { error: errText } : {}),
        });
      };
      const timer = setTimeout(() => {
        errText = errText || `timeout_text_live_turn${turnNo}`;
        finish(false);
      }, 14000);
      const ws = new NativeIpv4GeminiLiveWs({
        apiKey,
        model: 'gemini-3.8-live',
        voiceName: 'Kore',
        systemInstruction:
          'Sen Santral Bayi kadın sekreterisin. Her mesaja SADECE 1 çok kısa Türkçe cümleyle yanıt ver.',
        useFastVad: false,
        manualVad: false,
        onSetupComplete: () => {
          connectMs = Date.now() - tStart;
          turnSentAt = Date.now();
          ws.sendClientTurnText(prompts[0]);
        },
        onMessage: (msg: any) => {
          const sc = msg?.serverContent;
          if (!sc) return;
          if (sc.outputTranscription?.text) {
            turnTexts[turnNo - 1] += sc.outputTranscription.text;
          }
          for (const p of sc.modelTurn?.parts ?? []) {
            if (p?.inlineData?.data) {
              if (!turnMs[turnNo - 1] && turnSentAt) {
                turnMs[turnNo - 1] = Math.max(1, Date.now() - turnSentAt);
              }
              turnBytes[turnNo - 1] += Buffer.from(p.inlineData.data, 'base64').length;
            }
          }
          if (sc.turnComplete && turnBytes[turnNo - 1] > 2000) {
            if (turnNo < 3) {
              turnNo++;
              turnSentAt = Date.now();
              ws.sendClientTurnText(prompts[turnNo - 1]);
            } else {
              finish(true);
            }
          }
        },
        onError: (e: string) => { errText = e; },
        onClose: (c: number, r: string) => { closeInfo = `${c}:${r}`; finish(false); },
      });
    });
  }

  if (modeUpper === 'STT_LIVE') {
    return new Promise((resolve) => {
      const tStart = Date.now();
      let connectMs = 0;
      let firstInterimMs = 0;
      let firstFinalMs = 0;
      let streamStartedAt = 0;
      let streamEndedAt = 0;
      let interimText = '';
      let finalText = '';
      let closeInfo = '';
      let errText = '';
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(1000, 'done'); } catch {}
        resolve({
          ok,
          connectMs,
          greetingFirstAudioMs: firstInterimMs,
          greetingAudioBytes,
          greetingText: greetingTextFixed,
          replyFirstAudioMs: firstFinalMs || firstInterimMs,
          replyAudioBytes: finalText.length + interimText.length,
          inTranscript: `interim(${firstInterimMs}ms): ${interimText.trim()}`,
          outTranscript: `final(${firstFinalMs}ms): ${finalText.trim()}`,
          fastVadAccepted: true,
          closeInfo,
          ...(errText ? { error: errText } : {}),
        });
      };
      const timer = setTimeout(() => {
        errText = errText || 'timeout_stt_live';
        finish(Boolean(finalText.trim() || interimText.trim()));
      }, 10000);
      const ws = new NativeIpv4GeminiLiveWs({
        apiKey,
        model: 'gemini-3.5-transcribe-live',
        voiceName: 'Kore',
        systemInstruction: '',
        transcribeOnly: true,
        onSetupComplete: () => {
          connectMs = Date.now() - tStart;
          const wav8k = sampleWav8kPath ? readWav8kPcmSamples(sampleWav8kPath) : null;
          if (!wav8k || wav8k.length < 1600) {
            errText = 'no_wav';
            finish(false);
            return;
          }
          const maxSamples8k = Math.min(wav8k.length, 8000 * 2);
          const pcm16k = Buffer.allocUnsafe(maxSamples8k * 4);
          let prev = 0;
          for (let i = 0; i < maxSamples8k; i++) {
            const s = wav8k[i];
            pcm16k.writeInt16LE((prev + s) >> 1, i * 4);
            pcm16k.writeInt16LE(s, i * 4 + 2);
            prev = s;
          }
          streamStartedAt = Date.now();
          let offset = 0;
          let silLeft = 15;
          const iv = setInterval(() => {
            if (settled || !ws.isReady()) { clearInterval(iv); return; }
            if (offset < pcm16k.length) {
              ws.sendAudioPcm16k(pcm16k.subarray(offset, Math.min(offset + 1920, pcm16k.length)));
              offset += 1920;
              if (offset >= pcm16k.length) streamEndedAt = Date.now();
            } else if (silLeft > 0) {
              ws.sendAudioPcm16k(PURE_ZERO_1920);
              silLeft--;
            } else {
              clearInterval(iv);
            }
          }, 60);
        },
        onMessage: (msg: any) => {
          const sc = msg?.serverContent;
          if (!sc) return;
          if (sc.interimInputTranscription?.text) {
            if (!firstInterimMs && streamStartedAt) firstInterimMs = Date.now() - streamStartedAt;
            interimText = sc.interimInputTranscription.text;
          }
          if (sc.inputTranscription?.text) {
            if (!firstFinalMs && streamEndedAt) firstFinalMs = Math.max(1, Date.now() - streamEndedAt);
            else if (!firstFinalMs && streamStartedAt) firstFinalMs = Date.now() - streamStartedAt;
            finalText += sc.inputTranscription.text;
            if (streamEndedAt && finalText.trim().length >= 6) {
              setTimeout(() => finish(true), 200);
            }
          }
        },
        onError: (e: string) => { errText = e; },
        onClose: (c: number, r: string) => { closeInfo = `${c}:${r}`; finish(Boolean(finalText.trim())); },
      });
    });
  }

  const variants: Record<string, { label: string; useFastVad: boolean; silenceDurationMs?: number; chunkMs: number; useWhiteNoise: boolean; maxAudioSec: number }> = {
    A: { label: 'A_default_100ms_zero', useFastVad: false, chunkMs: 100, useWhiteNoise: false, maxAudioSec: 3.5 },
    B: { label: 'B_fast300_100ms_zero', useFastVad: true, silenceDurationMs: 300, chunkMs: 100, useWhiteNoise: false, maxAudioSec: 3.5 },
    C: { label: 'C_default_100ms_white', useFastVad: false, chunkMs: 100, useWhiteNoise: true, maxAudioSec: 3.5 },
    D: { label: 'D_fast200_60ms_white', useFastVad: true, silenceDurationMs: 200, chunkMs: 60, useWhiteNoise: true, maxAudioSec: 3.5 },
    E: { label: 'E_fast250_100ms_white', useFastVad: true, silenceDurationMs: 250, chunkMs: 100, useWhiteNoise: true, maxAudioSec: 3.5 },
  };
  const chosen = variants[modeUpper] || variants.B;
  return runOnce(chosen);
}

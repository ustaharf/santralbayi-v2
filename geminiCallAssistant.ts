import { resolveServerApiUrl } from './vdsConfig';

/**
 * Santral Bayi Canlı Gemini Multimodal & Birebir Ses Klonlama (Voice Cloning) Servisi
 * - Robotik Android TTS (AndroidBridge.speakText) ve window.speechSynthesis KESİNLİKLE KAPALIDIR.
 * - Standart spiker sesleri (EmelNeural / Google TTS) KESİNLİKLE KULLANILMAZ.
 * - Tüm kayıtlı metinler (isim, firma, karşılama, kurallar) doğrudan referans müşteri hizmetleri
 *   ses kaydının (veya Yöneticinin yüklediği yeni ses tonunun) klonlanmış ses rengiyle okunur.
 */

export interface CallHandlingResult {
  transcript: { speaker: 'AI' | 'CALLER'; text: string }[];
  summary: string;
  extractedNotes: string;
  appointmentBooked?: string;
  priceQuoted?: string;
  transferRequested?: boolean;
  transferReason?: string;
}

async function callServerGemini(params: {
  prompt: string;
  systemInstruction?: string;
  responseMimeType?: string;
  timeoutMs?: number;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 38000);
  try {
    const response = await fetch(resolveServerApiUrl('/api/gemini/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.status}`);
    }
    const data = await response.json();
    return data.text || '';
  } finally {
    clearTimeout(timer);
  }
}

export function cleanSpokenTurkishText(rawText: string): string {
  return String(rawText || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[🎵📞🔄✅🚨🤖👩‍💼🤝🔊📤📋📢✨⚪🟢]/gu, ' ')
    .replace(/["“”«»]/g, '')
    .replace(/\s*->\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeManifestKey(rawText: string): string {
  return cleanSpokenTurkishText(rawText).toLocaleLowerCase('tr-TR');
}

function hashVoiceClipKey(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'vc_' + (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    } catch {
      resolve('');
    }
  });
}

async function persistBlobToNativeVoiceStorage(nativeKey: string, blob: Blob): Promise<void> {
  if (typeof window === 'undefined' || blob.size < 2000 || blob.size > 650000) return;
  try {
    const bridge = (window as unknown as {
      AndroidBridge?: { saveOfflineVoiceClip?: (k: string, b64: string) => void };
    }).AndroidBridge;
    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl.startsWith('data:audio/')) return;
    if (bridge && typeof bridge.saveOfflineVoiceClip === 'function') {
      bridge.saveOfflineVoiceClip(nativeKey, dataUrl);
    }
  } catch {}
}

async function readBlobFromNativeVoiceStorage(nativeKey: string): Promise<Blob | null> {
  if (typeof window === 'undefined') return null;
  try {
    const bridge = (window as unknown as {
      AndroidBridge?: { getOfflineVoiceClip?: (k: string) => string };
    }).AndroidBridge;
    const dataUrl = bridge?.getOfflineVoiceClip?.(nativeKey) || '';
    if (!dataUrl || !dataUrl.startsWith('data:audio/')) return null;
    const res = await fetch(dataUrl);
    const b = await res.blob();
    return b.size > 2000 ? b : null;
  } catch {
    return null;
  }
}

/**
 * Step 3 önizleme metni veya çok cümleli metinleri atomik klonlanmış cümle parçalarına ayırır.
 */
function splitClonedClauses(cleanText: string): string[] {
  if (!cleanText) return [];

  // Karşılama cümlesinden ("Size nasıl yardımcı olabilirim?") sonra ek yetki veya görüşme özeti varsa
  // karşılamanın sıfır bekleme ile anında başlaması için tam bu noktadan ayır
  const greetingSplitMatch = cleanText.match(
    /^(.*?size nasıl yardımcı olabilirim\?)\s+(.+)$/i
  );
  if (greetingSplitMatch) {
    const first = greetingSplitMatch[1].trim();
    const rest = greetingSplitMatch[2].trim();
    return [first, ...splitClonedClauses(rest)];
  }

  // Özel olarak Kurulum 3. Adım'daki bileşik önizleme metnini atomik parçalara ayır
  if (cleanText.includes('diyerek karşılarım.') || cleanText.includes('diyerek hattı bağlarım.')) {
    return cleanText
      .split(/(?<=diyerek karşılarım\.)\s+|(?<=diyerek hattı bağlarım\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (cleanText.length <= 220) {
    return [cleanText];
  }

  return cleanText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const CLONE_IDB_NAME = 'sb_cloned_voice_cache_v1';
const CLONE_IDB_STORE = 'clips';

function openCloneDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(CLONE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CLONE_IDB_STORE)) {
          db.createObjectStore(CLONE_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getClonedBlobFromIdb(cacheKey: string): Promise<Blob | null> {
  const db = await openCloneDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CLONE_IDB_STORE, 'readonly');
      const req = tx.objectStore(CLONE_IDB_STORE).get(cacheKey);
      req.onsuccess = () => {
        db.close();
        const val = req.result;
        resolve(val instanceof Blob ? val : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function saveClonedBlobToIdb(cacheKey: string, blob: Blob): Promise<void> {
  const db = await openCloneDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CLONE_IDB_STORE, 'readwrite');
      tx.objectStore(CLONE_IDB_STORE).put(blob, cacheKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

const CHATTERBOX_MIRRORS = [
  'https://echo-ai-official-chatterbox-multilingual-tts.hf.space',
  'https://sellopale-chatterbox-multilingual-tts.hf.space',
  'https://kj-k-chatterbox-multilingual-tts.hf.space',
  'https://sched75-chatterbox-multilingual-tts.hf.space',
  'https://shahshawaiz-chatterbox-multilingual-tts.hf.space',
  'https://nextdrought-chatterbox-multilingual-tts.hf.space',
  'https://rahul7star-chatterbox-multilingual-tts.hf.space',
];

export interface CallerRecognitionCard {
  callerPhone11: string;
  isKnownCaller: boolean;
  recognizedName: string;
  callerTypeLabel: string;
  previousCallCount: number;
  lastCallTimestamp: string;
  lastCallSummary: string;
  activeAppointments: string[];
  isExcludedDirectContact: boolean;
}

export class GeminiCallAssistantService {
  public async lookupCallerRecognition(
    callerPhone: string,
    subscriberPhone?: string
  ): Promise<CallerRecognitionCard | null> {
    try {
      const qs = new URLSearchParams({
        callerPhone: String(callerPhone || ''),
        subscriberPhone: String(subscriberPhone || ''),
      });
      const res = await fetch(resolveServerApiUrl(`/api/pbx/caller-profile?${qs.toString()}`), {
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json?.profile as CallerRecognitionCard) || null;
    } catch {
      return null;
    }
  }

  public async runLiveReceptionTurn(params: {
    subscriberPhone: string;
    callerPhone: string;
    callerName?: string;
    callerSpeechText: string;
    conversationHistory?: { speaker: 'AI' | 'CALLER'; text: string }[];
    knowledgeBaseOverride?: string;
    businessAddressOverride?: string;
    autoRingOwner?: boolean;
  }): Promise<{
    secretaryReply: string;
    issueSummary: string;
    intentCategory: string;
    shouldTransferToOwner: boolean;
    extractedAppointment: string;
    callerNameDetected: string;
    callerProfile?: CallerRecognitionCard;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 38000);
    try {
      const response = await fetch(resolveServerApiUrl('/api/pbx/ai-reception'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriberPhone: params.subscriberPhone,
          callerPhone: params.callerPhone,
          callerName: params.callerName,
          callerSpeechText: params.callerSpeechText,
          conversationHistory: params.conversationHistory || [],
          knowledgeBaseOverride: params.knowledgeBaseOverride || '',
          businessAddressOverride: params.businessAddressOverride || '',
          autoRingOwner: params.autoRingOwner ?? false,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || 'Yapay zekâ sekreter bağlantısı şu an yanıt veremedi.'
        );
      }
      return {
        secretaryReply: String(data.secretaryReply || '').trim(),
        issueSummary: String(data.issueSummary || '').trim(),
        intentCategory: String(data.intentCategory || 'INFO'),
        shouldTransferToOwner: Boolean(data.shouldTransferToOwner),
        extractedAppointment: String(data.extractedAppointment || '').trim(),
        callerNameDetected: String(data.callerNameDetected || '').trim(),
        callerProfile: data.callerProfile,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async generateVoiceResponse(params: {
    callerSpeech: string;
    businessName: string;
    agentName: string;
    knowledgeBase: string;
    subscriberPhone?: string;
    callerPhone?: string;
    conversationHistory?: { speaker: 'AI' | 'CALLER'; text: string }[];
    persuasionTone?: 'COURTEOUS' | 'PERSUASIVE' | 'SALES_FOCUSED';
    warmTransferEnabled?: boolean;
    callerName?: string;
  }): Promise<{
    replyText: string;
    shouldTransfer: boolean;
    transferNotes?: string;
    extractedAppointment?: string;
    callerNameDetected?: string;
  }> {
    const live = await this.runLiveReceptionTurn({
      subscriberPhone: params.subscriberPhone || '05376031645',
      callerPhone: params.callerPhone || '05449876543',
      callerName: params.callerName,
      callerSpeechText: params.callerSpeech,
      conversationHistory: params.conversationHistory,
      knowledgeBaseOverride: params.knowledgeBase,
      autoRingOwner: false,
    });

    return {
      replyText: live.secretaryReply,
      shouldTransfer: live.shouldTransferToOwner,
      transferNotes: live.issueSummary || undefined,
      extractedAppointment: live.extractedAppointment || undefined,
      callerNameDetected: live.callerNameDetected || undefined,
    };
  }

  public async summarizeCall(params: {
    dialogue: { speaker: string; text: string }[];
    businessName: string;
  }): Promise<{ summary: string; extractedNotes: string; customerLeadQuality: 'HOT' | 'WARM' | 'INFO' }> {
    const formattedDialogue = params.dialogue
      .map((d) => `${d.speaker === 'AI' ? 'Asistan' : 'Müşteri'}: ${d.text}`)
      .join('\n');

    const prompt = `
Aşağıdaki telefon görüşmesini analiz et ve işletme sahibi için doğal Türkçe özet ve aksiyon notunu JSON formatında çıkar:
İşletme: ${params.businessName}

Diyalog:
${formattedDialogue}

Çıktı Formatı SADECE geçerli JSON olmalıdır:
{
  "summary": "Özet cümle",
  "extractedNotes": "İşletme sahibi için net not",
  "customerLeadQuality": "HOT" | "WARM" | "INFO"
}
`;

    const text = await callServerGemini({
      prompt,
      responseMimeType: 'application/json',
    });

    const parsed = JSON.parse(text || '{}') as Record<string, string>;
    return {
      summary: String(parsed.summary || '').trim(),
      extractedNotes: String(parsed.extractedNotes || '').trim(),
      customerLeadQuality: (parsed.customerLeadQuality as 'HOT' | 'WARM' | 'INFO') || 'WARM',
    };
  }

  public async generateWhatsAppResponse(params: {
    userMessage: string;
    callerPhone?: string;
    subscriberPhone?: string;
    businessName: string;
    contactName: string;
    knowledgeBase?: string;
    catalogEnabled: boolean;
    bookingEnabled: boolean;
    transferEnabled: boolean;
    offHoursEnabled: boolean;
    workHours: string;
    address: string;
  }): Promise<{
    replyText: string;
    actionType: 'CATALOG' | 'BOOKING' | 'TRANSFER' | 'INFO';
    bookingDetails?: { service: string; time: string };
    transferDetails?: { contactName: string; reason: string };
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 38000);
    try {
      const response = await fetch(resolveServerApiUrl('/api/ai/whatsapp-reply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'WhatsApp yapay zekâ servisi şu an yanıt veremedi.');
      }
      return {
        replyText: String(data.replyText || '').trim(),
        actionType: data.actionType || 'INFO',
        bookingDetails: data.bookingDetails,
        transferDetails: data.transferDetails,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async analyzeAndRespondSupport(params: {
    userMessage: string;
    currentRole: string;
    senderTitle: string;
    senderCode: string;
    senderPersonName: string;
    senderPhone: string;
    forceEscalate?: boolean;
  }): Promise<{
    replyText: string;
    isEscalatedToAdmin: boolean;
    issueCategory: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 38000);
    try {
      const response = await fetch(resolveServerApiUrl('/api/ai/support-reply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Destek yapay zekâ servisi şu an yanıt veremedi.');
      }
      return {
        replyText: String(data.replyText || '').trim(),
        isEscalatedToAdmin: Boolean(data.isEscalatedToAdmin),
        issueCategory: String(data.issueCategory || 'Bilgi & Eğitim'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async generateAppSupportResponse(userMessage: string, currentRole?: string): Promise<string> {
    const res = await this.analyzeAndRespondSupport({
      userMessage,
      currentRole: currentRole || 'esnaf',
      senderTitle: '',
      senderCode: '',
      senderPersonName: '',
      senderPhone: '',
      forceEscalate: false,
    });
    return res.replyText;
  }

  private customAppliedVoiceUrl: string | null = null;
  private cachedBlobUrls: Map<string, string> = new Map();
  private preloadPromises: Map<string, Promise<string>> = new Map();
  private inFlightClones: Map<string, Promise<string | null>> = new Map();
  private referenceVoiceBlobCache: { refUrl: string; blob: Blob } | null = null;
  private uploadedGradioPathCache: Map<string, { path: string; expiresAt: number }> = new Map();
  private activeHtmlAudio: HTMLAudioElement | null = null;
  private sharedAudioEl: HTMLAudioElement | null = null;
  private sharedAudioUnlocked = false;
  private activePlayToken = 0;
  private latestServerVoiceVersion: string = 'cloned_v2';
  private neuralManifest: Record<string, string> | null = null;
  private neuralManifestLoading: Promise<Record<string, string>> | null = null;

  private resolveOrigin(): string {
    if (typeof window !== 'undefined') {
      const origin = window.location?.origin || '';
      if (origin && !origin.startsWith('blob:') && !origin.startsWith('file:')) {
        if (
          window.location.hostname === 'localhost' &&
          (!window.location.port || window.location.port === '80' || window.location.port === '443')
        ) {
          return 'http://178.208.187.42:3000';
        }
        return origin;
      }
    }
    return 'http://178.208.187.42:3000';
  }

  public normalizeAudioUrl(url?: string | null): string {
    const origin = this.resolveOrigin();
    if (!url || !url.trim()) {
      return `${origin}/assets/aistudio/sekreter_ornek_ses.mp3?v=${this.latestServerVoiceVersion}`;
    }
    const trimmed = url.trim();
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://')
    ) {
      return trimmed;
    }
    if (trimmed.startsWith('./')) {
      return `${origin}/${trimmed.slice(2)}`;
    }
    if (trimmed.startsWith('/')) {
      return `${origin}${trimmed}`;
    }
    return `${origin}/${trimmed}`;
  }

  public async loadNeuralManifest(): Promise<Record<string, string>> {
    if (this.neuralManifest && Object.keys(this.neuralManifest).length > 0) {
      return this.neuralManifest;
    }
    if (this.neuralManifestLoading) return this.neuralManifestLoading;

    const readCachedManifest = (): Record<string, string> => {
      if (typeof window === 'undefined') return {};
      try {
        const raw = window.localStorage.getItem('local_voice_manifest_v2');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
        }
      } catch {}
      return {};
    };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const offlineClips = readCachedManifest();
      this.neuralManifest = offlineClips;
      return offlineClips;
    }

    this.neuralManifestLoading = (async () => {
      const merged: Record<string, string> = { ...readCachedManifest() };
      const endpoints = [
        resolveServerApiUrl('/api/voice-bank/manifest'),
        this.normalizeAudioUrl('/assets/aistudio/neural/manifest.json'),
      ];
      for (const ep of endpoints) {
        try {
          const r = await fetch(`${ep}?t=${Date.now()}`, { cache: 'no-cache' });
          if (r.ok) {
            const json = (await r.json()) as Record<string, unknown>;
            if (json && typeof json.clips === 'object' && json.clips) {
              Object.assign(merged, json.clips as Record<string, string>);
            }
          }
        } catch {}
      }
      this.neuralManifest = merged;
      if (typeof window !== 'undefined' && Object.keys(merged).length > 0) {
        try {
          window.localStorage.setItem('local_voice_manifest_v2', JSON.stringify(merged));
        } catch {}
      }
      return merged;
    })().finally(() => {
      this.neuralManifestLoading = null;
    });

    return this.neuralManifestLoading;
  }

  public async refreshServerVoiceVersion(): Promise<void> {
    try {
      const res = await fetch(resolveServerApiUrl(`/api/server-meta?t=${Date.now()}`), { cache: 'no-store' });
      if (res.ok) {
        const meta = await res.json();
        if (meta?.voiceVersion && meta.voiceVersion !== this.latestServerVoiceVersion) {
          this.latestServerVoiceVersion = String(meta.voiceVersion);
        }
      }
    } catch {}
  }

  private getOrCreateSharedAudio(): HTMLAudioElement {
    if (!this.sharedAudioEl && typeof document !== 'undefined') {
      const el = document.createElement('audio');
      el.preload = 'auto';
      el.setAttribute('playsinline', 'true');
      this.sharedAudioEl = el;
    }
    return this.sharedAudioEl as HTMLAudioElement;
  }

  private unlockSharedAudioSync(): void {
    if (typeof document === 'undefined') return;
    const el = this.getOrCreateSharedAudio();
    if (!el || this.sharedAudioUnlocked) return;
    try {
      // Dokunma anında sessiz 44 bayt sesle mobil ses kilidini senkron aç
      el.src =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      el.muted = true;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          el.pause();
          el.muted = false;
          el.currentTime = 0;
          this.sharedAudioUnlocked = true;
        }).catch(() => {
          el.muted = false;
        });
      } else {
        el.muted = false;
        this.sharedAudioUnlocked = true;
      }
    } catch {
      el.muted = false;
    }
  }

  public stopAllSpeech(): void {
    this.activePlayToken++;
    if (this.activeHtmlAudio) {
      try {
        this.activeHtmlAudio.onended = null;
        this.activeHtmlAudio.onerror = null;
        this.activeHtmlAudio.pause();
        this.activeHtmlAudio.currentTime = 0;
      } catch {}
      this.activeHtmlAudio = null;
    }
    if (typeof window !== 'undefined') {
      try {
        (window as unknown as { AndroidBridge?: { stopSpeaking?: () => void } }).AndroidBridge?.stopSpeaking?.();
      } catch {}
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    }
  }

  public preloadVoiceAudio(rawUrl?: string): Promise<string> {
    const targetUrl = this.normalizeAudioUrl(rawUrl || this.secretaryVoiceProfile.sampleAudioUrl);
    if (typeof window === 'undefined') return Promise.resolve(targetUrl);

    if (targetUrl.startsWith('data:') || targetUrl.startsWith('blob:')) {
      return Promise.resolve(targetUrl);
    }

    const existingBlob = this.cachedBlobUrls.get(targetUrl);
    if (existingBlob) return Promise.resolve(existingBlob);

    const inFlight = this.preloadPromises.get(targetUrl);
    if (inFlight) return inFlight;

    const promise = fetch(targetUrl, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('Audio preload status ' + res.status);
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        this.cachedBlobUrls.set(targetUrl, blobUrl);
        return blobUrl;
      })
      .catch(() => targetUrl)
      .finally(() => {
        this.preloadPromises.delete(targetUrl);
      });

    this.preloadPromises.set(targetUrl, promise);
    return promise;
  }

  public createInstantAudio(overrideUrl?: string | null): HTMLAudioElement {
    this.stopAllSpeech();
    const targetUrl = this.normalizeAudioUrl(
      overrideUrl || this.customAppliedVoiceUrl || this.secretaryVoiceProfile.sampleAudioUrl
    );
    const cachedBlob = this.cachedBlobUrls.get(targetUrl);
    const readySrc = cachedBlob || targetUrl;
    if (!cachedBlob && !targetUrl.startsWith('data:')) {
      void this.preloadVoiceAudio(targetUrl);
    }
    const audio = new Audio(readySrc);
    audio.preload = 'auto';
    this.activeHtmlAudio = audio;
    return audio;
  }

  private getActiveReferenceVoiceUrl(): string {
    if (this.hasExplicitCustomVoiceUpload()) {
      return this.getActiveUploadedVoiceUrl();
    }
    return this.normalizeAudioUrl('/assets/aistudio/ref_voice_15s.wav');
  }

  private async getActiveReferenceVoiceBlob(): Promise<{ sig: string; blob: Blob }> {
    const refUrl = this.getActiveReferenceVoiceUrl();
    if (this.referenceVoiceBlobCache && this.referenceVoiceBlobCache.refUrl === refUrl) {
      return { sig: refUrl.slice(-48), blob: this.referenceVoiceBlobCache.blob };
    }
    const res = await fetch(refUrl, { cache: 'force-cache' });
    if (!res.ok) {
      throw new Error('Referans ses yüklenemedi: ' + res.status);
    }
    const blob = await res.blob();
    this.referenceVoiceBlobCache = { refUrl, blob };
    return { sig: refUrl.slice(-48), blob };
  }

  private async cloneViaMirror(baseUrl: string, clause: string, refBlob: Blob, refSig: string): Promise<Blob> {
    const cacheMapKey = `${baseUrl}::${refSig}`;
    let remotePath = '';
    const cachedUpload = this.uploadedGradioPathCache.get(cacheMapKey);
    if (cachedUpload && cachedUpload.expiresAt > Date.now()) {
      remotePath = cachedUpload.path;
    } else {
      const fd = new FormData();
      const ext = refBlob.type.includes('mpeg') || refBlob.type.includes('mp3') ? 'mp3' : 'wav';
      fd.append('files', refBlob, `ref_voice.${ext}`);
      const upRes = await fetch(`${baseUrl}/gradio_api/upload`, { method: 'POST', body: fd });
      if (!upRes.ok) throw new Error(`Upload ${upRes.status}`);
      const upJson = (await upRes.json()) as string[];
      remotePath = upJson[0];
      this.uploadedGradioPathCache.set(cacheMapKey, {
        path: remotePath,
        expiresAt: Date.now() + 8 * 60 * 1000,
      });
    }

    const timeoutMs = 16000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const callRes = await fetch(`${baseUrl}/gradio_api/call/generate_tts_audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            clause,
            'tr',
            { path: remotePath, meta: { _type: 'gradio.FileData' } },
            0.35,
            0.65,
            0,
            0.6,
          ],
        }),
        signal: ctrl.signal,
      });
      if (!callRes.ok) throw new Error(`Call ${callRes.status}`);
      const { event_id } = (await callRes.json()) as { event_id: string };
      const sseRes = await fetch(`${baseUrl}/gradio_api/call/generate_tts_audio/${event_id}`, {
        signal: ctrl.signal,
      });
      const sseText = await sseRes.text();
      const lines = sseText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event: complete') && lines[i + 1]) {
          let payload: Array<{ url?: string; path?: string }> = [];
          try {
            payload = JSON.parse(lines[i + 1].replace(/^data:\s*/, ''));
          } catch {
            throw new Error('Invalid SSE JSON');
          }
          const item = payload[0];
          const audioUrl = item?.url || `${baseUrl}/gradio_api/file=${item?.path}`;
          const audioRes = await fetch(audioUrl, { signal: ctrl.signal });
          if (!audioRes.ok) throw new Error('Audio fetch failed');
          const outBlob = await audioRes.blob();
          if (outBlob.size < 1500) throw new Error('Cloned blob too small');
          return outBlob;
        }
        if (lines[i].startsWith('event: error')) {
          this.uploadedGradioPathCache.delete(cacheMapKey);
          throw new Error('Gradio SSE error');
        }
      }
      throw new Error('Incomplete SSE');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Tek bir Türkçe cümleyi klonlanmış sıcak kadın sesiyle çözer ve telefonun iç hafızasına kalıcı mühürler:
   * 1) RAM veya Telefon Kalıcı Ses Hafızasında (IndexedDB + Android iç hafıza) varsa -> 0 ms anında çalar (internetsiz de çalışır!)
   * 2) Merkez Kalıcı Ses Kasasında (voice-bank / manifest) varsa -> indirip telefon hafızasına mühürler
   * 3) Yeni yazılmış bir isim/firma ise -> merkez /api/tts üzerinden klonlayıp hem merkeze hem telefona kalıcı mühürler
   */
  public async resolveClonedClauseAudioUrl(clause: string): Promise<string | null> {
    const normKey = normalizeManifestKey(clause);
    if (!normKey) return null;

    const isDefaultVoice = !this.hasExplicitCustomVoiceUpload();
    const refUrl = this.getActiveReferenceVoiceUrl();
    const idbKey = `${isDefaultVoice ? 'kore_live_v1' : refUrl.slice(-48)}::${normKey}`;
    const nativeKey = hashVoiceClipKey(idbKey);

    // 1) Önce RAM ve Telefon Kalıcı Hafızasına bak (İnternet olmasa bile 0 ms içinde çalar!)
    const memCached = this.cachedBlobUrls.get(idbKey);
    if (memCached) return memCached;

    const idbBlob = await getClonedBlobFromIdb(idbKey);
    if (idbBlob && idbBlob.size > 2000) {
      const objUrl = URL.createObjectURL(idbBlob);
      this.cachedBlobUrls.set(idbKey, objUrl);
      return objUrl;
    }

    const nativeBlob = await readBlobFromNativeVoiceStorage(nativeKey);
    if (nativeBlob && nativeBlob.size > 2000) {
      await saveClonedBlobToIdb(idbKey, nativeBlob);
      const objUrl = URL.createObjectURL(nativeBlob);
      this.cachedBlobUrls.set(idbKey, objUrl);
      return objUrl;
    }

    // İnternet kapalıysa ve telefon paketinin (localhost) kendi içinde bu MP3 gömülüyse doğrudan oradan oku
    if (isDefaultVoice && typeof navigator !== 'undefined' && navigator.onLine === false) {
      const offlineManifest = await this.loadNeuralManifest();
      const rel = offlineManifest[normKey];
      if (rel) {
        const fileName = rel.split('/').pop() || '';
        if (fileName) {
          const bundledPath = `/assets/aistudio/neural/${fileName}`;
          try {
            const r = await fetch(bundledPath);
            if (r.ok) {
              const b = await r.blob();
              if (b.size > 2000 && (b.type.includes('audio') || fileName.endsWith('.mp3'))) {
                await saveClonedBlobToIdb(idbKey, b);
                const objUrl = URL.createObjectURL(b);
                this.cachedBlobUrls.set(idbKey, objUrl);
                return objUrl;
              }
            }
          } catch {}
        }
      }
      return null;
    }

    const existingFlight = this.inFlightClones.get(idbKey);
    if (existingFlight) return existingFlight;

    const flight = (async (): Promise<string | null> => {
      // 2) Varsayılan ses: Canlı telefondaki birebir aynı tek sıcak kadın sesini merkezden al (eski farklı kadın kaydını atla!)
      if (isDefaultVoice) {
        try {
          const ttsCtrl = new AbortController();
          const ttsTimer = setTimeout(() => ttsCtrl.abort(), 10000);
          try {
            const res = await fetch(resolveServerApiUrl('/api/tts'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: clause }),
              signal: ttsCtrl.signal,
            });
            if (res.ok) {
              const data = await res.json();
              if (data?.dynamic === true && typeof data.audioDataUrl === 'string') {
                const resolvedUrl = data.audioDataUrl.startsWith('data:audio/')
                  ? data.audioDataUrl
                  : this.normalizeAudioUrl(data.audioDataUrl);
                const b = await (await fetch(resolvedUrl)).blob();
                if (b.size > 3500) {
                  await saveClonedBlobToIdb(idbKey, b);
                  void persistBlobToNativeVoiceStorage(nativeKey, b);
                  const objUrl = URL.createObjectURL(b);
                  this.cachedBlobUrls.set(idbKey, objUrl);
                  return objUrl;
                }
              }
            }
          } finally {
            clearTimeout(ttsTimer);
          }
        } catch {}
      }

      // 3) Yeni yazılmış bir firma/isim cümlesiyse: merkez ses servisi ve telefon klonlamasını beklemeden paralel yarıştır,
      // hangisi ilk üretirse hem telefona hem merkez ses kasasına kalıcı mühürle!
      const serverTtsCandidate = (async (): Promise<Blob> => {
        if (!isDefaultVoice) {
          throw new Error('Custom reference active');
        }
        const ttsCtrl = new AbortController();
        const ttsTimer = setTimeout(() => ttsCtrl.abort(), 14000);
        try {
          const res = await fetch(resolveServerApiUrl('/api/tts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: clause }),
            signal: ttsCtrl.signal,
          });
          if (!res.ok) throw new Error(`TTS ${res.status}`);
          const data = await res.json();
          if (
            data?.dynamic === true &&
            typeof data.audioDataUrl === 'string' &&
            !data.audioDataUrl.includes('ref_voice_15s')
          ) {
            const resolvedUrl = data.audioDataUrl.startsWith('data:audio/')
              ? data.audioDataUrl
              : this.normalizeAudioUrl(data.audioDataUrl);
            const b = await (await fetch(resolvedUrl)).blob();
            if (b.size > 3500) return b;
          }
          throw new Error('No dynamic audio');
        } finally {
          clearTimeout(ttsTimer);
        }
      })();

      const mirrorCloneCandidate = (async (): Promise<Blob> => {
        const { sig, blob: refBlob } = await this.getActiveReferenceVoiceBlob();
        const clonedBlob = await Promise.any(
          CHATTERBOX_MIRRORS.slice(0, 3).map((mirror) =>
            this.cloneViaMirror(mirror, clause, refBlob, sig)
          )
        );
        if (clonedBlob.size <= 3500) throw new Error('Small clone');
        if (isDefaultVoice) {
          void (async () => {
            try {
              const dataUrl = await blobToDataUrl(clonedBlob);
              await fetch(resolveServerApiUrl('/api/voice-bank/upload-clip'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: clause,
                  audioBase64: dataUrl,
                  ext: clonedBlob.type.includes('mpeg') ? 'mp3' : 'wav',
                }),
              });
            } catch {}
          })();
        }
        return clonedBlob;
      })();

      try {
        const winningBlob = await Promise.any([serverTtsCandidate, mirrorCloneCandidate]);
        if (winningBlob && winningBlob.size > 3500) {
          await saveClonedBlobToIdb(idbKey, winningBlob);
          void persistBlobToNativeVoiceStorage(nativeKey, winningBlob);
          const objUrl = URL.createObjectURL(winningBlob);
          this.cachedBlobUrls.set(idbKey, objUrl);
          return objUrl;
        }
      } catch {}

      return null;
    })().finally(() => {
      this.inFlightClones.delete(idbKey);
    });

    this.inFlightClones.set(idbKey, flight);
    return flight;
  }

  /**
   * Kullanıcı isim, firma veya kural değiştirdiğinde arka planda sessizce ses klonunu hazırlar (0 ms Dinle deneyimi için).
   */
  public warmClonedText(rawText: string): void {
    if (typeof window === 'undefined') return;
    const cleanText = cleanSpokenTurkishText(rawText);
    if (!cleanText) return;
    const clauses = splitClonedClauses(cleanText);
    for (const clause of clauses) {
      void this.resolveClonedClauseAudioUrl(clause);
    }
  }

  private playUrlPromise(srcUrl: string, token: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (token !== this.activePlayToken) {
        resolve(false);
        return;
      }
      const audio = this.getOrCreateSharedAudio();
      audio.muted = false;
      audio.src = srcUrl;
      this.activeHtmlAudio = audio;
      this.sharedAudioUnlocked = true;

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.activeHtmlAudio === audio) {
          this.activeHtmlAudio = null;
        }
        resolve(ok);
      };

      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }

  /**
   * Aktif panelin kayıtlı kişi adı, firma unvanı ve kurallarını referans ses tonuyla (varsayılan müşteri hizmetleri sesi
   * veya Yöneticinin yüklediği özel referans ses tonuyla) kelimesi kelimesine okur; asla ham örnek ses çalmaz.
   */
  public async speakRegisteredText(rawText: string, onEnd?: () => void): Promise<void> {
    if (typeof window === 'undefined') {
      onEnd?.();
      return;
    }

    this.stopAllSpeech();
    this.unlockSharedAudioSync();
    const myToken = ++this.activePlayToken;

    try {
      const cleanText = cleanSpokenTurkishText(rawText);
      if (!cleanText) {
        return;
      }

      const clauses = splitClonedClauses(cleanText);
      const urlPromises = clauses.map((c) => this.resolveClonedClauseAudioUrl(c));

      for (const p of urlPromises) {
        if (myToken !== this.activePlayToken) return;
        const audioUrl = await p;
        if (myToken !== this.activePlayToken) return;
        if (!audioUrl) continue;
        await this.playUrlPromise(audioUrl, myToken);
      }
    } finally {
      if (myToken === this.activePlayToken) {
        onEnd?.();
      }
    }
  }

  public readonly secretaryVoiceProfile = {
    referenceAudioUrl: '/assets/aistudio/M__teri_Hizmetleri_Ses_Kayd___1_-iyile_tirilmi_-v2_56b9a16a.mp3',
    sampleAudioUrl: '',
    lang: 'tr-TR',
    femalePitch: 1.0,
    femaleRate: 1.0,
    malePitch: 0.88,
    maleRate: 0.98,
  };

  public hasExplicitCustomVoiceUpload(): boolean {
    if (this.customAppliedVoiceUrl) return true;
    if (typeof window !== 'undefined') {
      try {
        const flag = window.localStorage.getItem('sb_admin_explicit_voice_upload_v2');
        const url = window.localStorage.getItem('sb_global_secretary_voice_url_v1');
        return flag === '1' && Boolean(url && url.trim());
      } catch {}
    }
    return false;
  }

  public clearExplicitCustomVoiceUpload(): void {
    this.customAppliedVoiceUrl = null;
    this.referenceVoiceBlobCache = null;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('sb_admin_explicit_voice_upload_v2');
        window.localStorage.removeItem('sb_global_secretary_voice_url_v1');
        window.localStorage.removeItem('sb_global_secretary_voice_name_v1');
        window.localStorage.removeItem('sb_global_secretary_voice_filename_v1');
      } catch {}
    }
  }

  public getActiveUploadedVoiceUrl(): string {
    if (this.customAppliedVoiceUrl) {
      return this.normalizeAudioUrl(this.customAppliedVoiceUrl);
    }
    if (typeof window !== 'undefined') {
      try {
        const savedUrl = window.localStorage.getItem('sb_global_secretary_voice_url_v1');
        if (savedUrl && savedUrl.trim()) {
          return this.normalizeAudioUrl(savedUrl);
        }
      } catch {}
    }
    return this.normalizeAudioUrl('/api/voice/custom');
  }

  public setGlobalVoiceAudioUrl(url: string, fileName?: string): void {
    const normalized = this.normalizeAudioUrl(url);
    this.customAppliedVoiceUrl = normalized;
    this.referenceVoiceBlobCache = null;
    this.uploadedGradioPathCache.clear();
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('sb_admin_explicit_voice_upload_v2', '1');
        window.localStorage.setItem('sb_global_secretary_voice_url_v1', normalized);
        if (fileName) {
          window.localStorage.setItem('sb_global_secretary_voice_name_v1', fileName);
          window.localStorage.setItem('sb_global_secretary_voice_filename_v1', fileName);
        }
      } catch {}
      void this.preloadVoiceAudio(normalized);
    }
  }

  public syncFromVaultKv(kv: Record<string, string>): string | null {
    const explicitFlag = kv['sb_admin_explicit_voice_upload_v2'];
    const savedUrl = kv['sb_global_secretary_voice_url_v1'];
    const savedName =
      kv['sb_global_secretary_voice_filename_v1'] ||
      kv['sb_global_secretary_voice_name_v1'] ||
      '';
    if (explicitFlag === '1' && savedUrl && savedUrl.trim()) {
      const normalized = this.normalizeAudioUrl(savedUrl);
      if (this.customAppliedVoiceUrl !== normalized) {
        this.customAppliedVoiceUrl = normalized;
        this.referenceVoiceBlobCache = null;
        void this.preloadVoiceAudio(normalized);
      }
      return savedName || 'Özel Sekreter Sesi';
    }
    if ('sb_admin_explicit_voice_upload_v2' in kv && explicitFlag !== '1') {
      this.customAppliedVoiceUrl = null;
      this.referenceVoiceBlobCache = null;
      return '';
    }
    return null;
  }

  public async synthesizeSpeechAudio(text: string, gender: 'FEMALE' | 'MALE' = 'FEMALE'): Promise<string | null> {
    if (gender === 'MALE') return null;
    if (this.hasExplicitCustomVoiceUpload()) {
      const url = this.getActiveUploadedVoiceUrl();
      return this.cachedBlobUrls.get(url) || url;
    }
    return this.resolveClonedClauseAudioUrl(text);
  }
}

export const geminiCallAssistant = new GeminiCallAssistantService();

if (typeof window !== 'undefined') {
  setTimeout(() => {
    void geminiCallAssistant.loadNeuralManifest();
    void geminiCallAssistant.refreshServerVoiceVersion();
  }, 200);
}

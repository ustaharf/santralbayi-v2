import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Ear,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Play,
  RefreshCw,
  Square,
  Volume2,
  Wifi,
} from 'lucide-react';
import { resolveServerApiUrl } from './vdsConfig';
import { formatDisplayGsm, normalizeTrGsmPhone } from './pbxRulesEngine';
import { CallLog } from './types';

export interface VoipCallSessionPayload {
  callId: string;
  fsUuid?: string;
  safeUuid?: string;
  mode: 'PBX_BRIDGE' | 'PEER_VOIP' | 'PBX_TEST';
  callerPhone11: string;
  callerName: string;
  callerCode?: string;
  targetPhone11: string;
  targetName: string;
  targetCode: string;
  screeningNote: string;
  spokenGreeting: string;
  callerIntent?: string;
  callerIssueSummary?: string;
  secretaryReply?: string;
  extractedAppointment?: string;
  diversionLinePhone11?: string;
  liveTranscript?: Array<{ speaker: 'AI' | 'CALLER'; text: string }>;
  turns?: number;
  status: 'RINGING' | 'CONNECTED' | 'ON_HOLD' | 'ENDED' | 'SECRETARY_HANDLED' | 'REJECTED';
  createdAt: number;
  answeredAt?: number;
  endedAt?: number;
  durationSec: number;
  endReason?: string;
}

export function dialRealPhoneNumber(phoneRaw: string): boolean {
  const cleanPhone = String(phoneRaw || '').replace(/[^0-9+*#]/g, '');
  if (!cleanPhone || cleanPhone.length < 3) return false;
  try {
    const win = window as any;
    if (win.AndroidBridge && typeof win.AndroidBridge.startWarmTransferCall === 'function') {
      win.AndroidBridge.startWarmTransferCall(cleanPhone, '', '');
      return true;
    }
  } catch {}
  try {
    const a = document.createElement('a');
    a.href = `tel:${cleanPhone}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {}
    }, 200);
    return true;
  } catch {
    return false;
  }
}

export function openRealWhatsApp(phoneRaw: string, message?: string): boolean {
  const digitsOnly = String(phoneRaw || '').replace(/[^0-9]/g, '');
  if (!digitsOnly || digitsOnly.length < 10) return false;
  let waDigits = digitsOnly;
  if (waDigits.startsWith('00')) waDigits = waDigits.slice(2);
  if (waDigits.length === 11 && waDigits.startsWith('0')) {
    waDigits = `90${waDigits.slice(1)}`;
  } else if (waDigits.length === 10 && waDigits.startsWith('5')) {
    waDigits = `90${waDigits}`;
  }
  const encodedMsg = message ? `?text=${encodeURIComponent(message)}` : '';
  const waUrl = `https://wa.me/${waDigits}${encodedMsg}`;
  try {
    const win = window as any;
    const isAndroidApp = Boolean(win.AndroidBridge && typeof win.AndroidBridge.isBridgeReady === 'function');
    if (isAndroidApp) {
      window.location.href = waUrl;
      return true;
    }
    const a = document.createElement('a');
    a.href = waUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {}
    }, 200);
    return true;
  } catch {
    return false;
  }
}

export interface OnlineVoipLine {
  phone11: string;
  role: string;
  code: string;
  name: string;
  connectedAt: number;
}

interface UseVoipDataSoftphoneParams {
  activePhoneRaw: string;
  activeRole: string;
  activeCode: string;
  activeDisplayName: string;
  onCallFinishedLog?: (log: CallLog) => void;
  onLiveCallEnded?: () => void;
  onPlaySecretaryAudio?: (call?: VoipCallSessionPayload) => void;
  onStopSecretaryAudio?: () => void;
}

function setNativeEarpieceOrSpeaker(speakerOn: boolean): void {
  try {
    const win = window as any;
    if (win.AndroidBridge && typeof win.AndroidBridge.setAudioRoute === 'function') {
      win.AndroidBridge.setAudioRoute(Boolean(speakerOn));
    }
  } catch {}
}

function releaseNativeCallAudio(): void {
  try {
    const win = window as any;
    if (win.AndroidBridge && typeof win.AndroidBridge.releaseCallAudioMode === 'function') {
      win.AndroidBridge.releaseCallAudioMode();
    }
  } catch {}
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const isTestVoipRecord = (c: Partial<VoipCallSessionPayload> | null | undefined): boolean => {
  if (!c) return true;
  if (c.mode === 'PBX_TEST') return true;
  if (normalizeTrGsmPhone(String(c.callerPhone11 || '')) === '05324440500') return true;
  if (/canlı doğrulama|santral aktarma/i.test(String(c.callerName || ''))) return true;
  return false;
};

export function useVoipDataSoftphone({
  activePhoneRaw,
  activeRole,
  activeCode,
  activeDisplayName,
  onCallFinishedLog,
  onLiveCallEnded,
  onPlaySecretaryAudio,
  onStopSecretaryAudio,
}: UseVoipDataSoftphoneParams) {
  const myPhone11 = normalizeTrGsmPhone(activePhoneRaw) || '05376031645';
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [onlineLines, setOnlineLines] = useState<OnlineVoipLine[]>([]);
  const [activeCall, setActiveCall] = useState<VoipCallSessionPayload | null>(null);
  const [recentVoipCalls, setRecentVoipCalls] = useState<VoipCallSessionPayload[]>(() => {
    try {
      const raw = localStorage.getItem(`local_voip_history_v1_${myPhone11}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((c) => !isTestVoipRecord(c));
          if (clean.length !== parsed.length) {
            localStorage.setItem(`local_voip_history_v1_${myPhone11}`, JSON.stringify(clean.slice(0, 60)));
          }
          return clean;
        }
      }
    } catch {}
    return [];
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [liveDurationSec, setLiveDurationSec] = useState<number>(0);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const activeCallRef = useRef<VoipCallSessionPayload | null>(null);
  activeCallRef.current = activeCall;
  const loggedCallIdsRef = useRef<Set<string>>(new Set());

  const activeMetaRef = useRef({ activeRole, activeCode, activeDisplayName });
  activeMetaRef.current = { activeRole, activeCode, activeDisplayName };
  const onCallFinishedLogRef = useRef(onCallFinishedLog);
  onCallFinishedLogRef.current = onCallFinishedLog;
  const onLiveCallEndedRef = useRef(onLiveCallEnded);
  onLiveCallEndedRef.current = onLiveCallEnded;
  const onPlaySecretaryAudioRef = useRef(onPlaySecretaryAudio);
  onPlaySecretaryAudioRef.current = onPlaySecretaryAudio;
  const onStopSecretaryAudioRef = useRef(onStopSecretaryAudio);
  onStopSecretaryAudioRef.current = onStopSecretaryAudio;

  // Ringtone Web Audio refs
  const ringAudioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WebRTC refs
  const peerConnRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioElRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const stopRingtone = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (ringAudioCtxRef.current) {
      try {
        void ringAudioCtxRef.current.close();
      } catch {}
      ringAudioCtxRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      ringAudioCtxRef.current = ctx;

      const playRingBurst = () => {
        try {
          if (!ringAudioCtxRef.current) return;
          if (ringAudioCtxRef.current.state === 'suspended') {
            void ringAudioCtxRef.current.resume();
          }
          const now = ringAudioCtxRef.current.currentTime;
          const osc1 = ringAudioCtxRef.current.createOscillator();
          const osc2 = ringAudioCtxRef.current.createOscillator();
          const gain = ringAudioCtxRef.current.createGain();
          osc1.type = 'sine';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(440, now);
          osc2.frequency.setValueAtTime(480, now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
          gain.gain.setValueAtTime(0.16, now + 0.85);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ringAudioCtxRef.current.destination);
          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.96);
          osc2.stop(now + 0.96);

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate([260, 140, 260]);
            } catch {}
          }
        } catch {}
      };

      playRingBurst();
      ringIntervalRef.current = setInterval(playRingBurst, 2200);
    } catch {}
  }, [stopRingtone]);

  const playShortIncomingAlert = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([180, 90, 180]);
        } catch {}
      }
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.14);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.34);
      setTimeout(() => {
        try {
          void ctx.close();
        } catch {}
      }, 450);
    } catch {}
  }, []);

  const cleanupWebRtcMedia = useCallback(() => {
    stopRingtone();
    onStopSecretaryAudioRef.current?.();
    if (peerConnRef.current) {
      try {
        peerConnRef.current.close();
      } catch {}
      peerConnRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      localStreamRef.current = null;
    }
    if (remoteAudioElRef.current) {
      remoteAudioElRef.current.srcObject = null;
    }
    pendingIceCandidatesRef.current = [];
    setIsMuted(false);
    setIsSpeakerOn(false);
    releaseNativeCallAudio();
  }, [stopRingtone]);

  const sendWebRtcSignal = useCallback(
    async (callId: string, toPhone: string, signalType: string, data: unknown) => {
      try {
        await fetch(resolveServerApiUrl('/api/voip/webrtc-signal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId,
            fromPhone: myPhone11,
            toPhone,
            signalType,
            data,
          }),
        });
      } catch {}
    },
    [myPhone11]
  );

  const ensurePeerConnection = useCallback(
    async (callId: string, peerPhone11: string): Promise<RTCPeerConnection | null> => {
      if (typeof RTCPeerConnection === 'undefined') return null;
      if (peerConnRef.current) return peerConnRef.current;

      const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
      peerConnRef.current = pc;

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          void sendWebRtcSignal(callId, peerPhone11, 'ice-candidate', evt.candidate.toJSON());
        }
      };

      pc.ontrack = (evt) => {
        const [remoteStream] = evt.streams;
        if (remoteStream && remoteAudioElRef.current) {
          remoteAudioElRef.current.srcObject = remoteStream;
          void remoteAudioElRef.current.play().catch(() => {});
        }
      };

      try {
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          localStreamRef.current = stream;
          for (const track of stream.getTracks()) {
            pc.addTrack(track, stream);
          }
        }
      } catch {
        // Mikrofon izni henüz verilmediyse salt dinleme olarak devam eder
      }

      return pc;
    },
    [sendWebRtcSignal]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`local_voip_history_v1_${myPhone11}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((c) => !isTestVoipRecord(c));
          if (clean.length !== parsed.length) {
            localStorage.setItem(`local_voip_history_v1_${myPhone11}`, JSON.stringify(clean.slice(0, 60)));
          }
          setRecentVoipCalls(clean);
          return;
        }
      }
    } catch {}
    setRecentVoipCalls([]);
  }, [myPhone11]);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch(resolveServerApiUrl(`/api/voip/history/${encodeURIComponent(myPhone11)}`), {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.calls)) {
          const clean = json.calls.filter((c: VoipCallSessionPayload) => !isTestVoipRecord(c));
          setRecentVoipCalls(clean);
          try {
            localStorage.setItem(
              `local_voip_history_v1_${myPhone11}`,
              JSON.stringify(clean.slice(0, 60))
            );
          } catch {}
        }
      }
    } catch {}
  }, [myPhone11]);

  // Gerçek zamanlı SSE bağlantısı (Otomatik yeniden bağlanma ile)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const meta = activeMetaRef.current;
      const qs = new URLSearchParams({
        phone11: myPhone11,
        role: meta.activeRole,
        code: meta.activeCode,
        name: meta.activeDisplayName,
      });
      const url = resolveServerApiUrl(`/api/voip/stream?${qs.toString()}`);
      es = new EventSource(url);

      es.onopen = () => {
        if (!unmounted) setSseConnected(true);
      };

      es.addEventListener('voip:init', (evt: MessageEvent) => {
        try {
          const payload = JSON.parse(evt.data);
          setSseConnected(true);
          if (Array.isArray(payload?.onlineLines)) {
            setOnlineLines(payload.onlineLines);
          }
          if (payload?.activeCall) {
            setIsMinimized(false);
            setActiveCall(payload.activeCall);
            if (
              payload.activeCall.mode !== 'PBX_BRIDGE' &&
              payload.activeCall.status === 'RINGING' &&
              payload.activeCall.targetPhone11 === myPhone11
            ) {
              startRingtone();
            }
          }
        } catch {}
      });

      es.addEventListener('voip:presence', (evt: MessageEvent) => {
        try {
          const payload = JSON.parse(evt.data);
          if (Array.isArray(payload?.onlineLines)) {
            setOnlineLines(payload.onlineLines);
          }
        } catch {}
      });

      es.addEventListener('call:incoming', (evt: MessageEvent) => {
        try {
          const call = JSON.parse(evt.data) as VoipCallSessionPayload;
          if (!call || !call.callId) return;
          if (activeCallRef.current?.callId === call.callId) {
            setActiveCall(call);
            return;
          }
          setIsMinimized(false);
          setActiveCall(call);
          if (call.mode === 'PBX_BRIDGE') {
            playShortIncomingAlert();
          } else {
            startRingtone();
          }
        } catch {}
      });

      es.addEventListener('call:outgoing_ringing', (evt: MessageEvent) => {
        try {
          const call = JSON.parse(evt.data) as VoipCallSessionPayload;
          if (!call || !call.callId) return;
          setIsMinimized(false);
          setActiveCall(call);
        } catch {}
      });

      es.addEventListener('call:answered', async (evt: MessageEvent) => {
        try {
          const call = JSON.parse(evt.data) as VoipCallSessionPayload;
          stopRingtone();
          // Varsayılan olarak İÇ AHİZE (dış hoparlör kapalı!)
          setNativeEarpieceOrSpeaker(false);
          setIsSpeakerOn(false);
          setActiveCall(call);

          // Eğer ben arayan tarafsam (PEER_VOIP), cevaplandığı an gerçek WebRTC SDP Offer gönder
          if (
            call.mode === 'PEER_VOIP' &&
            call.callerPhone11 === myPhone11 &&
            call.targetPhone11 !== myPhone11
          ) {
            const pc = await ensurePeerConnection(call.callId, call.targetPhone11);
            if (pc) {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await sendWebRtcSignal(call.callId, call.targetPhone11, 'sdp-offer', offer);
            }
          }
        } catch {}
      });

      es.addEventListener('call:updated', (evt: MessageEvent) => {
        try {
          const call = JSON.parse(evt.data) as VoipCallSessionPayload;
          setActiveCall(call);
        } catch {}
      });

      es.addEventListener('call:ended', (evt: MessageEvent) => {
        try {
          const call = JSON.parse(evt.data) as VoipCallSessionPayload;
          cleanupWebRtcMedia();
          setActiveCall(null);
          setIsMinimized(false);
          setStatusBanner(call.endReason || 'Çağrı sonlandırıldı.');
          setTimeout(() => setStatusBanner(null), 4500);
          void refreshHistory();
          onLiveCallEndedRef.current?.();

          const finishCb = onCallFinishedLogRef.current;
          const meta = activeMetaRef.current;
          if (finishCb && call.callId && !isTestVoipRecord(call) && !loggedCallIdsRef.current.has(call.callId)) {
            loggedCallIdsRef.current.add(call.callId);
            const logStatus: CallLog['status'] =
              call.status === 'SECRETARY_HANDLED'
                ? 'AI_HANDLED'
                : call.durationSec > 0
                ? 'COMPLETED'
                : 'MISSED';
            finishCb({
              id: `voip-log-${call.callId}`,
              subscriberId: call.targetCode || meta.activeCode || 's-1',
              subscriberName: call.targetName || meta.activeDisplayName,
              callerPhone: formatDisplayGsm(call.callerPhone11),
              callerName: call.callerName,
              timestamp: new Date().toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit',
              }),
              duration: call.durationSec || 0,
              status: logStatus,
              transcript: [
                { speaker: 'AI', text: call.screeningNote || call.spokenGreeting },
                {
                  speaker: 'CALLER',
                  text:
                    call.endReason ||
                    (call.durationSec > 0
                      ? 'Uygulama içi VoIP Data (0 ₺) iç ahize görüşmesi tamamlandı.'
                      : 'Çağrı sonlandı.'),
                },
              ],
              aiSummary:
                call.endReason ||
                `VoIP Data (${call.durationSec} sn • 0 ₺ dakika ücreti) santral görüşmesi.`,
              extractedNotes: call.screeningNote || 'VoIP Data santral araması',
            });
          }
        } catch {}
      });

      es.addEventListener('webrtc:signal', async (evt: MessageEvent) => {
        try {
          const msg = JSON.parse(evt.data);
          const { callId, fromPhone11, signalType, data } = msg || {};
          if (!callId || !fromPhone11) return;
          const pc = await ensurePeerConnection(callId, fromPhone11);
          if (!pc) return;

          if (signalType === 'sdp-offer' && data) {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            for (const cand of pendingIceCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            pendingIceCandidatesRef.current = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendWebRtcSignal(callId, fromPhone11, 'sdp-answer', answer);
          } else if (signalType === 'sdp-answer' && data) {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            for (const cand of pendingIceCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            pendingIceCandidatesRef.current = [];
          } else if (signalType === 'ice-candidate' && data) {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
            } else {
              pendingIceCandidatesRef.current.push(data);
            }
          }
        } catch {}
      });

      es.onerror = () => {
        setSseConnected(false);
        try {
          es?.close();
        } catch {}
        es = null;
        if (!unmounted && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
          reconnectTimer = setTimeout(connect, 2800);
        }
      };
    };

    const syncActiveCallNow = async () => {
      if (unmounted) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        const res = await fetch(resolveServerApiUrl(`/api/voip/active/${encodeURIComponent(myPhone11)}`), {
          cache: 'no-store',
        });
        if (!res.ok || unmounted) return;
        const json = await res.json();
        const serverCall = json?.activeCall as VoipCallSessionPayload | null;
        if (serverCall && serverCall.callId) {
          const prevCall = activeCallRef.current;
          if (!prevCall || prevCall.callId !== serverCall.callId) {
            setIsMinimized(false);
            if (serverCall.mode === 'PBX_BRIDGE') {
              playShortIncomingAlert();
            }
          }
          setActiveCall(serverCall);
        } else if (activeCallRef.current && activeCallRef.current.mode === 'PBX_BRIDGE') {
          cleanupWebRtcMedia();
          setActiveCall(null);
          setIsMinimized(false);
          onLiveCallEndedRef.current?.();
        }
      } catch {}
    };

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void syncActiveCallNow();
        if (!es) connect();
      }
    };

    const handleOnline = () => {
      if (unmounted) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (!es) {
        connect();
      }
      void syncActiveCallNow();
      void refreshHistory();
    };

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      connect();
      void syncActiveCallNow();
      void refreshHistory();
    }
    const backupPoll = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void syncActiveCallNow();
      }
    }, 3500);
    window.addEventListener('online', handleOnline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      unmounted = true;
      clearInterval(backupPoll);
      window.removeEventListener('online', handleOnline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        es?.close();
      } catch {}
    };
  }, [
    cleanupWebRtcMedia,
    ensurePeerConnection,
    myPhone11,
    playShortIncomingAlert,
    refreshHistory,
    sendWebRtcSignal,
    startRingtone,
    stopRingtone,
  ]);

  // Canlı görüşme sayacı
  useEffect(() => {
    if (!activeCall || (activeCall.status !== 'CONNECTED' && activeCall.status !== 'ON_HOLD')) {
      setLiveDurationSec(0);
      return;
    }
    const baseTime = activeCall.answeredAt || Date.now();
    const updateSec = () => {
      setLiveDurationSec(Math.max(0, Math.floor((Date.now() - baseTime) / 1000)));
    };
    updateSec();
    const iv = setInterval(updateSec, 1000);
    return () => clearInterval(iv);
  }, [activeCall]);

  const answerIncomingCall = useCallback(async () => {
    const cur = activeCallRef.current;
    if (!cur) return;
    stopRingtone();
    // Dış hoparlöre ses çıkmasını kesin engelle -> İç ahizeye yönlendir!
    setNativeEarpieceOrSpeaker(false);
    setIsSpeakerOn(false);

    if (cur.mode === 'PEER_VOIP' && cur.callerPhone11 !== myPhone11) {
      await ensurePeerConnection(cur.callId, cur.callerPhone11);
    }

    try {
      const res = await fetch(resolveServerApiUrl('/api/voip/answer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: cur.callId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.call) setActiveCall(json.call);
      }
    } catch {}

    // PBX köprü veya canlı zil testiyse sekreterin gerçek ön bilgi sesini ahizeden çal
    if (cur.mode !== 'PEER_VOIP') {
      onPlaySecretaryAudioRef.current?.(cur);
    }
  }, [ensurePeerConnection, myPhone11, stopRingtone]);

  const rejectOrHangupCall = useCallback(
    async (customReason?: string) => {
      const cur = activeCallRef.current;
      cleanupWebRtcMedia();
      if (!cur) {
        setActiveCall(null);
        return;
      }
      try {
        await fetch(resolveServerApiUrl('/api/voip/hangup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: cur.callId,
            reason: customReason || '',
          }),
        });
      } catch {}
      setActiveCall(null);
    },
    [cleanupWebRtcMedia]
  );

  const transferCallToSecretary = useCallback(
    async (note?: string) => {
      const cur = activeCallRef.current;
      cleanupWebRtcMedia();
      if (!cur) return;
      try {
        await fetch(resolveServerApiUrl('/api/voip/transfer-secretary'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: cur.callId,
            note:
              note ||
              'Çağrı Yapay Zeka Sekretere bırakıldı • Müşteriden randevu/not alınıyor.',
          }),
        });
      } catch {}
      setActiveCall(null);
    },
    [cleanupWebRtcMedia]
  );

  const toggleHoldCall = useCallback(async () => {
    const cur = activeCallRef.current;
    if (!cur) return;
    const nextHold = cur.status !== 'ON_HOLD';
    try {
      const res = await fetch(resolveServerApiUrl('/api/voip/hold'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: cur.callId, hold: nextHold }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.call) setActiveCall(json.call);
      }
    } catch {}
  }, []);

  const toggleMuteMic = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getAudioTracks()) {
          t.enabled = !next;
        }
      }
      return next;
    });
  }, []);

  const toggleEarpieceSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => {
      const next = !prev;
      setNativeEarpieceOrSpeaker(next);
      return next;
    });
  }, []);

  const startVoipPeerCall = useCallback(
    async (targetPhoneRaw: string, targetLabel?: string) => {
      const target11 = normalizeTrGsmPhone(targetPhoneRaw);
      if (!target11 || target11.length < 10) {
        setStatusBanner('Lütfen geçerli bir 05XX numarası girin.');
        return;
      }
      setNativeEarpieceOrSpeaker(false);
      setIsSpeakerOn(false);
      try {
        const res = await fetch(resolveServerApiUrl('/api/voip/ring'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: target11 === myPhone11 ? 'PBX_TEST' : 'PEER_VOIP',
            callerPhone: target11 === myPhone11 ? '05324440500' : myPhone11,
            callerName:
              target11 === myPhone11 ? 'Müşteri Çağrısı (Santral Aktarma)' : activeDisplayName,
            callerCode: activeCode,
            targetPhone: target11,
            targetName: targetLabel || target11,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatusBanner(json?.error || 'Çağrı başlatılamadı.');
        } else if (target11 !== myPhone11 && !json?.targetOnline) {
          setStatusBanner(
            `${formatDisplayGsm(target11)} şu an uygulamada çevrimdışı; zil sinyali gönderildi.`
          );
        }
      } catch {
        setStatusBanner('VDS santral bağlantı hatası.');
      }
    },
    [activeCode, activeDisplayName, myPhone11]
  );

  const triggerSelfIncomingRingTest = useCallback(async () => {
    await startVoipPeerCall(myPhone11, activeDisplayName);
  }, [activeDisplayName, myPhone11, startVoipPeerCall]);

  const isPhoneOnlineInApp = useCallback(
    (phoneRaw: string) => {
      const target11 = normalizeTrGsmPhone(phoneRaw);
      if (!target11) return false;
      return onlineLines.some((line) => normalizeTrGsmPhone(line.phone11) === target11);
    },
    [onlineLines]
  );

  return {
    myPhone11,
    sseConnected,
    onlineLines,
    isPhoneOnlineInApp,
    activeCall,
    recentVoipCalls,
    isMuted,
    isSpeakerOn,
    isMinimized,
    setIsMinimized,
    liveDurationSec,
    statusBanner,
    remoteAudioElRef,
    answerIncomingCall,
    rejectOrHangupCall,
    transferCallToSecretary,
    toggleHoldCall,
    toggleMuteMic,
    toggleEarpieceSpeaker,
    startVoipPeerCall,
    triggerSelfIncomingRingTest,
    refreshHistory,
  };
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const GlobalIncomingVoipOverlay: React.FC<{
  voip: ReturnType<typeof useVoipDataSoftphone>;
  onOpenWhatsAppForCaller?: (phone: string, name: string, summary: string) => void;
}> = ({ voip, onOpenWhatsAppForCaller }) => {
  const {
    myPhone11,
    activeCall,
    isMuted,
    isSpeakerOn,
    isMinimized,
    setIsMinimized,
    liveDurationSec,
    remoteAudioElRef,
    answerIncomingCall,
    rejectOrHangupCall,
    transferCallToSecretary,
    toggleHoldCall,
    toggleMuteMic,
    toggleEarpieceSpeaker,
  } = voip;

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const liveLines = activeCall?.liveTranscript || [];
  const isLivePbxCall = activeCall?.mode === 'PBX_BRIDGE';

  useEffect(() => {
    if (transcriptEndRef.current) {
      try {
        transcriptEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } catch {}
    }
  }, [liveLines.length, isMinimized]);

  const handleCallBackNow = () => {
    if (!activeCall) return;
    const phoneToDial = activeCall.callerPhone11;
    void rejectOrHangupCall('Yetkili doğrudan geri aradı');
    dialRealPhoneNumber(phoneToDial);
  };

  const handleWhatsAppNow = () => {
    if (!activeCall) return;
    const callerLabel = activeCall.callerName || formatDisplayGsm(activeCall.callerPhone11);
    const summaryText =
      activeCall.screeningNote ||
      `Merhabalar ${callerLabel}, az önceki aramanızla ilgili dönüş yapıyorum.`;
    if (onOpenWhatsAppForCaller) {
      onOpenWhatsAppForCaller(activeCall.callerPhone11, callerLabel, summaryText);
      setIsMinimized(true);
      return;
    }
    openRealWhatsApp(
      activeCall.callerPhone11,
      `Merhabalar ${callerLabel}, aramanızla ilgili dönüş yapıyorum.`
    );
  };

  return (
    <>
      {/* WebRTC karşı taraf ses çıkışı */}
      <audio ref={remoteAudioElRef} autoPlay playsInline className="hidden" />

      {activeCall && isMinimized && (
        <div
          onClick={() => setIsMinimized(false)}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[9999] w-[94%] max-w-sm bg-emerald-950/95 border-2 border-emerald-400 rounded-2xl px-3 py-2 shadow-2xl flex items-center justify-between gap-2 cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-black text-white truncate">
                {activeCall.callerPhone11 === myPhone11 && activeCall.mode === 'PEER_VOIP'
                  ? activeCall.targetName
                  : activeCall.callerName}
              </p>
              <p className="text-[9.5px] text-emerald-300 font-bold truncate">
                {isLivePbxCall
                  ? `🤖 Sekreter Canlı Görüşüyor • ${formatSec(liveDurationSec)}`
                  : activeCall.status === 'RINGING'
                  ? '🔔 Zil Çalıyor • Dokun ve Aç'
                  : `👂 Görüşme Aktif • ${formatSec(liveDurationSec)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[10px] font-black cursor-pointer"
            >
              Aç
            </button>
            <button
              type="button"
              onClick={() => void rejectOrHangupCall('Görüşme sonlandırıldı')}
              className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black cursor-pointer"
            >
              Bitir
            </button>
          </div>
        </div>
      )}

      {activeCall && !isMinimized && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-3 text-center select-none">
          <div className="w-full max-w-sm max-h-[92dvh] overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 border-2 border-emerald-400/75 rounded-3xl p-4 shadow-2xl shadow-emerald-500/20 flex flex-col justify-between space-y-3.5">
            {/* Üst Bilgi Şeridi */}
            <div className="flex items-center justify-between gap-2">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 text-[10px] font-black flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>{isLivePbxCall ? 'CANLI GELEN ARAMA • 0 ₺' : 'SANTRAL İÇİ ARAMA • 0 ₺'}</span>
              </span>
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-bold cursor-pointer active:scale-95"
              >
                Küçült ↓
              </button>
            </div>

            {/* Arayan Kişi & Durum */}
            <div className="space-y-1.5">
              <div
                className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center border-2 shadow-xl ${
                  isLivePbxCall
                    ? 'bg-emerald-500/20 border-emerald-400 shadow-emerald-500/30'
                    : activeCall.status === 'RINGING'
                    ? 'bg-emerald-500/20 border-emerald-400 animate-bounce shadow-emerald-500/30'
                    : 'bg-sky-500/20 border-sky-400 shadow-sky-500/25'
                }`}
              >
                {isLivePbxCall ? (
                  <PhoneIncoming className="w-8 h-8 text-emerald-300 animate-pulse" />
                ) : activeCall.status === 'RINGING' ? (
                  <PhoneIncoming className="w-8 h-8 text-emerald-300" />
                ) : (
                  <PhoneCall className="w-8 h-8 text-sky-300" />
                )}
              </div>

              <h3 className="text-lg font-black text-white leading-tight break-words">
                {activeCall.callerPhone11 === myPhone11 && activeCall.mode === 'PEER_VOIP'
                  ? activeCall.targetName
                  : activeCall.callerName}
              </h3>
              <p className="text-xs font-mono font-bold text-cyan-300">
                {formatDisplayGsm(
                  activeCall.callerPhone11 === myPhone11 && activeCall.mode === 'PEER_VOIP'
                    ? activeCall.targetPhone11
                    : activeCall.callerPhone11
                )}
              </p>

              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-900 border border-emerald-500/30 text-[11px] font-extrabold text-emerald-300">
                {isLivePbxCall ? (
                  <span>🤖 Sekreter Canlı Görüşüyor • {formatSec(liveDurationSec)}</span>
                ) : activeCall.status === 'RINGING' ? (
                  activeCall.callerPhone11 === myPhone11 && activeCall.mode === 'PEER_VOIP' ? (
                    <span className="text-amber-300">📡 Karşı Uygulama Çaldırılıyor...</span>
                  ) : (
                    <span className="text-amber-300">🔔 Gelen Arama Çalıyor...</span>
                  )
                ) : activeCall.status === 'ON_HOLD' ? (
                  <span className="text-amber-300">⏸️ Beklemede • {formatSec(liveDurationSec)}</span>
                ) : (
                  <span>🟢 Görüşme Aktif • {formatSec(liveDurationSec)}</span>
                )}
              </div>
            </div>

            {/* Canlı Konuşma Yazısı veya Ön Görüşme Özeti */}
            <div className="bg-slate-900/95 border border-cyan-500/40 rounded-2xl p-3 text-left space-y-2">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-cyan-300 uppercase">
                  <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{isLivePbxCall ? 'Canlı Konuşma Akışı' : 'Sekreter Ön Görüşme Özeti'}</span>
                </div>
                {activeCall.callerIntent && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-[8.5px] font-black text-emerald-200">
                    {activeCall.callerIntent}
                  </span>
                )}
              </div>

              {isLivePbxCall && liveLines.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {liveLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed border ${
                        line.speaker === 'AI'
                          ? 'bg-emerald-950/70 border-emerald-500/35 text-emerald-100'
                          : 'bg-sky-950/70 border-sky-500/35 text-sky-100'
                      }`}
                    >
                      <span
                        className={`font-black text-[9.5px] block mb-0.5 ${
                          line.speaker === 'AI' ? 'text-emerald-300' : 'text-sky-300'
                        }`}
                      >
                        {line.speaker === 'AI' ? '🤖 Sekreter' : '👤 Arayan'}
                      </span>
                      {line.text}
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              ) : (
                <>
                  {activeCall.callerIssueSummary && (
                    <p className="text-[11px] font-extrabold text-emerald-300 leading-snug">
                      📌 {activeCall.callerIssueSummary}
                    </p>
                  )}
                  <p className="text-[11.5px] text-slate-200 leading-relaxed font-medium">
                    {activeCall.screeningNote}
                  </p>
                </>
              )}

              {activeCall.extractedAppointment && (
                <p className="text-[10px] font-bold text-amber-300 pt-0.5">
                  📅 Talep Detayı: {activeCall.extractedAppointment}
                </p>
              )}
            </div>

            {/* GERÇEK GELEN TELEFON ARAMASI BUTONLARI (HEPSİ GERÇEK ÇALIŞIR) */}
            {isLivePbxCall ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCallBackNow}
                    className="py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/25 cursor-pointer active:scale-95"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Hemen Geri Ara</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleWhatsAppNow}
                    className="py-3 rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-lg cursor-pointer active:scale-95"
                  >
                    <span>💬 WhatsApp</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMinimized(true)}
                    className="py-2.5 rounded-2xl bg-indigo-950/95 hover:bg-indigo-900 border border-indigo-400/50 text-indigo-100 font-black text-[11px] flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Bot className="w-4 h-4 text-indigo-300" />
                    <span>Sekretere Bırak</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void rejectOrHangupCall('Görüşme yetkili tarafından sonlandırıldı')}
                    className="py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-[11px] flex items-center justify-center gap-1.5 shadow-lg cursor-pointer active:scale-95"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>Görüşmeyi Bitir</span>
                  </button>
                </div>
              </div>
            ) : activeCall.status === 'RINGING' ? (
              activeCall.callerPhone11 === myPhone11 && activeCall.mode === 'PEER_VOIP' ? (
                <button
                  type="button"
                  onClick={() => void rejectOrHangupCall('Arama iptal edildi')}
                  className="w-full py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-95"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span>Aramayı İptal Et</span>
                </button>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        void rejectOrHangupCall(
                          'Yetkili meşgul • Sekreter 3 dk içinde dönüş yapılacağını iletti'
                        )
                      }
                      className="py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex flex-col items-center justify-center gap-1 shadow-lg cursor-pointer active:scale-95"
                    >
                      <PhoneOff className="w-5 h-5" />
                      <span>Meşgul / Reddet</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void answerIncomingCall()}
                      className="py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-500/30 cursor-pointer active:scale-95"
                    >
                      <Phone className="w-5 h-5" />
                      <span>Yeşil Aç (Ahize)</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void transferCallToSecretary(
                        'Sekreter karşıladı • Müşteriden not ve randevu talebi alındı'
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-400/50 text-indigo-200 font-extrabold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Bot className="w-4 h-4 text-indigo-300" />
                    <span>Sekretere Bırak (Not / Randevu Alsın)</span>
                  </button>
                </div>
              )
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={toggleMuteMic}
                    className={`py-2.5 px-2 rounded-xl border text-[10.5px] font-extrabold flex flex-col items-center gap-1 cursor-pointer ${
                      isMuted
                        ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                        : 'bg-slate-900 border-slate-700 text-slate-200'
                    }`}
                  >
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    <span>{isMuted ? 'Sessizde' : 'Mikrofon'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={toggleEarpieceSpeaker}
                    className={`py-2.5 px-2 rounded-xl border text-[10.5px] font-extrabold flex flex-col items-center gap-1 cursor-pointer ${
                      isSpeakerOn
                        ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                        : 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                    }`}
                  >
                    {isSpeakerOn ? <Volume2 className="w-4 h-4" /> : <Ear className="w-4 h-4" />}
                    <span>{isSpeakerOn ? 'Hoparlör' : 'İç Ahize'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void toggleHoldCall()}
                    className={`py-2.5 px-2 rounded-xl border text-[10.5px] font-extrabold flex flex-col items-center gap-1 cursor-pointer ${
                      activeCall.status === 'ON_HOLD'
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                        : 'bg-slate-900 border-slate-700 text-slate-200'
                    }`}
                  >
                    {activeCall.status === 'ON_HOLD' ? (
                      <Play className="w-4 h-4" />
                    ) : (
                      <Pause className="w-4 h-4" />
                    )}
                    <span>{activeCall.status === 'ON_HOLD' ? 'Devam Et' : 'Beklet'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void transferCallToSecretary(
                        'Görüşme sırasında tek tuşla Yapay Zeka Sekretere devredildi'
                      )
                    }
                    className="py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Bot className="w-4 h-4" />
                    <span>Sekretere Devret</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void rejectOrHangupCall()}
                    className="py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>Görüşmeyi Bitir</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export const VoipPhoneScreen: React.FC<{
  voip: ReturnType<typeof useVoipDataSoftphone>;
  panelTitle: string;
  panelCode: string;
  secretaryGreetingText: string;
  onPlaySecretaryPreview?: (text: string, onEnded: () => void) => void;
  onStopSecretaryPreview?: () => void;
  incomingCallsPanel?: React.ReactNode;
  incomingCallsCount?: number;
}> = ({
  voip,
  panelTitle,
  panelCode,
  secretaryGreetingText,
  onPlaySecretaryPreview,
  onStopSecretaryPreview,
  incomingCallsPanel,
}) => {
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const onPlayRef = useRef(onPlaySecretaryPreview);
  onPlayRef.current = onPlaySecretaryPreview;
  const onStopRef = useRef(onStopSecretaryPreview);
  onStopRef.current = onStopSecretaryPreview;

  // Sadece panel değiştiğinde veya telefon ekranından çıkıldığında sesi durdur (Üst bileşen yenilenmelerinde ses ASLA kesilmez)
  useEffect(() => {
    setPlayingKey(null);
    return () => {
      onStopRef.current?.();
    };
  }, [panelCode, voip.myPhone11]);

  const handleTogglePlayAudio = (key: string, textToSpeak: string) => {
    if (playingKey === key) {
      onStopRef.current?.();
      setPlayingKey(null);
      return;
    }
    onStopRef.current?.();
    if (!onPlayRef.current) return;
    setPlayingKey(key);
    onPlayRef.current(textToSpeak, () => {
      setPlayingKey((curr) => (curr === key ? null : curr));
    });
  };

  return (
    <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-0.5 text-left">
      {/* Üst Hat Durumu + Genel Santral Sesini Dinle Kartı */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-950/75 via-slate-900 to-slate-950 border border-emerald-500/40 shadow-lg space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center shrink-0">
              <PhoneCall className="w-4 h-4 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-black text-white truncate">
                {panelTitle} ({panelCode})
              </h3>
              <p className="text-[10.5px] font-mono font-bold text-emerald-300">
                {formatDisplayGsm(voip.myPhone11)} • 👂 İç Ahize • 0 ₺
              </p>
            </div>
          </div>
          <span
            className={`px-2 py-1 rounded-full text-[9.5px] font-black border shrink-0 flex items-center gap-1 ${
              voip.sseConnected
                ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                : 'bg-amber-500/20 text-amber-200 border-amber-400/50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                voip.sseConnected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
              }`}
            />
            <span>{voip.sseConnected ? 'HAT AÇIK' : 'BAĞLANIYOR'}</span>
          </span>
        </div>

        <p className="text-[11px] text-slate-200 bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 leading-relaxed">
          "{secretaryGreetingText}"
        </p>

        <button
          type="button"
          onClick={() => handleTogglePlayAudio('MAIN', secretaryGreetingText)}
          className={`w-full py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all active:scale-98 ${
            playingKey === 'MAIN'
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : 'bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white'
          }`}
        >
          {playingKey === 'MAIN' ? (
            <>
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Sesi Durdur</span>
            </>
          ) : (
            <>
              <Volume2 className="w-4 h-4" />
              <span>🔊 Santral Sesini Dinle</span>
            </>
          )}
        </button>
      </div>

      {voip.statusBanner && (
        <div className="p-2.5 rounded-xl bg-sky-950/90 border border-sky-400/50 text-[11px] font-bold text-sky-200">
          {voip.statusBanner}
        </div>
      )}

      {voip.activeCall && (
        <button
          type="button"
          onClick={() => voip.setIsMinimized(false)}
          className="w-full p-2.5 rounded-xl bg-emerald-950/90 border border-emerald-400 text-left flex items-center justify-between gap-2 cursor-pointer"
        >
          <div className="min-w-0">
            <p className="text-xs font-black text-white truncate">
              {voip.activeCall.callerPhone11 === voip.myPhone11
                ? voip.activeCall.targetName
                : voip.activeCall.callerName}
            </p>
            <p className="text-[10px] font-bold text-emerald-300">
              {voip.activeCall.status === 'RINGING'
                ? '🔔 Gelen Çağrı Çalıyor • Açmak İçin Dokun'
                : '🟢 Aktif Görüşme • Ekranı Aç'}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[10px] font-black shrink-0">
            Aç
          </span>
        </button>
      )}

      {/* Kayıt varsa hemen altta görünür */}
      {incomingCallsPanel}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Volume2, Phone } from 'lucide-react';

export interface ActiveInternetCallSession {
  uuid: string;
  callerName: string;
  callerPhone: string;
  ownerPhone: string;
  wsUrl: string;
  summary?: string;
}

interface Props {
  session: ActiveInternetCallSession | null;
  onClose: () => void;
  onFallbackDial?: (phone: string) => void;
}

export const StandaloneLiveCallOverlay: React.FC<Props> = ({
  session,
  onClose,
  onFallbackDial,
}) => {
  const [status, setStatus] = useState<'CONNECTING' | 'CONNECTED' | 'ENDED'>('CONNECTING');
  const [statusNote, setStatusNote] = useState('Sekreter aradan çekiliyor, canlı ses bağlanıyor...');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  const mutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const cleanupMedia = () => {
    try {
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
    } catch {}
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    } catch {}
    try {
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch {}
    try {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'hangup' }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
    } catch {}
    try {
      const bridge = (window as unknown as {
        AndroidBridge?: { releaseCallAudioMode?: () => void };
      }).AndroidBridge;
      bridge?.releaseCallAudioMode?.();
    } catch {}
  };

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setStatus('CONNECTING');
    setStatusNote('Sekreter aradan çekiliyor, ücretsiz internet hattı bağlanıyor...');
    setElapsedSec(0);
    setMuted(false);
    setSpeakerOn(false);

    const startBridge = async () => {
      try {
        const bridge = (window as unknown as {
          AndroidBridge?: { setAudioRoute?: (speaker: boolean) => void };
        }).AndroidBridge;
        try {
          bridge?.setAudioRoute?.(false);
        } catch {}

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        nextPlayTimeRef.current = ctx.currentTime + 0.04;

        const ws = new WebSocket(session.wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        let carrySamples: number[] = [];
        const srcRate = ctx.sampleRate;
        const targetRate = 8000;
        const ratio = srcRate / targetRate;

        const source = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = proc;

        proc.onaudioprocess = (ev) => {
          if (cancelled || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const input = ev.inputBuffer.getChannelData(0);
          if (mutedRef.current) {
            const silentCount = Math.max(1, Math.round(input.length / ratio));
            const buf = new ArrayBuffer(silentCount * 2);
            wsRef.current.send(buf);
            return;
          }
          for (let i = 0; i < input.length; i++) {
            carrySamples.push(input[i]);
          }
          const outLen = Math.floor(carrySamples.length / ratio);
          if (outLen < 160) return;
          const pcm = new Int16Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const idx = Math.floor(i * ratio);
            const s = Math.max(-1, Math.min(1, carrySamples[idx] || 0));
            pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
          }
          const consumed = Math.floor(outLen * ratio);
          carrySamples = carrySamples.slice(consumed);
          try {
            wsRef.current.send(pcm.buffer);
          } catch {}
        };

        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        source.connect(proc);
        proc.connect(silentGain);
        silentGain.connect(ctx.destination);

        ws.onopen = () => {
          if (cancelled) return;
          setStatus('CONNECTED');
          setStatusNote('Canlı Bağlı • Sıfır Kontör (İnternetten Konuşuluyor)');
        };

        ws.onmessage = (msgEv) => {
          if (cancelled) return;
          if (typeof msgEv.data === 'string') {
            try {
              const parsed = JSON.parse(msgEv.data);
              if (parsed?.type === 'call_ended') {
                setStatus('ENDED');
                setStatusNote('Görüşme sonlandı.');
                cleanupMedia();
                setTimeout(() => {
                  if (!cancelled) onClose();
                }, 900);
              }
            } catch {}
            return;
          }
          if (msgEv.data instanceof ArrayBuffer && audioCtxRef.current) {
            const int16 = new Int16Array(msgEv.data);
            if (int16.length === 0) return;
            const actx = audioCtxRef.current;
            const audioBuf = actx.createBuffer(1, int16.length, 8000);
            const ch = audioBuf.getChannelData(0);
            for (let i = 0; i < int16.length; i++) {
              ch[i] = int16[i] / 32768;
            }
            const srcNode = actx.createBufferSource();
            srcNode.buffer = audioBuf;
            srcNode.connect(actx.destination);
            const now = actx.currentTime;
            if (nextPlayTimeRef.current < now - 0.02 || nextPlayTimeRef.current > now + 0.35) {
              nextPlayTimeRef.current = now + 0.025;
            }
            srcNode.start(nextPlayTimeRef.current);
            nextPlayTimeRef.current += audioBuf.duration;
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setStatus('ENDED');
          setStatusNote('Canlı hat bağlantısı kapandı.');
          cleanupMedia();
        };

        ws.onclose = () => {
          if (cancelled) return;
          setStatus('ENDED');
          setStatusNote('Görüşme tamamlandı.');
          cleanupMedia();
          setTimeout(() => {
            if (!cancelled) onClose();
          }, 900);
        };
      } catch {
        if (!cancelled) {
          setStatus('ENDED');
          setStatusNote('Mikrofon erişimi açılamadı. Arayanı normal hattan arayabilirsiniz.');
          cleanupMedia();
        }
      }
    };

    void startBridge();
    return () => {
      cancelled = true;
      cleanupMedia();
    };
  }, [session, onClose]);

  useEffect(() => {
    if (!session || status !== 'CONNECTED') return;
    const t = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [session, status]);

  if (!session) return null;

  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');

  const handleToggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    try {
      const bridge = (window as unknown as {
        AndroidBridge?: { setAudioRoute?: (speaker: boolean) => void };
      }).AndroidBridge;
      bridge?.setAudioRoute?.(next);
    } catch {}
  };

  const handleHangup = () => {
    cleanupMedia();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[220] bg-[#070d19] text-white flex flex-col items-center justify-between px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] select-none">
      <div className="flex flex-col items-center text-center w-full max-w-sm">
        <span className="px-3.5 py-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 text-[11px] font-black tracking-wide uppercase">
          SANTRAL BAYİ • 0 KONTÖR CANLI HAT
        </span>

        <div className="w-28 h-28 rounded-full bg-slate-900 border-2 border-sky-400/60 flex items-center justify-center mt-8 shadow-2xl shadow-sky-500/20">
          <Phone className={`w-12 h-12 text-emerald-400 ${status === 'CONNECTED' ? '' : 'animate-pulse'}`} />
        </div>

        <h2 className="text-2xl font-black text-white mt-6 tracking-tight">
          {session.callerName || session.callerPhone || 'Gelen Arama'}
        </h2>
        {session.callerPhone && session.callerPhone !== session.callerName && (
          <p className="text-sm text-slate-400 font-semibold mt-1">{session.callerPhone}</p>
        )}

        {status === 'CONNECTED' && (
          <div className="text-2xl font-black text-emerald-400 mt-3 tabular-nums">
            {mins}:{secs}
          </div>
        )}

        <div className="mt-5 w-full rounded-2xl bg-slate-900/90 border border-slate-800 px-4 py-3 text-xs text-slate-300 leading-relaxed">
          {statusNote}
        </div>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        {status !== 'ENDED' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className={`py-3.5 rounded-2xl border font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                  muted
                    ? 'bg-rose-950 border-rose-500 text-rose-200'
                    : 'bg-slate-800/90 border-slate-700 text-white'
                }`}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {muted ? 'Sessizde' : 'Mikrofon'}
              </button>
              <button
                type="button"
                onClick={handleToggleSpeaker}
                className={`py-3.5 rounded-2xl border font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                  speakerOn
                    ? 'bg-emerald-900 border-emerald-400 text-emerald-100'
                    : 'bg-slate-800/90 border-slate-700 text-white'
                }`}
              >
                <Volume2 className="w-4 h-4" />
                {speakerOn ? 'Hoparlör' : 'Ahize'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleHangup}
              className="w-full py-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-rose-900/40 cursor-pointer"
            >
              <PhoneOff className="w-5 h-5" />
              GÖRÜŞMEYİ BİTİR
            </button>
          </>
        ) : (
          <>
            {session.callerPhone && onFallbackDial && (
              <button
                type="button"
                onClick={() => {
                  onFallbackDial(session.callerPhone);
                  onClose();
                }}
                className="w-full py-3.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm cursor-pointer"
              >
                📞 Arayanı Hemen Geri Ara
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3.5 rounded-full bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm cursor-pointer"
            >
              Kapat
            </button>
          </>
        )}
      </div>
    </div>
  );
};

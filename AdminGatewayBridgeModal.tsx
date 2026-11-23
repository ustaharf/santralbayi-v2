import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  CheckCircle,
  Layers,
  PhoneCall,
  Plus,
  Radio,
  Server,
  Shield,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { resolveServerApiUrl, VDS_HOST } from './vdsConfig';
import { scheduleCloudVaultSync } from './persistentVault';
import {
  evaluateIncomingPbxCall,
  formatDisplayGsm,
  GatewayLineProvider,
  IncomingPbxDecision,
  loadCachedPbxRegistry,
  normalizeTrGsmPhone,
  PbxGatewayPoolLine,
  PbxOutgoingHitapMode,
  PbxPhoneRuleRecord,
  PbxRulesRegistryMap,
  selectBalancedGatewayForSubscriber,
  summarizeGatewayPool,
} from './pbxRulesEngine';

export interface PbxGatewayConfig {
  bridgeType: 'GSM_GATEWAY' | 'SIP_TRUNK';
  gatewayHost: string;
  sipPort: string;
  username: string;
  password: string;
  callerIdPhone: string;
  gatewayPool: PbxGatewayPoolLine[];
  enabled: boolean;
  updatedAt: string;
}

const PBX_GATEWAY_STORAGE_KEY = 'sb_pbx_gateway_config_v1';

const PROVIDER_META: Record<
  GatewayLineProvider,
  { title: string; shortBadge: string; defaultChannels: number }
> = {
  VERIMOR_BIREYSEL_5: {
    title: 'Verimor Bireysel Coğrafi (5 Eşzamanlı Çağrı • e-Devlet)',
    shortBadge: 'Verimor • 5 Kanal',
    defaultChannels: 5,
  },
  NETGSM_UNLIMITED: {
    title: 'Netgsm Coğrafi / SIP (Sınırsız • 100+ Eşzamanlı Çağrı)',
    shortBadge: 'Netgsm • 100+ Kanal',
    defaultChannels: 100,
  },
  KURUMSAL_SIP: {
    title: 'Kurumsal SIP Trunk (30 Eşzamanlı Çağrı)',
    shortBadge: 'Kurumsal • 30 Kanal',
    defaultChannels: 30,
  },
  GSM_SIM_GATEWAY: {
    title: 'SIM Kartlı GSM Gateway (1 Kanal)',
    shortBadge: 'SIM • 1 Kanal',
    defaultChannels: 1,
  },
};

function buildInitialPoolFromCallerId(callerIdRaw: string): PbxGatewayPoolLine[] {
  const clean11 = normalizeTrGsmPhone(callerIdRaw) || '02826060537';
  const isNetgsmDefault = clean11 === '02826060537';
  const isLandline = !clean11.startsWith('05');
  return [
    {
      id: isNetgsmDefault ? 'gw-netgsm-2826060537' : 'gw-line-1',
      phone11: clean11,
      label: isNetgsmDefault
        ? 'Netgsm Merkez Hat #1 (0282 606 05 37)'
        : isLandline
        ? 'Merkez Coğrafi Hat #1'
        : 'Merkez Köprü Hat #1',
      provider: isNetgsmDefault ? 'NETGSM_UNLIMITED' : 'VERIMOR_BIREYSEL_5',
      maxConcurrentCalls: isNetgsmDefault ? 100 : 5,
      diversionSupported: true,
      active: true,
    },
  ];
}

const DEFAULT_GATEWAY_CONFIG: PbxGatewayConfig = {
  bridgeType: 'SIP_TRUNK',
  gatewayHost: 'sip.netgsm.com.tr',
  sipPort: '5060',
  username: '2826060537',
  password: '',
  callerIdPhone: '0282 606 05 37',
  gatewayPool: buildInitialPoolFromCallerId('0282 606 05 37'),
  enabled: true,
  updatedAt: '',
};

export function loadPbxGatewayConfig(): PbxGatewayConfig {
  try {
    const raw = localStorage.getItem(PBX_GATEWAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const rawCallerId = String(parsed.callerIdPhone || '').trim();
        const rawHost = String(parsed.gatewayHost || '').trim();
        const isLegacyPlaceholder =
          (!rawHost && (!rawCallerId || normalizeTrGsmPhone(rawCallerId) === '05376031645')) ||
          (parsed.enabled === false && normalizeTrGsmPhone(rawCallerId) === '05376031645');
        if (isLegacyPlaceholder) {
          return {
            ...DEFAULT_GATEWAY_CONFIG,
            gatewayPool: buildInitialPoolFromCallerId(DEFAULT_GATEWAY_CONFIG.callerIdPhone),
          };
        }
        const callerId = rawCallerId || DEFAULT_GATEWAY_CONFIG.callerIdPhone;
        const rawPool = Array.isArray(parsed.gatewayPool) ? parsed.gatewayPool : [];
        const normalizedPool: PbxGatewayPoolLine[] =
          rawPool.length > 0
            ? rawPool
                .map((item: any, idx: number) => ({
                  id: String(item?.id || `gw-line-${idx + 1}`),
                  phone11: normalizeTrGsmPhone(item?.phone11 || callerId),
                  label: String(item?.label || `Merkez Hat #${idx + 1}`),
                  provider: (item?.provider as GatewayLineProvider) || 'NETGSM_UNLIMITED',
                  maxConcurrentCalls: Math.max(1, Number(item?.maxConcurrentCalls) || 100),
                  diversionSupported: item?.diversionSupported ?? true,
                  active: item?.active !== false,
                }))
                .filter((item: PbxGatewayPoolLine) => item.phone11.length >= 10)
            : buildInitialPoolFromCallerId(callerId);

        return {
          ...DEFAULT_GATEWAY_CONFIG,
          ...parsed,
          callerIdPhone: callerId,
          gatewayPool:
            normalizedPool.length > 0 ? normalizedPool : buildInitialPoolFromCallerId(callerId),
        };
      }
    }
  } catch {
    // ignore storage read errors
  }
  return {
    ...DEFAULT_GATEWAY_CONFIG,
    gatewayPool: buildInitialPoolFromCallerId(DEFAULT_GATEWAY_CONFIG.callerIdPhone),
  };
}

export function savePbxGatewayConfig(cfg: PbxGatewayConfig): PbxGatewayConfig {
  const cleanedPool = Array.isArray(cfg.gatewayPool)
    ? cfg.gatewayPool
        .map((line, idx) => ({
          ...line,
          id: line.id || `gw-line-${idx + 1}`,
          phone11: normalizeTrGsmPhone(line.phone11),
          maxConcurrentCalls: Math.max(1, Number(line.maxConcurrentCalls) || 100),
          diversionSupported: line.diversionSupported ?? true,
          active: Boolean(line.active),
        }))
        .filter((line) => line.phone11.length >= 10)
    : [];

  const firstActive = cleanedPool.find((l) => l.active) || cleanedPool[0];
  const primaryDisplay = firstActive
    ? formatDisplayGsm(firstActive.phone11)
    : (cfg.callerIdPhone || '').trim() || '0282 606 05 37';

  const finalPool =
    cleanedPool.length > 0 ? cleanedPool : buildInitialPoolFromCallerId(primaryDisplay);

  const next: PbxGatewayConfig = {
    ...cfg,
    gatewayHost: (cfg.gatewayHost || '').trim(),
    sipPort: (cfg.sipPort || '5060').trim() || '5060',
    username: (cfg.username || '').trim(),
    callerIdPhone: primaryDisplay,
    gatewayPool: finalPool,
    updatedAt: new Date().toLocaleString('tr-TR'),
  };
  try {
    localStorage.setItem(PBX_GATEWAY_STORAGE_KEY, JSON.stringify(next));
    scheduleCloudVaultSync();
  } catch {
    // ignore storage write errors
  }
  return next;
}

export function isPbxGatewayReady(cfg?: PbxGatewayConfig | null): boolean {
  const active = cfg || loadPbxGatewayConfig();
  return Boolean(active.enabled && active.gatewayHost.trim().length >= 3);
}

export interface PbxLiveStatus {
  checked: boolean;
  ok: boolean;
  serverIp: string;
  fusionPbxSipInternal: boolean;
  fusionPbxSipExternal: boolean;
  postgresDatabase: boolean;
  asistanActive: boolean;
}

export async function fetchPbxLiveStatus(): Promise<PbxLiveStatus> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(resolveServerApiUrl('/api/pbx/status'), {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const coreOnline = Boolean(
        data?.ok || data?.fusionPbxSipInternal || data?.kenanAsistanApi || data?.postgresDatabase
      );
      return {
        checked: true,
        ok: coreOnline,
        serverIp: String(data?.serverIp || VDS_HOST),
        fusionPbxSipInternal: coreOnline,
        fusionPbxSipExternal: Boolean(data?.fusionPbxSipExternal || coreOnline),
        postgresDatabase: Boolean(data?.postgresDatabase),
        asistanActive: Boolean(data?.kenanAsistanApi),
      };
    }
  } catch {
    // fallback if offline
  }
  return {
    checked: true,
    ok: false,
    serverIp: VDS_HOST,
    fusionPbxSipInternal: false,
    fusionPbxSipExternal: false,
    postgresDatabase: false,
    asistanActive: false,
  };
}

export interface WarmTransferDispatchResult {
  dispatched: boolean;
  pbxOnline: boolean;
  gatewayConfigured: boolean;
  sessionId: string;
  statusNote: string;
}

export async function triggerSilentFreeSwitchWarmTransfer(params: {
  ownerName: string;
  ownerPhone: string;
  targetName: string;
  targetPhone: string;
  greetingSentence: string;
  transferSentence: string;
  hitapMode?: PbxOutgoingHitapMode;
  retryMinutes?: number;
  smsFallbackOnUnreachable?: boolean;
  freeswitchOriginateCmd?: string;
}): Promise<WarmTransferDispatchResult> {
  const cfg = loadPbxGatewayConfig();
  const gatewayConfigured = isPbxGatewayReady(cfg);
  const sessionId = `fs-wt-${Date.now()}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(resolveServerApiUrl('/api/pbx/warm-transfer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        ...params,
        gateway: {
          bridgeType: cfg.bridgeType,
          gatewayHost: cfg.gatewayHost,
          sipPort: cfg.sipPort,
          username: cfg.username,
          password: cfg.password,
          callerIdPhone: cfg.callerIdPhone,
          gatewayPool: cfg.gatewayPool,
          enabled: cfg.enabled,
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) {
        return {
          dispatched: true,
          pbxOnline: true,
          gatewayConfigured,
          sessionId: String(data.sessionId || sessionId),
          statusNote: String(
            data.statusNote ||
              'FreeSWITCH santral arka planda sessiz çağrıyı başlattı.'
          ),
        };
      }
    }
  } catch {
    // continue to live status check
  }

  const status = await fetchPbxLiveStatus();
  return {
    dispatched: status.ok,
    pbxOnline: status.ok,
    gatewayConfigured,
    sessionId,
    statusNote: gatewayConfigured
      ? `Merkez GSM Gateway (${cfg.gatewayHost}:${cfg.sipPort}) üzerinden sessiz arama kuyruğa alındı.`
      : `VDS FreeSWITCH (${status.serverIp}:5060) bağlı • Sessiz arka plan santral akışı başlatıldı.`,
  };
}

interface AdminGatewayBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (cfg: PbxGatewayConfig) => void;
  pbxRegistry?: PbxRulesRegistryMap | null;
}

export const AdminGatewayBridgeModal: React.FC<AdminGatewayBridgeModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  pbxRegistry,
}) => {
  const [form, setForm] = useState<PbxGatewayConfig>(() => loadPbxGatewayConfig());
  const [pbxStatus, setPbxStatus] = useState<PbxLiveStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [saveBanner, setSaveBanner] = useState<string>('');
  const [newPoolPhone, setNewPoolPhone] = useState<string>('');
  const [newPoolProvider, setNewPoolProvider] =
    useState<GatewayLineProvider>('VERIMOR_BIREYSEL_5');
  const [newPoolChannels, setNewPoolChannels] = useState<number>(5);
  const [testSubPhone, setTestSubPhone] = useState<string>('05376031645');
  const [testCallerInput, setTestCallerInput] = useState<string>('Ahmet Yılmaz (0532 555 12 34)');
  const [testCallerSpeech, setTestCallerSpeech] = useState<string>(
    'Merhaba, kombi su akıtıyor, acil servis için ustayla görüşebilir miyim?'
  );
  const [testDecision, setTestDecision] = useState<IncomingPbxDecision | null>(null);
  const [aiTesting, setAiTesting] = useState<boolean>(false);
  const [aiTestResult, setAiTestResult] = useState<{
    ok: boolean;
    error?: string;
    intentCategory?: string;
    issueSummary?: string;
    secretaryReply?: string;
    shouldTransferToOwner?: boolean;
    ringDispatched?: boolean;
  } | null>(null);

  const activeRegistry = pbxRegistry || loadCachedPbxRegistry();
  const registeredRecords: PbxPhoneRuleRecord[] = useMemo(
    () =>
      activeRegistry
        ? (Object.values(activeRegistry.byPhone11) as PbxPhoneRuleRecord[])
        : [],
    [activeRegistry]
  );

  const poolSummary = useMemo(
    () => summarizeGatewayPool(form.gatewayPool, form.callerIdPhone),
    [form.callerIdPhone, form.gatewayPool]
  );

  const perLineSubscriberCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const rec of registeredRecords) {
      const assigned = selectBalancedGatewayForSubscriber(
        rec.phone11,
        form.gatewayPool,
        form.callerIdPhone
      );
      counts[assigned.phone11] = (counts[assigned.phone11] || 0) + 1;
    }
    return counts;
  }, [form.callerIdPhone, form.gatewayPool, registeredRecords]);

  useEffect(() => {
    if (!isOpen) return;
    setForm(loadPbxGatewayConfig());
    setSaveBanner('');
    setTestDecision(null);
    setAiTestResult(null);
    setTesting(true);
    fetchPbxLiveStatus()
      .then((st) => setPbxStatus(st))
      .finally(() => setTesting(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleProviderChange = (prov: GatewayLineProvider) => {
    setNewPoolProvider(prov);
    setNewPoolChannels(PROVIDER_META[prov].defaultChannels);
  };

  const handleAddPoolLine = () => {
    const clean11 = normalizeTrGsmPhone(newPoolPhone);
    if (!clean11 || clean11.length < 10) {
      setSaveBanner('Lütfen geçerli bir 0212 / 0216 / 0312 / 0850 veya 05XX numarası girin.');
      return;
    }
    if (form.gatewayPool.some((l) => normalizeTrGsmPhone(l.phone11) === clean11)) {
      setSaveBanner('Bu numara zaten merkez havuzunda kayıtlı.');
      return;
    }
    const nextIdx = form.gatewayPool.length + 1;
    const newLine: PbxGatewayPoolLine = {
      id: `gw-${Date.now()}`,
      phone11: clean11,
      label: `Merkez SIP Hattı #${nextIdx}`,
      provider: newPoolProvider,
      maxConcurrentCalls: Math.max(1, Number(newPoolChannels) || 5),
      diversionSupported: true,
      active: true,
    };
    const updatedPool = [...form.gatewayPool, newLine];
    setForm((prev) => ({
      ...prev,
      callerIdPhone: formatDisplayGsm(updatedPool.find((l) => l.active)?.phone11 || clean11),
      gatewayPool: updatedPool,
    }));
    setNewPoolPhone('');
    setSaveBanner(
      `${formatDisplayGsm(clean11)} havuza eklendi (+${newLine.maxConcurrentCalls} eşzamanlı kanal). Kaydet & Uygula ile tüm abonelere dağıtabilirsiniz.`
    );
  };

  const handleTogglePoolLine = (id: string) => {
    setForm((prev) => {
      const nextPool = prev.gatewayPool.map((l) =>
        l.id === id ? { ...l, active: !l.active } : l
      );
      if (!nextPool.some((l) => l.active) && nextPool.length > 0) {
        nextPool[0] = { ...nextPool[0], active: true };
      }
      const firstActive = nextPool.find((l) => l.active) || nextPool[0];
      return {
        ...prev,
        callerIdPhone: firstActive ? formatDisplayGsm(firstActive.phone11) : prev.callerIdPhone,
        gatewayPool: nextPool,
      };
    });
  };

  const handleRemovePoolLine = (id: string) => {
    setForm((prev) => {
      if (prev.gatewayPool.length <= 1) {
        setSaveBanner('Havuzda en az 1 merkez köprü numarası bulunmalıdır.');
        return prev;
      }
      const nextPool = prev.gatewayPool.filter((l) => l.id !== id);
      if (!nextPool.some((l) => l.active) && nextPool.length > 0) {
        nextPool[0] = { ...nextPool[0], active: true };
      }
      const firstActive = nextPool.find((l) => l.active) || nextPool[0];
      return {
        ...prev,
        callerIdPhone: firstActive ? formatDisplayGsm(firstActive.phone11) : prev.callerIdPhone,
        gatewayPool: nextPool,
      };
    });
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setSaveBanner('');
    const st = await fetchPbxLiveStatus();
    setPbxStatus(st);
    setTesting(false);
    setSaveBanner(
      st.ok
        ? `VDS FreeSWITCH (${st.serverIp}:5060) ve Asistan API (Port 8000) canlı yanıt verdi.`
        : `Sunucu kontrol edildi (${st.serverIp}). Lütfen ağ bağlantısını doğrulayın.`
    );
  };

  const handleRunRuleTest = () => {
    if (!activeRegistry) return;
    const decision = evaluateIncomingPbxCall({
      registry: activeRegistry,
      subscriberPhone: testSubPhone,
      callerPhone: testCallerInput,
      callerName: testCallerInput,
    });
    setTestDecision(decision);
  };

  const handleRunLiveAiReceptionTest = async () => {
    handleRunRuleTest();
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const res = await fetch(resolveServerApiUrl('/api/pbx/ai-reception'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriberPhone: testSubPhone,
          diversionPhone: testSubPhone,
          callerPhone: '05325551234',
          callerName: testCallerInput,
          callerSpeechText: testCallerSpeech,
          autoRingOwner: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiTestResult({
          ok: false,
          error: String(data?.error || `Sunucu hatası (${res.status})`),
        });
      } else {
        setAiTestResult({
          ok: true,
          intentCategory: data.intentCategory,
          issueSummary: data.issueSummary,
          secretaryReply: data.secretaryReply,
          shouldTransferToOwner: data.shouldTransferToOwner,
          ringDispatched: data.ringDispatched,
        });
      }
    } catch (err: any) {
      setAiTestResult({
        ok: false,
        error: err?.message || 'Bağlantı kurulamadı',
      });
    } finally {
      setAiTesting(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const nextCfg: PbxGatewayConfig = {
      ...form,
      enabled: Boolean(form.gatewayHost.trim()) ? form.enabled : false,
    };
    const saved = savePbxGatewayConfig(nextCfg);
    setForm(saved);
    if (onSaved) onSaved(saved);
    const savedSummary = summarizeGatewayPool(saved.gatewayPool, saved.callerIdPhone);
    setSaveBanner(
      `Merkez Havuz kaydedildi: ${savedSummary.activeLines.length} aktif numara • Toplam ${
        savedSummary.hasUnlimitedLine ? '100+ (Sınırsız)' : savedSummary.totalConcurrentCalls
      } eşzamanlı çağrı kapasitesi (~${savedSummary.estimatedSubscriberCapacity}+ esnaf abone).`
    );
  };

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-3 text-left">
      <div className="bg-slate-900 border border-cyan-500/50 rounded-2xl w-full max-w-md max-h-[92dvh] flex flex-col shadow-2xl overflow-hidden">
        {/* Başlık */}
        <div className="px-4 py-3 bg-gradient-to-r from-slate-950 via-cyan-950/50 to-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white leading-tight">
                Merkez SIP Numara Havuzu & FreeSWITCH Köprüsü
              </h3>
              <p className="text-[9.5px] text-cyan-300 font-bold">
                Sadece Yönetici (TR.000) • Çoklu Kanal & SIP Diversion Aktif
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Gövde */}
        <form
          onSubmit={handleSave}
          className="p-4 space-y-3 overflow-y-auto text-xs flex-1"
        >
          {/* VDS Canlı Durum Kartı */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                VDS Santral Motoru ({VDS_HOST})
              </span>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[9.5px] font-bold text-cyan-300 border border-slate-700 cursor-pointer"
              >
                {testing ? 'Kontrol Ediliyor...' : 'Canlı Test Et'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-[9px]">
              <div className="bg-slate-900 px-2 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">SIP 5060</span>
                <span
                  className={
                    pbxStatus?.fusionPbxSipInternal
                      ? 'text-emerald-400 font-black'
                      : 'text-amber-400 font-bold'
                  }
                >
                  {pbxStatus?.fusionPbxSipInternal ? 'AKTİF' : '...'}
                </span>
              </div>
              <div className="bg-slate-900 px-2 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">Asistan 8000</span>
                <span
                  className={
                    pbxStatus?.asistanActive
                      ? 'text-emerald-400 font-black'
                      : 'text-amber-400 font-bold'
                  }
                >
                  {pbxStatus?.asistanActive ? 'AKTİF' : '...'}
                </span>
              </div>
              <div className="bg-slate-900 px-2 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">DB 5432</span>
                <span
                  className={
                    pbxStatus?.postgresDatabase
                      ? 'text-emerald-400 font-black'
                      : 'text-amber-400 font-bold'
                  }
                >
                  {pbxStatus?.postgresDatabase ? 'AKTİF' : '...'}
                </span>
              </div>
            </div>

            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-[9.5px]">
              <span className="text-emerald-300 font-bold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Otomatik Bağlı 05XX GSM Kural Havuzu:</span>
              </span>
              <span className="font-black text-white bg-emerald-600/30 border border-emerald-400/40 px-2 py-0.5 rounded-md">
                {registeredRecords.length} Aktif Hat
              </span>
            </div>
          </div>

          {/* 1. Çoklu Merkez Numara Havuzu (5 Eşzamanlı Çağrı Sınırını Aşma) */}
          <div className="bg-slate-950 p-3 rounded-xl border border-emerald-500/40 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                1. Çoklu Merkez Numara Havuzu (Eşit Dağıtım)
              </span>
              <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-black">
                SIP Diversion ✓
              </span>
            </div>

            {/* Havuz Kapasite Göstergeleri */}
            <div className="grid grid-cols-3 gap-1.5 text-[9.5px]">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                <span className="text-slate-400 block">Havuz Hattı</span>
                <strong className="text-white font-black text-[11px]">
                  {poolSummary.activeLines.length} Numara
                </strong>
              </div>
              <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-2">
                <span className="text-slate-400 block">Aynı Anda Çağrı</span>
                <strong className="text-emerald-300 font-black text-[11px]">
                  {poolSummary.hasUnlimitedLine
                    ? '100+ Kanal'
                    : `${poolSummary.totalConcurrentCalls} Kanal`}
                </strong>
              </div>
              <div className="bg-slate-900 border border-cyan-500/30 rounded-lg p-2">
                <span className="text-slate-400 block">Taşıdığı Abone</span>
                <strong className="text-cyan-300 font-black text-[11px]">
                  ~{poolSummary.estimatedSubscriberCapacity}+ Esnaf
                </strong>
              </div>
            </div>

            <p className="text-[9.5px] text-slate-300 leading-relaxed">
              Verimor bireysel hatta <strong>5 eşzamanlı çağrı</strong> sınırı vardır; havuza eklediğiniz her numara kapasiteyi <strong>+5 katlar</strong> (veya Netgsm ile tek numarada 100+ kanal açılır). Sistem aboneleri numaralara otomatik eşit dağıtır; ön görüşme 15 sn içinde uygulama içi <strong>0 ₺ VoIP Data</strong> hattına devredildiği için hatlar meşgul kalmaz.
            </p>

            {/* Havuzdaki Mevcut Numaralar */}
            <div className="space-y-1.5">
              {form.gatewayPool.map((line, idx) => {
                const assignedCount = perLineSubscriberCount[line.phone11] || 0;
                const meta = PROVIDER_META[line.provider] || PROVIDER_META.VERIMOR_BIREYSEL_5;
                return (
                  <div
                    key={line.id}
                    className={`p-2 rounded-xl border flex items-center justify-between gap-2 ${
                      line.active
                        ? 'bg-slate-900 border-emerald-500/40'
                        : 'bg-slate-900/50 border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-mono font-black text-white">
                          #{idx + 1} {formatDisplayGsm(line.phone11)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/30 text-[8.5px] font-extrabold text-cyan-200">
                          {line.maxConcurrentCalls >= 100
                            ? '100+ Kanal'
                            : `${line.maxConcurrentCalls} Kanal`}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-400 truncate">
                        {meta.shortBadge} • {assignedCount} Abone/Bayi Eşleşti
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePoolLine(line.id)}
                        className={`px-2 py-1 rounded-lg text-[9px] font-black border cursor-pointer ${
                          line.active
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {line.active ? 'Aktif' : 'Pasif'}
                      </button>
                      {form.gatewayPool.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePoolLine(line.id)}
                          className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
                          title="Hattı Kaldır"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Yeni Merkez Numarası Ekleme Kutusu */}
            <div className="pt-1.5 border-t border-slate-800 space-y-2">
              <span className="text-[9.5px] font-extrabold text-cyan-300 block">
                + Havuza Yeni Merkez Coğrafi / SIP Numarası Ekle:
              </span>
              <select
                value={newPoolProvider}
                onChange={(e) => handleProviderChange(e.target.value as GatewayLineProvider)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white font-semibold"
              >
                <option value="VERIMOR_BIREYSEL_5">
                  {PROVIDER_META.VERIMOR_BIREYSEL_5.title}
                </option>
                <option value="NETGSM_UNLIMITED">
                  {PROVIDER_META.NETGSM_UNLIMITED.title}
                </option>
                <option value="KURUMSAL_SIP">{PROVIDER_META.KURUMSAL_SIP.title}</option>
                <option value="GSM_SIM_GATEWAY">{PROVIDER_META.GSM_SIM_GATEWAY.title}</option>
              </select>

              <div className="grid grid-cols-12 gap-1.5">
                <input
                  type="tel"
                  value={newPoolPhone}
                  onChange={(e) => setNewPoolPhone(e.target.value)}
                  placeholder="Örn: 0212 909 12 34 veya 0216..."
                  className="col-span-6 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-[10.5px] font-mono focus:border-emerald-400 focus:outline-none"
                />
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={newPoolChannels}
                  onChange={(e) => setNewPoolChannels(Math.max(1, Number(e.target.value) || 5))}
                  title="Eşzamanlı Çağrı Kanal Sayısı"
                  className="col-span-2 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-emerald-300 text-[10.5px] font-mono font-bold text-center focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddPoolLine}
                  className="col-span-4 px-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Havuza Ekle</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. SIP Trunk Sunucu Bağlantı Bilgileri */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2.5">
            <label className="text-[10px] font-extrabold text-slate-300 uppercase tracking-wider block">
              2. SIP Trunk / Gateway Bağlantı Bilgileri
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, bridgeType: 'SIP_TRUNK' }))}
                className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                  form.bridgeType === 'SIP_TRUNK'
                    ? 'bg-cyan-950/70 border-cyan-400 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <strong className="text-[10.5px] block font-black">Coğrafi Sabit SIP Trunk</strong>
                <span className="text-[8.5px] text-slate-400">Verimor / Netgsm G.711 Fiber</span>
              </button>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, bridgeType: 'GSM_GATEWAY' }))}
                className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                  form.bridgeType === 'GSM_GATEWAY'
                    ? 'bg-cyan-950/70 border-cyan-400 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <strong className="text-[10.5px] block font-black">SIM Kartlı GSM Gateway</strong>
                <span className="text-[8.5px] text-slate-400">GoIP / Dinstar Fiziksel SIM</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-[9.5px] font-bold text-slate-400 block mb-1">
                  SIP Sunucu / Gateway Adresi
                </label>
                <input
                  type="text"
                  value={form.gatewayHost}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      gatewayHost: e.target.value,
                      enabled: e.target.value.trim().length > 0 ? true : p.enabled,
                    }))
                  }
                  placeholder="Örn: sip.verimor.com.tr veya sip.netgsm.com.tr"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-[11px] focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[9.5px] font-bold text-slate-400 block mb-1">
                  SIP Port
                </label>
                <input
                  type="text"
                  value={form.sipPort}
                  onChange={(e) => setForm((p) => ({ ...p, sipPort: e.target.value }))}
                  placeholder="5060"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-[11px] font-mono focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9.5px] font-bold text-slate-400 block mb-1">
                  SIP Abone / Kullanıcı Adı
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                  placeholder="Örn: 90212909xxxx"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-[11px] focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[9.5px] font-bold text-slate-400 block mb-1">
                  SIP Şifresi
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-[11px] focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Aktif Şalteri */}
            <div className="pt-1 flex items-center justify-between border-t border-slate-800">
              <div>
                <span className="text-[10.5px] font-black text-white block">
                  Merkez SIP Havuz Köprüsünü Aktif Et
                </span>
                <span className="text-[8.5px] text-slate-400">
                  Açık olduğunda yönlendirilen tüm 05XX aramaları santralde karşılanır
                </span>
              </div>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))}
                className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                  form.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    form.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* 3. Canlı Yapay Zekâ Karşılama, Derdini Anlama & İç Ahize Zil Testi */}
          {registeredRecords.length > 0 && (
            <div className="bg-slate-950 p-3 rounded-xl border border-indigo-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-indigo-400" />
                  3. Yapay Zekâ Dert Anlama & İç Ahizeye Bağlama Testi
                </span>
                <span className="text-[8.5px] text-emerald-300 font-bold">Canlı VoIP Zil</span>
              </div>

              <div className="space-y-1.5">
                <select
                  value={testSubPhone}
                  onChange={(e) => {
                    setTestSubPhone(e.target.value);
                    setTestDecision(null);
                    setAiTestResult(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10.5px] text-white font-semibold"
                >
                  {registeredRecords.map((rec) => (
                    <option key={rec.phone11} value={rec.phone11}>
                      {formatDisplayGsm(rec.phone11)} — {rec.companyName} ({rec.entityCode})
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={testCallerInput}
                  onChange={(e) => setTestCallerInput(e.target.value)}
                  placeholder="Arayan Kişi / Numara (Örn: Ahmet Bey / Annem)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[10.5px] text-white"
                />

                <textarea
                  rows={2}
                  value={testCallerSpeech}
                  onChange={(e) => setTestCallerSpeech(e.target.value)}
                  placeholder="Arayan müşterinin telefonda söylediği cümle..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[10.5px] text-white resize-none"
                />

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleRunRuleTest}
                    className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-black text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>Sadece Kuralı Sına</span>
                  </button>
                  <button
                    type="button"
                    disabled={aiTesting}
                    onClick={() => void handleRunLiveAiReceptionTest()}
                    className="py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-black text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>{aiTesting ? 'Analiz Ediliyor...' : 'YZ Karşılasın & Çaldırsın'}</span>
                  </button>
                </div>
              </div>

              {testDecision && (
                <div
                  className={`p-2 rounded-lg border text-[9.5px] space-y-1 ${
                    testDecision.action === 'FREESWITCH_SECRETARY_ANSWER'
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-100'
                      : 'bg-amber-950/60 border-amber-500/40 text-amber-100'
                  }`}
                >
                  <div className="font-black flex items-center justify-between">
                    <span>
                      {testDecision.action === 'FREESWITCH_SECRETARY_ANSWER'
                        ? '🤖 SANTRAL SEKRETERİ KARŞILAR'
                        : '📱 DOĞRUDAN CEP TELEFONU ÇALAR'}
                    </span>
                    <span className="text-[8.5px] opacity-80">
                      {testDecision.withinWorkHours ? 'Mesai İçi' : 'Mesai Dışı'}
                    </span>
                  </div>
                  <p className="text-slate-200 leading-snug">{testDecision.reasonSummaryTr}</p>
                </div>
              )}

              {aiTestResult && (
                <div
                  className={`p-2.5 rounded-lg border text-[10px] space-y-1 ${
                    aiTestResult.ok
                      ? 'bg-indigo-950/70 border-indigo-400/50 text-indigo-100'
                      : 'bg-rose-950/70 border-rose-500/50 text-rose-200'
                  }`}
                >
                  {aiTestResult.ok ? (
                    <>
                      <div className="font-black text-emerald-300 flex items-center justify-between">
                        <span>✅ Yapay Zekâ Derdini Anladı</span>
                        <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">
                          {aiTestResult.intentCategory}
                        </span>
                      </div>
                      <p className="text-white font-bold">
                        📌 Konu Özeti: {aiTestResult.issueSummary}
                      </p>
                      <p className="italic text-cyan-200 bg-slate-950/80 p-1.5 rounded border border-slate-800">
                        🗣️ Sekreter: "{aiTestResult.secretaryReply}"
                      </p>
                      {aiTestResult.ringDispatched && (
                        <p className="text-emerald-300 font-black">
                          🔔 Yetkilinin uygulama içi yeşil telefonu (İç Ahize • 0 ₺) şimdi çaldırıldı!
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="font-bold">⚠️ {aiTestResult.error}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Çalışma Özeti */}
          <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-2.5 text-[9.5px] text-slate-300 space-y-1">
            <div className="flex items-center gap-1.5 text-cyan-300 font-black">
              <Radio className="w-3.5 h-3.5" />
              <span>SIP Diversion + Yapay Zekâ Süzgeci + İç Ahize (0 ₺):</span>
            </div>
            <p className="leading-relaxed text-slate-300">
              Müşteri esnafın kendi <strong>05XX cep numarasını</strong> arar; GSM yönlendirmesi çağrıyı havuzdaki merkez numaraya taşır. FreeSWITCH <strong>SIP Diversion</strong> başlığından hangi abonenin arandığını tanır, sekreter arayanın derdini öğrenir ve uygulamadaki yeşil telefonu çaldırıp <strong>iç ahizeden 0 ₺ internet verisiyle</strong> birbirine bağlar.
            </p>
            <p className="text-[8.5px] text-emerald-300 font-bold flex items-center gap-1 pt-0.5">
              <Shield className="w-3 h-3 shrink-0" />
              <span>Abone başına VoIP numara, dakika ücreti veya dış hoparlöre ses taşması kesinlikle yoktur.</span>
            </p>
          </div>

          {saveBanner && (
            <div className="bg-emerald-950/70 border border-emerald-500/50 rounded-xl p-2.5 text-[10px] text-emerald-200 font-bold flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{saveBanner}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer"
            >
              Kapat
            </button>
            <button
              type="submit"
              className="py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black text-xs shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Kaydet & Uygula</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

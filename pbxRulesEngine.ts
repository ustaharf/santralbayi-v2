import { Dealer, Subscriber } from './types';
import { resolveServerApiUrl, VDS_HOST } from './vdsConfig';

export type PbxRoutingFilter =
  | 'ALL'
  | 'NEW_ONLY'
  | 'CONTACTS_ONLY'
  | 'NO_CONTACTS'
  | 'EXCEPT_SPECIFIED';

export type PbxIncomingUsageTarget = 'individual' | 'company' | 'hybrid';
export type PbxOutgoingHitapMode = 'NAME' | 'COMPANY' | 'BOTH';

export interface PbxIvrExtensionRule {
  key: string;
  department: string;
  forwardNumber: string;
}

export interface PbxPhoneRuleRecord {
  phone11: string; // Canonical: 05XXXXXXXXX
  phoneE164: string; // Canonical: 905XXXXXXXXX
  profileKey: string;
  entityCode: string;
  ownerRole: 'admin' | 'iller_bayi' | 'il_bayi' | 'ilce_bayi' | 'esnaf';
  fullName: string;
  personHonorific: string;
  companyName: string;
  assistantRoleSpoken: string;
  // Incoming Rules
  usageTarget: PbxIncomingUsageTarget;
  callRoutingRule: PbxRoutingFilter;
  excludedContacts: string[];
  ringCount: number;
  callPickupMode: 'ALWAYS' | 'AFTER_HOURS_ONLY' | 'WHEN_BUSY';
  warmTransferEnabled: boolean;
  secretaryCallScreening: boolean;
  unreachableFallbackEnabled: boolean;
  enableTransferToAssistant: boolean;
  transferToAssistantKey: string;
  holdMusic: 'KURUMSAL' | 'KLASIK' | 'MODERN';
  incomingGreetingSentence: string;
  // Schedule & AI Capabilities
  is24Hours: boolean;
  workHoursWeekdays: string;
  workHoursSaturday: string;
  workHoursSunday: string;
  appointmentEnabled: boolean;
  negotiationEnabled: boolean;
  priceQuotingEnabled: boolean;
  discountLimit: number;
  orderTakingEnabled: boolean;
  businessAddress?: string;
  aiKnowledgeBase?: string;
  ivrExtensions: PbxIvrExtensionRule[];
  // Outgoing ("Ara & Bana Bağla") Rules
  outgoingHitapMode: PbxOutgoingHitapMode;
  outgoingNameGreetingSentence: string;
  outgoingCompanyGreetingSentence: string;
  transferConfirmSentence: string;
  outgoingBridgeFirst: boolean;
  outgoingAutoRetry: boolean;
  outgoingRetryMinutes: number;
  outgoingSmsOnUnreachable: boolean;
  // Voice Reference
  voiceCloneSource: string;
  updatedAt: number;
}

export type GatewayLineProvider =
  | 'NETGSM_UNLIMITED'
  | 'VERIMOR_BIREYSEL_5'
  | 'KURUMSAL_SIP'
  | 'GSM_SIM_GATEWAY';

export interface PbxGatewayPoolLine {
  id: string;
  phone11: string;
  label: string;
  provider: GatewayLineProvider;
  maxConcurrentCalls: number;
  diversionSupported: boolean;
  active: boolean;
}

export interface GatewayPoolSummary {
  activeLines: PbxGatewayPoolLine[];
  totalConcurrentCalls: number;
  estimatedSubscriberCapacity: number;
  hasUnlimitedLine: boolean;
}

export interface PbxRulesRegistryMap {
  version: number;
  centralGatewayPhone11: string;
  gatewayPool?: PbxGatewayPoolLine[];
  totalConcurrentCapacity?: number;
  fusionPbxHost: string;
  totalActiveLines: number;
  updatedAt: number;
  byPhone11: Record<string, PbxPhoneRuleRecord>;
}

export interface IncomingPbxDecision {
  matchedLine: boolean;
  subscriberPhone11: string;
  callerPhone11: string;
  callerDisplay: string;
  withinWorkHours: boolean;
  action: 'FREESWITCH_SECRETARY_ANSWER' | 'DIRECT_OWNER_GSM';
  reasonCode:
    | 'RULE_ALL_TO_SECRETARY'
    | 'EXCLUDED_CONTACT_BYPASS'
    | 'CONTACT_FILTER_BYPASS'
    | 'OUTSIDE_HOURS_SECRETARY'
    | 'UNREGISTERED_LINE_DEFAULT';
  reasonSummaryTr: string;
  ringDelaySeconds: number;
  spokenGreeting: string;
  warmTransferScreeningPrompt: string;
  dtmfReturnToAssistantKey: string | null;
  freeswitchDialplanBridge: string;
}

export interface OutgoingPbxExecutionPlan {
  sessionId: string;
  ownerPhone11: string;
  targetPhone11: string;
  targetDisplay: string;
  hitapMode: PbxOutgoingHitapMode;
  legAGreetingSentence: string;
  legBTransferSentence: string;
  autoRetryEnabled: boolean;
  retryMinutes: number;
  smsFallbackOnUnreachable: boolean;
  freeswitchOriginateCmd: string;
}

export const PBX_RULES_STORAGE_KEY = 'sb_pbx_rules_registry_v1';

export function normalizeTrGsmPhone(raw: string | null | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && /^[23458]/.test(digits)) {
    return `0${digits}`;
  }
  if (digits.length === 11 && /^0[23458]/.test(digits)) {
    return digits;
  }
  if (digits.length === 12 && /^90[23458]/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  if (digits.length > 10) {
    const tail10 = digits.slice(-10);
    if (/^[23458]/.test(tail10)) return `0${tail10}`;
    const tail11 = digits.slice(-11);
    if (tail11.startsWith('0')) return tail11;
  }
  return digits.length === 10 ? `0${digits}` : digits;
}

export function toE164Digits(phone11: string): string {
  const clean = normalizeTrGsmPhone(phone11);
  if (clean.length === 11 && clean.startsWith('0')) {
    return `90${clean.slice(1)}`;
  }
  return clean;
}

export function formatDisplayGsm(raw: string | null | undefined): string {
  const p = normalizeTrGsmPhone(raw);
  if (p.length === 11 && p.startsWith('0')) {
    return `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9, 11)}`;
  }
  return String(raw || '').trim();
}

function buildTrPossessive(nameWithTitle: string): string {
  const trimmed = (nameWithTitle || '').trim();
  if (!trimmed) return 'Yetkilinin';
  const lower = trimmed.toLocaleLowerCase('tr-TR');
  if (lower.endsWith('hanım')) return `${trimmed}'ın`;
  if (lower.endsWith('bey')) return `${trimmed}'in`;
  const vowels = trimmed.match(/[aeıioöuüAEIİOÖUÜ]/g);
  const lastVowel = vowels ? vowels[vowels.length - 1].toLocaleLowerCase('tr-TR') : 'i';
  const endsWithVowel = /[aeıioöuüAEIİOÖUÜ]$/.test(trimmed);
  const prefix = endsWithVowel ? 'n' : '';
  if (lastVowel === 'a' || lastVowel === 'ı') return `${trimmed}'${prefix}ın`;
  if (lastVowel === 'e' || lastVowel === 'i') return `${trimmed}'${prefix}in`;
  if (lastVowel === 'o' || lastVowel === 'u') return `${trimmed}'${prefix}un`;
  return `${trimmed}'${prefix}ün`;
}

function computeHonorific(fullName: string, gender?: string, explicitOfficerTitle?: string): string {
  if (explicitOfficerTitle && explicitOfficerTitle.trim()) {
    return explicitOfficerTitle.trim();
  }
  const first = String(fullName || '').trim().split(/\s+/)[0] || 'Yetkili';
  const suffix = gender === 'Kadın' ? 'Hanım' : 'Bey';
  return `${first} ${suffix}`;
}

export function isWithinScheduleWindow(
  record: Pick<PbxPhoneRuleRecord, 'is24Hours' | 'workHoursWeekdays' | 'workHoursSaturday' | 'workHoursSunday'>,
  now: Date = new Date()
): boolean {
  if (record.is24Hours) return true;
  const day = now.getDay(); // 0 = Sun, 6 = Sat
  const spec =
    day === 0
      ? record.workHoursSunday
      : day === 6
      ? record.workHoursSaturday
      : record.workHoursWeekdays;

  const normalized = String(spec || '').trim();
  if (!normalized || normalized === '7/24') return true;
  if (normalized.toLocaleLowerCase('tr-TR').includes('kapalı')) return false;

  const m = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return true;
  const openMin = Number(m[1]) * 60 + Number(m[2]);
  const closeMin = Number(m[3]) * 60 + Number(m[4]);
  const curMin = now.getHours() * 60 + now.getMinutes();
  if (closeMin >= openMin) {
    return curMin >= openMin && curMin <= closeMin;
  }
  return curMin >= openMin || curMin <= closeMin;
}

export interface RawSetupProfileInput {
  fullName?: string;
  gender?: string;
  officerTitle?: string;
  customerName?: string;
  customerPhone?: string;
  usageTarget?: PbxIncomingUsageTarget;
  incomingCompanyType?: 'GENEL_MUDURLUK' | 'FIRMASINDAN' | 'CUSTOM';
  incomingCompanyCustom?: string;
  incomingHybridType?: 'GENEL_MUDURLUK' | 'FIRMASINDAN' | 'CUSTOM';
  incomingHybridCustom?: string;
  assistantRoleTitle?: string;
  customAssistantRoleTitle?: string;
  outgoingHitapMode?: PbxOutgoingHitapMode;
  callRoutingRule?: PbxRoutingFilter;
  excludedContacts?: string;
  ringCount?: number;
  callPickupMode?: 'ALWAYS' | 'AFTER_HOURS_ONLY' | 'WHEN_BUSY';
  warmTransferEnabled?: boolean;
  secretaryCallScreening?: boolean;
  unreachableFallbackEnabled?: boolean;
  enableTransferToAssistant?: boolean;
  transferToAssistantKey?: string;
  holdMusic?: 'KURUMSAL' | 'KLASIK' | 'MODERN';
  is24Hours?: boolean;
  workHoursWeekdays?: string;
  workHoursSaturday?: string;
  workHoursSunday?: string;
  appointmentEnabled?: boolean;
  negotiationEnabled?: boolean;
  priceQuotingEnabled?: boolean;
  discountLimit?: number;
  orderTakingEnabled?: boolean;
  businessAddressConfig?: string;
  aiKnowledgeBase?: string;
  ivrExtensions?: PbxIvrExtensionRule[];
  outgoingBridgeFirst?: boolean;
  outgoingAutoRetry?: boolean;
  outgoingRetryMinutes?: number;
  outgoingSmsOnUnreachable?: boolean;
}

const ROLE_SPOKEN_MAP: Record<string, string> = {
  ASISTAN: 'asistanıyım',
  SEKRETER: 'sekreteriyim',
  DANISMAN: 'danışmanıyım',
  MUSTERI_TEMSILCISI: 'müşteri temsilcisiyim',
  SANTRAL_GOREVLISI: 'santral görevlisiyim',
  OPERASYON_SORUMLUSU: 'operasyon sorumlusuyum',
  KOORDINATOR: 'koordinatörüyüm',
  YONETICI_ASISTANI: 'yönetici asistanıyım',
};

export function resolveSpokenRoleTitle(
  roleId?: string,
  customRoleText?: string,
  customRoleOptions?: { id: string; spokenText: string }[]
): string {
  if (customRoleText && customRoleText.trim()) {
    return customRoleText.trim().replace(/\s+desin$/i, '').toLocaleLowerCase('tr-TR');
  }
  if (roleId && customRoleOptions?.length) {
    const match = customRoleOptions.find((o) => o.id === roleId);
    if (match?.spokenText) return match.spokenText;
  }
  if (roleId && ROLE_SPOKEN_MAP[roleId]) {
    return ROLE_SPOKEN_MAP[roleId];
  }
  return 'asistanıyım';
}

export function cleanSpokenCompanyName(rawCompany?: string, ownerRole?: string): string {
  let comp = String(rawCompany || '')
    .replace(/\(web\s*kayd[ıi]\)/gi, '')
    .replace(/\b(san\.?\s*ve\s*tic\.?|tic\.?\s*ltd\.?\s*şti\.?|tic\.?\s*ltd\.?|ltd\.?\s*şti\.?|a\.?\s*ş\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^santral\s*bayi$/i.test(comp) && ownerRole === 'admin') {
    comp = 'Santral Bayi Genel Merkez';
  } else if (/^santralbayi$/i.test(comp)) {
    comp = ownerRole === 'admin' ? 'Santral Bayi Genel Merkez' : 'Santral Bayi';
  }
  return comp;
}

function toCompanyOwnedRole(roleSpoken: string): string {
  const clean = (roleSpoken || 'asistanıyım').trim().toLocaleLowerCase('tr-TR');
  if (clean === 'asistanıyım') return 'asistanınızım';
  if (clean === 'sekreteriyim') return 'sekreterinizim';
  if (clean === 'yardımcısıyım') return 'yardımcınızım';
  if (clean === 'danışmanıyım') return 'danışmanınızım';
  if (clean === 'operatörüyüm') return 'operatörünüzüm';
  if (clean === 'koordinatörüyüm') return 'koordinatörünüzüm';
  if (clean === 'yönetici asistanıyım') return 'kurum asistanınızım';
  return clean;
}

export function buildUnifiedSecretaryGreeting(params: {
  ownerRole?: string;
  fullName?: string;
  personHonorific: string;
  companyName?: string;
  assistantRoleSpoken?: string;
  usageTarget?: PbxIncomingUsageTarget;
  incomingCompanyType?: 'GENEL_MUDURLUK' | 'FIRMASINDAN' | 'CUSTOM';
  incomingCompanyCustom?: string;
  incomingHybridType?: 'GENEL_MUDURLUK' | 'FIRMASINDAN' | 'CUSTOM';
  incomingHybridCustom?: string;
}): string {
  const roleSpoken = (params.assistantRoleSpoken || 'asistanıyım').trim() || 'asistanıyım';
  const honorific = (params.personHonorific || 'Yetkili').trim() || 'Yetkili';
  const comp = cleanSpokenCompanyName(params.companyName, params.ownerRole);
  const compBase = comp.replace(/\s+Genel\s+Merkez$/i, '').trim() || comp || 'Santral Bayi';
  const usageTarget: PbxIncomingUsageTarget = params.usageTarget || 'individual';

  // 1) SADECE FİRMA İSMİYLE KARŞILA (Şahıs ismi kesinlikle geçmez)
  if (usageTarget === 'company') {
    const companyRole = toCompanyOwnedRole(roleSpoken);
    if (params.incomingCompanyType === 'CUSTOM' && params.incomingCompanyCustom?.trim()) {
      const customLabel = params.incomingCompanyCustom.trim();
      return `Merhaba, ${customLabel} hattına hoş geldiniz! Ben ${companyRole}. Size nasıl yardımcı olabilirim?`;
    }
    if (params.incomingCompanyType === 'GENEL_MUDURLUK') {
      return `Merhaba, ${compBase} Genel Müdürlük hattına hoş geldiniz! Ben ${companyRole}. Size nasıl yardımcı olabilirim?`;
    }
    return `Merhaba, ${compBase} firmasına hoş geldiniz! Ben ${companyRole}. Size nasıl yardımcı olabilirim?`;
  }

  // 2) HEM FİRMA İSMİ HEM ŞAHIS İSMİYLE KARŞILA
  if (usageTarget === 'hybrid') {
    if (params.incomingHybridType === 'CUSTOM' && params.incomingHybridCustom?.trim()) {
      const customHybrid = params.incomingHybridCustom.trim();
      return `Merhaba, hoş geldiniz! Ben ${customHybrid} ${roleSpoken}. Size nasıl yardımcı olabilirim?`;
    }
    if (params.incomingHybridType === 'GENEL_MUDURLUK') {
      return `Merhaba, ${compBase} Genel Müdürlük hattına hoş geldiniz! Ben ${buildTrPossessive(honorific)} ${roleSpoken}. Size nasıl yardımcı olabilirim?`;
    }
    return `Merhaba, hoş geldiniz! Ben ${compBase} firmasından ${buildTrPossessive(honorific)} ${roleSpoken}. Size nasıl yardımcı olabilirim?`;
  }

  // 3) SADECE ŞAHIS İSMİMLE KARŞILA
  return `Merhaba, hoş geldiniz! Ben ${buildTrPossessive(honorific)} ${roleSpoken}. Size nasıl yardımcı olabilirim?`;
}

export function compileSinglePbxRuleRecord(params: {
  phoneRaw: string;
  profileKey: string;
  entityCode: string;
  ownerRole: PbxPhoneRuleRecord['ownerRole'];
  fallbackFullName: string;
  fallbackCompanyName: string;
  profile?: RawSetupProfileInput | null;
  roleOptions?: { id: string; spokenText: string }[];
}): PbxPhoneRuleRecord | null {
  const p = params.profile || {};
  const phone11 = normalizeTrGsmPhone(p.customerPhone || params.phoneRaw);
  if (!phone11 || phone11.length < 10) return null;

  const fullName = (p.fullName && p.fullName.trim()) || params.fallbackFullName || 'Yetkili';
  const companyName =
    cleanSpokenCompanyName(p.customerName && p.customerName.trim() ? p.customerName : params.fallbackCompanyName, params.ownerRole) ||
    fullName;
  const personHonorific = computeHonorific(fullName, p.gender, p.officerTitle);
  const assistantRoleSpoken = resolveSpokenRoleTitle(
    p.assistantRoleTitle,
    p.customAssistantRoleTitle,
    params.roleOptions
  );
  const usageTarget: PbxIncomingUsageTarget = p.usageTarget || 'individual';

  let incomingGreetingSentence = buildUnifiedSecretaryGreeting({
    ownerRole: params.ownerRole,
    fullName,
    personHonorific,
    companyName,
    assistantRoleSpoken,
    usageTarget,
    incomingCompanyType: p.incomingCompanyType,
    incomingCompanyCustom: p.incomingCompanyCustom,
    incomingHybridType: p.incomingHybridType,
    incomingHybridCustom: p.incomingHybridCustom,
  });

  const ivrExtensions = Array.isArray(p.ivrExtensions) ? p.ivrExtensions : [];
  if (ivrExtensions.length > 0) {
    const ivrLine =
      ivrExtensions.map((e) => `${e.department} için ${e.key}'e`).join(', ') +
      ' basabilir veya doğrudan benimle konuşabilirsiniz.';
    incomingGreetingSentence = `${incomingGreetingSentence} ${ivrLine}`;
  }

  const outgoingNameGreetingSentence = `Merhaba, ben ${buildTrPossessive(personHonorific)} ${assistantRoleSpoken}. ${personHonorific} sizinle görüşmek istiyor, müsaitseniz bağlıyorum.`;
  const outgoingCompanyGreetingSentence = `Merhaba, ben ${companyName} firmasından ${buildTrPossessive(personHonorific)} ${assistantRoleSpoken}. ${personHonorific} sizinle görüşmek istiyor, müsaitseniz bağlıyorum.`;
  const transferConfirmSentence = `Teşekkür ederim, sizi hemen ${personHonorific} ile görüştürüyorum, aktarıyorum.`;

  const excludedContacts = String(p.excludedContacts || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  return {
    phone11,
    phoneE164: toE164Digits(phone11),
    profileKey: params.profileKey,
    entityCode: params.entityCode,
    ownerRole: params.ownerRole,
    fullName,
    personHonorific,
    companyName,
    assistantRoleSpoken,
    usageTarget,
    callRoutingRule: p.callRoutingRule || 'ALL',
    excludedContacts,
    ringCount: typeof p.ringCount === 'number' ? p.ringCount : 0,
    callPickupMode: p.callPickupMode || 'ALWAYS',
    warmTransferEnabled: p.warmTransferEnabled ?? true,
    secretaryCallScreening: p.secretaryCallScreening ?? true,
    unreachableFallbackEnabled: p.unreachableFallbackEnabled ?? true,
    enableTransferToAssistant: p.enableTransferToAssistant ?? true,
    transferToAssistantKey: p.transferToAssistantKey || '1',
    holdMusic: p.holdMusic || 'KURUMSAL',
    incomingGreetingSentence,
    is24Hours:
      Boolean(p.is24Hours) ||
      (p.workHoursWeekdays === '7/24' &&
        p.workHoursSaturday === '7/24' &&
        p.workHoursSunday === '7/24'),
    workHoursWeekdays: p.workHoursWeekdays || '09:00 - 18:00',
    workHoursSaturday: p.workHoursSaturday || '09:00 - 14:00',
    workHoursSunday: p.workHoursSunday || 'Kapalı',
    appointmentEnabled: p.appointmentEnabled ?? true,
    negotiationEnabled: p.negotiationEnabled ?? true,
    priceQuotingEnabled: p.priceQuotingEnabled ?? true,
    discountLimit: typeof p.discountLimit === 'number' ? p.discountLimit : 10,
    orderTakingEnabled: p.orderTakingEnabled ?? true,
    businessAddress: String(p.businessAddressConfig || '').trim(),
    aiKnowledgeBase: String(p.aiKnowledgeBase || '').trim(),
    ivrExtensions,
    outgoingHitapMode: p.outgoingHitapMode || 'NAME',
    outgoingNameGreetingSentence,
    outgoingCompanyGreetingSentence,
    transferConfirmSentence,
    outgoingBridgeFirst: p.outgoingBridgeFirst ?? true,
    outgoingAutoRetry: p.outgoingAutoRetry ?? true,
    outgoingRetryMinutes: typeof p.outgoingRetryMinutes === 'number' ? p.outgoingRetryMinutes : 5,
    outgoingSmsOnUnreachable: p.outgoingSmsOnUnreachable ?? true,
    voiceCloneSource: '/assets/aistudio/ref_voice_15s.wav',
    updatedAt: Date.now(),
  };
}

export function compileAllPanelsPbxRegistry(params: {
  dealers: Dealer[];
  subscribers: Subscriber[];
  setupProfiles: Record<string, RawSetupProfileInput>;
  roleOptions?: { id: string; spokenText: string }[];
  centralGatewayPhone?: string;
  gatewayPool?: PbxGatewayPoolLine[];
}): PbxRulesRegistryMap {
  const byPhone11: Record<string, PbxPhoneRuleRecord> = {};
  const { dealers, subscribers, setupProfiles, roleOptions } = params;

  // 1. Genel Merkez Yönetici (TR.000)
  const adminProfile = setupProfiles['admin'];
  const adminRec = compileSinglePbxRuleRecord({
    phoneRaw: adminProfile?.customerPhone || '05376031645',
    profileKey: 'admin',
    entityCode: 'TR.000',
    ownerRole: 'admin',
    fallbackFullName: 'Kenan Gürkan',
    fallbackCompanyName: 'Santral Bayi Genel Merkez',
    profile: adminProfile,
    roleOptions,
  });
  if (adminRec) {
    byPhone11[adminRec.phone11] = adminRec;
  }

  // 2. Tüm Bayiler (Yeni eklenen her bayi kendi 05XX numarasıyla otomatik bağlanır)
  for (const d of dealers) {
    const aliasKey =
      d.id === 'd-0'
        ? 'iller_bayi'
        : d.id === 'd-1'
        ? 'il_bayi'
        : d.id === 'd-2'
        ? 'ilce_bayi'
        : `dealer_${d.id}`;
    const prof = setupProfiles[`dealer_${d.id}`] || setupProfiles[aliasKey] || null;
    const ownerRole: PbxPhoneRuleRecord['ownerRole'] =
      d.id === 'd-0' || d.dealerCode === 'TR.001' || d.level === 'ILLER'
        ? 'iller_bayi'
        : d.level === 'IL'
        ? 'il_bayi'
        : 'ilce_bayi';

    const rec = compileSinglePbxRuleRecord({
      phoneRaw: prof?.customerPhone || d.contactPhone,
      profileKey: `dealer_${d.id}`,
      entityCode: d.dealerCode || d.id,
      ownerRole,
      fallbackFullName: d.contactName || d.name,
      fallbackCompanyName: d.name,
      profile: prof,
      roleOptions,
    });
    if (rec) {
      byPhone11[rec.phone11] = rec;
    }
  }

  // 3. Tüm Esnaf Aboneler (Yeni eklenen her esnaf kendi 05XX numarasıyla otomatik bağlanır)
  for (let i = 0; i < subscribers.length; i++) {
    const s = subscribers[i];
    const prof =
      setupProfiles[`subscriber_${s.id}`] ||
      (i === 0 || s.id === 's-1' ? setupProfiles['esnaf'] : null);
    const rec = compileSinglePbxRuleRecord({
      phoneRaw: prof?.customerPhone || s.contactPhone || s.phone,
      profileKey: i === 0 || s.id === 's-1' ? 'esnaf' : `subscriber_${s.id}`,
      entityCode: s.subscriberCode || s.id,
      ownerRole: 'esnaf',
      fallbackFullName: s.fullName || s.aiConfig?.agentName || s.name,
      fallbackCompanyName: s.companyName || s.name,
      profile: prof
        ? {
            ...prof,
            aiKnowledgeBase:
              prof.aiKnowledgeBase && prof.aiKnowledgeBase.trim()
                ? prof.aiKnowledgeBase
                : s.aiConfig?.knowledgeBase || '',
          }
        : {
            fullName: s.fullName || s.name,
            gender: s.gender || 'Erkek',
            customerName: s.companyName || s.name,
            customerPhone: s.contactPhone || s.phone,
            usageTarget: 'company',
            appointmentEnabled: s.aiConfig?.features?.appointmentBooking ?? true,
            negotiationEnabled: s.aiConfig?.features?.priceNegotiation ?? true,
            priceQuotingEnabled: s.aiConfig?.features?.priceNegotiation ?? true,
            discountLimit: s.aiConfig?.negotiationDiscountPercent ?? 10,
            workHoursWeekdays: '09:00 - 18:00',
            aiKnowledgeBase: s.aiConfig?.knowledgeBase || '',
            ivrExtensions: s.aiConfig?.ivrExtensions || [],
          },
      roleOptions,
    });
    if (rec) {
      byPhone11[rec.phone11] = rec;
    }
  }

  const poolSummary = summarizeGatewayPool(params.gatewayPool, params.centralGatewayPhone);
  const centralGatewayPhone11 =
    poolSummary.activeLines[0]?.phone11 ||
    normalizeTrGsmPhone(params.centralGatewayPhone) ||
    '02826060537';

  return {
    version: 3,
    centralGatewayPhone11,
    gatewayPool: poolSummary.activeLines,
    totalConcurrentCapacity: poolSummary.totalConcurrentCalls,
    fusionPbxHost: `${VDS_HOST}:5060`,
    totalActiveLines: Object.keys(byPhone11).length,
    updatedAt: Date.now(),
    byPhone11,
  };
}

export function evaluateIncomingPbxCall(params: {
  registry: PbxRulesRegistryMap;
  subscriberPhone: string;
  callerPhone: string;
  callerName?: string;
  isSavedInContacts?: boolean;
  now?: Date;
}): IncomingPbxDecision {
  const subPhone11 = normalizeTrGsmPhone(params.subscriberPhone);
  const callerPhone11 = normalizeTrGsmPhone(params.callerPhone) || '05320000000';
  const callerDisplay = (params.callerName && params.callerName.trim()) || formatDisplayGsm(callerPhone11);
  const rule = params.registry.byPhone11[subPhone11];

  if (!rule) {
    return {
      matchedLine: false,
      subscriberPhone11: subPhone11,
      callerPhone11,
      callerDisplay,
      withinWorkHours: true,
      action: 'DIRECT_OWNER_GSM',
      reasonCode: 'UNREGISTERED_LINE_DEFAULT',
      reasonSummaryTr: 'Numara santral havuzunda bulunamadı; çağrı doğrudan GSM hattına bırakıldı.',
      ringDelaySeconds: 0,
      spokenGreeting: '',
      warmTransferScreeningPrompt: '',
      dtmfReturnToAssistantKey: null,
      freeswitchDialplanBridge: `sofia/external/${toE164Digits(subPhone11)}@${VDS_HOST}:5060`,
    };
  }

  const withinWorkHours = isWithinScheduleWindow(rule, params.now || new Date());
  const callerLower = callerDisplay.toLocaleLowerCase('tr-TR');
  const callerTail10 = callerPhone11.slice(-10);

  // 1. Hariç Tutulan Kişi/Numara Kontrolü (EXCEPT_SPECIFIED)
  if (rule.callRoutingRule === 'EXCEPT_SPECIFIED' && rule.excludedContacts.length > 0) {
    const isExcluded = rule.excludedContacts.some((entry) => {
      const entryDigits = entry.replace(/\D/g, '');
      if (entryDigits.length >= 7 && callerTail10 && callerTail10.endsWith(entryDigits.slice(-10))) {
        return true;
      }
      const entryLower = entry.toLocaleLowerCase('tr-TR').trim();
      return entryLower.length >= 2 && callerLower.includes(entryLower);
    });
    if (isExcluded) {
      return {
        matchedLine: true,
        subscriberPhone11: rule.phone11,
        callerPhone11,
        callerDisplay,
        withinWorkHours,
        action: 'DIRECT_OWNER_GSM',
        reasonCode: 'EXCLUDED_CONTACT_BYPASS',
        reasonSummaryTr: `"${callerDisplay}" hariç tutulan kişiler listesinde olduğu için sekreter devreye girmedi; doğrudan ${rule.personHonorific} cep hattı çaldırılıyor.`,
        ringDelaySeconds: 0,
        spokenGreeting: '',
        warmTransferScreeningPrompt: '',
        dtmfReturnToAssistantKey: rule.enableTransferToAssistant ? rule.transferToAssistantKey : null,
        freeswitchDialplanBridge: `sofia/gateway/gsm_bridge/${rule.phoneE164}`,
      };
    }
  }

  // 2. Rehber / Yeni Numara Filtreleri
  const inContacts = Boolean(params.isSavedInContacts);
  if (
    (rule.callRoutingRule === 'NEW_ONLY' && inContacts) ||
    (rule.callRoutingRule === 'NO_CONTACTS' && inContacts) ||
    (rule.callRoutingRule === 'CONTACTS_ONLY' && !inContacts)
  ) {
    return {
      matchedLine: true,
      subscriberPhone11: rule.phone11,
      callerPhone11,
      callerDisplay,
      withinWorkHours,
      action: 'DIRECT_OWNER_GSM',
      reasonCode: 'CONTACT_FILTER_BYPASS',
      reasonSummaryTr: `Rehber kuralı (${rule.callRoutingRule}) gereği arayan doğrudan ${rule.personHonorific} GSM hattına yönlendirildi.`,
      ringDelaySeconds: 0,
      spokenGreeting: '',
      warmTransferScreeningPrompt: '',
      dtmfReturnToAssistantKey: rule.enableTransferToAssistant ? rule.transferToAssistantKey : null,
      freeswitchDialplanBridge: `sofia/gateway/gsm_bridge/${rule.phoneE164}`,
    };
  }

  // 3. Mesai Dışı / Karşılama Modu
  const ringDelaySeconds = Math.max(0, (rule.ringCount || 0) * 4);
  const greetingPrefix = withinWorkHours
    ? rule.incomingGreetingSentence
    : `${rule.incomingGreetingSentence} Şu an mesai saatlerimiz dışındayız ancak talebinizi veya randevunuzu hemen kaydedip ${rule.personHonorific}'e iletebilirim.`;

  const screeningPrompt = `${rule.personHonorific}, hattımızda ${callerDisplay} var ve sizinle görüşmek istiyor. Aktarayım mı, yoksa 3 dakika içinde arayacağınızı mı ileteyim?`;
  const dtmfKey = rule.enableTransferToAssistant ? rule.transferToAssistantKey : null;

  return {
    matchedLine: true,
    subscriberPhone11: rule.phone11,
    callerPhone11,
    callerDisplay,
    withinWorkHours,
    action: 'FREESWITCH_SECRETARY_ANSWER',
    reasonCode: withinWorkHours ? 'RULE_ALL_TO_SECRETARY' : 'OUTSIDE_HOURS_SECRETARY',
    reasonSummaryTr: withinWorkHours
      ? `FusionPBX (${VDS_HOST}:5060) ${rule.phone11} hattını karşıladı • Yetkiliye bağlarken uygulama içi VoIP Data zili (0 ₺ • İç Ahize) çaldırılır${dtmfKey ? ` • Görüşmede [${dtmfKey}] ile sekretere devir aktif` : ''}.`
      : `Mesai dışı kuralı aktif: Sekreter klonlanmış sesle karşılayıp not/randevu kaydı alıyor.`,
    ringDelaySeconds,
    spokenGreeting: greetingPrefix,
    warmTransferScreeningPrompt: screeningPrompt,
    dtmfReturnToAssistantKey: dtmfKey,
    freeswitchDialplanBridge: dtmfKey
      ? `bind_meta_app=${dtmfKey} b s execute_extension::return_to_ai XML default | bridge=user/${rule.phone11}@voip.santralbayi|sofia/gateway/gsm_bridge/${rule.phoneE164}`
      : `bridge=user/${rule.phone11}@voip.santralbayi|sofia/gateway/gsm_bridge/${rule.phoneE164}`,
  };
}

export function evaluateOutgoingPbxCall(params: {
  rule: PbxPhoneRuleRecord | null;
  ownerPhoneRaw: string;
  ownerHonorificFallback: string;
  targetPhoneRaw: string;
  targetName?: string;
  selectedHitapMode: 'NAME' | 'COMPANY';
  overrideGreetingSentence?: string;
  overrideTransferSentence?: string;
  gatewayHost?: string;
  gatewayPort?: string;
}): OutgoingPbxExecutionPlan {
  const sessionId = `fs-out-${Date.now()}`;
  const ownerPhone11 = normalizeTrGsmPhone(params.rule?.phone11 || params.ownerPhoneRaw) || '05376031645';
  const targetPhone11 = normalizeTrGsmPhone(params.targetPhoneRaw);
  const targetDisplay = (params.targetName && params.targetName.trim()) || formatDisplayGsm(targetPhone11);

  const hitapMode: PbxOutgoingHitapMode = params.selectedHitapMode === 'COMPANY' ? 'COMPANY' : 'NAME';
  const legAGreetingSentence =
    (params.overrideGreetingSentence && params.overrideGreetingSentence.trim()) ||
    (hitapMode === 'COMPANY'
      ? params.rule?.outgoingCompanyGreetingSentence
      : params.rule?.outgoingNameGreetingSentence) ||
    `Merhaba, ben ${buildTrPossessive(params.ownerHonorificFallback)} asistanıyım. ${params.ownerHonorificFallback} sizinle görüşmek istiyor, müsaitseniz bağlıyorum.`;

  const legBTransferSentence =
    (params.overrideTransferSentence && params.overrideTransferSentence.trim()) ||
    params.rule?.transferConfirmSentence ||
    `Teşekkür ederim, sizi hemen ${params.ownerHonorificFallback} ile görüştürüyorum, aktarıyorum.`;

  const gwEndpoint =
    params.gatewayHost && params.gatewayHost.trim()
      ? `${params.gatewayHost.trim()}:${(params.gatewayPort || '5060').trim()}`
      : `${VDS_HOST}:5060`;

  const freeswitchOriginateCmd = `bgapi originate {origination_caller_id_number=${toE164Digits(
    ownerPhone11
  )},ignore_early_media=true}sofia/external/${toE164Digits(
    targetPhone11
  )}@${gwEndpoint} &lua(sb_warm_transfer.lua '${toE164Digits(ownerPhone11)}')`;

  return {
    sessionId,
    ownerPhone11,
    targetPhone11,
    targetDisplay,
    hitapMode,
    legAGreetingSentence,
    legBTransferSentence,
    autoRetryEnabled: params.rule?.outgoingAutoRetry ?? true,
    retryMinutes: params.rule?.outgoingRetryMinutes ?? 5,
    smsFallbackOnUnreachable: params.rule?.outgoingSmsOnUnreachable ?? true,
    freeswitchOriginateCmd,
  };
}

export function summarizeGatewayPool(
  pool?: PbxGatewayPoolLine[] | null,
  fallbackPhoneRaw?: string
): GatewayPoolSummary {
  const validActive = Array.isArray(pool)
    ? pool
        .map((line) => ({
          ...line,
          phone11: normalizeTrGsmPhone(line?.phone11),
          maxConcurrentCalls: Math.max(1, Number(line?.maxConcurrentCalls) || 5),
          diversionSupported: line?.diversionSupported ?? true,
          active: Boolean(line?.active),
        }))
        .filter((line) => line.active && line.phone11.length >= 10)
    : [];

  if (validActive.length === 0) {
    const fallback11 = normalizeTrGsmPhone(fallbackPhoneRaw) || '02826060537';
    const isNetgsmMain = fallback11 === '02826060537';
    const isLandlineOrSip = !fallback11.startsWith('05');
    const fallbackLine: PbxGatewayPoolLine = {
      id: isNetgsmMain ? 'gw-netgsm-2826060537' : 'gw-default-1',
      phone11: fallback11,
      label: isNetgsmMain
        ? 'Netgsm Merkez Hat #1 (0282 606 05 37)'
        : isLandlineOrSip
        ? 'Merkez Coğrafi SIP Hattı #1'
        : 'Merkez Köprü Hattı #1',
      provider: isNetgsmMain ? 'NETGSM_UNLIMITED' : isLandlineOrSip ? 'VERIMOR_BIREYSEL_5' : 'GSM_SIM_GATEWAY',
      maxConcurrentCalls: isNetgsmMain ? 100 : 5,
      diversionSupported: true,
      active: true,
    };
    return {
      activeLines: [fallbackLine],
      totalConcurrentCalls: fallbackLine.maxConcurrentCalls,
      estimatedSubscriberCapacity: fallbackLine.maxConcurrentCalls * 20,
      hasUnlimitedLine: isNetgsmMain,
    };
  }

  const hasUnlimitedLine = validActive.some(
    (l) => l.provider === 'NETGSM_UNLIMITED' || l.maxConcurrentCalls >= 100
  );
  const totalConcurrentCalls = validActive.reduce((sum, l) => sum + l.maxConcurrentCalls, 0);

  return {
    activeLines: validActive,
    totalConcurrentCalls,
    estimatedSubscriberCapacity: totalConcurrentCalls * 20,
    hasUnlimitedLine,
  };
}

export function selectBalancedGatewayForSubscriber(
  subscriberPhoneRaw?: string | null,
  pool?: PbxGatewayPoolLine[] | null,
  fallbackPhoneRaw?: string
): PbxGatewayPoolLine {
  const summary = summarizeGatewayPool(pool, fallbackPhoneRaw);
  const lines = summary.activeLines;
  if (lines.length === 1) return lines[0];

  // Kanal kapasitesi ağırlıklı deterministik havuz dağıtımı
  const weightedSlots: PbxGatewayPoolLine[] = [];
  for (const line of lines) {
    const weight = Math.max(1, Math.min(20, Math.ceil(line.maxConcurrentCalls / 5)));
    for (let i = 0; i < weight; i++) {
      weightedSlots.push(line);
    }
  }

  const sub11 = normalizeTrGsmPhone(subscriberPhoneRaw) || '05376031645';
  let hash = 2166136261;
  for (let i = 0; i < sub11.length; i++) {
    hash ^= sub11.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const idx = Math.abs(hash) % weightedSlots.length;
  return weightedSlots[idx] || lines[0];
}

export interface GsmConditionalCodes {
  gatewayPhone11: string;
  gatewayDisplay: string;
  assignedLineLabel: string;
  assignedProvider: GatewayLineProvider;
  poolTotalConcurrentCalls: number;
  poolActiveLineCount: number;
  whenBusyOrNoAnswerCode: string; // **004*0212XXXXXXX# (Meşgul + Cevapsız + Ulaşılamaz tek kod)
  whenBusyOnlyCode: string; // **67*0212XXXXXXX#
  whenUnansweredCode: string; // **61*0212XXXXXXX#
  whenUnreachableCode: string; // **62*0212XXXXXXX#
  forwardAllCode: string; // **21*0212XXXXXXX#
  cancelAllCode: string; // ##002#
}

export function buildGsmConditionalForwardingCodes(
  centralGatewayPhoneRaw?: string,
  pool?: PbxGatewayPoolLine[] | null,
  subscriberPhoneRaw?: string | null
): GsmConditionalCodes {
  const summary = summarizeGatewayPool(pool, centralGatewayPhoneRaw);
  const assigned = selectBalancedGatewayForSubscriber(
    subscriberPhoneRaw,
    summary.activeLines,
    centralGatewayPhoneRaw
  );
  const gatewayPhone11 = assigned.phone11 || normalizeTrGsmPhone(centralGatewayPhoneRaw) || '02826060537';
  return {
    gatewayPhone11,
    gatewayDisplay: formatDisplayGsm(gatewayPhone11),
    assignedLineLabel: assigned.label,
    assignedProvider: assigned.provider,
    poolTotalConcurrentCalls: summary.totalConcurrentCalls,
    poolActiveLineCount: summary.activeLines.length,
    whenBusyOrNoAnswerCode: `**004*${gatewayPhone11}#`,
    whenBusyOnlyCode: `**67*${gatewayPhone11}#`,
    whenUnansweredCode: `**61*${gatewayPhone11}#`,
    whenUnreachableCode: `**62*${gatewayPhone11}#`,
    forwardAllCode: `**21*${gatewayPhone11}#`,
    cancelAllCode: '##002#',
  };
}

export function loadCachedPbxRegistry(): PbxRulesRegistryMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PBX_RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.byPhone11) {
        return parsed as PbxRulesRegistryMap;
      }
    }
  } catch {}
  return null;
}

let pbxSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncedPbxFingerprint = '';

function buildPbxRegistryFingerprint(reg: PbxRulesRegistryMap | null | undefined): string {
  if (!reg || typeof reg !== 'object') return '';
  return JSON.stringify({
    version: reg.version,
    centralGatewayPhone11: reg.centralGatewayPhone11,
    gatewayPool: reg.gatewayPool,
    fusionPbxHost: reg.fusionPbxHost,
    byPhone11: reg.byPhone11,
  });
}

export function persistAndSyncPbxRegistry(
  registry: PbxRulesRegistryMap,
  onPersistVault?: (reg: PbxRulesRegistryMap) => void
): void {
  if (typeof window === 'undefined') return;
  const nextFingerprint = buildPbxRegistryFingerprint(registry);
  if (!nextFingerprint) return;

  const cached = loadCachedPbxRegistry();
  const cachedFingerprint = buildPbxRegistryFingerprint(cached);

  // Kural içeriği birebir aynıysa açılışta gereksiz yere mahzeni ve sunucuyu tekrar tekrar tetikleme!
  if (nextFingerprint === cachedFingerprint || nextFingerprint === lastSyncedPbxFingerprint) {
    lastSyncedPbxFingerprint = nextFingerprint;
    return;
  }

  lastSyncedPbxFingerprint = nextFingerprint;

  try {
    window.localStorage.setItem(PBX_RULES_STORAGE_KEY, JSON.stringify(registry));
  } catch {}

  if (onPersistVault) {
    onPersistVault(registry);
  }

  if (pbxSyncTimer) clearTimeout(pbxSyncTimer);
  pbxSyncTimer = setTimeout(() => {
    void fetch(resolveServerApiUrl('/api/pbx/sync-rules'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registry),
    }).catch(() => {
      // Offline / VDS fallback handled silently via Firestore & IndexedDB vault
    });
  }, 1200);
}


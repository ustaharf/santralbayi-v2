import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  CreditCard,
  ExternalLink,
  KeyRound,
  MapPin,
  PhoneForwarded,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Smartphone,
  User,
  Volume2,
  Wrench,
  X,
  Zap
} from 'lucide-react';
import { Dealer, Subscriber } from './types';

export type RemoteInterventionActionType =
  | 'WAKE_SECRETARY'
  | 'RESET_VOICE'
  | 'RESET_SESSION_LOCK'
  | 'RESET_WARM_TRANSFER'
  | 'SYNC_LICENSE_PACKAGE'
  | 'FORCE_OTA_REFRESH'
  | 'FULL_REPAIR';

export type AdminPanelPageTarget =
  | 'SETUP_STEP_1'
  | 'SETUP_STEP_2'
  | 'SETUP_STEP_3'
  | 'SETUP_STEP_4'
  | 'PERMISSIONS'
  | 'AI_SECRETARY'
  | 'LICENSE'
  | 'FINANCE'
  | 'WALLET'
  | 'APPOINTMENTS'
  | 'CALL_LOGS'
  | 'PROFILE_SETTINGS'
  | 'PANEL_HOME';

export interface NotificationIntentResult {
  target: AdminPanelPageTarget;
  topicLabel: string;
  buttonLabel: string;
  pageTitle: string;
}

export const ADMIN_QUICK_PAGE_OPTIONS: {
  target: AdminPanelPageTarget;
  shortLabel: string;
  pageTitle: string;
}[] = [
  { target: 'SETUP_STEP_1', shortLabel: '⚙️ Yapılandırma (Kurulum 1)', pageTitle: 'Kurulum 1 · Hat & Kimlik Yapılandırması' },
  { target: 'SETUP_STEP_2', shortLabel: '📞 Karşılama (Kurulum 2)', pageTitle: 'Kurulum 2 · Gelen Arama & Karşılama' },
  { target: 'SETUP_STEP_3', shortLabel: '🗣️ Ses & Hitap (Kurulum 3)', pageTitle: 'Kurulum 3 · Ses Tonu & Hitap Ayarı' },
  { target: 'SETUP_STEP_4', shortLabel: '🤖 Yapay Zeka (Kurulum 4)', pageTitle: 'Kurulum 4 · Yapay Zeka & Mesai Ayarı' },
  { target: 'AI_SECRETARY', shortLabel: '📞 VoIP Data Telefon', pageTitle: 'VoIP Data Santral Telefonu & İç Ahize' },
  { target: 'PERMISSIONS', shortLabel: '🛡️ İzin & Sekreter Ayarı', pageTitle: 'Yetki, İzin & Arka Plan Pil Ayarları' },
  { target: 'LICENSE', shortLabel: '📜 Lisans & Paket', pageTitle: 'Abonelik & Lisans Yönetimi' },
  { target: 'PROFILE_SETTINGS', shortLabel: '🔧 Telefon & Adres Ayarı', pageTitle: 'Profil, Telefon & Adres Ayarları' },
  { target: 'FINANCE', shortLabel: '📊 Muhasebe & Kasa', pageTitle: 'Muhasebe & Mali Kasa' },
  { target: 'PANEL_HOME', shortLabel: '🏠 Ana Panelini Aç', pageTitle: 'Kullanıcı Ana Paneli' }
];

export const detectNotificationPageIntent = (
  textRaw: string,
  categoryRaw: string = ''
): NotificationIntentResult => {
  const hay = `${textRaw || ''} ${categoryRaw || ''}`.toLocaleLowerCase('tr-TR');

  if (
    hay.includes('voip') ||
    hay.includes('ahize') ||
    hay.includes('hoparlör') ||
    hay.includes('zil çal') ||
    hay.includes('yönlendir')
  ) {
    return {
      target: 'AI_SECRETARY',
      topicLabel: 'VoIP Data Telefon & İç Ahize Köprüsü',
      buttonLabel: '📞 VoIP Telefon Sayfasını Aç',
      pageTitle: 'VoIP Data Santral Telefonu & İç Ahize'
    };
  }

  if (
    hay.includes('ses') ||
    hay.includes('anons') ||
    hay.includes('hitap') ||
    hay.includes('konuşma') ||
    hay.includes('ton') ||
    hay.includes('dinle')
  ) {
    return {
      target: 'SETUP_STEP_3',
      topicLabel: 'Ses Tonu & Hitap Yapılandırması',
      buttonLabel: '🗣️ Ses & Hitap Sayfasını Aç',
      pageTitle: 'Kurulum 3 · Ses Tonu & Hitap Ayarı'
    };
  }

  if (
    hay.includes('gelen arama') ||
    hay.includes('bekleme müzi') ||
    hay.includes('karşılama met') ||
    hay.includes('meşgul')
  ) {
    return {
      target: 'SETUP_STEP_2',
      topicLabel: 'Gelen Arama & Karşılama Ayarı',
      buttonLabel: '📞 Karşılama Ayar Sayfasını Aç',
      pageTitle: 'Kurulum 2 · Gelen Arama & Karşılama'
    };
  }

  if (
    hay.includes('mesai') ||
    hay.includes('çalışma saat') ||
    hay.includes('fiyat ver') ||
    hay.includes('pazarlık') ||
    hay.includes('yetenek')
  ) {
    return {
      target: 'SETUP_STEP_4',
      topicLabel: 'Yapay Zeka & Mesai Yapılandırması',
      buttonLabel: '🤖 Yapay Zeka Ayar Sayfasını Aç',
      pageTitle: 'Kurulum 4 · Yapay Zeka & Mesai Ayarı'
    };
  }

  if (
    hay.includes('aktarma') ||
    hay.includes('ön görüşme') ||
    hay.includes('rehber')
  ) {
    return {
      target: 'SETUP_STEP_2',
      topicLabel: 'Gelen Arama & Ön Görüşmeli Aktarma Ayarı',
      buttonLabel: '📞 Karşılama & Aktarma Sayfasını Aç',
      pageTitle: 'Kurulum 2 · Gelen Arama & Karşılama'
    };
  }

  if (
    hay.includes('lisans') ||
    hay.includes('paket') ||
    hay.includes('abonelik') ||
    hay.includes('süre') ||
    hay.includes('yenileme') ||
    hay.includes('askı')
  ) {
    return {
      target: 'LICENSE',
      topicLabel: 'Lisans & Paket Yönetimi',
      buttonLabel: '📜 Lisans & Paket Sayfasını Aç',
      pageTitle: 'Abonelik & Lisans Yönetimi'
    };
  }

  if (
    hay.includes('muhasebe') ||
    hay.includes('fiş') ||
    hay.includes('fatura') ||
    hay.includes('gelir') ||
    hay.includes('gider') ||
    hay.includes('kdv')
  ) {
    return {
      target: 'FINANCE',
      topicLabel: 'Muhasebe & Mali Kasa',
      buttonLabel: '📊 Muhasebe Sayfasını Aç',
      pageTitle: 'Muhasebe & Mali Kasa'
    };
  }

  if (
    hay.includes('çekim') ||
    hay.includes('cüzdan') ||
    hay.includes('hakediş') ||
    hay.includes('iban')
  ) {
    return {
      target: 'WALLET',
      topicLabel: 'Cüzdan & Hakediş Ayarı',
      buttonLabel: '💳 Cüzdan & Hakediş Sayfasını Aç',
      pageTitle: 'Cüzdan & Hakediş Yönetimi'
    };
  }

  if (hay.includes('randevu') || hay.includes('sipariş') || hay.includes('rezervasyon')) {
    return {
      target: 'APPOINTMENTS',
      topicLabel: 'Randevu & Sipariş Yönetimi',
      buttonLabel: '📅 Randevular Sayfasını Aç',
      pageTitle: 'Randevu & Sipariş Ekranı'
    };
  }

  if (hay.includes('gelen arama') || hay.includes('giden arama') || hay.includes('çağrı kay')) {
    return {
      target: 'CALL_LOGS',
      topicLabel: 'Telefon & Gelen Aramalar',
      buttonLabel: '📞 Telefon & Gelen Aramaları Aç',
      pageTitle: 'Telefon & Gelen Aramalar'
    };
  }

  if (
    hay.includes('adres') ||
    hay.includes('telefon güncelle') ||
    hay.includes('numara değiştir') ||
    hay.includes('e-posta') ||
    hay.includes('profil')
  ) {
    return {
      target: 'PROFILE_SETTINGS',
      topicLabel: 'Telefon, Adres & Profil Ayarları',
      buttonLabel: '🔧 Profil & İletişim Ayarını Aç',
      pageTitle: 'Profil, Telefon & Adres Ayarları'
    };
  }

  if (
    hay.includes('izin') ||
    hay.includes('pil') ||
    hay.includes('uyku') ||
    hay.includes('arka plan') ||
    hay.includes('sekreter') ||
    hay.includes('onarım') ||
    hay.includes('tam hat') ||
    hay.includes('müdahale') ||
    hay.includes('çalışmıyor') ||
    hay.includes('devre dışı')
  ) {
    return {
      target: 'PERMISSIONS',
      topicLabel: 'Yetki, İzin & Sekreter Ayarları',
      buttonLabel: '🛡️ Yetki & İzin Sayfasını Aç',
      pageTitle: 'Yetki, İzin & Arka Plan Pil Ayarları'
    };
  }

  return {
    target: 'SETUP_STEP_1',
    topicLabel: 'Hat & Kurulum Yapılandırması',
    buttonLabel: '⚙️ Kurulum & Yapılandırma Sayfasını Aç',
    pageTitle: 'Kurulum 1 · Hat & Kimlik Yapılandırması'
  };
};

export interface RemoteInterventionLogEntry {
  id: string;
  recordId: string;
  code: string;
  fullName: string;
  phone: string;
  actionType: RemoteInterventionActionType;
  actionTitle: string;
  resultMessage: string;
  timestamp: string;
}

export interface PersonIdentityRecord {
  id: string;
  rawEntityId: string;
  profileKey: string;
  entityType: 'ADMIN' | 'ILLER' | 'IL' | 'ILCE' | 'ESNAF';
  roleBadge: string;
  code: string;
  fullName: string;
  tcOrTaxNo: string;
  gender: string;
  birthYear: string;
  ageText: string;
  hometownProvince: string;
  hometownDistrict: string;
  hometownNeighborhood: string;
  hometownDisplay: string;
  profession: string;
  companyOrTitle: string;
  operatingRegion: string;
  businessAddress: string;
  phone: string;
  extraPhones: string[];
  email: string;
  statusLabel: string;
  isActive: boolean;
  isLicenseOrPackageHealthy: boolean;
  isSecretaryHealthy: boolean;
  isTransferHealthy: boolean;
  voiceLabel: string;
  uplineText: string;
  downlineSummary: string;
  licenseSummary: string;
  iban: string;
  createdAt: string;
}

interface AdminGlobalDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  dealers: Dealer[];
  subscribers: Subscriber[];
  setupProfiles: Record<string, any>;
  initialMode?: 'IDENTITY' | 'TECH_SUPPORT';
  initialQuery?: string;
  onExecuteRemoteIntervention?: (
    record: PersonIdentityRecord,
    action: RemoteInterventionActionType
  ) => { ok: boolean; title: string; detail: string };
  onOpenUserPanelPage?: (
    record: PersonIdentityRecord,
    target: AdminPanelPageTarget,
    pageTitle: string
  ) => void;
}

const TECH_LOGS_STORAGE_KEY = 'sb_remote_tech_logs_v1';

const computeAgeText = (birthYearRaw?: string): string => {
  if (!birthYearRaw) return '-';
  const yr = parseInt(birthYearRaw.trim(), 10);
  if (Number.isNaN(yr) || yr < 1920 || yr > 2026) return birthYearRaw;
  const currentYear = new Date().getFullYear();
  const age = Math.max(1, currentYear - yr);
  return `${yr} (${age} Yaş)`;
};

const buildHometownDisplay = (prov?: string, dist?: string, neigh?: string): string => {
  const parts = [prov, dist, neigh]
    .map((x) => (x || '').trim())
    .filter((x) => Boolean(x) && x !== '-');
  return parts.length > 0 ? parts.join(' / ') : 'Belirtilmedi';
};

export const AdminGlobalDirectoryModal: React.FC<AdminGlobalDirectoryModalProps> = ({
  isOpen,
  onClose,
  dealers,
  subscribers,
  setupProfiles,
  initialMode = 'IDENTITY',
  initialQuery = '',
  onExecuteRemoteIntervention,
  onOpenUserPanelPage
}) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCardTab, setActiveCardTab] = useState<'IDENTITY' | 'TECH_SUPPORT'>(initialMode);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<RemoteInterventionActionType | null>(null);
  const [completedActions, setCompletedActions] = useState<Record<string, boolean>>({});
  const [lastFeedback, setLastFeedback] = useState<{
    title: string;
    detail: string;
    recommendedTarget?: AdminPanelPageTarget;
    recommendedPageTitle?: string;
  } | null>(null);
  const [techLogs, setTechLogs] = useState<RemoteInterventionLogEntry[]>(() => {
    try {
      const raw = localStorage.getItem(TECH_LOGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const records = useMemo<PersonIdentityRecord[]>(() => {
    const list: PersonIdentityRecord[] = [];

    // 1. Genel Merkez Yönetici (TR.000)
    const adminProf = setupProfiles['admin'];
    if (adminProf) {
      const adminProfession =
        adminProf.isCustomProfession && adminProf.customProfessionVal?.trim()
          ? adminProf.customProfessionVal.trim()
          : adminProf.profession || 'Yazılım & Telekomünikasyon Yönetimi';
      const hProv = adminProf.birthProvince || 'Ardahan';
      const hDist = adminProf.birthDistrict || 'Damal';
      const hNeigh = adminProf.birthNeighborhood || '';

      list.push({
        id: 'admin-root',
        rawEntityId: 'admin',
        profileKey: 'admin',
        entityType: 'ADMIN',
        roleBadge: 'Genel Merkez Yönetici',
        code: 'TR.000',
        fullName: adminProf.fullName || 'Kenan Gürkan',
        tcOrTaxNo: adminProf.tcNo || '-',
        gender: adminProf.gender || 'Erkek',
        birthYear: adminProf.birthYear || '-',
        ageText: computeAgeText(adminProf.birthYear),
        hometownProvince: hProv,
        hometownDistrict: hDist,
        hometownNeighborhood: hNeigh,
        hometownDisplay: buildHometownDisplay(hProv, hDist, hNeigh),
        profession: adminProfession,
        companyOrTitle: adminProf.customerName || 'SantralBayi Genel Merkez',
        operatingRegion: 'Türkiye Geneli (81 İl)',
        businessAddress: adminProf.businessAddressConfig || 'Genel Merkez / İstanbul',
        phone: adminProf.customerPhone || '0537 603 16 45',
        extraPhones: Array.isArray(adminProf.extraPhones) ? adminProf.extraPhones.filter(Boolean) : [],
        email: adminProf.email || '-',
        statusLabel: 'Tam Yetkili Yönetici',
        isActive: true,
        isLicenseOrPackageHealthy: true,
        isSecretaryHealthy: adminProf.secretaryCallScreening !== false,
        isTransferHealthy: adminProf.warmTransferEnabled !== false,
        voiceLabel: adminProf.greetingTone === 'KURUMSAL' ? 'Kurumsal Türkçe · Senkron' : 'Özel Anons · Aktif',
        uplineText: 'En Üst Merkez Makamı',
        downlineSummary: `${dealers.filter((d) => !d.id.startsWith('vacant-') && !d.id.startsWith('dist-')).length} Bayi · ${subscribers.length} Abone`,
        licenseSummary: 'Sınırsız Merkez Lisansı',
        iban: adminProf.iban || '-',
        createdAt: 'Kurucu Kayıt'
      });
    }

    // 2. Gerçek kayıtlı bayiler (boş şablonlar hariç)
    const activeDealers = dealers.filter(
      (d) =>
        !d.id.startsWith('vacant-') &&
        !d.id.startsWith('dist-') &&
        (d.status as string) !== 'VACANT' &&
        Boolean(d.contactName && d.contactName.trim() && d.contactName !== 'Atama Yapılmadı')
    );

    activeDealers.forEach((d) => {
      const isIller =
        d.id === 'd-0' ||
        d.level === 'ILLER' ||
        d.province === 'Türkiye Geneli' ||
        (d.dealerCode?.startsWith('TR.') && d.dealerCode !== 'TR.000');
      const isIl =
        !isIller &&
        (d.level === 'IL' ||
          (d.licenseTier === 'MASTER_1000' && d.canIssueDealership !== false && !d.dealerCode?.includes('.ilç.')));

      const fallbackKey = isIller ? 'iller_bayi' : isIl ? 'il_bayi' : 'ilce_bayi';
      const isAnchorDealer = d.id === 'd-0' || d.id === 'd-1' || d.id === 'd-2';
      const resolvedProfileKey = setupProfiles[`dealer_${d.id}`]
        ? `dealer_${d.id}`
        : isAnchorDealer
        ? fallbackKey
        : `dealer_${d.id}`;
      const prof =
        setupProfiles[`dealer_${d.id}`] || (isAnchorDealer ? setupProfiles[fallbackKey] : undefined);

      const parentDealer = d.parentId ? dealers.find((p) => p.id === d.parentId) : undefined;
      const childDealersCount = activeDealers.filter((c) => c.parentId === d.id).length;
      const connectedSubsCount = isIl
        ? subscribers.filter((s) => {
            const subD = dealers.find((x) => x.id === s.dealerId);
            return subD?.id === d.id || subD?.parentId === d.id;
          }).length
        : subscribers.filter((s) => s.dealerId === d.id).length;

      const hProv = prof?.birthProvince || d.province || 'İstanbul';
      const hDist = prof?.birthDistrict || d.district || 'Merkez';
      const hNeigh = prof?.birthNeighborhood || d.neighborhood || '';

      const professionVal =
        prof?.isCustomProfession && prof?.customProfessionVal?.trim()
          ? prof.customProfessionVal.trim()
          : prof?.profession ||
            (isIller
              ? 'Üst Bölge & Bayi Koordinatörü'
              : isIl
              ? 'İl Bölge Bayisi & Girişimci'
              : 'İlçe Bayisi & Saha Yöneticisi');

      const cycleText = d.licenseBillingCycle === 'yearly' ? 'Yıllık Lisans' : 'Aylık Lisans';
      const isLicenseHealthy = d.status === 'ACTIVE' && d.isLicensePaid !== false;
      const paidText = d.isLicensePaid === false ? 'Yenileme Bekliyor' : 'Ödendi · Aktif';

      list.push({
        id: `dealer-${d.id}`,
        rawEntityId: d.id,
        profileKey: resolvedProfileKey,
        entityType: isIller ? 'ILLER' : isIl ? 'IL' : 'ILCE',
        roleBadge: isIller ? 'Türkiye İller Bayisi' : isIl ? 'İl Bayisi' : 'İlçe Bayisi',
        code: d.dealerCode || (isIller ? 'TR.001' : isIl ? '34.il.001' : '34.ilç.001'),
        fullName: (isAnchorDealer ? prof?.fullName : undefined) || d.contactName || prof?.fullName || d.name,
        tcOrTaxNo: d.taxNumber || prof?.tcNo || 'Belirtilmedi',
        gender: prof?.gender || 'Belirtilmedi',
        birthYear: prof?.birthYear || '-',
        ageText: computeAgeText(prof?.birthYear),
        hometownProvince: hProv,
        hometownDistrict: hDist,
        hometownNeighborhood: hNeigh,
        hometownDisplay: buildHometownDisplay(hProv, hDist, hNeigh),
        profession: professionVal,
        companyOrTitle:
          prof?.customerName ||
          d.officialTitle ||
          d.name ||
          (isIller ? 'Türkiye İller Koordinatörlüğü' : `${d.province} Bayiliği`),
        operatingRegion: isIller
          ? 'Türkiye Geneli (81 İl)'
          : `${d.province || '-'}${d.district ? ` / ${d.district}` : ''}`,
        businessAddress:
          prof?.businessAddressConfig ||
          `${d.district ? `${d.district} / ` : ''}${d.province || 'İstanbul'}`,
        phone: (isAnchorDealer ? prof?.customerPhone : undefined) || d.contactPhone || prof?.customerPhone || '-',
        extraPhones: Array.isArray(prof?.extraPhones) ? prof.extraPhones.filter(Boolean) : [],
        email: prof?.email || 'Belirtilmedi',
        statusLabel: d.status === 'ACTIVE' ? 'Aktif Yetkili' : 'Onay / Askıda',
        isActive: d.status === 'ACTIVE',
        isLicenseOrPackageHealthy: isLicenseHealthy,
        isSecretaryHealthy: d.status === 'ACTIVE' && prof?.secretaryCallScreening !== false,
        isTransferHealthy: prof?.warmTransferEnabled !== false,
        voiceLabel:
          prof?.greetingTone === 'KURUMSAL' || !prof?.greetingTone
            ? 'Kurumsal Türkçe · Senkron'
            : 'Özel Anons · Aktif',
        uplineText: isIller
          ? 'Genel Merkez Yönetici (TR.000)'
          : parentDealer
          ? `${parentDealer.contactName || parentDealer.name} (${parentDealer.dealerCode || 'TR.001'})`
          : 'Genel Merkez (TR.000)',
        downlineSummary: isIller
          ? `${activeDealers.filter((x) => x.id !== 'd-0' && x.level === 'IL').length} İl Bayisi · ${subscribers.length} Abone`
          : isIl
          ? `${childDealersCount} İlçe Bayisi · ${connectedSubsCount} Esnaf Abone`
          : `${connectedSubsCount || d.subscriberCount || 0} Esnaf Abone`,
        licenseSummary: `${cycleText} · ${paidText}`,
        iban: d.iban || prof?.iban || 'Belirtilmedi',
        createdAt: d.createdAt || '-'
      });
    });

    // 3. Gerçek kayıtlı esnaf aboneler
    subscribers.forEach((s) => {
      const parentDealer = s.dealerId ? dealers.find((d) => d.id === s.dealerId) : undefined;
      const isAnchorSub = s.id === 's-1';
      const resolvedProfileKey = setupProfiles[`subscriber_${s.id}`]
        ? `subscriber_${s.id}`
        : isAnchorSub
        ? 'esnaf'
        : `subscriber_${s.id}`;
      const prof =
        setupProfiles[`subscriber_${s.id}`] || (isAnchorSub ? setupProfiles['esnaf'] : undefined);
      const referredCount = subscribers.filter((r) => r.referredBySubscriberId === s.id).length;

      const hProv = s.birthProvince || prof?.birthProvince || parentDealer?.province || 'İstanbul';
      const hDist = s.birthDistrict || prof?.birthDistrict || parentDealer?.district || 'Kadıköy';
      const hNeigh = s.birthNeighborhood || prof?.birthNeighborhood || '';

      const professionVal =
        prof?.isCustomProfession && prof?.customProfessionVal?.trim()
          ? prof.customProfessionVal.trim()
          : prof?.profession || s.sector || 'Esnaf & İşletme Sahibi';

      const birthYr = s.birthYear || prof?.birthYear || '';
      const isSubHealthy = s.status === 'ACTIVE' && s.apkStatus !== 'PENDING_INSTALL';

      list.push({
        id: `sub-${s.id}`,
        rawEntityId: s.id,
        profileKey: resolvedProfileKey,
        entityType: 'ESNAF',
        roleBadge: 'Esnaf Abone',
        code: s.subscriberCode || '34.e.001',
        fullName:
          (isAnchorSub ? prof?.fullName : undefined) ||
          s.fullName ||
          prof?.fullName ||
          s.name ||
          'İşletme Yetkilisi',
        tcOrTaxNo: s.tcNo || s.taxNumber || prof?.tcNo || 'Belirtilmedi',
        gender: s.gender || prof?.gender || 'Belirtilmedi',
        birthYear: birthYr || '-',
        ageText: computeAgeText(birthYr),
        hometownProvince: hProv,
        hometownDistrict: hDist,
        hometownNeighborhood: hNeigh,
        hometownDisplay: buildHometownDisplay(hProv, hDist, hNeigh),
        profession: professionVal,
        companyOrTitle:
          (isAnchorSub ? prof?.customerName : undefined) ||
          s.companyName ||
          prof?.customerName ||
          s.name ||
          'Esnaf İşletmesi',
        operatingRegion: `${parentDealer?.province || hProv}${parentDealer?.district ? ` / ${parentDealer.district}` : ''}`,
        businessAddress:
          prof?.businessAddressConfig ||
          `${hNeigh ? `${hNeigh} Mah. ` : ''}${hDist} / ${hProv}`,
        phone:
          (isAnchorSub ? prof?.customerPhone : undefined) ||
          s.phone ||
          s.contactPhone ||
          prof?.customerPhone ||
          '-',
        extraPhones:
          s.extraContactPhones && s.extraContactPhones.length > 0
            ? s.extraContactPhones
            : Array.isArray(prof?.extraPhones)
            ? prof.extraPhones.filter(Boolean)
            : [],
        email: s.email || prof?.email || 'Belirtilmedi',
        statusLabel: s.status === 'ACTIVE' ? 'Aktif Abone' : 'Demo / Beklemede',
        isActive: s.status === 'ACTIVE',
        isLicenseOrPackageHealthy: isSubHealthy,
        isSecretaryHealthy: isSubHealthy && prof?.secretaryCallScreening !== false,
        isTransferHealthy: prof?.warmTransferEnabled !== false,
        voiceLabel:
          prof?.greetingTone === 'KURUMSAL' || !prof?.greetingTone
            ? 'Kurumsal Türkçe · Senkron'
            : 'Özel Anons · Aktif',
        uplineText: s.referredBySubscriberName
          ? `Tavsiye: ${s.referredBySubscriberName} · Bayi: ${parentDealer?.dealerCode || '-'}`
          : parentDealer
          ? `${parentDealer.contactName || parentDealer.name} (${parentDealer.dealerCode || '-'})`
          : 'Merkez Havuzu (TR.000)',
        downlineSummary: `${referredCount} Tavsiye Edilen Esnaf`,
        licenseSummary: `${s.plan} Sabit Paket${s.monthlyPrice ? ` · ₺${s.monthlyPrice.toLocaleString('tr-TR')}/Ay` : ''}`,
        iban: (s as any).iban || prof?.iban || 'Belirtilmedi',
        createdAt: s.createdAt || '-'
      });
    });

    return list;
  }, [dealers, subscribers, setupProfiles]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveCardTab(initialMode);
    setLastFeedback(null);
    setCompletedActions({});
    if (initialQuery && initialQuery.trim()) {
      const q = initialQuery.trim();
      setQuery(q);
      const norm = q.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
      const digits = q.replace(/\D/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      const found = records.find((rec) => {
        if (rec.code.toLocaleLowerCase('tr-TR') === norm) return true;
        if (last10.length >= 7 && rec.phone.replace(/\D/g, '').includes(last10)) return true;
        return rec.fullName.toLocaleLowerCase('tr-TR').replace(/\s+/g, '').includes(norm);
      });
      if (found) {
        setSelectedId(found.id);
      }
    }
  }, [isOpen, initialMode, initialQuery]);

  const trimmedQuery = query.trim();

  const matchedRecords = useMemo(() => {
    if (!trimmedQuery) return [];
    const normalizedText = trimmedQuery.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
    const queryDigits = trimmedQuery.replace(/\D/g, '');
    const last10QueryDigits = queryDigits.length >= 10 ? queryDigits.slice(-10) : queryDigits;

    return records.filter((rec) => {
      const textHaystack = [
        rec.fullName,
        rec.phone,
        ...rec.extraPhones,
        rec.code,
        rec.tcOrTaxNo,
        rec.hometownDisplay,
        rec.profession,
        rec.companyOrTitle,
        rec.operatingRegion
      ]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .replace(/\s+/g, '');

      if (textHaystack.includes(normalizedText)) return true;

      if (last10QueryDigits.length >= 3) {
        const phoneDigits = rec.phone.replace(/\D/g, '');
        const tcDigits = rec.tcOrTaxNo.replace(/\D/g, '');
        if (phoneDigits.includes(last10QueryDigits) || tcDigits.includes(last10QueryDigits)) {
          return true;
        }
      }

      return false;
    });
  }, [records, trimmedQuery]);

  const attentionRecords = useMemo(
    () =>
      records.filter(
        (r) =>
          r.entityType !== 'ADMIN' &&
          (!r.isActive || !r.isLicenseOrPackageHealthy || !r.isSecretaryHealthy)
      ),
    [records]
  );

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) || null,
    [records, selectedId]
  );

  const selectedPersonLogs = useMemo(() => {
    if (!selectedRecord) return [];
    return techLogs.filter(
      (l) => l.recordId === selectedRecord.id || l.code === selectedRecord.code
    );
  }, [techLogs, selectedRecord]);

  if (!isOpen) return null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedQuery) return;
    if (matchedRecords.length === 1) {
      setSelectedId(matchedRecords[0].id);
      setLastFeedback(null);
      setCompletedActions({});
    } else {
      setSelectedId(null);
    }
  };

  const handleCopy = (key: string, text: string) => {
    if (!text || text === '-' || text === 'Belirtilmedi') return;
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {}
  };

  const actionToTargetPageMap: Record<
    RemoteInterventionActionType,
    { target: AdminPanelPageTarget; pageTitle: string }
  > = {
    WAKE_SECRETARY: { target: 'PERMISSIONS', pageTitle: 'Yetki, İzin & Sekreter Ayarları' },
    RESET_VOICE: { target: 'SETUP_STEP_3', pageTitle: 'Kurulum 3 · Ses Tonu & Hitap Ayarı' },
    RESET_SESSION_LOCK: { target: 'PROFILE_SETTINGS', pageTitle: 'Profil & Telefon Ayarları' },
    RESET_WARM_TRANSFER: { target: 'SETUP_STEP_2', pageTitle: 'Kurulum 2 · Gelen Arama & Aktarma' },
    SYNC_LICENSE_PACKAGE: { target: 'LICENSE', pageTitle: 'Abonelik & Lisans Yönetimi' },
    FORCE_OTA_REFRESH: { target: 'PANEL_HOME', pageTitle: 'Kullanıcı Ana Paneli' },
    FULL_REPAIR: { target: 'SETUP_STEP_1', pageTitle: 'Kurulum & Hat Yapılandırması' }
  };

  const triggerIntervention = (action: RemoteInterventionActionType) => {
    if (!selectedRecord || runningAction) return;
    setRunningAction(action);

    setTimeout(() => {
      const res = onExecuteRemoteIntervention
        ? onExecuteRemoteIntervention(selectedRecord, action)
        : {
            ok: true,
            title: 'Uzaktan Müdahale Uygulandı',
            detail: `${selectedRecord.fullName} (${selectedRecord.code}) hattı başarıyla sıfırlandı ve güncellendi.`
          };

      const nowStr = new Date().toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      const entry: RemoteInterventionLogEntry = {
        id: `tech-${Date.now()}`,
        recordId: selectedRecord.id,
        code: selectedRecord.code,
        fullName: selectedRecord.fullName,
        phone: selectedRecord.phone,
        actionType: action,
        actionTitle: res.title,
        resultMessage: res.detail,
        timestamp: nowStr
      };

      setTechLogs((prev) => {
        const next = [entry, ...prev].slice(0, 40);
        try {
          localStorage.setItem(TECH_LOGS_STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });

      if (action === 'FULL_REPAIR') {
        setCompletedActions({
          FULL_REPAIR: true,
          WAKE_SECRETARY: true,
          RESET_VOICE: true,
          RESET_SESSION_LOCK: true,
          RESET_WARM_TRANSFER: true,
          SYNC_LICENSE_PACKAGE: true,
          FORCE_OTA_REFRESH: true
        });
      } else {
        setCompletedActions((prev) => ({ ...prev, [action]: true }));
      }

      const mapped = actionToTargetPageMap[action];
      setLastFeedback({
        title: res.title,
        detail: res.detail,
        recommendedTarget: mapped.target,
        recommendedPageTitle: mapped.pageTitle
      });
      setRunningAction(null);
    }, 260);
  };

  const isTechMode = activeCardTab === 'TECH_SUPPORT';

  const interventionItems: {
    id: RemoteInterventionActionType;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    accent: string;
  }[] = [
    {
      id: 'WAKE_SECRETARY',
      title: '1. Sekreter & Pil Servisini Uyandır',
      subtitle: 'Arka plan uyku kilidini açar, GSM çağrı karşılamayı yeniden başlatır',
      icon: <Activity className="w-4 h-4 text-emerald-400" />,
      accent: 'hover:border-emerald-500/60'
    },
    {
      id: 'RESET_VOICE',
      title: '2. Ses & Karşılama Anonsunu Sıfırla',
      subtitle: 'Takılan ses önbelleğini temizler, merkezi kurumsal sesi senkronlar',
      icon: <Volume2 className="w-4 h-4 text-sky-400" />,
      accent: 'hover:border-sky-500/60'
    },
    {
      id: 'RESET_SESSION_LOCK',
      title: '3. Oturum & Cihaz Kilidini Aç',
      subtitle: 'Telefon değişimi veya takılı kalan SMS / tek cihaz kilidini sıfırlar',
      icon: <KeyRound className="w-4 h-4 text-amber-400" />,
      accent: 'hover:border-amber-500/60'
    },
    {
      id: 'RESET_WARM_TRANSFER',
      title: '4. Hat Köprüsü & Aktarmayı Temizle',
      subtitle: 'Meşgulde kalan çağrı kuyruğunu ve rehber aktarma köprüsünü sıfırlar',
      icon: <PhoneForwarded className="w-4 h-4 text-cyan-400" />,
      accent: 'hover:border-cyan-500/60'
    },
    {
      id: 'SYNC_LICENSE_PACKAGE',
      title: '5. Lisans, Paket & Hakediş Senkronla',
      subtitle: 'Askıdaki paketi veya bayi lisansını doğrular ve anında aktif eder',
      icon: <CreditCard className="w-4 h-4 text-violet-400" />,
      accent: 'hover:border-violet-500/60'
    },
    {
      id: 'FORCE_OTA_REFRESH',
      title: '6. Zorunlu Canlı Güncelleme (OTA)',
      subtitle: 'Uygulamayı silmeden son canlı paketi cihaza uzaktan çektirir',
      icon: <Smartphone className="w-4 h-4 text-indigo-400" />,
      accent: 'hover:border-indigo-500/60'
    }
  ];

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-left">
        {/* Üst Başlık */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {selectedRecord ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setLastFeedback(null);
                  setCompletedActions({});
                }}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-200 shrink-0 cursor-pointer"
                title="Arama Sonuçlarına Dön"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            ) : (
              <div
                className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${
                  isTechMode
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    : 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                }`}
              >
                {isTechMode ? <Wrench className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                {selectedRecord
                  ? isTechMode
                    ? 'Uzaktan Hat & Arıza Müdahale'
                    : 'Kişi & Kimlik Bilgi Kartı'
                  : isTechMode
                  ? 'Müşteri Hizmetleri · Hat Müdahale'
                  : 'Kimlik & Kişi Sorgulama'}
              </h3>
              <p className="text-[10px] text-slate-400 truncate font-mono tabular-nums">
                {selectedRecord
                  ? `${selectedRecord.code} · ${selectedRecord.roleBadge}`
                  : isTechMode
                  ? 'Abone / Bayi Hattına Uzaktan Tanı & Sayfa Açma'
                  : 'İsim veya Telefon Numarası ile Kimlik Sorgu'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setQuery('');
              setLastFeedback(null);
              setCompletedActions({});
              onClose();
            }}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-rose-950/70 border border-slate-700 hover:border-rose-500/60 flex items-center justify-center text-slate-300 hover:text-rose-300 transition-colors shrink-0 cursor-pointer"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sabit Arama Formu (İsim veya Numara Girip Sorgulama) */}
        <form
          onSubmit={handleSearchSubmit}
          className="p-3 bg-slate-900 border-b border-slate-800/90 flex items-center gap-2 shrink-0"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-sky-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selectedId) {
                  setSelectedId(null);
                  setLastFeedback(null);
                }
              }}
              placeholder="İsim, telefon veya kod (34.e.001) girin..."
              className="w-full bg-slate-950 border border-slate-700 focus:border-sky-400 rounded-xl pl-9 pr-8 py-2.5 text-xs text-white outline-none placeholder:text-slate-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSelectedId(null);
                  setLastFeedback(null);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 cursor-pointer"
                title="Temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            className={`px-3.5 py-2.5 rounded-xl font-black text-xs shrink-0 cursor-pointer transition-colors ${
              isTechMode
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
            }`}
          >
            Sorgula
          </button>
        </form>

        {/* İÇERİK ALANI */}
        {selectedRecord ? (
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
            {/* Üst Özet Başlık + Kimlik / Teknik Müdahale Sekme Geçişi */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-300 font-black text-sm shrink-0">
                    {selectedRecord.fullName.charAt(0).toLocaleUpperCase('tr-TR')}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-black text-white truncate">
                      {selectedRecord.fullName}
                    </h4>
                    <p className="text-[11px] text-sky-400 font-semibold truncate">
                      {selectedRecord.roleBadge} · {selectedRecord.companyOrTitle}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-mono tabular-nums font-black text-amber-300 shrink-0">
                  {selectedRecord.code}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-mono tabular-nums">{selectedRecord.phone}</span>
                <span
                  className={`font-bold ${
                    selectedRecord.isActive && selectedRecord.isLicenseOrPackageHealthy
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {selectedRecord.statusLabel}
                </span>
              </div>

              {/* Sekme Anahtarı: Kimlik Kartı | Uzaktan Hat Müdahale */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setActiveCardTab('IDENTITY')}
                  className={`py-2 px-2.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                    activeCardTab === 'IDENTITY'
                      ? 'bg-sky-500 border-sky-400 text-slate-950 shadow-sm'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span>Kimlik Kartı</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCardTab('TECH_SUPPORT')}
                  className={`py-2 px-2.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                    activeCardTab === 'TECH_SUPPORT'
                      ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-sm'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span>Hat & Arıza Müdahale</span>
                </button>
              </div>
            </div>

            {activeCardTab === 'IDENTITY' ? (
              <>
                {/* 1. KİMLİK BİLGİLERİ */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800 flex items-center gap-1.5 text-[11px] font-bold text-sky-300">
                    <User className="w-3.5 h-3.5" />
                    <span>Kimlik Bilgileri</span>
                  </div>
                  <div className="divide-y divide-slate-800/80">
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ad Soyad</span>
                      <span className="font-bold text-white text-right">{selectedRecord.fullName}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400">TC Kimlik / Vergi No</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-200">
                        {selectedRecord.tcOrTaxNo}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Doğum Yılı & Yaşı</span>
                      <span className="font-mono tabular-nums text-slate-200">{selectedRecord.ageText}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Cinsiyet</span>
                      <span className="font-semibold text-slate-200">{selectedRecord.gender}</span>
                    </div>
                  </div>
                </div>

                {/* 2. NERELİ & BÖLGE BİLGİLERİ */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800 flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Nereli & Bölge Bilgisi</span>
                  </div>
                  <div className="divide-y divide-slate-800/80">
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">Nereli (Memleket)</span>
                      <span className="font-bold text-emerald-300 text-right">
                        {selectedRecord.hometownDisplay}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">Faaliyet Bölgesi</span>
                      <span className="font-semibold text-slate-200 text-right">
                        {selectedRecord.operatingRegion}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                      <span className="text-slate-400 shrink-0">Açık Adres / Konum</span>
                      <span className="text-slate-200 text-right break-words">
                        {selectedRecord.businessAddress}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. NE İŞ YAPIYOR (MESLEK & İŞLETME) */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800 flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                    <Briefcase className="w-3.5 h-3.5" />
                    <span>Ne İş Yapıyor (Meslek & Kurum)</span>
                  </div>
                  <div className="divide-y divide-slate-800/80">
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">Mesleği / İşi</span>
                      <span className="font-bold text-amber-300 text-right">
                        {selectedRecord.profession}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">Firma / İşletme Unvanı</span>
                      <span className="font-semibold text-white text-right break-words">
                        {selectedRecord.companyOrTitle}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">Sistemdeki Görevi</span>
                      <span className="font-semibold text-sky-300 text-right">
                        {selectedRecord.roleBadge} ({selectedRecord.code})
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. İLETİŞİM & SİSTEM DETAYLARI (ARAMA TUŞU YOK, METİN + KOPYALA) */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl divide-y divide-slate-800/80">
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400">GSM Telefon</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums font-bold text-white">
                        {selectedRecord.phone}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy('phone', selectedRecord.phone)}
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'phone' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Kopyalandı</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Kopyala</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {selectedRecord.extraPhones.length > 0 && (
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ek Numaralar</span>
                      <span className="font-mono tabular-nums text-slate-200 text-right">
                        {selectedRecord.extraPhones.join(', ')}
                      </span>
                    </div>
                  )}

                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400">E-Posta</span>
                    <span className="text-slate-200 truncate">{selectedRecord.email}</span>
                  </div>

                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400 shrink-0">Bağlı Olduğu Üst</span>
                    <span className="font-semibold text-cyan-300 text-right truncate">
                      {selectedRecord.uplineText}
                    </span>
                  </div>

                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400 shrink-0">Alt Ağ Özeti</span>
                    <span className="font-mono tabular-nums text-slate-200 text-right">
                      {selectedRecord.downlineSummary}
                    </span>
                  </div>

                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400 shrink-0">Lisans / Paket</span>
                    <span className="font-semibold text-slate-200 text-right">
                      {selectedRecord.licenseSummary}
                    </span>
                  </div>

                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400">Kayıt Tarihi</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {selectedRecord.createdAt}
                    </span>
                  </div>

                  <div className="px-3.5 py-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Kayıtlı IBAN</span>
                      {selectedRecord.iban &&
                        selectedRecord.iban !== 'Belirtilmedi' &&
                        selectedRecord.iban !== '-' && (
                          <button
                            type="button"
                            onClick={() => handleCopy('iban', selectedRecord.iban)}
                            className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                          >
                            {copiedKey === 'iban' ? '✓ Kopyalandı' : 'IBAN Kopyala'}
                          </button>
                        )}
                    </div>
                    <p className="font-mono tabular-nums text-[11px] text-slate-200 break-all">
                      {selectedRecord.iban}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              /* UZAKTAN HAT & ARIZA MÜDAHALE PANELİ + İLGİLİ SAYFAYI AÇMA */
              <>
                {lastFeedback && (
                  <div className="bg-emerald-950/70 border border-emerald-500/60 rounded-2xl p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-emerald-300 font-extrabold text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{lastFeedback.title}</span>
                    </div>
                    <p className="text-[11px] text-emerald-100 leading-relaxed">
                      {lastFeedback.detail}
                    </p>
                    {onOpenUserPanelPage && lastFeedback.recommendedTarget && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenUserPanelPage(
                            selectedRecord,
                            lastFeedback.recommendedTarget!,
                            lastFeedback.recommendedPageTitle || 'İlgili Sayfa'
                          )
                        }
                        className="w-full py-2 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {selectedRecord.code} · {lastFeedback.recommendedPageTitle} Sayfasını Aç & Düzelt
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {/* MANUEL DÜZELTME İÇİN KİŞİNİN PANEL SAYFASINI AÇMA KUTUSU */}
                {onOpenUserPanelPage && (
                  <div className="bg-slate-950 border border-sky-500/40 rounded-2xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold text-sky-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 shrink-0" />
                        <span>Panelin İlgili Sayfasını Aç & Manuel Düzelt</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ADMIN_QUICK_PAGE_OPTIONS.map((opt) => (
                        <button
                          key={opt.target}
                          type="button"
                          onClick={() =>
                            onOpenUserPanelPage(selectedRecord, opt.target, opt.pageTitle)
                          }
                          className="py-2 px-2.5 rounded-xl bg-slate-900 hover:bg-sky-500/20 border border-slate-700 hover:border-sky-400 text-left text-[10.5px] font-bold text-slate-100 hover:text-white flex items-center justify-between gap-1 cursor-pointer transition-colors"
                        >
                          <span className="truncate">{opt.shortLabel}</span>
                          <ExternalLink className="w-3 h-3 text-sky-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Canlı Hat & Cihaz Tanı Özeti */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      <span>Canlı Hat & Cihaz Durum Tanısı</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">GSM Hattı</span>
                  </div>
                  <div className="divide-y divide-slate-800/80 text-[11px]">
                    <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Sekreter & Arka Plan</span>
                      <span
                        className={`font-bold ${
                          selectedRecord.isSecretaryHealthy || completedActions['WAKE_SECRETARY']
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {selectedRecord.isSecretaryHealthy || completedActions['WAKE_SECRETARY']
                          ? '● Çevrimiçi · Aktif'
                          : '▲ Uyku / Askıda'}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ses & Karşılama</span>
                      <span className="font-semibold text-sky-300">
                        {completedActions['RESET_VOICE']
                          ? '✓ Sıfırlandı · Kurumsal Ses'
                          : selectedRecord.voiceLabel}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Aktarma Köprüsü</span>
                      <span className="font-semibold text-emerald-300">
                        {completedActions['RESET_WARM_TRANSFER']
                          ? '✓ Kuyruk Temiz · Açık'
                          : selectedRecord.isTransferHealthy
                          ? 'Ön Görüşmeli Açık'
                          : 'Pasif / Kapalı'}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                      <span className="text-slate-400">Lisans / Paket</span>
                      <span
                        className={`font-bold text-right ${
                          selectedRecord.isLicenseOrPackageHealthy ||
                          completedActions['SYNC_LICENSE_PACKAGE']
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {completedActions['SYNC_LICENSE_PACKAGE']
                          ? '✓ Aktif & Senkronize'
                          : selectedRecord.licenseSummary}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tek Tıkla Tam Hat Onarımı */}
                <button
                  type="button"
                  disabled={Boolean(runningAction)}
                  onClick={() => triggerIntervention('FULL_REPAIR')}
                  className="w-full py-3 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-[0.99]"
                >
                  {runningAction === 'FULL_REPAIR' ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      <span>Hat & Servisler Uzaktan Onarılıyor...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 shrink-0" />
                      <span>Tüm Hattı Tek Tıkla Onar (Tam Reset)</span>
                    </>
                  )}
                </button>

                {/* 6 Tekil Müşteri Hizmetleri Müdahale Butonu */}
                <div className="space-y-2">
                  <p className="text-[10.5px] font-bold text-slate-400 px-1">
                    Tekil Arıza Müdahale Komutları:
                  </p>
                  {interventionItems.map((item) => {
                    const isDone = Boolean(completedActions[item.id]);
                    const isBusy = runningAction === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={Boolean(runningAction)}
                        onClick={() => triggerIntervention(item.id)}
                        className={`w-full text-left bg-slate-950 border border-slate-800 ${item.accent} rounded-2xl p-3 flex items-center justify-between gap-3 transition-all cursor-pointer active:scale-[0.99]`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                            {isBusy ? (
                              <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                            ) : (
                              item.icon
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{item.title}</p>
                            <p className="text-[10.5px] text-slate-400 leading-snug mt-0.5">
                              {item.subtitle}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold shrink-0 border ${
                            isDone
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-slate-900 border-slate-700 text-sky-300'
                          }`}
                        >
                          {isDone ? '✓ Onarıldı' : 'Uygula'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Kişiye Ait Son Müdahale Kayıtları */}
                {selectedPersonLogs.length > 0 && (
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800 text-[11px] font-bold text-slate-300">
                      Son Uzaktan Müdahale Kayıtları ({selectedPersonLogs.length})
                    </div>
                    <div className="divide-y divide-slate-800/80">
                      {selectedPersonLogs.slice(0, 5).map((log) => {
                        const mapped = actionToTargetPageMap[log.actionType];
                        return (
                          <div key={log.id} className="px-3.5 py-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-[10.5px]">
                              <span className="font-bold text-emerald-300 truncate">
                                ✓ {log.actionTitle}
                              </span>
                              <span className="font-mono tabular-nums text-slate-400 shrink-0">
                                {log.timestamp}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-snug">
                              {log.resultMessage}
                            </p>
                            {onOpenUserPanelPage && mapped && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenUserPanelPage(
                                    selectedRecord,
                                    mapped.target,
                                    mapped.pageTitle
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-sky-500/20 border border-slate-700 hover:border-sky-400 text-[10px] font-bold text-sky-300 cursor-pointer"
                              >
                                <Settings className="w-3 h-3" />
                                <span>{mapped.pageTitle} Sayfasını Aç →</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : !trimmedQuery ? (
          isTechMode ? (
            /* UZAKTAN MÜDAHALE EKRANI AÇILIŞ ÖZETİ (ASKIDAKİ HATLAR + SON İŞLEMLER) */
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
              <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-3.5 space-y-1.5">
                <p className="text-xs font-extrabold text-emerald-300 flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 shrink-0" />
                  <span>Müşteri Hizmetleri Uzaktan Hat & Sayfa Müdahalesi</span>
                </p>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Arıza bildiren abone veya bayinin <strong>adını, telefonunu veya kodunu</strong>{' '}
                  sorgulayın; uzaktan onarın veya doğrudan <strong>ilgili kurulum / ayar sayfasını</strong>{' '}
                  açıp düzeltin.
                </p>
              </div>

              {attentionRecords.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10.5px] font-bold text-amber-300 px-1 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Kontrol / Müdahale Bekleyen Hatlar ({attentionRecords.length})</span>
                  </p>
                  {attentionRecords.slice(0, 6).map((rec) => (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(rec.id);
                        setActiveCardTab('TECH_SUPPORT');
                        setLastFeedback(null);
                        setCompletedActions({});
                      }}
                      className="w-full text-left bg-slate-950 hover:bg-slate-900 border border-amber-500/40 hover:border-emerald-400 rounded-2xl p-3 space-y-1 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-white truncate">
                          {rec.fullName}
                        </span>
                        <span className="text-[10.5px] font-mono tabular-nums font-bold text-amber-300 shrink-0">
                          {rec.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="text-slate-300 truncate">
                          {rec.roleBadge} · {rec.phone}
                        </span>
                        <span className="text-amber-300 font-bold shrink-0">
                          Müdahale & Sayfa Aç →
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {techLogs.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800 text-[11px] font-bold text-slate-300">
                    Son Yapılan Teknik Müdahaleler
                  </div>
                  <div className="divide-y divide-slate-800/80">
                    {techLogs.slice(0, 4).map((log) => (
                      <button
                        key={log.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(log.recordId);
                          setActiveCardTab('TECH_SUPPORT');
                        }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-slate-900/60 transition-colors cursor-pointer space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-[10.5px]">
                          <span className="font-bold text-white truncate">
                            {log.fullName} ({log.code})
                          </span>
                          <span className="font-mono tabular-nums text-slate-400 shrink-0">
                            {log.timestamp}
                          </span>
                        </div>
                        <p className="text-[10.5px] text-emerald-300 truncate">
                          ✓ {log.actionTitle}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* HENÜZ ARAMA YAPILMADAN ÖNCEKİ SADE SORGULAMA EKRANI */
            <div className="p-6 text-center space-y-2.5">
              <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-sky-400 mx-auto">
                <Search className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-200">
                İsim Soyisim veya Telefon Numarası Giriniz
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Yukarıdaki kutuya aradığınız kişinin adını, cep telefonu numarasını veya sabit
                kodunu yazıp <span className="text-sky-300 font-semibold">Sorgula</span> butonuna
                bastığınızda kimlik bilgileri, nereli olduğu, ne iş yaptığı ve uzaktan hat müdahale
                kartı ekrana gelir.
              </p>
            </div>
          )
        ) : (
          /* EŞLEŞEN KİŞİLER LİSTESİ */
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
            {matchedRecords.length === 0 ? (
              <div className="text-center py-8 px-4 text-xs text-slate-400 bg-slate-950/60 rounded-2xl border border-slate-800">
                “<span className="text-white font-semibold">{trimmedQuery}</span>” ile eşleşen kişi
                veya numara bulunamadı.
              </div>
            ) : (
              <>
                <p className="text-[10.5px] text-slate-400 px-1 font-mono tabular-nums">
                  {matchedRecords.length} eşleşen kayıt bulundu —{' '}
                  {isTechMode ? 'hat müdahalesi için dokunun:' : 'kimlik kartı için dokunun:'}
                </p>
                {matchedRecords.map((rec) => (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(rec.id);
                      setLastFeedback(null);
                      setCompletedActions({});
                    }}
                    className={`w-full text-left bg-slate-950 hover:bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1.5 cursor-pointer transition-colors ${
                      isTechMode ? 'hover:border-emerald-500/60' : 'hover:border-sky-500/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-white truncate">{rec.fullName}</span>
                      <span className="text-[10.5px] font-mono tabular-nums font-bold text-amber-300 shrink-0">
                        {rec.code}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      <span className="text-emerald-300 font-semibold">
                        Memleket: {rec.hometownDisplay}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-amber-300 font-semibold truncate">
                        İşi: {rec.profession}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-400 pt-0.5">
                      <span className="truncate">
                        {rec.roleBadge} · {rec.companyOrTitle}
                      </span>
                      <span className="font-mono tabular-nums text-slate-200 shrink-0">
                        {rec.phone}
                      </span>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

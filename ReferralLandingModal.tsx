import React, { useMemo, useState } from 'react';
import { Building2, CheckCircle2, ShieldCheck, Store, X } from 'lucide-react';
import { Dealer, DealerApplication, DealerLicenseTier, Subscriber } from './types';
import { TURKEY_GEOGRAPHY, generateDottedCode } from './data';

interface ReferralLandingModalProps {
  refCode: string;
  dealers: Dealer[];
  subscribers: Subscriber[];
  onClose: () => void;
  onRegisterSubscriber: (params: {
    newSubscriber: Subscriber;
    updatedDealers: Dealer[];
    updatedRefSubscriberId?: string;
    attributionSummary: string;
    referrerLabel: string;
  }) => void;
  onSubmitDealerApplication: (params: {
    application: DealerApplication;
    attributionSummary: string;
    referrerLabel: string;
  }) => void;
}

export const ReferralLandingModal: React.FC<ReferralLandingModalProps> = ({
  refCode,
  dealers,
  subscribers,
  onClose,
  onRegisterSubscriber,
  onSubmitDealerApplication,
}) => {
  const normalizedRef = (refCode || 'TR.000').trim();

  // Broşürü dağıtan yetkilinin kimliğini bul
  const referrerInfo = useMemo(() => {
    const cleanLower = normalizedRef.toLocaleLowerCase('tr-TR');

    if (cleanLower === 'tr.000') {
      return {
        kind: 'ADMIN' as const,
        code: 'TR.000',
        id: 'ADMIN_HQ',
        title: 'SantralBayi Genel Merkez Yönetim',
        personName: 'Genel Merkez',
        province: 'İstanbul',
        district: 'Merkez',
      };
    }

    const matchedDealer = dealers.find(
      (d) => (d.dealerCode || '').trim().toLocaleLowerCase('tr-TR') === cleanLower
    );
    if (matchedDealer) {
      const isIller = matchedDealer.level === 'ILLER' || cleanLower.startsWith('tr.');
      const isIl =
        !isIller &&
        (matchedDealer.level === 'IL' || matchedDealer.licenseTier === 'MASTER_1000');
      return {
        kind: isIller ? ('ILLER_BAYI' as const) : isIl ? ('IL_BAYI' as const) : ('ILCE_BAYI' as const),
        code: matchedDealer.dealerCode || normalizedRef,
        id: matchedDealer.id,
        title: matchedDealer.officialTitle || matchedDealer.name,
        personName: matchedDealer.contactName || matchedDealer.name,
        province: matchedDealer.province || 'İstanbul',
        district: matchedDealer.district || '',
        dealer: matchedDealer,
      };
    }

    const matchedSub = subscribers.find(
      (s) => (s.subscriberCode || '').trim().toLocaleLowerCase('tr-TR') === cleanLower
    );
    if (matchedSub) {
      return {
        kind: 'ESNAF_ABONE' as const,
        code: matchedSub.subscriberCode || normalizedRef,
        id: matchedSub.id,
        title: matchedSub.companyName || matchedSub.name,
        personName: matchedSub.name,
        province: matchedSub.birthProvince || 'İstanbul',
        district: matchedSub.birthDistrict || 'Kadıköy',
        subscriber: matchedSub,
      };
    }

    return {
      kind: 'CUSTOM_REF' as const,
      code: normalizedRef,
      id: 'ADMIN_HQ',
      title: `Yetkili Davet Kodu (${normalizedRef})`,
      personName: 'Yetkili Temsilci',
      province: 'İstanbul',
      district: '',
    };
  }, [normalizedRef, dealers, subscribers]);

  const provinces = useMemo(() => Object.keys(TURKEY_GEOGRAPHY), []);
  const defaultProv = provinces.includes(referrerInfo.province)
    ? referrerInfo.province
    : 'İstanbul';

  const [mode, setMode] = useState<'CHOOSE' | 'ESNAF_FORM' | 'BAYI_FORM' | 'SUCCESS'>('CHOOSE');
  const [successMessage, setSuccessMessage] = useState<{
    headline: string;
    detail: string;
    assignedCode?: string;
    phone?: string;
  } | null>(null);

  // Esnaf Başvuru Form State
  const [esnafFullName, setEsnafFullName] = useState('');
  const [esnafCompany, setEsnafCompany] = useState('');
  const [esnafSector, setEsnafSector] = useState('Esnaf / İşletme');
  const [esnafPhone, setEsnafPhone] = useState('');
  const [esnafProvince, setEsnafProvince] = useState(defaultProv);
  const esnafDistricts = useMemo(
    () => Object.keys(TURKEY_GEOGRAPHY[esnafProvince] || { Merkez: [] }),
    [esnafProvince]
  );
  const [esnafDistrict, setEsnafDistrict] = useState(
    referrerInfo.district && (TURKEY_GEOGRAPHY[defaultProv] || {})[referrerInfo.district]
      ? referrerInfo.district
      : Object.keys(TURKEY_GEOGRAPHY[defaultProv] || { Kadıköy: [] })[0] || 'Merkez'
  );

  // Bayilik Başvuru Form State
  const [bayiFullName, setBayiFullName] = useState('');
  const [bayiCompany, setBayiCompany] = useState('');
  const [bayiPhone, setBayiPhone] = useState('');
  const [bayiTier, setBayiTier] = useState<DealerLicenseTier>('STANDARD_500');
  const [bayiProvince, setBayiProvince] = useState(defaultProv);
  const bayiDistricts = useMemo(
    () => Object.keys(TURKEY_GEOGRAPHY[bayiProvince] || { Merkez: [] }),
    [bayiProvince]
  );
  const [bayiDistrict, setBayiDistrict] = useState(
    Object.keys(TURKEY_GEOGRAPHY[defaultProv] || { Kadıköy: [] })[0] || 'Merkez'
  );
  const [bayiNotes, setBayiNotes] = useState('');
  const [formError, setFormError] = useState('');

  const handleProvinceChange = (nextProv: string, target: 'ESNAF' | 'BAYI') => {
    const firstDist = Object.keys(TURKEY_GEOGRAPHY[nextProv] || { Merkez: [] })[0] || 'Merkez';
    if (target === 'ESNAF') {
      setEsnafProvince(nextProv);
      setEsnafDistrict(firstDist);
    } else {
      setBayiProvince(nextProv);
      setBayiDistrict(firstDist);
    }
  };

  const handleEsnafSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const digits = esnafPhone.replace(/\D/g, '');
    if (!esnafFullName.trim() || !esnafCompany.trim() || digits.length < 10) {
      setFormError('Lütfen Ad Soyad, İşletme Adı ve 10-11 haneli 05XX GSM numaranızı giriniz.');
      return;
    }

    const formattedPhone = digits.startsWith('0') ? digits.slice(0, 11) : `0${digits.slice(-10)}`;

    // Sabit & benzersiz Esnaf Abone kodu üret
    const usedCodes = new Set([
      ...subscribers.map((s) => (s.subscriberCode || '').toLocaleLowerCase('tr-TR')),
      ...dealers.map((d) => (d.dealerCode || '').toLocaleLowerCase('tr-TR')),
    ]);
    let seq = subscribers.length + 1;
    let newSubCode = generateDottedCode('ESNAF', esnafProvince, seq);
    while (usedCodes.has(newSubCode.toLocaleLowerCase('tr-TR'))) {
      seq += 1;
      newSubCode = generateDottedCode('ESNAF', esnafProvince, seq);
    }

    // AGENTS.md Mühürlü Hesaba Yazma Kuralları:
    // 1) İlçe Bayisi broşüründen geldiyse -> Doğrudan o İlçe Bayisinin hesabına yazılır (%20 İlçe, %10 üst İl Bayisi)
    // 2) Esnaf Abone broşüründen geldiyse -> Tavsiye eden Esnafın hesabına +1 referans yazılır; bağlı olduğu İlçe Bayisi pay alır, İl Bayisi KÂR ALAMAZ
    // 3) İl Bayisi / İller Bayisi / Genel Merkez broşüründen geldiyse -> Seçilen ilçede aktif İlçe Bayisi varsa ona + referans kaydına, yoksa Genel Merkez Havuzuna (ref etiketiyle) yazılır
    let assignedDealerId = 'ADMIN_POOL';
    let referredBySubscriberId: string | undefined;
    let referredBySubscriberName: string | undefined;
    let attributionSummary = '';
    let updatedDealers = [...dealers];

    if (referrerInfo.kind === 'ILCE_BAYI' && referrerInfo.dealer) {
      assignedDealerId = referrerInfo.dealer.id;
      updatedDealers = dealers.map((d) =>
        d.id === referrerInfo.dealer!.id
          ? {
              ...d,
              subscriberCount: (d.subscriberCount || 0) + 1,
              apkDistributed: (d.apkDistributed || 0) + 1,
              apkConverted: (d.apkConverted || 0) + 1,
              hasDownline: true,
            }
          : d
      );
      attributionSummary = `Yeni Esnaf Abone (${esnafCompany.trim()} • ${newSubCode}) doğrudan İlçe Bayisi ${referrerInfo.title} (${referrerInfo.code}) hesabına işlendi.`;
    } else if (referrerInfo.kind === 'ESNAF_ABONE' && referrerInfo.subscriber) {
      referredBySubscriberId = referrerInfo.subscriber.id;
      referredBySubscriberName =
        referrerInfo.subscriber.companyName || referrerInfo.subscriber.name;
      assignedDealerId = referrerInfo.subscriber.dealerId || 'ADMIN_POOL';

      if (assignedDealerId && assignedDealerId !== 'ADMIN_POOL') {
        updatedDealers = dealers.map((d) =>
          d.id === assignedDealerId
            ? {
                ...d,
                subscriberCount: (d.subscriberCount || 0) + 1,
                apkConverted: (d.apkConverted || 0) + 1,
              }
            : d
        );
      }
      attributionSummary = `Yeni Esnaf Abone (${esnafCompany.trim()} • ${newSubCode}), tavsiye eden Esnaf ${referredBySubscriberName} (${referrerInfo.code}) hesabına +1 tavsiye olarak yazıldı (İlçe Bayisi pay alır, İl Bayisi pay almaz kuralı aktif).`;
    } else {
      // İl Bayisi / İller Bayisi / Merkez broşürü: o il ve ilçedeki aktif İlçe Bayisini kontrol et
      const districtDealer = dealers.find(
        (d) =>
          d.status === 'ACTIVE' &&
          (d.level === 'ILCE' || d.licenseTier === 'STANDARD_500') &&
          d.province === esnafProvince &&
          (d.district || '').toLocaleLowerCase('tr-TR') ===
            esnafDistrict.toLocaleLowerCase('tr-TR')
      );
      if (districtDealer) {
        assignedDealerId = districtDealer.id;
        updatedDealers = dealers.map((d) => {
          if (d.id === districtDealer.id) {
            return {
              ...d,
              subscriberCount: (d.subscriberCount || 0) + 1,
              apkConverted: (d.apkConverted || 0) + 1,
            };
          }
          if (referrerInfo.dealer && d.id === referrerInfo.dealer.id) {
            return {
              ...d,
              apkDistributed: (d.apkDistributed || 0) + 1,
              apkConverted: (d.apkConverted || 0) + 1,
            };
          }
          return d;
        });
        attributionSummary = `Yeni Esnaf Abone (${esnafCompany.trim()} • ${newSubCode}), ${referrerInfo.title} (${referrerInfo.code}) broşürüyle geldi ve ${esnafProvince}/${esnafDistrict} İlçe Bayisi (${districtDealer.dealerCode}) portföyüne bağlandı.`;
      } else {
        if (referrerInfo.dealer) {
          updatedDealers = dealers.map((d) =>
            d.id === referrerInfo.dealer!.id
              ? {
                  ...d,
                  apkDistributed: (d.apkDistributed || 0) + 1,
                  apkConverted: (d.apkConverted || 0) + 1,
                }
              : d
          );
        }
        attributionSummary = `Yeni Esnaf Abone (${esnafCompany.trim()} • ${newSubCode}), ${referrerInfo.title} (${referrerInfo.code}) broşürüyle kaydedildi (${esnafProvince}/${esnafDistrict} Havuzunda yetkili referansıyla koruma altında).`;
      }
    }

    const newSubscriber: Subscriber = {
      id: `sub-ref-${Date.now()}`,
      name: esnafFullName.trim(),
      fullName: esnafFullName.trim(),
      companyName: esnafCompany.trim(),
      phone: formattedPhone,
      contactPhone: formattedPhone,
      dealerId: assignedDealerId,
      referredBySubscriberId,
      referredBySubscriberName,
      apkStatus: 'ACTIVE',
      apkVersion: 'v1.5',
      apkSentBy: referrerInfo.code,
      apkDistributedDate: new Date().toLocaleDateString('tr-TR'),
      sector: esnafSector.trim() || 'Esnaf / İşletme',
      subscriberCode: newSubCode,
      birthProvince: esnafProvince,
      birthDistrict: esnafDistrict,
      status: 'ACTIVE',
      plan: 'PRO',
      monthlyPrice: 499,
      demoDaysLeft: 30,
      isPaid: true,
      subdomain: esnafCompany
        .trim()
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 18) || `esnaf${Date.now()}`,
      createdAt: new Date().toISOString().slice(0, 10),
      aiConfig: {
        agentName: 'Kurumsal Sekreter',
        voiceType: 'Female_TR',
        greetingMessage: `Merhaba, ${esnafCompany.trim()} işletmesine hoş geldiniz. Size nasıl yardımcı olabilirim?`,
        knowledgeBase: `${esnafCompany.trim()} (${esnafProvince} / ${esnafDistrict})`,
        recordCalls: true,
        unlimitedCalls: true,
        features: {
          information: true,
          noteTaking: true,
          appointmentBooking: true,
          priceNegotiation: false,
          warmTransfer: true,
        },
        warmTransferConfig: {
          enabled: true,
          screenAnonymousCallers: true,
          defaultCallbackMinutes: 3,
        },
      },
    };

    onRegisterSubscriber({
      newSubscriber,
      updatedDealers,
      updatedRefSubscriberId: referredBySubscriberId,
      attributionSummary,
      referrerLabel: `${referrerInfo.title} (${referrerInfo.code})`,
    });

    setSuccessMessage({
      headline: '🎉 Esnaf Aboneliğiniz ve Akıllı Sekreteriniz Tanımlandı!',
      detail: `${esnafCompany.trim()} işletmeniz "${referrerInfo.title} (${referrerInfo.code})" referansıyla sisteme kaydedildi. Şimdi ${formattedPhone} numaranızla SMS giriş ekranından doğrudan panelinizi açabilirsiniz.`,
      assignedCode: newSubCode,
      phone: formattedPhone,
    });
    setMode('SUCCESS');
  };

  const handleBayiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const digits = bayiPhone.replace(/\D/g, '');
    if (!bayiFullName.trim() || !bayiCompany.trim() || digits.length < 10) {
      setFormError('Lütfen Ad Soyad, Firma/Unvan ve 10-11 haneli 05XX GSM numaranızı giriniz.');
      return;
    }

    const formattedPhone = digits.startsWith('0') ? digits.slice(0, 11) : `0${digits.slice(-10)}`;
    const licenseFee = bayiTier === 'MASTER_1000' ? 1000 : 500;
    const tierName =
      bayiTier === 'MASTER_1000' ? 'İl Bayiliği (₺1.000 Lisans)' : 'İlçe Bayiliği (₺500 Lisans)';

    // Üst bayi eşleşmesi: İller veya İl Bayisi ise doğrudan onun ID'si, değilse kendi ilinin İl Bayisi / Genel Merkez
    let targetDistributorId = referrerInfo.id;
    let targetDistributorName = referrerInfo.title;
    if (referrerInfo.kind === 'ESNAF_ABONE' || referrerInfo.kind === 'ILCE_BAYI') {
      const provIlDealer = dealers.find(
        (d) =>
          d.status === 'ACTIVE' &&
          (d.level === 'IL' || d.licenseTier === 'MASTER_1000') &&
          d.province === bayiProvince
      );
      if (provIlDealer) {
        targetDistributorId = provIlDealer.id;
        targetDistributorName = `${provIlDealer.officialTitle || provIlDealer.name} (Broşür Ref: ${referrerInfo.code})`;
      }
    }

    const application: DealerApplication = {
      id: `app-ref-${Date.now()}`,
      applicantName: bayiFullName.trim(),
      companyName: bayiCompany.trim(),
      phone: formattedPhone,
      province: bayiProvince,
      district: bayiDistrict,
      sharerRole: referrerInfo.kind,
      distributorDealerId: targetDistributorId,
      distributorDealerName: targetDistributorName,
      distributorDealerCode: referrerInfo.code,
      requestedTier: bayiTier,
      licenseFee,
      status: 'PENDING_DEALER_APPROVAL',
      createdAt: new Date().toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      notes:
        bayiNotes.trim() ||
        `Sosyal medya kurumsal broşürü (${referrerInfo.code}) üzerinden ${bayiProvince}/${bayiDistrict} ${tierName} başvurusu.`,
      notifiedAdmin: true,
    };

    const attributionSummary = `Yeni Bayilik Başvurusu (${bayiFullName.trim()} • ${bayiProvince}/${bayiDistrict} • ${tierName}), ${referrerInfo.title} (${referrerInfo.code}) broşür referansıyla Merkez/Üst Bayi onayına düştü.`;

    onSubmitDealerApplication({
      application,
      attributionSummary,
      referrerLabel: `${referrerInfo.title} (${referrerInfo.code})`,
    });

    setSuccessMessage({
      headline: '🏛️ Resmi Bayilik Başvurunuz Kayda Alındı!',
      detail: `${bayiProvince} / ${bayiDistrict} ${tierName} başvurunuz "${referrerInfo.title} (${referrerInfo.code})" referansıyla Merkez & Üst Bayi onay ekranına iletildi. Onaylandığında Karekodlu Resmi Yetki Belgeniz ve Bayi Paneliniz aktif edilecektir.`,
    });
    setMode('SUCCESS');
  };

  return (
    <div className="fixed inset-0 z-[285] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md max-h-[92vh] bg-slate-900 border-2 border-amber-500/60 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white">
        {/* ÜST KURUMSAL BAŞLIK */}
        <div className="shrink-0 bg-gradient-to-r from-[#091e47] via-[#123a85] to-[#091e47] px-4 py-3.5 border-b border-amber-500/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#1d418f] border border-amber-400/60 flex items-center justify-center text-xl shrink-0 shadow">
              📲
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black tracking-wide text-white leading-tight">
                SANTRAL<span className="text-[#f5cc3b]">BAYİ</span> RESMİ DAVET KAPISI
              </div>
              <div className="text-[10px] text-amber-300 font-bold truncate">
                Davet Eden: {referrerInfo.title} ({referrerInfo.code})
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-xl bg-slate-900/80 hover:bg-rose-600 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
            title="Kapat / Giriş Ekranına Geç"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* İÇERİK */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 [scrollbar-width:none]">
          {/* REFERANS GÜVENCE ROZETİ */}
          <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-2xl p-3 flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-[10.5px] text-emerald-100 leading-snug">
              <span className="font-black text-emerald-300 block">
                🔑 Resmi Referans Eşleşmesi Aktif: {referrerInfo.code}
              </span>
              Bu ekrandan yapacağınız Esnaf Abonelik veya Bayilik başvurusu doğrudan{' '}
              <strong className="text-white">{referrerInfo.title}</strong> yetkili portföyüne
              güvenle tanımlanır.
            </div>
          </div>

          {mode === 'CHOOSE' && (
            <div className="space-y-3">
              <div className="text-center py-1">
                <h4 className="text-sm font-black text-white">
                  Lütfen Başvuru Türünüzü Seçiniz
                </h4>
                <p className="text-[10.5px] text-slate-400 mt-0.5">
                  0850 hat veya ek cihaz olmadan, mevcut 05XX cep numaranızla çalışır.
                </p>
              </div>

              {/* SEÇENEK 1: HEMEN ABONE OL (ESNAF / İŞLETME) */}
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setMode('ESNAF_FORM');
                }}
                className="w-full p-4 rounded-2xl bg-gradient-to-br from-orange-500/20 via-slate-900 to-slate-950 hover:from-orange-500/30 border-2 border-orange-500/60 text-left space-y-1.5 shadow-lg cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-full bg-orange-500 text-slate-950 font-black text-[9.5px] uppercase">
                    En Çok Tercih Edilen • Esnaf &amp; İşletme
                  </span>
                  <Store className="w-5 h-5 text-orange-400" />
                </div>
                <div className="text-sm font-black text-white">
                  🏪 Hemen Abone Ol (Esnaf / İşletme Kurulumu)
                </div>
                <p className="text-[10.5px] text-slate-300 leading-relaxed">
                  Kendi 05XX cep numaranıza 7/24 Akıllı Sekreter kurun; arayan müşteriyi firma
                  adınızla karşılasın, ön görüşmeli bağlasın, randevu ve sipariş alsın. Dakika
                  ücreti yoktur!
                </p>
              </button>

              {/* SEÇENEK 2: BAYİMİZ OLUN (İL / İLÇE BAYİLİĞİ) */}
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setMode('BAYI_FORM');
                }}
                className="w-full p-4 rounded-2xl bg-gradient-to-br from-sky-500/20 via-slate-900 to-slate-950 hover:from-sky-500/30 border-2 border-sky-500/50 text-left space-y-1.5 shadow-lg cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-full bg-sky-400 text-slate-950 font-black text-[9.5px] uppercase">
                    Bölge Korumalı • İl &amp; İlçe Bayiliği
                  </span>
                  <Building2 className="w-5 h-5 text-sky-400" />
                </div>
                <div className="text-sm font-black text-white">
                  🏛️ Bayimiz Olun (Kazanmaya Başlayın)
                </div>
                <p className="text-[10.5px] text-slate-300 leading-relaxed">
                  İlçenizde (₺500 Lisans) veya İlinizde (₺1.000 Lisans) Karekodlu Resmi Yetki
                  Belgesi ile tek yetkili temsilci olun, her ay düzenli gelir kazanın.
                </p>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs cursor-pointer"
              >
                Zaten Kayıtlıyım • GSM &amp; SMS ile Giriş Yap
              </button>
            </div>
          )}

          {mode === 'ESNAF_FORM' && (
            <form onSubmit={handleEsnafSubmit} className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-orange-400 uppercase">
                  🏪 Esnaf / İşletme Abonelik Kaydı
                </h4>
                <button
                  type="button"
                  onClick={() => setMode('CHOOSE')}
                  className="text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer"
                >
                  ← Geri Dön
                </button>
              </div>

              {formError && (
                <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-[10.5px] text-rose-200 font-bold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-300 mb-1">
                  Yetkili Adı Soyadı
                </label>
                <input
                  type="text"
                  value={esnafFullName}
                  onChange={(e) => setEsnafFullName(e.target.value)}
                  placeholder="Örn: Ahmet Yılmaz"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-orange-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    İşletme / Firma Adı
                  </label>
                  <input
                    type="text"
                    value={esnafCompany}
                    onChange={(e) => setEsnafCompany(e.target.value)}
                    placeholder="Örn: Yıldız Oto Servis"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-orange-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    Meslek / Sektör
                  </label>
                  <input
                    type="text"
                    value={esnafSector}
                    onChange={(e) => setEsnafSector(e.target.value)}
                    placeholder="Örn: Klinik, Emlak, Esnaf"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-orange-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-orange-300 mb-1">
                  📱 Sekreterin Çalışacağı Mevcut 05XX Cep Numaranız
                </label>
                <input
                  type="tel"
                  value={esnafPhone}
                  onChange={(e) => setEsnafPhone(e.target.value)}
                  placeholder="05XX XXX XX XX"
                  className="w-full bg-slate-950 border-2 border-orange-500/60 rounded-xl px-3 py-2.5 text-sm font-mono font-black text-white outline-none focus:border-orange-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">İl</label>
                  <select
                    value={esnafProvince}
                    onChange={(e) => handleProvinceChange(e.target.value, 'ESNAF')}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                  >
                    {provinces.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">İlçe</label>
                  <select
                    value={esnafDistrict}
                    onChange={(e) => setEsnafDistrict(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                  >
                    {esnafDistricts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 font-black text-xs shadow-lg cursor-pointer active:scale-98 transition-all"
              >
                ✅ Aboneliğimi Başlat &amp; Hesaba Tanımla
              </button>
            </form>
          )}

          {mode === 'BAYI_FORM' && (
            <form onSubmit={handleBayiSubmit} className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-sky-400 uppercase">
                  🏛️ İl / İlçe Yetkili Bayilik Başvurusu
                </h4>
                <button
                  type="button"
                  onClick={() => setMode('CHOOSE')}
                  className="text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer"
                >
                  ← Geri Dön
                </button>
              </div>

              {formError && (
                <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-[10.5px] text-rose-200 font-bold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBayiTier('STANDARD_500')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    bayiTier === 'STANDARD_500'
                      ? 'bg-sky-950/80 border-sky-400 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="text-[11px] font-black">📍 İlçe Bayiliği</div>
                  <div className="text-[10px] text-amber-300 font-bold">₺500 Lisans</div>
                  <div className="text-[8.5px] text-slate-300 mt-0.5">Esnaf Abone Yetkisi</div>
                </button>

                <button
                  type="button"
                  onClick={() => setBayiTier('MASTER_1000')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    bayiTier === 'MASTER_1000'
                      ? 'bg-indigo-950/80 border-indigo-400 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="text-[11px] font-black">🏛️ İl Bayiliği</div>
                  <div className="text-[10px] text-amber-300 font-bold">₺1.000 Lisans</div>
                  <div className="text-[8.5px] text-slate-300 mt-0.5">İlçe Bayi Açma Yetkisi</div>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    Ad Soyad
                  </label>
                  <input
                    type="text"
                    value={bayiFullName}
                    onChange={(e) => setBayiFullName(e.target.value)}
                    placeholder="Adınız Soyadınız"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    Firma / Ticari Unvan
                  </label>
                  <input
                    type="text"
                    value={bayiCompany}
                    onChange={(e) => setBayiCompany(e.target.value)}
                    placeholder="Örn: Kuzey İletişim"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-sky-300 mb-1">
                  📱 Yetkili 05XX GSM Telefon Numaranız
                </label>
                <input
                  type="tel"
                  value={bayiPhone}
                  onChange={(e) => setBayiPhone(e.target.value)}
                  placeholder="05XX XXX XX XX"
                  className="w-full bg-slate-950 border-2 border-sky-500/60 rounded-xl px-3 py-2 text-sm font-mono font-black text-white outline-none focus:border-sky-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    Talep Edilen İl
                  </label>
                  <select
                    value={bayiProvince}
                    onChange={(e) => handleProvinceChange(e.target.value, 'BAYI')}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                  >
                    {provinces.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    Talep Edilen İlçe
                  </label>
                  <select
                    value={bayiDistrict}
                    onChange={(e) => setBayiDistrict(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                  >
                    {bayiDistricts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-300 mb-1">
                  Kısa Başvuru Notu (İsteğe Bağlı)
                </label>
                <input
                  type="text"
                  value={bayiNotes}
                  onChange={(e) => setBayiNotes(e.target.value)}
                  placeholder="Bölgedeki esnaf portföyünüz veya notunuz..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[9.5px] text-slate-300 leading-snug">
                ℹ️ Bayilik başvuruları Merkez / Üst Bayi onay süzgecinden geçer. Onaylandığında
                lisans aktivasyonu yapılarak Karekodlu Resmi Dijital Yetki Belgeniz atanır.
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white font-black text-xs shadow-lg cursor-pointer active:scale-98 transition-all"
              >
                🏛️ Bayilik Başvurumu Referansla Gönder
              </button>
            </form>
          )}

          {mode === 'SUCCESS' && successMessage && (
            <div className="py-4 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h4 className="text-sm font-black text-emerald-300">{successMessage.headline}</h4>
              {successMessage.assignedCode && (
                <div className="inline-block px-3 py-1 rounded-xl bg-slate-950 border border-emerald-500/50 font-mono font-black text-xs text-amber-300">
                  Sabit Kurumsal Kodunuz: {successMessage.assignedCode}
                </div>
              )}
              <p className="text-xs text-slate-200 leading-relaxed">{successMessage.detail}</p>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-lg cursor-pointer"
              >
                📲 GSM &amp; SMS Giriş Ekranına Geç
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

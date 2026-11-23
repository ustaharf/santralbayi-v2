import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, ExternalLink, RefreshCw, Share2, Sparkles } from 'lucide-react';
import { resolveServerApiUrl } from './vdsConfig';

export const WEEKLY_SOCIAL_SHARES_STORAGE_KEY = 'sb_weekly_social_shares_v1';
export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SocialPlatformDef {
  id: string;
  name: string;
  linkLabel: string;
  icon: string;
  accentClass: string;
  buildShareUrl: (shareUrl: string, shareText: string) => string;
}

export const SOCIAL_MEDIA_PLATFORMS: SocialPlatformDef[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp (Durum & Gruplar)',
    linkLabel: 'wa.me • Durum / Esnaf Grupları',
    icon: '💬',
    accentClass: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300',
    buildShareUrl: (url) => `https://wa.me/?text=${encodeURIComponent(url)}`,
  },
  {
    id: 'instagram',
    name: 'Instagram (Hikaye & Gönderi)',
    linkLabel: 'instagram.com • Hikaye / Reels / Post',
    icon: '📸',
    accentClass: 'border-pink-500/40 bg-pink-950/40 text-pink-300',
    buildShareUrl: () => 'https://www.instagram.com/',
  },
  {
    id: 'facebook',
    name: 'Facebook (Sayfa & Esnaf Grupları)',
    linkLabel: 'facebook.com/sharer • Grup & Sayfa',
    icon: '📘',
    accentClass: 'border-blue-500/40 bg-blue-950/40 text-blue-300',
    buildShareUrl: (url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: 'tiktok',
    name: 'TikTok (Keşfet & Hikaye)',
    linkLabel: 'tiktok.com • Broşür / Tanıtım',
    icon: '🎵',
    accentClass: 'border-cyan-500/40 bg-slate-900/90 text-cyan-300',
    buildShareUrl: () => 'https://www.tiktok.com/',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn (Kurumsal İş Ağı)',
    linkLabel: 'linkedin.com/sharing • Kurumsal',
    icon: '💼',
    accentClass: 'border-sky-500/40 bg-sky-950/40 text-sky-300',
    buildShareUrl: (url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'x_twitter',
    name: 'X / Twitter (Gündem & İşletme)',
    linkLabel: 'x.com/intent/post • Hızlı Paylaşım',
    icon: '𝕏',
    accentClass: 'border-slate-500/50 bg-slate-900/90 text-slate-200',
    buildShareUrl: (url) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'telegram',
    name: 'Telegram (Kanal & Ticaret Grupları)',
    linkLabel: 't.me/share • Kanal & Grup',
    icon: '✈️',
    accentClass: 'border-sky-400/40 bg-sky-950/35 text-sky-200',
    buildShareUrl: (url) => `https://t.me/share/url?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'youtube',
    name: 'YouTube (Shorts & Topluluk)',
    linkLabel: 'youtube.com • Topluluk / Shorts',
    icon: '▶️',
    accentClass: 'border-rose-500/40 bg-rose-950/40 text-rose-300',
    buildShareUrl: () => 'https://www.youtube.com/',
  },
];

export interface WeeklySocialShareEntry {
  cycleStartMs: number;
  checked: Record<string, string>; // platformId -> formatted timestamp
  resetCount?: number;
  lastRemindedCycleMs?: number;
}

export type WeeklySocialShareMap = Record<string, WeeklySocialShareEntry>;

export function loadWeeklySocialShareMap(): WeeklySocialShareMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(WEEKLY_SOCIAL_SHARES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as WeeklySocialShareMap;
    }
  } catch {}
  return {};
}

export function ensureFreshWeeklyEntry(
  map: WeeklySocialShareMap,
  sharerCode: string,
  nowMs: number = Date.now()
): {
  nextMap: WeeklySocialShareMap;
  entry: WeeklySocialShareEntry;
  didReset: boolean;
} {
  const key = sharerCode || 'TR.000';
  const existing = map[key];
  if (!existing || typeof existing.cycleStartMs !== 'number') {
    const fresh: WeeklySocialShareEntry = {
      cycleStartMs: nowMs,
      checked: {},
      resetCount: 0,
    };
    return {
      nextMap: { ...map, [key]: fresh },
      entry: fresh,
      didReset: false,
    };
  }

  const elapsed = nowMs - existing.cycleStartMs;
  if (elapsed >= ONE_WEEK_MS) {
    const cyclesPassed = Math.max(1, Math.floor(elapsed / ONE_WEEK_MS));
    const resetEntry: WeeklySocialShareEntry = {
      cycleStartMs: existing.cycleStartMs + cyclesPassed * ONE_WEEK_MS,
      checked: {},
      resetCount: (existing.resetCount || 0) + cyclesPassed,
      lastRemindedCycleMs: existing.lastRemindedCycleMs,
    };
    return {
      nextMap: { ...map, [key]: resetEntry },
      entry: resetEntry,
      didReset: true,
    };
  }

  return {
    nextMap: map,
    entry: {
      ...existing,
      checked: existing.checked && typeof existing.checked === 'object' ? existing.checked : {},
    },
    didReset: false,
  };
}

export function formatRemainingWeekTime(cycleStartMs: number, nowMs: number = Date.now()): string {
  const remainingMs = Math.max(0, cycleStartMs + ONE_WEEK_MS - nowMs);
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days} Gün ${hours} Saat`;
  const mins = Math.max(1, Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000)));
  return `${hours} Saat ${mins} Dk`;
}

export function buildBrochureCaptionText(
  _sharerTitle: string,
  _sharerCode: string,
  personalShareUrl: string
): string {
  // Uzun açıklama metni kesinlikle gönderilmez; şablon görselinin hemen altında yalnızca tek satır tıklanabilir canlı başvuru linki yer alır.
  return personalShareUrl.trim();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

interface GeneratedPosterResult {
  blob: Blob;
  dataUrl: string;
}

async function generateBrochurePoster(params: {
  sharerTitle: string;
  sharerName: string;
  sharerCode: string;
  personalShareUrl: string;
  qrDataUrl: string;
}): Promise<GeneratedPosterResult | null> {
  const { sharerTitle, sharerCode, personalShareUrl, qrDataUrl } = params;
  const canvas = document.createElement('canvas');
  // 1080x1350 (4:5 Evrensel Sosyal Medya Portre Oranı): WhatsApp, Instagram, Facebook, LinkedIn ve X önizlemelerinde üstten/alttan kırpılmadan %100 tam görünür.
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 1. Arka Plan Beyaz Gövde
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 1080, 1350);

  // 2. Üst Kraliyet Laciverti Hero Alanı
  const heroGrad = ctx.createLinearGradient(0, 0, 1080, 445);
  heroGrad.addColorStop(0, '#091e47');
  heroGrad.addColorStop(0.55, '#123a85');
  heroGrad.addColorStop(1, '#0c275e');
  ctx.fillStyle = heroGrad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(1080, 0);
  ctx.lineTo(1080, 365);
  ctx.quadraticCurveTo(640, 445, 0, 398);
  ctx.closePath();
  ctx.fill();

  // Turuncu dinamik kuşak şeridi
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(0, 390);
  ctx.quadraticCurveTo(640, 437, 1080, 353);
  ctx.lineTo(1080, 372);
  ctx.quadraticCurveTo(640, 456, 0, 408);
  ctx.closePath();
  ctx.fill();

  // 3. Üst Beyaz Kurumsal Arma Yamuğu
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(280, 0);
  ctx.lineTo(800, 0);
  ctx.lineTo(758, 94);
  ctx.lineTo(322, 94);
  ctx.closePath();
  ctx.fill();

  // Resmi SANTRAL BAYİ dairesel amblem + yazı
  ctx.fillStyle = '#1d418f';
  ctx.beginPath();
  ctx.arc(395, 47, 29, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = 'bold 29px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('📲', 395, 49);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = '900 34px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.fillText('SANTRAL', 438, 48);
  ctx.fillStyle = '#ea580c';
  ctx.fillText('BAYİ', 602, 48);
  ctx.font = '800 14.5px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('AKILLI ÇAĞRI SİSTEMLERİ', 440, 74, 285);

  // 4. Ana Manşet
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 52px system-ui, -apple-system, sans-serif';
  ctx.fillText("TÜRKİYE'DE İLK VE TEK!", 540, 148, 960);

  ctx.fillStyle = '#fde047';
  ctx.font = '800 24px system-ui, -apple-system, sans-serif';
  ctx.fillText('KENDİ MEVCUT 05XX CEP NUMARANIZLA ÇALIŞAN', 540, 190, 960);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 23px system-ui, -apple-system, sans-serif';
  ctx.fillText('7/24 AKILLI ÇAĞRI & DİJİTAL SEKRETER SİSTEMİ', 540, 222, 960);

  // 5. Türkiye Ağ Haritası + Akıllı Telefon İllüstrasyonu
  ctx.save();
  ctx.fillStyle = 'rgba(226, 232, 240, 0.94)';
  drawRoundedRect(ctx, 332, 246, 676, 134, 34);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const nodes = [
    [398, 282],
    [472, 312],
    [544, 276],
    [616, 326],
    [696, 284],
    [776, 328],
    [860, 288],
    [936, 324],
    [512, 352],
    [684, 354],
    [842, 356],
  ];
  ctx.strokeStyle = 'rgba(29, 78, 216, 0.34)';
  ctx.lineWidth = 2;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]) < 200) {
        ctx.beginPath();
        ctx.moveTo(nodes[i][0], nodes[i][1]);
        ctx.lineTo(nodes[j][0], nodes[j][1]);
        ctx.stroke();
      }
    }
  }
  for (const [nx, ny] of nodes) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(nx, ny, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(nx, ny, 4.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Sol cep telefonu & sinyal kartı
  ctx.save();
  ctx.translate(206, 315);
  ctx.rotate(-0.14);
  ctx.fillStyle = '#0f172a';
  drawRoundedRect(ctx, -114, -62, 228, 124, 22);
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#1d4ed8';
  drawRoundedRect(ctx, -98, -50, 196, 100, 14);
  ctx.fill();

  ctx.rotate(0.14);
  for (const r of [28, 48, 68]) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.88)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -44, r, -Math.PI * 0.82, -Math.PI * 0.18);
    ctx.stroke();
  }
  ctx.fillStyle = '#facc15';
  ctx.font = '900 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('05XX GSM', 0, 8, 180);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 16.5px system-ui, sans-serif';
  ctx.fillText('7/24 AKILLI SEKRETER', 0, 32, 180);
  ctx.restore();

  // 6. Birincil Odak: ESNAF & İŞLETMELER İÇİN AKILLI SEKRETER
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 36px system-ui, -apple-system, sans-serif';
  ctx.fillText('ESNAF & İŞLETMELER İÇİN AKILLI SEKRETER!', 540, 466, 960);

  ctx.fillStyle = '#ea580c';
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('CEVAPSIZ ÇAĞRILARA VE KAÇAN MÜŞTERİLERE SON VERİN!', 540, 498, 960);

  // 3 Turuncu Daire Sütun
  const pillars = [
    { x: 205, icon: '📱', l1: 'Kendi 05XX Cep', l2: 'Numaranızda Çalışır' },
    { x: 540, icon: '🤖', l1: '7/24 Ön Görüşmeli', l2: 'Akıllı Aktarma' },
    { x: 875, icon: '📅', l1: 'Otomatik Randevu', l2: '& Sıfır Dakika Ücreti' },
  ];

  for (const p of pillars) {
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(p.x, 560, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.icon, p.x, 562);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(p.l1, p.x, 624, 290);
    ctx.fillText(p.l2, p.x, 649, 290);
  }

  // Dikey ayraç çizgileri
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(372, 524);
  ctx.lineTo(372, 656);
  ctx.moveTo(708, 524);
  ctx.lineTo(708, 656);
  ctx.stroke();

  // Esnaf Abonelik Detay Kutusu (Ağırlıklı Bölüm - Sağ kenar taşmasına karşı maxWidth korumalı)
  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, 56, 674, 968, 208, 22);
  ctx.fill();
  ctx.strokeStyle = '#fdba74';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 24px system-ui, sans-serif';
  ctx.fillText('🏪 ESNAF ABONELİĞİ NEDEN HER İŞLETMEYE ŞART?', 86, 712, 908);

  const esnafBullets = [
    'Cihaz veya yeni numara almadan doğrudan mevcut cep telefonunuzda 2 dakikada kurulur.',
    'Arayan müşteriyi firma adınızla karşılar, müziğe alıp önce size haber vererek bağlar.',
    'Meşgulken veya mesai dışında randevu, sipariş ve arayan notunu anında ekranınıza düşürür.',
    'Dakika başı sürpriz fatura KESİNLİKLE YOKTUR — aylık sabit, ekonomik esnaf paketi!',
  ];
  ctx.font = '700 20px system-ui, sans-serif';
  esnafBullets.forEach((b, idx) => {
    const by = 750 + idx * 35;
    ctx.fillStyle = '#ea580c';
    ctx.fillText('●', 86, by);
    ctx.fillStyle = '#1e293b';
    ctx.fillText(b, 112, by, 884);
  });

  // 7. İkincil Fırsat: İL VE İLÇE BAYİLİK AVANTAJLARI
  ctx.fillStyle = '#eff6ff';
  drawRoundedRect(ctx, 56, 896, 968, 178, 22);
  ctx.fill();
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 24px system-ui, sans-serif';
  ctx.fillText('🏛️ İL VE İLÇE BAYİLİKLERİ VERİLECEKTİR! (BÖLGE KORUMALI)', 86, 934, 908);

  const dealerBulletsLeft = [
    'Her Ay Düzenli Artan Kurumsal Gelir',
    'İl ve İlçe Bölge Koruması Garantisi',
  ];
  const dealerBulletsRight = [
    'Karekodlu Resmi Dijital Yetki Belgesi',
    'Hazır Yönetim Paneli & Merkez Destek',
  ];
  ctx.font = '800 20px system-ui, sans-serif';
  dealerBulletsLeft.forEach((txt, i) => {
    const by = 974 + i * 38;
    ctx.fillStyle = '#ea580c';
    ctx.fillText('▸', 86, by);
    ctx.fillStyle = '#1e293b';
    ctx.fillText(txt, 112, by, 430);
  });
  dealerBulletsRight.forEach((txt, i) => {
    const by = 974 + i * 38;
    ctx.fillStyle = '#ea580c';
    ctx.fillText('▸', 566, by);
    ctx.fillStyle = '#1e293b';
    ctx.fillText(txt, 592, by, 404);
  });

  ctx.fillStyle = '#1d4ed8';
  ctx.font = '800 18.5px system-ui, sans-serif';
  ctx.fillText(
    '📍 81 İl • 973 İlçede Esnaf Abonelik & Yetkili Bayilik Ağı Hızla Büyüyor!',
    86,
    1052,
    908
  );

  // 8. Alt Kurumsal Kişisel Başvuru, Canlı Link Yönlendirmesi & Karekod Barı (0850 KESİNLİKLE YOKTUR)
  const footerGrad = ctx.createLinearGradient(0, 1092, 1080, 1350);
  footerGrad.addColorStop(0, '#091e47');
  footerGrad.addColorStop(1, '#123a85');
  ctx.fillStyle = footerGrad;
  ctx.fillRect(0, 1102, 1080, 236);

  ctx.fillStyle = '#f97316';
  ctx.fillRect(0, 1092, 1080, 10);
  ctx.fillRect(0, 1338, 1080, 12);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#fde047';
  ctx.font = '900 30px system-ui, sans-serif';
  ctx.fillText('HEMEN ABONE OLUN VEYA BAYİMİZ OLUN!', 56, 1144, 744);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px system-ui, sans-serif';
  const trimmedTitle = sharerTitle.length > 42 ? sharerTitle.slice(0, 41) + '…' : sharerTitle;
  ctx.fillText(`👤 Yetkili: ${trimmedTitle}`, 56, 1182, 744);

  ctx.fillStyle = '#4ade80';
  ctx.font = '900 22px monospace, sans-serif';
  ctx.fillText(`🔑 Resmi Referans Kodu: ${sharerCode}`, 56, 1218, 744);

  // Doğrudan alttaki canlı linke basmaya yönlendiren dikkat çekici buton şeridi
  ctx.fillStyle = '#f97316';
  drawRoundedRect(ctx, 56, 1236, 742, 46, 12);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 20px system-ui, sans-serif';
  ctx.fillText('👇 BAŞVURU İÇİN ALTTAKİ LİNKE BASIN VEYA QR OKUTUN', 427, 1266, 718);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#bae6fd';
  ctx.font = '700 19px monospace, sans-serif';
  const displayUrl =
    personalShareUrl.length > 52 ? personalShareUrl.slice(0, 51) + '…' : personalShareUrl;
  ctx.fillText(`🔗 ${displayUrl}`, 56, 1314, 744);

  // Sağda Gerçek Taranabilir Karekod Kartı
  if (qrDataUrl) {
    try {
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = qrDataUrl;
      });
      ctx.fillStyle = '#ffffff';
      drawRoundedRect(ctx, 824, 1112, 204, 216, 18);
      ctx.fill();
      ctx.drawImage(qrImg, 842, 1122, 168, 168);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 16.5px system-ui, sans-serif';
      ctx.fillText('OKUT & BAŞVUR', 926, 1312, 188);
    } catch {}
  }

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png', 0.96);
  });
  if (!blob) return null;
  return { blob, dataUrl };
}

interface SocialBrochureDistributorProps {
  sharerRole: 'admin' | 'iller_bayi' | 'il_bayi' | 'ilce_bayi' | 'esnaf';
  sharerCode: string;
  sharerName: string;
  sharerTitle: string;
  personalShareUrl: string;
  weeklyMap: WeeklySocialShareMap;
  onUpdateWeeklyMap: (next: WeeklySocialShareMap) => void;
  onNotifyToast: (msg: string) => void;
  onPreviewReferralPortal: (refCode: string) => void;
}

export const SocialBrochureDistributor: React.FC<SocialBrochureDistributorProps> = ({
  sharerCode,
  sharerName,
  sharerTitle,
  personalShareUrl,
  weeklyMap,
  onUpdateWeeklyMap,
  onNotifyToast,
  onPreviewReferralPortal,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showSocialList, setShowSocialList] = useState<boolean>(false);
  const [busyPlatformId, setBusyPlatformId] = useState<string | null>(null);
  const [isDownloadingPoster, setIsDownloadingPoster] = useState<boolean>(false);
  const [copiedCaption, setCopiedCaption] = useState<boolean>(false);
  const socialListRef = useRef<HTMLDivElement | null>(null);
  const posterCacheRef = useRef<GeneratedPosterResult | null>(null);

  useEffect(() => {
    let active = true;
    posterCacheRef.current = null;
    QRCode.toDataURL(personalShareUrl, {
      width: 280,
      margin: 1,
      color: { dark: '#091e47', light: '#ffffff' },
    })
      .then(async (url) => {
        if (!active) return;
        setQrDataUrl(url);
        const generated = await generateBrochurePoster({
          sharerTitle,
          sharerName,
          sharerCode,
          personalShareUrl,
          qrDataUrl: url,
        });
        if (!active || !generated) return;
        posterCacheRef.current = generated;

        // Tüm sosyal medya link önizlemeleri (Facebook, LinkedIn, X, Telegram, WhatsApp Web) için broşür PNG'sini sunucuya yükle
        try {
          await fetch(resolveServerApiUrl('/api/brochure-upload'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              refCode: sharerCode,
              dataUrl: generated.dataUrl,
            }),
          });
        } catch {}
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [personalShareUrl, sharerCode, sharerName, sharerTitle]);

  const { entry } = useMemo(
    () => ensureFreshWeeklyEntry(weeklyMap, sharerCode),
    [weeklyMap, sharerCode]
  );

  const checkedCount = useMemo(
    () => SOCIAL_MEDIA_PLATFORMS.filter((p) => Boolean(entry.checked?.[p.id])).length,
    [entry]
  );
  const totalPlatforms = SOCIAL_MEDIA_PLATFORMS.length;
  const remainingTimeLabel = formatRemainingWeekTime(entry.cycleStartMs);

  // Sadece şablon resmi + hemen altında 1 satırlık canlı başvuru linki (uzun yazılar yok)
  const shareLinkOnly = useMemo(
    () => buildBrochureCaptionText(sharerTitle, sharerCode, personalShareUrl),
    [sharerTitle, sharerCode, personalShareUrl]
  );

  const markPlatformChecked = (platformId: string) => {
    const nowMs = Date.now();
    const { nextMap, entry: currentEntry } = ensureFreshWeeklyEntry(weeklyMap, sharerCode, nowMs);
    const stamp = new Date(nowMs).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const updatedEntry: WeeklySocialShareEntry = {
      ...currentEntry,
      checked: {
        ...currentEntry.checked,
        [platformId]: stamp,
      },
    };
    const finalMap: WeeklySocialShareMap = {
      ...nextMap,
      [sharerCode]: updatedEntry,
    };
    onUpdateWeeklyMap(finalMap);
  };

  const getOrCreatePoster = async (): Promise<GeneratedPosterResult | null> => {
    if (posterCacheRef.current) return posterCacheRef.current;
    const generated = await generateBrochurePoster({
      sharerTitle,
      sharerName,
      sharerCode,
      personalShareUrl,
      qrDataUrl,
    });
    if (generated) {
      posterCacheRef.current = generated;
    }
    return generated;
  };

  const handleDownloadPoster = async () => {
    if (isDownloadingPoster) return;
    setIsDownloadingPoster(true);
    try {
      const poster = await getOrCreatePoster();
      if (!poster) {
        onNotifyToast('Broşür görseli hazırlanamadı.');
        return;
      }
      const objUrl = URL.createObjectURL(poster.blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `SantralBayi-Brosur-${sharerCode}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
      onNotifyToast(`✅ Kişisel karekodlu broşürünüz (${sharerCode}) indirildi!`);
    } finally {
      setIsDownloadingPoster(false);
    }
  };

  const handlePublishToPlatform = async (platform: SocialPlatformDef) => {
    if (busyPlatformId) return;
    setBusyPlatformId(platform.id);
    try {
      // 1. Seçilen sosyal medya kanalını hemen yeşil tikle işaretle ve ana sunucuya kaydet
      markPlatformChecked(platform.id);

      // 2. Broşür PNG görselini al (açılışta hazırlandığı için 0ms gecikmeyle gelir, mobil kullanıcı etkileşimi kopmaz)
      const poster = posterCacheRef.current || (await getOrCreatePoster());
      if (!poster) {
        onNotifyToast('Broşür görseli hazırlanamadı.');
        return;
      }

      const fileName = `SantralBayi-Brosur-${sharerCode}.png`;
      const imageFile = new File([poster.blob], fileName, { type: 'image/png' });

      // 3. Öncelik A — Android APK Doğrudan Şablon Resmi + Sadece Tıklanabilir Canlı Link Köprüsü
      const bridge = (window as unknown as {
        AndroidBridge?: {
          shareImageToPlatform?: (dataUrl: string, platformId: string, caption: string) => void;
          shareImageBase64?: (dataUrl: string, waPhone: string, caption: string) => void;
        };
      }).AndroidBridge;

      if (bridge && typeof bridge.shareImageToPlatform === 'function') {
        try {
          navigator.clipboard?.writeText?.(shareLinkOnly).catch(() => {});
          bridge.shareImageToPlatform(poster.dataUrl, platform.id, shareLinkOnly);
          onNotifyToast(`✅ ${platform.name}: Broşür şablonu ve canlı başvuru linkiniz aktarıldı!`);
          return;
        } catch {}
      }

      if (platform.id === 'whatsapp' && bridge && typeof bridge.shareImageBase64 === 'function') {
        try {
          navigator.clipboard?.writeText?.(shareLinkOnly).catch(() => {});
          bridge.shareImageBase64(poster.dataUrl, '', shareLinkOnly);
          onNotifyToast(`✅ WhatsApp: Broşür şablonu ve canlı başvuru linkiniz açıldı!`);
          return;
        } catch {}
      }

      // 4. Öncelik B — Mobil Tarayıcı & WebView (title olmadan SADECE PNG Şablon + Tek Satır Tıklanabilir Link)
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [imageFile] })
      ) {
        try {
          navigator.clipboard?.writeText?.(shareLinkOnly).catch(() => {});
          await navigator.share({
            files: [imageFile],
            text: shareLinkOnly,
          });
          onNotifyToast(`✅ ${platform.name}: Broşür şablonu ve canlı başvuru linki paylaşıldı!`);
          return;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            onNotifyToast(`✅ ${platform.name} tiklendi • Canlı başvuru linkiniz kopyalandı.`);
            return;
          }
        }
      }

      // 5. Öncelik C — Masaüstü (PC) Tarayıcı:
      try {
        await fetch(resolveServerApiUrl('/api/brochure-upload'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refCode: sharerCode,
            dataUrl: poster.dataUrl,
          }),
        });
      } catch {}

      let copiedImageToClipboard = false;
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof ClipboardItem !== 'undefined'
      ) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': poster.blob,
            }),
          ]);
          copiedImageToClipboard = true;
        } catch {
          try {
            await navigator.clipboard.writeText(shareLinkOnly);
          } catch {}
        }
      } else {
        try {
          await navigator.clipboard.writeText(shareLinkOnly);
        } catch {}
      }

      const objUrl = URL.createObjectURL(poster.blob);
      const dl = document.createElement('a');
      dl.href = objUrl;
      dl.download = fileName;
      document.body.appendChild(dl);
      dl.click();
      document.body.removeChild(dl);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);

      const targetUrl = platform.buildShareUrl(personalShareUrl, shareLinkOnly);
      const link = document.createElement('a');
      link.href = targetUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      onNotifyToast(
        copiedImageToClipboard
          ? `✅ ${platform.name} açıldı! Broşür şablonu panoya kopyalandı (Ctrl+V) ve canlı link iletildi.`
          : `✅ ${platform.name} açıldı! Broşür şablonu indirildi ve canlı başvuru linki aktif.`
      );
    } finally {
      setBusyPlatformId(null);
    }
  };

  const handleOpenSocialSelector = () => {
    setShowSocialList(true);
    setTimeout(() => {
      socialListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  };

  return (
    <div className="space-y-3.5">
      {/* HAFTALIK SOSYAL MEDYA HATIRLATMA & İLERLEME BARI */}
      <div
        className={`rounded-2xl p-3 border shadow-lg transition-all ${
          checkedCount === totalPlatforms
            ? 'bg-emerald-950/50 border-emerald-500/50'
            : checkedCount === 0
            ? 'bg-amber-950/45 border-amber-500/50'
            : 'bg-slate-950/95 border-sky-500/40'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">
              {checkedCount === totalPlatforms ? '🏆' : '📅'}
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-black text-white truncate">
                {checkedCount === totalPlatforms
                  ? 'Haftalık Tüm Sosyal Medya Yayınlarınız Tamamlandı!'
                  : checkedCount === 0
                  ? 'Haftalık Tanıtım Hatırlatması: Henüz Yayın Yapılmadı'
                  : 'Haftalık Sosyal Medya Dağıtım Durumu'}
              </div>
              <div className="text-[9.5px] text-slate-300 font-semibold mt-0.5">
                Haftalık tik sıfırlanmasına kalan:{' '}
                <span className="text-amber-300 font-extrabold">{remainingTimeLabel}</span>
              </div>
            </div>
          </div>
          <span
            className={`shrink-0 px-2.5 py-1 rounded-xl font-black text-[10.5px] border ${
              checkedCount === totalPlatforms
                ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                : 'bg-slate-900 text-amber-300 border-amber-500/40'
            }`}
          >
            ✅ {checkedCount}/{totalPlatforms}
          </span>
        </div>

        {/* İlerleme Çubuğu */}
        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden mt-2 border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-400 transition-all duration-300"
            style={{ width: `${Math.round((checkedCount / totalPlatforms) * 100)}%` }}
          />
        </div>
      </div>

      {/* GÖMÜLÜ KURUMSAL BROŞÜR TASARIMI (TÜM 5 PANEL İÇİN KİŞİSEL KAREKODLU & 0850'SİZ) */}
      <div className="rounded-2xl overflow-hidden border-2 border-amber-500/50 shadow-2xl bg-white text-slate-900 select-none">
        {/* ÜST LACİVERT HERO BÖLÜMÜ */}
        <div className="relative bg-gradient-to-br from-[#091e47] via-[#153e8a] to-[#0b2559] px-3.5 pt-0 pb-5 text-white overflow-hidden">
          {/* Üst Orta Beyaz Kurumsal Logo Arması */}
          <div className="mx-auto w-fit bg-white text-slate-900 px-4 py-1.5 rounded-b-2xl shadow-md flex items-center gap-2 border-x border-b border-blue-200">
            <div className="w-6 h-6 rounded-full bg-[#1d418f] flex items-center justify-center text-xs shadow-inner">
              📲
            </div>
            <div className="leading-none">
              <div className="text-[11px] font-black tracking-wide">
                SANTRAL<span className="text-orange-600">BAYİ</span>
              </div>
              <div className="text-[7.5px] font-extrabold text-slate-600 tracking-wider">
                AKILLI ÇAĞRI SİSTEMLERİ
              </div>
            </div>
          </div>

          {/* Ana Başlık */}
          <div className="text-center mt-2.5 space-y-1">
            <div className="text-[18px] leading-tight font-black tracking-tight text-white drop-shadow">
              TÜRKİYE&apos;DE İLK VE TEK!
            </div>
            <div className="text-[10px] leading-snug font-extrabold text-amber-300 uppercase">
              Kendi Mevcut 05XX GSM Cep Numaranızla Çalışan
              <span className="block text-white">
                7/24 Akıllı Çağrı &amp; Dijital Sekreter Sistemi
              </span>
            </div>
          </div>

          {/* Akıllı Telefon + Baz İstasyonu + Türkiye 81 İl Ağ Haritası Görseli */}
          <div className="mt-3 flex items-center gap-2 bg-slate-950/35 border border-sky-400/25 rounded-2xl p-2.5">
            {/* Sol: Cep Telefonu & GSM Kulesi */}
            <div className="shrink-0 w-22 bg-gradient-to-b from-slate-900 to-blue-950 border-2 border-sky-400/60 rounded-xl p-2 text-center shadow-lg">
              <div className="text-xl leading-none">📡📲</div>
              <div className="text-[8.5px] font-black text-amber-300 mt-1">05XX GSM</div>
              <div className="text-[7.5px] font-bold text-sky-200 leading-tight">
                Cihaz Yok
                <br />
                Ek Hat Yok
              </div>
            </div>

            {/* Sağ: Türkiye Bağlantılı Şehir Ağı SVG */}
            <div className="flex-1 min-w-0">
              <svg viewBox="0 0 260 92" className="w-full h-auto drop-shadow">
                <rect
                  x="4"
                  y="8"
                  width="252"
                  height="76"
                  rx="18"
                  fill="#e2e8f0"
                  fillOpacity="0.92"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
                {/* Ağ Çizgileri */}
                <g stroke="#1d4ed8" strokeOpacity="0.35" strokeWidth="1.2">
                  <line x1="34" y1="30" x2="78" y2="48" />
                  <line x1="78" y1="48" x2="118" y2="28" />
                  <line x1="118" y1="28" x2="162" y2="54" />
                  <line x1="162" y1="54" x2="205" y2="30" />
                  <line x1="205" y1="30" x2="232" y2="56" />
                  <line x1="34" y1="30" x2="62" y2="66" />
                  <line x1="62" y1="66" x2="128" y2="66" />
                  <line x1="128" y1="66" x2="190" y2="68" />
                  <line x1="78" y1="48" x2="128" y2="66" />
                  <line x1="162" y1="54" x2="190" y2="68" />
                </g>
                {/* Şehir Düğümleri */}
                {[
                  [34, 30],
                  [78, 48],
                  [118, 28],
                  [162, 54],
                  [205, 30],
                  [232, 56],
                  [62, 66],
                  [128, 66],
                  [190, 68],
                ].map(([cx, cy], idx) => (
                  <g key={idx}>
                    <circle cx={cx} cy={cy} r="6.5" fill="#ffffff" stroke="#f97316" strokeWidth="2" />
                    <circle cx={cx} cy={cy} r="2.6" fill="#1d4ed8" />
                  </g>
                ))}
              </svg>
              <div className="text-[8px] text-center text-sky-200 font-bold mt-0.5">
                81 İl • 973 İlçede Kesintisiz Mobil Santral Ağı
              </div>
            </div>
          </div>

          {/* Alt Turuncu Şerit Çizgi */}
          <div className="absolute bottom-0 inset-x-0 h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400" />
        </div>

        {/* ORTA BEYAZ GÖVDE: ESNAF ABONELİĞİ (AĞIRLIKLI) + BAYİLİK FIRSATI */}
        <div className="p-3.5 space-y-3 bg-gradient-to-b from-white to-slate-50">
          {/* ESNAF VURGULU BAŞLIK */}
          <div className="text-center">
            <div className="text-[12.5px] font-black text-slate-900 tracking-tight uppercase">
              🏪 ESNAF &amp; İŞLETMELER İÇİN 7/24 DİJİTAL SEKRETER!
            </div>
            <div className="text-[9.5px] font-extrabold text-orange-600 uppercase mt-0.5">
              Cevapsız Çağrılara ve Kaçan Müşterilere Anında Son Verin!
            </div>
          </div>

          {/* 3 Turuncu İkon Sütunu (Referans Görsel Mimarisi) */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 bg-slate-50 border border-slate-200/90 rounded-xl py-2.5 px-1 text-center">
            <div className="px-1 flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm shadow-sm">
                📱
              </div>
              <div className="text-[8.5px] font-black text-slate-800 leading-tight mt-1">
                Mevcut 05XX Cep Numaranızda
              </div>
            </div>
            <div className="px-1 flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm shadow-sm">
                🤖
              </div>
              <div className="text-[8.5px] font-black text-slate-800 leading-tight mt-1">
                Ön Görüşmeli Akıllı Aktarma
              </div>
            </div>
            <div className="px-1 flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm shadow-sm">
                📅
              </div>
              <div className="text-[8.5px] font-black text-slate-800 leading-tight mt-1">
                7/24 Randevu &amp; Sıfır Dakika Ücreti
              </div>
            </div>
          </div>

          {/* Esnaf Avantaj Maddeleri */}
          <div className="bg-orange-50/70 border border-orange-200 rounded-xl p-2.5 space-y-1 text-[9.5px] text-slate-800 font-bold leading-snug">
            <div className="text-[10px] font-black text-orange-700 uppercase mb-0.5">
              Esnaf &amp; İşletme Abonelik Avantajları:
            </div>
            <div>• Ek cihaz veya 0850 numara almadan doğrudan kendi cep numaranızda çalışır.</div>
            <div>
              • Arayanı firma adınızla karşılar, müziğe alıp kim olduğunu önce size sorarak bağlar.
            </div>
            <div>
              • Meşgulken veya mesai dışında randevu ve siparişleri kaçırmadan ekranınıza kaydeder.
            </div>
            <div>
              • Dakika başı sürpriz ücret <span className="text-rose-700 font-black">YOKTUR</span>;
              sabit aylık ekonomik paketle sınırsız konfor sağlar.
            </div>
          </div>

          {/* Bayilik Fırsatı Bölümü */}
          <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-blue-950 uppercase">
                🏛️ İL VE İLÇE BAYİLİKLERİ VERİLECEKTİR!
              </span>
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-orange-500 text-white">
                BÖLGE KORUMALI
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] font-extrabold text-slate-800">
              <div>
                <span className="text-orange-600">▸</span> Yüksek Aylık Düzenli Gelir
              </div>
              <div>
                <span className="text-orange-600">▸</span> İl / İlçe Bölge Koruması
              </div>
              <div>
                <span className="text-orange-600">▸</span> Karekodlu Resmi Yetki Belgesi
              </div>
              <div>
                <span className="text-orange-600">▸</span> Hazır Yönetim &amp; Teknik Destek
              </div>
            </div>
          </div>
        </div>

        {/* ALT KURUMSAL KİŞİSEL DAVET, CANLI LİNK & KAREKOD BARI (0850 YOK — PAYLAŞANIN HESABINA YAZILIR) */}
        <div className="bg-gradient-to-r from-[#091e47] via-[#123a85] to-[#091e47] border-t-4 border-orange-500 p-3 text-white flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-[11px] font-black text-amber-300 uppercase leading-none">
              HEMEN ABONE OLUN / BAYİMİZ OLUN!
            </div>
            <div className="text-[9.5px] font-extrabold text-white truncate">
              👤 {sharerTitle}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-mono font-black text-[9.5px]">
                Ref: {sharerCode}
              </span>
              <span className="text-[8.5px] text-sky-200 font-semibold">
                • Kayıtlar otomatik hesabınıza işlenir
              </span>
            </div>
            <button
              type="button"
              onClick={() => onPreviewReferralPortal(sharerCode)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-black text-[9.5px] shadow cursor-pointer active:scale-98 transition-all truncate"
            >
              👇 Başvuru İçin Tıklayın: {personalShareUrl}
            </button>
          </div>

          {/* Taranabilir Gerçek Karekod */}
          <button
            type="button"
            onClick={() => onPreviewReferralPortal(sharerCode)}
            className="shrink-0 bg-white rounded-xl p-1.5 text-center shadow-lg border border-amber-300 cursor-pointer active:scale-95 transition-transform"
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR ${sharerCode}`}
                referrerPolicy="no-referrer"
                className="w-16 h-16 object-contain mx-auto"
              />
            ) : (
              <div className="w-16 h-16 flex items-center justify-center text-[9px] text-slate-500 font-bold">
                QR...
              </div>
            )}
            <div className="text-[7px] font-black text-slate-900 uppercase mt-0.5 leading-none">
              OKUT &amp; BAŞVUR
            </div>
          </button>
        </div>
      </div>

      {/* ANA EYLEM BUTONLARI: BROŞÜR İNDİR + GÖNDER (SOSYAL MEDYA LİSTESİNİ AÇAR) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleDownloadPoster}
          disabled={isDownloadingPoster}
          className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-black text-[10.5px] flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
        >
          <Download className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{isDownloadingPoster ? 'Hazırlanıyor...' : 'Broşürü İndir (HD)'}</span>
        </button>

        <button
          type="button"
          onClick={handleOpenSocialSelector}
          className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-[11px] flex items-center justify-center gap-1.5 shadow-lg shadow-orange-500/25 cursor-pointer active:scale-95 transition-all"
        >
          <Share2 className="w-3.5 h-3.5 shrink-0" />
          <span>Gönder ({checkedCount}/{totalPlatforms})</span>
        </button>
      </div>

      {/* HIZLI LİNK KOPYALA & DAVET KAPISI CANLI ÖNİZLEME */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(shareLinkOnly)
              .then(() => {
                setCopiedCaption(true);
                onNotifyToast(`Canlı başvuru linkiniz (${sharerCode}) kopyalandı!`);
                setTimeout(() => setCopiedCaption(false), 2200);
              })
              .catch(() => {});
          }}
          className="py-2 px-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Copy className="w-3 h-3 text-amber-400 shrink-0" />
          <span>{copiedCaption ? '✓ Link Kopyalandı' : 'Başvuru Linkini Kopyala'}</span>
        </button>

        <button
          type="button"
          onClick={() => onPreviewReferralPortal(sharerCode)}
          className="py-2 px-2.5 rounded-xl bg-indigo-950/70 hover:bg-indigo-900/70 border border-indigo-500/40 text-indigo-200 font-bold text-[10px] flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Sparkles className="w-3 h-3 text-indigo-300 shrink-0" />
          <span>Başvuru Ekranını Gör</span>
        </button>
      </div>

      {/* GÖNDER BUTONUNA BASILINCA AÇILAN TÜM SOSYAL MEDYA LİNKLERİ VE HAFTALIK TİK TAKİBİ */}
      {(showSocialList || checkedCount > 0) && (
        <div
          ref={socialListRef}
          className="bg-slate-950 border-2 border-amber-500/50 rounded-2xl p-3 space-y-2.5 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h4 className="text-[11px] font-black text-amber-300 uppercase">
                🌐 Sosyal Medya Yayın &amp; Haftalık Tik Listesi
              </h4>
              <p className="text-[9.5px] text-slate-400 font-semibold mt-0.5">
                Seçip yayınladığınız her mecrada yeşil tik (✅) oluşur; 7 günde bir otomatik sıfırlanır.
              </p>
            </div>
            <span className="shrink-0 text-[9.5px] font-mono font-black px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-emerald-400">
              {checkedCount}/{totalPlatforms} Tik
            </span>
          </div>

          <div className="space-y-1.5">
            {SOCIAL_MEDIA_PLATFORMS.map((platform) => {
              const publishedAt = entry.checked?.[platform.id];
              const isPublished = Boolean(publishedAt);
              const isBusy = busyPlatformId === platform.id;

              return (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => handlePublishToPlatform(platform)}
                  disabled={isBusy}
                  className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer active:scale-99 ${
                    isPublished
                      ? 'bg-emerald-950/45 border-emerald-500/60 shadow-sm shadow-emerald-500/10'
                      : `${platform.accentClass} hover:border-amber-400/60`
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0 border ${
                        isPublished
                          ? 'bg-emerald-500 text-slate-950 border-emerald-300 font-black'
                          : 'bg-slate-950/80 border-slate-700'
                      }`}
                    >
                      {isPublished ? <Check className="w-4 h-4 stroke-[3]" /> : platform.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10.5px] font-black text-white truncate flex items-center gap-1.5">
                        <span>{platform.name}</span>
                      </div>
                      <div className="text-[9px] text-slate-400 font-semibold truncate">
                        {isPublished
                          ? `✅ Yayınlandı (${publishedAt}) • Tekrar paylaşmak için dokunun`
                          : platform.linkLabel}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-1">
                    {isPublished ? (
                      <span className="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-black text-[9.5px] flex items-center gap-1">
                        <span>✅</span>
                        <span>Tiklendi</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-black text-[9.5px] flex items-center gap-1 shadow">
                        <span>{isBusy ? '...' : 'Yayınla'}</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-1 flex items-center justify-between text-[9px] text-slate-400 font-semibold border-t border-slate-800/80">
            <span className="flex items-center gap-1">
              <RefreshCw className="w-3 h-3 text-amber-400" />
              Her hafta otomatik sıfırlanır ve hatırlatma yapılır
            </span>
            <span className="text-emerald-400 font-mono font-bold">Ref: {sharerCode}</span>
          </div>
        </div>
      )}
    </div>
  );
};

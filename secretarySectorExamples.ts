export interface DynamicTrainingExampleChip {
  label: string;
  text: string;
}

export interface DynamicSecretaryTrainingPack {
  badgeLabel: string;
  addressPlaceholder: string;
  textareaPlaceholder: string;
  examples: DynamicTrainingExampleChip[];
  defaultCombinedText: string;
}

export const STALE_OR_GENERIC_KNOWLEDGE_SNIPPETS = [
  'Hizmetlerimiz, ürünlerimiz ve fiyatlarımız hakkında arayan müşteriye nazikçe bilgi ver, uygun saate randevu kaydet, acil konularda beni haberdar et.',
  'Santral Bayi Genel Merkez: 0850 hat veya dakika ücreti olmadan herkesin kendi cep numarası üzerinden çalışan yapay zekâ santral sistemi. Bayilik ve esnaf abonelik sorularını yanıtla, önemli konularda Kenan Bey ile görüştür.',
  'Reçete, ilaç hazırlama, nöbet bilgisi ve dermokozmetik ürünleri için bilgi ver; acil ilaç sorularında Bora Bey ile görüştür.',
  'Bölge bayilik başvuruları ve esnaf abonelik kurulumları hakkında bilgi ver, ciddi başvurularda yetkiliye bağla.',
  'Randevulu çalışıyoruz. Saç kesimi 450 TL, bakım 800 TL. Müşteri hangi gün ve saat istediğini söylerse uygun saati not alıp randevu oluştur.',
  'Beyaz eşya, kombi ve klima özel servisiyiz. Arıza tespit ücreti 500 TL olup onarım yapılırsa fiyattan düşülür. Aynı gün servis kaydı açılır; arayanın adresini ve cihaz markasını mutlaka öğren.',
  'Santral Bayi bölge temsilciliğiyiz. Esnafa aylık sabit paketle akıllı sekreter kuruyoruz, dakika ücreti ve ek cihaz yoktur. Bayilik veya abonelik soranların il-ilçe ve telefon bilgisini not al.',
];

export function isGenericOrLegacyKnowledgeText(raw: string | undefined | null): boolean {
  const cur = String(raw || '').trim();
  if (!cur) return true;
  if (STALE_OR_GENERIC_KNOWLEDGE_SNIPPETS.includes(cur)) return true;
  if (cur.includes('Saç kesimi 450 TL, bakım 800 TL')) return true;
  return false;
}

export function buildDynamicSecretaryTrainingPack(params: {
  profession: string;
  shopName: string;
  fullName: string;
  gender?: string;
  province?: string;
  district?: string;
  origin?: string;
}): DynamicSecretaryTrainingPack {
  const rawProf = (params.profession || '').trim();
  const p = rawProf.toLocaleLowerCase('tr-TR');
  const prov = (params.province || '').trim() || 'İstanbul';
  const dist = (params.district || '').trim() || 'Merkez';
  const locText = dist && dist !== 'Merkez' ? `${dist} / ${prov}` : prov;

  const firstName = (params.fullName || '').trim().split(/\s+/)[0] || '';
  const honorificSuffix = params.gender === 'Kadın' ? 'Hanım' : 'Bey';
  const officer = firstName ? `${firstName} ${honorificSuffix}` : 'yetkilimiz';

  const cleanShop = (params.shopName || '').trim();
  const origin = (params.origin || 'esnaf').trim();
  const shopLabel =
    cleanShop || (rawProf ? `${dist} ${rawProf.split('/')[0].trim()}` : 'İşletmemiz');

  const addressPlaceholder = `Örn: Atatürk Cad. No:18 ${locText} (Merkez karşısı)`;

  const packFrom = (
    badgeLabel: string,
    defaultCombinedText: string,
    examples: DynamicTrainingExampleChip[]
  ): DynamicSecretaryTrainingPack => ({
    badgeLabel,
    addressPlaceholder,
    textareaPlaceholder: defaultCombinedText,
    examples,
    defaultCombinedText,
  });

  // 1) YAZILIM / WEB TASARIM & DİJİTAL AJANS (Kenan Usta'nın seçimi dahil tüm panellerde öncelikli!)
  if (
    p.includes('yazılım') ||
    p.includes('web tasarım') ||
    p.includes('dijital ajans') ||
    p.includes('mobil uygulama') ||
    p.includes('otomasyon')
  ) {
    const heroText = `${shopLabel} olarak kurumsal web tasarım, mobil uygulama ve özel yazılım projeleri geliştiriyoruz. Yeni iş için arayan müşteriden yaptırmak istediği projeyi (mobil uygulama, web sitesi, e-ticaret veya otomasyon) öğrenip ${officer} ile proje analiz görüşmesi için randevu oluştur. Mevcut müşterimiz acil teknik destek için arıyorsa bekletmeden doğrudan ${officer}'e bağla.`;
    return packFrom('💻 Yazılım & Dijital Ajans', heroText, [
      {
        label: '+ Mobil Uygulama & Özel Yazılım Teklifi',
        text: `${shopLabel} bünyesinde iOS/Android mobil uygulama, özel yönetim paneli ve yapay zekâ otomasyon projeleri geliştiriyoruz; projenin kapsamını ve hedef süresini öğrenip teklif toplantısı planla.`,
      },
      {
        label: '+ Web Tasarım & E-Ticaret Randevusu',
        text: `Kurumsal web sitesi, e-ticaret altyapısı veya dijital reklam yönetimi soran müşterinin sektörünü öğrenip ${officer} ile ücretsiz analiz görüşmesi randevusu oluştur.`,
      },
      {
        label: `+ Mevcut Müşteri Acil Destek -> ${officer}'e Bağla`,
        text: `Mevcut müşterimiz canlı sistem, sunucu veya acil teknik destek için arıyorsa bekletmeden doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  // 2) SADECE BAYİLİK / KOORDİNATÖRLÜK MESLEĞİ GİRİLEN BAYİ PANELLERİ
  if (
    !rawProf ||
    p.includes('bayilik') ||
    p.includes('bayi yönetimi') ||
    p.includes('abone merkezi') ||
    p.includes('koordinatör')
  ) {
    if (origin === 'iller_bayi') {
      const heroText = `${cleanShop || 'Türkiye İller Koordinatörlüğü'} olarak 81 ilde boş olan iller için 1.000 TL lisanslı yetkili İl Bayiliği başvurularını değerlendiriyoruz. Arayan adayın talep ettiği ili ve ticari geçmişini not alıp ${officer} ile yetki görüşmesi planla; hemen il lisansı almak isteyen ciddi adayları bekletmeden ${officer}'e bağla.`;
      return packFrom('🇹🇷 Türkiye İller Bayisi', heroText, [
        {
          label: '+ 81 İl Yetki & Lisans Bilgisi',
          text: `Boş illerimizde 1.000 TL lisansla İl Bayiliği veriyoruz; İl Bayimiz kendi ilindeki ilçelere bayilik açarak %50 lisans primi ve her ay düzenli abone payı kazanır.`,
        },
        {
          label: '+ İl Aday Başvuru Kaydı',
          text: `İl bayiliği soran adayın istediği ili, adını ve iletişim numarasını eksiksiz kaydedip ön görüşme randevusu oluştur.`,
        },
        {
          label: `+ Ciddi Yatırımcıyı -> ${officer}'e Bağla`,
          text: `Şartları onaylayıp hemen il yetkisi almak isteyen ciddi adayları bekletmeden doğrudan ${officer} ile görüştür.`,
        },
      ]);
    }

    if (origin === 'il_bayi') {
      const heroText = `${cleanShop || `${prov} İl Bayiliği`} olarak ${prov} genelindeki ilçelere 500 TL lisanslı yetkili İlçe Bayiliği veriyoruz. İlçe bayiliği isteyen adayın talep ettiği ilçeyi not al; doğrudan abone olmak isteyen esnafların bilgisini alıp ilgili ilçe bayimize yönlendir, hazır adayları doğrudan ${officer}'e bağla.`;
      return packFrom(`🏙️ ${prov} İl Bayisi`, heroText, [
        {
          label: `+ ${prov} İlçe Bayilik Şartları`,
          text: `${prov} sınırları içindeki boş ilçelere 500 TL lisansla yetkili İlçe Bayiliği açıyoruz; ilçe bayimiz kendi ilçesindeki esnafı abone yaparak her ay düzenli gelir elde eder.`,
        },
        {
          label: '+ İlçe Aday & Esnaf Kaydı',
          text: `Bayilik soranların istediği ilçeyi kaydet; esnaf aboneliği soranların dükkan adını ve ilçesini alıp kurulum için yönlendir.`,
        },
        {
          label: `+ Bayi Adayını -> ${officer}'e Bağla`,
          text: `İlçe yetkisi almak için hazır olan adayları bekletmeden ${officer} ile ön görüşmeli bağla.`,
        },
      ]);
    }

    if (origin === 'ilce_bayi') {
      const heroText = `${cleanShop || `${prov} ${dist} İlçe Bayiliği`} olarak ${dist} esnafına 0850 numara veya dakika ücreti olmadan, kendi cep telefonlarıyla çalışan akıllı sekreter kuruyoruz. Arayan esnafın mesleğini ve dükkan adını öğrenip canlı tanıtım/kurulum randevusu oluştur; hemen abone olmak isteyen esnafı doğrudan ${officer}'e bağla.`;
      return packFrom(`🛡️ ${dist} İlçe Bayisi`, heroText, [
        {
          label: `+ ${dist} Esnaf Sabit Paket Bilgisi`,
          text: `Dakika başı ücret veya ek cihaz olmadan, esnafın kendi cep numarasıyla 7/24 arayanı tanıyan ve randevu alan akıllı sekreter kuruyoruz.`,
        },
        {
          label: '+ Yerinde Tanıtım & Kurulum Randevusu',
          text: `Sistemi denemek isteyen esnafın dükkan adını, yaptığı işi ve müsait saatini not alıp kurulum randevusu oluştur.`,
        },
        {
          label: `+ Hemen Kurulum İsteyeni -> ${officer}'e Bağla`,
          text: `Hemen abonelik başlatmak isteyen esnafları bekletmeden doğrudan ${officer} hattına bağla.`,
        },
      ]);
    }
  }

  // 3) ECZACI / ECZANE
  if (p.includes('eczac') || p.includes('eczane')) {
    const heroText = `${shopLabel} olarak reçeteli ilaç hazırlama, ilaç stok kontrolü, nöbetçi eczane bilgilendirmesi ve dermokozmetik/vitamin danışmanlığı sunuyoruz. İlaç soran hastanın e-reçete numarasını veya ilaç adını öğrenip hazırlık notu al; ilaç etkileşimi, dozaj veya acil ilaç temini sorulursa hiç bekletmeden sorumlu eczacımız ${officer}'e bağla.`;
    return packFrom('💊 Eczacı / Eczane', heroText, [
      {
        label: '+ E-Reçete & İlaç Stok Hazırlama',
        text: `Arayan hastanın sorduğu ilacın adını veya e-reçete kodunu not al; eczaneye gelmeden ilacının hazırlanması için kayıt bırak.`,
      },
      {
        label: '+ Nöbetçi Eczane & Dermokozmetik',
        text: `Nöbet günlerimiz, dermokozmetik cilt ürünleri, anne-bebek ürünleri ve vitamin takviyeleri hakkında bilgi ver.`,
      },
      {
        label: `+ İlaç Danışma -> ${officer}'e Bağla`,
        text: `İlaç kullanımı, yan etki veya acil bulunmayan ilaç sorulursa bekletmeden doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  // 4) DİŞ HEKİMİ / AĞIZ VE DİŞ SAĞLIĞI
  if (p.includes('diş')) {
    const heroText = `${shopLabel} kliniğimizde panoramik röntgenli ilk diş muayenesi, implant, zirkonyum estetik kaplama, kanal tedavisi, dolgu ve diş taşı temizliği işlemleri randevulu yapılmaktadır. Hastanın şikayetini öğrenip uygun saate muayene randevusu oluştur; şiddetli diş ağrısı, apse/şişlik veya kırık bildiren acil hastaları öncelikli olarak ${officer}'e bağla.`;
    return packFrom('🦷 Diş Kliniği', heroText, [
      {
        label: '+ İmplant, Kaplama & Muayene Bilgisi',
        text: `Kesin tedavi fiyatının röntgen ve hekim muayenesi sonrası netleştiğini belirtip ilk muayene ve planlama randevusu öner.`,
      },
      {
        label: '+ Diş Temizliği & Tedavi Randevusu',
        text: `Hastanın yaptırmak istediği işlemi (dolgu, kanal, beyazlatma, tel kontrolü) ve uygun gün-saatini öğrenip ajandaya randevu aç.`,
      },
      {
        label: `+ Şiddetli Ağrı / Acil -> ${officer}'e Bağla`,
        text: `Dayanılmaz ağrı, yüz şişliği veya travma bildiren hastaları bekletmeden doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  // 5) VETERİNER HEKİM & PET KLİNİK / PET GROOMING
  if (p.includes('veteriner') || p.includes('pet')) {
    const heroText = `${shopLabel} olarak kedi-köpek genel muayene, karma/kuduz aşılama, iç-dış parazit, kısırlaştırma, pet kuaför tıraşı ve pet otel hizmeti veriyoruz. Arayan hayvan sahibinden sevimli dostumuzun türünü, yaşını ve talebini öğrenip randevu oluştur; trafik kazası, zehirlenme veya nefes darlığı gibi acil durumlarda saniye bekletmeden ${officer}'e bağla.`;
    return packFrom('🐾 Veteriner & Pet Klinik', heroText, [
      {
        label: '+ Muayene & Aşı Takvimi Randevusu',
        text: `Aşı veya muayene için arayan müşteriden kedi/köpeğin cinsini, yaşını ve uygun saatini alıp klinik randevusu oluştur.`,
      },
      {
        label: '+ Pet Kuaför (Makas Tıraşı) & Pansiyon',
        text: `Anestezisiz pet tıraşı, banyo ve pet konaklama için hayvanın kilosunu ve tarih aralığını not alıp rezervasyon aç.`,
      },
      {
        label: `+ Acil Travma / Zehirlenme -> ${officer}'e Bağla`,
        text: `Kanama, düşme, zehirlenme veya doğum gibi acil vakaları hiç bekletmeden doğrudan hekimimiz ${officer}'e bağla.`,
      },
    ]);
  }

  // 6) DOKTOR / ÖZEL KLİNİK & TIP MERKEZİ
  if (p.includes('doktor') || p.includes('tıp') || (p.includes('klinik') && !p.includes('psikolog'))) {
    const heroText = `${shopLabel} bünyesinde uzman hekim muayenesi, kontrol görüşmesi ve tetkik değerlendirmeleri randevu ile yapılmaktadır. Hastanın adını, şikayet konusunu ve tercih ettiği gün-saati öğrenip muayene randevusu oluştur; tahlil sonucu bekleyen veya acil tıbbi durumu olan hastaları doğrudan ${officer}'e bağla.`;
    return packFrom('🩺 Özel Klinik & Muayenehane', heroText, [
      {
        label: '+ İlk Muayene & Kontrol Randevusu',
        text: `İlk muayene veya ücretsiz kontrol süresi içindeki hastaların adını ve uygun gün-saatini öğrenip randevu oluştur.`,
      },
      {
        label: '+ Tahlil / MR Sonuç Görüşmesi',
        text: `Tetkik veya rapor sonucu göstermek isteyen hastaların bilgilerini not alıp sonuç değerlendirme saati planla.`,
      },
      {
        label: `+ Acil Hasta -> ${officer}'e Bağla`,
        text: `Yüksek ateş, şiddetli ağrı veya operasyon sonrası acil sorusu olan hastaları bekletmeden ${officer} hattına bağla.`,
      },
    ]);
  }

  // 7) PSİKOLOG / DANIŞMANLIK MERKEZİ
  if (p.includes('psikolog') || p.includes('terapi') && !p.includes('fizyo')) {
    const heroText = `${shopLabel} merkezimizde bireysel yetişkin terapisi, çift-aile danışmanlığı, çocuk-ergen psikolojisi ve online terapi seanslarımız 50 dakika sürmekte olup gizlilik esasıyla randevulu yürütülmektedir. Danışanın tercih ettiği görüşme türünü (yüz yüze / online) ve uygun gün-saatini öğrenip seans randevusu oluştur; kriz veya acil görüşme taleplerini ${officer}'e ilet.`;
    return packFrom('🧠 Psikolog & Danışmanlık', heroText, [
      {
        label: '+ Bireysel / Çift Terapisi (50 dk)',
        text: `Seanslarımızın 50 dakika sürdüğünü ve hem yüz yüze hem online yapılabildiğini belirtip ilk görüşme randevusu oluştur.`,
      },
      {
        label: '+ Çocuk & Ergen Danışmanlığı',
        text: `Çocuk ve ergen görüşmelerinde ilk seansın ebeveyn değerlendirmesi şeklinde planlandığını belirtip uygun saati kaydet.`,
      },
      {
        label: `+ Uzman Görüşmesi -> ${officer}'e Bağla`,
        text: `Seans saati değişikliği veya doğrudan uzmanımızla ön bilgi görüşmesi isteyen danışanları ${officer} ile görüştür.`,
      },
    ]);
  }

  // 8) DİYETİSYEN / BESLENME DANIŞMANI
  if (p.includes('diyetisyen') || p.includes('beslenme')) {
    const heroText = `${shopLabel} ofisimizde profesyonel vücut yağ-kas analizi, kişiye özel kilo verme/alma programları, hastalıklarda beslenme ve online diyet takibi yapılmaktadır. Arayan danışanın hedefini öğrenip ilk ölçüm ve tanışma randevusu oluştur; aktif danışanlarımızın liste sorularını not alıp gerektiğinde ${officer}'e bağla.`;
    return packFrom('🥗 Diyetisyen & Beslenme', heroText, [
      {
        label: '+ Vücut Analizi & Aylık Paket Bilgisi',
        text: `İlk görüşmede detaylı vücut analizi yapıldığını ve haftalık kontrollerle kişisel beslenme listesi hazırlandığını anlat.`,
      },
      {
        label: '+ Yüz Yüze & Online Diyet Randevusu',
        text: `Şehir içi yüz yüze veya şehir dışı WhatsApp takipli online diyet için uygun gün ve saate randevu oluştur.`,
      },
      {
        label: `+ Danışan Sorusu -> ${officer}'e Bağla`,
        text: `Özel sağlık durumu veya kurumsal beslenme danışmanlığı için arayanları doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  // 9) FİZYOTERAPİ & MANUEL TERAPİ
  if (p.includes('fizyoterapi') || p.includes('manuel terapi')) {
    const heroText = `${shopLabel} merkezimizde bel-boyun fıtığı, duruş bozuklukları, manuel terapi, klinik pilates ve ortopedik rehabilitasyon seansları değerlendirme eşliğinde uygulanmaktadır. Danışanın ağrı bölgesini ve varsa MR/doktor raporu bilgisini öğrenip ilk değerlendirme seansı randevusu oluştur; akut tutulma yaşayanları hemen ${officer}'e bağla.`;
    return packFrom('🦴 Fizyoterapi & Manuel Terapi', heroText, [
      {
        label: '+ İlk Değerlendirme & Manuel Terapi',
        text: `İlk seansta postür ve hareket analizi yapılarak kişiye özel seans planı çıkarıldığını belirtip randevu saati oluştur.`,
      },
      {
        label: '+ Bel-Boyun Fıtığı & Klinik Pilates',
        text: `Danışanın şikayetini ve varsa MR sonucunu yanında getirmesini hatırlatarak uygun saate kayıt aç.`,
      },
      {
        label: `+ Akut Ağrı / Tutulma -> ${officer}'e Bağla`,
        text: `Şiddetli bel/boyun tutulması yaşayan veya evde fizik tedavi soran hastaları doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  // 10) TIRNAK STUDIO & PROTEZ TIRNAK
  if (p.includes('tırnak')) {
    const heroText = `${shopLabel} stüdyomuzda protez tırnak, jel güçlendirme, kalıcı oje, medikal manikür-pedikür ve nail art tasarımları steril ekipmanlarla randevulu uygulanmaktadır. Müşterinin istediği işlemi (yeni set / bakım / çıkartma) öğrenip işlem süresine göre randevu oluştur; özel tasarım veya toplu gelin grubu taleplerini ${officer}'e bağla.`;
    return packFrom('💅 Tırnak Studio & Nail Art', heroText, [
      {
        label: '+ Protez Tırnak & Kalıcı Oje Randevusu',
        text: `Yeni protez tırnak, jel bakım veya kalıcı oje işleminden hangisini istediğini sorup ortalama 60-90 dakikalık randevu aç.`,
      },
      {
        label: '+ Medikal Manikür & Pedikür',
        text: `El-ayak bakımı ve batık tırnak bakımı için müşterinin istediği gün ve saati kaydedip randevu oluştur.`,
      },
      {
        label: `+ Özel Nail Art / Grup -> ${officer}'e Bağla`,
        text: `Özel görselli tasarım fiyatı veya gelin-nedime grup randevusu soranları doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  // 11) LAZER EPİLASYON & ESTETİK
  if (p.includes('lazer') || p.includes('estetik')) {
    const heroText = `${shopLabel} merkezimizde buz başlıklı lazer epilasyon, medikal cilt bakımı, bölgesel incelme ve leke/akne protokolleri uzman estetisyenlerimizce uygulanmaktadır. Arayan danışanın ilgilendiği bölge/paketi öğrenip ücretsiz cilt-kıl analizi ve deneme atışı randevusu oluştur; kampanya onayı veya uzman sorusu olanları ${officer}'e bağla.`;
    return packFrom('✨ Lazer Epilasyon & Estetik', heroText, [
      {
        label: '+ Lazer Paket & Ücretsiz Analiz',
        text: `Tüm vücut lazer epilasyon ve cilt bakımı paketlerimiz için ücretsiz ön analiz ve deneme randevusu oluşturabileceğini belirt.`,
      },
      {
        label: '+ Seans & Kontrol Randevusu',
        text: `Mevcut danışanlarımızın seans veya kontrol randevusu için adını ve uygun gün-saatini öğrenip ajandaya işle.`,
      },
      {
        label: `+ Kampanya & Paket Fiyatı -> ${officer}'e Bağla`,
        text: `Taksitli paket fiyatları veya kombine işlem indirimi soran müşterileri doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  // 12) SPA, MASAJ & HAMAM
  if (p.includes('spa') || p.includes('masaj') || p.includes('hamam')) {
    const heroText = `${shopLabel} tesisimizde aromaterapi masajı, medikal sırt-boyun masajı, Bali/Thai masajı ve geleneksel kese-köpük hamam paketleri rezervasyonla sunulmaktadır. Misafirin kişi sayısını, istediği masaj süresini (50/80 dk) ve geliş saatini öğrenip rezervasyon oluştur; çift/VIP süit veya gelin hamamı taleplerini ${officer}'e bağla.`;
    return packFrom('🧖 Spa, Masaj & Hamam', heroText, [
      {
        label: '+ Masaj & Kese-Köpük Paketleri',
        text: `Aromaterapi, derin doku masajı ve Türk hamamı paketlerimizin süre ve içerikleri hakkında bilgi verip saat ayırt.`,
      },
      {
        label: '+ Kişi Sayısı & Saat Rezervasyonu',
        text: `Kaç kişi geleceklerini ve tercih ettikleri seans saatini not alıp rezervasyon kaydı oluştur.`,
      },
      {
        label: `+ VIP Çift Odası / Grup -> ${officer}'e Bağla`,
        text: `Gelin hamamı, grup kapatma veya VIP jakuzili süit taleplerini doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  // 13) ERKEK BERBERİ & ERKEK BAKIM
  if (p.includes('berber')) {
    const heroText = `${shopLabel} salonumuzda anatomik saç-sakal kesimi, sıcak havlu sakal bakımı, cilt maskesi, keratin bakım ve VIP damat tıraşı randevulu yapılmaktadır. Müşteriyi bekletmemek için yaptıracağı işlemi ve gelmek istediği saati öğrenip randevu oluştur; damat tıraşı veya acil araya girme taleplerini ${officer}'e sorup bağla.`;
    return packFrom('💈 Erkek Berberi & Bakım', heroText, [
      {
        label: '+ Saç-Sakal & Erkek Bakım Randevusu',
        text: `Saç kesimi, sakal tasarımı veya cilt bakımı için müşterinin istediği saati öğrenip sıra beklememesi için randevu yaz.`,
      },
      {
        label: '+ Damat Tıraşı & VIP Paket',
        text: `Damat tıraşı ve sağdıç grubu için düğün tarihini ve çıkış saatini not alıp özel saat bloğu ayır.`,
      },
      {
        label: `+ Saat Değişikliği / Acil -> ${officer}'e Bağla`,
        text: `Hemen koltuk müsaitliği soran veya ${officer} ile bizzat görüşmek isteyen müşterileri hatta bekletip bağla.`,
      },
    ]);
  }

  // 14) KADIN KUAFÖRÜ & GÜZELLİK SALONU
  if (p.includes('kuaför') || p.includes('güzellik')) {
    const heroText = `${shopLabel} salonumuzda kesim-fön, ombre/sombre renklendirme, brezilya fönü, profesyonel makyaj, türban/gelin başı ve manikür-pedikür işlemleri randevulu yapılmaktadır. Müşterinin istediği işlemi ve saç uzunluğunu/detayını öğrenip uygun saate randevu oluştur; gelin başı veya renk değişimi fiyat danışmasını ${officer}'e bağla.`;
    return packFrom('✂️ Kadın Kuaförü & Güzellik', heroText, [
      {
        label: '+ Kesim, Fön & Renklendirme Randevusu',
        text: `Ombre, boya, röfle veya kesim-fön işlemlerinden hangisini istediğini sorup işlem süresine uygun randevu oluştur.`,
      },
      {
        label: '+ Gelin Başı & Özel Gün Hazırlığı',
        text: `Gelin başı, nişan saç-makyaj ve prova talepleri için organizasyon tarihini ve saatini öğrenip kayıt aç.`,
      },
      {
        label: `+ Saç Analizi & Fiyat -> ${officer}'e Bağla`,
        text: `Özel renklendirme/keratin fiyatı veya doğrudan stilistimiz ${officer} ile görüşmek isteyenleri bağla.`,
      },
    ]);
  }

  // 15) OTO TAMİR, MEKANİK & BAKIM / OTO LASTİK & ROT BALANS / OTO CAM / EKSPERTİZ / YIKAMA / KİRALAMA
  if (p.includes('ekspertiz')) {
    const heroText = `${shopLabel} merkezimizde TSE standartlarında motor-mekanik, kaporta-boya, şasi-airbag, dyno ve beyin arıza tespit oto ekspertiz paketleri uygulanmaktadır. Alıcı veya satıcıdan aracın marka-modelini ve geliş saatini öğrenip sıra beklemeden ekspertiz randevusu oluştur; filo veya özel kontrol sorularını ${officer}'e bağla.`;
    return packFrom('🔍 Oto Ekspertiz Merkezi', heroText, [
      {
        label: '+ Tam Kapsamlı Ekspertiz Paketleri',
        text: `Kaporta-boya, motor-mekanik, alt takım ve airbag kontrollerini içeren ekspertiz paketlerimiz hakkında bilgi ver.`,
      },
      {
        label: '+ Noter Öncesi Hızlı Randevu',
        text: `Aracın marka-modelini ve plakasını alıp noter satışı öncesi beklememeleri için saatlik randevu oluştur.`,
      },
      {
        label: `+ Rapor & Teknik Soru -> ${officer}'e Bağla`,
        text: `Yapılmış ekspertiz raporu hakkında teknik soru soran müşterileri doğrudan uzmanımız ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('oto lastik') || p.includes('rot balans')) {
    const heroText = `${shopLabel} servisimizde yaz-kış lastik değişimi, bilgisayarlı rot-balans ayarı, jant düzeltme, lastik oteli ve akü değişimi yapılmaktadır. Arayan sürücüden lastik ebadını (ör. 205/55 R16) veya aracın modelini öğrenip fiyat/stok notu al ve randevu aç; yolda lastiği patlayan acil müşteriyi hemen ${officer}'e bağla.`;
    return packFrom('🛞 Oto Lastik & Rot Balans', heroText, [
      {
        label: '+ Lastik Ebadı & Mevsimlik Değişim',
        text: `Müşterinin aradığı lastik ölçüsünü ve mevsimlik değişim/lastik oteli talebini öğrenip randevu saati ver.`,
      },
      {
        label: '+ Bilgisayarlı Rot-Balans & Jant',
        text: `Direksiyon titremesi veya çekme şikayeti olan araçlar için rot-balans kontrol randevusu oluştur.`,
      },
      {
        label: `+ Yol Yardım / Acil Lastik -> ${officer}'e Bağla`,
        text: `Yolda lastiği yarılan veya aküsü biten acil sürücüleri bekletmeden ${officer} hattına bağla.`,
      },
    ]);
  }

  if (p.includes('oto cam') || p.includes('film kaplama')) {
    const heroText = `${shopLabel} merkezimizde kaskodan hasarsız ön/yan oto cam değişimi, çatlak cam onarımı, ısı kesici cam filmi ve PPF boya koruma uygulamaları yapılmaktadır. Aracın marka-model-yılını ve kasko/bireysel işlem tercihini öğrenip uygulama randevusu oluştur; cam stok ve kasko onayı için ${officer}'e bağla.`;
    return packFrom('🚘 Oto Cam & Film Kaplama', heroText, [
      {
        label: '+ Kaskodan Oto Cam Değişimi',
        text: `Aracın marka-model-yılını ve hangi camın kırıldığını öğren; kasko poliçesiyle ücretsiz değişim için kayıt aç.`,
      },
      {
        label: '+ Cam Filmi & PPF Kaplama Randevusu',
        text: `Cam filmi ton tercihi veya kaput/tam araç PPF kaplama için araç modelini alıp uygulama randevusu oluştur.`,
      },
      {
        label: `+ Stok & Fiyat Onayı -> ${officer}'e Bağla`,
        text: `Orijinal/yerli cam stok sorgusu veya net kaplama teklifi isteyenleri doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  if (p.includes('oto yıkama') || p.includes('detailing')) {
    const heroText = `${shopLabel} uygulama merkezimizde detaylı iç-dış yıkama, antibakteriyel koltuk-tavan temizliği, pasta-cila, seramik kaplama ve motor temizliği yapılmaktadır. Aracın binek mi SUV mu olduğunu ve istenen paketi öğrenip saatlik randevu oluştur; seramik/boya koruma fiyat görüşmelerini ${officer}'e bağla.`;
    return packFrom('🧽 Oto Yıkama & Detailing', heroText, [
      {
        label: '+ İç-Dış Yıkama & Detaylı Kuaför',
        text: `Aracın tipini ve istediği yıkama/iç detaylı temizlik paketini öğrenip sıra beklememesi için saat ayır.`,
      },
      {
        label: '+ Pasta Cila & Seramik Kaplama',
        text: `Boya koruma, far parlatma ve seramik kaplama için araç modelini not alıp uygulama randevusu oluştur.`,
      },
      {
        label: `+ Özel Uygulama Teklifi -> ${officer}'e Bağla`,
        text: `Araç durumu ve paket fiyatı konuşmak isteyen müşterileri doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  if (p.includes('rent a car') || p.includes('oto kiralama') || p.includes('transfer')) {
    const heroText = `${shopLabel} filomuzda kaskolu günlük, haftalık ve aylık binek/SUV araç kiralama ile havalimanı VIP transfer hizmeti sunulmaktadır. Müşteriden alış-iade tarihlerini, vites/yakıt tercihini öğrenip rezervasyon talebi oluştur; hemen araç teslimi veya uzun dönem filo teklifi isteyenleri doğrudan ${officer}'e bağla.`;
    return packFrom('🚙 Rent a Car & VIP Transfer', heroText, [
      {
        label: '+ Günlük / Haftalık Araç Müsaitliği',
        text: `İstenen tarih aralığını, vites tipini (otomatik/manuel) ve teslim noktasını öğrenip rezervasyon kaydı aç.`,
      },
      {
        label: '+ Havalimanı VIP Transfer Kaydı',
        text: `Uçuş saatini, iniş/biniş adresini ve yolcu sayısını not alıp VIP transfer planlaması oluştur.`,
      },
      {
        label: `+ Acil Araç & Filo Teklifi -> ${officer}'e Bağla`,
        text: `Bugün hemen araç kiralamak isteyen veya aylık kurumsal kiralama soranları doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('oto tamir') || p.includes('mekanik') || p.includes('oto')) {
    const heroText = `${shopLabel} servisimizde periyodik yağ-filtre bakımı, triger-baskı balata, fren sistemi, motor-şanzıman revizyonu ve bilgisayarlı arıza tespiti yapılmaktadır. Sürücüden aracın marka-modelini, yılını ve arıza şikayetini öğrenip servis randevusu oluştur; yolda kalan veya çekiciyle araç gönderecek müşteriyi bekletmeden ustamız ${officer}'e bağla.`;
    return packFrom('🚗 Oto Tamir & Mekanik', heroText, [
      {
        label: '+ Periyodik Bakım & Arıza Randevusu',
        text: `Aracın marka-model-yılını, motor tipini ve yapılacak bakımı öğrenip uygun saate servis kaydı aç.`,
      },
      {
        label: '+ Servisteki Araç Durum Sorgusu',
        text: `Serviste olan aracının durumunu soran müşterinin plakasını not alıp usta bilgilendirmesi için kayıt bırak.`,
      },
      {
        label: `+ Yolda Kalan / Acil Arıza -> ${officer}'e Bağla`,
        text: `Aracı çalışmayan, hararet yapan veya çekici üzerinde gelen müşterileri saniye bekletmeden ${officer}'e bağla.`,
      },
    ]);
  }

  // 16) KLİMA, KOMBİ / BEYAZ EŞYA / TELEFON / BİLGİSAYAR / GÜVENLİK KAMERASI / ELEKTRİK-TESİSAT / ÇİLİNGİR
  if (p.includes('klima') || p.includes('kombi') || p.includes('ısıtma')) {
    const heroText = `${shopLabel} olarak tüm marka kombi ve klimalarda arıza onarımı, yıllık bakım, gaz dolumu, montaj ve ilaçlı petek temizliği yapıyoruz. Müşteriden cihazın markasını, ekrandaki arıza kodunu ve açık adresini öğrenip aynı gün servis kaydı oluştur; kışın ısınmayan bebekli/yaşlı aileleri veya su akıtan acil arızaları hemen ${officer}'e bağla.`;
    return packFrom('❄️ Klima & Kombi Servisi', heroText, [
      {
        label: '+ Kombi / Klima Arıza & Servis Kaydı',
        text: `Cihazın markasını, şikayetini (ısıtmama, su akıtma, ses, arıza kodu) ve açık adresi alıp aynı gün servis aç.`,
      },
      {
        label: '+ Yıllık Bakım & Petek Temizliği',
        text: `Kombi-klima periyodik bakımı ve makineli petek temizliği için müşterinin uygun gün ve saatine randevu oluştur.`,
      },
      {
        label: `+ Acil Arıza / Montaj -> ${officer}'e Bağla`,
        text: `Gaz kokusu, şiddetli su kaçağı veya sıfır klima montaj keşfi için arayanları doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('beyaz eşya') || p.includes('ev aletleri')) {
    const heroText = `${shopLabel} olarak buzdolabı, çamaşır makinesi, bulaşık makinesi, kurutma makinesi ve fırın arızalarında garantili yerinde tamir hizmeti veriyoruz. Arayan müşteriden cihazın türünü, markasını ve arızasını öğrenip açık adresiyle aynı gün servis kaydı aç; soğutmayan buzdolabı gibi acil durumları hemen ${officer}'e bağla.`;
    return packFrom('🧺 Beyaz Eşya Servisi', heroText, [
      {
        label: '+ Yerinde Arıza Tespit & Onarım Kaydı',
        text: `Arızalı cihazın markasını, şikayetini ve mahalle/açık adres bilgisini eksiksiz alıp servis sırasına kaydet.`,
      },
      {
        label: '+ Buzdolabı Acil Soğutmama Önceliği',
        text: `Buzdolabı veya derin dondurucu soğutmama arızalarında gıdalar bozulmaması için aynı gün öncelikli kayıt aç.`,
      },
      {
        label: `+ Yedek Parça & Garanti -> ${officer}'e Bağla`,
        text: `Kart/motor değişim fiyatı veya daha önce baktığımız cihazın durumunu soranları doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('cep telefonu') || p.includes('tablet') || p.includes('cihaz tamiri')) {
    const heroText = `${shopLabel} servisimizde iPhone, Samsung ve tüm marka telefon-tabletler için hızlı ekran değişimi, orijinal kapasiteli batarya değişimi, şarj soketi, sıvı teması ve anakart onarımı yapılmaktadır. Cihazın tam modelini ve arızasını öğrenip işlem süresi/fiyat notu oluştur; sıvı teması olan veya servisteki cihazını soranları ${officer}'e bağla.`;
    return packFrom('📱 Cep Telefonu & Tablet Tamiri', heroText, [
      {
        label: '+ Ekran & Batarya Hızlı Değişim',
        text: `Telefonun tam marka-modelini (ör. iPhone 14 Pro, S23) ve kırık/batarya şikayetini öğrenip stok ve randevu kaydı aç.`,
      },
      {
        label: '+ Sıvı Teması & Anakart Onarımı',
        text: `Suya düşen cihazın şarja takılmaması gerektiğini hatırlatıp acil müdahale için dükkâna yönlendir.`,
      },
      {
        label: `+ Tamirdeki Cihaz / Veri Kurtarma -> ${officer}'e Bağla`,
        text: `Servisteki cihazını soran veya acil veri kurtarma isteyen müşterileri doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  if (p.includes('güvenlik kamerası') || p.includes('alarm')) {
    const heroText = `${shopLabel} olarak ev, apartman, fabrika ve iş yerlerine gece görüşlü IP güvenlik kamerası, plaka okuma, hırsız/yangın alarmı ve şifreli geçiş sistemleri kuruyoruz. Arayan müşteriden mekanın türünü, yaklaşık kamera adedini ve semtini öğrenip ücretsiz yerinde keşif randevusu oluştur; arıza ve acil kurulum taleplerini ${officer}'e bağla.`;
    return packFrom('📹 Güvenlik Kamerası & Alarm', heroText, [
      {
        label: '+ Ücretsiz Yerinde Keşif & Kamera Sayısı',
        text: `Kurulum yapılacak yerin dükkân, bina veya depo mu olduğunu ve kaç kamera düşünüldüğünü öğrenip keşif randevusu aç.`,
      },
      {
        label: '+ Kayıt Cihazı & Cep İzleme Arızası',
        text: `Mevcut kamera sisteminde görüntü kesilmesi veya telefondan izleme sorunu yaşayanların adresini alıp servis yaz.`,
      },
      {
        label: `+ Kurumsal Proje Teklifi -> ${officer}'e Bağla`,
        text: `Site yönetimi, fabrika veya çok kameralı ihale/proje teklifleri için arayanları doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('bilgisayar') || p.includes('laptop') || p.includes('it teknik')) {
    const heroText = `${shopLabel} olarak laptop-masaüstü tamiri, SSD/RAM hızlandırma, anakart-ekran kartı onarımı, format/veri kurtarma ve şirketlere kurumsal IT bakım anlaşması sunuyoruz. Cihazın modelini ve arızasını öğrenip servis kaydı oluştur; şirketi duran kurumsal arıza veya veri kurtarma taleplerini bekletmeden ${officer}'e bağla.`;
    return packFrom('🖥️ Bilgisayar & IT Servis', heroText, [
      {
        label: '+ Laptop Tamiri, Format & Hızlandırma',
        text: `Cihazın markasını ve şikayetini (açılmama, ısınma, yavaşlık, kırık ekran) öğrenip teknik servis kaydı oluştur.`,
      },
      {
        label: '+ Şirketlere Kurumsal Bakım & Ağ Desteği',
        text: `Ofis ağı, yazıcı, sunucu veya yıllık bakım anlaşması soran firmaların bilgilerini alıp keşif toplantısı planla.`,
      },
      {
        label: `+ Acil Sunucu / Veri Kurtarma -> ${officer}'e Bağla`,
        text: `İş yeri sistemi duran veya silinen ticari verisini kurtarmak isteyenleri hemen ${officer} hattına bağla.`,
      },
    ]);
  }

  if (p.includes('su tesisat') || p.includes('tıkanıklık')) {
    const heroText = `${shopLabel} olarak termal kameralı kırmadan su kaçağı tespiti, robot cihazla gider/tuvalet/mutfak tıkanıklığı açma, gömme rezervuar ve sıhhi tesisat onarımı yapıyoruz. Arayanın yaşadığı sorunu ve açık adresini alıp hemen usta yönlendirme kaydı aç; alt kata su akıtan veya evi su basan acil çağrıları saniye bekletmeden ${officer}'e bağla.`;
    return packFrom('🚰 Su Tesisatı & Kaçak Tespit', heroText, [
      {
        label: '+ Kırmadan Kameralı Su Kaçağı Tespiti',
        text: `Alt kata damlama veya yüksek su faturası şikayetinde cihazla noktasal tespit yaptığımızı belirtip adres kaydı al.`,
      },
      {
        label: '+ Robotla Tıkanıklık Açma Servisi',
        text: `Mutfak, banyo veya ana gider tıkanıklığı için mahalle ve açık adresi öğrenip aynı gün servis yaz.`,
      },
      {
        label: `+ Su Baskını / Patlak Boru -> ${officer}'e Bağla`,
        text: `Ana vanadan kesilmeyen su patlağı veya su baskını yaşayan müşteriyi hiç bekletmeden ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('elektrik') || p.includes('tesisat')) {
    const heroText = `${shopLabel} olarak daire ve iş yeri elektrik arıza onarımı, sigorta panosu/kaçak akım rölesi değişimi, avize-LED aydınlatma montajı, internet hattı ve tesisat işleri yapıyoruz. Arayanın arızasını ve açık adresini öğrenip servis kaydı aç; sigorta yanması, kablo kokusu veya iş yeri elektrik kesintisinde anında ${officer}'e bağla.`;
    return packFrom('⚡ Elektrik & Tesisat Ustası', heroText, [
      {
        label: '+ Elektrik Arıza, Pano & Aydınlatma',
        text: `Şalter atması, priz/hat arızası veya avize-aydınlatma montajı için yapılacak işi ve açık adresi kaydet.`,
      },
      {
        label: '+ Komple Tadilat & İş Yeri Keşfi',
        text: `Yeni dükkân veya daire komple tesisat yenileme işleri için semti öğrenip ücretsiz keşif randevusu oluştur.`,
      },
      {
        label: `+ Yanık Kokusu / Acil Kesinti -> ${officer}'e Bağla`,
        text: `Panodan kıvılcım/koku gelmesi veya tüm elektriğin kesilmesi durumunda hemen ${officer} hattına bağla.`,
      },
    ]);
  }

  if (p.includes('çilingir') || p.includes('anahtarcı')) {
    const heroText = `${shopLabel} olarak ${locText} genelinde 7/24 kapıya zarar vermeden çelik kapı açma, yüksek güvenlikli kilit göbeği değişimi, oto kapısı açma ve immobilizer oto anahtar yapımı hizmeti veriyoruz. Kapıda kalan müşterinin tam açık adresini hemen öğrenip 15-20 dakikada ulaşıldığını söyle ve çağrıyı bekletmeden ustamız ${officer}'e bağla.`;
    return packFrom('🔑 7/24 Çilingir & Anahtarcı', heroText, [
      {
        label: '+ Hasarsız Kapı Açma & Kilit Değişimi',
        text: `Kapının çekili mi yoksa kilitli mi olduğunu ve tam mahalle-sokak-bina bilgisini öğrenip hemen kayıt aç.`,
      },
      {
        label: '+ Oto Anahtar & Kumanda Kopyalama',
        text: `Yedek veya kayıp oto anahtarı için aracın marka-model-yılını öğrenip fiyat ve süre bilgisi için not al.`,
      },
      {
        label: `+ Kapıda Kalan Acil Çağrı -> ${officer}'e Bağla`,
        text: `Kapıda bekleyen tüm müşterileri adresini alır almaz doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  // 17) HUKUK / MUHASEBE / EMLAK / MİMARLIK / SİGORTA
  if (p.includes('avukat') || p.includes('hukuk')) {
    const heroText = `${shopLabel} olarak ceza, aile/boşanma, iş hukuku, gayrimenkul, miras ve icra-ticaret hukuku alanlarında danışmanlık ve dava takibi yürütüyoruz. Telefonda hukuki mütalaa vermeden arayanın adını, mevcut müvekkil olup olmadığını ve hukuki konusunu kısaca not alıp ${officer} ile ofis/online danışmanlık randevusu oluştur; acil gözaltı, ifade veya haciz durumlarında derhal ${officer}'e bağla.`;
    return packFrom('⚖️ Avukat & Hukuk Bürosu', heroText, [
      {
        label: '+ Hukuki Danışmanlık Randevusu',
        text: `Görüşmelerin randevulu yapıldığını belirtip arayanın adını, uyuşmazlık konusunu ve uygun gün-saatini kaydet.`,
      },
      {
        label: '+ Müvekkil Dosya / Duruşma Bilgisi',
        text: `Mevcut müvekkillerimizin dosya numarası veya konusunu not alıp avukatımızın geri dönüşü için kayıt bırak.`,
      },
      {
        label: `+ Acil İfade / Haciz / Süreli Tebligat -> ${officer}'e Bağla`,
        text: `Karakol/savcılık ifadesi, fiili haciz veya itiraz süresi dolmak üzere olan tebligatlarda hemen ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('mali müşavir') || p.includes('smmm') || p.includes('muhasebe')) {
    const heroText = `${shopLabel} ofisimizde şahıs, limited ve anonim şirket kuruluşu, aylık vergi-SGK beyanname takibi, e-fatura/e-defter geçişi ve KOSGEB/teşvik danışmanlığı hizmeti veriyoruz. Yeni şirket kuracak girişimciler için ${officer} ile tanışma randevusu oluştur; mevcut mükelleflerimizin acil vergi/SGK ve inceleme konularını doğrudan ${officer}'e bağla.`;
    return packFrom('📊 Mali Müşavir & Muhasebe', heroText, [
      {
        label: '+ Yeni Şirket Kuruluşu & Defter Tutma',
        text: `Şahıs veya limited şirket kurmak isteyen adayın yapacağı işi öğrenip kuruluş maliyet görüşmesi için randevu aç.`,
      },
      {
        label: '+ Mükellef Evrak / Beyanname Talebi',
        text: `Vergi levhası, bilanço, mizan veya SGK işe giriş/çıkış isteyen mükellefin firma adını ve talebini not al.`,
      },
      {
        label: `+ Vergi Tebligatı / Acil Ödeme -> ${officer}'e Bağla`,
        text: `Resmi tebligat, vergi incelemesi veya son gün beyanname onayı için arayan mükellefi hemen ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('emlak') || p.includes('gayrimenkul')) {
    const heroText = `${shopLabel} olarak ${locText} bölgesinde satılık-kiralık konut, ticari dükkân, arsa portföy yönetimi ve ücretsiz ekspertiz/değerleme hizmeti sunuyoruz. Arayan müşterinin baktığı ilanı veya aradığı oda sayısı ve bütçe aralığını öğrenip yer gösterme randevusu oluştur; mülkünü satmak/kiraya vermek isteyen mülk sahiplerini ve kapora hazır alıcıları doğrudan ${officer}'e bağla.`;
    return packFrom('🏠 Emlak & Gayrimenkul', heroText, [
      {
        label: '+ İlan Sorgusu & Yer Gösterme Randevusu',
        text: `Müşterinin aradığı ilanı, oda sayısını (2+1, 3+1, dükkân) ve bütçesini not alıp yer gösterme saati planla.`,
      },
      {
        label: '+ Satılık / Kiralık Mülk Portföy Kaydı',
        text: `Evini veya dükkânını satmak ya da kiraya vermek isteyen mülk sahibinin mahalle ve mülk bilgisini kaydet.`,
      },
      {
        label: `+ Pazarlık / Kapora / Mülk Sahibi -> ${officer}'e Bağla`,
        text: `Beğendiği mülk için teklif verecek alıcıları ve mülk sahiplerini bekletmeden ${officer} ile görüştür.`,
      },
    ]);
  }

  if (p.includes('mimar') || p.includes('iç mimar')) {
    const heroText = `${shopLabel} olarak mimari proje çizimi, 3 boyutlu iç mekan tasarımı ve anahtar teslim konut/ofis/mağaza tadilat uygulaması yürütüyoruz. Arayan müşteriden mekanın türünü, metrekaresini ve bulunduğu semti öğrenip ${officer} ile keşif ve proje toplantısı randevusu oluştur; devam eden şantiye veya ihale konularını doğrudan ${officer}'e bağla.`;
    return packFrom('📐 Mimarlık & İç Mimarlık', heroText, [
      {
        label: '+ Anahtar Teslim Tadilat & 3D Tasarım',
        text: `Daire, villa, klinik veya mağaza tasarım taleplerinde yaklaşık metrekareyi ve semti öğrenip keşif randevusu aç.`,
      },
      {
        label: '+ Ruhsat & Mimari Proje Çizimi',
        text: `Arsa/yapı ruhsat projesi soran mülk sahiplerinin ada-parsel veya ilçe bilgisini not alıp toplantı planla.`,
      },
      {
        label: `+ Şantiye & Proje Teklifi -> ${officer}'e Bağla`,
        text: `Aktif şantiye tedarikçilerini ve kapsamlı proje sahiplerini doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  if (p.includes('sigorta')) {
    const heroText = `${shopLabel} acenteliğimizde 20'den fazla sigorta şirketinden karşılaştırmalı trafik sigortası, kasko, tamamlayıcı sağlık, DASK ve iş yeri poliçesi kesiyoruz. Fiyat teklifi isteyen müşteriden plaka ve TC/vergi numarasını (veya WhatsApp'tan ruhsat gönderebileceğini) öğrenip teklif kaydı aç; trafik kazası yapan veya çekici bekleyen sigortalılarımızı anında ${officer}'e bağla.`;
    return packFrom('🛡️ Sigorta Acentesi', heroText, [
      {
        label: '+ En Uygun Kasko & Trafik Teklifi',
        text: `Araç plakasını ve ruhsat seri/TC bilgisini alıp tüm şirketlerden karşılaştırmalı teklif hazırlanması için not düş.`,
      },
      {
        label: '+ Tamamlayıcı Sağlık, Konut & DASK',
        text: `Sağlık veya konut/DASK poliçesi yenileme ve yeni teklif taleplerinde ad-soyad ve iletişim bilgisini kaydet.`,
      },
      {
        label: `+ Kaza / Hasar / Çekici -> ${officer}'e Bağla`,
        text: `Kaza anında tutanak, ikame araç veya çekici desteği isteyen müşterileri bekletmeden ${officer}'e bağla.`,
      },
    ]);
  }

  // 18) EĞİTİM / SÜRÜCÜ KURSU / DİL KURSU / SPOR SALONU & PİLATES
  if (p.includes('sürücü kursu') || p.includes('direksiyon')) {
    const heroText = `${shopLabel} olarak B sınıfı otomatik/manuel otomobil ehliyeti, motosiklet ehliyeti ve ehliyetlilere özel akan trafikte direksiyon dersleri veriyoruz. Yeni dönem son kayıt tarihini ve gerekli evrakları merak eden adayın istediği ehliyet sınıfını öğrenip kayıt görüşmesi randevusu oluştur; kayıt ve taksit onayı için ${officer}'e bağla.`;
    return packFrom('🚘 Sürücü Kursu', heroText, [
      {
        label: '+ Yeni Dönem Ehliyet Kayıt & Fiyatlar',
        text: `İstenen ehliyet sınıfını (otomatik/manuel B, A2 motor) öğrenip dönem açılış tarihi ve kurs ücreti için görüşme yaz.`,
      },
      {
        label: '+ Özel Direksiyon Dersi Randevusu',
        text: `Ehliyeti olup trafik korkusunu yenmek isteyen adaylar için saatlik özel direksiyon dersi randevusu oluştur.`,
      },
      {
        label: `+ Sınav Tarihi & Kesin Kayıt -> ${officer}'e Bağla`,
        text: `Bugün kayıt olmak isteyen adayları veya sınav/harç sorusu olan kursiyerleri ${officer} ile görüştür.`,
      },
    ]);
  }

  if (p.includes('fitness') || p.includes('pilates') || p.includes('spor salonu')) {
    const heroText = `${shopLabel} merkezimizde aletli reformer pilates, birebir PT özel ders ve fitness üyelik programları sunulmaktadır. Arayan kişinin hedefini (sıkılaşma, kilo verme, bel-sırt güçlendirme) öğrenip ücretsiz salon tanıtımı ve deneme dersi randevusu oluştur; üyelik yenileme ve paket kampanyaları için ${officer}'e bağla.`;
    return packFrom('🏋️ Fitness & Pilates Stüdyo', heroText, [
      {
        label: '+ Reformer Pilates & Ücretsiz Deneme Dersi',
        text: `Birebir veya düet reformer pilates derslerimiz için uygun gün ve saate deneme seansı randevusu oluştur.`,
      },
      {
        label: '+ Aylık / Yıllık Üyelik & PT Paketleri',
        text: `Üyelik süreleri ve saat dilimi kampanyaları hakkında bilgi almak isteyen adayları salon görüşmesine davet et.`,
      },
      {
        label: `+ Kampanya & Grup İndirimi -> ${officer}'e Bağla`,
        text: `Çift/arkadaş grup indirimi veya hemen üyelik başlatmak isteyenleri doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('dil kursu') || p.includes('yabancı dil') || p.includes('özel ders') || p.includes('etüt') || p.includes('eğitim')) {
    const heroText = `${shopLabel} kurumumuzda LGS-YKS sınav hazırlık, okul takviye birebir özel ders, yabancı dil (İngilizce/Almanca/IELTS) ve VIP grup eğitimleri verilmektedir. Veliden veya öğrenciden sınıf/seviye bilgisini öğrenip ücretsiz seviye tespit sınavı ve eğitim danışmanı görüşmesi randevusu oluştur; kayıt ve bursluluk sorularını ${officer}'e bağla.`;
    return packFrom('🎓 Eğitim & Kurs Merkezi', heroText, [
      {
        label: '+ Ücretsiz Seviye Tespit & Tanışma Dersi',
        text: `Öğrencinin sınıfını veya hedeflediği sınav/dili öğrenip ücretsiz seviye analizi randevusu oluştur.`,
      },
      {
        label: '+ Birebir Özel Ders & Grup Programları',
        text: `Hafta içi ve hafta sonu ders saatleri ile taksitli dönem kayıtları için veli görüşme saati planla.`,
      },
      {
        label: `+ Kayıt & Eğitim Planı -> ${officer}'e Bağla`,
        text: `Ücret/taksit onayı veya doğrudan kurum müdürümüz ${officer} ile görüşmek isteyen velileri bağla.`,
      },
    ]);
  }

  // 19) FOTOĞRAFÇI / DÜĞÜN & ORGANİZASYON / TERZİ & MODA EVİ / HALI YIKAMA / NAKLİYAT / OTEL / KAFE-RESTORAN
  if (p.includes('fotoğraf') || p.includes('dış çekim')) {
    const heroText = `${shopLabel} stüdyomuzda düğün-nişan dış çekim hikayesi, save the date, drone klip çekimi, yenidoğan/aile çekimi ve kurumsal ürün-mekan fotoğrafçılığı yapılmaktadır. Çekim türünü ve organizasyon tarihini öğrenip gün müsaitliği için ön rezervasyon kaydı oluştur; paket seçimi ve kapora onayı için ${officer}'e bağla.`;
    return packFrom('📸 Fotoğraf & Dış Çekim Stüdyosu', heroText, [
      {
        label: '+ Düğün Dış Çekim, Albüm & Klip Paketleri',
        text: `Çiftin düğün/nişan tarihini ve istediği çekim konseptini öğrenip tarih müsaitliği kontrolü için kayıt aç.`,
      },
      {
        label: '+ Ürün, Katalog & Sosyal Medya Çekimi',
        text: `Kurumsal ürün veya mekan çekimi isteyen firmaların ürün adedini ve tarih beklentisini not alıp randevu oluştur.`,
      },
      {
        label: `+ Tarih Opsiyonu & Kapora -> ${officer}'e Bağla`,
        text: `Çekim gününü kesinleştirmek ve paket fiyatı netleştirmek isteyen müşterileri doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('düğün') || p.includes('davet') || p.includes('organizasyon')) {
    const heroText = `${shopLabel} olarak düğün, nişan, kına, söz kurulumu, doğum günü ve kurumsal davet organizasyonları düzenliyoruz. Arayan misafirden etkinlik tarihini, davetli kişi sayısını ve yemekli/kokteyl konsept tercihini öğrenip mekan gösterimi ve teklif görüşmesi randevusu oluştur; tarih kapatmak isteyenleri ${officer}'e bağla.`;
    return packFrom('🎉 Düğün & Davet Organizasyon', heroText, [
      {
        label: '+ Tarih Müsaitliği & Kişi Sayısı Kaydı',
        text: `Planlanan davet tarihini, yaklaşık kişi sayısını ve konsepti (düğün, nişan, kına) öğrenip teklif notu al.`,
      },
      {
        label: '+ Mekan Gösterimi & Kahve Randevusu',
        text: `Çiftleri örnek kurulumları ve paket içeriklerini görmek üzere uygun gün-saatte ofis/salon görüşmesine davet et.`,
      },
      {
        label: `+ Sözleşme & Gün Kapatma -> ${officer}'e Bağla`,
        text: `Tarih opsiyonlamak veya paket pazarlığı yapmak isteyen çiftleri doğrudan ${officer} ile görüştür.`,
      },
    ]);
  }

  if (p.includes('terzi') || p.includes('moda evi') || p.includes('kuru temizleme') || p.includes('gelinlik')) {
    const heroText = `${shopLabel} bünyesinde özel dikim abiye/gelinlik, profesyonel tadilat-daraltma, ütü ve leke çıkarıcılı kuru temizleme hizmeti sunulmaktadır. Özel dikim ve prova için randevu saati oluştur, kuru temizleme için parça ve alım adresini kaydet; acil yetişmesi gereken özel gün kıyafetlerini doğrudan ${officer}'e bağla.`;
    return packFrom('👗 Moda Evi, Terzi & Kuru Temizleme', heroText, [
      {
        label: '+ Özel Dikim, Tadilat & Prova Randevusu',
        text: `Gelinlik, abiye veya takım elbise tadilat/özel dikim için etkinlik tarihini öğrenip prova randevusu oluştur.`,
      },
      {
        label: '+ Kuru Temizleme & Ücretsiz Servis Kaydı',
        text: `Yorgan, perde, takım elbise veya abiye temizliği için parça bilgisini ve açık adresi alıp kurye kaydı aç.`,
      },
      {
        label: `+ Acil Teslimat & Tasarım -> ${officer}'e Bağla`,
        text: `Aynı gün acil ütü/tadilat veya özel dikim fiyat görüşmesi isteyenleri doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('halı') || p.includes('koltuk yıkama')) {
    const heroText = `${shopLabel} olarak ${locText} genelinde ücretsiz kapıdan alım-teslimatla tam otomatik fabrikada halı yıkama, stor perde yıkama ve yerinde buharlı koltuk-yatak yıkama hizmeti veriyoruz. Müşteriden mahalle, açık adres ve yaklaşık parça sayısını alıp bugünkü servis listesine ekle; leke garantisi veya acil teslimat soranları ${officer}'e bağla.`;
    return packFrom('🧼 Halı & Koltuk Yıkama', heroText, [
      {
        label: '+ Ücretsiz Adresten Halı Alım Kaydı',
        text: `Halıların ortalama 3-4 günde paketli teslim edildiğini belirtip mahalle, bina-daire no ve parça adedini kaydet.`,
      },
      {
        label: '+ Yerinde Buharlı Koltuk & Yatak Yıkama',
        text: `Koltuk takımı veya yatak yıkama için takım sayısını ve müşterinin evde olduğu uygun gün-saati randevuya yaz.`,
      },
      {
        label: `+ Teslimat Sorgusu & Özel Halı -> ${officer}'e Bağla`,
        text: `El dokuma/ipek halı fiyatı veya siparişi yolda olan müşterileri doğrudan ${officer} hattına bağla.`,
      },
    ]);
  }

  if (p.includes('nakliyat') || p.includes('taşımacılık') || p.includes('lojistik')) {
    const heroText = `${shopLabel} olarak şehir içi ve şehirler arası sigortalı, marangozlu, tam ambalajlı ve dış cephe asansörlü evden eve/ofis nakliyat hizmeti sunuyoruz. Fiyat çıkması için eşyanın oda sayısını (2+1, 3+1), kaçıncı kattan kaçıncı kata ve hangi semtten nereye taşınacağını öğrenip not al; net fiyat ve gün bağlamak isteyenleri doğrudan ${officer}'e bağla.`;
    return packFrom('🚚 Asansörlü Evden Eve Nakliyat', heroText, [
      {
        label: '+ Oda Sayısı, Kat & Mesafe Bilgisi Al',
        text: `Nereden nereye taşınacağını, oda sayısını, her iki binanın kat/asansör durumunu ve taşınma tarihini kaydet.`,
      },
      {
        label: '+ Ücretsiz Ekspertiz & Şehirler Arası',
        text: `Geniş eşyalı evler, ofis taşıma veya şehirler arası parça/tam eşya için ücretsiz ekspertiz kaydı oluştur.`,
      },
      {
        label: `+ Net Fiyat & Araç Ayırtma -> ${officer}'e Bağla`,
        text: `Hemen net taşıma fiyatı duymak ve kamyon/ekip günü kapatmak isteyen müşteriyi doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('otel') || p.includes('konaklama') || p.includes('pansiyon')) {
    const heroText = `${shopLabel} tesisimizde konforlu standart, aile ve süit odalarımızla konaklama hizmeti sunuyoruz (giriş 14:00, çıkış 12:00). Arayan misafirden giriş-çıkış tarihlerini, yetişkin/çocuk sayısını ve kahvaltı/oda tercihini öğrenip rezervasyon kaydı oluştur; bugün konaklayacak misafirleri veya grup indirimi soranları ${officer}'e bağla.`;
    return packFrom('🏨 Otel & Konaklama', heroText, [
      {
        label: '+ Tarih & Oda Müsaitlik Rezervasyonu',
        text: `Giriş-çıkış tarihlerini, kişi sayısını ve oda tipini (çift kişilik, aile, süit) öğrenip ön rezervasyon aç.`,
      },
      {
        label: '+ Erken Giriş, Kahvaltı & Otopark Bilgisi',
        text: `Kahvaltı saatleri, otopark ve ulaşım hakkında bilgi verip özel oda notlarını resepsiyon kaydına ekle.`,
      },
      {
        label: `+ Bugün Giriş / Grup Fiyatı -> ${officer}'e Bağla`,
        text: `Bu gece hemen oda arayanları veya kurumsal/grup konaklaması soranları doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  if (p.includes('kafe') || p.includes('restoran') || p.includes('lokanta') || p.includes('tatlıcı') || p.includes('pastane')) {
    const heroText = `${shopLabel} olarak günlük taze lezzetlerimizle hem mekanımızda ağırlama hem de ${dist} bölgesine sıcak paket servis hizmeti sunuyoruz. Masa rezervasyonu için kişi sayısını ve geliş saatini, paket sipariş için ürünleri ve açık adresi eksiksiz kaydet; grup yemeği, iftar/kahvaltı organizasyonu veya özel pasta siparişlerini ${officer}'e bağla.`;
    return packFrom('🍽️ Kafe, Restoran & Tatlı', heroText, [
      {
        label: '+ Masa Rezervasyonu (Kişi Sayısı & Saat)',
        text: `Misafirin adını, kaç kişi geleceklerini, geliş saatini ve bahçe/iç mekan tercihini öğrenip masa ayır.`,
      },
      {
        label: '+ Hızlı Paket Sipariş & Adres Kaydı',
        text: `Sipariş edilen ürünleri, ödeme tercihini (kapıda kart/nakit) ve açık adresi alıp mutfağa ilet.`,
      },
      {
        label: `+ Toplu Yemek & Özel Organizasyon -> ${officer}'e Bağla`,
        text: `Kalabalık grup yemeği, doğum günü kutlaması veya toplu tepsi/catering siparişlerini doğrudan ${officer}'e bağla.`,
      },
    ]);
  }

  // 20) ELLE YAZILAN ÖZEL MESLEKLER (Tadilat, Mermer, Cam Balkon, vb. dahil her sektör için vurucu metin!)
  const customTitle = rawProf && !p.includes('diğer') ? rawProf : 'Özel İşletme Hizmetleri';
  const shortTitle = customTitle.split('/')[0].trim();
  const heroText = `${shopLabel} olarak ${locText} bölgesinde ${customTitle.toLocaleLowerCase('tr-TR')} alanında profesyonel hizmet veriyoruz. Arayan müşteriden tam olarak istediği işi, varsa ölçü/detay bilgisini ve uygun gün-saatini öğrenip randevu/keşif kaydı oluştur; net fiyat pazarlığı veya acil iş talebi olan müşterileri bekletmeden doğrudan ${officer}'e bağla.`;

  return packFrom(`💼 ${shortTitle}`, heroText, [
    {
      label: `+ ${shortTitle} Hizmet & Fiyat Bilgisi`,
      text: `${shopLabel} olarak sunduğumuz ${customTitle.toLocaleLowerCase('tr-TR')} çözümleri hakkında bilgi verip müşterinin istediği detayı öğren.`,
    },
    {
      label: '+ Keşif, Randevu & Sipariş Kaydı',
      text: `Müşterinin adını, açık adres/semt bilgisini ve uygun saatini kaydedip ${officer} için randevu oluştur.`,
    },
    {
      label: `+ Teklif & Acil İş -> ${officer}'e Bağla`,
      text: `Hemen fiyat onayı konuşmak veya iş başlatmak isteyen müşterileri bekletmeden doğrudan ${officer}'e bağla.`,
    },
  ]);
}

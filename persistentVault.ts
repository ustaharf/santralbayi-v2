import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { resolveServerApiUrl } from './vdsConfig';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}

export type VaultSectionKey =
  | 'dealers'
  | 'subscribers'
  | 'setupProfiles'
  | 'assistantRoles'
  | 'appointments'
  | 'accountingIncomes'
  | 'accountingExpenses'
  | 'accountingSends'
  | 'accountingArchives'
  | 'callLogs'
  | 'outgoingCallLogs'
  | 'poolTransfers'
  | 'dealerApplications'
  | 'waAiSettings'
  | 'transferScenarios'
  | 'pbxRulesRegistry'
  | 'missedCallsConfig'
  | 'digitalReceipts'
  | 'loyaltyHistory'
  | 'dealerDemoList'
  | 'callHistoryRecords'
  | 'payoutRequests'
  | 'appPreferences'
  | 'deviceContacts'
  | 'systemSettings';

const ALL_VAULT_SECTIONS: VaultSectionKey[] = [
  'dealers',
  'subscribers',
  'setupProfiles',
  'assistantRoles',
  'appointments',
  'accountingIncomes',
  'accountingExpenses',
  'accountingSends',
  'accountingArchives',
  'callLogs',
  'outgoingCallLogs',
  'poolTransfers',
  'dealerApplications',
  'waAiSettings',
  'transferScenarios',
  'pbxRulesRegistry',
  'missedCallsConfig',
  'digitalReceipts',
  'loyaltyHistory',
  'dealerDemoList',
  'callHistoryRecords',
  'payoutRequests',
  'appPreferences',
  'deviceContacts',
];

const IDB_NAME = 'sb_data_vault_v1';
const IDB_STORE = 'sections';
const LS_PREFIX = 'sb_vault_sec_v2_';
const ID_REGEX = /^[a-zA-Z0-9_-]+$/;

// Cihaza özel kalması gereken anahtarlar (rehber, kayıtlı kart, giriş oturumu ve zaten bölüm olarak tutulan kopyalar)
const DEVICE_LOCAL_ONLY_KEYS = new Set<string>([
  'sb_active_auth_session_v1',
  'sb_force_ota_refresh_v1',
  'sb_cloned_voice_cache_v1',
  'sb_device_contacts_v1',
  'contacts_auto_synced',
  'kp_saved_credit_card',
  'sb_apk_setup_profiles_v4',
  'sb_pbx_rules_registry_v1',
  'sb_device_synced_once_v1',
  'local_voice_manifest_v2',
]);

// Sadece Yönetici (TR.000) değiştirdiğinde genel şablon olarak merkeze yazılan, abone/bayi telefonlarında ise kişinin kendi ekranında kalan düzen anahtarları
const ADMIN_ONLY_GLOBAL_LAYOUT_KEYS = new Set<string>([
  'kp_app_order_v25',
  'kp_iller_bayi_order_v1',
  'kp_il_bayi_order_v15',
  'kp_ilce_bayi_order_v13',
  'kp_esnaf_order_v12',
  'santralbayi_dock_order_v2',
  'sb_dock_order_by_panel_v1',
  'sb_robot_pos_by_role_v1',
]);

function isCurrentDeviceAdminSession(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const raw = window.localStorage.getItem('sb_active_auth_session_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { role?: string };
    return parsed?.role === 'admin';
  } catch {
    return false;
  }
}

function isSyncedKvKey(key: string): boolean {
  if (!key || DEVICE_LOCAL_ONLY_KEYS.has(key)) return false;
  if (key.startsWith(LS_PREFIX) || key.startsWith('local_voip_history_v1_')) return false;
  if (ADMIN_ONLY_GLOBAL_LAYOUT_KEYS.has(key) && !isCurrentDeviceAdminSession()) {
    return false;
  }
  return key.startsWith('kp_') || key.startsWith('sb_') || key.startsWith('santralbayi_');
}

// Orijinal localStorage metodlarını sakla (sonsuz döngü olmadan okuma/yazma için)
const rawLsSetItem: ((key: string, value: string) => void) | null =
  typeof window !== 'undefined' && window.localStorage
    ? window.localStorage.setItem.bind(window.localStorage)
    : null;

const rawLsRemoveItem: ((key: string) => void) | null =
  typeof window !== 'undefined' && window.localStorage
    ? window.localStorage.removeItem.bind(window.localStorage)
    : null;

let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let vdsSyncTimer: ReturnType<typeof setTimeout> | null = null;
let isApplyingRemoteSnapshot = false;
let hasHydratedFromServer = false;
let lastKnownServerRevision = 0;
let activeCheckServerUpdatesFn: (() => Promise<void>) | null = null;

export function triggerImmediateServerResync(): void {
  if (activeCheckServerUpdatesFn) {
    void activeCheckServerUpdatesFn();
  }
}

const pendingChangedSections: Record<string, unknown> = {};
const pendingChangedKv: Record<string, string | null> = {};
const recentLocalKvModifiedAt: Map<string, number> = new Map();
const recentLocalSectionModifiedAt: Map<string, number> = new Map();
const LOCAL_MUTATION_GUARD_MS = 12000;

let nativeMirrorTimer: ReturnType<typeof setTimeout> | null = null;

export function flushNativeOfflineMirrorNow(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const MIRROR_SKIP_KEYS = new Set<string>([
      'sb_cloned_voice_cache_v1',
      'sb_force_ota_refresh_v1',
    ]);
    const lsMap: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || MIRROR_SKIP_KEYS.has(k)) continue;
      if (
        k.startsWith(LS_PREFIX) ||
        k.startsWith('sb_') ||
        k.startsWith('kp_') ||
        k.startsWith('santralbayi_') ||
        k === 'local_voice_manifest_v2' ||
        k.startsWith('local_voip_history_v1_')
      ) {
        const val = window.localStorage.getItem(k);
        if (typeof val === 'string' && val.length <= 450_000) {
          lsMap[k] = val;
        }
      }
    }

    // Temizlenen/boşaltılan listeler eski telefon hafızasında kalıntı bırakmasın diye boş olarak da üzerine yaz
    const mustOverwriteEmptySections = ['callLogs', 'outgoingCallLogs', 'appointments', 'callHistoryRecords'];
    for (const sec of mustOverwriteEmptySections) {
      const secKey = `${LS_PREFIX}${sec}`;
      if (!(secKey in lsMap)) {
        lsMap[secKey] = '[]';
      }
    }

    if (Object.keys(lsMap).length === 0) return;
    const snapshotJson = JSON.stringify({ updatedAt: Date.now(), lsMap });

    const winAny = window as unknown as {
      AndroidBridge?: { saveOfflineVaultSnapshot?: (json: string) => void };
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (winAny.AndroidBridge && typeof winAny.AndroidBridge.saveOfflineVaultSnapshot === 'function') {
      winAny.AndroidBridge.saveOfflineVaultSnapshot(snapshotJson);
    }

    const isNativeShell =
      Boolean(winAny.AndroidBridge) || Boolean(winAny.Capacitor?.isNativePlatform?.());
    if (isNativeShell && window.location.hostname !== 'localhost' && typeof document !== 'undefined' && document.body) {
      let frame = document.getElementById('sb-offline-vault-mirror-frame') as HTMLIFrameElement | null;
      const sendToFrame = () => {
        try {
          frame?.contentWindow?.postMessage({ type: 'SB_MIRROR_FULL_LS', lsMap }, '*');
        } catch {}
      };
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'sb-offline-vault-mirror-frame';
        frame.setAttribute('aria-hidden', 'true');
        frame.className = 'hidden w-0 h-0 border-0 pointer-events-none';
        frame.onload = () => {
          sendToFrame();
          setTimeout(sendToFrame, 450);
        };
        frame.src = 'http://localhost/?sb_mirror_receiver=1';
        document.body.appendChild(frame);
        setTimeout(sendToFrame, 900);
      } else {
        sendToFrame();
      }
    }
  } catch {}
}

export function scheduleNativeOfflineMirror(): void {
  if (typeof window === 'undefined') return;
  if (nativeMirrorTimer) clearTimeout(nativeMirrorTimer);
  nativeMirrorTimer = setTimeout(() => {
    flushNativeOfflineMirrorNow();
  }, 400);
}

export function restoreNativeOfflineVaultMirrorSync(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const bridge = (window as unknown as {
      AndroidBridge?: { getOfflineVaultSnapshot?: () => string };
    }).AndroidBridge;
    const raw = bridge?.getOfflineVaultSnapshot?.() || '';
    if (!raw || !raw.trim().startsWith('{')) return;
    const parsed = JSON.parse(raw) as { lsMap?: Record<string, string> };
    if (!parsed || !parsed.lsMap || typeof parsed.lsMap !== 'object') return;
    const setter = rawLsSetItem || window.localStorage.setItem.bind(window.localStorage);
    for (const [k, v] of Object.entries(parsed.lsMap)) {
      if (typeof k === 'string' && typeof v === 'string') {
        setter(k, v);
      }
    }
  } catch {}
}

function installLocalStorageAutoSyncHook(): void {
  if (typeof window === 'undefined' || !window.localStorage || !rawLsSetItem || !rawLsRemoveItem) return;
  const storageAny = window.localStorage as Storage & { __sbHookInstalled?: boolean };
  if (storageAny.__sbHookInstalled) return;
  storageAny.__sbHookInstalled = true;

  window.localStorage.setItem = (key: string, value: string): void => {
    const prev = window.localStorage.getItem(key);
    rawLsSetItem(key, value);
    if (prev !== value) {
      scheduleNativeOfflineMirror();
    }
    if (isApplyingRemoteSnapshot) return;
    // İlk açılışta sunucu verisi henüz gelmeden fabrika varsayılanının yazılması bekleyen değişiklik sayılmaz
    if (isSyncedKvKey(key) && prev !== value && (hasHydratedFromServer || prev !== null)) {
      pendingChangedKv[key] = value;
      recentLocalKvModifiedAt.set(key, Date.now());
      if (hasHydratedFromServer) {
        scheduleMasterServerSync();
        scheduleCloudVaultSync();
      }
    }
  };

  window.localStorage.removeItem = (key: string): void => {
    const hadKey = window.localStorage.getItem(key) !== null;
    rawLsRemoveItem(key);
    if (hadKey) {
      scheduleNativeOfflineMirror();
    }
    if (isApplyingRemoteSnapshot) return;
    if (isSyncedKvKey(key) && hadKey) {
      pendingChangedKv[key] = null;
      recentLocalKvModifiedAt.set(key, Date.now());
      if (hasHydratedFromServer) {
        scheduleMasterServerSync();
        scheduleCloudVaultSync();
      }
    }
  };
}

if (typeof window !== 'undefined') {
  installLocalStorageAutoSyncHook();
}

function openVaultIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeSectionToIdb(key: string, jsonText: string): Promise<void> {
  const database = await openVaultIdb();
  if (!database) return;
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ json: jsonText, updatedAt: Date.now() }, key);
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

async function readAllSectionsFromIdb(): Promise<Record<string, string>> {
  const database = await openVaultIdb();
  if (!database) return {};
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const result: Record<string, string> = {};
        const keys = keysReq.result || [];
        const vals = valsReq.result || [];
        keys.forEach((k, idx) => {
          const item = vals[idx];
          if (typeof k === 'string' && item && typeof item.json === 'string') {
            result[k] = item.json;
          }
        });
        database.close();
        resolve(result);
      };
      tx.onerror = () => {
        database.close();
        resolve({});
      };
    } catch {
      database.close();
      resolve({});
    }
  });
}

export function loadVaultSectionSync<T>(key: VaultSectionKey, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`${LS_PREFIX}${key}`);
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (parsed !== null && parsed !== undefined) {
        return parsed as T;
      }
    }
  } catch {}
  return fallback;
}

function collectCurrentSnapshotForSeed(): {
  changedSections: Record<string, unknown>;
  changedKv: Record<string, string>;
} {
  const changedSections: Record<string, unknown> = {};
  const changedKv: Record<string, string> = {};
  if (typeof window === 'undefined') return { changedSections, changedKv };

  for (const sec of ALL_VAULT_SECTIONS) {
    const val = loadVaultSectionSync<unknown>(sec, null);
    if (val !== null && val !== undefined) {
      changedSections[sec] = val;
    }
  }

  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && isSyncedKvKey(k)) {
      const v = window.localStorage.getItem(k);
      if (typeof v === 'string') {
        changedKv[k] = v;
      }
    }
  }

  return { changedSections, changedKv };
}

async function flushPendingToMasterServer(useKeepalive = false): Promise<void> {
  if (typeof window === 'undefined' || !hasHydratedFromServer || isApplyingRemoteSnapshot) return;
  const secKeys = Object.keys(pendingChangedSections);
  const kvKeys = Object.keys(pendingChangedKv);
  if (secKeys.length === 0 && kvKeys.length === 0) return;

  const sectionsSnapshot: Record<string, unknown> = {};
  const kvSnapshot: Record<string, string | null> = {};

  for (const k of secKeys) {
    sectionsSnapshot[k] = pendingChangedSections[k];
    delete pendingChangedSections[k];
  }
  for (const k of kvKeys) {
    kvSnapshot[k] = pendingChangedKv[k];
    delete pendingChangedKv[k];
  }

  try {
    const res = await fetch(resolveServerApiUrl('/api/vault'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: lastKnownServerRevision,
        changedSections: sectionsSnapshot,
        changedKv: kvSnapshot,
      }),
      keepalive: useKeepalive,
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.revision === 'number' && data.revision > 0) {
        lastKnownServerRevision = data.revision;
      }
      return;
    }
  } catch {
    // Ağ kesintisi olursa bekleyen değişiklikleri geri koy ki internet gelince yazılsın
  }

  for (const [k, v] of Object.entries(sectionsSnapshot)) {
    if (!(k in pendingChangedSections)) pendingChangedSections[k] = v;
  }
  for (const [k, v] of Object.entries(kvSnapshot)) {
    if (!(k in pendingChangedKv)) pendingChangedKv[k] = v;
  }
}

export function scheduleMasterServerSync(): void {
  if (typeof window === 'undefined' || isApplyingRemoteSnapshot || !hasHydratedFromServer) return;
  if (vdsSyncTimer) clearTimeout(vdsSyncTimer);
  vdsSyncTimer = setTimeout(() => {
    void flushPendingToMasterServer(false);
  }, 240);
}

export async function flushMasterVaultImmediate(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (vdsSyncTimer) {
    clearTimeout(vdsSyncTimer);
    vdsSyncTimer = null;
  }
  await flushPendingToMasterServer(true);
}

function isUserVerifiedForFirestore(user: User | null): boolean {
  if (!user || !user.uid || user.uid.length > 128 || !ID_REGEX.test(user.uid)) {
    return false;
  }
  if (user.emailVerified) return true;
  return Boolean(user.providerData?.some((p) => p.providerId === 'phone'));
}

function safeBoundedJson(rawJson: string | null | undefined, maxBytes: number, emptyFallback: string): string {
  const str = rawJson && rawJson.trim() ? rawJson : emptyFallback;
  if (str.length <= maxBytes) return str;
  try {
    const parsed = JSON.parse(str);
    const stripped = JSON.stringify(parsed, (_k, val) => {
      if (typeof val === 'string' && val.startsWith('data:image/') && val.length > 2048) {
        return '';
      }
      return val;
    });
    if (stripped.length <= maxBytes) return stripped;
  } catch {}
  return emptyFallback;
}

async function flushVaultToFirestore(): Promise<void> {
  if (typeof window === 'undefined' || isApplyingRemoteSnapshot || !hasHydratedFromServer) return;
  const user = auth.currentUser;
  if (!isUserVerifiedForFirestore(user) || !user) return;

  const workspacePath = `workspaces/${user.uid}`;
  const vaultRef = doc(db, 'workspaces', user.uid);

  const dealersJson = safeBoundedJson(window.localStorage.getItem(`${LS_PREFIX}dealers`), 450000, '[]');
  const subscribersJson = safeBoundedJson(window.localStorage.getItem(`${LS_PREFIX}subscribers`), 450000, '[]');
  const profilesJson = safeBoundedJson(
    window.localStorage.getItem('sb_apk_setup_profiles_v4') || window.localStorage.getItem(`${LS_PREFIX}setupProfiles`),
    450000,
    '{}'
  );

  const kvBundle: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && isSyncedKvKey(k)) {
      const v = window.localStorage.getItem(k);
      if (typeof v === 'string' && v.length < 60000) {
        kvBundle[k] = v;
      }
    }
  }

  const settingsBundle = {
    assistantRoles: loadVaultSectionSync('assistantRoles', null),
    waAiSettings: loadVaultSectionSync('waAiSettings', null),
    transferScenarios: loadVaultSectionSync('transferScenarios', null),
    mizan: window.localStorage.getItem('kp_mizan_settings_v2') || '',
    adminLicensePrices: window.localStorage.getItem('kp_admin_license_prices_v2') || '',
    badgeRules: window.localStorage.getItem('kp_badge_rules') || '',
    ilceBadgeRules: window.localStorage.getItem('kp_ilce_badge_rules') || '',
    ilBadgeRules: window.localStorage.getItem('kp_il_badge_rules') || '',
    dealerWallets: window.localStorage.getItem('kp_dealer_wallets') || '',
    socialTemplates: window.localStorage.getItem('sb_custom_social_templates_v1') || '',
    deletedSocialTemplates: window.localStorage.getItem('sb_deleted_social_templates_v1') || '',
    issuedRefCodes: window.localStorage.getItem('sb_issued_ref_codes_v1') || '',
    gatewayConfig: window.localStorage.getItem('sb_pbx_gateway_config_v1') || '',
    pbxRulesRegistry: loadVaultSectionSync('pbxRulesRegistry', null),
    appPreferences: loadVaultSectionSync('appPreferences', null),
    kvStore: kvBundle,
  };
  const settingsJson = safeBoundedJson(JSON.stringify(settingsBundle), 350000, '{}');

  const operationsBundle = {
    appointments: loadVaultSectionSync('appointments', null),
    accountingIncomes: loadVaultSectionSync('accountingIncomes', null),
    accountingExpenses: loadVaultSectionSync('accountingExpenses', null),
    accountingSends: loadVaultSectionSync('accountingSends', null),
    accountingArchives: loadVaultSectionSync('accountingArchives', null),
    callLogs: loadVaultSectionSync('callLogs', null),
    outgoingCallLogs: loadVaultSectionSync('outgoingCallLogs', null),
    poolTransfers: loadVaultSectionSync('poolTransfers', null),
    dealerApplications: loadVaultSectionSync('dealerApplications', null),
    callHistoryRecords: loadVaultSectionSync('callHistoryRecords', null),
    missedCallsConfig: loadVaultSectionSync('missedCallsConfig', null),
    digitalReceipts: loadVaultSectionSync('digitalReceipts', null),
    loyaltyHistory: loadVaultSectionSync('loyaltyHistory', null),
    dealerDemoList: loadVaultSectionSync('dealerDemoList', null),
    payoutRequests: loadVaultSectionSync('payoutRequests', null),
  };
  const operationsJson = safeBoundedJson(JSON.stringify(operationsBundle), 450000, '{}');

  let existsAlready = false;
  try {
    const existingSnap = await getDoc(vaultRef);
    existsAlready = existingSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, workspacePath);
  }

  if (!existsAlready) {
    try {
      await setDoc(vaultRef, {
        ownerId: user.uid,
        schemaVersion: 2,
        dealersJson,
        subscribersJson,
        profilesJson,
        settingsJson,
        operationsJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, workspacePath);
    }
  } else {
    try {
      await updateDoc(vaultRef, {
        schemaVersion: 2,
        dealersJson,
        subscribersJson,
        profilesJson,
        settingsJson,
        operationsJson,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, workspacePath);
    }
  }
}

export function scheduleCloudVaultSync(): void {
  if (typeof window === 'undefined' || isApplyingRemoteSnapshot || !hasHydratedFromServer) return;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    void flushVaultToFirestore().catch(() => {});
  }, 900);
}

const PER_KEY_DIFF_MAP_SECTIONS = new Set<VaultSectionKey>([
  'setupProfiles',
  'pbxRulesRegistry',
  'waAiSettings',
]);

export function saveVaultSection<T>(key: VaultSectionKey, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    const json = JSON.stringify(value);
    const prevRaw = window.localStorage.getItem(`${LS_PREFIX}${key}`);
    const lsSafeJson =
      json.length > 380000
        ? safeBoundedJson(json, 380000, Array.isArray(value) ? '[]' : '{}')
        : json;

    try {
      if (rawLsSetItem) {
        rawLsSetItem(`${LS_PREFIX}${key}`, lsSafeJson);
      } else {
        window.localStorage.setItem(`${LS_PREFIX}${key}`, lsSafeJson);
      }
    } catch {}

    void writeSectionToIdb(key, json);
    scheduleNativeOfflineMirror();

    // İlk açılışta sunucudan gerçek kayıt gelmeden boş anahtara fabrika verisi yazılması sunucuyu ezmesin
    if (!isApplyingRemoteSnapshot && prevRaw !== lsSafeJson && (hasHydratedFromServer || prevRaw !== null)) {
      if (
        PER_KEY_DIFF_MAP_SECTIONS.has(key) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        let prevObj: Record<string, unknown> = {};
        if (prevRaw) {
          try {
            const p = JSON.parse(prevRaw);
            if (p && typeof p === 'object' && !Array.isArray(p)) {
              prevObj = p as Record<string, unknown>;
            }
          } catch {}
        }
        const nextObj = value as Record<string, unknown>;
        const prevPending =
          pendingChangedSections[key] &&
          typeof pendingChangedSections[key] === 'object' &&
          !Array.isArray(pendingChangedSections[key])
            ? (pendingChangedSections[key] as Record<string, unknown>)
            : {};
        const deltaMap: Record<string, unknown> = { ...prevPending };
        let hasDelta = false;
        for (const [subK, subV] of Object.entries(nextObj)) {
          if (JSON.stringify(prevObj[subK]) !== JSON.stringify(subV)) {
            deltaMap[subK] = subV;
            hasDelta = true;
          }
        }
        if (hasDelta) {
          pendingChangedSections[key] = deltaMap;
        }
      } else {
        pendingChangedSections[key] = value;
      }

      recentLocalSectionModifiedAt.set(key, Date.now());
      if (hasHydratedFromServer) {
        scheduleMasterServerSync();
        scheduleCloudVaultSync();
      }
    }
  } catch {}
}

export interface HydratedVaultPayload {
  dealers?: unknown[];
  subscribers?: unknown[];
  setupProfiles?: Record<string, unknown>;
  assistantRoles?: unknown[];
  appointments?: unknown[];
  accountingIncomes?: unknown[];
  accountingExpenses?: unknown[];
  accountingSends?: unknown[];
  accountingArchives?: unknown[];
  callLogs?: unknown[];
  outgoingCallLogs?: unknown[];
  poolTransfers?: unknown[];
  dealerApplications?: unknown[];
  waAiSettings?: Record<string, unknown>;
  transferScenarios?: unknown[];
  pbxRulesRegistry?: Record<string, unknown>;
  missedCallsConfig?: Record<string, unknown>;
  digitalReceipts?: unknown[];
  loyaltyHistory?: unknown[];
  dealerDemoList?: unknown[];
  callHistoryRecords?: unknown[];
  payoutRequests?: unknown[];
  appPreferences?: Record<string, unknown>;
  deviceContacts?: unknown[];
  kvStore?: Record<string, string>;
}

function applyMasterServerPayloadToClient(
  sections: Record<string, unknown> | undefined,
  kvStore: Record<string, string> | undefined,
  onHydrate: (payload: HydratedVaultPayload) => void,
  isInitialHydration = false
): void {
  if (typeof window === 'undefined') return;
  isApplyingRemoteSnapshot = true;
  const now = Date.now();
  try {
    const hydrated: HydratedVaultPayload = {};

    if (kvStore && typeof kvStore === 'object') {
      const safeKvForHydrate: Record<string, string> = {};
      const isAdminDevice = isCurrentDeviceAdminSession();
      for (const [k, v] of Object.entries(kvStore)) {
        if (!k || DEVICE_LOCAL_ONLY_KEYS.has(k) || typeof v !== 'string') continue;
        if (k.startsWith(LS_PREFIX) || k.startsWith('local_voip_history_v1_')) continue;
        if (!(k.startsWith('kp_') || k.startsWith('sb_') || k.startsWith('santralbayi_'))) continue;

        // Abone veya bayi kendi telefonunda buton/robot yerini daha önce ayarladıysa merkezin düzeni onun ekranını bozmasın;
        // ancak telefonda henüz hiç düzen yoksa ilk açılışta Yöneticinin şablonunu alsın
        if (ADMIN_ONLY_GLOBAL_LAYOUT_KEYS.has(k) && !isAdminDevice) {
          const existingLocalLayout = window.localStorage.getItem(k);
          if (existingLocalLayout && existingLocalLayout.trim()) {
            continue;
          }
        }

        // Bekleyen veya son birkaç saniyede yerelde değiştirilmiş anahtarı eski yoklama cevabıyla ezme
        if (k in pendingChangedKv) continue;
        const lastMod = recentLocalKvModifiedAt.get(k) || 0;
        if (!isInitialHydration && lastMod > 0 && now - lastMod < LOCAL_MUTATION_GUARD_MS) {
          const currentLocalVal = window.localStorage.getItem(k);
          if (typeof currentLocalVal === 'string') {
            safeKvForHydrate[k] = currentLocalVal;
          }
          continue;
        }
        safeKvForHydrate[k] = v;
        try {
          if (rawLsSetItem) {
            rawLsSetItem(k, v);
          } else {
            window.localStorage.setItem(k, v);
          }
        } catch {}
      }
      hydrated.kvStore = safeKvForHydrate;
    }

    if (sections && typeof sections === 'object') {
      for (const secKey of ALL_VAULT_SECTIONS) {
        const lastSecMod = recentLocalSectionModifiedAt.get(secKey) || 0;
        if (!isInitialHydration && lastSecMod > 0 && now - lastSecMod < LOCAL_MUTATION_GUARD_MS) continue;
        const remoteVal = sections[secKey];
        if (remoteVal === undefined || remoteVal === null) continue;

        let mergedVal: unknown = remoteVal;
        if (secKey in pendingChangedSections) {
          if (
            PER_KEY_DIFF_MAP_SECTIONS.has(secKey) &&
            typeof remoteVal === 'object' &&
            !Array.isArray(remoteVal) &&
            pendingChangedSections[secKey] &&
            typeof pendingChangedSections[secKey] === 'object' &&
            !Array.isArray(pendingChangedSections[secKey])
          ) {
            mergedVal = {
              ...(remoteVal as Record<string, unknown>),
              ...(pendingChangedSections[secKey] as Record<string, unknown>),
            };
          } else {
            continue;
          }
        }

        (hydrated as Record<string, unknown>)[secKey] = mergedVal;
        try {
          const json = JSON.stringify(mergedVal);
          const lsSafeJson =
            json.length > 380000
              ? safeBoundedJson(json, 380000, Array.isArray(mergedVal) ? '[]' : '{}')
              : json;
          if (rawLsSetItem) {
            rawLsSetItem(`${LS_PREFIX}${secKey}`, lsSafeJson);
            if (secKey === 'setupProfiles') {
              rawLsSetItem('sb_apk_setup_profiles_v4', lsSafeJson);
            } else if (secKey === 'pbxRulesRegistry') {
              rawLsSetItem('sb_pbx_rules_registry_v1', lsSafeJson);
            }
          }
          void writeSectionToIdb(secKey, json);
        } catch {}
      }
    }

    onHydrate(hydrated);
    scheduleNativeOfflineMirror();
  } finally {
    isApplyingRemoteSnapshot = false;
  }
}

export function startVaultPersistenceSync(onHydrate: (payload: HydratedVaultPayload) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  installLocalStorageAutoSyncHook();

  let snapshotUnsub: Unsubscribe | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  // 1. Önce IndexedDB yerel yedeğini yükle, ardından Ana Sunucu (/api/vault) ile senkronla
  void (async () => {
    const idbMap = await readAllSectionsFromIdb();
    if (disposed) return;

    const restoredFromIdb: HydratedVaultPayload = {};
    let hasAnyIdb = false;
    for (const k of ALL_VAULT_SECTIONS) {
      const lsRaw = window.localStorage.getItem(`${LS_PREFIX}${k}`);
      const idbRaw = idbMap[k];
      if ((!lsRaw || !lsRaw.trim()) && idbRaw) {
        try {
          const parsed = JSON.parse(idbRaw);
          (restoredFromIdb as Record<string, unknown>)[k] = parsed;
          if (rawLsSetItem) rawLsSetItem(`${LS_PREFIX}${k}`, idbRaw);
          hasAnyIdb = true;
        } catch {}
      }
    }
    if (hasAnyIdb) {
      onHydrate(restoredFromIdb);
    }

    // 2. Merkezi Ana Sunucu Mahzeni (/api/vault) İlk Okuma & Kilidi Açma
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(resolveServerApiUrl('/api/vault'), { signal: ctrl.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) {
          if (typeof data.revision === 'number' && data.revision > 0) {
            lastKnownServerRevision = data.revision;
            if (rawLsSetItem) rawLsSetItem('sb_device_synced_once_v1', '1');
            applyMasterServerPayloadToClient(data.sections, data.kvStore, onHydrate, true);
            hasHydratedFromServer = true;
            if (Object.keys(pendingChangedSections).length > 0 || Object.keys(pendingChangedKv).length > 0) {
              void flushPendingToMasterServer(false);
            }
          } else {
            // Sunucu mahzeni henüz boş (revision === 0): mevcut cihaz verisini ilk tohum olarak mühürle
            hasHydratedFromServer = true;
            const seed = collectCurrentSnapshotForSeed();
            const seedRes = await fetch(resolveServerApiUrl('/api/vault'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                isSeed: true,
                changedSections: seed.changedSections,
                changedKv: seed.changedKv,
              }),
            }).catch(() => null);
            if (seedRes && seedRes.ok) {
              const seedJson = await seedRes.json().catch(() => null);
              if (seedJson && typeof seedJson.revision === 'number') {
                lastKnownServerRevision = seedJson.revision;
                if (rawLsSetItem) rawLsSetItem('sb_device_synced_once_v1', '1');
                if (seedJson.ignoredSeed && seedJson.sections) {
                  applyMasterServerPayloadToClient(seedJson.sections, seedJson.kvStore, onHydrate, true);
                }
              }
            }
          }
        }
      }
    } catch {
      // KESİN KURAL: Sunucuya ulaşılamadıysa hasHydratedFromServer = false kalır!
      // Böylece çevrimdışı/yeni kurulan cihazın boş başlangıç verisi sunucuya ASLA yazılamaz;
      // internet geldiğinde önce merkezden gerçek veri çekilip birleştirilir.
    }
  })();

  // 3. Çoklu Cihaz / Tüm APK Panelleri Canlı Yoklama (6 sn + odaklanma + kapanışta anında kayıt)
  const checkServerUpdates = async () => {
    if (disposed || isApplyingRemoteSnapshot) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    // Açılışta çevrimdışı kalmışsa, internet geldiği an ÖNCE merkezden gerçek veriyi al ve birleştir!
    if (!hasHydratedFromServer) {
      try {
        const res = await fetch(resolveServerApiUrl('/api/vault'));
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.ok && typeof data.revision === 'number' && data.revision > 0) {
          const hadSyncedBefore = window.localStorage.getItem('sb_device_synced_once_v1') === '1';
          if (!hadSyncedBefore) {
            // Daha önce hiç eşitlenmemiş sıfır kurulum cihaz: fabrika varsayılanlarını temizle
            for (const k of Object.keys(pendingChangedSections)) delete pendingChangedSections[k];
            for (const k of Object.keys(pendingChangedKv)) delete pendingChangedKv[k];
          }
          lastKnownServerRevision = data.revision;
          if (rawLsSetItem) rawLsSetItem('sb_device_synced_once_v1', '1');
          applyMasterServerPayloadToClient(data.sections, data.kvStore, onHydrate, true);
          hasHydratedFromServer = true;
          if (Object.keys(pendingChangedSections).length > 0 || Object.keys(pendingChangedKv).length > 0) {
            await flushPendingToMasterServer(false);
          }
        }
      } catch {}
      return;
    }

    if (Object.keys(pendingChangedSections).length > 0 || Object.keys(pendingChangedKv).length > 0) {
      await flushPendingToMasterServer(false);
      return;
    }
    try {
      const url = `${resolveServerApiUrl('/api/vault')}?sinceRevision=${lastKnownServerRevision}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && !data.unchanged && typeof data.revision === 'number' && data.revision > lastKnownServerRevision) {
        lastKnownServerRevision = data.revision;
        applyMasterServerPayloadToClient(data.sections, data.kvStore, onHydrate);
      }
    } catch {}
  };

  activeCheckServerUpdatesFn = checkServerUpdates;

  pollInterval = setInterval(() => {
    void checkServerUpdates();
  }, 3000);

  const handleVisibilityOrPageHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void flushPendingToMasterServer(true);
    } else {
      void checkServerUpdates();
    }
  };

  const handleOnlineReconnect = () => {
    void flushPendingToMasterServer(false).then(() => checkServerUpdates());
  };

  const handlePageHide = () => {
    void flushPendingToMasterServer(true);
  };

  window.addEventListener('visibilitychange', handleVisibilityOrPageHide);
  window.addEventListener('focus', handleVisibilityOrPageHide);
  window.addEventListener('online', handleOnlineReconnect);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handlePageHide);

  // 4. Firebase Firestore gerçek zamanlı yedek dinleyicisi (doğrulanmış Firebase oturumlarında)
  const authUnsub = onAuthStateChanged(auth, (user) => {
    if (snapshotUnsub) {
      snapshotUnsub();
      snapshotUnsub = null;
    }
    if (!isUserVerifiedForFirestore(user) || !user) {
      return;
    }

    const workspacePath = `workspaces/${user.uid}`;
    const vaultRef = doc(db, 'workspaces', user.uid);

    snapshotUnsub = onSnapshot(
      vaultRef,
      (snap) => {
        if (disposed) return;
        if (!snap.exists()) {
          scheduleCloudVaultSync();
          return;
        }
        if (snap.metadata.hasPendingWrites) return;
        // Ana sunucuda daha güncel veri varsa eski Firestore kaydıyla ezme
        if (lastKnownServerRevision > 0) return;

        const data = snap.data();
        if (!data) return;

        isApplyingRemoteSnapshot = true;
        try {
          const incomingPayload: HydratedVaultPayload = {};
          if (typeof data.dealersJson === 'string' && data.dealersJson.length > 2) {
            const parsed = JSON.parse(data.dealersJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              incomingPayload.dealers = parsed;
              if (rawLsSetItem) rawLsSetItem(`${LS_PREFIX}dealers`, data.dealersJson);
              void writeSectionToIdb('dealers', data.dealersJson);
            }
          }
          if (typeof data.subscribersJson === 'string' && data.subscribersJson.length > 2) {
            const parsed = JSON.parse(data.subscribersJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              incomingPayload.subscribers = parsed;
              if (rawLsSetItem) rawLsSetItem(`${LS_PREFIX}subscribers`, data.subscribersJson);
              void writeSectionToIdb('subscribers', data.subscribersJson);
            }
          }
          if (typeof data.profilesJson === 'string' && data.profilesJson.length > 2) {
            const parsed = JSON.parse(data.profilesJson);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
              incomingPayload.setupProfiles = parsed;
              if (rawLsSetItem) {
                rawLsSetItem('sb_apk_setup_profiles_v4', data.profilesJson);
                rawLsSetItem(`${LS_PREFIX}setupProfiles`, data.profilesJson);
              }
              void writeSectionToIdb('setupProfiles', data.profilesJson);
            }
          }
          if (typeof data.settingsJson === 'string' && data.settingsJson.length > 2) {
            const s = JSON.parse(data.settingsJson);
            if (s && typeof s === 'object') {
              if (Array.isArray(s.assistantRoles) && s.assistantRoles.length > 0) {
                incomingPayload.assistantRoles = s.assistantRoles;
              }
              if (s.waAiSettings && typeof s.waAiSettings === 'object') {
                incomingPayload.waAiSettings = s.waAiSettings;
              }
              if (Array.isArray(s.transferScenarios) && s.transferScenarios.length > 0) {
                incomingPayload.transferScenarios = s.transferScenarios;
              }
              if (s.kvStore && typeof s.kvStore === 'object') {
                incomingPayload.kvStore = s.kvStore;
                for (const [k, v] of Object.entries(s.kvStore as Record<string, string>)) {
                  if (isSyncedKvKey(k) && typeof v === 'string' && rawLsSetItem) {
                    rawLsSetItem(k, v);
                  }
                }
              }
              if (s.pbxRulesRegistry && typeof s.pbxRulesRegistry === 'object') {
                incomingPayload.pbxRulesRegistry = s.pbxRulesRegistry;
                const regJson = JSON.stringify(s.pbxRulesRegistry);
                if (rawLsSetItem) {
                  rawLsSetItem('sb_pbx_rules_registry_v1', regJson);
                  rawLsSetItem(`${LS_PREFIX}pbxRulesRegistry`, regJson);
                }
                void writeSectionToIdb('pbxRulesRegistry', regJson);
              }
              if (s.appPreferences && typeof s.appPreferences === 'object') {
                incomingPayload.appPreferences = s.appPreferences;
              }
            }
          }
          if (typeof data.operationsJson === 'string' && data.operationsJson.length > 2) {
            const ops = JSON.parse(data.operationsJson);
            if (ops && typeof ops === 'object') {
              if (Array.isArray(ops.appointments)) incomingPayload.appointments = ops.appointments;
              if (Array.isArray(ops.accountingIncomes)) incomingPayload.accountingIncomes = ops.accountingIncomes;
              if (Array.isArray(ops.accountingExpenses)) incomingPayload.accountingExpenses = ops.accountingExpenses;
              if (Array.isArray(ops.accountingSends)) incomingPayload.accountingSends = ops.accountingSends;
              if (Array.isArray(ops.accountingArchives)) incomingPayload.accountingArchives = ops.accountingArchives;
              if (Array.isArray(ops.callLogs)) incomingPayload.callLogs = ops.callLogs;
              if (Array.isArray(ops.outgoingCallLogs)) incomingPayload.outgoingCallLogs = ops.outgoingCallLogs;
              if (Array.isArray(ops.poolTransfers)) incomingPayload.poolTransfers = ops.poolTransfers;
              if (Array.isArray(ops.dealerApplications)) incomingPayload.dealerApplications = ops.dealerApplications;
              if (Array.isArray(ops.callHistoryRecords)) incomingPayload.callHistoryRecords = ops.callHistoryRecords;
              if (ops.missedCallsConfig && typeof ops.missedCallsConfig === 'object') incomingPayload.missedCallsConfig = ops.missedCallsConfig;
              if (Array.isArray(ops.digitalReceipts)) incomingPayload.digitalReceipts = ops.digitalReceipts;
              if (Array.isArray(ops.loyaltyHistory)) incomingPayload.loyaltyHistory = ops.loyaltyHistory;
              if (Array.isArray(ops.dealerDemoList)) incomingPayload.dealerDemoList = ops.dealerDemoList;
              if (Array.isArray(ops.payoutRequests)) incomingPayload.payoutRequests = ops.payoutRequests;
            }
          }
          onHydrate(incomingPayload);
        } catch {
          // Ignore malformed JSON fields
        } finally {
          isApplyingRemoteSnapshot = false;
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, workspacePath);
        } catch {
          // Logged structured FirestoreErrorInfo without crashing UI
        }
      }
    );
  });

  return () => {
    disposed = true;
    if (activeCheckServerUpdatesFn === checkServerUpdates) {
      activeCheckServerUpdatesFn = null;
    }
    authUnsub();
    if (snapshotUnsub) snapshotUnsub();
    if (pollInterval) clearInterval(pollInterval);
    window.removeEventListener('visibilitychange', handleVisibilityOrPageHide);
    window.removeEventListener('focus', handleVisibilityOrPageHide);
    window.removeEventListener('online', handleOnlineReconnect);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('beforeunload', handlePageHide);
  };
}

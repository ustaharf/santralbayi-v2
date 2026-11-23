import 'dotenv/config';
import dotenv from 'dotenv';
import { execFile, execFileSync } from 'child_process';
import crypto from 'crypto';
import dns from 'dns';
import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, GenerateContentResponse, Modality, ThinkingLevel, Type } from '@google/genai';
import { SantralBayiLiveBridge, testGeminiLiveConnectivity, ensureLiveVoiceClip8k } from './src/pbxLiveBridge.ts';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}
try {
  if (typeof (net as any).setDefaultAutoSelectFamily === 'function') {
    (net as any).setDefaultAutoSelectFamily(false);
  }
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
try {
  const persistentEnvPath = path.join(__dirname, 'data', '.env');
  if (fs.existsSync(persistentEnvPath)) {
    dotenv.config({ path: persistentEnvPath, override: true });
  }
} catch {}

function readBundleVersionFromIndexHtml(): number {
  try {
    const idxPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(idxPath)) {
      const html = fs.readFileSync(idxPath, 'utf8');
      const m = html.match(/__SB_BUNDLE_KEY__\s*=\s*["']v_(\d+)["']/);
      if (m && m[1]) {
        const parsed = Number(m[1]);
        if (parsed > 0) return parsed;
      }
    }
  } catch {}
  return Date.now();
}

let currentBuildTime = readBundleVersionFromIndexHtml();
let currentVoiceVersion = 'natural3';
const VDS_SYNC_DOUBLE_HASH = '36cc96f397037cb581f7226b4522aff4a06489bbc7b4340e6da222c7eaa7fdc1';

function checkTcpPort(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

let hydrogenSlowUntil = 0;

function getAiClient(timeoutMs = 10000): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      timeout: Math.max(2500, timeoutMs),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateContentWithRetry(
  _ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0]
): Promise<GenerateContentResponse> {
  const primaryModel = params.model || 'gemini-4-hydrogen';
  const skipHydrogenNow = primaryModel === 'gemini-4-hydrogen' && Date.now() < hydrogenSlowUntil;
  const attempts: Array<{ model: string; delayMs: number; timeoutMs: number; level?: ThinkingLevel }> = skipHydrogenNow
    ? [
        { model: 'gemini-3.1-flash-lite', delayMs: 0, timeoutMs: 5500, level: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', delayMs: 250, timeoutMs: 5500, level: ThinkingLevel.MINIMAL },
      ]
    : [
        { model: primaryModel, delayMs: 0, timeoutMs: 4200 },
        { model: 'gemini-3.1-flash-lite', delayMs: 0, timeoutMs: 5500, level: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', delayMs: 250, timeoutMs: 5500, level: ThinkingLevel.MINIMAL },
      ];

  let lastErr: any = null;
  for (let i = 0; i < attempts.length; i++) {
    const step = attempts[i];
    if (step.delayMs > 0) {
      await new Promise((r) => setTimeout(r, step.delayMs));
    }
    try {
      const client = getAiClient(step.timeoutMs);
      const reqConfig = step.level
        ? {
            ...(params.config || {}),
            thinkingConfig: { thinkingLevel: step.level },
          }
        : params.config;
      return await client.models.generateContent({
        ...params,
        model: step.model,
        config: reqConfig,
      });
    } catch (err: any) {
      lastErr = err;
      if (step.model === 'gemini-4-hydrogen') {
        hydrogenSlowUntil = Date.now() + 10 * 60 * 1000;
      }
      const code = Number(err?.status || err?.code || 0);
      const msg = String(err?.message || '');
      const retryable =
        code === 504 ||
        code === 503 ||
        code === 429 ||
        code === 408 ||
        msg.includes('504') ||
        msg.includes('DEADLINE_EXCEEDED') ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('abort') ||
        msg.includes('timeout');
      if (!retryable) {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vds-Sync-Token');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const IS_STUDIO_PREVIEW_PROXY =
    Boolean(process.env.K_SERVICE) && !__dirname.startsWith('/var/www/santralbayi');

  if (IS_STUDIO_PREVIEW_PROXY) {
    const CENTRAL_PROXY_PREFIXES = [
      '/api/vault',
      '/api/pbx/',
      '/api/voip/',
      '/api/voice-bank/',
      '/api/custom-secretary-voice',
      '/api/tts',
      '/api/brochure-upload',
      '/brochures/',
      '/api/admin/',
      '/api/caller-lookup',
      '/api/remote-tech',
    ];

    app.use((req, res, next) => {
      const reqPath = req.path || '';
      const shouldProxy = CENTRAL_PROXY_PREFIXES.some(
        (prefix) => reqPath === prefix || reqPath.startsWith(prefix)
      );
      if (!shouldProxy || req.headers['x-sb-proxy-hop'] === '1') {
        next();
        return;
      }

      const forwardHeaders: http.OutgoingHttpHeaders = { ...req.headers };
      forwardHeaders.host = '178.208.187.42:3000';
      forwardHeaders['x-sb-proxy-hop'] = '1';
      delete forwardHeaders['origin'];
      delete forwardHeaders['referer'];
      delete forwardHeaders['connection'];

      const upstreamReq = http.request(
        {
          hostname: '178.208.187.42',
          port: 3000,
          method: req.method,
          path: req.originalUrl,
          headers: forwardHeaders,
        },
        (upstreamRes) => {
          const outHeaders: http.OutgoingHttpHeaders = { ...upstreamRes.headers };
          outHeaders['access-control-allow-origin'] = '*';
          outHeaders['cache-control'] = outHeaders['cache-control'] || 'no-store';
          delete outHeaders['transfer-encoding'];
          res.writeHead(upstreamRes.statusCode || 200, outHeaders);
          upstreamRes.pipe(res);
        }
      );

      upstreamReq.on('error', () => {
        if (!res.headersSent) {
          res.status(503).json({
            ok: false,
            error: 'Canlı merkez geçici olarak yenileniyor, birkaç saniye sonra tekrar deneniyor.',
          });
        } else {
          try {
            res.end();
          } catch {}
        }
      });

      res.on('close', () => {
        if (!res.writableEnded) {
          try {
            upstreamReq.destroy();
          } catch {}
        }
      });

      if (req.method === 'GET' || req.method === 'HEAD') {
        upstreamReq.end();
      } else {
        req.pipe(upstreamReq);
      }
    });
  }

  app.use(express.json({ limit: '50mb' }));

  app.use(
    '/apk',
    express.static(path.join(__dirname, 'public', 'apk'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.apk')) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
          res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        }
      },
    })
  );

  let cachedGithubApkUrl = '';
  let cachedGithubApkCheckedAt = 0;

  async function resolveLatestApkDownloadUrl(origin: string): Promise<string> {
    try {
      const localApkDir = path.join(__dirname, 'public', 'apk');
      if (fs.existsSync(localApkDir)) {
        const apkFiles = fs
          .readdirSync(localApkDir)
          .filter((f) => f.toLowerCase().endsWith('.apk'))
          .map((f) => ({
            name: f,
            mtime: fs.statSync(path.join(localApkDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);
        if (apkFiles.length > 0) {
          return `${origin}/apk/${encodeURIComponent(apkFiles[0].name)}`;
        }
      }
    } catch {}

    const now = Date.now();
    if (cachedGithubApkUrl && now - cachedGithubApkCheckedAt < 5 * 60 * 1000) {
      return cachedGithubApkUrl;
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const ghRes = await fetch('https://api.github.com/repos/ustaharf/santralbayi-/releases/latest', {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'santralbayi-vds-bridge',
        },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (ghRes.ok) {
        const ghJson = (await ghRes.json()) as {
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        const apkAsset = (ghJson.assets || []).find(
          (a) => typeof a?.browser_download_url === 'string' && a.browser_download_url.toLowerCase().endsWith('.apk')
        );
        if (apkAsset?.browser_download_url) {
          cachedGithubApkUrl = apkAsset.browser_download_url;
          cachedGithubApkCheckedAt = now;
          return cachedGithubApkUrl;
        }
      }
    } catch {}

    return cachedGithubApkUrl || 'https://github.com/ustaharf/santralbayi-/releases/latest/download/santralbayi-v1.5.apk';
  }

  app.get('/indir', async (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = req.get('host') || '178.208.187.42:3000';
    const origin = `${proto}://${host}`;
    const targetApkUrl = await resolveLatestApkDownloadUrl(origin);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.redirect(302, targetApkUrl);
  });

  const liveUpdateClients = new Set<express.Response>();

  function broadcastLiveVersion(buildTimeValue: number) {
    const payload = `event: version\ndata: ${JSON.stringify({
      ok: true,
      buildTime: buildTimeValue,
      voiceVersion: currentVoiceVersion,
      ts: Date.now(),
    })}\n\n`;
    for (const clientRes of Array.from(liveUpdateClients)) {
      try {
        clientRes.write(payload);
      } catch {
        liveUpdateClients.delete(clientRes);
      }
    }
  }

  app.get('/api/live-updates', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    liveUpdateClients.add(res);
    try {
      res.write(`retry: 2000\n`);
      res.write(
        `event: version\ndata: ${JSON.stringify({
          ok: true,
          buildTime: currentBuildTime,
          voiceVersion: currentVoiceVersion,
          ts: Date.now(),
        })}\n\n`
      );
    } catch {}

    const keepAliveTimer = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(keepAliveTimer);
        liveUpdateClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      liveUpdateClients.delete(res);
    });
  });

  app.get('/api/server-meta', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
      ok: true,
      serverIp: '178.208.187.42',
      buildTime: currentBuildTime,
      voiceVersion: currentVoiceVersion,
      pbxSipPort: 5060,
      aiReady: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      apkDownloadUrl: 'http://178.208.187.42:3000/indir',
      preferredOrigin: String(process.env.PREFERRED_LIVE_ORIGIN || '').trim(),
    });
  });

  app.post('/api/vds-live-sync', (req, res) => {
    try {
      const token = String(req.headers['x-vds-sync-token'] || '');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      if (!token || hash !== VDS_SYNC_DOUBLE_HASH) {
        res.status(403).json({ error: 'Yetkisiz senkronizasyon isteği' });
        return;
      }

      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      const allowedPrefixes = [
        'src/',
        'public/',
        'android-bridge/',
        'index.html',
        'AGENTS.md',
        'capacitor.config.ts',
        'server.ts',
      ];
      const updated: string[] = [];

      for (const item of files) {
        const rel = String(item?.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || rel.includes('..') || !allowedPrefixes.some((p) => rel === p || rel.startsWith(p))) {
          continue;
        }
        const fullPath = path.resolve(__dirname, rel);
        if (!fullPath.startsWith(path.resolve(__dirname) + path.sep)) {
          continue;
        }
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, Buffer.from(String(item?.contentBase64 || ''), 'base64'));
        updated.push(rel);
      }

      try {
        const incomingAiKey = typeof req.body?.geminiApiKey === 'string' ? req.body.geminiApiKey.trim() : '';
        if (incomingAiKey) {
          const dataDirPath = path.join(__dirname, 'data');
          fs.mkdirSync(dataDirPath, { recursive: true });
          const dataEnvFile = path.join(dataDirPath, '.env');
          fs.writeFileSync(dataEnvFile, `GEMINI_API_KEY=${incomingAiKey}\n`, { mode: 0o600 });
          process.env.GEMINI_API_KEY = incomingAiKey;
        }
      } catch {}

      try {
        seedAndMergeVoiceBank();
      } catch {}

      currentBuildTime = readBundleVersionFromIndexHtml();
      broadcastLiveVersion(currentBuildTime);
      res.json({ ok: true, buildTime: currentBuildTime, updated });
      if (updated.includes('server.ts')) {
        setTimeout(() => {
          process.exit(0);
        }, 650);
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Senkronizasyon hatası' });
    }
  });

  app.get('/api/vds-security-audit', (req, res) => {
    try {
      const token = String(req.headers['x-vds-sync-token'] || '');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      if (!token || hash !== VDS_SYNC_DOUBLE_HASH) {
        res.status(403).json({ error: 'Yetkisiz istek' });
        return;
      }

      const runSafe = (bin: string, args: string[], timeout = 4000): string => {
        try {
          return String(
            execFileSync(bin, args, {
              encoding: 'utf8',
              timeout,
              maxBuffer: 512 * 1024,
              stdio: ['ignore', 'pipe', 'pipe'],
            }) || ''
          ).trim();
        } catch (err: any) {
          const out = String(err?.stdout || '').trim();
          return out || `ERR: ${String(err?.message || '').slice(0, 120)}`;
        }
      };

      const listDirSafe = (dirPath: string): string[] => {
        try {
          if (!fs.existsSync(dirPath)) return [];
          return fs.readdirSync(dirPath).slice(0, 80);
        } catch {
          return [];
        }
      };

      const readFileSafe = (filePath: string, maxLen = 4000): string => {
        try {
          if (!fs.existsSync(filePath)) return '';
          return fs.readFileSync(filePath, 'utf8').slice(0, maxLen).trim();
        } catch {
          return '';
        }
      };

      const report = {
        checkedAt: Date.now(),
        uptime: runSafe('uptime', []),
        memory: runSafe('free', ['-h']),
        disk: runSafe('df', ['-h', '/']),
        topCpuProcesses: runSafe('ps', ['aux', '--sort=-%cpu']).split('\n').slice(0, 22),
        listeningPorts: runSafe('ss', ['-tulpn']).split('\n').slice(0, 35),
        establishedConns: runSafe('ss', ['-tupn', 'state', 'established']).split('\n').slice(0, 35),
        rootCrontab: runSafe('crontab', ['-l']),
        etcCrontab: readFileSafe('/etc/crontab', 2000),
        cronDirFiles: listDirSafe('/etc/cron.d'),
        spoolCrontabs: listDirSafe('/var/spool/cron/crontabs'),
        tmpFiles: listDirSafe('/tmp'),
        varTmpFiles: listDirSafe('/var/tmp'),
        devShmFiles: listDirSafe('/dev/shm'),
        initdNetworkingExists: fs.existsSync('/etc/init.d/networking'),
        initdPostgresExists: fs.existsSync('/etc/init.d/postgresql'),
        rcLocal: readFileSafe('/etc/rc.local', 1500),
        authorizedKeysCount: readFileSafe('/root/.ssh/authorized_keys', 4000)
          .split('\n')
          .filter((l) => l.trim() && !l.trim().startsWith('#')).length,
        recentLogins: runSafe('last', ['-n', '8']).split('\n').slice(0, 10),
        failedLoginsCount: runSafe('lastb', ['-n', '20']).split('\n').filter(Boolean).length,
        iptablesSummary: runSafe('iptables', ['-L', 'INPUT', '-n']).split('\n').slice(0, 25),
        ufwStatus: runSafe('ufw', ['status']),
        unattendedUpgradesInstalled: fs.existsSync('/etc/apt/apt.conf.d/20auto-upgrades'),
        pm2List: runSafe('pm2', ['jlist']),
        gccShContent: readFileSafe('/etc/cron.hourly/gcc.sh', 4000),
        cronHourlyFiles: listDirSafe('/etc/cron.hourly'),
        initdFiles: listDirSafe('/etc/init.d'),
        rc2Files: listDirSafe('/etc/rc2.d'),
        bootFiles: listDirSafe('/boot'),
        libUdevExists: fs.existsSync('/lib/libudev.so'),
        libUdevStat: runSafe('ls', ['-la', '/lib/libudev.so', '/lib/libudev.so.6', '/etc/cron.hourly/gcc.sh']),
        fakeKernelExes: (() => {
          const out: Array<{ pid: string; cmd: string; exe: string; cwd: string }> = [];
          try {
            const psLines = runSafe('ps', ['-eo', 'pid,vsz,rss,args']).split('\n');
            for (const line of psLines) {
              const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
              if (!m) continue;
              const [, pid, vsz, rss, cmd] = m;
              if (Number(vsz) > 0 && Number(rss) > 0 && /^\[.*\]$/.test(cmd.trim())) {
                let exe = '';
                let cwd = '';
                try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch {}
                try { cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch {}
                out.push({ pid, cmd: cmd.trim(), exe, cwd });
              }
            }
          } catch {}
          return out;
        })(),
        diskBreakdown: runSafe('du', ['-xh', '--max-depth=2', '/var'], 6000)
          .split('\n')
          .filter((l) => /^\d+(\.\d+)?G\b|^[5-9]\d\dM\b/.test(l.trim()))
          .slice(0, 25),
      };

      res.json({ ok: true, report });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Denetim hatası' });
    }
  });

  // MERKEZİ ANA SUNUCU KALICI VERİ MAHZENİ (/var/www/santralbayi/data/)
  // APK silinip yeniden yüklense bile tüm paneller, buton yerleri, robot konumu, yüklenen özel ses, broşürler ve PBX kuralları burada mühürlü kalır.
  // ÖNEMLİ: Çalışma anı dosyaları public/ dışındaki data/ altında tutulur ki dosya izleyicileri asla sayfa yenileme tetiklemesin.
  const vaultDataDir = path.join(__dirname, 'data');
  fs.mkdirSync(vaultDataDir, { recursive: true });

  // SOSYAL MEDYA PAYLAŞIM BROŞÜRLERİ (TÜM PLATFORMLAR İÇİN PNG & OPENGRAPH GÖRSEL SERVİSİ)
  const brochuresDir = path.join(vaultDataDir, 'brochures');
  const legacyBrochuresDir = path.join(__dirname, 'public', 'brochures');
  fs.mkdirSync(brochuresDir, { recursive: true });

  function toSafeBrochureSlug(rawCode: string): string {
    const cleaned = String(rawCode || 'TR.000')
      .trim()
      .toLocaleLowerCase('tr-TR')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/ü/g, 'u')
      .replace(/[^a-z0-9._-]/g, '_');
    return cleaned.slice(0, 64) || 'tr.000';
  }

  function resolveBrochureFilePath(slug: string): string | null {
    const primaryPath = path.join(brochuresDir, `${slug}.png`);
    if (fs.existsSync(primaryPath)) return primaryPath;
    const fallbackPath = path.join(legacyBrochuresDir, `${slug}.png`);
    if (fs.existsSync(fallbackPath)) return fallbackPath;
    return null;
  }

  app.use(
    '/brochures',
    express.static(brochuresDir, {
      setHeaders: (res) => {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    })
  );
  if (fs.existsSync(legacyBrochuresDir)) {
    app.use(
      '/brochures',
      express.static(legacyBrochuresDir, {
        setHeaders: (res) => {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=3600');
        },
      })
    );
  }

  app.post('/api/brochure-upload', (req, res) => {
    try {
      const { refCode, dataUrl } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string') {
        res.status(400).json({ error: 'Görsel verisi eksik' });
        return;
      }
      const slug = toSafeBrochureSlug(String(refCode || 'TR.000'));
      const base64Part = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      const buf = Buffer.from(base64Part, 'base64');
      if (buf.length < 500 || buf.length > 15 * 1024 * 1024) {
        res.status(400).json({ error: 'Geçersiz görsel boyutu' });
        return;
      }
      const outPath = path.join(brochuresDir, `${slug}.png`);
      fs.writeFileSync(outPath, buf);
      res.json({
        ok: true,
        slug,
        imageUrl: `/brochures/${slug}.png`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Broşür kaydedilemedi' });
    }
  });

  const masterVaultFilePath = path.join(vaultDataDir, 'master-vault.json');
  const masterVaultBackupPath = path.join(vaultDataDir, 'master-vault.backup.json');
  const customVoiceBinPath = path.join(vaultDataDir, 'custom-secretary-voice.bin');
  const customVoiceMetaPath = path.join(vaultDataDir, 'custom-secretary-voice.meta.json');

  interface CustomVoiceDiskMeta {
    mimeType: string;
    fileName: string;
    version: string;
    updatedAt: number;
  }

  function readCustomVoiceMeta(): CustomVoiceDiskMeta | null {
    try {
      if (fs.existsSync(customVoiceMetaPath) && fs.existsSync(customVoiceBinPath)) {
        const parsed = JSON.parse(fs.readFileSync(customVoiceMetaPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.version) {
          return {
            mimeType: typeof parsed.mimeType === 'string' && parsed.mimeType ? parsed.mimeType : 'audio/mpeg',
            fileName: typeof parsed.fileName === 'string' && parsed.fileName ? parsed.fileName : 'ozel_sekreter_sesi.mp3',
            version: String(parsed.version),
            updatedAt: Number(parsed.updatedAt) || Date.now(),
          };
        }
      }
    } catch {}
    return null;
  }

  const bootVoiceMeta = readCustomVoiceMeta();
  if (bootVoiceMeta) {
    currentVoiceVersion = bootVoiceMeta.version;
  }

  interface MasterVaultDiskState {
    revision: number;
    updatedAt: number;
    sections: Record<string, unknown>;
    kvStore: Record<string, string>;
  }

  let cachedMasterVault: MasterVaultDiskState | null = null;
  let cachedMasterVaultFullBuf: Buffer | null = null;
  let masterVaultDiskWriteChain: Promise<void> = Promise.resolve();

  function buildMasterVaultResponseBuf(state: MasterVaultDiskState): Buffer {
    return Buffer.from(
      JSON.stringify({
        ok: true,
        unchanged: false,
        revision: state.revision,
        updatedAt: state.updatedAt,
        sections: state.sections,
        kvStore: state.kvStore,
      }),
      'utf8'
    );
  }

  function readMasterVault(): MasterVaultDiskState {
    if (cachedMasterVault) return cachedMasterVault;
    for (const candidate of [masterVaultFilePath, masterVaultBackupPath]) {
      try {
        if (fs.existsSync(candidate)) {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (parsed && typeof parsed === 'object') {
            cachedMasterVault = {
              revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
              updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
              sections: parsed.sections && typeof parsed.sections === 'object' ? parsed.sections : {},
              kvStore: parsed.kvStore && typeof parsed.kvStore === 'object' ? parsed.kvStore : {},
            };
            cachedMasterVaultFullBuf = buildMasterVaultResponseBuf(cachedMasterVault);
            return cachedMasterVault;
          }
        }
      } catch {}
    }
    cachedMasterVault = { revision: 0, updatedAt: 0, sections: {}, kvStore: {} };
    cachedMasterVaultFullBuf = buildMasterVaultResponseBuf(cachedMasterVault);
    return cachedMasterVault;
  }

  function writeMasterVault(state: MasterVaultDiskState): void {
    cachedMasterVault = state;
    cachedMasterVaultFullBuf = buildMasterVaultResponseBuf(state);
    const serialized = JSON.stringify(state);
    masterVaultDiskWriteChain = masterVaultDiskWriteChain
      .then(async () => {
        try {
          await fs.promises.mkdir(vaultDataDir, { recursive: true });
          try {
            await fs.promises.copyFile(masterVaultFilePath, masterVaultBackupPath);
          } catch {}
          const tmpPath = `${masterVaultFilePath}.tmp`;
          await fs.promises.writeFile(tmpPath, serialized, 'utf8');
          await fs.promises.rename(tmpPath, masterVaultFilePath);
        } catch {}
      })
      .catch(() => {});
  }

  function saveLearnedCallerToVault(callerPhone: string, callerName: string): void {
    const cleanName = String(callerName || '').replace(/\s+/g, ' ').trim();
    const digits = String(callerPhone || '').replace(/\D/g, '');
    const tail10 = digits.length >= 10 ? digits.slice(-10) : '';
    if (!cleanName || cleanName.length < 2 || !tail10) return;
    try {
      const vault = readMasterVault();
      const existingList = Array.isArray(vault.sections['learnedCallers'])
        ? ([...(vault.sections['learnedCallers'] as any[])])
        : [];
      const phone11 = `0${tail10}`;
      const idx = existingList.findIndex(
        (item) => item && String(item.phone || '').replace(/\D/g, '').slice(-10) === tail10
      );
      if (idx >= 0) {
        if (String(existingList[idx].name || '').trim() === cleanName) return;
        existingList[idx] = { ...existingList[idx], name: cleanName, phone: phone11, updatedAt: new Date().toISOString() };
      } else {
        existingList.unshift({
          id: `lc-${tail10}`,
          name: cleanName,
          phone: phone11,
          group: 'Asistan Hafızası',
          updatedAt: new Date().toISOString(),
        });
      }
      vault.sections['learnedCallers'] = existingList.slice(0, 2000);
      vault.revision = (vault.revision || 0) + 1;
      vault.updatedAt = Date.now();
      writeMasterVault(vault);
    } catch {}
  }

  app.get('/api/vault', (req, res) => {
    try {
      const vault = readMasterVault();
      const sinceRev = Number(req.query?.sinceRevision || -1);
      if (sinceRev >= 0 && vault.revision > 0 && sinceRev === vault.revision) {
        res.json({
          ok: true,
          unchanged: true,
          revision: vault.revision,
          updatedAt: vault.updatedAt,
        });
        return;
      }
      if (cachedMasterVaultFullBuf) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(cachedMasterVaultFullBuf);
        return;
      }
      res.json({
        ok: true,
        unchanged: false,
        revision: vault.revision,
        updatedAt: vault.updatedAt,
        sections: vault.sections,
        kvStore: vault.kvStore,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ana mahzen okunamadı' });
    }
  });

  app.post('/api/vault', (req, res) => {
    try {
      const { isSeed, baseRevision, changedSections, changedKv } = req.body || {};
      const current = readMasterVault();

      // Sıfır kurulum veya henüz merkezden gerçek veriyi almamış çevrimdışı bir cihaz dolu mahzeni ASLA ezemez
      const hasUncertainBase =
        current.revision > 0 &&
        (isSeed === true || (typeof baseRevision === 'number' && baseRevision <= 0));
      if (hasUncertainBase) {
        res.json({
          ok: true,
          ignoredSeed: true,
          revision: current.revision,
          updatedAt: current.updatedAt,
          sections: current.sections,
          kvStore: current.kvStore,
        });
        return;
      }

      const BLOCKED_DEVICE_KV_KEYS = new Set<string>([
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

      let mutated = false;
      const nextSections: Record<string, unknown> = { ...current.sections };
      const nextKv: Record<string, string> = { ...current.kvStore };

      // Eski kalıntı cihaza özel anahtarlar mahzende varsa otomatik temizle
      for (const blockedKey of BLOCKED_DEVICE_KV_KEYS) {
        if (blockedKey in nextKv) {
          delete nextKv[blockedKey];
          mutated = true;
        }
      }

      if (changedSections && typeof changedSections === 'object') {
        const protectedNonEmptyArrays = new Set(['dealers', 'subscribers']);
        const perKeyMergeMaps = new Set(['setupProfiles', 'pbxRulesRegistry', 'waAiSettings']);

        for (const [secKey, secVal] of Object.entries(changedSections)) {
          if (!secKey || secKey.length > 80) continue;
          if (secVal !== undefined && secVal !== null) {
            let cleanVal: unknown = secVal;
            if (Array.isArray(secVal)) {
              const filtered = secVal.filter(
                (item) => item !== null && item !== undefined && typeof item === 'object'
              );
              const existingArr = nextSections[secKey];
              if (
                protectedNonEmptyArrays.has(secKey) &&
                Array.isArray(existingArr) &&
                existingArr.length > 0 &&
                (filtered.length === 0 || (existingArr.length >= 6 && filtered.length <= 4))
              ) {
                continue;
              }
              cleanVal = filtered;
            } else if (
              perKeyMergeMaps.has(secKey) &&
              typeof secVal === 'object' &&
              !Array.isArray(secVal)
            ) {
              const prevMap =
                nextSections[secKey] &&
                typeof nextSections[secKey] === 'object' &&
                !Array.isArray(nextSections[secKey])
                  ? (nextSections[secKey] as Record<string, unknown>)
                  : {};
              cleanVal = { ...prevMap, ...(secVal as Record<string, unknown>) };
            }

            if (JSON.stringify(nextSections[secKey]) !== JSON.stringify(cleanVal)) {
              nextSections[secKey] = cleanVal;
              mutated = true;
            }
          }
        }
      }

      if (changedKv && typeof changedKv === 'object') {
        for (const [k, v] of Object.entries(changedKv)) {
          if (!k || k.length > 120) continue;
          if (BLOCKED_DEVICE_KV_KEYS.has(k) || k.startsWith('local_voip_history_v1_')) {
            continue;
          }
          if (v === null) {
            if (k in nextKv) {
              delete nextKv[k];
              mutated = true;
            }
          } else if (typeof v === 'string') {
            if (nextKv[k] !== v) {
              nextKv[k] = v;
              mutated = true;
            }
          }
        }
      }

      if (mutated) {
        const nextState: MasterVaultDiskState = {
          revision: current.revision + 1,
          updatedAt: Date.now(),
          sections: nextSections,
          kvStore: nextKv,
        };
        writeMasterVault(nextState);
        res.json({
          ok: true,
          revision: nextState.revision,
          updatedAt: nextState.updatedAt,
        });
        return;
      }

      res.json({
        ok: true,
        revision: current.revision,
        updatedAt: current.updatedAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ana mahzen kaydedilemedi' });
    }
  });

  app.get('/api/web-bridge/check-user/:telefon', (req, res) => {
    try {
      const digits = String(req.params.telefon || '').replace(/\D/g, '');
      const norm10 = digits.length >= 10 ? digits.slice(-10) : digits;
      const vault = readMasterVault();
      const parseSafe = <T,>(raw: string | undefined, fallback: T): T => {
        if (!raw) return fallback;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return fallback;
        }
      };

      const installedMap = parseSafe<Record<string, any>>(vault.kvStore['sb_installed_apk_devices_v1'], {});
      const grantsMap = parseSafe<Record<string, any>>(vault.kvStore['sb_live_role_grants_v1'], {});
      const dealersArr = Array.isArray(vault.sections['dealers']) ? (vault.sections['dealers'] as any[]) : [];
      const subsArr = Array.isArray(vault.sections['subscribers']) ? (vault.sections['subscribers'] as any[]) : [];

      const matchedDealer = dealersArr.find(
        (d) =>
          d &&
          !String(d.id || '').startsWith('vacant-') &&
          !String(d.id || '').startsWith('dist-') &&
          String(d.contactPhone || d.phone || '').replace(/\D/g, '').slice(-10) === norm10
      );
      const matchedSub = subsArr.find(
        (s) => s && String(s.phone || s.contactPhone || '').replace(/\D/g, '').slice(-10) === norm10
      );
      const liveGrant = norm10 ? grantsMap[norm10] || null : null;

      const hasInstalledApk = Boolean(
        (norm10 && installedMap[norm10]) ||
          (matchedDealer && matchedDealer.status === 'ACTIVE') ||
          (matchedSub && matchedSub.apkStatus === 'ACTIVE' && matchedSub.source !== 'WEB_POOL')
      );

      const assignedCode =
        liveGrant?.code || matchedDealer?.dealerCode || matchedSub?.subscriberCode || null;
      const assignedRole =
        liveGrant?.roleTier ||
        (matchedDealer
          ? matchedDealer.level || (matchedDealer.licenseTier === 'MASTER_1000' ? 'IL' : 'ILCE')
          : matchedSub
          ? 'ESNAF'
          : null);
      const officialTitle =
        liveGrant?.title ||
        matchedDealer?.officialTitle ||
        matchedDealer?.name ||
        matchedSub?.companyName ||
        matchedSub?.name ||
        null;

      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
      const host = req.get('host') || '178.208.187.42:3000';
      const apkDownloadUrl = `${proto}://${host}/indir${
        assignedCode ? `?code=${encodeURIComponent(assignedCode)}&role=${encodeURIComponent(assignedRole || 'ESNAF')}` : ''
      }`;

      res.json({
        ok: true,
        phone10: norm10,
        hasInstalledApk,
        isApproved: Boolean(liveGrant || matchedDealer || matchedSub),
        assignedCode,
        assignedRole,
        officialTitle,
        liveGrant,
        actionMode: hasInstalledApk ? 'UPDATE_EXISTING_APP_ROLE' : 'INSTALL_APK',
        apkDownloadUrl,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Kullanıcı köprü sorgusu başarısız' });
    }
  });

  const pbxRulesFilePath = path.join(vaultDataDir, 'pbx-rules.json');
  const legacyPbxRulesFilePath = path.join(__dirname, 'public', '_live', 'pbx-rules.json');

  function readServerPbxRules(): Record<string, any> {
    for (const candidate of [pbxRulesFilePath, legacyPbxRulesFilePath]) {
      try {
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        }
      } catch {}
    }
    return { version: 2, totalActiveLines: 0, byPhone11: {} };
  }

  function normalizePhone11(raw: string): string {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10 && /^[23458]/.test(digits)) return `0${digits}`;
    if (digits.length === 11 && /^0[23458]/.test(digits)) return digits;
    if (digits.length === 12 && /^90[23458]/.test(digits)) return `0${digits.slice(2)}`;
    if (digits.length > 10) {
      const t10 = digits.slice(-10);
      if (/^[23458]/.test(t10)) return `0${t10}`;
    }
    return digits;
  }

  app.get('/api/pbx/status', async (_req, res) => {
    const [sipLocalOpen, sipPublicOpen, eslOpen, sipExternalOpen, postgresOpen] = await Promise.all([
      checkTcpPort('127.0.0.1', 5060),
      checkTcpPort('178.208.187.42', 5060),
      checkTcpPort('127.0.0.1', 8021),
      checkTcpPort('178.208.187.42', 5080),
      checkTcpPort('127.0.0.1', 5432),
    ]);

    let asistanApi: Record<string, unknown> | null = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const r = await fetch('http://127.0.0.1:8000/', { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        asistanApi = (await r.json()) as Record<string, unknown>;
      }
    } catch {
      asistanApi = null;
    }

    const sipReady = sipLocalOpen || sipPublicOpen || eslOpen || Boolean(asistanApi);
    const registry = readServerPbxRules();

    res.json({
      ok: sipReady,
      serverIp: '178.208.187.42',
      fusionPbxSipInternal: sipReady,
      fusionPbxSipExternal: sipExternalOpen || sipReady,
      postgresDatabase: postgresOpen,
      kenanAsistanApi: asistanApi,
      registeredLinesCount: Object.keys(registry?.byPhone11 || {}).length,
    });
  });

  app.post('/api/pbx/sync-rules', (req, res) => {
    try {
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || typeof payload.byPhone11 !== 'object') {
        res.status(400).json({ error: 'Geçersiz PBX kural paketi' });
        return;
      }
      fs.mkdirSync(path.dirname(pbxRulesFilePath), { recursive: true });
      fs.writeFileSync(pbxRulesFilePath, JSON.stringify(payload, null, 2), 'utf8');
      // Kurulumda hitap veya karşılama değiştiği saniye canlı ses kaydını arka planda hemen hazırla!
      void (async () => {
        try {
          const rules = Object.values(payload.byPhone11 || {}) as any[];
          const seen = new Set<string>();
          for (const r of rules.slice(0, 6)) {
            const g = String(r?.incomingGreetingSentence || '').trim();
            if (g && !seen.has(g)) {
              seen.add(g);
              await ensureLiveVoiceClip8k(g, 'Kore');
            }
          }
        } catch {}
      })();
      res.json({
        ok: true,
        totalActiveLines: Object.keys(payload.byPhone11).length,
        updatedAt: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'PBX kural senkronizasyon hatası' });
    }
  });

  app.get('/api/pbx/rules/:telefon', (req, res) => {
    const phone11 = normalizePhone11(req.params.telefon || '');
    const registry = readServerPbxRules();
    const rule = registry?.byPhone11?.[phone11] || null;
    res.json({
      ok: Boolean(rule),
      phone11,
      rule,
      centralGatewayPhone11: registry?.centralGatewayPhone11 || '02826060537',
    });
  });

  app.get('/api/pbx/check-caller/:telefon', async (req, res) => {
    try {
      const tel = encodeURIComponent(req.params.telefon || '');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`http://127.0.0.1:8000/check-caller/${tel}`, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await r.json().catch(() => ({}));
      res.status(r.status).json(data);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'FusionPBX / Asistan API bağlantı hatası' });
    }
  });

  app.post('/api/pbx/warm-transfer', async (req, res) => {
    try {
      const {
        sessionId,
        ownerPhone,
        targetPhone,
        hitapMode,
        greetingSentence,
        transferSentence,
        retryMinutes,
        smsFallbackOnUnreachable,
        freeswitchOriginateCmd,
        gateway,
      } = req.body || {};
      const cleanTarget = normalizePhone11(targetPhone || '');
      const cleanOwner = normalizePhone11(ownerPhone || '');
      const gwHost = String(gateway?.gatewayHost || '').trim();
      const gwPort = String(gateway?.sipPort || '5060').trim() || '5060';
      const gwEnabled = Boolean(gateway?.enabled && gwHost);
      const [sipLocal, sipPublic] = await Promise.all([
        checkTcpPort('127.0.0.1', 5060),
        checkTcpPort('178.208.187.42', 5060),
      ]);
      const sipOpen = sipLocal || sipPublic;

      res.json({
        ok: true,
        sessionId: sessionId || `fs-${Date.now()}`,
        pbxSipActive: sipOpen,
        gatewayConfigured: gwEnabled,
        cleanTarget,
        cleanOwner,
        hitapMode: hitapMode || 'NAME',
        greetingSentence: greetingSentence || '',
        transferSentence: transferSentence || '',
        retryMinutes: typeof retryMinutes === 'number' ? retryMinutes : 5,
        smsFallbackOnUnreachable: smsFallbackOnUnreachable ?? true,
        freeswitchOriginateCmd: freeswitchOriginateCmd || '',
        statusNote: gwEnabled
          ? `Merkez GSM Gateway (${gwHost}:${gwPort}) • ${cleanOwner} kuralıyla sessiz çağrı başlatıldı.`
          : `FreeSWITCH santral motoru (178.208.187.42:5060) • ${cleanOwner} kuralıyla arka planda sessiz akışı başlattı.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Santral aktarma hatası' });
    }
  });

  // =========================================================================
  // CANLI VOIP DATA (İNTERNET ÜZERİNDEN UYGULAMA İÇİ ZİL & GÖRÜŞME SİNYALİZASYONU)
  // Sıfır dış paket bağımlılığı: Express SSE (Server-Sent Events) + WebRTC SDP/ICE Rölesi
  // =========================================================================
  interface VoipPresenceClient {
    clientId: string;
    phone11: string;
    role: string;
    code: string;
    name: string;
    connectedAt: number;
    res: express.Response;
  }

  interface VoipCallSession {
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

  const voipClientsByPhone11 = new Map<string, Map<string, VoipPresenceClient>>();
  const activeVoipCalls = new Map<string, VoipCallSession>();
  const ringTimersByCallId = new Map<string, ReturnType<typeof setTimeout>>();
  const voipHistoryFilePath = path.join(vaultDataDir, 'voip-calls.json');

  function isSyntheticTestVoipCall(item: Partial<VoipCallSession> | null | undefined): boolean {
    if (!item) return true;
    const caller11 = normalizePhone11(String(item.callerPhone11 || ''));
    if (item.mode === 'PBX_TEST') return true;
    if (caller11 === '05324440500') return true;
    if (/canlı doğrulama|santral aktarma/i.test(String(item.callerName || ''))) return true;
    return false;
  }

  function writeVoipHistory(list: VoipCallSession[]): void {
    try {
      fs.mkdirSync(vaultDataDir, { recursive: true });
      fs.writeFileSync(voipHistoryFilePath, JSON.stringify(list.slice(0, 120), null, 2), 'utf8');
    } catch {}
  }

  function readVoipHistory(): VoipCallSession[] {
    try {
      if (fs.existsSync(voipHistoryFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(voipHistoryFilePath, 'utf8'));
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((item) => item && !isSyntheticTestVoipCall(item));
          if (cleaned.length !== parsed.length) {
            writeVoipHistory(cleaned);
          }
          return cleaned;
        }
      }
    } catch {}
    return [];
  }

  function appendVoipHistory(session: VoipCallSession): void {
    try {
      if (isSyntheticTestVoipCall(session)) return;
      const current = readVoipHistory().filter((item) => item && item.callId !== session.callId);
      const next = [session, ...current].slice(0, 120);
      writeVoipHistory(next);
    } catch {}
  }

  function sendSseEvent(res: express.Response, eventName: string, payload: unknown): void {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {}
  }

  function broadcastToPhone11(phone11: string, eventName: string, payload: unknown): number {
    const clean = normalizePhone11(phone11);
    const bucket = voipClientsByPhone11.get(clean);
    if (!bucket || bucket.size === 0) return 0;
    let delivered = 0;
    for (const client of bucket.values()) {
      sendSseEvent(client.res, eventName, payload);
      delivered++;
    }
    return delivered;
  }

  function getOnlinePresenceSummary() {
    const list: Array<{ phone11: string; role: string; code: string; name: string; connectedAt: number }> = [];
    for (const [phone11, bucket] of voipClientsByPhone11.entries()) {
      const first = bucket.values().next().value as VoipPresenceClient | undefined;
      if (first) {
        list.push({
          phone11,
          role: first.role,
          code: first.code,
          name: first.name,
          connectedAt: first.connectedAt,
        });
      }
    }
    return list;
  }

  function broadcastPresenceAll(): void {
    const summary = getOnlinePresenceSummary();
    for (const bucket of voipClientsByPhone11.values()) {
      for (const client of bucket.values()) {
        sendSseEvent(client.res, 'voip:presence', { onlineLines: summary });
      }
    }
  }

  app.get('/api/voip/presence', (_req, res) => {
    res.json({
      ok: true,
      serverIp: '178.208.187.42',
      pbxSipPort: 5060,
      onlineLines: getOnlinePresenceSummary(),
    });
  });

  app.get('/api/voip/history/:telefon', (req, res) => {
    const phone11 = normalizePhone11(req.params.telefon || '');
    if (!phone11 || phone11.length < 10) {
      res.json({ ok: true, phone11: '', calls: [] });
      return;
    }
    const all = readVoipHistory();
    const filtered = all.filter(
      (c) =>
        !isSyntheticTestVoipCall(c) &&
        (c.targetPhone11 === phone11 || (c.mode === 'PEER_VOIP' && c.callerPhone11 === phone11))
    );
    res.json({ ok: true, phone11, calls: filtered.slice(0, 40) });
  });

  app.delete('/api/voip/history/:telefon', (req, res) => {
    const phone11 = normalizePhone11(req.params.telefon || '');
    if (!phone11 || phone11.length < 10) {
      res.status(400).json({ ok: false, error: 'Geçersiz numara' });
      return;
    }
    const all = readVoipHistory();
    const remaining = all.filter((c) => c.targetPhone11 !== phone11 && c.callerPhone11 !== phone11);
    writeVoipHistory(remaining);
    res.json({ ok: true, cleared: all.length - remaining.length });
  });

  app.get('/api/voip/active/:telefon', (req, res) => {
    const phone11 = normalizePhone11(req.params.telefon || '');
    if (!phone11 || phone11.length < 10) {
      res.json({ ok: true, activeCall: null });
      return;
    }
    const currentCall = Array.from(activeVoipCalls.values()).find(
      (c) =>
        (c.targetPhone11 === phone11 || c.callerPhone11 === phone11) &&
        (c.status === 'RINGING' || c.status === 'CONNECTED' || c.status === 'ON_HOLD')
    );
    res.json({ ok: true, activeCall: currentCall || null });
  });

  app.get('/api/voip/stream', (req, res) => {
    const phone11 = normalizePhone11(String(req.query?.phone11 || ''));
    if (!phone11 || phone11.length < 10) {
      res.status(400).json({ error: 'Geçersiz GSM numarası' });
      return;
    }

    const clientId = `${phone11}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const role = String(req.query?.role || 'esnaf').slice(0, 32);
    const code = String(req.query?.code || '').slice(0, 32);
    const name = String(req.query?.name || phone11).slice(0, 80);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let bucket = voipClientsByPhone11.get(phone11);
    if (!bucket) {
      bucket = new Map();
      voipClientsByPhone11.set(phone11, bucket);
    }
    bucket.set(clientId, {
      clientId,
      phone11,
      role,
      code,
      name,
      connectedAt: Date.now(),
      res,
    });

    // Bu hat için şu an çalan veya devam eden çağrı varsa anında senkronize et
    const currentCall = Array.from(activeVoipCalls.values()).find(
      (c) =>
        (c.targetPhone11 === phone11 || c.callerPhone11 === phone11) &&
        (c.status === 'RINGING' || c.status === 'CONNECTED' || c.status === 'ON_HOLD')
    );

    sendSseEvent(res, 'voip:init', {
      ok: true,
      clientId,
      phone11,
      serverIp: '178.208.187.42',
      onlineLines: getOnlinePresenceSummary(),
      activeCall: currentCall || null,
    });
    broadcastPresenceAll();

    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      const b = voipClientsByPhone11.get(phone11);
      if (b) {
        b.delete(clientId);
        if (b.size === 0) {
          voipClientsByPhone11.delete(phone11);
        }
      }
      broadcastPresenceAll();
    });
  });

  function triggerInternalVoipRing(body: Record<string, any>): {
    ok: boolean;
    idempotent?: boolean;
    deliveredClients: number;
    targetOnline: boolean;
    call: VoipCallSession;
  } {
    const targetPhone11 = normalizePhone11(
      String(body.targetPhone || body.diversionPhone || body.subscriberPhone || '')
    );
    const callerPhone11 =
      normalizePhone11(String(body.callerPhone || '05325551234')) || '05325551234';
    if (!targetPhone11 || targetPhone11.length < 10) {
      throw new Error('Hedef 05XX numarası eksik');
    }

    const requestedId = String(body.callId || '').trim();
    const callId = requestedId || `voip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const existing = activeVoipCalls.get(callId);
    if (existing) {
      return {
        ok: true,
        idempotent: true,
        deliveredClients: 0,
        targetOnline: true,
        call: existing,
      };
    }

    const registry = readServerPbxRules();
    const rule = registry?.byPhone11?.[targetPhone11] || null;
    const targetName =
      String(body.targetName || '').trim() ||
      rule?.companyName ||
      rule?.fullName ||
      targetPhone11;
    const targetCode = String(body.targetCode || '').trim() || rule?.entityCode || 'SANTRAL';
    const callerName =
      String(body.callerName || '').trim() ||
      `${callerPhone11.slice(0, 4)} ${callerPhone11.slice(4, 7)} ${callerPhone11.slice(7, 9)} ${callerPhone11.slice(9, 11)}`;
    const mode: VoipCallSession['mode'] =
      body.mode === 'PEER_VOIP' || body.mode === 'PBX_TEST' ? body.mode : 'PBX_BRIDGE';

    const honorific = rule?.personHonorific || 'Yetkili';
    const defaultScreening =
      mode === 'PEER_VOIP'
        ? `Santral Bayi VoIP Data (0 ₺ İnternet Hattı) üzerinden ${callerName} sizi doğrudan uygulama içinden arıyor.`
        : `${honorific}, hattımızda ${callerName} var; ön görüşmesini tamamladım ve sizinle görüşmek istiyor.`;

    const isLivePbxBridge = mode === 'PBX_BRIDGE';
    const session: VoipCallSession = {
      callId,
      fsUuid: String(body.fsUuid || '').trim() || undefined,
      safeUuid: String(body.safeUuid || '').trim() || undefined,
      mode,
      callerPhone11,
      callerName,
      callerCode: String(body.callerCode || '').trim() || undefined,
      targetPhone11,
      targetName,
      targetCode,
      screeningNote: String(body.screeningNote || '').trim() || defaultScreening,
      spokenGreeting:
        String(body.spokenGreeting || '').trim() ||
        rule?.incomingGreetingSentence ||
        'Merhaba, hoş geldiniz! Sizi hemen yetkiliye aktarıyorum.',
      callerIntent: String(body.callerIntent || '').trim() || undefined,
      callerIssueSummary: String(body.callerIssueSummary || '').trim() || undefined,
      secretaryReply: String(body.secretaryReply || '').trim() || undefined,
      extractedAppointment: String(body.extractedAppointment || '').trim() || undefined,
      diversionLinePhone11: String(body.diversionLinePhone11 || '').trim() || undefined,
      liveTranscript: Array.isArray(body.liveTranscript) ? body.liveTranscript : undefined,
      turns: Number(body.turns || 0) || 0,
      status: isLivePbxBridge ? 'CONNECTED' : 'RINGING',
      createdAt: Date.now(),
      answeredAt: isLivePbxBridge ? Date.now() : undefined,
      durationSec: 0,
    };

    activeVoipCalls.set(callId, session);
    const deliveredCount = broadcastToPhone11(targetPhone11, 'call:incoming', session);
    if (callerPhone11 !== targetPhone11) {
      broadcastToPhone11(callerPhone11, 'call:outgoing_ringing', session);
    }

    const ringTimeoutMs = isLivePbxBridge ? 10 * 60 * 1000 : 32000;
    const ringTimer = setTimeout(() => {
      const cur = activeVoipCalls.get(callId);
      if (cur && (cur.status === 'RINGING' || (isLivePbxBridge && cur.status === 'CONNECTED'))) {
        cur.status = 'SECRETARY_HANDLED';
        cur.endedAt = Date.now();
        cur.durationSec = cur.answeredAt ? Math.max(1, Math.round((cur.endedAt - cur.answeredAt) / 1000)) : 0;
        cur.endReason = cur.callerIssueSummary
          ? `Sekreter Kaydetti: ${cur.callerIssueSummary}`
          : 'Sekreter Görüşmeyi Tamamladı';
        activeVoipCalls.delete(callId);
        ringTimersByCallId.delete(callId);
        appendVoipHistory(cur);
        broadcastToPhone11(cur.targetPhone11, 'call:ended', cur);
        if (cur.callerPhone11 !== cur.targetPhone11) {
          broadcastToPhone11(cur.callerPhone11, 'call:ended', cur);
        }
      }
    }, ringTimeoutMs);
    ringTimersByCallId.set(callId, ringTimer);

    return {
      ok: true,
      deliveredClients: deliveredCount,
      targetOnline: deliveredCount > 0,
      call: session,
    };
  }

  function findActiveVoipByFsId(uuid?: string, safeUuid?: string): VoipCallSession | undefined {
    if (uuid && activeVoipCalls.has(uuid)) return activeVoipCalls.get(uuid);
    for (const s of activeVoipCalls.values()) {
      if ((uuid && (s.fsUuid === uuid || s.callId === uuid)) || (safeUuid && s.safeUuid === safeUuid)) {
        return s;
      }
    }
    return undefined;
  }

  function endActiveLivePbxVoipSession(
    uuid: string,
    safeUuid: string,
    reason?: string,
    transcript?: Array<{ speaker: 'AI' | 'CALLER'; text: string }>
  ): void {
    const cur = findActiveVoipByFsId(uuid, safeUuid);
    if (!cur) return;
    const timer = ringTimersByCallId.get(cur.callId);
    if (timer) {
      clearTimeout(timer);
      ringTimersByCallId.delete(cur.callId);
    }
    cur.status = 'SECRETARY_HANDLED';
    cur.endedAt = Date.now();
    cur.durationSec = cur.answeredAt ? Math.max(1, Math.round((cur.endedAt - cur.answeredAt) / 1000)) : 1;
    if (transcript && transcript.length > 0) {
      cur.liveTranscript = transcript;
    }
    cur.endReason = reason || cur.screeningNote || 'Sekreter görüşmeyi tamamladı.';
    activeVoipCalls.delete(cur.callId);
    appendVoipHistory(cur);
    broadcastToPhone11(cur.targetPhone11, 'call:ended', cur);
    if (cur.callerPhone11 !== cur.targetPhone11) {
      broadcastToPhone11(cur.callerPhone11, 'call:ended', cur);
    }
  }

  function dispatchIncomingVoipRing(req: express.Request, res: express.Response) {
    try {
      const out = triggerInternalVoipRing(req.body || {});
      res.json(out);
    } catch (err: any) {
      const status = String(err?.message || '').includes('Hedef 05XX') ? 400 : 500;
      res.status(status).json({ error: err?.message || 'VoIP zil başlatılamadı' });
    }
  }

  app.post('/api/voip/ring', dispatchIncomingVoipRing);
  app.post('/api/pbx/incoming-voip-bridge', dispatchIncomingVoipRing);

  app.post('/api/voip/answer', (req, res) => {
    const callId = String(req.body?.callId || '').trim();
    const cur = activeVoipCalls.get(callId);
    if (!cur) {
      res.status(404).json({ error: 'Aktif çağrı bulunamadı' });
      return;
    }
    const timer = ringTimersByCallId.get(callId);
    if (timer) {
      clearTimeout(timer);
      ringTimersByCallId.delete(callId);
    }
    if (cur.status === 'RINGING') {
      cur.status = 'CONNECTED';
      cur.answeredAt = Date.now();
    }
    broadcastToPhone11(cur.targetPhone11, 'call:answered', cur);
    if (cur.callerPhone11 !== cur.targetPhone11) {
      broadcastToPhone11(cur.callerPhone11, 'call:answered', cur);
    }
    res.json({ ok: true, call: cur });
  });

  app.post('/api/voip/hold', (req, res) => {
    const callId = String(req.body?.callId || '').trim();
    const hold = Boolean(req.body?.hold);
    const cur = activeVoipCalls.get(callId);
    if (!cur) {
      res.status(404).json({ error: 'Aktif çağrı bulunamadı' });
      return;
    }
    cur.status = hold ? 'ON_HOLD' : 'CONNECTED';
    broadcastToPhone11(cur.targetPhone11, 'call:updated', cur);
    if (cur.callerPhone11 !== cur.targetPhone11) {
      broadcastToPhone11(cur.callerPhone11, 'call:updated', cur);
    }
    res.json({ ok: true, call: cur });
  });

  app.post('/api/voip/transfer-secretary', (req, res) => {
    const callId = String(req.body?.callId || '').trim();
    const note = String(req.body?.note || 'Çağrı tek tuşla Yapay Zeka Sekretere devredildi; not/randevu alınıyor.').trim();
    const cur = activeVoipCalls.get(callId);
    if (!cur) {
      res.json({ ok: true, alreadyEnded: true });
      return;
    }
    const timer = ringTimersByCallId.get(callId);
    if (timer) {
      clearTimeout(timer);
      ringTimersByCallId.delete(callId);
    }
    cur.status = 'SECRETARY_HANDLED';
    cur.endedAt = Date.now();
    cur.durationSec = cur.answeredAt ? Math.max(1, Math.round((cur.endedAt - cur.answeredAt) / 1000)) : 0;
    cur.endReason = note;
    activeVoipCalls.delete(callId);
    appendVoipHistory(cur);
    broadcastToPhone11(cur.targetPhone11, 'call:ended', cur);
    if (cur.callerPhone11 !== cur.targetPhone11) {
      broadcastToPhone11(cur.callerPhone11, 'call:ended', cur);
    }
    res.json({ ok: true, call: cur });
  });

  app.post('/api/voip/hangup', (req, res) => {
    const callId = String(req.body?.callId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const cur = activeVoipCalls.get(callId) || findActiveVoipByFsId(callId, callId);
    if (!cur) {
      // Aktif liste temizlenmiş olsa bile gerçek hat hala açıksa kapatmayı dene
      if (callId) {
        try {
          pbxLiveBridge.hangupCallByUuid(callId);
        } catch {}
      }
      res.json({ ok: true, alreadyEnded: true });
      return;
    }
    const timer = ringTimersByCallId.get(cur.callId);
    if (timer) {
      clearTimeout(timer);
      ringTimersByCallId.delete(cur.callId);
    }
    // Gerçek telefon aramasıysa canlı santral hattını da anında kapat!
    if (cur.mode === 'PBX_BRIDGE') {
      const realFsId = cur.fsUuid || cur.safeUuid || cur.callId;
      try {
        pbxLiveBridge.hangupCallByUuid(realFsId);
        if (cur.safeUuid && cur.safeUuid !== realFsId) {
          pbxLiveBridge.hangupCallByUuid(cur.safeUuid);
        }
      } catch {}
      if (cur.fsUuid && /^[a-zA-Z0-9_-]{6,64}$/.test(cur.fsUuid)) {
        try {
          execFile('fs_cli', ['-x', `uuid_kill ${cur.fsUuid}`], { timeout: 2500 }, () => {});
        } catch {}
      }
    }
    const wasConnected = Boolean(cur.answeredAt);
    cur.status = wasConnected ? 'ENDED' : 'REJECTED';
    cur.endedAt = Date.now();
    cur.durationSec = cur.answeredAt ? Math.max(1, Math.round((cur.endedAt - cur.answeredAt) / 1000)) : 0;
    cur.endReason =
      reason ||
      (wasConnected ? 'Görüşme kullanıcı tarafından sonlandırıldı.' : 'Arama reddedildi.');
    activeVoipCalls.delete(cur.callId);
    appendVoipHistory(cur);
    broadcastToPhone11(cur.targetPhone11, 'call:ended', cur);
    if (cur.callerPhone11 !== cur.targetPhone11) {
      broadcastToPhone11(cur.callerPhone11, 'call:ended', cur);
    }
    res.json({ ok: true, call: cur });
  });

  // =========================================================================
  // CANLI NETGSM COĞRAFİ HAT (0282 606 05 37) ↔ FREESWITCH GELEN ÇAĞRI KÖPRÜSÜ
  // =========================================================================
  const fsAudioDir = path.join(vaultDataDir, 'fs-audio');
  const fsScriptsDir = path.join(vaultDataDir, 'fs-scripts');
  const fsRecordingsDir = path.join(vaultDataDir, 'fs-recordings');
  const liveNetgsmCallsPath = path.join(vaultDataDir, 'pbx-live-calls.json');

  try {
    fs.mkdirSync(fsAudioDir, { recursive: true, mode: 0o755 });
    fs.mkdirSync(fsScriptsDir, { recursive: true, mode: 0o755 });
    fs.mkdirSync(fsRecordingsDir, { recursive: true, mode: 0o777 });
    try {
      fs.chmodSync(vaultDataDir, 0o755);
      fs.chmodSync(fsAudioDir, 0o755);
      fs.chmodSync(fsScriptsDir, 0o755);
      fs.chmodSync(fsRecordingsDir, 0o777);
    } catch {}
  } catch {}

  let cachedLiveNetgsmCalls: any[] | null = null;
  let liveCallsWriteChain: Promise<void> = Promise.resolve();
  const cachedRecMetaByUuid = new Map<string, { hasWav: boolean; recBytes: number; checkedAt: number }>();

  let cachedFsServiceActive = 'active';
  let cachedListeningSipLines: string[] = [];
  let lastFsStatusPollAt = 0;

  function refreshFsStatusAsync(): void {
    const now = Date.now();
    if (now - lastFsStatusPollAt < 15000) return;
    lastFsStatusPollAt = now;
    execFile('systemctl', ['is-active', 'freeswitch'], { timeout: 2500 }, (_err, stdout) => {
      const out = String(stdout || '').trim();
      if (out) cachedFsServiceActive = out;
    });
    execFile('ss', ['-ulpn'], { timeout: 2500 }, (_err, stdout) => {
      const out = String(stdout || '');
      if (out) {
        cachedListeningSipLines = out.split('\n').filter((l) => /:5060\b|:5080\b/.test(l));
      }
    });
  }
  if (!IS_STUDIO_PREVIEW_PROXY) {
    refreshFsStatusAsync();
    setInterval(refreshFsStatusAsync, 15000);
  }

  function flushLiveNetgsmCallsAsync(list: any[]): void {
    const serialized = JSON.stringify(list.slice(0, 120));
    liveCallsWriteChain = liveCallsWriteChain
      .then(async () => {
        try {
          const tmp = `${liveNetgsmCallsPath}.tmp`;
          await fs.promises.writeFile(tmp, serialized, 'utf8');
          await fs.promises.rename(tmp, liveNetgsmCallsPath);
        } catch {}
      })
      .catch(() => {});
  }

  function readLiveNetgsmCalls(): any[] {
    if (cachedLiveNetgsmCalls) return cachedLiveNetgsmCalls;
    try {
      if (fs.existsSync(liveNetgsmCallsPath)) {
        const parsed = JSON.parse(fs.readFileSync(liveNetgsmCallsPath, 'utf8'));
        cachedLiveNetgsmCalls = Array.isArray(parsed) ? parsed : [];
        return cachedLiveNetgsmCalls;
      }
    } catch {}
    cachedLiveNetgsmCalls = [];
    return cachedLiveNetgsmCalls;
  }

  function appendLiveNetgsmCall(entry: any): void {
    try {
      const list = readLiveNetgsmCalls();
      const idx = list.findIndex((x: any) => x?.uuid && entry?.uuid && x.uuid === entry.uuid);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...entry, updatedAt: Date.now() };
      } else {
        list.unshift({ ...entry, createdAt: Date.now() });
      }
      if (entry?.safeUuid) {
        cachedRecMetaByUuid.delete(String(entry.safeUuid));
      }
      cachedLiveNetgsmCalls = list.slice(0, 120);
      flushLiveNetgsmCallsAsync(cachedLiveNetgsmCalls);
    } catch {}
  }

  function extractTrPhoneFromHeader(rawHeader: string): string {
    const raw = String(rawHeader || '');
    if (!raw) return '';
    // Match 05XXXXXXXXX, 905XXXXXXXXX, +905XXXXXXXXX, or 5XXXXXXXXX inside SIP Diversion / History-Info / RDNIS
    const m = raw.match(/(?:\+?90|0)?(5\d{9})\b/);
    if (m && m[1]) {
      return `0${m[1]}`;
    }
    return '';
  }

  async function ensureFreeSwitchClonedWav(textToSpeak: string, fileSlug?: string): Promise<string> {
    const cleanText = String(textToSpeak || '').trim();
    if (!cleanText) return '';
    const hash = fileSlug || crypto.createHash('sha1').update(cleanText).digest('hex').slice(0, 16);
    const outWav8k = path.join(fsAudioDir, `${hash}_8k.wav`);
    if (fs.existsSync(outWav8k) && fs.statSync(outWav8k).size > 2000) {
      return outWav8k;
    }

    let rawWavBuf: Buffer | null = null;
    try {
      const ttsRes = await fetch('http://127.0.0.1:3000/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText }),
      });
      if (ttsRes.ok) {
        const ttsJson = (await ttsRes.json()) as any;
        const dataUrl = String(ttsJson?.audioDataUrl || '');
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx > 0) {
          rawWavBuf = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
        }
      }
    } catch {}

    // Fallback: use bank clip if local TTS call couldn't synthesize
    if (!rawWavBuf || rawWavBuf.length < 1000) {
      try {
        const neuralDir = path.join(__dirname, 'public', 'assets', 'aistudio', 'neural');
        const fallbackWav = path.join(neuralDir, 'kenan_default.wav');
        if (fs.existsSync(fallbackWav)) {
          rawWavBuf = fs.readFileSync(fallbackWav);
        }
      } catch {}
    }

    if (!rawWavBuf || rawWavBuf.length < 1000) return '';

    const tmpRawPath = path.join(fsAudioDir, `${hash}_src.wav`);
    fs.writeFileSync(tmpRawPath, rawWavBuf);
    try {
      fs.chmodSync(tmpRawPath, 0o644);
    } catch {}

    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-i', tmpRawPath, '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', outWav8k],
        { timeout: 15000, stdio: 'pipe' }
      );
      try {
        fs.chmodSync(outWav8k, 0o644);
      } catch {}
      try {
        fs.unlinkSync(tmpRawPath);
      } catch {}
      return outWav8k;
    } catch {
      // If ffmpeg is unavailable, FreeSWITCH mod_sndfile can resample standard PCM WAV directly
      try {
        fs.copyFileSync(tmpRawPath, outWav8k);
        fs.chmodSync(outWav8k, 0o644);
      } catch {}
      return fs.existsSync(outWav8k) ? outWav8k : tmpRawPath;
    }
  }

  let lastPhoneTtsDiag = '';
  let geminiTtsSkipUntil = 0;

  function downsamplePcm24kToWav8k(pcm24kBuf: Buffer): Buffer {
    // Unary Gemini TTS tam WAV döndürebilir: RIFF başlığı varsa atla
    let rawPcm = pcm24kBuf;
    if (pcm24kBuf.length > 44 && pcm24kBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
      const dataIdx = pcm24kBuf.subarray(0, Math.min(pcm24kBuf.length, 512)).indexOf(Buffer.from('data'));
      const offset = dataIdx >= 12 && dataIdx + 8 < pcm24kBuf.length ? dataIdx + 8 : 44;
      rawPcm = pcm24kBuf.subarray(offset);
    }
    const sampleCount24k = Math.floor(rawPcm.length / 2);
    const sampleCount8k = Math.floor(sampleCount24k / 3);
    const pcm8k = Buffer.allocUnsafe(sampleCount8k * 2);
    for (let i = 0; i < sampleCount8k; i++) {
      const idx = i * 3;
      const s0 = rawPcm.readInt16LE(idx * 2);
      const s1 = rawPcm.readInt16LE((idx + 1) * 2);
      const s2 = rawPcm.readInt16LE((idx + 2) * 2);
      const avg = Math.round((s0 * 0.25 + s1 * 0.5 + s2 * 0.25) * 0.84);
      pcm8k.writeInt16LE(Math.max(-32767, Math.min(32767, avg)), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm8k.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(16000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm8k.length, 40);
    return Buffer.concat([header, pcm8k]);
  }

  function pruneDynamicPhoneAudioCache() {
    try {
      const dynamicFiles = fs
        .readdirSync(fsAudioDir)
        .filter((f) => (f.startsWith('ai4_') || f.startsWith('ai3_') || f.startsWith('ai2_') || /^ai_[0-9a-f]{16}_8k\.wav$/.test(f)) && f.endsWith('_8k.wav'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(fsAudioDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of dynamicFiles.slice(60)) {
        try {
          fs.unlinkSync(path.join(fsAudioDir, old.f));
        } catch {}
      }
    } catch {}
  }

  const geminiIpv4Agent = new https.Agent({ keepAlive: true, family: 4, maxSockets: 12 });

  function callGeminiTurnDirectIpv4(
    model: string,
    systemInstructionText: string,
    wavBase64: string,
    timeoutMs = 4800
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        reject(new Error('no_key'));
        return;
      }
      const payload = JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstructionText }],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: wavBase64,
                },
              },
              {
                text: 'Arayanın sesindeki Türkçe sözleri yaz ve canlı bir insan sekreter gibi anlık cevabını JSON döndür.',
              },
            ],
          },
        ],
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              callerTranscript: { type: 'STRING' },
              quickReplyId: { type: 'STRING' },
              secretaryReply: { type: 'STRING' },
              shouldHangup: { type: 'BOOLEAN' },
              aiSummary: { type: 'STRING' },
              appointmentBooked: { type: 'STRING' },
              callerName: { type: 'STRING' },
            },
            required: ['callerTranscript', 'secretaryReply', 'shouldHangup', 'aiSummary'],
          },
        },
      });
      const req = https.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          method: 'POST',
          agent: geminiIpv4Agent,
          family: 4,
          timeout: timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': 'aistudio-build',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const bodyStr = Buffer.concat(chunks).toString('utf8');
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new Error(`http_${res.statusCode || 0}:${bodyStr.replace(/[\r\n]+/g, ' ').slice(0, 110)}`));
              return;
            }
            try {
              const json = JSON.parse(bodyStr);
              const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              resolve(txt);
            } catch (err) {
              reject(err);
            }
          });
          res.on('error', reject);
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  function callGeminiTtsDirectIpv4(
    model: string,
    text: string,
    voiceName = 'Kore',
    timeoutMs = 6500
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        reject(new Error('no_key'));
        return;
      }
      const payload = JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: String(text || '').slice(0, 420) }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      const req = https.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          method: 'POST',
          agent: geminiIpv4Agent,
          family: 4,
          timeout: timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': 'aistudio-build',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const bodyStr = Buffer.concat(chunks).toString('utf8');
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new Error(`http_${res.statusCode || 0}:${bodyStr.replace(/[\r\n]+/g, ' ').slice(0, 110)}`));
              return;
            }
            try {
              const json = JSON.parse(bodyStr);
              const b64 = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || '';
              if (!b64) {
                reject(new Error('empty_audio'));
                return;
              }
              resolve(Buffer.from(b64, 'base64'));
            } catch (err) {
              reject(err);
            }
          });
          res.on('error', reject);
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async function ensureFreeSwitchFastPhoneWav(textToSpeak: string, fileSlug?: string): Promise<string> {
    lastPhoneTtsDiag = '';
    const cleanText = String(textToSpeak || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/["“”«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) return '';

    const hash = fileSlug || `ai5_${crypto.createHash('sha1').update(cleanText.toLocaleLowerCase('tr-TR')).digest('hex').slice(0, 16)}`;
    const outWav8k = path.join(fsAudioDir, `${hash}_8k.wav`);
    if (fs.existsSync(outWav8k) && fs.statSync(outWav8k).size > 2000) {
      lastPhoneTtsDiag = 'cache_hit';
      return outWav8k;
    }

    let rawAudioBuf: Buffer | null = null;
    let rawExt: 'wav' | 'mp3' = 'wav';
    const errs: string[] = [];

    function httpsGetIpv4Buffer(urlStr: string, timeoutMs = 2400): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const req = https.get(
          urlStr,
          {
            family: 4,
            timeout: timeoutMs,
            headers: { 'User-Agent': 'Mozilla/5.0' },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              httpsGetIpv4Buffer(res.headers.location, timeoutMs).then(resolve, reject);
              return;
            }
            if (!res.statusCode || res.statusCode >= 400) {
              res.resume();
              reject(new Error(`http_${res.statusCode || 0}`));
              return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          }
        );
        req.on('timeout', () => {
          req.destroy(new Error('timeout'));
        });
        req.on('error', reject);
      });
    }

    // 1. BİRİNCİL SES: Alt menüdeki demo ses modeliyle uyumlu sıcak müşteri hizmetleri kadın sesi (Kore - doğrudan IPv4)
    if (process.env.GEMINI_API_KEY && Date.now() >= geminiTtsSkipUntil) {
      const ttsModels = ['gemini-3.8-flash-lite-tts'];
      const ttsTimeout = fileSlug ? 8500 : 4800;
      for (const ttsModel of ttsModels) {
        try {
          const pcm24k = await callGeminiTtsDirectIpv4(ttsModel, cleanText.slice(0, 380), 'Kore', ttsTimeout);
          if (pcm24k.length > 3000) {
            const wav8k = downsamplePcm24kToWav8k(pcm24k);
            fs.writeFileSync(outWav8k, wav8k);
            try {
              fs.chmodSync(outWav8k, 0o644);
            } catch {}
            pruneDynamicPhoneAudioCache();
            lastPhoneTtsDiag = `gemini_kore_demo_8k:${ttsModel}`;
            return outWav8k;
          }
          errs.push(`${ttsModel}:small_${pcm24k.length}`);
        } catch (e: any) {
          const msg = String(e?.message || e).replace(/[\r\n]+/g, ' ').slice(0, 100);
          errs.push(`${ttsModel}:${msg}`);
          if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
            geminiTtsSkipUntil = Date.now() + 30 * 60 * 1000;
            break;
          }
        }
      }
    }

    // 2. Hızlı Yedek: Saf IPv4 Türkçe telefon sesi (asla sessiz kalmaz)
    if (!rawAudioBuf || rawAudioBuf.length < 2000) {
      try {
        const chunksText: string[] = [];
        const words = cleanText.slice(0, 380).split(/\s+/);
        let cur = '';
        for (const w of words) {
          if ((cur + ' ' + w).trim().length > 175 && cur) {
            chunksText.push(cur.trim());
            cur = w;
          } else {
            cur = (cur + ' ' + w).trim();
          }
        }
        if (cur) chunksText.push(cur.trim());

        const mp3Parts = await Promise.all(
          chunksText.map((seg) => {
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=tr&client=tw-ob&q=${encodeURIComponent(seg)}`;
            return httpsGetIpv4Buffer(url, 2400);
          })
        );
        const mergedGtts = Buffer.concat(mp3Parts);
        if (mergedGtts.length > 1500) {
          rawAudioBuf = mergedGtts;
          rawExt = 'mp3';
          lastPhoneTtsDiag = errs.length ? `fast_tr_tts_v4(${errs.join('|').slice(0, 120)})` : 'fast_tr_tts_v4';
        }
      } catch (e: any) {
        errs.push(`fast_tts:${String(e?.message || e).slice(0, 90)}`);
      }
    }

    // 4. Son yedek: MsEdgeTTS tr-TR-EmelNeural
    if (!rawAudioBuf || rawAudioBuf.length < 2000) {
      try {
        const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
        const tts = new MsEdgeTTS();
        await tts.setMetadata('tr-TR-EmelNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(cleanText.slice(0, 380));
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('edge_tts_timeout')), 2200);
          audioStream.on('data', (chunk: Buffer | Uint8Array) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          audioStream.on('end', () => {
            clearTimeout(timer);
            resolve();
          });
          audioStream.on('error', (err: any) => {
            clearTimeout(timer);
            reject(err);
          });
        });
        const merged = Buffer.concat(chunks);
        if (merged.length > 1500) {
          rawAudioBuf = merged;
          rawExt = 'mp3';
          lastPhoneTtsDiag = errs.length ? `msedge_emel(${errs.join('|').slice(0, 140)})` : 'msedge_emel';
        } else {
          errs.push(`msedge:small_${merged.length}`);
        }
      } catch (e: any) {
        errs.push(`msedge:${String(e?.message || e).slice(0, 90)}`);
      }
    }

    if (!rawAudioBuf || rawAudioBuf.length < 1500) {
      lastPhoneTtsDiag = errs.join(' | ');
      return '';
    }

    const tmpRawPath = path.join(fsAudioDir, `${hash}_src.${rawExt}`);
    fs.writeFileSync(tmpRawPath, rawAudioBuf);
    try {
      fs.chmodSync(tmpRawPath, 0o644);
    } catch {}

    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-i', tmpRawPath, '-ac', '1', '-ar', '8000', '-af', 'atempo=1.05,highpass=f=180,lowpass=f=3500,volume=-2.5dB', '-c:a', 'pcm_s16le', outWav8k],
        { timeout: 10000, stdio: 'pipe' }
      );
      try {
        fs.chmodSync(outWav8k, 0o644);
        fs.unlinkSync(tmpRawPath);
      } catch {}
      pruneDynamicPhoneAudioCache();
      return outWav8k;
    } catch (e: any) {
      lastPhoneTtsDiag = `${lastPhoneTtsDiag}|ffmpeg:${String(e?.message || e).slice(0, 100)}`;
      try {
        fs.copyFileSync(tmpRawPath, outWav8k);
        fs.chmodSync(outWav8k, 0o644);
      } catch {}
      return fs.existsSync(outWav8k) ? outWav8k : '';
    }
  }

  function buildSantralBayiInboundLua(recordingsDir: string): string {
    return `-- Santral Bayi Canlı Netgsm Gelen Çağrı Sekreter Köprüsü (Sabırlı Dinleme & Hızlı Yanıt)
local api = freeswitch.API()

local function safe_var(name)
  local v = session:getVariable(name)
  if v == nil then return "" end
  return tostring(v)
end

local function shell_escape(s)
  return "'" .. tostring(s or ""):gsub("'", "'\\\\''") .. "'"
end

local uuid = safe_var("uuid")
local caller = safe_var("caller_id_number")
local caller_name = safe_var("caller_id_name")
local dest = safe_var("destination_number")
local rdnis = safe_var("rdnis")
local diversion = safe_var("sip_h_Diversion")
local history_info = safe_var("sip_h_History-Info")
local redirect_user = safe_var("sip_redirect_contact_user")
local sip_from = safe_var("sip_from_uri")
local sip_to = safe_var("sip_to_uri")

freeswitch.consoleLog("INFO", "[SantralBayi] Gelen Netgsm cagri uuid=" .. uuid .. " caller=" .. caller .. " dest=" .. dest .. " rdnis=" .. rdnis .. " diversion=" .. diversion .. "\\n")

local cmd = "curl -sS --max-time 10 -G http://127.0.0.1:3000/api/pbx/fs-inbound-resolve"
  .. " --data-urlencode " .. shell_escape("uuid=" .. uuid)
  .. " --data-urlencode " .. shell_escape("caller=" .. caller)
  .. " --data-urlencode " .. shell_escape("callerName=" .. caller_name)
  .. " --data-urlencode " .. shell_escape("dest=" .. dest)
  .. " --data-urlencode " .. shell_escape("rdnis=" .. rdnis)
  .. " --data-urlencode " .. shell_escape("diversion=" .. diversion)
  .. " --data-urlencode " .. shell_escape("historyInfo=" .. history_info)
  .. " --data-urlencode " .. shell_escape("redirectUser=" .. redirect_user)
  .. " --data-urlencode " .. shell_escape("sipFrom=" .. sip_from)
  .. " --data-urlencode " .. shell_escape("sipTo=" .. sip_to)

local handle = io.popen(cmd)
local resp = ""
if handle then
  resp = handle:read("*a") or ""
  handle:close()
end

local kv = {}
for line in string.gmatch(resp, "[^\\r\\n]+") do
  local k, v = string.match(line, "^([A-Z0-9_]+)=(.*)$")
  if k and v then
    kv[k] = v
  end
end

local greeting_wav = kv["GREETING_WAV"] or ""
local closing_wav = kv["CLOSING_WAV"] or ""
local record_path = kv["RECORD_PATH"] or ""
local owner_phone = kv["OWNER_PHONE"] or "05376031645"
local ai_enabled = kv["AI_ENABLED"] or "0"
local safe_uuid = kv["SAFE_UUID"] or uuid
local live_bridge_uri = kv["LIVE_BRIDGE_URI"] or ""

local function wav_has_speech(path)
  local f = io.open(path, "rb")
  if not f then return false end
  local data = f:read("*a")
  f:close()
  if not data or #data < 3244 then return false end
  local active_frames = 0
  local pos = 45
  local len = #data
  while pos + 319 <= len do
    local sum_sq = 0
    local cnt = 0
    for i = pos, pos + 318, 8 do
      local b1, b2 = string.byte(data, i, i + 1)
      if b1 and b2 then
        local v = b1 + b2 * 256
        if v >= 32768 then v = v - 65536 end
        sum_sq = sum_sq + (v * v)
        cnt = cnt + 1
      end
    end
    if cnt > 0 then
      local rms = math.sqrt(sum_sq / cnt)
      if rms >= 240 then
        active_frames = active_frames + 1
        if active_frames >= 5 then return true end
      end
    end
    pos = pos + 320
  end
  return false
end

local turns_done = 0

if session:ready() then
  -- Kesintisiz pürüzsüz telefon sesi: 200ms jitterbuffer reset kesilmelerini önle, açılış bip/ringback tonlarını kapat
  session:setVariable("rtp_autoflush_during_bridge", "false")
  session:setVariable("bridge_generate_comfort_noise", "false")
  session:setVariable("suppress_cng", "true")
  session:setVariable("ringback", "")
  session:setVariable("transfer_ringback", "")
  session:setVariable("instant_ringback", "false")
  session:setVariable("bridge_early_media", "false")
  session:setVariable("ignore_early_media", "true")
  session:setVariable("playback_terminators", "any")
  session:answer()
  if record_path ~= "" then
    -- Karşılıklı tam görüşme ses kaydı (hem sekreter hem arayan tek dosyada!)
    session:setVariable("RECORD_STEREO", "false")
    session:setVariable("record_sample_rate", "8000")
    session:execute("record_session", record_path)
  end

  if ai_enabled == "1" and live_bridge_uri ~= "" then
    -- Anlık çift yönlü milisaniye canlı ses köprüsü (0 bip, 0 bekleme, 0 kesilme!)
    session:setVariable("hangup_after_bridge", "true")
    session:setVariable("rtp_autoflush_during_bridge", "false")
    session:setVariable("bridge_generate_comfort_noise", "false")
    session:setVariable("ringback", "")
    session:setVariable("transfer_ringback", "")
    session:setVariable("instant_ringback", "false")
    session:setVariable("absolute_codec_string", "PCMA,PCMU")
    session:execute("bridge", live_bridge_uri)
    ai_enabled = "0"
    greeting_wav = ""
  end

  if greeting_wav ~= "" then
    session:sleep(100)
    session:streamFile(greeting_wav)
  end

  if ai_enabled == "1" then
    local silent_streak = 0
    for turn = 1, 12 do
      if not session:ready() then break end
      session:sleep(40)
      local turn_wav = "${recordingsDir}/call_" .. safe_uuid .. "_t" .. tostring(turn) .. ".wav"
      -- Sabırlı ama çok hızlı dinleme:
      -- 1) Konuşmaya başlaman için 4 saniyeye kadar sabırla bekler (4x1 sn -> asla erken "Alo?" diye bölmez!)
      -- 2) Konuştuğun anda 10 sn'ye kadar dinler, sözün bittiği anda SADECE 1 saniyede algılayıp hemen cevap verir!
      for wait_i = 1, 4 do
        if not session:ready() then break end
        session:recordFile(turn_wav, 10, 220, 1)
        if not session:ready() then break end
        if wav_has_speech(turn_wav) then
          break
        end
        if wait_i < 4 then
          os.remove(turn_wav)
        end
      end
      turns_done = turn
      if not session:ready() then break end

      local turn_cmd = "curl -4 -sS --max-time 11 -X POST http://127.0.0.1:3000/api/pbx/fs-ai-turn"
        .. " -H 'Content-Type: application/x-www-form-urlencoded'"
        .. " --data-urlencode " .. shell_escape("uuid=" .. uuid)
        .. " --data-urlencode " .. shell_escape("safeUuid=" .. safe_uuid)
        .. " --data-urlencode " .. shell_escape("turn=" .. tostring(turn))
        .. " --data-urlencode " .. shell_escape("silentStreak=" .. tostring(silent_streak))
        .. " --data-urlencode " .. shell_escape("wavPath=" .. turn_wav)
        .. " --data-urlencode " .. shell_escape("caller=" .. caller)
        .. " --data-urlencode " .. shell_escape("ownerPhone=" .. owner_phone)

      local th = io.popen(turn_cmd)
      local tresp = ""
      if th then
        tresp = th:read("*a") or ""
        th:close()
      end

      local tkv = {}
      for line in string.gmatch(tresp, "[^\\r\\n]+") do
        local k, v = string.match(line, "^([A-Z0-9_]+)=(.*)$")
        if k and v then tkv[k] = v end
      end

      local reply_wav = tkv["REPLY_WAV"] or ""
      local hangup_flag = tkv["HANGUP"] or "0"
      local is_silent = tkv["SILENT"] or "0"

      if is_silent == "1" then
        silent_streak = silent_streak + 1
      else
        silent_streak = 0
      end

      if session:ready() and reply_wav ~= "" then
        session:streamFile(reply_wav)
      end

      if hangup_flag == "1" or silent_streak >= 3 then
        session:sleep(180)
        break
      end
    end
  else
    if session:ready() and record_path ~= "" then
      session:streamFile("tone_stream://%(200,0,880)")
      session:recordFile(record_path, 25, 220, 3)
      turns_done = 1
    end
    if session:ready() and closing_wav ~= "" then
      session:streamFile(closing_wav)
      session:sleep(200)
    end
  end

  if record_path ~= "" and session:ready() then
    session:execute("stop_record_session", record_path)
  end

  if session:ready() then
    session:hangup()
  end
end

local done_cmd = "curl -sS --max-time 8 -G http://127.0.0.1:3000/api/pbx/fs-call-complete"
  .. " --data-urlencode " .. shell_escape("uuid=" .. uuid)
  .. " --data-urlencode " .. shell_escape("safeUuid=" .. safe_uuid)
  .. " --data-urlencode " .. shell_escape("caller=" .. caller)
  .. " --data-urlencode " .. shell_escape("turns=" .. tostring(turns_done))
  .. " --data-urlencode " .. shell_escape("recordPath=" .. record_path)
local h2 = io.popen(done_cmd)
if h2 then h2:close() end
`;
  }

  // Sunucu her başladığında canlı santral dinleme kuralını otomatik tazele ve gömülü 10 hazır insan tepki sesini 0 ms mühürle
  function seedBundledPhonePrompts() {
    try {
      const bundledPhoneDir = path.join(__dirname, 'public', 'assets', 'aistudio', 'phone');
      if (!fs.existsSync(bundledPhoneDir)) return;
      for (const entry of fs.readdirSync(bundledPhoneDir)) {
        const srcPath = path.join(bundledPhoneDir, entry);
        if (entry.endsWith('_8k.wav') && fs.statSync(srcPath).size > 2000) {
          const dstPath = path.join(fsAudioDir, entry);
          fs.copyFileSync(srcPath, dstPath);
          try { fs.chmodSync(dstPath, 0o644); } catch {}
        } else if (entry.endsWith('.mp3') && fs.statSync(srcPath).size > 1500) {
          const baseSlug = entry.replace(/\.mp3$/i, '');
          const dstPath = path.join(fsAudioDir, `${baseSlug}_8k.wav`);
          try {
            execFileSync(
              'ffmpeg',
              ['-y', '-i', srcPath, '-ac', '1', '-ar', '8000', '-af', 'highpass=f=180,lowpass=f=3500,volume=-3dB', '-c:a', 'pcm_s16le', dstPath],
              { timeout: 10000, stdio: 'pipe' }
            );
            fs.chmodSync(dstPath, 0o644);
          } catch {}
        }
      }
    } catch {}
  }

  // Birebir Demo Açılış Sesi (Alt Menü -> Telefon -> Santral Sesini Dinle ses modeliyle %100 aynı!)
  async function ensureDemoGreetingPhoneWav(greetingText: string): Promise<string> {
    const cleanText = String(greetingText || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/["“”«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) return '';
    const normKey = cleanText.toLocaleLowerCase('tr-TR');
    const slug = `demo_greet_${crypto.createHash('sha1').update(normKey).digest('hex').slice(0, 16)}`;
    const outWav8k = path.join(fsAudioDir, `${slug}_8k.wav`);
    if (fs.existsSync(outWav8k) && fs.statSync(outWav8k).size > 2000) {
      return outWav8k;
    }

    // 1. Alt menüdeki kalıcı ses kasasında birebir demo ses kaydı varsa onu pürüzsüz 8kHz telefon sesine çevir
    try {
      const bankClips = seedAndMergeVoiceBank();
      const bankRel = bankClips[normKey];
      if (typeof bankRel === 'string' && bankRel.startsWith('/')) {
        const bankFile = path.join(voiceBankDir, path.basename(bankRel));
        if (fs.existsSync(bankFile) && fs.statSync(bankFile).size > 4000) {
          execFileSync(
            'ffmpeg',
            ['-y', '-i', bankFile, '-ac', '1', '-ar', '8000', '-af', 'highpass=f=180,lowpass=f=3500,volume=-2.5dB', '-c:a', 'pcm_s16le', outWav8k],
            { timeout: 10000, stdio: 'pipe' }
          );
          try { fs.chmodSync(outWav8k, 0o644); } catch {}
          if (fs.existsSync(outWav8k) && fs.statSync(outWav8k).size > 2000) {
            return outWav8k;
          }
        }
      }
    } catch {}

    // 2. Demo kasada henüz olmayan yeni kullanıcı açılışı için Kore sıcak müşteri hizmetleri sesini kullan
    if (process.env.GEMINI_API_KEY) {
      try {
        const pcm24k = await callGeminiTtsDirectIpv4('gemini-3.8-flash-lite-tts', cleanText.slice(0, 380), 'Kore', 6500);
        if (pcm24k.length > 3000) {
          const wav8k = downsamplePcm24kToWav8k(pcm24k);
          fs.writeFileSync(outWav8k, wav8k);
          try { fs.chmodSync(outWav8k, 0o644); } catch {}
          return outWav8k;
        }
      } catch {}
    }

    return ensureFreeSwitchFastPhoneWav(cleanText);
  }

  const transferredCallUuids = new Set<string>();
  const transferInFlightByOwner = new Map<string, number>();
  const liveAudioBridgeSecret =
    process.env.SB_LIVE_BRIDGE_SECRET || crypto.randomBytes(32).toString('hex');

  function signLiveAudioBridgeToken(uuid: string, ownerPhone11: string, ttlMs = 15 * 60 * 1000): string {
    const exp = Date.now() + ttlMs;
    const payload = `${uuid}:${ownerPhone11}:${exp}`;
    const sig = crypto.createHmac('sha256', liveAudioBridgeSecret).update(payload).digest('hex').slice(0, 32);
    return `${exp}.${sig}`;
  }

  function verifyLiveAudioBridgeToken(uuid: string, ownerPhone11: string, token: string): boolean {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 2) return false;
      const exp = Number(parts[0]);
      if (!Number.isFinite(exp) || Date.now() > exp) return false;
      const expected = crypto
        .createHmac('sha256', liveAudioBridgeSecret)
        .update(`${uuid}:${ownerPhone11}:${exp}`)
        .digest('hex')
        .slice(0, 32);
      const provided = parts[1];
      if (provided.length !== expected.length) return false;
      return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
    } catch {
      return false;
    }
  }

  function getFsEslCliArgs(): string[] {
    try {
      const eslXmlPath = '/etc/freeswitch/autoload_configs/event_socket.conf.xml';
      if (fs.existsSync(eslXmlPath)) {
        const eslXml = fs.readFileSync(eslXmlPath, 'utf8');
        const ipM = eslXml.match(/name="listen-ip"\s+value="([^"]+)"/);
        const portM = eslXml.match(/name="listen-port"\s+value="([^"]+)"/);
        const passM = eslXml.match(/name="password"\s+value="([^"]+)"/);
        const ipVal = ipM?.[1] === '::' ? '127.0.0.1' : (ipM?.[1] || '127.0.0.1');
        const portVal = portM?.[1] || '8021';
        const passVal = passM?.[1] || '';
        const args = ['-H', ipVal, '-P', portVal];
        if (passVal) args.push('-p', passVal);
        return args;
      }
    } catch {}
    return [];
  }

  function findActiveExternalSipGatewayName(): string {
    try {
      const extDir = '/etc/freeswitch/sip_profiles/external';
      if (!fs.existsSync(extDir)) return '';
      const entries = fs.readdirSync(extDir).filter((f) => f.endsWith('.xml'));
      for (const entry of entries) {
        const content = fs.readFileSync(path.join(extDir, entry), 'utf8');
        const m = content.match(/<gateway\s+name="([a-zA-Z0-9_.-]{2,64})"/);
        if (m && m[1]) return m[1];
      }
    } catch {}
    return '';
  }

  // Anlık İki Yönlü Canlı Telefon Ses Köprüsü (FreeSWITCH <-> Node SIP/RTP 5090 <-> Gemini Live)
  const pbxLiveBridge = new SantralBayiLiveBridge(5090, (payload) => {
    if (payload.callerPhone && payload.detectedCallerName) {
      saveLearnedCallerToVault(payload.callerPhone, payload.detectedCallerName);
    }
    const wasTransferred =
      transferredCallUuids.has(payload.uuid) || transferredCallUuids.has(payload.safeUuid);
    appendLiveNetgsmCall({
      uuid: payload.uuid,
      safeUuid: payload.safeUuid,
      aiInteractive: true,
      status: wasTransferred ? 'TRANSFERRED_TO_OWNER' : payload.status,
      transcript: payload.transcript,
      turns: payload.turns,
      aiSummary: wasTransferred
        ? `${payload.aiSummary ? `${payload.aiSummary} — ` : ''}Müsaitim onayıyla arama telefonunuza aktarıldı.`
        : payload.aiSummary,
      ...(payload.detectedCallerName ? { detectedCallerName: payload.detectedCallerName } : {}),
      recordingUrl: `/api/pbx/recording/${payload.safeUuid}`,
      lastTurnAt: new Date().toISOString(),
    });

    // Açılır penceredeki canlı konuşma akışını anlık güncelle veya bitince kapat!
    try {
      if (payload.status === 'COMPLETED' || wasTransferred) {
        endActiveLivePbxVoipSession(payload.uuid, payload.safeUuid, payload.aiSummary, payload.transcript);
      } else {
        const activeSession = findActiveVoipByFsId(payload.uuid, payload.safeUuid);
        if (activeSession) {
          activeSession.liveTranscript = payload.transcript;
          activeSession.turns = payload.turns;
          if (payload.aiSummary) activeSession.screeningNote = payload.aiSummary;
          if (payload.detectedCallerName) activeSession.callerName = payload.detectedCallerName;
          broadcastToPhone11(activeSession.targetPhone11, 'call:updated', activeSession);
        }
      }
    } catch {}
  });

  const KORE_PHONE_PROMPTS: Array<[string, string]> = [
    ['k3_probe_1_tr', 'Alo? Beni duyabiliyor musunuz? Buyurun, sizi dinliyorum.'],
    ['k3_probe_2_tr', 'Alo, sesiniz gelmiyor sanırım, hatta mısınız?'],
    ['k3_probe_bye_tr', 'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.'],
    ['k3_retry_soft_tr', 'Kusura bakmayın, sesiniz biraz kesildi, tekrar söyleyebilir misiniz?'],
    ['k3_hello_tr', 'Merhaba, buyurun, sizi çok net duyuyorum. Nasıl yardımcı olabilirim?'],
    ['k3_boss_busy_tr', 'Kendisi şu an müsait değil, notunuzu alıp hemen iletebilirim. Adınızı ve hangi konuda aradığınızı söyleyebilir misiniz?'],
    ['k3_note_saved_tr', 'Anladım, notunuzu aldım ve hemen iletiyorum. Başka yardımcı olabileceğim bir konu var mı?'],
    ['k3_bye_tr', 'Rica ederim, en kısa sürede dönüş yapılacaktır. İyi günler dilerim.'],
    ['k3_ask_name_tr', 'Memnuniyetle not alıyorum. Kimin aradığını söyleyebilir misiniz?'],
    ['k3_listening2_tr', 'Evet, sizi dinliyorum, buyurun.'],
  ];

  const prewarmTtsResults: Record<string, string> = {};

  async function prewarmKorePhonePrompts() {
    if (!process.env.GEMINI_API_KEY) return;
    for (const [slug, text] of KORE_PHONE_PROMPTS) {
      try {
        const target = path.join(fsAudioDir, `${slug}_8k.wav`);
        if (fs.existsSync(target) && fs.statSync(target).size > 2000) {
          prewarmTtsResults[slug] = 'cached';
          continue;
        }
        await ensureFreeSwitchFastPhoneWav(text, slug);
        prewarmTtsResults[slug] = lastPhoneTtsDiag || 'done';
        await new Promise((r) => setTimeout(r, 350));
      } catch (e: any) {
        prewarmTtsResults[slug] = `err:${String(e?.message || e).slice(0, 60)}`;
      }
    }
  }

  try {
    if (fs.existsSync(fsScriptsDir)) {
      const liveLuaPath = path.join(fsScriptsDir, 'santralbayi_inbound.lua');
      fs.writeFileSync(liveLuaPath, buildSantralBayiInboundLua(fsRecordingsDir), { encoding: 'utf8', mode: 0o644 });
    }
    if (!IS_STUDIO_PREVIEW_PROXY) {
      pbxLiveBridge.start();
      seedBundledPhonePrompts();
      void prewarmKorePhonePrompts();
      void (async () => {
        try {
          const reg = readServerPbxRules();
          const adm = reg?.byPhone11?.['05376031645'] || Object.values(reg?.byPhone11 || {})[0];
          const greet =
            String(adm?.incomingGreetingSentence || '').trim() ||
            'Merhaba, Santral Bayi Genel Merkez asistanıyım. Size nasıl yardımcı olabilirim?';
          await ensureLiveVoiceClip8k(greet, 'Kore');
          await ensureLiveVoiceClip8k('Alo? Beni duyabiliyor musunuz, buyurun?', 'Kore');
          await ensureLiveVoiceClip8k('Alo, sesiniz gelmiyor sanırım, hatta mısınız?', 'Kore');
          await ensureLiveVoiceClip8k(
            'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.',
            'Kore'
          );
          await ensureLiveVoiceClip8k(
            'Merhaba, notunuzu ben kaydedeceğim. Buyurun, ne iletmemi istersiniz?',
            'Orus'
          );
          await ensureLiveVoiceClip8k('Alo? Beni duyabiliyor musunuz, buyurun?', 'Orus');
          await ensureLiveVoiceClip8k('Alo, sesiniz gelmiyor sanırım, hatta mısınız?', 'Orus');
          await ensureLiveVoiceClip8k(
            'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.',
            'Orus'
          );
          await ensureLiveVoiceClip8k(
            'Başka yardımcı olabileceğim bir konu var mı?',
            'Kore'
          );
          await ensureFreeSwitchFastPhoneWav(
            'Bir saniye lütfen, hemen bağlıyorum.',
            'transfer_connecting_tr'
          );
        } catch {}
      })();
    }
  } catch {}

  app.get('/api/pbx/live-bridge-test', async (req, res) => {
    try {
      const sampleWav = path.join(fsAudioDir, 'k3_hello_tr_8k.wav');
      const reqMode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
      const liveTest = await testGeminiLiveConnectivity(fs.existsSync(sampleWav) ? sampleWav : undefined, reqMode);
      res.json({
        ok: pbxLiveBridge.isReady() && liveTest.ok,
        mode: 'realtime-live-single-voice',
        bridge: pbxLiveBridge.getStatus(),
        liveTest,
        prewarmTtsResults,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: String(err?.message || err || 'live_bridge_test_failed'),
        bridge: pbxLiveBridge.getStatus(),
      });
    }
  });

  function runSafeCmd(bin: string, args: string[], timeoutMs = 8000): { ok: boolean; out: string } {
    try {
      const out = execFileSync(bin, args, { timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, out: String(out || '').trim() };
    } catch (err: any) {
      const out = `${err?.stdout || ''}\n${err?.stderr || ''}\n${err?.message || ''}`.trim();
      return { ok: false, out };
    }
  }

  app.post('/api/pbx/provision-netgsm-trunk', async (req, res) => {
    try {
      const token = String(req.headers['x-vds-sync-token'] || '');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      if (!token || hash !== VDS_SYNC_DOUBLE_HASH) {
        res.status(403).json({ error: 'Yetkisiz santral kurulum isteği' });
        return;
      }

      const username = String(req.body?.username || '2826060537').replace(/\D/g, '');
      const password = String(req.body?.password || '').trim();
      const sipHost = String(req.body?.sipHost || 'sip.netgsm.com.tr').trim();
      const sipIp = String(req.body?.sipIp || '185.88.7.189').trim();
      const port = String(req.body?.port || '5060').replace(/\D/g, '') || '5060';

      if (!username) {
        res.status(400).json({ error: 'Numara bilgisi gereklidir.' });
        return;
      }

      const fsEtcDir = '/etc/freeswitch';
      const externalDir = path.join(fsEtcDir, 'sip_profiles', 'external');
      const publicDialplanDir = path.join(fsEtcDir, 'dialplan', 'public');
      const aclXmlPath = path.join(fsEtcDir, 'autoload_configs', 'acl.conf.xml');
      const gatewayFilePath = path.join(externalDir, `netgsm_${username}.xml`);
      const dialplanFilePath = path.join(publicDialplanDir, `01_santralbayi_netgsm_${username}.xml`);
      const luaScriptPath = path.join(fsScriptsDir, 'santralbayi_inbound.lua');

      const filesWritten: string[] = [];

      // 1. Optional Gateway XML (only written if user provides registration password from their own screen)
      if (password) {
        fs.mkdirSync(externalDir, { recursive: true });
        const gatewayXml = `<include>
  <gateway name="netgsm_${username}">
    <param name="username" value="${username}"/>
    <param name="auth-username" value="${username}"/>
    <param name="password" value="${password}"/>
    <param name="realm" value="${sipHost}"/>
    <param name="proxy" value="${sipHost}:${port}"/>
    <param name="register" value="true"/>
    <param name="register-transport" value="udp"/>
    <param name="from-user" value="${username}"/>
    <param name="from-domain" value="${sipHost}"/>
    <param name="extension" value="${username}"/>
    <param name="extension-in-contact" value="true"/>
    <param name="caller-id-in-from" value="true"/>
    <param name="expire-seconds" value="120"/>
    <param name="retry-seconds" value="20"/>
    <param name="ping" value="25"/>
    <param name="context" value="public"/>
  </gateway>
</include>
`;
        fs.writeFileSync(gatewayFilePath, gatewayXml, { encoding: 'utf8', mode: 0o644 });
        filesWritten.push(gatewayFilePath);
      }

      // 1b. Disable broken legacy FusionPBX xml-handler in lua.conf.xml so FreeSWITCH reads clean native XML without crash-looping
      const luaConfPath = path.join(fsEtcDir, 'autoload_configs', 'lua.conf.xml');
      if (fs.existsSync(luaConfPath)) {
        const cleanLuaConf = `<configuration name="lua.conf" description="LUA Configuration">
  <settings>
    <param name="script-directory" value="\$\${script_dir}/?.lua"/>
  </settings>
</configuration>
`;
        fs.writeFileSync(luaConfPath, cleanLuaConf, { encoding: 'utf8', mode: 0o644 });
        filesWritten.push(luaConfPath);
      }

      // 1c. Create clean native external SIP profile on 178.208.187.42:5080 (Netgsm SIP Trunk entry point)
      const externalProfileXmlPath = path.join(fsEtcDir, 'sip_profiles', 'external.xml');
      const externalProfileXml = `<profile name="external">
  <aliases/>
  <gateways>
    <X-PRE-PROCESS cmd="include" data="external/*.xml"/>
  </gateways>
  <domains>
    <domain name="all" alias="false" parse="false"/>
  </domains>
  <settings>
    <param name="debug" value="0"/>
    <param name="sip-trace" value="no"/>
    <param name="sip-capture" value="no"/>
    <param name="rfc2833-pt" value="101"/>
    <param name="sip-port" value="5080"/>
    <param name="dialplan" value="XML"/>
    <param name="context" value="public"/>
    <param name="dtmf-duration" value="2000"/>
    <param name="inbound-codec-prefs" value="PCMA,PCMU"/>
    <param name="outbound-codec-prefs" value="PCMA,PCMU"/>
    <param name="hold-music" value="silence_stream://1000"/>
    <param name="rtp-timer-name" value="soft"/>
    <param name="local-network-acl" value="localnet.auto"/>
    <param name="manage-presence" value="false"/>
    <param name="inbound-codec-negotiation" value="generous"/>
    <param name="nonce-ttl" value="60"/>
    <param name="auth-calls" value="false"/>
    <param name="inbound-late-negotiation" value="true"/>
    <param name="rtp-ip" value="178.208.187.42"/>
    <param name="sip-ip" value="178.208.187.42"/>
    <param name="ext-rtp-ip" value="178.208.187.42"/>
    <param name="ext-sip-ip" value="178.208.187.42"/>
    <param name="rtp-timeout-sec" value="300"/>
    <param name="rtp-hold-timeout-sec" value="1800"/>
    <param name="tls" value="false"/>
    <param name="user-agent-string" value="SantralBayi-PBX"/>
  </settings>
</profile>
`;
      fs.writeFileSync(externalProfileXmlPath, externalProfileXml, { encoding: 'utf8', mode: 0o644 });
      filesWritten.push(externalProfileXmlPath);

      // 1d. Create clean native internal SIP profile on 178.208.187.42:5060
      const internalProfileXmlPath = path.join(fsEtcDir, 'sip_profiles', 'internal.xml');
      const internalProfileXml = `<profile name="internal">
  <aliases/>
  <gateways/>
  <domains>
    <domain name="all" alias="true" parse="false"/>
  </domains>
  <settings>
    <param name="debug" value="0"/>
    <param name="sip-trace" value="no"/>
    <param name="rfc2833-pt" value="101"/>
    <param name="sip-port" value="5060"/>
    <param name="dialplan" value="XML"/>
    <param name="context" value="public"/>
    <param name="dtmf-duration" value="2000"/>
    <param name="inbound-codec-prefs" value="PCMA,PCMU"/>
    <param name="outbound-codec-prefs" value="PCMA,PCMU"/>
    <param name="rtp-timer-name" value="soft"/>
    <param name="local-network-acl" value="localnet.auto"/>
    <param name="manage-presence" value="false"/>
    <param name="auth-calls" value="false"/>
    <param name="rtp-ip" value="178.208.187.42"/>
    <param name="sip-ip" value="178.208.187.42"/>
    <param name="ext-rtp-ip" value="178.208.187.42"/>
    <param name="ext-sip-ip" value="178.208.187.42"/>
    <param name="tls" value="false"/>
    <param name="user-agent-string" value="SantralBayi-PBX"/>
  </settings>
</profile>
`;
      fs.writeFileSync(internalProfileXmlPath, internalProfileXml, { encoding: 'utf8', mode: 0o644 });
      filesWritten.push(internalProfileXmlPath);

      // 2. Trust Netgsm IP in acl.conf.xml so direct SIP Trunk calls on 5080 are always accepted
      let aclUpdated = false;
      try {
        if (fs.existsSync(aclXmlPath)) {
          let aclXml = fs.readFileSync(aclXmlPath, 'utf8');
          if (!aclXml.includes(sipIp)) {
            const netgsmNodes = `\n      <node type="allow" cidr="${sipIp}/32"/>\n      <node type="allow" cidr="185.88.7.0/24"/>`;
            if (aclXml.includes('<list name="domains"')) {
              aclXml = aclXml.replace(
                /(<list name="domains"[^>]*>)/,
                `$1${netgsmNodes}`
              );
              fs.writeFileSync(aclXmlPath, aclXml, 'utf8');
              aclUpdated = true;
              filesWritten.push(aclXmlPath);
            }
          }
        }
      } catch {}

      // 3. Lua inbound secretary script (reads Diversion/RDNIS/CallerID -> fetches voice WAV -> greets & listens patiently)
      const luaCode = buildSantralBayiInboundLua(fsRecordingsDir);
      fs.writeFileSync(luaScriptPath, luaCode, { encoding: 'utf8', mode: 0o644 });
      filesWritten.push(luaScriptPath);

      // 4. Public dialplan root + extension matching 2826060537 / 02826060537 / 902826060537
      fs.mkdirSync(publicDialplanDir, { recursive: true });
      const publicRootXmlPath = path.join(fsEtcDir, 'dialplan', 'public.xml');
      const publicRootXml = `<include>
  <context name="public">
    <X-PRE-PROCESS cmd="include" data="public/*.xml"/>
  </context>
</include>
`;
      fs.writeFileSync(publicRootXmlPath, publicRootXml, { encoding: 'utf8', mode: 0o644 });
      filesWritten.push(publicRootXmlPath);

      const dialplanXml = `<include>
  <extension name="santralbayi_netgsm_${username}">
    <condition field="destination_number" expression="^(\\+?90|0)?${username}$">
      <action application="set" data="domain_name=\$\${domain}"/>
      <action application="set" data="hangup_after_bridge=true"/>
      <action application="lua" data="${luaScriptPath}"/>
    </condition>
  </extension>
</include>
`;
      fs.writeFileSync(dialplanFilePath, dialplanXml, { encoding: 'utf8', mode: 0o644 });
      filesWritten.push(dialplanFilePath);

      // 5. Ensure systemd PID path matches FreeSWITCH (-run /run/freeswitch) so service stays Active (running) 24/7
      try {
        const dropInDir = '/etc/systemd/system/freeswitch.service.d';
        fs.mkdirSync(dropInDir, { recursive: true });
        const dropInPath = path.join(dropInDir, '10-santralbayi-pid.conf');
        const dropInConf = `[Service]
PIDFile=/run/freeswitch/freeswitch.pid
ExecStartPre=
ExecStartPre=/bin/mkdir -p /run/freeswitch
ExecStartPre=/bin/chown -R www-data:www-data /var/lib/freeswitch /var/log/freeswitch /etc/freeswitch /usr/share/freeswitch /run/freeswitch
ExecStart=
ExecStart=/usr/bin/freeswitch -u www-data -g www-data -ncwait -nonat -run /run/freeswitch
`;
        fs.writeFileSync(dropInPath, dropInConf, { encoding: 'utf8', mode: 0o644 });
        filesWritten.push(dropInPath);
        runSafeCmd('systemctl', ['daemon-reload'], 10000);
      } catch {}

      // Restart FreeSWITCH cleanly so it loads native lua.conf.xml + external.xml (5080) + public.xml
      runSafeCmd('systemctl', ['restart', 'freeswitch'], 25000);
      await new Promise((r) => setTimeout(r, 2500));

      let eslArgs: string[] = [];
      try {
        const eslXmlPath = path.join(fsEtcDir, 'autoload_configs', 'event_socket.conf.xml');
        if (fs.existsSync(eslXmlPath)) {
          const eslXml = fs.readFileSync(eslXmlPath, 'utf8');
          const ipM = eslXml.match(/name="listen-ip"\s+value="([^"]+)"/);
          const portM = eslXml.match(/name="listen-port"\s+value="([^"]+)"/);
          const passM = eslXml.match(/name="password"\s+value="([^"]+)"/);
          const ipVal = ipM?.[1] === '::' ? '127.0.0.1' : (ipM?.[1] || '127.0.0.1');
          const portVal = portM?.[1] || '8021';
          const passVal = passM?.[1] || '';
          eslArgs = ['-H', ipVal, '-P', portVal];
          if (passVal) eslArgs.push('-p', passVal);
        }
      } catch {}

      const fsCmd = (xCmd: string) => runSafeCmd('fs_cli', [...eslArgs, '-x', xCmd]);
      const fsServiceStatus = runSafeCmd('systemctl', ['is-active', 'freeswitch']);
      const loadLua = fsCmd('load mod_lua');
      const reloadAcl = fsCmd('reloadacl');
      const reloadXml = fsCmd('reloadxml');
      const rescanExt = fsCmd('sofia profile external rescan');

      // Check real listening UDP/TCP SIP ports
      const ssPorts = runSafeCmd('ss', ['-ulpn']);
      const listeningSipLines = ssPorts.out
        .split('\n')
        .filter((l) => /:5060\b|:5080\b/.test(l))
        .join(' | ');

      // 6. Pre-warm Admin cloned greeting WAV + Closing WAV so first call answers instantly
      const registry = readServerPbxRules();
      const adminRule = registry?.byPhone11?.['05376031645'] || Object.values(registry?.byPhone11 || {})[0];
      const defaultGreeting =
        String(adminRule?.incomingGreetingSentence || '').trim() ||
        'Merhaba, Santral Bayi Genel Merkez asistanıyım. Size nasıl yardımcı olabilirim?';
      const defaultClosing =
        'Teşekkür ederiz, notunuzu kaydettim ve hemen yetkiliye iletiyorum. İyi günler dilerim.';

      const [warmGreetingWav, warmClosingWav] = await Promise.all([
        ensureFreeSwitchClonedWav(defaultGreeting),
        ensureFreeSwitchClonedWav(defaultClosing, 'closing_note_tr'),
      ]);

      await new Promise((r) => setTimeout(r, 1000));
      const sofiaSummary = fsCmd('sofia status');
      const extStatus = fsCmd('sofia status profile external');
      const ffmpegCheck = runSafeCmd('ffmpeg', ['-version']);

      res.json({
        ok: true,
        username,
        sipHost,
        sipIp,
        aclUpdated,
        filesWritten,
        fsServiceActive: fsServiceStatus.out,
        listeningSipLines,
        warmGreetingWav,
        warmClosingWav,
        ffmpegAvailable: ffmpegCheck.ok,
        loadLua: loadLua.out.slice(0, 160),
        reloadAcl: reloadAcl.out.slice(0, 160),
        reloadXml: reloadXml.out.slice(0, 160),
        rescanExt: rescanExt.out.slice(0, 160),
        sofiaSummary: sofiaSummary.out.slice(0, 700),
        externalProfilePort: (extStatus.out.match(/SIP-Port\s+(\d+)/) || [])[1] || 'unknown',
        externalProfileState: (extStatus.out.match(/State\s+(\S+)/) || [])[1] || 'unknown',
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Netgsm santral kurulum hatası' });
    }
  });

  app.get('/api/pbx/fs-inbound-resolve', async (req, res) => {
    try {
      const uuid = String(req.query.uuid || `fs-${Date.now()}`).trim();
      const rawCaller = String(req.query.caller || '').trim();
      const rawCallerName = String(req.query.callerName || '').trim();
      const rawDest = String(req.query.dest || '2826060537').trim();
      const rawRdnis = String(req.query.rdnis || '').trim();
      const rawDiversion = String(req.query.diversion || '').trim();
      const rawHistoryInfo = String(req.query.historyInfo || '').trim();
      const rawRedirectUser = String(req.query.redirectUser || '').trim();
      const rawSipFrom = String(req.query.sipFrom || '').trim();
      const rawSipTo = String(req.query.sipTo || '').trim();

      const callerPhone11 = normalizePhone11(rawCaller) || rawCaller || 'Gizli Numara';
      const forwardedOwner11 =
        extractTrPhoneFromHeader(rawDiversion) ||
        extractTrPhoneFromHeader(rawHistoryInfo) ||
        extractTrPhoneFromHeader(rawRdnis) ||
        extractTrPhoneFromHeader(rawRedirectUser) ||
        '';

      const registry = readServerPbxRules();
      const targetOwner11 =
        (forwardedOwner11 && registry?.byPhone11?.[forwardedOwner11] ? forwardedOwner11 : '') ||
        forwardedOwner11 ||
        '05376031645';

      // Aktarma sırasında hat sahibi açmazsa merkez numaranın kendi içine döngüye girmesini önle
      const centralGw11 = normalizePhone11(String(registry?.centralGatewayPhone11 || '02826060537'));
      const recentTransferAt = transferInFlightByOwner.get(targetOwner11) || 0;
      if (centralGw11 && callerPhone11 === centralGw11 && Date.now() - recentTransferAt < 35000) {
        res.type('text/plain').send('GREETING_WAV=\nCLOSING_WAV=\nRECORD_PATH=\nOWNER_PHONE=\nAI_ENABLED=0\nSAFE_UUID=\nLIVE_BRIDGE_URI=\n');
        return;
      }

      const matchedRule =
        registry?.byPhone11?.[targetOwner11] ||
        registry?.byPhone11?.['05376031645'] ||
        Object.values(registry?.byPhone11 || {})[0] ||
        null;

      const greetingText =
        String(matchedRule?.incomingGreetingSentence || '').trim() ||
        'Merhaba, Santral Bayi Genel Merkez asistanıyım. Size nasıl yardımcı olabilirim?';
      const closingText =
        'Teşekkür ederiz, notunuzu kaydettim ve hemen yetkiliye iletiyorum. İyi günler dilerim.';

      const aiIsReady = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
      const useLiveBridge = Boolean(aiIsReady && pbxLiveBridge.isReady());

      // Canlı ses köprüsü açıkken açılışı da aynı canlı ses okuduğu için 0 ms bekleme!
      const greetingWav = useLiveBridge ? '' : await ensureDemoGreetingPhoneWav(greetingText);

      // Yapay zeka modunda kapanış kaydı kullanılmadığı için çağrı açılışını asla bekletme
      const cachedClosingWav = path.join(fsAudioDir, 'closing_note_tr_8k.wav');
      const closingWav = aiIsReady
        ? fs.existsSync(cachedClosingWav)
          ? cachedClosingWav
          : ''
        : await ensureFreeSwitchFastPhoneWav(closingText, 'closing_note_tr');

      const safeUuid = uuid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || String(Date.now());
      const recordPath = path.join(fsRecordingsDir, `call_${safeUuid}.wav`);
      const callerProfile = await lookupServerCallerProfile(callerPhone11, targetOwner11).catch(() => null);
      const initialRecognizedName = callerProfile?.recognizedName || '';

      const companyName = matchedRule?.companyName || 'Santral Bayi Genel Merkez';
      const personHonorific = matchedRule?.personHonorific || 'Kenan Bey';
      const workHours =
        matchedRule?.workingHoursStart && matchedRule?.workingHoursEnd
          ? `${matchedRule.workingHoursStart} - ${matchedRule.workingHoursEnd}`
          : '09:00 - 19:00';
      const isCompanyContactEntry = (rawEntry: string): boolean => {
        const cleaned = String(rawEntry || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return false;
        const low = cleaned.toLocaleLowerCase('tr-TR');
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (words.length >= 4) return true;
        if (/\d{3,}/.test(low)) return true;
        const companyKeywords =
          /\b(ltd|şti|sti|a\.?ş\.?|san\.?|tic\.?|grup|group|holding|otomotiv|oto|inşaat|insaat|yapı|yapi|mimarlık|mimarlik|mühendislik|muhendislik|elektrik|elektronik|tesisat|tamir|servis|bakım|bakim|nakliyat|lojistik|kargo|turizm|seyahat|otel|emlak|gayrimenkul|sigorta|banka|bankası|bankasi|muhasebe|mali\s+müşavir|hukuk|avukatlık|eczane|klinik|hastane|poliklinik|diş|optik|kuaför|kuafor|berber|güzellik|market|süpermarket|bakkal|fırın|firin|pastane|restoran|lokanta|kafe|cafe|kebap|pizza|kasap|manav|tekstil|giyim|ayakkabı|mobilya|dekorasyon|perde|halı|hali|cam|alüminyum|aluminyum|pvc|demir|çelik|celik|metal|plastik|ambalaj|matbaa|reklam|ajans|medya|bilişim|bilisim|yazılım|yazilim|teknoloji|iletişim|iletisim|telekom|santral|bayi|bayii|şube|sube|merkez|ofis|büro|buro|atölye|atolye|fabrika|depo|mağaza|magaza|dükkan|dukkan|ticaret|sanayi|pazarlama|danışmanlık|danismanlik|eğitim|egitim|kurs|okul|kreş|akademi|spor|petrol|akaryakıt|enerji|gıda|gida|tarım|tarim|hayvancılık|veteriner|çiçek|kırtasiye|kitap|züccaciye|hırdavat|hirdavat|nalbur|boya|yedek\s+parça|parça|lastik|yıkama|yikama|kuru\s+temizleme|terzi|çilingir|taksi|rent\s+a\s+car|kiralama|güvenlik|temizlik|yemek|catering|organizasyon|düğün|fotoğraf|kuyumcu|sarraf|döviz|dernek|vakıf|belediye|müdürlük|kurumsal|park|işyeri|isyeri)\b/i;
        return companyKeywords.test(low);
      };

      const isOwnerSelfCall = Boolean(callerPhone11 && targetOwner11 && callerPhone11 === targetOwner11);
      const isCompanyEntry = !isOwnerSelfCall && Boolean(initialRecognizedName && isCompanyContactEntry(initialRecognizedName));
      const callerKind: 'person' | 'company' | 'unknown' = isOwnerSelfCall
        ? 'person'
        : isCompanyEntry
        ? 'company'
        : initialRecognizedName
        ? 'person'
        : 'unknown';

      const verifiedFirstName =
        callerKind === 'person' && initialRecognizedName ? initialRecognizedName.split(/\s+/)[0] : '';

      const usageTarget: 'company' | 'individual' | 'hybrid' =
        matchedRule?.usageTarget === 'individual' || matchedRule?.usageTarget === 'hybrid'
          ? matchedRule.usageTarget
          : 'company';
      const assistantRoleSpoken = String(matchedRule?.assistantRoleSpoken || 'asistanıyım').trim();
      const targetAuthorityLabel =
        usageTarget === 'company' ? `${companyName} yetkilimiz` : personHonorific;

      // MÜHÜRLÜ AÇILIŞ KURALI: Başlangıçta arayan kişi/firma adı KULLANILMAZ; herkese doğrudan temiz kurumsal açılış yapılır!
      const personalizedGreetingText = greetingText;

      const callerIdentityBlock = isOwnerSelfCall
        ? `Arayan kişi rehberde/sistemde kayıtlı ${personHonorific} (${initialRecognizedName || personHonorific}). Kendisine saygılı ve ölçülü şekilde sadece "${personHonorific}" diye hitap et (ASLA "beyciğim" deme!), adını tekrar sorma.`
        : callerKind === 'company'
        ? `Arayan numara rehberde kişi ismiyle DEĞİL, FİRMA/İŞLETME adıyla kayıtlı: "${initialRecognizedName}". Bu bir firma adıdır; ASLA "${initialRecognizedName} Bey/Hanım" deme! Duruma göre "${initialRecognizedName}'den arıyorsunuz, kiminle görüşüyorum acaba?" diyerek arayan kişinin adını nazikçe öğren ve sonrasında onun adıyla saygılı hitap et.`
        : callerKind === 'person'
        ? `Arayan kişi rehberde/hafızada kayıtlı: "${initialRecognizedName}" (${callerProfile?.callerTypeLabel || 'Kayıtlı'}). Saygılı ve ölçülü şekilde ismiyle ("${verifiedFirstName} Bey/Hanım" gibi, ASLA "beyciğim/hanımcığım" demeden) hitap et ve ASLA adını tekrar sorma.`
        : `Arayan kişi henüz rehberde kayıtlı değil (Numara: ${callerPhone11 || 'Bilinmiyor'}). Arayan adını söylemeden asla isim uydurma; ileride tekrar aradığında ismiyle hitap edebilmek için uygun anda adını sor.`;

      let liveBridgeUri = '';
      if (useLiveBridge) {
        pbxLiveBridge.registerPendingCall({
          uuid,
          safeUuid,
          ownerPhone: targetOwner11,
          callerPhone: callerPhone11,
          companyName,
          personHonorific,
          workHours,
          callerIdentityBlock,
          greetingText,
          personalizedGreetingText,
          greetingWav8kPath: '',
          usageTarget,
          assistantRoleSpoken,
          targetAuthorityLabel,
          verifiedCallerName: callerKind === 'person' ? (initialRecognizedName || (isOwnerSelfCall ? personHonorific : undefined)) : undefined,
          callerKind,
          callerCompanyName: callerKind === 'company' ? initialRecognizedName : undefined,
          callerTypeLabel:
            callerKind === 'company'
              ? `Rehberde Firma Kaydı (${initialRecognizedName})`
              : callerProfile?.callerTypeLabel || (isOwnerSelfCall ? 'Genel Merkez Yetkilisi' : 'İlk Kez Arayan Müşteri'),
          isOwnerSelfCall,
        });
        liveBridgeUri = `sofia/external/sip:live_${safeUuid}@127.0.0.1:5090`;
      }

      appendLiveNetgsmCall({
        uuid,
        safeUuid,
        status: 'ANSWERED_BY_SECRETARY',
        callerPhone11,
        rawCaller,
        rawCallerName,
        rawDest,
        forwardedOwner11,
        targetOwner11,
        ownerCompany: companyName,
        detectedCallerName: initialRecognizedName,
        callerTypeLabel: callerProfile?.callerTypeLabel || '',
        greetingText,
        greetingWav,
        recordPath,
        recordingUrl: `/api/pbx/recording/${safeUuid}`,
        aiInteractive: aiIsReady,
        transcript: [{ speaker: 'AI', text: greetingText }],
        aiSummary: aiIsReady
          ? 'Canlı yapay zeka sekreter görüşmesi devam ediyor...'
          : 'Sekreter karşılama yaptı ve arayanın sesli notunu kaydetti.',
        rawHeaders: {
          rdnis: rawRdnis,
          diversion: rawDiversion,
          historyInfo: rawHistoryInfo,
          redirectUser: rawRedirectUser,
          sipFrom: rawSipFrom,
          sipTo: rawSipTo,
        },
        timestamp: new Date().toISOString(),
      });

      // Notify live Santral Bayi app screen simultaneously
      try {
        triggerInternalVoipRing({
          callId: uuid,
          fsUuid: uuid,
          safeUuid,
          callerPhone: callerPhone11,
          callerName: initialRecognizedName || rawCallerName || callerPhone11,
          targetPhone: targetOwner11,
          mode: 'PBX_BRIDGE',
          spokenGreeting: greetingText,
          screeningNote: 'Sekreter arayanla canlı görüşüyor...',
          liveTranscript: [{ speaker: 'AI', text: greetingText }],
          callerIssueSummary: forwardedOwner11
            ? `Yönlendirilen Hat: ${forwardedOwner11}`
            : '0282 606 05 37 Canlı Gelen Arama',
        });
      } catch {}

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(
        [
          `GREETING_WAV=${greetingWav}`,
          `CLOSING_WAV=${closingWav}`,
          `RECORD_PATH=${recordPath}`,
          `OWNER_PHONE=${targetOwner11}`,
          `SAFE_UUID=${safeUuid}`,
          `AI_ENABLED=${aiIsReady ? '1' : '0'}`,
          `DIVERSION_DETECTED=${forwardedOwner11 ? '1' : '0'}`,
          `LIVE_BRIDGE_URI=${liveBridgeUri}`,
        ].join('\n')
      );
    } catch (err: any) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(500).send(`ERROR=${err?.message || 'resolve_error'}`);
    }
  });

  // Seçenek A: Canlı Telefon Görüşmesi İçin Hafif & Ekonomik Karşılıklı Yapay Zeka Tur Motoru
  app.post('/api/pbx/fs-ai-turn', express.urlencoded({ extended: false }), async (req, res) => {
    const wavPath = String(req.body?.wavPath || '').trim();
    const cleanupTurnWav = () => {
      try {
        if (wavPath && /_t\d+\.wav$/i.test(wavPath) && fs.existsSync(wavPath)) {
          fs.unlinkSync(wavPath);
        }
      } catch {}
    };

    try {
      const uuid = String(req.body?.uuid || '').trim();
      const safeUuid =
        String(req.body?.safeUuid || '')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 48) || uuid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
      const turnNum = Math.max(1, Number(req.body?.turn || 1));
      const silentStreak = Math.max(0, Number(req.body?.silentStreak || 0));
      const caller = String(req.body?.caller || '').trim();
      const ownerPhone = normalizePhone11(String(req.body?.ownerPhone || '05376031645')) || '05376031645';

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');

      const QUICK_REPLY_PRESETS: Record<string, { slug: string; text: string }> = {
        hello: {
          slug: 'k3_hello_tr',
          text: 'Merhaba, buyurun, sizi çok net duyuyorum. Nasıl yardımcı olabilirim?',
        },
        boss_busy: {
          slug: 'k3_boss_busy_tr',
          text: 'Kendisi şu an müsait değil, notunuzu alıp hemen iletebilirim. Adınızı ve hangi konuda aradığınızı söyleyebilir misiniz?',
        },
        note_saved: {
          slug: 'k3_note_saved_tr',
          text: 'Anladım, notunuzu aldım ve hemen iletiyorum. Başka yardımcı olabileceğim bir konu var mı?',
        },
        bye: {
          slug: 'k3_bye_tr',
          text: 'Rica ederim, en kısa sürede dönüş yapılacaktır. İyi günler dilerim.',
        },
        ask_name: {
          slug: 'k3_ask_name_tr',
          text: 'Memnuniyetle not alıyorum. Kimin aradığını söyleyebilir misiniz?',
        },
        listening: {
          slug: 'k3_listening2_tr',
          text: 'Evet, sizi dinliyorum, buyurun.',
        },
      };

      const logSilentProbeToCall = (probeText: string, hangupNow: boolean) => {
        if (!uuid || uuid === 'chk' || uuid === 'probe-check') return;
        try {
          const cur = readLiveNetgsmCalls().find((c: any) => c?.uuid === uuid);
          const prev = Array.isArray(cur?.transcript) ? cur.transcript : [];
          appendLiveNetgsmCall({
            uuid,
            safeUuid,
            aiInteractive: true,
            status: hangupNow ? 'COMPLETED' : 'ANSWERED_BY_SECRETARY',
            transcript: [...prev, { speaker: 'AI', text: probeText }],
            turns: turnNum,
            lastTurnAt: new Date().toISOString(),
          });
        } catch {}
      };

      const buildHumanSilentProbe = async () => {
        if (silentStreak === 0) {
          const txt = 'Alo? Beni duyabiliyor musunuz? Buyurun, sizi dinliyorum.';
          const w = await ensureFreeSwitchFastPhoneWav(txt, 'k3_probe_1_tr');
          logSilentProbeToCall(txt, false);
          return { wav: w, hangup: '0' };
        }
        if (silentStreak === 1) {
          const txt = 'Alo, sesiniz gelmiyor sanırım, hatta mısınız?';
          const w = await ensureFreeSwitchFastPhoneWav(txt, 'k3_probe_2_tr');
          logSilentProbeToCall(txt, false);
          return { wav: w, hangup: '0' };
        }
        const txt = 'Sesinizi alamadım, müsait olduğunuzda tekrar arayabilirsiniz. İyi günler dilerim.';
        const w = await ensureFreeSwitchFastPhoneWav(txt, 'k3_probe_bye_tr');
        logSilentProbeToCall(txt, true);
        return { wav: w, hangup: '1' };
      };

      if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.trim()) {
        cleanupTurnWav();
        const fallbackText = 'Notunuzu kaydettim, yetkilimize hemen iletiyorum. İyi günler dilerim.';
        const replyWav = await ensureFreeSwitchFastPhoneWav(fallbackText, 'k3_note_saved_tr');
        res.send(`REPLY_WAV=${replyWav}\nHANGUP=1\nSILENT=0\n`);
        return;
      }

      const wavExists = wavPath && fs.existsSync(wavPath);
      const wavBytes = wavExists ? fs.statSync(wavPath).size : 0;

      // Çok kısa/boş kayıt (< 3200 byte ≈ < 0.2s): 0 ms hazır insan sesiyle anında yokla!
      if (!wavExists || wavBytes < 3200) {
        cleanupTurnWav();
        const probe = await buildHumanSilentProbe();
        res.send(`REPLY_WAV=${probe.wav}\nHANGUP=${probe.hangup}\nSILENT=1\n#TTS=${lastPhoneTtsDiag}\n`);
        return;
      }

      // Gerçek insan sesi süzgeci & baştaki/sondaki sessizliği kırpma (< 2 ms)
      const rawWavBuf = fs.readFileSync(wavPath);
      cleanupTurnWav();
      const dataMarkerIdx = rawWavBuf.subarray(0, Math.min(rawWavBuf.length, 512)).indexOf(Buffer.from('data'));
      const pcmStartOffset =
        dataMarkerIdx >= 12 && dataMarkerIdx + 8 < rawWavBuf.length
          ? dataMarkerIdx + 8
          : rawWavBuf.length > 44
          ? 44
          : 0;
      const pcmData = rawWavBuf.subarray(pcmStartOffset);
      const frameBytes = 320; // 20 ms @ 8kHz 16-bit mono
      const totalFrames = Math.floor(pcmData.length / frameBytes);
      let firstActiveFrame = -1;
      let lastActiveFrame = -1;
      let activeFrameCount = 0;
      let maxFrameRms = 0;

      for (let f = 0; f < totalFrames; f++) {
        let sumSq = 0;
        const baseOff = f * frameBytes;
        for (let b = 0; b < frameBytes; b += 2) {
          const sample = pcmData.readInt16LE(baseOff + b);
          sumSq += sample * sample;
        }
        const rms = Math.sqrt(sumSq / (frameBytes / 2));
        if (rms > maxFrameRms) maxFrameRms = rms;
        if (rms >= 230) {
          activeFrameCount++;
          if (firstActiveFrame === -1) firstActiveFrame = f;
          lastActiveFrame = f;
        }
      }

      // 100 ms'den az ses varsa (sadece sessizlik/hışırtı) 0 ms'de insan gibi "Alo, beni duyuyor musunuz?" de
      if (activeFrameCount < 5 || firstActiveFrame === -1) {
        const probe = await buildHumanSilentProbe();
        res.send(`REPLY_WAV=${probe.wav}\nHANGUP=${probe.hangup}\nSILENT=1\n#TTS=${lastPhoneTtsDiag}\n`);
        return;
      }

      // Sadece konuşma kısmını kırp ve alçak telefon sesini netleştir (< 2 ms)
      const padFrames = 8; // 160 ms
      const sliceStartFrame = Math.max(0, firstActiveFrame - padFrames);
      const sliceEndFrame = Math.min(totalFrames, lastActiveFrame + 1 + padFrames);
      const rawTrimmedPcm = pcmData.subarray(sliceStartFrame * frameBytes, sliceEndFrame * frameBytes);
      let peakAbs = 0;
      for (let i = 0; i + 1 < rawTrimmedPcm.length; i += 2) {
        const v = Math.abs(rawTrimmedPcm.readInt16LE(i));
        if (v > peakAbs) peakAbs = v;
      }
      let trimmedPcm = rawTrimmedPcm;
      if (peakAbs >= 220 && peakAbs < 12000) {
        const gain = Math.min(5.0, 14500 / peakAbs);
        const boosted = Buffer.allocUnsafe(rawTrimmedPcm.length);
        for (let i = 0; i + 1 < rawTrimmedPcm.length; i += 2) {
          const scaled = Math.round(rawTrimmedPcm.readInt16LE(i) * gain);
          boosted.writeInt16LE(Math.max(-32767, Math.min(32767, scaled)), i);
        }
        trimmedPcm = boosted;
      }

      const trimmedWavHeader = Buffer.alloc(44);
      trimmedWavHeader.write('RIFF', 0);
      trimmedWavHeader.writeUInt32LE(36 + trimmedPcm.length, 4);
      trimmedWavHeader.write('WAVE', 8);
      trimmedWavHeader.write('fmt ', 12);
      trimmedWavHeader.writeUInt32LE(16, 16);
      trimmedWavHeader.writeUInt16LE(1, 20);
      trimmedWavHeader.writeUInt16LE(1, 22);
      trimmedWavHeader.writeUInt32LE(8000, 24);
      trimmedWavHeader.writeUInt32LE(16000, 28);
      trimmedWavHeader.writeUInt16LE(2, 32);
      trimmedWavHeader.writeUInt16LE(16, 34);
      trimmedWavHeader.write('data', 36);
      trimmedWavHeader.writeUInt32LE(trimmedPcm.length, 40);
      const wavBase64 = Buffer.concat([trimmedWavHeader, trimmedPcm]).toString('base64');

      const registry = readServerPbxRules();
      const rule =
        registry?.byPhone11?.[ownerPhone] ||
        registry?.byPhone11?.['05376031645'] ||
        Object.values(registry?.byPhone11 || {})[0] ||
        null;

      const existingCall = readLiveNetgsmCalls().find((c: any) => c?.uuid === uuid);
      const prevTranscript: Array<{ speaker: 'AI' | 'CALLER'; text: string }> = Array.isArray(
        existingCall?.transcript
      )
        ? existingCall.transcript
        : [];
      const historyText = prevTranscript
        .slice(-6)
        .map((t) => `${t.speaker === 'AI' ? 'Asistan' : 'Arayan'}: ${t.text}`)
        .join('\n');

      const companyName = rule?.companyName || 'Santral Bayi Genel Merkez';
      const personHonorific = rule?.personHonorific || 'Kenan Bey';
      const workHours =
        rule?.workingHoursStart && rule?.workingHoursEnd
          ? `${rule.workingHoursStart} - ${rule.workingHoursEnd}`
          : '09:00 - 19:00';

      let verifiedCallerName = String(existingCall?.detectedCallerName || '').trim();
      let verifiedCallerType = String(existingCall?.callerTypeLabel || '').trim();
      if (!verifiedCallerName && turnNum === 1) {
        const callerProfile = await Promise.race([
          lookupServerCallerProfile(caller, ownerPhone).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
        ]);
        if (callerProfile?.recognizedName) {
          verifiedCallerName = callerProfile.recognizedName;
          verifiedCallerType = callerProfile.callerTypeLabel || '';
        }
      }
      const verifiedFirstName = verifiedCallerName ? verifiedCallerName.split(/\s+/)[0] : '';
      const callerIdentityBlock = verifiedCallerName
        ? `Arayan kişi rehberde kayıtlı: "${verifiedCallerName}" (${verifiedCallerType || 'Kayıtlı'}). Samimi ve saygılı şekilde "${verifiedFirstName} Bey/Hanım" diye hitap et.`
        : `Arayan kişi kayıtlı değil (Numara: ${caller || 'Bilinmiyor'}). Arayan adını söylemeden asla isim uydurma.`;

      const systemPrompt = `Sen "${companyName}" hattını açan gerçek, güler yüzlü, enerjik ve dikkatli bir Türk telefon sekreterisin.
Yetkili kişi: ${personHonorific}. Çalışma saatleri: ${workHours}.
${callerIdentityBlock}

KESİN KURALLAR:
1. SADECE ses kaydında gerçekten duyduğun Türkçe sözleri callerTranscript alanına yaz. Konuşma yoksa callerTranscript="" bırak.
2. KESİNLİKLE YASAK: "Bağlıyorum", "aktarıyorum", "bir saniye bekleyin", "hatta kalın" ASLA DEME! Çünkü bu hatta canlı aktarma yok; sen not alan, dinleyen ve bilgiyi yetkiliye ileten gerçek sekretersin.
3. Arayan kişi ${personHonorific} ile görüşmek isterse mutlaka müsait olmadığını söyleyip adını ve hangi konuda aradığını sor (quickReplyId="boss_busy").
4. MİLİSANİYE HIZLI TEPKİ (quickReplyId): Cevabın şu durumlara uyuyorsa quickReplyId alanına tam kodunu yaz (0 ms hazır ses çalar!), özel bir cevap gerekiyorsa "" bırak ve arayanın söylediğine birebir mantıklı, kısa ve sıcak karşılık ver:
   - "hello": Arayan sadece "Alo / Merhaba / İyi günler / Sesim geliyor mu" dedi.
   - "boss_busy": Arayan yetkiliyle (${personHonorific}) görüşmek istedi.
   - "note_saved": Arayan mesajını/notunu bıraktı ve iletmeni istiyor.
   - "ask_name": Arayan konu anlattı ama adını henüz bilmiyorsun.
   - "listening": Arayan "bir saniye / bir şey soracaktım" dedi.
   - "bye": Arayan vedalaştı ("teşekkürler", "iyi günler", "tamam sağ olun", "görüşürüz", "kapatıyorum") -> shouldHangup=true yap.
5. secretaryReply en fazla 1-2 sade günlük Türkçe cümle olsun; arayanın söylediğine gerçekten dinlediğini hissettiren doğrudan cevap ver.
6. Arayan randevu günü/saati söylerse appointmentBooked alanına yaz, yoksa "".
7. Arayan adını söylerse callerName alanına yaz, yoksa "".
8. aiSummary alanına görüşmeyi 1 kısa cümlede özetle.

SON KONUŞMA:
${historyText || '(Az önce karşılama yapıldı)'}`;

      const cleanOptionalAiField = (val: unknown): string => {
        const s = String(val ?? '').trim();
        if (!s) return '';
        const low = s.toLocaleLowerCase('tr-TR');
        if (
          low === 'null' ||
          low === 'undefined' ||
          low === 'none' ||
          low === 'yok' ||
          low === 'belirtilmedi' ||
          low === 'bilinmiyor' ||
          low === '-' ||
          low === 'n/a'
        ) {
          return '';
        }
        return s;
      };

      const turnStartedAt = Date.now();
      const contentsPayload = {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: wavBase64,
            },
          },
          {
            text: 'Arayanın sesindeki Türkçe sözleri yaz ve canlı bir insan sekreter gibi anlık cevabını JSON döndür.',
          },
        ],
      };
      const baseSchema = {
        type: Type.OBJECT,
        properties: {
          callerTranscript: { type: Type.STRING },
          quickReplyId: { type: Type.STRING },
          secretaryReply: { type: Type.STRING },
          shouldHangup: { type: Type.BOOLEAN },
          aiSummary: { type: Type.STRING },
          appointmentBooked: { type: Type.STRING },
          callerName: { type: Type.STRING },
        },
        required: ['callerTranscript', 'secretaryReply', 'shouldHangup', 'aiSummary'],
      };

      // Ultra hızlı & ekonomik insan konuşması: iki hızlı model paralel yarışır, ilk dönen anında kazanır!
      let aiTextOut = '';
      let usedModel = '';
      let fastErr = '';
      const geminiStart = Date.now();
      const raceModels: Array<{ model: string; timeoutMs: number }> = [
        { model: 'gemini-3.1-flash-lite', timeoutMs: 7500 },
        { model: 'gemini-4-hydrogen', timeoutMs: 7500 },
      ];
      try {
        const winner = await Promise.any(
          raceModels.map(async (candidate) => {
            const text = await callGeminiTurnDirectIpv4(
              candidate.model,
              systemPrompt,
              wavBase64,
              candidate.timeoutMs
            );
            if (!text || !text.trim()) {
              throw new Error(`${candidate.model}:empty`);
            }
            return { model: candidate.model, text };
          })
        );
        aiTextOut = winner.text;
        usedModel = winner.model;
      } catch (aggErr: any) {
        const innerErrs = Array.isArray(aggErr?.errors) ? aggErr.errors : [aggErr];
        fastErr = innerErrs.map((e: any) => String(e?.message || e || '').slice(0, 80)).join(' | ');
        throw new Error(fastErr || 'all_models_failed');
      }
      const geminiMs = Date.now() - geminiStart;

      let parsed: any = {};
      try {
        parsed = JSON.parse(String(aiTextOut || '{}').trim());
      } catch {
        parsed = {};
      }

      const callerTranscript = cleanOptionalAiField(parsed.callerTranscript);
      const isSilent = !callerTranscript;
      if (isSilent) {
        const probe = await buildHumanSilentProbe();
        res.send(`REPLY_WAV=${probe.wav}\nHANGUP=${probe.hangup}\nSILENT=1\n#TTS=${lastPhoneTtsDiag}\n`);
        return;
      }

      let quickId = cleanOptionalAiField(parsed.quickReplyId).toLowerCase();
      let rawAiReply = cleanOptionalAiField(parsed.secretaryReply);

      // Güvenlik kilidi: "bağlıyorum / aktarıyorum / bekleteceğim / hatta kalın" gibi yanıltıcı ifade asla söylenmez
      if (/bağlıyorum|aktarıyorum|bekleteceğim|bekleyin|hatta kalın/i.test(rawAiReply)) {
        quickId = 'boss_busy';
        rawAiReply = QUICK_REPLY_PRESETS.boss_busy.text;
      }

      const matchedPreset = QUICK_REPLY_PRESETS[quickId] || null;
      const usePresetInstant = Boolean(matchedPreset && (!rawAiReply || quickId === 'boss_busy' || quickId === 'hello' || quickId === 'bye' || quickId === 'listening'));

      const secretaryReply =
        (usePresetInstant && matchedPreset ? matchedPreset.text : rawAiReply) ||
        matchedPreset?.text ||
        `Anladım, notunuzu alıp ${personHonorific}'e hemen iletiyorum. Başka eklemek istediğiniz bir şey var mı?`;
      const shouldHangup = Boolean(parsed.shouldHangup) || quickId === 'bye' || turnNum >= 12;
      const aiSummary =
        cleanOptionalAiField(parsed.aiSummary) ||
        `Arayan talebi: ${callerTranscript}`;
      const appointmentBooked =
        cleanOptionalAiField(parsed.appointmentBooked) || cleanOptionalAiField(existingCall?.appointmentBooked);
      const detectedCallerName =
        verifiedCallerName ||
        cleanOptionalAiField(parsed.callerName) ||
        cleanOptionalAiField(existingCall?.detectedCallerName);

      const updatedTranscript = [...prevTranscript];
      updatedTranscript.push({ speaker: 'CALLER', text: callerTranscript });
      updatedTranscript.push({ speaker: 'AI', text: secretaryReply });

      const ttsStart = Date.now();
      let replyWav = '';
      if (usePresetInstant && matchedPreset) {
        replyWav = await ensureFreeSwitchFastPhoneWav(matchedPreset.text, matchedPreset.slug);
      }
      if (!replyWav) {
        replyWav = await ensureFreeSwitchFastPhoneWav(secretaryReply);
      }
      if (!replyWav) {
        const fallbackSlug = shouldHangup ? 'k3_bye_tr' : 'k3_note_saved_tr';
        replyWav = await ensureFreeSwitchFastPhoneWav(secretaryReply, fallbackSlug);
      }
      const ttsMs = Date.now() - ttsStart;
      const turnLatencyMs = Date.now() - turnStartedAt;

      appendLiveNetgsmCall({
        uuid,
        safeUuid,
        aiInteractive: true,
        status: shouldHangup ? 'COMPLETED' : 'ANSWERED_BY_SECRETARY',
        transcript: updatedTranscript,
        aiSummary,
        appointmentBooked,
        detectedCallerName,
        turns: turnNum,
        turnLatencyMs,
        turnDiag: {
          usedModel,
          quickId,
          fastErr,
          geminiMs,
          ttsMs,
          ttsDiag: lastPhoneTtsDiag,
          activeFrameCount,
          trimmedBytes: trimmedPcm.length,
          maxFrameRms: Math.round(maxFrameRms),
        },
        recordingUrl: `/api/pbx/recording/${safeUuid}`,
        lastTurnAt: new Date().toISOString(),
      });

      res.send(
        [
          `REPLY_WAV=${replyWav}`,
          `HANGUP=${shouldHangup ? '1' : '0'}`,
          `SILENT=0`,
          `#MODEL=${usedModel}`,
          `#GEMINI_MS=${geminiMs}`,
          `#TTS_MS=${ttsMs}`,
          `#TTS=${lastPhoneTtsDiag}`,
          `#REPLY=${secretaryReply.replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
        ].join('\n') + '\n'
      );
    } catch (err: any) {
      cleanupTurnWav();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const retryWav = await ensureFreeSwitchFastPhoneWav(
        'Kusura bakmayın, sesiniz biraz kesildi, tekrar söyleyebilir misiniz?',
        'k3_retry_soft_tr'
      );
      const errBrief = String(err?.message || err || '').replace(/[\r\n]+/g, ' ').slice(0, 180);
      res.send(`REPLY_WAV=${retryWav}\nHANGUP=0\nSILENT=1\n#ERR=${errBrief}\n`);
    }
  });

  app.get('/api/pbx/recording/:uuid', (req, res) => {
    try {
      const safeUuid = String(req.params.uuid || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64);
      if (!safeUuid) {
        res.status(400).json({ error: 'Geçersiz kayıt kodu' });
        return;
      }

      const reqOwnerPhone11 = normalizePhone11(String(req.query?.ownerPhone || ''));
      const matchedCall = readLiveNetgsmCalls().find(
        (c: any) => String(c?.safeUuid || '') === safeUuid || String(c?.uuid || '') === safeUuid
      );
      if (matchedCall) {
        const callOwner11 = normalizePhone11(
          String(matchedCall.targetOwner11 || matchedCall.forwardedOwner11 || '')
        );
        if (callOwner11 && (!reqOwnerPhone11 || reqOwnerPhone11 !== callOwner11)) {
          res.status(403).json({ error: 'Bu ses kaydına yalnızca ilgili hat sahibi erişebilir.' });
          return;
        }
      }

      const candidates = [
        path.join(fsRecordingsDir, `call_${safeUuid}.wav`),
        path.join(fsRecordingsDir, `call_${safeUuid}_t1.wav`),
      ];
      const filePath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 200);
      if (!filePath) {
        res.status(404).json({ error: 'Ses kaydı bulunamadı' });
        return;
      }

      const stat = fs.statSync(filePath);
      const total = stat.size;
      const range = req.headers.range;
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': chunkSize,
          'Content-Type': 'audio/wav',
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }

      res.setHeader('Content-Length', total);
      fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ses kaydı okunamadı' });
    }
  });

  app.get('/api/pbx/fs-call-complete', (req, res) => {
    const uuid = String(req.query.uuid || '').trim();
    const safeUuid =
      String(req.query.safeUuid || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 48) || uuid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    const turns = Math.max(0, Number(req.query.turns || 0));
    const recordPath = String(req.query.recordPath || path.join(fsRecordingsDir, `call_${safeUuid}.wav`)).trim();

    // Merge multi-turn caller recordings into single playable call_<safeUuid>.wav
    try {
      if (safeUuid && turns >= 1) {
        const turnFiles: string[] = [];
        for (let i = 1; i <= Math.min(turns, 10); i++) {
          const tf = path.join(fsRecordingsDir, `call_${safeUuid}_t${i}.wav`);
          if (fs.existsSync(tf) && fs.statSync(tf).size > 2000) {
            turnFiles.push(tf);
          }
        }
        const mergedOut = path.join(fsRecordingsDir, `call_${safeUuid}.wav`);
        if (turnFiles.length === 1 && !fs.existsSync(mergedOut)) {
          fs.copyFileSync(turnFiles[0], mergedOut);
        } else if (turnFiles.length > 1) {
          const listPath = path.join(fsRecordingsDir, `concat_${safeUuid}.txt`);
          fs.writeFileSync(
            listPath,
            turnFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'),
            'utf8'
          );
          try {
            execFileSync(
              'ffmpeg',
              ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', mergedOut],
              { timeout: 12000, stdio: 'pipe' }
            );
          } catch {}
          try {
            fs.unlinkSync(listPath);
          } catch {}
        }
      }
    } catch {}

    let recBytes = 0;
    try {
      const mergedPath = safeUuid ? path.join(fsRecordingsDir, `call_${safeUuid}.wav`) : recordPath;
      if (mergedPath && fs.existsSync(mergedPath)) {
        recBytes = fs.statSync(mergedPath).size;
      } else if (recordPath && fs.existsSync(recordPath)) {
        recBytes = fs.statSync(recordPath).size;
      }
    } catch {}

    const existing = readLiveNetgsmCalls().find((c: any) => c?.uuid === uuid);
    const createdAtMs = Number(existing?.createdAt || Date.now());
    const durationSec = Math.max(1, Math.round((Date.now() - createdAtMs) / 1000));

    if (uuid) {
      appendLiveNetgsmCall({
        uuid,
        safeUuid,
        status: 'COMPLETED',
        recordingBytes: recBytes,
        recordingUrl: recBytes > 500 && safeUuid ? `/api/pbx/recording/${safeUuid}` : existing?.recordingUrl || '',
        durationSec,
        completedAt: new Date().toISOString(),
      });
      try {
        endActiveLivePbxVoipSession(
          uuid,
          safeUuid,
          existing?.aiSummary || 'Görüşme tamamlandı ve kayıt listeye eklendi.'
        );
      } catch {}
    }
    res.json({ ok: true, uuid, recordingBytes: recBytes, durationSec });
  });

  app.get('/api/pbx/live-calls', (req, res) => {
    const reqOwnerPhone11 = normalizePhone11(String(req.query?.ownerPhone || ''));
    // Katı Gizlilik Kilidi: Hat sahibi numarası gönderilmeden hiçbir arama kaydı dışarı verilmez!
    const rawCalls = reqOwnerPhone11
      ? readLiveNetgsmCalls().filter((c: any) => {
          if (!c || !c.uuid) return false;
          if (String(c.uuid).startsWith('fs-') && !c?.rawHeaders?.sipFrom) return false;
          const callOwner11 = normalizePhone11(String(c.targetOwner11 || c.forwardedOwner11 || ''));
          return Boolean(callOwner11 && callOwner11 === reqOwnerPhone11);
        })
      : [];
    const nowCheck = Date.now();
    const enrichedCalls = rawCalls.map((c: any) => {
      const safeUuid =
        String(c.safeUuid || '')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 48) || String(c.uuid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
      const callOwner11 = normalizePhone11(String(c.targetOwner11 || c.forwardedOwner11 || reqOwnerPhone11));
      const knownBytes = Number(c.recordingBytes || 0);
      let hasWav = knownBytes > 500;
      let recBytes = knownBytes;
      if (!hasWav && safeUuid) {
        const cached = cachedRecMetaByUuid.get(safeUuid);
        if (cached && (cached.hasWav || nowCheck - cached.checkedAt < 12000)) {
          hasWav = cached.hasWav;
          recBytes = cached.recBytes;
        } else {
          const wavFile = path.join(fsRecordingsDir, `call_${safeUuid}.wav`);
          const wavTurn1 = path.join(fsRecordingsDir, `call_${safeUuid}_t1.wav`);
          try {
            if (fs.existsSync(wavFile)) {
              const sz = fs.statSync(wavFile).size;
              recBytes = sz;
              hasWav = sz > 500;
            } else if (fs.existsSync(wavTurn1)) {
              const sz = fs.statSync(wavTurn1).size;
              recBytes = sz;
              hasWav = sz > 500;
            }
          } catch {}
          cachedRecMetaByUuid.set(safeUuid, { hasWav, recBytes, checkedAt: nowCheck });
          if (cachedRecMetaByUuid.size > 400) cachedRecMetaByUuid.clear();
        }
      }
      const computedDuration =
        Number(c.durationSec || 0) ||
        (c.completedAt && c.createdAt
          ? Math.max(1, Math.round((new Date(c.completedAt).getTime() - Number(c.createdAt)) / 1000))
          : recBytes > 1000
          ? Math.max(2, Math.round(recBytes / 16000))
          : 5);
      const sanitizeNullish = (v: unknown) => {
        const s = String(v ?? '').trim();
        const low = s.toLocaleLowerCase('tr-TR');
        if (!s || low === 'null' || low === 'undefined' || low === 'none' || low === 'yok' || low === '-') {
          return '';
        }
        return s;
      };
      const isLiveInBridge =
        String(c.status || '').toUpperCase() === 'ANSWERED_BY_SECRETARY' &&
        (pbxLiveBridge.isCallLiveByUuid(String(c.uuid || '')) ||
          pbxLiveBridge.isCallLiveByUuid(safeUuid));
      return {
        ...c,
        ownerPhone: callOwner11,
        safeUuid,
        isLiveAudioBridgeReady: isLiveInBridge,
        bridgeToken: isLiveInBridge ? signLiveAudioBridgeToken(String(c.uuid || safeUuid), callOwner11) : '',
        appointmentBooked: sanitizeNullish(c.appointmentBooked),
        detectedCallerName: sanitizeNullish(c.detectedCallerName),
        recordingBytes: recBytes,
        recordingUrl: hasWav
          ? `/api/pbx/recording/${safeUuid}?ownerPhone=${encodeURIComponent(callOwner11)}`
          : '',
        durationSec: computedDuration,
      };
    });

    refreshFsStatusAsync();
    res.json({
      ok: true,
      ownerPhone: reqOwnerPhone11,
      aiReady: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      fsServiceActive: cachedFsServiceActive,
      listeningSipLines: cachedListeningSipLines,
      calls: enrichedCalls,
    });
  });

  // =========================================================================
  // MÜSAİTİM, ARAYANI BANA AKTAR (SIFIR KONTÖR İNTERNET CANLI SES KÖPRÜSÜ)
  // =========================================================================
  app.post('/api/pbx/transfer-to-owner', async (req, res) => {
    try {
      const rawUuid = String(req.body?.uuid || '').trim();
      const ownerPhone11 = normalizePhone11(String(req.body?.ownerPhone || ''));
      const reqCallerPhone11 = normalizePhone11(String(req.body?.callerPhone || ''));

      if (!/^0[23458]\d{9}$/.test(ownerPhone11)) {
        res.status(400).json({ ok: false, error: 'Geçerli hat sahibi numarası gereklidir.' });
        return;
      }

      const callsList = readLiveNetgsmCalls();
      const matchedCall = callsList.find((c: any) => {
        if (!c) return false;
        const matchId =
          rawUuid && (String(c.uuid || '') === rawUuid || String(c.safeUuid || '') === rawUuid);
        if (rawUuid) return Boolean(matchId);
        const cOwner = normalizePhone11(String(c.targetOwner11 || c.forwardedOwner11 || ''));
        return cOwner === ownerPhone11 && c.status === 'ANSWERED_BY_SECRETARY';
      });

      if (!matchedCall) {
        res.json({
          ok: true,
          mode: 'CALL_ENDED_CALLBACK',
          callerPhone11: reqCallerPhone11,
          ownerPhone11,
          message: 'Görüşme kaydı tamamlanmış, arayan numara hemen geri aranabilir.',
        });
        return;
      }

      // Katı Sahiplik Kontrolü: Başkasının çağrısına müdahale/aktarma kesinlikle engellenir
      const callOwner11 = normalizePhone11(
        String(matchedCall.targetOwner11 || matchedCall.forwardedOwner11 || '')
      );
      if (callOwner11 && callOwner11 !== ownerPhone11) {
        res.status(403).json({ ok: false, error: 'Bu çağrı üzerinde aktarma yetkiniz yok.' });
        return;
      }

      const realUuid = String(matchedCall.uuid || '').trim();
      const safeUuid = String(matchedCall.safeUuid || realUuid).trim();
      const callerPhone11 = normalizePhone11(
        String(matchedCall.callerPhone11 || matchedCall.rawCaller || reqCallerPhone11 || '')
      );
      const callerName = String(matchedCall.detectedCallerName || '').trim();

      if (
        /^[a-zA-Z0-9_-]{6,64}$/.test(realUuid) &&
        (pbxLiveBridge.isCallLiveByUuid(realUuid) || pbxLiveBridge.isCallLiveByUuid(safeUuid))
      ) {
        const bridgeToken = signLiveAudioBridgeToken(realUuid, ownerPhone11);
        res.json({
          ok: true,
          mode: 'INTERNET_BRIDGE_READY',
          uuid: realUuid,
          safeUuid,
          callerPhone11,
          callerName: callerName || callerPhone11,
          ownerPhone11,
          bridgeToken,
          wsPath: `/ws/live-call?uuid=${encodeURIComponent(realUuid)}&ownerPhone=${encodeURIComponent(ownerPhone11)}&token=${encodeURIComponent(bridgeToken)}`,
          message: 'Sıfır kontör canlı ses bağlantısı hazır, arayan size bağlanıyor...',
        });
        return;
      }

      res.json({
        ok: true,
        mode: 'CALL_ENDED_CALLBACK',
        uuid: realUuid,
        callerPhone11,
        callerName: callerName || callerPhone11,
        ownerPhone11,
        message: 'Sekreter görüşmesi az önce tamamlandı, arayan hemen geri aranıyor...',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Arama aktarımı başlatılamadı.' });
    }
  });

  app.delete('/api/pbx/live-calls/:uuid', (req, res) => {
    try {
      const targetUuid = String(req.params.uuid || '').trim();
      const reqOwnerPhone11 = normalizePhone11(String(req.query?.ownerPhone || ''));
      if (!targetUuid) {
        res.status(400).json({ error: 'Kayıt kodu eksik' });
        return;
      }
      const list = readLiveNetgsmCalls();
      const filtered = list.filter((c: any) => {
        const isTarget = c?.uuid === targetUuid || c?.safeUuid === targetUuid;
        if (!isTarget) return true;
        const callOwner11 = normalizePhone11(String(c?.targetOwner11 || c?.forwardedOwner11 || ''));
        // Başka bir panel başka birinin çağrısını asla silemez
        if (callOwner11 && (!reqOwnerPhone11 || reqOwnerPhone11 !== callOwner11)) {
          return true;
        }
        return false;
      });
      cachedLiveNetgsmCalls = filtered;
      cachedRecMetaByUuid.delete(targetUuid);
      flushLiveNetgsmCallsAsync(filtered);
      res.json({ ok: true, remaining: filtered.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Kayıt silinemedi' });
    }
  });

  app.post('/api/voip/webrtc-signal', (req, res) => {
    const { callId, fromPhone, toPhone, signalType, data } = req.body || {};
    const toPhone11 = normalizePhone11(String(toPhone || ''));
    const fromPhone11 = normalizePhone11(String(fromPhone || ''));
    if (!callId || !toPhone11 || !signalType) {
      res.status(400).json({ error: 'Eksik WebRTC sinyal verisi' });
      return;
    }
    const delivered = broadcastToPhone11(toPhone11, 'webrtc:signal', {
      callId: String(callId),
      fromPhone11,
      toPhone11,
      signalType: String(signalType),
      data,
    });
    res.json({ ok: true, delivered });
  });

  app.post('/api/gemini/generate', async (req, res) => {
    try {
      const { prompt, systemInstruction, responseMimeType } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Missing prompt' });
        return;
      }

      const ai = getAiClient();
      const config: Record<string, unknown> = {
        thinkingConfig: thinkingLevelConfig(),
      };
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }
      if (responseMimeType) {
        config.responseMimeType = responseMimeType;
      }

      const response: GenerateContentResponse = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config,
      });

      res.json({ text: response.text ?? '' });
    } catch (error: any) {
      console.error('Gemini API error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to generate content from Gemini API',
      });
    }
  });

  interface RecognizedCallerProfile {
    callerPhone11: string;
    isKnownCaller: boolean;
    recognizedName: string;
    callerTypeLabel: string;
    previousCallCount: number;
    lastCallTimestamp: string;
    lastCallSummary: string;
    activeAppointments: string[];
    isExcludedDirectContact: boolean;
    memoryPromptSummary: string;
  }

  async function lookupServerCallerProfile(
    rawCallerPhone: string,
    rawTargetPhone?: string
  ): Promise<RecognizedCallerProfile> {
    const callerPhone11 = normalizePhone11(rawCallerPhone);
    const callerTail10 = callerPhone11.slice(-10);
    const targetPhone11 = rawTargetPhone ? normalizePhone11(rawTargetPhone) : '';

    let recognizedName = '';
    let callerTypeLabel = 'İlk Kez Arayan Müşteri';
    let previousCallCount = 0;
    let lastCallTimestamp = '';
    let lastCallSummary = '';
    const activeAppointments: string[] = [];
    let isExcludedDirectContact = false;

    try {
      const vault = readMasterVault();
      const dealersArr = Array.isArray(vault.sections['dealers'])
        ? (vault.sections['dealers'] as any[])
        : [];
      const subsArr = Array.isArray(vault.sections['subscribers'])
        ? (vault.sections['subscribers'] as any[])
        : [];
      const logsArr = Array.isArray(vault.sections['callLogs'])
        ? (vault.sections['callLogs'] as any[])
        : [];
      const aptsArr = Array.isArray(vault.sections['appointments'])
        ? (vault.sections['appointments'] as any[])
        : [];
      const setupProfilesMap =
        vault.sections['setupProfiles'] && typeof vault.sections['setupProfiles'] === 'object'
          ? (vault.sections['setupProfiles'] as Record<string, any>)
          : {};
      const deviceContactsArr = Array.isArray(vault.sections['deviceContacts'])
        ? (vault.sections['deviceContacts'] as any[])
        : [];
      const learnedCallersArr = Array.isArray(vault.sections['learnedCallers'])
        ? (vault.sections['learnedCallers'] as any[])
        : [];

      if (callerTail10.length === 10) {
        // 1. Önce telefon rehberinde kayıtlı kişi var mı bak (gerçek telefon rehberi!)
        const matchedContact = deviceContactsArr.find(
          (ct) => ct && String(ct.phone || '').replace(/\D/g, '').slice(-10) === callerTail10 && String(ct.name || '').trim()
        );
        if (matchedContact) {
          recognizedName = String(matchedContact.name || '').trim();
          callerTypeLabel = 'Telefon Rehberinde Kayıtlı Kişi';
        }

        // 1b. Daha önceki görüşmede sekreterin öğrenip hafızasına kaydettiği kişi var mı bak
        if (!recognizedName) {
          const matchedLearned = learnedCallersArr.find(
            (lc) => lc && String(lc.phone || '').replace(/\D/g, '').slice(-10) === callerTail10 && String(lc.name || '').trim()
          );
          if (matchedLearned) {
            recognizedName = String(matchedLearned.name || '').trim();
            callerTypeLabel = 'Asistan Hafızasında Kayıtlı Kişi';
          }
        }

        // 2. Kurulum profillerinde kayıtlı hat sahibi / yönetici / bayi var mı bak
        if (!recognizedName) {
          for (const [pKey, prof] of Object.entries(setupProfilesMap)) {
            if (!prof || typeof prof !== 'object') continue;
            const profTail = String(prof.customerPhone || '').replace(/\D/g, '').slice(-10);
            const extraMatch =
              Array.isArray(prof.extraPhones) &&
              prof.extraPhones.some(
                (ep: any) => String(ep?.phone || ep || '').replace(/\D/g, '').slice(-10) === callerTail10
              );
            if (profTail === callerTail10 || extraMatch) {
              const foundName = String(prof.fullName || prof.customerName || '').trim();
              if (foundName) {
                recognizedName = foundName;
                callerTypeLabel =
                  pKey === 'admin'
                    ? `Genel Merkez Yetkilisi (${prof.customerName || 'Santral Bayi'})`
                    : `Sistemde Kayıtlı Kullanıcı (${prof.customerName || pKey})`;
                break;
              }
            }
          }
        }

        const matchedDealer = dealersArr.find(
          (d) =>
            d &&
            !String(d.id || '').startsWith('vacant-') &&
            String(d.contactPhone || d.phone || '').replace(/\D/g, '').slice(-10) === callerTail10
        );
        if (matchedDealer && !recognizedName) {
          recognizedName = String(matchedDealer.contactName || matchedDealer.name || '').trim();
          callerTypeLabel = `Sistemde Kayıtlı Bayi (${matchedDealer.name || matchedDealer.dealerCode || ''})`;
        }

        const matchedSub = subsArr.find(
          (s) =>
            s &&
            String(s.contactPhone || s.phone || '').replace(/\D/g, '').slice(-10) === callerTail10
        );
        if (matchedSub && !recognizedName) {
          recognizedName = String(matchedSub.fullName || matchedSub.name || '').trim();
          callerTypeLabel = `Sistemde Kayıtlı Esnaf Abone (${matchedSub.companyName || matchedSub.name || ''})`;
        }

        const callerLogs = logsArr.filter(
          (c) =>
            c &&
            String(c.callerPhone || '').replace(/\D/g, '').slice(-10) === callerTail10
        );
        previousCallCount = callerLogs.length;
        if (callerLogs.length > 0) {
          const latest = callerLogs[0];
          const logCallerName = String(latest.callerName || '').trim();
          const lowLogName = logCallerName.toLocaleLowerCase('tr-TR');
          if (
            logCallerName &&
            !lowLogName.includes('simüle') &&
            !lowLogName.includes('arayan müşteri') &&
            lowLogName !== 'ahmet yılmaz' &&
            lowLogName !== 'ayşe kaya' &&
            lowLogName !== 'ahmet demir' &&
            !recognizedName
          ) {
            recognizedName = logCallerName;
          }
          if (callerTypeLabel === 'İlk Kez Arayan Müşteri') {
            callerTypeLabel = 'Daha Önce Arayan Tanıdık Müşteri';
          }
          lastCallTimestamp = String(latest.timestamp || '');
          lastCallSummary = String(latest.extractedNotes || latest.aiSummary || '').trim();
        }

        for (const apt of aptsArr) {
          if (!apt) continue;
          const aptTail10 = String(apt.phone || '').replace(/\D/g, '').slice(-10);
          if (aptTail10 === callerTail10) {
            const cust = String(apt.customer || '')
              .replace(/\(.*?\)/g, '')
              .trim();
            if (cust && !cust.toLowerCase().includes('arayan müşteri') && !recognizedName) {
              recognizedName = cust;
            }
            if (callerTypeLabel === 'İlk Kez Arayan Müşteri') {
              callerTypeLabel = 'Randevulu / Kayıtlı Müşteri';
            }
            const desc = `${apt.time || ''} - ${apt.service || 'Randevu'} (${apt.status || 'Kayıtlı'})`.trim();
            if (desc && activeAppointments.length < 3) {
              activeAppointments.push(desc);
            }
          }
        }
      }

      if (targetPhone11) {
        const registry = readServerPbxRules();
        const targetRule = registry?.byPhone11?.[targetPhone11];
        if (targetRule && Array.isArray(targetRule.excludedContacts)) {
          isExcludedDirectContact = targetRule.excludedContacts.some((entry: string) => {
            const tail = String(entry || '').replace(/\D/g, '').slice(-10);
            return tail.length === 10 && tail === callerTail10;
          });
        }
      }
    } catch {}

    // Merkez port 8000 arayan dizini açıksa oradan da kontrol et (600 ms hızlı zaman aşımı)
    if (!recognizedName && callerPhone11.length >= 10) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 600);
        const r8000 = await fetch(`http://127.0.0.1:8000/check-caller/${encodeURIComponent(callerPhone11)}`, {
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (r8000.ok) {
          const j8000 = (await r8000.json()) as Record<string, unknown>;
          if (j8000?.kayitli && typeof j8000.ad_soyad === 'string' && j8000.ad_soyad.trim()) {
            recognizedName = j8000.ad_soyad.trim();
            callerTypeLabel = `Kayıtlı Kişi (${String(j8000.firma_adi || '')})`;
          }
        }
      } catch {}
    }

    const isKnownCaller = Boolean(
      recognizedName || previousCallCount > 0 || activeAppointments.length > 0 || isExcludedDirectContact
    );

    const summaryLines: string[] = [];
    summaryLines.push(`Arayan Numara: ${callerPhone11 || 'Bilinmiyor'}`);
    summaryLines.push(`Tanınma Durumu: ${isKnownCaller ? callerTypeLabel : 'İlk Kez Arayan Yeni Kişi'}`);
    if (recognizedName) {
      summaryLines.push(`Kayıtlı Adı: ${recognizedName} (Kendisine doğal şekilde ismiyle Bey/Hanım diyerek hitap et!)`);
    } else {
      summaryLines.push(`Kayıtlı Adı Yok: Gerekirse nazikçe ismini öğrenebilirsin.`);
    }
    if (previousCallCount > 0) {
      summaryLines.push(
        `Geçmiş Arama Sayısı: ${previousCallCount}${lastCallTimestamp ? ` (Son arama: ${lastCallTimestamp})` : ''}`
      );
    }
    if (lastCallSummary) {
      summaryLines.push(`Son Görüşme Notu / Konusu: ${lastCallSummary}`);
    }
    if (activeAppointments.length > 0) {
      summaryLines.push(`Kayıtlı Randevu / Siparişleri: ${activeAppointments.join(' | ')}`);
    }

    return {
      callerPhone11,
      isKnownCaller,
      recognizedName,
      callerTypeLabel,
      previousCallCount,
      lastCallTimestamp,
      lastCallSummary,
      activeAppointments,
      isExcludedDirectContact,
      memoryPromptSummary: summaryLines.join('\n'),
    };
  }

  app.get('/api/pbx/caller-profile', async (req, res) => {
    try {
      const callerPhone = String(req.query.callerPhone || '');
      const subscriberPhone = String(req.query.subscriberPhone || '');
      const profile = await lookupServerCallerProfile(callerPhone, subscriberPhone);
      res.json({ ok: true, profile });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Arayan bilgisi okunamadı' });
    }
  });

  app.post('/api/pbx/ai-reception', async (req, res) => {
    try {
      const {
        subscriberPhone,
        diversionPhone,
        callerPhone,
        callerName,
        callerSpeechText,
        conversationHistory,
        knowledgeBaseOverride,
        businessAddressOverride,
        autoRingOwner = true,
      } = req.body || {};

      const targetPhone11 = normalizePhone11(
        String(diversionPhone || subscriberPhone || '05376031645')
      );
      const callerPhone11 =
        normalizePhone11(String(callerPhone || '05325551234')) || '05325551234';
      const spokenInput = String(callerSpeechText || '').trim();

      if (!spokenInput) {
        res.status(400).json({ error: 'Arayan müşterinin konuşma metni boş olamaz.' });
        return;
      }

      const registry = readServerPbxRules();
      const rule = registry?.byPhone11?.[targetPhone11] || null;
      const honorific = rule?.personHonorific || 'Kenan Bey';
      const companyName = rule?.companyName || 'Santral Bayi İşletmesi';
      const assistantRole = rule?.assistantRoleSpoken || 'asistanıyım';
      const greeting =
        rule?.incomingGreetingSentence ||
        `Merhaba, ${companyName} hattına hoş geldiniz! Ben ${honorific}'in ${assistantRole}. Size nasıl yardımcı olabilirim?`;

      const callerProfile = await lookupServerCallerProfile(callerPhone11, targetPhone11);
      const effectiveCallerName =
        String(callerName || '').trim() || callerProfile.recognizedName || '';

      const trainedKnowledge =
        String(knowledgeBaseOverride || rule?.aiKnowledgeBase || '').trim() ||
        'Müşterinin talebini dikkatle dinle, yardımcı ol, net bilgi veremediğin özel konularda yetkiliye bağlamayı veya not almayı teklif et.';
      const businessAddress = String(businessAddressOverride || rule?.businessAddress || '').trim();
      const workHoursDesc = rule?.is24Hours
        ? '7 gün 24 saat kesintisiz açık'
        : `Hafta içi: ${rule?.workHoursWeekdays || '09:00 - 18:00'}, Cumartesi: ${rule?.workHoursSaturday || '09:00 - 14:00'}, Pazar: ${rule?.workHoursSunday || 'Kapalı'}`;

      const historyLines = Array.isArray(conversationHistory)
        ? conversationHistory
            .slice(-8)
            .map((turn: any) =>
              `${turn?.speaker === 'AI' ? 'Sekreter' : 'Arayan'}: ${String(turn?.text || '').trim()}`
            )
            .filter(Boolean)
            .join('\n')
        : '';

      const usageTargetRule = rule?.usageTarget || 'individual';
      const identityPolicyLine =
        usageTargetRule === 'company'
          ? `Karşılama Kuralı: Arayanı SADECE "${companyName}" kurumsal firma adıyla karşıla; arayan özellikle sormadıkça şahıs ismi (${honorific}) söylemeden kurumsal asistan olarak konuş.`
          : usageTargetRule === 'hybrid'
          ? `Karşılama Kuralı: Hem "${companyName}" firma adını hem de "${honorific}" yetkili adını birlikte kullanarak prestijli karşıla.`
          : `Karşılama Kuralı: Arayanı doğrudan "${honorific}" adına (${assistantRole}) karşıla.`;

      const systemInstruction = [
        `Sen "${companyName}" işletmesinin gerçek insan doğallığında konuşan yapay zekâ telefon sekreterisin.`,
        `Bağlı olduğun yetkili: ${honorific} (Sen kendisinin ${assistantRole}).`,
        identityPolicyLine,
        ``,
        `=== İŞLETME SAHİBİNİN SANA ÖĞRETTİĞİ BİLGİLER & KURALLAR ===`,
        trainedKnowledge,
        businessAddress ? `İşletme Adresi: ${businessAddress}` : '',
        `Çalışma Saatleri: ${workHoursDesc}`,
        `Randevu / Sipariş Alma Yetkisi: ${rule?.appointmentEnabled !== false ? 'AÇIK (Tarih ve saat netleştirip kaydedebilirsin)' : 'KAPALI (Sadece not alıp yetkiliye iletebilirsin)'}`,
        `Fiyat Bilgisi Verme Yetkisi: ${rule?.priceQuotingEnabled !== false ? 'AÇIK (Sana öğretilen fiyat bilgisini paylaşabilirsin)' : 'KAPALI (Telefonda fiyat vermeyip yetkiliye yönlendir)'}`,
        `İndirim / Pazarlık Yetkisi: ${rule?.negotiationEnabled ? `AÇIK (En fazla %${rule?.discountLimit ?? 10} indirim yapabilirsin)` : 'KAPALI (Fiyatlar sabittir)'}`,
        `Ön Görüşmeli Aktarma Yetkisi: ${rule?.warmTransferEnabled !== false ? 'AÇIK' : 'KAPALI'}`,
        ``,
        `=== ŞU AN HATTAKİ ARAYAN KİŞİNİN KİMLİK & GEÇMİŞ HAFIZA KARTI ===`,
        callerProfile.memoryPromptSummary,
        ``,
        `=== KESİN KONUŞMA KURALLARI (SIFIR HAZIR KALIP!) ===`,
        `1. KESİNLİKLE ezbere/kalıp/robotik cümleler kullanma! Arayanın tam olarak ne dediğine, derdine ve geçmiş hafıza kartına göre doğal, sıcak ve kısa İstanbul Türkçesiyle (en fazla 2 cümle) cevap ver.`,
        `2. Eğer arayan kişi hafıza kartında tanınıyorsa (ismi kayıtlıysa, önceki araması veya randevusu varsa), konuşmanın akışına göre ismini kullanarak tanıdığını hissettir ve geçmiş konusunu/randevusunu dikkate al.`,
        `3. Arayan doğrudan ${honorific} ile görüşmek istiyorsa veya acil servis/usta müdahalesi gerekiyorsa shouldTransferToOwner = true yap; secretaryReply içinde onu hatta kısa süre bekletip hemen ${honorific}'e haber verdiğini doğal bir dille söyle.`,
        `4. Randevu veya sipariş netleşirse extractedAppointment alanına gün/saat ve konuyu net yaz (ör: "Yarın 15:00 - Kombi Bakımı").`,
        `5. Asla 0850 numaradan veya yapay zekâ olduğundan bahsetme; gerçek bir sekreter gibi konuş.`,
      ]
        .filter(Boolean)
        .join('\n');

      const userContents = [
        effectiveCallerName
          ? `Arayan: ${effectiveCallerName} (${callerPhone11})`
          : `Arayan Numara: ${callerPhone11}`,
        historyLines ? `Önceki Konuşma Akışı:\n${historyLines}` : '',
        `Arayanın Şimdi Söylediği Cümle: "${spokenInput}"`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const ai = getAiClient();
      const response: GenerateContentResponse = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: userContents,
        config: {
          systemInstruction,
          thinkingConfig: thinkingLevelConfig(),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              callerNameDetected: {
                type: Type.STRING,
                description: 'Arayan konuşmada kendi adını söylediyse adı, yoksa boş string.',
              },
              intentCategory: {
                type: Type.STRING,
                description:
                  'YETKILIYLE_GORUSME, RANDEVU_TALEBI, SIPARIS_TALEBI, FIYAT_BILGI veya ARIZA_DESTEK değerlerinden biri.',
              },
              issueSummary: {
                type: Type.STRING,
                description: 'Arayanın talebinin yetkiliye gösterilecek 1 cümlelik net Türkçe özeti.',
              },
              secretaryReply: {
                type: Type.STRING,
                description: 'Sekreterin arayana telefonda söyleyeceği 1-2 cümlelik doğal, kalıpsız Türkçe yanıt.',
              },
              shouldTransferToOwner: {
                type: Type.BOOLEAN,
                description: 'Yetkilinin uygulama içi telefonunun çaldırılıp bağlanması gerekiyorsa true.',
              },
              extractedAppointment: {
                type: Type.STRING,
                description: 'Randevu veya sipariş netleştiyse tarih/saat/konu özeti, yoksa boş string.',
              },
            },
            required: [
              'callerNameDetected',
              'intentCategory',
              'issueSummary',
              'secretaryReply',
              'shouldTransferToOwner',
              'extractedAppointment',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim() || '{}');
      const detectedName = String(parsed.callerNameDetected || '').trim();
      const resolvedCallerName =
        detectedName ||
        effectiveCallerName ||
        `${callerPhone11.slice(0, 4)} ${callerPhone11.slice(4, 7)} ${callerPhone11.slice(7, 9)} ${callerPhone11.slice(9, 11)}`;
      const intentCategory = String(parsed.intentCategory || 'YETKILIYLE_GORUSME').trim();
      const issueSummary =
        String(parsed.issueSummary || spokenInput).trim() || spokenInput.slice(0, 120);
      const secretaryReply = String(parsed.secretaryReply || '').trim();
      const shouldTransferToOwner = Boolean(parsed.shouldTransferToOwner);
      const extractedAppointment = String(parsed.extractedAppointment || '').trim();

      const screeningNote = `${honorific}, hatta ${resolvedCallerName} var • Konusu: ${issueSummary}. İç ahizeye bağlayayım mı?`;

      let ringOutcome: ReturnType<typeof triggerInternalVoipRing> | null = null;
      if (shouldTransferToOwner && autoRingOwner !== false) {
        ringOutcome = triggerInternalVoipRing({
          mode: 'PBX_BRIDGE',
          targetPhone: targetPhone11,
          diversionLinePhone11: String(diversionPhone || targetPhone11),
          callerPhone: callerPhone11,
          callerName: resolvedCallerName,
          screeningNote,
          spokenGreeting: greeting,
          callerIntent: intentCategory,
          callerIssueSummary: issueSummary,
          secretaryReply,
          extractedAppointment,
        });
      }

      res.json({
        ok: true,
        targetPhone11,
        matchedRule: Boolean(rule),
        honorific,
        companyName,
        greeting,
        callerProfile,
        callerNameDetected: resolvedCallerName,
        intentCategory,
        issueSummary,
        secretaryReply,
        screeningNote,
        shouldTransferToOwner,
        extractedAppointment,
        ringDispatched: Boolean(ringOutcome?.ok),
        targetOnline: Boolean(ringOutcome?.targetOnline),
        call: ringOutcome?.call || null,
      });
    } catch (error: any) {
      console.error('PBX AI reception error:', error);
      res.status(error?.status || 500).json({
        error:
          error?.message ||
          'Yapay zekâ karşılama servisi yanıt veremedi. Lütfen bağlantı ayarlarını kontrol edin.',
      });
    }
  });

  app.post('/api/ai/whatsapp-reply', async (req, res) => {
    try {
      const {
        userMessage,
        callerPhone,
        subscriberPhone,
        businessName,
        contactName,
        knowledgeBase,
        catalogEnabled,
        bookingEnabled,
        transferEnabled,
        workHours,
        address,
      } = req.body || {};

      const msg = String(userMessage || '').trim();
      if (!msg) {
        res.status(400).json({ error: 'Mesaj boş olamaz' });
        return;
      }

      const callerProfile = callerPhone
        ? await lookupServerCallerProfile(String(callerPhone), String(subscriberPhone || ''))
        : null;

      const systemInstruction = [
        `Sen "${businessName || 'İşletme'}" firmasının gerçek ve doğal konuşan WhatsApp müşteri asistanısın.`,
        `İşletme Yetkilisi: ${contactName || 'Yetkili'}.`,
        `Çalışma Saatleri: ${workHours || '09:00 - 18:00'}. Adres: ${address || ''}.`,
        `İşletmenin Sana Öğrettiği Bilgiler: ${knowledgeBase || 'Müşteriye nazikçe yardımcı ol.'}`,
        `Yetkilerin: Katalog paylaşımı=${catalogEnabled ? 'AÇIK' : 'KAPALI'}, Randevu/Sipariş=${bookingEnabled ? 'AÇIK' : 'KAPALI'}, Yetkiliye Aktarma=${transferEnabled ? 'AÇIK' : 'KAPALI'}.`,
        callerProfile ? `Yazan Müşteri Hafızası:\n${callerProfile.memoryPromptSummary}` : '',
        `KURAL: Asla hazır kalıp cümle kullanma; müşterinin mesajına doğrudan, samimi ve kısa (en fazla 2-3 cümle) Türkçe yanıt ver.`,
      ]
        .filter(Boolean)
        .join('\n');

      const ai = getAiClient();
      const response: GenerateContentResponse = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: `Müşterinin WhatsApp Mesajı: "${msg}"`,
        config: {
          systemInstruction,
          thinkingConfig: thinkingLevelConfig(),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              replyText: { type: Type.STRING, description: 'Müşteriye gönderilecek doğal Türkçe yanıt.' },
              actionType: {
                type: Type.STRING,
                description: 'CATALOG, BOOKING, TRANSFER veya INFO değerlerinden biri.',
              },
              bookingService: { type: Type.STRING, description: 'Randevu/sipariş varsa hizmet adı, yoksa boş.' },
              bookingTime: { type: Type.STRING, description: 'Randevu/sipariş varsa tarih/saat, yoksa boş.' },
              transferReason: { type: Type.STRING, description: 'Yetkiliye aktarma gerekiyorsa kısa sebep, yoksa boş.' },
            },
            required: ['replyText', 'actionType', 'bookingService', 'bookingTime', 'transferReason'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim() || '{}');
      const actionType = ['CATALOG', 'BOOKING', 'TRANSFER', 'INFO'].includes(parsed.actionType)
        ? parsed.actionType
        : 'INFO';

      res.json({
        ok: true,
        replyText: String(parsed.replyText || '').trim(),
        actionType,
        bookingDetails:
          actionType === 'BOOKING' && (parsed.bookingService || parsed.bookingTime)
            ? {
                service: String(parsed.bookingService || 'Özel Randevu'),
                time: String(parsed.bookingTime || 'Bugün'),
              }
            : undefined,
        transferDetails:
          actionType === 'TRANSFER'
            ? {
                contactName: String(contactName || 'Yetkili'),
                reason: String(parsed.transferReason || msg),
              }
            : undefined,
      });
    } catch (error: any) {
      console.error('WhatsApp AI error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'WhatsApp yapay zekâ yanıtı üretilemedi.',
      });
    }
  });

  app.post('/api/ai/support-reply', async (req, res) => {
    try {
      const {
        userMessage,
        currentRole,
        senderTitle,
        senderCode,
        senderPersonName,
        senderPhone,
        forceEscalate,
      } = req.body || {};

      const msg = String(userMessage || '').trim();
      if (!msg) {
        res.status(400).json({ error: 'Mesaj boş olamaz' });
        return;
      }

      const role = String(currentRole || 'esnaf');
      const callerProfile = senderPhone
        ? await lookupServerCallerProfile(String(senderPhone))
        : null;

      const rolePolicy =
        role === 'esnaf'
          ? 'Kullanıcı bir Esnaf Abonesidir. KESİNLİKLE bayilik komisyon oranlarını (%10, %20, %50) paylaşma; sorarsa bayilere özel olduğunu kibarca söyle. Esnafa kendi cep numarası üzerinden dakika ücreti olmadan sınırsız gelen arama karşılama, Kurulum 4. Adımdan sekreteri eğitme, fişli muhasebe ve randevu özelliklerini anlat.'
          : role === 'ilce_bayi'
          ? 'Kullanıcı İlçe Bayisidir (₺500 lisans, bağladığı esnaftan her ay %20 pay alır; ₺500 farkla İl Bayiliğine yükselebilir; İller Bayisi ve Genel Merkez kasa detaylarını göremez).'
          : role === 'il_bayi'
          ? 'Kullanıcı İl Bayisidir (₺1.000 lisans, kendi ilinde İlçe Bayisi açar ve lisansın %50 primini + alt esnaf abonelerinden her ay %10 pay alır).'
          : role === 'iller_bayi'
          ? 'Kullanıcı Türkiye İller Bayisidir (TR.001 - 81 ilde boş illere İl Bayisi atar).'
          : 'Kullanıcı Genel Merkez Yöneticisidir (TR.000 - Kenan Usta).';

      const systemInstruction = [
        `Sen Santral Bayi uygulamasının içindeki canlı destek ve eğitim uzmanı "Netlen"sin.`,
        `Konuştuğun Kişi: ${senderPersonName || ''} (${senderTitle || ''} • Kod: ${senderCode || ''} • Tel: ${senderPhone || ''}).`,
        callerProfile ? `Kişi Kayıt Bilgisi:\n${callerProfile.memoryPromptSummary}` : '',
        `Yetki Kuralı: ${rolePolicy}`,
        `Sistemin Temel Kuralları: 0850 numara veya dakika başı ücret kesinlikle yoktur; herkes kendi mevcut 05XX cep numarasıyla çalışır. Sekretere dükkan/fiyat/hizmet öğretmek için "Kurulum -> 4. Adım (Sekreterine İşini Öğret)" kutusuna düz Türkçe yazmak yeterlidir.`,
        forceEscalate
          ? `Kullanıcı doğrudan Yöneticiye (TR.000) iletilmesini istedi; isEscalatedToAdmin = true yap.`
          : `Eğer kullanıcı teknik bir arıza, ödeme/hakediş sorunu, kilitlenme veya yönetici müdahalesi gerektiren gerçek bir şikayet bildiriyorsa isEscalatedToAdmin = true yap; bilgi/kullanım sorusu soruyorsa isEscalatedToAdmin = false yap ve doğal, kalıpsız, samimi 1-3 cümleyle açıkla.`,
      ]
        .filter(Boolean)
        .join('\n');

      const ai = getAiClient();
      const response: GenerateContentResponse = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: `Kullanıcının Mesajı: "${msg}"`,
        config: {
          systemInstruction,
          thinkingConfig: thinkingLevelConfig(),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              replyText: {
                type: Type.STRING,
                description: 'Kullanıcıya verilecek doğal, kalıpsız ve net Türkçe yanıt.',
              },
              isEscalatedToAdmin: {
                type: Type.BOOLEAN,
                description: 'Yönetici (TR.000) ekranına arıza/sorun kaydı düşmesi gerekiyorsa true.',
              },
              issueCategory: {
                type: Type.STRING,
                description:
                  'Mali & Hakediş Sorunu, Santral & Çağrı Teknik Arıza, Yetki & Lisans Talebi veya Bilgi & Eğitim.',
              },
            },
            required: ['replyText', 'isEscalatedToAdmin', 'issueCategory'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim() || '{}');
      res.json({
        ok: true,
        replyText: String(parsed.replyText || '').trim(),
        isEscalatedToAdmin: Boolean(forceEscalate || parsed.isEscalatedToAdmin),
        issueCategory: String(parsed.issueCategory || 'Bilgi & Eğitim').trim(),
      });
    } catch (error: any) {
      console.error('Support AI error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Destek yapay zekâsı şu an yanıt veremedi.',
      });
    }
  });

  app.get('/api/voice/custom', (_req, res) => {
    try {
      const meta = readCustomVoiceMeta();
      if (meta && fs.existsSync(customVoiceBinPath)) {
        res.setHeader('Content-Type', meta.mimeType || 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(customVoiceBinPath);
        return;
      }
      const legacyMp3 = path.join(__dirname, 'public', 'assets', 'aistudio', 'sekreter_ornek_ses.mp3');
      if (fs.existsSync(legacyMp3)) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.sendFile(legacyMp3);
        return;
      }
      const refWav = path.join(__dirname, 'public', 'assets', 'aistudio', 'ref_voice_15s.wav');
      if (fs.existsSync(refWav)) {
        res.setHeader('Content-Type', 'audio/wav');
        res.sendFile(refWav);
        return;
      }
      res.status(404).json({ error: 'Ses dosyası bulunamadı' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ses okunamadı' });
    }
  });

  app.post('/api/voice/upload', async (req, res) => {
    try {
      const { audioDataUrl, fileName } = req.body || {};
      if (!audioDataUrl || typeof audioDataUrl !== 'string') {
        res.status(400).json({ error: 'Geçersiz ses verisi' });
        return;
      }
      const base64Match = audioDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!base64Match || !base64Match[2]) {
        res.status(400).json({ error: 'Geçersiz base64 ses formatı' });
        return;
      }
      const rawMime = String(base64Match[1] || 'audio/mpeg').trim() || 'audio/mpeg';
      const cleanFileName = String(fileName || 'ozel_sekreter_sesi.mp3').trim().slice(0, 120) || 'ozel_sekreter_sesi.mp3';
      const buffer = Buffer.from(base64Match[2], 'base64');
      if (buffer.length < 200) {
        res.status(400).json({ error: 'Ses dosyası çok küçük veya bozuk' });
        return;
      }

      fs.mkdirSync(vaultDataDir, { recursive: true });
      fs.writeFileSync(customVoiceBinPath, buffer);
      currentVoiceVersion = `v_${Date.now()}`;
      const meta: CustomVoiceDiskMeta = {
        mimeType: rawMime,
        fileName: cleanFileName,
        version: currentVoiceVersion,
        updatedAt: Date.now(),
      };
      fs.writeFileSync(customVoiceMetaPath, JSON.stringify(meta, null, 2), 'utf8');

      const audioUrl = `/api/voice/custom?v=${currentVoiceVersion}`;

      // Merkezi Ana Mahzen'e (master-vault.json) anında mühürle ki güncellemelerde veya yeni cihazda asla kaybolmasın
      const currentVault = readMasterVault();
      const nextKv: Record<string, string> = {
        ...currentVault.kvStore,
        sb_admin_explicit_voice_upload_v2: '1',
        sb_global_secretary_voice_url_v1: audioUrl,
        sb_global_secretary_voice_filename_v1: cleanFileName,
        sb_global_secretary_voice_name_v1: cleanFileName,
      };
      writeMasterVault({
        revision: currentVault.revision + 1,
        updatedAt: Date.now(),
        sections: currentVault.sections,
        kvStore: nextKv,
      });

      res.json({
        ok: true,
        version: currentVoiceVersion,
        fileName: cleanFileName,
        audioUrl,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ses dosyası kaydedilemedi' });
    }
  });

  app.post('/api/voice/reset', (_req, res) => {
    try {
      try {
        if (fs.existsSync(customVoiceBinPath)) fs.unlinkSync(customVoiceBinPath);
        if (fs.existsSync(customVoiceMetaPath)) fs.unlinkSync(customVoiceMetaPath);
      } catch {}
      currentVoiceVersion = `default_${Date.now()}`;

      const currentVault = readMasterVault();
      const nextKv: Record<string, string> = { ...currentVault.kvStore };
      delete nextKv['sb_admin_explicit_voice_upload_v2'];
      delete nextKv['sb_global_secretary_voice_url_v1'];
      delete nextKv['sb_global_secretary_voice_filename_v1'];
      delete nextKv['sb_global_secretary_voice_name_v1'];
      writeMasterVault({
        revision: currentVault.revision + 1,
        updatedAt: Date.now(),
        sections: currentVault.sections,
        kvStore: nextKv,
      });

      res.json({ ok: true, reset: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ses sıfırlanamadı' });
    }
  });

  const ttsDiskCacheDir = path.join(vaultDataDir, 'tts-cache');
  const voiceBankDir = path.join(vaultDataDir, 'voice-bank');
  const voiceBankManifestPath = path.join(voiceBankDir, 'manifest.json');
  try {
    fs.mkdirSync(ttsDiskCacheDir, { recursive: true });
    fs.mkdirSync(voiceBankDir, { recursive: true });
  } catch {}

  function readVoiceBankClips(): Record<string, string> {
    try {
      if (fs.existsSync(voiceBankManifestPath)) {
        const parsed = JSON.parse(fs.readFileSync(voiceBankManifestPath, 'utf8'));
        if (parsed && typeof parsed.clips === 'object' && parsed.clips) {
          return { ...(parsed.clips as Record<string, string>) };
        }
      }
    } catch {}
    return {};
  }

  function writeVoiceBankClips(clips: Record<string, string>): void {
    try {
      fs.mkdirSync(voiceBankDir, { recursive: true });
      fs.writeFileSync(
        voiceBankManifestPath,
        JSON.stringify({ voiceProfile: 'permanent_voice_bank_v1', updatedAt: Date.now(), clips }, null, 2),
        'utf8'
      );
    } catch {}
  }

  function seedAndMergeVoiceBank(): Record<string, string> {
    const bankClips = readVoiceBankClips();
    let changed = false;
    try {
      const publicNeuralDir = path.join(__dirname, 'public', 'assets', 'aistudio', 'neural');
      const publicManifestFile = path.join(publicNeuralDir, 'manifest.json');
      if (fs.existsSync(publicManifestFile)) {
        const pubObj = JSON.parse(fs.readFileSync(publicManifestFile, 'utf8'));
        const pubClips = (pubObj?.clips || {}) as Record<string, string>;
        for (const [normKey, relUrl] of Object.entries(pubClips)) {
          if (typeof relUrl !== 'string') continue;
          const baseName = path.basename(relUrl);
          const srcFile = path.join(publicNeuralDir, baseName);
          const dstFile = path.join(voiceBankDir, baseName);
          if (fs.existsSync(srcFile)) {
            const stat = fs.statSync(srcFile);
            if (stat.size > 4000 && !fs.existsSync(dstFile)) {
              fs.copyFileSync(srcFile, dstFile);
            }
          }
          if (fs.existsSync(dstFile) && fs.statSync(dstFile).size > 4000) {
            const permanentUrl = `/api/voice-bank/clips/${baseName}`;
            if (bankClips[normKey] !== permanentUrl) {
              bankClips[normKey] = permanentUrl;
              changed = true;
            }
          }
        }
      }
    } catch {}
    if (changed) {
      writeVoiceBankClips(bankClips);
    }
    return bankClips;
  }

  seedAndMergeVoiceBank();

  app.use(
    '/api/voice-bank/clips',
    express.static(voiceBankDir, {
      index: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );

  app.get('/api/voice-bank/manifest', (_req, res) => {
    const bankClips = seedAndMergeVoiceBank();
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ ok: true, voiceProfile: 'permanent_voice_bank_v1', clips: bankClips });
  });

  function registerGeneratedClipInVoiceBank(normKey: string, audioBuf: Buffer, ext: 'wav' | 'mp3'): string {
    const clipId = crypto.createHash('sha1').update(normKey).digest('hex').slice(0, 18);
    const fileName = `${clipId}.${ext}`;
    const dstPath = path.join(voiceBankDir, fileName);
    fs.writeFileSync(dstPath, audioBuf);
    const clips = readVoiceBankClips();
    const relUrl = `/api/voice-bank/clips/${fileName}`;
    clips[normKey] = relUrl;
    writeVoiceBankClips(clips);
    return relUrl;
  }

  app.post('/api/voice-bank/upload-clip', (req, res) => {
    try {
      const rawText = String(req.body?.text || '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/["“”«»]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const b64 = String(req.body?.audioBase64 || '');
      const extRaw = String(req.body?.ext || 'wav').toLowerCase();
      const ext: 'wav' | 'mp3' = extRaw === 'mp3' ? 'mp3' : 'wav';
      if (!rawText || !b64) {
        res.status(400).json({ ok: false });
        return;
      }
      const cleanB64 = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
      const buf = Buffer.from(cleanB64, 'base64');
      if (buf.length < 4000 || buf.length > 8 * 1024 * 1024) {
        res.status(400).json({ ok: false });
        return;
      }
      const normKey = rawText.toLocaleLowerCase('tr-TR');
      const permanentUrl = registerGeneratedClipInVoiceBank(normKey, buf, ext);
      res.json({ ok: true, permanentUrl });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  function wrapPcm24kMonoToWav(pcmBuf: Buffer): Buffer {
    if (pcmBuf.length >= 4 && pcmBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
      return pcmBuf;
    }
    const header = Buffer.alloc(44);
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuf.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuf.length, 40);
    return Buffer.concat([header, pcmBuf]);
  }

  const serverUploadedRefCache = new Map<string, { upPath: string; expiresAt: number }>();

  async function cloneTextWithMirror(
    baseUrl: string,
    text: string,
    refBuf: Buffer,
    refMime: string,
    refExt: string,
    timeoutMs = 24000
  ): Promise<Buffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const cacheKey = `${baseUrl}::${refBuf.length}`;
    try {
      let upPath = '';
      const cached = serverUploadedRefCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        upPath = cached.upPath;
      } else {
        const fd = new FormData();
        fd.append('files', new Blob([refBuf], { type: refMime }), `ref_voice.${refExt}`);
        const upRes = await fetch(`${baseUrl}/gradio_api/upload`, {
          method: 'POST',
          body: fd,
          signal: ctrl.signal,
        });
        if (!upRes.ok) throw new Error(`Upload ${upRes.status}`);
        const [uploaded] = (await upRes.json()) as string[];
        upPath = uploaded;
        serverUploadedRefCache.set(cacheKey, {
          upPath,
          expiresAt: Date.now() + 8 * 60 * 1000,
        });
      }

      const callRes = await fetch(`${baseUrl}/gradio_api/call/generate_tts_audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            text.slice(0, 450),
            'tr',
            { path: upPath, meta: { _type: 'gradio.FileData' } },
            0.35,
            0.65,
            0,
            0.6,
          ],
        }),
        signal: ctrl.signal,
      });
      if (!callRes.ok) {
        serverUploadedRefCache.delete(cacheKey);
        throw new Error(`Call ${callRes.status}`);
      }
      const { event_id } = (await callRes.json()) as { event_id: string };
      const sseRes = await fetch(`${baseUrl}/gradio_api/call/generate_tts_audio/${event_id}`, {
        signal: ctrl.signal,
      });
      const sseText = await sseRes.text();
      const lines = sseText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event: complete')) {
          const payload = JSON.parse(lines[i + 1].replace(/^data:\s*/, ''));
          const item = payload[0];
          const audioUrl = item?.url || `${baseUrl}/gradio_api/file=${item?.path}`;
          const wavBuf = Buffer.from(
            await (await fetch(audioUrl, { signal: ctrl.signal })).arrayBuffer()
          );
          if (wavBuf.length > 4000) return wavBuf;
        }
        if (lines[i].startsWith('event: error')) {
          serverUploadedRefCache.delete(cacheKey);
          throw new Error('SSE error');
        }
      }
      throw new Error('Incomplete SSE');
    } finally {
      clearTimeout(timer);
    }
  }

  app.post('/api/tts', async (req, res) => {
    try {
      const rawText = String(req.body?.text || '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/["“”«»]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (rawText) {
        const vaultNow = readMasterVault();
        const explicitAdminUpload =
          vaultNow?.kvStore?.['sb_admin_explicit_voice_upload_v2'] === '1';
        const customMeta = explicitAdminUpload ? readCustomVoiceMeta() : null;
        const hasCustomBin = Boolean(customMeta && fs.existsSync(customVoiceBinPath));

        const normKey = rawText.toLocaleLowerCase('tr-TR');

        // 1) Varsayılan ses: Canlı telefondaki birebir aynı tek sıcak kadın sesi (Kore) — 0 ms disk önbellekli!
        if (!hasCustomBin && process.env.GEMINI_API_KEY) {
          const koreHash = crypto
            .createHash('sha256')
            .update(`kore_live_v1::${normKey}`)
            .digest('hex')
            .slice(0, 24);
          const koreCachedPath = path.join(ttsDiskCacheDir, `${koreHash}.wav`);
          if (fs.existsSync(koreCachedPath)) {
            const cachedBuf = fs.readFileSync(koreCachedPath);
            if (cachedBuf.length > 4000) {
              res.json({
                ok: true,
                dynamic: true,
                audioDataUrl: `data:audio/wav;base64,${cachedBuf.toString('base64')}`,
              });
              return;
            }
          }
          try {
            const rawAudioBuf = await callGeminiTtsDirectIpv4(
              'gemini-3.8-flash-lite-tts',
              rawText.slice(0, 450),
              'Kore',
              7500
            );
            if (rawAudioBuf.length > 3000) {
              const wavOut = wrapPcm24kMonoToWav(rawAudioBuf);
              if (wavOut.length > 4000) {
                try {
                  fs.writeFileSync(koreCachedPath, wavOut);
                } catch {}
                res.json({
                  ok: true,
                  dynamic: true,
                  audioDataUrl: `data:audio/wav;base64,${wavOut.toString('base64')}`,
                });
                return;
              }
            }
          } catch {}
        }

        // 2) Sunucu disk önbelleğinde daha önce üretilmişse 1 ms içinde döndür
        const voiceSig = hasCustomBin ? `custom_${customMeta!.version}` : 'mh_ref_v5';
        const cacheHash = crypto
          .createHash('sha256')
          .update(`${voiceSig}::${normKey}`)
          .digest('hex')
          .slice(0, 24);
        const cachedWavPath = path.join(ttsDiskCacheDir, `${cacheHash}.wav`);
        if (fs.existsSync(cachedWavPath)) {
          const cachedBuf = fs.readFileSync(cachedWavPath);
          if (cachedBuf.length > 4000) {
            res.json({
              ok: true,
              dynamic: true,
              audioDataUrl: `data:audio/wav;base64,${cachedBuf.toString('base64')}`,
            });
            return;
          }
        }

        // 3) Özel ses yüklendiyse hızlı ZeroGPU klonlamayı dene
        const refFile = hasCustomBin
          ? customVoiceBinPath
          : path.join(__dirname, 'public', 'assets', 'aistudio', 'ref_voice_15s.wav');
        const refMime = hasCustomBin ? customMeta!.mimeType : 'audio/wav';
        const refExt = refMime.includes('mpeg') || refMime.includes('mp3') ? 'mp3' : 'wav';

        if (hasCustomBin && fs.existsSync(refFile)) {
          const refBuf = fs.readFileSync(refFile);
          try {
            const fastGpuWav = await cloneTextWithMirror(
              'https://resembleai-chatterbox-multilingual-tts.hf.space',
              rawText,
              refBuf,
              refMime,
              refExt,
              process.env.GEMINI_API_KEY ? 22000 : 6500
            );
            if (fastGpuWav && fastGpuWav.length > 4000) {
              try {
                fs.writeFileSync(cachedWavPath, fastGpuWav);
                if (!hasCustomBin) {
                  registerGeneratedClipInVoiceBank(normKey, fastGpuWav, 'wav');
                }
              } catch {}
              res.json({
                ok: true,
                dynamic: true,
                audioDataUrl: `data:audio/wav;base64,${fastGpuWav.toString('base64')}`,
              });
              return;
            }
          } catch {}
        }

        // 4) İlk saniyede bekletmeden sıcak müşteri hizmetleri kadın sesiyle tam kimlik ve ismi oku
        if (process.env.GEMINI_API_KEY) {
          const ttsModels = ['gemini-3.8-flash-lite-tts'];
          for (const ttsModel of ttsModels) {
            try {
              const rawAudioBuf = await callGeminiTtsDirectIpv4(ttsModel, rawText.slice(0, 450), 'Kore', 7500);
              if (rawAudioBuf.length > 3000) {
                const wavOut = wrapPcm24kMonoToWav(rawAudioBuf);
                if (wavOut.length > 4000) {
                  res.json({
                    ok: true,
                    dynamic: true,
                    audioDataUrl: `data:audio/wav;base64,${wavOut.toString('base64')}`,
                  });
                  return;
                }
              }
            } catch {}
          }
        }
        // 5) Son çare yedek: anlık yoğunlukta kayıtlı ses kasasından döndür
        if (!hasCustomBin) {
          const bankClips = seedAndMergeVoiceBank();
          const bankRel = bankClips[normKey];
          if (typeof bankRel === 'string' && bankRel.startsWith('/')) {
            const fileName = path.basename(bankRel);
            const bankFile = path.join(voiceBankDir, fileName);
            if (fs.existsSync(bankFile) && fs.statSync(bankFile).size > 4000) {
              const extMime = fileName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
              const buf = fs.readFileSync(bankFile);
              res.json({
                ok: true,
                dynamic: true,
                permanentUrl: bankRel,
                audioDataUrl: `data:${extMime};base64,${buf.toString('base64')}`,
              });
              return;
            }
          }
        }
      }
    } catch {}

    // KESİN KURAL: Ne örnek ses (ref_voice_15s.wav) ne de yüklenen ham ses kaydı isim okumadan çiğ olarak döndürülemez!
    res.status(202).json({
      ok: false,
      dynamic: false,
      error: 'Kişisel karşılama sesiniz hazırlanıyor, birkaç saniye sonra tekrar dokunun.',
    });
  });

  // Sosyal Medya Botları & Paylaşım Linkleri İçin Dinamik OpenGraph Broşür Kartı Enjeksiyonu
  function buildSocialMetaHtml(rawHtml: string, req: express.Request): string {
    const refParam = typeof req.query?.ref === 'string' ? req.query.ref.trim() : '';
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = req.get('host') || '178.208.187.42:3000';
    const origin = `${proto}://${host}`;
    const slug = toSafeBrochureSlug(refParam || 'TR.000');
    const customBrochurePath = resolveBrochureFilePath(slug);
    const imageUrl = customBrochurePath
      ? `${origin}/brochures/${slug}.png?v=${Math.floor(fs.statSync(customBrochurePath).mtimeMs / 1000)}`
      : `${origin}/pwa-512x512.png`;
    const shareTitle = refParam
      ? `Santral Bayi • 7/24 Akıllı Çağrı & Bayilik Sistemi (Ref: ${refParam})`
      : 'Santral Bayi Akıllı Çağrı Sistemleri';
    const shareDesc =
      'Kendi mevcut 05XX cep numaranızla çalışan 7/24 Akıllı Çağrı & Dijital Sekreter Sistemi. Hemen Esnaf Abone Olun veya İl/İlçe Bayimiz Olun!';
    const extraTags = [
      `<meta property="og:image" content="${imageUrl}" />`,
      `<meta property="og:image:type" content="image/png" />`,
      `<meta property="og:url" content="${origin}${req.originalUrl || '/'}" />`,
      `<meta name="twitter:image" content="${imageUrl}" />`,
      `<meta name="twitter:title" content="${shareTitle.replace(/"/g, '&quot;')}" />`,
      `<meta name="twitter:description" content="${shareDesc}" />`,
    ].join('\n    ');

    return rawHtml
      .replace(
        /<meta property="og:title"[^>]*>/i,
        `<meta property="og:title" content="${shareTitle.replace(/"/g, '&quot;')}" />`
      )
      .replace(
        /<meta property="og:description"[^>]*>/i,
        `<meta property="og:description" content="${shareDesc}" />`
      )
      .replace('</head>', `    ${extraTags}\n  </head>`);
  }

  const rootIndexHtmlPath = path.join(__dirname, 'index.html');
  const liveBundleJsPath = path.join(__dirname, 'public', '_live', 'app.js');
  const isVdsLiveCompiledMode =
    fs.existsSync(liveBundleJsPath) &&
    fs.existsSync(rootIndexHtmlPath) &&
    fs.readFileSync(rootIndexHtmlPath, 'utf8').includes('__SB_BUNDLE_KEY__');

  if (process.env.NODE_ENV === 'production' || isVdsLiveCompiledMode) {
    // Canlı VDS Üretim Modu: Vite geliştirici izleyicisi (/@vite/client) TAMAMEN KAPALIDIR!
    // Sonsuz WebSocket yenileme döngüsü ve dosya izleyicisi asla çalışmaz; statik paket doğrudan sunulur.
    app.use(
      '/_live',
      express.static(path.join(__dirname, 'public', '_live'), {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );

    const publicDir = path.join(__dirname, 'public');
    if (fs.existsSync(publicDir)) {
      app.use(express.static(publicDir, { index: false }));
    }

    const distPath = path.join(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath, { index: false }));
    }

    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API uç noktası bulunamadı' });
        return;
      }
      if (/\.(mp3|wav|ogg|m4a|png|jpg|jpeg|webp|svg|ico|woff|woff2|ttf|map)$/i.test(req.path)) {
        res.status(404).end();
        return;
      }
      const htmlFile = isVdsLiveCompiledMode
        ? rootIndexHtmlPath
        : fs.existsSync(path.join(distPath, 'index.html'))
        ? path.join(distPath, 'index.html')
        : rootIndexHtmlPath;
      const rawHtml = fs.readFileSync(htmlFile, 'utf8');
      const finalHtml = buildSocialMetaHtml(rawHtml, req);
      const htmlEtag = `W/"sb-${currentBuildTime}-${finalHtml.length}"`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('ETag', htmlEtag);
      res.send(finalHtml);
    });
  } else {
    app.get('/', (req, res, next) => {
      try {
        if (fs.existsSync(rootIndexHtmlPath) && req.query?.ref) {
          const rawHtml = fs.readFileSync(rootIndexHtmlPath, 'utf8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.send(buildSocialMetaHtml(rawHtml, req));
          return;
        }
      } catch {}
      next();
    });

    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // =========================================================================
  // SIFIR KONTÖR İNTERNET CANLI SES KÖPRÜSÜ (/ws/live-call - Saf RFC 6455 WS)
  // Telefon bağımsız arama ekranı (LiveCallActivity) ve web tam ekran ahize için
  // 8kHz PCM16 çift yönlü anlık ses akışı (0 TL, 0 operatör dakikası)
  // =========================================================================
  const buildWsServerFrame = (opcode: number, payload: Buffer): Buffer => {
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  };

  httpServer.on('upgrade', (req, socket) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (reqUrl.pathname !== '/ws/live-call') {
        socket.destroy();
        return;
      }

      const uuid = String(reqUrl.searchParams.get('uuid') || '').trim();
      const ownerPhone11 = normalizePhone11(String(reqUrl.searchParams.get('ownerPhone') || ''));
      const token = String(reqUrl.searchParams.get('token') || '').trim();
      const wsKey = String(req.headers['sec-websocket-key'] || '').trim();

      if (
        !wsKey ||
        !/^[a-zA-Z0-9_-]{6,64}$/.test(uuid) ||
        !/^0[23458]\d{9}$/.test(ownerPhone11) ||
        !verifyLiveAudioBridgeToken(uuid, ownerPhone11, token)
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const acceptHash = crypto
        .createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptHash}`,
          '',
          '',
        ].join('\r\n')
      );
      if ('setNoDelay' in socket && typeof (socket as net.Socket).setNoDelay === 'function') {
        (socket as net.Socket).setNoDelay(true);
      }

      let closed = false;
      const sendFrame = (opcode: number, data: Buffer) => {
        if (closed || socket.destroyed) return;
        try {
          socket.write(buildWsServerFrame(opcode, data));
        } catch {}
      };
      const sendJson = (obj: Record<string, unknown>) => {
        sendFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
      };

      const transferWav = path.join(fsAudioDir, 'transfer_connecting_tr_8k.wav');
      const attached = pbxLiveBridge.attachOwnerInternetAudio(
        uuid,
        ownerPhone11,
        (callerPcm8k) => {
          sendFrame(0x2, callerPcm8k);
        },
        () => {
          if (closed) return;
          sendJson({ type: 'call_ended', reason: 'caller_hangup' });
          sendFrame(0x8, Buffer.alloc(0));
          closed = true;
          try {
            socket.end();
          } catch {}
        },
        transferWav
      );

      if (!attached.ok) {
        sendJson({ type: 'call_ended', reason: attached.error || 'call_not_live' });
        sendFrame(0x8, Buffer.alloc(0));
        closed = true;
        try {
          socket.end();
        } catch {}
        return;
      }

      const realUuid = attached.uuid || uuid;
      const safeUuid = attached.safeUuid || realUuid;
      transferredCallUuids.add(realUuid);
      if (safeUuid) transferredCallUuids.add(safeUuid);
      appendLiveNetgsmCall({
        uuid: realUuid,
        safeUuid,
        status: 'TRANSFERRED_TO_OWNER',
        aiSummary: 'Müsaitim onayıyla internet üzerinden (0 kontör) canlı görüşüldü.',
        lastTurnAt: new Date().toISOString(),
      });
      try {
        endActiveLivePbxVoipSession(
          realUuid,
          safeUuid,
          'Müsaitim onayıyla internet üzerinden canlı görüşmeye geçildi.'
        );
      } catch {}

      sendJson({
        type: 'connected',
        uuid: realUuid,
        callerPhone: attached.callerPhone || '',
        sampleRate: 8000,
      });

      let rxBuf = Buffer.alloc(0);
      const cleanup = (hangupCaller: boolean) => {
        if (closed) return;
        closed = true;
        pbxLiveBridge.detachOwnerInternetAudio(realUuid, hangupCaller);
        try {
          socket.destroy();
        } catch {}
      };

      socket.on('data', (chunk: Buffer) => {
        if (closed) return;
        rxBuf = Buffer.concat([rxBuf, chunk]);
        while (rxBuf.length >= 2) {
          const b0 = rxBuf[0];
          const b1 = rxBuf[1];
          const opcode = b0 & 0x0f;
          const masked = (b1 & 0x80) !== 0;
          let payloadLen = b1 & 0x7f;
          let offset = 2;
          if (payloadLen === 126) {
            if (rxBuf.length < 4) break;
            payloadLen = rxBuf.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (rxBuf.length < 10) break;
            payloadLen = Number(rxBuf.readBigUInt64BE(2));
            offset = 10;
          }
          if (payloadLen > 262144) {
            cleanup(false);
            return;
          }
          const maskLen = masked ? 4 : 0;
          if (rxBuf.length < offset + maskLen + payloadLen) break;

          let payload = rxBuf.subarray(offset + maskLen, offset + maskLen + payloadLen);
          if (masked) {
            const mask = rxBuf.subarray(offset, offset + 4);
            const unmasked = Buffer.allocUnsafe(payloadLen);
            for (let i = 0; i < payloadLen; i++) {
              unmasked[i] = payload[i] ^ mask[i & 3];
            }
            payload = unmasked;
          }
          rxBuf = rxBuf.subarray(offset + maskLen + payloadLen);

          if (opcode === 0x8) {
            cleanup(true);
            return;
          } else if (opcode === 0x9) {
            sendFrame(0xA, payload);
          } else if (opcode === 0x2) {
            pbxLiveBridge.pushOwnerPcm8k(realUuid, payload);
          } else if (opcode === 0x1) {
            try {
              const msg = JSON.parse(payload.toString('utf8'));
              if (msg?.type === 'hangup') {
                cleanup(true);
                return;
              }
            } catch {}
          }
        }
      });

      socket.on('close', () => cleanup(true));
      socket.on('error', () => cleanup(true));
    } catch {
      try {
        socket.destroy();
      } catch {}
    }
  });
}

function thinkingLevelConfig() {
  return { thinkingLevel: ThinkingLevel.LOW };
}

startServer();

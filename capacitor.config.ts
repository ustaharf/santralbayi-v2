import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.santralbayi.app',
  appName: 'Santral Bayi',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  server: {
    androidScheme: 'http',
    cleartext: true,
    allowNavigation: [
      '*'
    ]
  },
  android: {
    backgroundColor: '#0f172a',
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'native',
      style: 'DARK',
      hidden: false,
      animation: 'NONE'
    }
  }
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ronitervo.ideatesvg',
  appName: 'Sketch AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;

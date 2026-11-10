import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native wrapper config. Generate the native projects on a Mac with:
 *   npm run build -w apps/field && npx cap add ios && npx cap add android
 * Then apply docs/native-setup.md (permissions, data protection, test builds).
 */
const config: CapacitorConfig = {
  appId: "care.pinpoint.field",
  appName: "Pinpoint",
  webDir: "dist",
  ios: {
    contentInset: "never",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    CapacitorSQLite: {
      iosIsEncryption: true,
      iosKeychainPrefix: "pinpoint",
      iosBiometric: { biometricAuth: false },
      androidIsEncryption: true,
      androidBiometric: { biometricAuth: false },
    },
  },
};

export default config;

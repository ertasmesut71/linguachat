import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // ─── App identity ───
  appId: "com.linguachat.app",
  appName: "LinguaChat",
  webDir: "dist",

  // ─── Android-specific ───
  android: {
    // Allow mixed content so dev can work over HTTP; production should
    // be HTTPS-only. The bundled Vite build loads from local assets
    // and calls the API over the configured server URL.
    allowMixedContent: false,

    // Status bar + navigation bar styling
    backgroundColor: "#0a0a0f",

    // Build flavor — release builds use this
    buildOptions: {
      releaseType: "AAB", // Android App Bundle for Play Store
    },
  },

  // ─── Server ───
  // In production, the app loads from the bundled dist/ directory.
  // For development, you can point this to the Vite dev server:
  //   server: { url: "http://192.168.x.x:5173", cleartext: true }
  // Remove or comment out the server block for production builds.

  // ─── Plugins ───
  plugins: {
    // Push notifications — integrate with the existing VAPID web-push
    // flow. On Android, this works through the browser push API in the
    // Capacitor WebView (no FCM needed for the MVP).
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },

    // Splash screen
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0a0a0f",
      showSpinner: false,
    },
  },
};

export default config;

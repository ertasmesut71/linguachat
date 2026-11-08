# LinguaChat — Android Build & Distribution Guide

This guide walks you through packaging LinguaChat as a native Android app using [Capacitor](https://capacitorjs.com). The result is a real Android App Bundle (AAB) suitable for Google Play Store upload, or a debug APK for direct install on phones and tablets.

## Prerequisites

On your development machine (not the server):

1. **Node.js 18+** — already used for the web build
2. **Android Studio** — [download](https://developer.android.com/studio)
   - During install, accept the Android SDK license
   - Make sure the Android SDK is installed (default location is fine)
3. **Java 17 JDK** — Android Studio bundles one, or install separately:
   ```bash
   # macOS
   brew install openjdk@17
   # Ubuntu/Debian
   sudo apt install openjdk-17-jdk
   ```
4. **Environment variables** (add to your shell profile):
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk        # Linux
   export ANDROID_HOME=$HOME/Library/Android/sdk # macOS
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```

## One-Time Setup

### 1. Install client dependencies (includes Capacitor)

```bash
cd client
npm install
```

### 2. Build the web app

```bash
npm run build
# This creates client/dist/ with the Vite-built SPA
```

### 3. Initialize the Android project

```bash
npx cap add android
```

This creates `client/android/` — a real Android Studio project with:
- `app/src/main/` — Android manifest, resources, Java/Kotlin launcher
- `app/src/main/assets/public/` — the bundled web app (synced from `dist/`)
- `build.gradle` — Gradle build config

### 4. Configure the app identity

Edit `client/android/app/build.gradle`:
```groovy
android {
    namespace "com.linguachat.app"
    defaultConfig {
        applicationId "com.linguachat.app"
        minSdkVersion 22        // Android 5.1+ (covers 99%+ of devices)
        targetSdkVersion 34     // Android 14
        versionCode 1
        versionName "1.0.0"
    }
}
```

### 5. Replace the default icons

Copy the generated icons into the Android resource folders:

```bash
# From the project root
cp client/public/icons/icon-1024.png client/android/app/src/main/res/

# Or use Android Studio's Image Asset tool:
# Right-click res/ → New → Image Asset → choose icon-1024.png
# This auto-generates all density variants (mdpi through xxxhdpi)
```

For the adaptive icon (Android 8+), use `icon-foreground.png` as the foreground layer with `#6c5ce7` as the background color.

### 6. Set the splash screen color

In `client/android/app/src/main/res/values/styles.xml`, the Capacitor default splash uses `@color/splash_color`. Set it to the LinguaChat dark background:

```xml
<color name="splash_color">#0a0a0f</color>
```

## Development Workflow

### Build + sync + run on a connected device or emulator

```bash
cd client

# Build the web app, sync to the Android project, and launch
npm run android:run

# Or step by step:
npm run build                # build the Vite SPA
npm run android:sync         # copy dist/ into android/app/src/main/assets/public/
npm run android:open         # open in Android Studio
```

### Live reload during development

For faster iteration, point Capacitor at your Vite dev server:

1. Find your machine's local IP (e.g. `192.168.1.42`)
2. Edit `capacitor.config.ts`:
   ```ts
   server: {
     url: "http://192.168.1.42:5173",
     cleartext: true,
   },
   ```
3. Start the Vite dev server: `npm run dev`
4. Run the Android app: `npx cap run android`
5. **Remove the `server` block before making a release build.**

## Production Build (Play Store AAB)

### 1. Build the web app in production mode

```bash
cd client
npm run build
npx cap sync android
```

### 2. Generate a signing key (one time only)

```bash
keytool -genkeypair -v \
  -keystore linguachat-release.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias linguachat \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD
```

**Keep this keystore file safe.** You cannot update your Play Store listing without it.

### 3. Configure signing in Gradle

Create `client/android/keystore.properties` (do NOT commit this file):
```properties
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=linguachat
storeFile=../linguachat-release.keystore
```

Add to `client/android/app/build.gradle`:
```groovy
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'] ?: '/dev/null')
            storePassword keystoreProperties['storePassword'] ?: ''
            keyAlias keystoreProperties['keyAlias'] ?: ''
            keyPassword keystoreProperties['keyPassword'] ?: ''
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt')
        }
    }
}
```

### 4. Build the signed AAB

```bash
cd client/android

# Build a signed Android App Bundle
./gradlew bundleRelease

# The AAB will be at:
# app/build/outputs/bundle/release/app-release.aab
```

### 5. (Optional) Build a debug APK for direct install

```bash
./gradlew assembleDebug

# The APK will be at:
# app/build/outputs/apk/debug/app-debug.apk

# Install directly on a connected device:
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Play Store Upload

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app → fill in the listing details
3. Under **Release** → **Production** → **Create new release**
4. Upload `app-release.aab`
5. Fill in the required store listing fields:
   - App name: **LinguaChat**
   - Short description: "AI-powered multilingual chat — text, voice, video, documents in 30+ languages"
   - Category: **Communication**
   - Content rating: complete the questionnaire
   - Screenshots: capture from a phone/emulator running the app
6. Submit for review

## API Server URL Configuration

The Android app loads the web UI from its bundled assets (`dist/`) but makes API calls to your server. Set the server URL:

**Option A — In the web app's build** (recommended for production):

Edit `client/src/api/client.js` — the `BASE_URL` is derived from `window.location.origin` by default. For the Android app, the WebView loads from `capacitor://localhost`, so the API calls need an absolute URL.

Add to `client/src/api/client.js` near the top:
```javascript
const IS_CAPACITOR = typeof window !== "undefined" && window.Capacitor?.isNativePlatform();
const BASE_URL = IS_CAPACITOR
  ? "https://chat.yourdomain.com/api"  // your production server
  : "/api";                              // web: relative (proxied by Vite or nginx)
```

**Option B — In capacitor.config.ts** (for development):

```typescript
server: {
  url: "https://chat.yourdomain.com",
  cleartext: false,
},
```

This makes the WebView load the app directly from your server instead of from bundled assets. Simpler but requires network connectivity for initial load.

## Tablet Compatibility

LinguaChat's responsive layout (D6) already handles tablet widths:
- **≥768px**: sidebar + chat pane side by side (like WhatsApp desktop)
- **<768px**: full-screen panes with back-button navigation

No additional Android-specific work is needed for tablet compatibility.

## Permissions

The default Capacitor Android manifest includes:
- `INTERNET` — API calls + WebSocket
- `CAMERA` — optional (for QR code scanning if added later)
- `RECORD_AUDIO` — voice messages + live voice
- `VIBRATE` — notification feedback

These are auto-configured by Capacitor and its plugins.

## Push Notifications on Android

The existing Web Push (VAPID) flow works in the Capacitor WebView. For a more native experience with Firebase Cloud Messaging (FCM):

1. Install the Capacitor Push plugin: `npm install @capacitor/push-notifications`
2. Add your Firebase project's `google-services.json` to `client/android/app/`
3. The existing push subscription UI in ProfilePage.jsx works — FCM provides the transport layer underneath

This is optional and not required for the initial release.

## Files Added for Android Support

```
client/
├── capacitor.config.ts       # Capacitor configuration (app ID, web dir, plugins)
├── package.json               # Updated with Capacitor deps + android:* scripts
└── public/icons/
    ├── icon-1024.png          # Hi-res icon for Android Image Asset generation
    └── icon-foreground.png    # Adaptive icon foreground layer
docs/
└── ANDROID_BUILD.md           # This file
```

After running `npx cap add android`, the following is generated:
```
client/android/                # Full Android Studio project (gitignored by default)
├── app/
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── assets/public/     # Bundled web app (synced from dist/)
│   │   └── res/               # Icons, splash, colors
│   └── build.gradle           # App-level Gradle config
├── build.gradle               # Project-level Gradle config
└── gradle/                    # Gradle wrapper
```

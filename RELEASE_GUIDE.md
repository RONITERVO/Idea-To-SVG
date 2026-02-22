# Sketch AI (IdeaToSVG) - Complete Release Guide

Step-by-step instructions to go from source code to a published Android app on Google Play.

---

## Table of Contents

1. [Install Prerequisites](#1-install-prerequisites)
2. [Clone & Install the Project](#2-clone--install-the-project)
3. [Create a Firebase Project](#3-create-a-firebase-project)
4. [Enable Firebase Authentication](#4-enable-firebase-authentication)
5. [Enable Firestore Database](#5-enable-firestore-database)
6. [Get Your Firebase Config](#6-get-your-firebase-config)
7. [Set Up Firebase Functions](#7-set-up-firebase-functions)
8. [Deploy Firebase Backend](#8-deploy-firebase-backend)
9. [Create a Google Play Developer Account](#9-create-a-google-play-developer-account)
10. [Create Your App in Play Console](#10-create-your-app-in-play-console)
11. [Create In-App Products (Token Packs)](#11-create-in-app-products-token-packs)
12. [Set Up Play Developer API for Backend Verification](#12-set-up-play-developer-api-for-backend-verification)
13. [Generate a Signing Keystore](#13-generate-a-signing-keystore)
14. [Configure Keystore Properties](#14-configure-keystore-properties)
15. [Get a Gemini API Key for the Server](#15-get-a-gemini-api-key-for-the-server)
16. [Set Firebase Environment Variables](#16-set-firebase-environment-variables)
17. [Build the Android App](#17-build-the-android-app)
18. [Test on a Device or Emulator](#18-test-on-a-device-or-emulator)
19. [Build the Release AAB](#19-build-the-release-aab)
20. [Upload to Play Console](#20-upload-to-play-console)
21. [Configure Play Store Listing](#21-configure-play-store-listing)
22. [Submit for Review](#22-submit-for-review)
23. [After Publication](#23-after-publication)

---

## 1. Install Prerequisites

You need these installed on your computer before anything else.

### Node.js (version 20 or newer)

1. Go to https://nodejs.org
2. Download the **LTS** version (the big green button)
3. Run the installer, click "Next" through everything
4. When done, open **Command Prompt** (press `Win + R`, type `cmd`, press Enter)
5. Type this and press Enter to verify:
   ```
   node --version
   ```
   You should see something like `v20.x.x`

### Java Development Kit (JDK 17)

1. Go to https://adoptium.net
2. Download **Temurin 17 LTS** for Windows
3. Run the installer
4. **Important**: Check the box that says "Set JAVA_HOME variable" during install
5. Verify in Command Prompt:
   ```
   java -version
   ```

### Android Studio

1. Go to https://developer.android.com/studio
2. Download and install Android Studio
3. On first launch, it will download the Android SDK — let it finish (this takes a while)
4. Go to **Settings** (gear icon) > **Languages & Frameworks** > **Android SDK**
5. In the **SDK Platforms** tab: check **Android 14 (API 34)** or newer
6. In the **SDK Tools** tab: check **Android SDK Build-Tools**, **Android SDK Command-line Tools**, and **Android SDK Platform-Tools**
7. Click **Apply** and let it download

### Git

1. Go to https://git-scm.com/download/win
2. Download and install
3. Use all default settings during install
4. Verify:
   ```
   git --version
   ```

### Firebase CLI

Open Command Prompt and run:
```
npm install -g firebase-tools
```

Then log in:
```
firebase login
```
This opens your browser — sign in with the Google account you want to use for Firebase.

---

## 2. Clone & Install the Project

Open Command Prompt and run:
```
git clone https://github.com/RONITERVO/IdeaToSVG.git
cd IdeaToSVG
git checkout androidAppWithTokenPurchases
npm install
```

Wait for all packages to install. If you see warnings, that's normal. Errors saying `npm ERR!` need to be fixed.

---

## 3. Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Create a project"** (or "Add project")
3. Enter a project name, e.g. `sketch-ai` (the project ID will auto-generate, like `sketch-ai-abc12`)
4. **Disable** Google Analytics (you don't need it for this, but you can enable it if you want)
5. Click **Create project**
6. Wait for it to finish, then click **Continue**

---

## 4. Enable Firebase Authentication

1. In Firebase Console, click **Authentication** in the left sidebar
2. Click **Get started**
3. Click the **Sign-in method** tab
4. Click **Google**
5. Toggle the **Enable** switch to ON
6. Enter your **Project support email** (your email)
7. Click **Save**

---

## 5. Enable Firestore Database

1. In Firebase Console, click **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose a location close to your users (e.g., `us-central1` for US, `europe-west1` for Europe)
4. Select **Start in production mode**
5. Click **Create**

The security rules from `backend/firestore.rules` will be deployed later when you deploy Firebase functions.

---

## 6. Get Your Firebase Config

1. In Firebase Console, click the **gear icon** (Project settings) at the top of the left sidebar
2. Scroll down to **"Your apps"** section
3. Click the **web icon** (`</>`) to add a web app
4. Enter a nickname: `Sketch AI Web`
5. Do NOT check "Firebase Hosting"
6. Click **Register app**
7. You'll see a code block with `firebaseConfig`. Copy those values.

Now open the file `services/firebase.ts` in your project and replace the placeholder values:

```ts
const firebaseConfig = {
  apiKey: "AIzaSy...",           // paste your real apiKey
  authDomain: "sketch-ai-abc12.firebaseapp.com",
  projectId: "sketch-ai-abc12",
  storageBucket: "sketch-ai-abc12.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
};
```
---Check---
Save the file.

### Add Android app to Firebase

1. Back in Firebase Console > Project Settings > Your apps
2. Click **Add app** > click the **Android icon**
3. Package name: `com.ronitervo.ideatesvg`
4. App nickname: `Sketch AI Android`
5. Skip the SHA-1 for now (we'll add it later for Google Sign-In)
6. Click **Register app**
7. Download `google-services.json`
8. Place it in: `android/app/google-services.json`

---

## 7. Set Up Firebase Functions

### Upgrade to Blaze Plan

Firebase Functions require the **Blaze (pay-as-you-go)** plan. Don't worry — there's a free tier that covers small usage.

1. In Firebase Console, click the **Upgrade** button at the bottom of the left sidebar
2. Select **Blaze plan**
3. Add a billing account (requires a credit card)

### Install Function Dependencies

Open Command Prompt in your project folder:
```
cd backend/functions
npm install
cd ../..
```

### Set the Firebase Project ID

Open `backend/.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with your actual project ID (e.g., `sketch-ai-abc12`):

```json
{
  "projects": {
    "default": "sketch-ai-abc12"
  }
}
```

---

## 8. Deploy Firebase Backend

From the project root, run:
```
cd backend
firebase deploy
```

This deploys:
- Cloud Functions (purchase verification, token-based generation, etc.)
- Firestore security rules

Wait for it to say "Deploy complete!". Note any function URLs it prints.

Go back to the project root:
```
cd ..
```

---

## 9. Create a Google Play Developer Account

If you don't already have one:

1. Go to https://play.google.com/console/signup
2. Sign in with your Google account
3. Pay the **one-time $25 registration fee**
4. Fill in your developer profile
5. Wait for account verification (can take 48 hours for new accounts)

---

## 10. Create Your App in Play Console

1. Go to https://play.google.com/console
2. Click **"Create app"**
3. Fill in:
   - **App name**: `Sketch AI` (or your preferred name)
   - **Default language**: English
   - **App or Game**: App
   - **Free or Paid**: Free (the app is free; revenue comes from token purchases)
4. Check the declaration boxes
5. Click **Create app**

---

## 11. Create In-App Products (Token Packs)

These are the token packs users will buy. They must match the product IDs in the code.

1. In Play Console, go to your app
2. Click **Monetize** > **In-app products**
3. Click **Create product** and create these 4 products:

| Product ID | Name | Description | Price (your choice) |
|---|---|---|---|
| `token_pack_tier1` | Starter Pack | 100K tokens for AI SVG generation | e.g., $0.99 |
| `token_pack_tier2` | Popular Pack | 500K tokens for AI SVG generation | e.g., $3.99 |
| `token_pack_tier3` | Pro Pack | 2M tokens for AI SVG generation | e.g., $9.99 |
| `token_pack_tier4` | Power Pack | 10M tokens for AI SVG generation | e.g., $29.99 |

For each product:
- Set the **Product ID** exactly as shown (lowercase, underscores)
- Add a **Name** and **Description**
- Set your **price** (you decide)
- **Important**: Under "Tax and compliance category", select the appropriate option
- Set status to **Active**
- Click **Save** then **Activate**

**Note**: Products won't work until you upload at least an internal testing build. That's OK — we'll come back to this.

---

## 12. Set Up Play Developer API for Backend Verification

The backend needs to verify purchases with Google Play. This requires a service account.

### Create a Service Account

1. Go to https://console.cloud.google.com
2. Make sure the correct project is selected at the top (the same Firebase project)
3. Go to **IAM & Admin** > **Service Accounts**
4. Click **Create Service Account**
5. Name: `play-billing-verifier`
6. Click **Create and Continue**
7. Skip roles (we'll set this up in Play Console instead)
8. Click **Done**
9. Click on the service account you just created
10. Go to the **Keys** tab
11. Click **Add Key** > **Create new key** > **JSON** > **Create**
12. A `.json` file downloads — **keep this safe, do NOT share or commit it**

### Link Service Account to Play Console

1. Go to https://play.google.com/console
2. Click **Settings** (the gear icon at bottom-left) > **API access**
3. If prompted, click **Link** to link your Google Cloud project
4. Under **Service accounts**, find your `play-billing-verifier` account
5. Click **Manage Play Console permissions**
6. Grant these permissions:
   - **View app information and download bulk reports** (read-only)
   - **View financial data, orders, and cancellation survey responses**
   - **Manage orders and subscriptions**
7. Under **App permissions**, add your Sketch AI app
8. Click **Invite user** then **Send invite**

### Upload Service Account Key to Firebase

Copy the downloaded JSON key file into `backend/functions/` and rename it to `service-account.json`.

**Important**: Make sure `service-account.json` is in your `.gitignore` so it's never committed.

---

## 13. Generate a Signing Keystore

The keystore is used to sign your app. **Keep it safe — you cannot replace it once you upload to Play Store.**

Open Command Prompt in your project folder and run:
```
cd android
keytool -genkeypair -v -keystore release-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

It will ask you:
- **Keystore password**: Choose a strong password and WRITE IT DOWN
- **Key password**: Can be the same as keystore password
- **Your name, organization, etc.**: Fill in (or press Enter to skip)
- Type `yes` to confirm

This creates `android/release-keystore.jks`.

Go back to the project root:
```
cd ..
```

---

## 14. Configure Keystore Properties

Open `android/keystore.properties` and replace the placeholder values:

```properties
storeFile=release-keystore.jks
storePassword=the_password_you_chose
keyAlias=upload
keyPassword=the_password_you_chose
```

**Never commit this file to git.** It's already in `.gitignore`.

### Get SHA-1 for Firebase Google Sign-In

Run this in Command Prompt:
```
cd android
keytool -list -v -keystore release-keystore.jks -alias upload
```
Enter your keystore password. Look for the **SHA1** line and copy the fingerprint (looks like `AB:CD:EF:12:34:...`).

Now add it to Firebase:
1. Go to Firebase Console > Project Settings > Your Apps > Android app
2. Click **Add fingerprint**
3. Paste the SHA-1 fingerprint
4. Click **Save**

Also get the **debug SHA-1** (used for testing):
```
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android
```
Add this SHA-1 to Firebase too.

Go back to the project root:
```
cd ..
```

---

## 15. Get a Gemini API Key for the Server

The server uses its own Gemini API key to make requests on behalf of token-paying users.

1. Go to https://aistudio.google.com/apikey
2. Click **Create API Key**
3. Select your Google Cloud project (the same Firebase project)
4. Copy the API key (starts with `AIza...`)
5. Keep it safe

---

## 16. Set Firebase Environment Variables

The backend functions need your Gemini API key. Set it as an environment variable.

Create a file at `backend/functions/.env` with this content:
```
GEMINI_API_KEY=AIza_your_gemini_api_key_here
```

Then re-deploy functions:
```
cd backend
firebase deploy --only functions
cd ..
```

---

## 17. Build the Android App

First, build the web app for Capacitor:
```
npm run build:android
```

Then sync with the Android project:
```
npx cap sync android
```

This copies your built web files into the Android project and installs native plugins.

---

## 18. Test on a Device or Emulator

### Option A: Physical Android device (recommended for billing testing)

1. On your phone, go to **Settings > About Phone** and tap **Build Number** 7 times to enable Developer Options
2. Go to **Settings > Developer Options** and enable **USB Debugging**
3. Connect your phone via USB
4. Your phone may ask to trust the computer — tap **Allow**

### Option B: Android Emulator

1. In Android Studio, go to **Tools > Device Manager**
2. Click **Create Virtual Device**
3. Pick **Pixel 6** (or similar)
4. Select a system image with **API 34** and click **Download** if needed
5. Click **Finish**

### Run the app

Open the project in Android Studio:
```
npx cap open android
```

Wait for Gradle sync to finish (there's a progress bar at the bottom). This may take several minutes the first time.

Then click the green **Run** button (triangle icon) at the top. Select your device or emulator and click **OK**.

The app should open on the device. Test:
- API key entry works
- Token mode (Google Sign-In) works
- UI looks correct

**Note**: In-app purchases will NOT work during regular debug testing. You need to upload to Play Console and use the internal testing track first (see step 20).

---

## 19. Build the Release AAB

Make sure you've set up your keystore (steps 13-14) before this.

You can build from the command line:
```
npm run build:aab
```

Or from Android Studio:
1. Click **Build** menu > **Generate Signed Bundle / APK**
2. Select **Android App Bundle**
3. Select your keystore file, enter passwords, select `upload` alias
4. Select **release** build type
5. Click **Create**

The output file will be at:
```
android/app/build/outputs/bundle/release/app-release.aab
```

---

## 20. Upload to Play Console

### Upload to Internal Testing (recommended first step)

1. Go to https://play.google.com/console and select your app
2. Click **Testing** > **Internal testing**
3. Click **Create new release**
4. If prompted about Play App Signing, click **Continue** (let Google manage your app signing key)
5. Click **Upload** and select your `app-release.aab` file
6. Add release notes (e.g., "Initial internal test")
7. Click **Review release** then **Start rollout to Internal testing**

### Add License Testers

To test in-app purchases without real charges:

1. In Play Console, click **Settings** (gear icon) > **License testing**
2. Add the Gmail addresses of your test accounts
3. Set **License response** to `RESPOND_NORMALLY`
4. Click **Save changes**

### Add Internal Testers

1. Go to **Testing** > **Internal testing** > **Testers** tab
2. Create an email list or add individual emails
3. Share the **opt-in link** with testers (or yourself)
4. Open the link on the test device and opt in
5. After opting in, the app appears in Play Store for download

Now you can test in-app purchases using your test accounts without being charged.

---

## 21. Configure Play Store Listing

Before you can publish to production, you need to fill in the store listing.

Go to **Grow** > **Store presence** > **Main store listing**:

### Required fields

1. **App name**: `Sketch AI` (up to 30 characters)
2. **Short description**: Brief description (up to 80 characters), e.g., "Transform ideas into beautiful SVGs with AI"
3. **Full description**: Detailed description (up to 4000 characters)
4. **App icon**: 512 x 512 px, PNG or JPEG
5. **Feature graphic**: 1024 x 500 px, PNG or JPEG
6. **Screenshots**: At least 2 phone screenshots (recommended: 4-8)
   - Take screenshots from your emulator or device
   - Each between 320px and 3840px, 16:9 or 9:16 aspect ratio
7. **App category**: Tools or Productivity
8. **Contact email**: Your email

### Content Rating

1. Go to **Policy** > **App content** > **Content rating**
2. Click **Start questionnaire**
3. Answer the questions honestly (this app generates SVGs, no violence/mature content)
4. Click **Submit**

### Privacy Policy

You need a privacy policy URL. Options:
- Use a free generator like https://app-privacy-policy-generator.firebaseapp.com
- Host on GitHub Pages or your website
- Enter the URL in the Privacy policy field

### Other Requirements

Go through all items in **Policy** > **App content**:
- **Target audience**: Select 13+ (or appropriate age)
- **Data safety**: Fill in the questionnaire about what data your app collects
- **Ads declaration**: Select "No ads"
- **Government apps**: Select "Not a government app"

---

## 22. Submit for Review

Once everything is filled in:

1. Go to **Production** (or the testing track you want)
2. Click **Create new release**
3. Upload your `.aab` file (or promote from Internal testing)
4. Add release notes
5. Click **Review release**
6. Fix any warnings or errors shown
7. Click **Start rollout to Production**

Google will review your app. This usually takes a few hours to a few days.

---

## 23. After Publication

### Monitor

- Check **Play Console** > **Dashboard** for download stats
- Check **Firebase Console** > **Functions** for backend logs and errors
- Check **Firebase Console** > **Firestore** to see user balances and purchases

### Updating the App

For each update:

1. Change `versionCode` (increment by 1) and `versionName` in `android/app/build.gradle`
2. Make your code changes
3. Run `npm run build:aab` to build a new AAB
4. Upload the new AAB to Play Console
5. Submit for review

### Keeping the Web Version Working

The web version continues to work with API keys as before:
```
npm run build:web
```
This builds for web deployment (GitHub Pages, etc.).

---

## Quick Reference Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start local dev server |
| `npm run build:web` | Build for web deployment |
| `npm run build:android` | Build web assets for Android |
| `npx cap sync android` | Sync web build into Android project |
| `npx cap open android` | Open Android project in Android Studio |
| `npm run build:aab` | Full build: web + sync + signed AAB |
| `cd backend && firebase deploy` | Deploy Firebase functions + rules |

---

## Troubleshooting

### Gradle sync fails
- Make sure Android Studio has downloaded SDK 34+
- Check that `JAVA_HOME` points to JDK 17
- Try **File > Invalidate Caches** in Android Studio

### `npm run build:android` fails
- Run `npm install` again
- Check for TypeScript errors: `npx tsc --noEmit`

### Firebase deploy fails
- Make sure you're logged in: `firebase login`
- Make sure you've upgraded to Blaze plan
- Check the project ID in `backend/.firebaserc`

### In-app purchases don't work
- You must upload at least one build to Play Console first
- The app must be downloaded from Play Store (internal testing track is fine)
- Test account email must be in the License testers list
- After making changes in Play Console, wait 15-30 minutes for propagation

### Google Sign-In fails
- Make sure both debug and release SHA-1 fingerprints are in Firebase
- Re-download `google-services.json` after adding fingerprints
- Place it in `android/app/google-services.json`
- Run `npx cap sync android` again

### API key not persisting on Android
- The app uses SecureStorage (Android Keystore encryption)
- Make sure `@aparajita/capacitor-secure-storage` is installed: `npm list @aparajita/capacitor-secure-storage`
- Run `npx cap sync android` to register native plugins

---

## File Checklist

Before building, make sure these files are configured:

- [ ] `services/firebase.ts` — Real Firebase config values (not placeholders)
- [ ] `backend/.firebaserc` — Your Firebase project ID
- [ ] `backend/functions/.env` — Your server Gemini API key
- [ ] `backend/functions/service-account.json` — Google Play service account key
- [ ] `android/app/google-services.json` — Downloaded from Firebase Console
- [ ] `android/keystore.properties` — Your keystore passwords
- [ ] `android/release-keystore.jks` — Generated keystore file

**None of these should be committed to git.** They're all in `.gitignore`.

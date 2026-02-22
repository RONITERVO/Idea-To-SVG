import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyC1Y-hko36nNXRnRfafFC4NAiS92WWsEJs",
  authDomain: "ideatesvg.firebaseapp.com",
  projectId: "ideatesvg",
  storageBucket: "ideatesvg.firebasestorage.app",
  messagingSenderId: "817682651209",
  appId: "1:817682651209:web:3367429c621e50a7ae8798",
  measurementId: "G-LRG0WG1NZ7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const googleProvider = new GoogleAuthProvider();

const appCheckSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (typeof window !== 'undefined' && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

// Uncomment for local development with Firebase emulator:
// connectFunctionsEmulator(functions, "localhost", 5001);

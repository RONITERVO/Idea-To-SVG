import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  User,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { isAndroid } from "./platform";

export class AuthRedirectInProgressError extends Error {
  constructor() {
    super("Redirecting to Google Sign-In");
    this.name = "AuthRedirectInProgressError";
  }
}

// On Android WebView, popup auth is unreliable. Use redirect flow.
// On web, popup gives a smoother in-place UX.
export const signInWithGoogle = async (): Promise<User> => {
  if (isAndroid()) {
    await signInWithRedirect(auth, googleProvider);
    throw new AuthRedirectInProgressError();
  }

  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
};

export const completePendingRedirectSignIn = async (): Promise<User | null> => {
  const result = await getRedirectResult(auth);
  return result?.user || null;
};

export const signOut = async (): Promise<void> => {
  await firebaseSignOut(auth);
};

export const onAuthStateChanged = (callback: (user: User | null) => void) => {
  return firebaseOnAuthStateChanged(auth, callback);
};

export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};

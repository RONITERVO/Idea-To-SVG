import { signInWithPopup, signInWithCredential, onAuthStateChanged as firebaseOnAuthStateChanged, User, signOut as firebaseSignOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { isAndroid } from "./platform";

// On Android, we use Capacitor's Google Sign-In for a native experience
// On web, we use Firebase popup sign-in
export const signInWithGoogle = async (): Promise<User> => {
  if (isAndroid()) {
    // On Android, we'll use Capacitor Google Auth plugin
    // For now, fall back to popup (works in webview with limitations)
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } else {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  }
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

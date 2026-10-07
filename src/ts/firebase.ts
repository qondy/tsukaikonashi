import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyAW2gDleFwRQDw3R5GZyDe_yyCe34yzmu4',
  authDomain: 'tsukaikonashi.firebaseapp.com',
  projectId: 'tsukaikonashi',
  storageBucket: 'tsukaikonashi.firebasestorage.app',
  messagingSenderId: '536955109382',
  appId: '1:536955109382:web:44c489111dcd36668f8387',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

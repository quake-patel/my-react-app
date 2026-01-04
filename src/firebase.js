import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { initializeApp } from "firebase/app";
const firebaseConfig = {
  apiKey: "AIzaSyD72w8byxSClVsv5dCmeZLH4A8z2oMCHTY",
  authDomain: "employee-time-tracker-43b16.firebaseapp.com",
  projectId: "employee-time-tracker-43b16",
  storageBucket: "employee-time-tracker-43b16.firebasestorage.app",
  messagingSenderId: "950200529981",
  appId: "1:950200529981:web:a21a1207109dd6453e6654"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Enforce local persistence to keep user logged in across refreshes
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Failed to set persistence:", error);
});

export const db = getFirestore(app);
// firebase/index.js
const admin = require("firebase-admin");
const path = require("path");

let serviceAccount = null;

// Railway: Prefer environment variable
if (process.env.FIREBASE_ADMINSDK) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_ADMINSDK);
    
    // Fix newline characters in private key
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } catch (error) {
    console.error("❌ Failed to parse FIREBASE_ADMINSDK environment variable:", error.message);
    process.exit(1);
  }
} 
// Local development: Try to load from file
else {
  const possiblePaths = [
    path.join(process.cwd(), "service-account.json"),
    path.join(process.cwd(), "staffsync-23b9b-firebase-adminsdk-fbsvc-6fde4c9990.json"),
    path.join(__dirname, "..", "..", "service-account.json"),
    path.join(__dirname, "..", "..", "staffsync-23b9b-firebase-adminsdk-fbsvc-6fde4c9990.json")
  ];
  
  for (const filePath of possiblePaths) {
    try {
      if (require('fs').existsSync(filePath)) {
        serviceAccount = require(filePath);
        break;
      }
    } catch (err) {
      // Continue to next path
    }
  }
  
  if (!serviceAccount) {
    console.error("❌ No Firebase service account found!");
    console.error("Please set FIREBASE_ADMINSDK environment variable or create service-account.json");
    process.exit(1);
  }
}

// Initialize Firebase
try {
  const firebaseConfig = {
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL || "https://staffsync-23b9b.firebaseio.com",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "staffsync-23b9b.appspot.com"
  };
  
  admin.initializeApp(firebaseConfig);
  
  // Optional: Test services (can be removed in production)
  // const auth = admin.auth();
  // const bucket = admin.storage().bucket();
  // const firestore = admin.firestore();
  
} catch (error) {
  console.error("❌ Firebase initialization failed:", error.message);
  
  if (error.errorInfo) {
    console.error("Error details:", error.errorInfo);
  }
  
  // Specific guidance for common PEM issues
  if (error.message.includes('PEM formatted')) {
    console.error("\n🔧 Common fix for PEM format issues:");
    console.error("1. Ensure private_key in JSON has proper newlines (\\n)");
    console.error("2. In Railway: Paste JSON without extra quotes or escapes");
    console.error("3. In local: Use a clean service-account.json from Firebase console");
  }
  
  process.exit(1);
}

module.exports = admin;
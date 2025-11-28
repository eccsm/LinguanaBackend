# Linguana Backend - Vercel Deployment

This backend has been converted to be **fully Vercel-compatible** using serverless functions.

## 🚀 Features

- **STT (Speech-to-Text)** using OpenAI Whisper API
- **TTS (Text-to-Speech)** using OpenAI TTS API
- **Gamification System** with streak tracking and spaced repetition (SRS)
- **Firebase Integration** for user authentication and data storage
- **Serverless Architecture** - Scales automatically
- **CORS Enabled** - Works with React Native apps
- **Environment Variables** - Secure API key management

## 📁 Project Structure

```
backend/
├── api/
│   ├── health.js        # Health check endpoint
│   ├── transcribe.js    # STT endpoint (POST /transcribe)
│   ├── speak.js         # TTS endpoint (POST /speak)
│   ├── chat.js          # Chat completion endpoint
│   ├── lesson-complete.js # Lesson completion & streak tracking
│   ├── review.js        # Vocabulary review & SRS processing
│   ├── user-activity.js # User login/activity tracking
│   └── extract-vocabulary.js # AI-powered vocabulary extraction
├── services/
│   ├── gamification.js  # SRS algorithm & streak logic
│   └── vocabularyExtraction.js # OpenAI vocabulary extraction
├── utils/
│   ├── parseMultipart.js  # File upload parser for serverless
│   ├── firebaseInit.js    # Firebase Admin SDK initialization
│   └── authMiddleware.js  # Authentication & user ID extraction
├── server.js            # Legacy Express server (kept for local dev)
├── vercel.json          # Vercel configuration
└── package.json         # Updated dependencies
```

## 🛠️ Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Environment Variables

Create a `.env` file in the `backend` directory:

```env
# OpenAI API
OPENAI_API_KEY=your_openai_api_key_here

# App Security (optional)
APP_CLIENT_SECRET=your_secret_here

# Firebase Admin SDK (for gamification features)
# Option A: Use service account JSON (base64 encoded)
FIREBASE_SERVICE_ACCOUNT=base64_encoded_service_account_json

# Option B: Use individual credentials
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
```

### 3. Firebase Setup (Required for Gamification Features)

#### If you already have a Firebase project:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key** and download the JSON file

#### If you need to create a new Firebase project:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add Project** and follow the wizard
3. Enable **Firestore Database** (for user data, streaks, vocab cards)
4. Enable **Authentication** (for Firebase ID tokens)
5. Go to **Project Settings** → **Service Accounts**
6. Click **Generate New Private Key** and download the JSON file

#### Convert service account to base64 (for Vercel):

**Windows PowerShell:**
```powershell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("path\to\serviceAccountKey.json"))
```

**Mac/Linux:**
```bash
base64 -i path/to/serviceAccountKey.json
```

Then add the base64 string to your `.env` file as `FIREBASE_SERVICE_ACCOUNT`

### 4. Local Development

For local testing with Vercel CLI:

```bash
npm run dev
```

Or use the legacy Express server:

```bash
npm start
```

## 🌐 Deployment to Vercel

### Option 1: Using Vercel CLI

```bash
# Install Vercel CLI globally (if not already installed)
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod
```

### Option 2: Using Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Set the **Root Directory** to `backend`
5. Add environment variable: `OPENAI_API_KEY`
6. Click "Deploy"

## 📡 API Endpoints

Once deployed, your endpoints will be:

### Health Check
```
GET https://your-project.vercel.app/health
```

### Transcribe Audio (STT)
```
POST https://your-project.vercel.app/transcribe

Content-Type: multipart/form-data

Fields:
- audio: (file) Audio file to transcribe
- language: (string, optional) Language code (default: 'en')

Response:
{
  "text": "Transcribed text here",
  "language": "en"
}
```

### Generate Speech (TTS)
```
POST https://your-project.vercel.app/speak

Content-Type: application/json

Body:
{
  "text": "Text to convert to speech",
  "voice": "alloy" // Options: alloy, echo, fable, onyx, nova, shimmer
}

Response:
{
  "audio": "base64_encoded_audio_data"
}
```

### User Activity / Login
```
POST https://your-project.vercel.app/user-activity

Headers:
- Authorization: Bearer <firebase_id_token>
- x-client-secret: <your_client_secret> (optional)

Content-Type: application/json

Body:
{
  "userId": "user123" // Optional if using Firebase token
}

Response:
{
  "success": true,
  "message": "User activity tracked",
  "userId": "user123",
  "timestamp": "2025-11-28T14:33:05.000Z"
}

Note: This endpoint updates user streaks asynchronously
```

### Lesson Completion
```
POST https://your-project.vercel.app/lesson-complete

Headers:
- Authorization: Bearer <firebase_id_token>
- x-client-secret: <your_client_secret> (optional)

Content-Type: application/json

Body:
{
  "userId": "user123" // Optional if using Firebase token
}

Response:
{
  "success": true,
  "message": "Lesson completed successfully",
  "userId": "user123"
}

Note: This endpoint triggers streak tracking asynchronously
```

### Vocabulary Review (Spaced Repetition)
```
POST https://your-project.vercel.app/review

Headers:
- Authorization: Bearer <firebase_id_token>
- x-client-secret: <your_client_secret> (optional)

Content-Type: application/json

Body:
{
  "userId": "user123", // Optional if using Firebase token
  "reviews": [
    {
      "wordId": "hola",
      "quality": 4  // 0-5 rating (0=forgot, 5=perfect)
    },
    {
      "wordId": "adios",
      "quality": 3
    }
  ]
}

Response:
{
  "success": true,
  "message": "Reviews processed successfully",
  "userId": "user123",
  "reviewsProcessed": 2
}

Note: Uses SuperMemo-2 SRS algorithm to calculate next review dates
```

### Vocabulary Extraction (AI-Powered)
```
POST https://your-project.vercel.app/extract-vocabulary

Headers:
- Authorization: Bearer <firebase_id_token>
- x-client-secret: <your_client_secret> (optional)

Content-Type: application/json

Body:
{
  "userId": "user123", // Optional if using Firebase token
  "conversationId": "conv_12345",
  "messages": [
    {
      "role": "user",
      "content": "Hola, ¿cómo estás?"
    },
    {
      "role": "assistant",
      "content": "Estoy bien, gracias. ¿Y tú?"
    }
  ],
  "targetLanguage": "es",
  "nativeLanguage": "en"
}

Response:
{
  "success": true,
  "message": "Vocabulary extracted and added successfully",
  "userId": "user123",
  "conversationId": "conv_12345",
  "wordsAdded": 3,
  "totalWords": 5
}

Note: Uses OpenAI GPT-3.5 to intelligently extract key vocabulary from conversations and create flashcards with translations and example sentences. Automatically detects duplicate words.
```

## 🔐 Setting Environment Variables in Vercel

### Required Environment Variables:
- `OPENAI_API_KEY` - Your OpenAI API key
- `FIREBASE_SERVICE_ACCOUNT` - Base64 encoded Firebase service account JSON (recommended)
  
  **OR** individual Firebase credentials:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
  - `FIREBASE_DATABASE_URL`
- `APP_CLIENT_SECRET` - Optional secret for additional security

### Via CLI:
```bash
# Add OpenAI API Key
vercel env add OPENAI_API_KEY production

# Add Firebase credentials (Option A - Recommended)
vercel env add FIREBASE_SERVICE_ACCOUNT production
# Paste your base64 encoded service account JSON

# Or Option B - Individual credentials
vercel env add FIREBASE_PROJECT_ID production
vercel env add FIREBASE_CLIENT_EMAIL production
vercel env add FIREBASE_PRIVATE_KEY production
vercel env add FIREBASE_DATABASE_URL production

# Optional: Add client secret
vercel env add APP_CLIENT_SECRET production
```

### Via Dashboard:
1. Go to your project on Vercel
2. Click "Settings" → "Environment Variables"
3. Add each environment variable:
   - `OPENAI_API_KEY` with your OpenAI API key
   - `FIREBASE_SERVICE_ACCOUNT` with your base64 encoded service account
   - `APP_CLIENT_SECRET` with your custom secret (optional)
4. Select "Production", "Preview", and "Development" for each
5. Click "Save"

## ⚡ Key Changes from Express

1. **No Express Server** - Each endpoint is a standalone serverless function
2. **File Uploads** - Uses `busboy` instead of `multer` for Vercel compatibility
3. **Temporary Storage** - Files are stored in `/tmp` directory (automatic cleanup)
4. **CORS Handling** - Manual CORS headers in each function
5. **Cold Starts** - First request may be slower (serverless nature)

## 🧪 Testing

Test your endpoints using cURL:

```bash
# Health check
curl https://your-project.vercel.app/health

# TTS
curl -X POST https://your-project.vercel.app/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "voice": "alloy"}'

# STT
curl -X POST https://your-project.vercel.app/transcribe \
  -F "audio=@/path/to/audio.mp4" \
  -F "language=en"
```

## 📊 Monitoring

- View logs in the Vercel Dashboard under "Deployments" → "Functions"
- Set up error tracking with Vercel's built-in monitoring
- Check function execution time and invocation count

## 🔄 Migration from Old Backend

If you're migrating from the Express server:

1. Update your React Native app to use the new Vercel URL
2. Test all endpoints thoroughly
3. Remove the old backend deployment (Render/Heroku/etc)
4. Update any hardcoded URLs in your frontend

## 💰 Pricing

Vercel's Hobby plan includes:
- 100GB bandwidth/month
- 100 serverless function invocations/day
- Automatic scaling

For production apps, consider upgrading to Pro plan.

## 🆘 Troubleshooting

### File Upload Issues
- Ensure file size is under 4.5MB (Vercel limit for Hobby plan)
- Check that Content-Type is `multipart/form-data`

### API Key Not Working
- Verify environment variable is set in Vercel dashboard
- Redeploy after adding environment variables

### CORS Errors
- Check that your frontend URL is allowed
- Verify CORS headers are being sent

---

**Status:** ✅ Fully Vercel-Compatible | **Version:** 2.0.0

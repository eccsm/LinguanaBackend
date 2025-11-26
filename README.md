# Linguana Backend - Vercel Deployment

This backend has been converted to be **fully Vercel-compatible** using serverless functions.

## 🚀 Features

- **STT (Speech-to-Text)** using OpenAI Whisper API
- **TTS (Text-to-Speech)** using OpenAI TTS API
- **Serverless Architecture** - Scales automatically
- **CORS Enabled** - Works with React Native apps
- **Environment Variables** - Secure API key management

## 📁 Project Structure

```
backend/
├── api/
│   ├── health.js        # Health check endpoint
│   ├── transcribe.js    # STT endpoint (POST /transcribe)
│   └── speak.js         # TTS endpoint (POST /speak)
├── utils/
│   └── parseMultipart.js # File upload parser for serverless
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
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Local Development

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

## 🔐 Setting Environment Variables in Vercel

### Via CLI:
```bash
vercel env add OPENAI_API_KEY production
```

### Via Dashboard:
1. Go to your project on Vercel
2. Click "Settings" → "Environment Variables"
3. Add `OPENAI_API_KEY` with your OpenAI API key
4. Select "Production", "Preview", and "Development"
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

# Invoice IMAP Backend

A Railway-hosted backend for processing emails and extracting invoices via IMAP. This bypasses Supabase Edge Function CPU limits by running on a dedicated server.

## 🚀 Quick Deployment to Railway

### Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Create a new repository named `invoice-imap-backend`
3. Clone it locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/invoice-imap-backend.git
   cd invoice-imap-backend
   ```
4. Copy all these files into the repository
5. Push to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

### Step 2: Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `invoice-imap-backend` repository
5. Railway will automatically detect the Dockerfile and start building

### Step 3: Configure Environment Variables

In Railway dashboard, go to your service → **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://pioxgqdagjpmagggdyoz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key (get from Lovable Cloud settings) |
| `PORT` | `3000` |
| `ALLOWED_ORIGINS` | Your Lovable app URL (e.g., `https://your-app.lovable.app`) |

### Step 4: Get Your Railway URL

After deployment, Railway will provide a URL like:
```
https://invoice-imap-backend-production.up.railway.app
```

Copy this URL - you'll need it for the Lovable frontend.

### Step 5: Update Lovable Frontend

Add the Railway URL as a secret in Lovable:
1. Go to your Lovable project
2. Add secret: `VITE_RAILWAY_API_URL` = your Railway URL

## 📡 API Endpoints

### Start Sync
```http
POST /api/sync
Content-Type: application/json

{
  "accountId": "optional-specific-account-id",
  "dateFrom": "2024-01-01",
  "dateTo": "2024-12-31"
}
```

Response:
```json
{
  "syncLogId": "uuid",
  "status": "started",
  "message": "Sync started successfully"
}
```

### Check Sync Status
```http
GET /api/sync/:syncLogId
```

Response:
```json
{
  "id": "uuid",
  "status": "running",
  "total_accounts": 2,
  "processed_accounts": 1,
  "total_invoices": 15,
  "emails_processed_so_far": 234,
  "current_account_email": "user@example.com"
}
```

### Cancel Sync
```http
POST /api/sync/:syncLogId/cancel
```

### Health Check
```http
GET /health
```

## 🔧 Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your values

# Run in development mode
npm run dev
```

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Lovable App    │────▶│  Railway Backend │────▶│    Supabase     │
│  (Frontend)     │     │  (IMAP Worker)   │     │  (DB + Storage) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │ IMAP Server │
                        │ (Gmail, etc)│
                        └─────────────┘
```

## 📋 Features

- **No CPU Limits**: Process thousands of emails without timeout
- **Background Processing**: Non-blocking sync operations
- **Progress Tracking**: Real-time updates via database polling
- **Cancellation Support**: Stop running syncs anytime
- **Rule-Based Filtering**: Skip emails based on sender/subject rules
- **Duplicate Detection**: Avoid importing the same invoice twice
- **Invoice Link Detection**: Find download links in email bodies

## 🔒 Security Notes

- The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS - keep it secret!
- Use `ALLOWED_ORIGINS` to restrict which domains can call your API
- Consider adding API key authentication for production use

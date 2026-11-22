# 🛠️ Campus Fix - AI | Smart Issue Reporting & Operations Queue

**Campus Fix - AI** is a full-stack, AI-powered campus maintenance operations platform. It allows users to report infrastructure issues with descriptions and photos, automatically triages them using Google Gemini, prevents duplicates, and provides an admin queue with search, manual overrides, and CSV reporting.

## 🚀 Key Features
- **Multimodal AI Triage:** Uses Google Gemini (`gemini-3.8-flash` with multi-model fallback) to categorize departments, tag severity, and estimate SLAs.
- **Duplicate Detection:** Prevents clutter by upvoting existing unresolved tickets within a 6-hour window.
- **Operations Dashboard:** Real-time KPI tracking, keyword search, status workflows, and CSV export.

## NEED TO MAKE AN .env FILE IN BACKEND 
   in this past your api key link

   GEMINI_API_KEY=....
   PORT= 5000

## ⚙️ Quick Setup
1. Clone the repository and install dependencies in the backend:
   ```bash
   cd backend
   npm install
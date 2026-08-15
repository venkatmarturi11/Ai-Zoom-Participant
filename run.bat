@echo off
echo Starting Zoom Assistant Bot Locally...
echo Make sure you have created your .env file with TELEGRAM_BOT_TOKEN and DATABASE_URL!
npm install && npm run build && npm run start
pause

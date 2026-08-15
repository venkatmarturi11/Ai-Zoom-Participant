#!/bin/bash
echo "Building latest code..."
docker build -t zoom-bot .

echo "Starting Zoom Assistant Bot in the background..."
docker kill $(docker ps -q --filter ancestor=zoom-bot) 2>/dev/null || true
docker run -d --rm -p 10000:10000 --env-file .env zoom-bot
echo "✅ Bot is running! Dashboard available at Port 10000."

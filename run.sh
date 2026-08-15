#!/bin/bash
echo "Starting Zoom Assistant Bot in Docker..."
docker run --env-file .env zoom-bot

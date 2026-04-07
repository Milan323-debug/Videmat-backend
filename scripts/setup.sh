#!/bin/bash
set -e

echo "=== Installing yt-dlp to project folder ==="
mkdir -p ./bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp
./bin/yt-dlp --version
echo "yt-dlp installed successfully"

echo "=== Installing ffmpeg ==="
apt-get update -qq
apt-get install -y ffmpeg -qq
ffmpeg -version | head -n1
echo "ffmpeg installed successfully"

echo "=== Setup complete ==="
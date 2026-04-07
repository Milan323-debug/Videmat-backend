#!/bin/bash
set -e

echo "=== Installing yt-dlp ==="
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version
echo "yt-dlp installed successfully"

echo "=== Installing ffmpeg ==="
apt-get update -qq
apt-get install -y ffmpeg -qq
ffmpeg -version | head -n1
echo "ffmpeg installed successfully"

echo "=== Setup complete ==="
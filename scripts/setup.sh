#!/bin/bash
set -e

echo "=== Installing yt-dlp to project folder ==="
mkdir -p ./bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp

echo "=== Updating yt-dlp to absolute latest ==="
./bin/yt-dlp -U || true
./bin/yt-dlp --version
echo "yt-dlp installed successfully"

echo "=== Installing ffmpeg via static binary ==="
mkdir -p ./bin
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o /tmp/ffmpeg.tar.xz
tar -xf /tmp/ffmpeg.tar.xz -C /tmp/
# Find the extracted folder and copy binaries
FFMPEG_DIR=$(find /tmp -maxdepth 1 -name 'ffmpeg-*-amd64-static' -type d | head -n1)
cp "$FFMPEG_DIR/ffmpeg"  ./bin/ffmpeg
cp "$FFMPEG_DIR/ffprobe" ./bin/ffprobe
chmod a+rx ./bin/ffmpeg ./bin/ffprobe
./bin/ffmpeg -version | head -n1
echo "ffmpeg installed successfully"

echo "=== Setup complete ==="
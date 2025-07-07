#!/bin/bash

echo "🚀 Building Auction Scraper for all platforms..."

# Clean previous builds
rm -rf dist/

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build for Windows
echo "🪟 Building for Windows..."
npm run build-win

# Build for macOS (only on macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 Building for macOS..."
    npm run build-mac
fi

# Build for Linux
echo "🐧 Building for Linux..."
npm run build-linux

echo "✅ Build complete! Check the dist/ folder for installers."
echo ""
echo "📁 Generated files:"
ls -la dist/

# PowerShell build script for Windows

Write-Host "🚀 Building Auction Scraper for all platforms..." -ForegroundColor Green

# Clean previous builds
Remove-Item -Recurse -Force dist/ -ErrorAction SilentlyContinue

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install

# Build for Windows
Write-Host "🪟 Building for Windows..." -ForegroundColor Blue
npm run build-win

# Build for Linux
Write-Host "🐧 Building for Linux..." -ForegroundColor Blue
npm run build-linux

Write-Host "✅ Build complete! Check the dist/ folder for installers." -ForegroundColor Green
Write-Host ""
Write-Host "📁 Generated files:" -ForegroundColor Cyan
Get-ChildItem dist/ | Format-Table Name, Length, LastWriteTime

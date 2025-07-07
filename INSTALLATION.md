# Auction Scraper Installation Guide

## 📦 Installation Options

### Option 1: Download Pre-built Installer (Easiest)

#### Windows:
1. Download `Auction-Scraper-Setup-1.0.0.exe` from releases
2. Run the installer
3. Follow installation wizard
4. Launch from Start Menu or Desktop shortcut

#### macOS:
1. Download `Auction-Scraper-1.0.0.dmg` from releases
2. Open the DMG file
3. Drag the app to Applications folder
4. Launch from Applications or Launchpad

#### Linux:
1. Download `Auction-Scraper-1.0.0.AppImage` from releases
2. Make it executable: `chmod +x Auction-Scraper-1.0.0.AppImage`
3. Run: `./Auction-Scraper-1.0.0.AppImage`

### Option 2: Portable Version (No Installation)

#### Windows Portable:
1. Download `Auction-Scraper-1.0.0-win.zip`
2. Extract to any folder
3. Run `Auction Scraper.exe`

## 🛠️ Building from Source

### Prerequisites:
- Node.js 16+ installed
- Git installed

### Steps:
1. Clone the repository:
   \`\`\`bash
   git clone https://github.com/your-username/auction-scraper.git
   cd auction-scraper
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Build installers:
   \`\`\`bash
   # Build for current platform
   npm run build
   
   # Build for specific platforms
   npm run build-win    # Windows
   npm run build-mac    # macOS
   npm run build-linux  # Linux
   \`\`\`

4. Find installers in `dist/` folder

## 🚀 Running the Application

### Desktop Mode:
- Launch the installed application
- Use the GUI interface

### Web Mode (Advanced):
1. Open terminal/command prompt
2. Navigate to installation directory
3. Run: `npm run web`
4. Open browser to `http://localhost:3000`

## 📋 System Requirements

### Minimum:
- **OS:** Windows 10, macOS 10.14, Ubuntu 18.04
- **RAM:** 4GB
- **Storage:** 500MB free space
- **Internet:** Required for scraping

### Recommended:
- **OS:** Windows 11, macOS 12+, Ubuntu 20.04+
- **RAM:** 8GB+
- **Storage:** 1GB free space
- **Internet:** Stable broadband connection

## 🔧 Troubleshooting

### Common Issues:

#### "App can't be opened" (macOS):
1. Right-click the app
2. Select "Open"
3. Click "Open" in the dialog

#### "Windows protected your PC" (Windows):
1. Click "More info"
2. Click "Run anyway"

#### Permission denied (Linux):
\`\`\`bash
chmod +x Auction-Scraper-1.0.0.AppImage
\`\`\`

#### Browser doesn't open:
- Check if Chrome/Chromium is installed
- Try running in headless mode

## 📞 Support

For issues or questions:
- Create an issue on GitHub
- Email: support@yourcompany.com

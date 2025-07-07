const { app, BrowserWindow, ipcMain, dialog } = require("electron")
const path = require("path")
const { AuctionScraper } = require("./scraper")

let mainWindow
let scraper

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "../assets/icon.png"),
  })

  mainWindow.loadFile("src/index.html")

  // Open DevTools in development
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC handlers
ipcMain.handle("start-scraping", async (event, config) => {
  try {
    scraper = new AuctionScraper(config)

    // Set up progress callbacks
    scraper.onProgress = (progress) => {
      mainWindow.webContents.send("scraping-progress", progress)
    }

    scraper.onLog = (log) => {
      mainWindow.webContents.send("scraping-log", log)
    }

    scraper.onComplete = (result) => {
      mainWindow.webContents.send("scraping-complete", result)
    }

    scraper.onError = (error) => {
      mainWindow.webContents.send("scraping-error", error)
    }

    scraper.onWaitingForUser = () => {
      mainWindow.webContents.send("waiting-for-user-continue")
    }

    // Start the scraper in background
    scraper
      .start()
      .then((result) => {
        mainWindow.webContents.send("scraping-complete", result)
      })
      .catch((error) => {
        mainWindow.webContents.send("scraping-error", error.message)
      })

    return { success: true, message: "Scraping started" }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("user-continue", async () => {
  if (scraper && scraper.userContinue) {
    scraper.userContinue()
    return { success: true }
  }
  return { success: false, error: "No active scraping session" }
})

ipcMain.handle("stop-scraping", async () => {
  if (scraper) {
    await scraper.stop()
    return { success: true }
  }
  return { success: false, error: "No active scraping session" }
})

ipcMain.handle("select-save-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  })

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] }
  }

  return { success: false }
})

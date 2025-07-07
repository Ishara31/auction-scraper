const express = require("express")
const { AuctionScraper } = require("./scraper")
const path = require("path")
const fs = require("fs")

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

let currentScraper = null
let scrapingStatus = {
  isRunning: false,
  processedButtons: 0,
  apiCalls: 0,
  uniqueAuctions: 0,
  percentage: 0,
  logs: [],
  lastResult: null,
}

// Add log entry
function addLog(message, type = "info") {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString(),
    message,
    type,
  }
  scrapingStatus.logs.push(logEntry)

  // Keep only last 100 logs
  if (scrapingStatus.logs.length > 100) {
    scrapingStatus.logs = scrapingStatus.logs.slice(-100)
  }

  console.log(`[${type.toUpperCase()}] ${message}`)
}

// Start scraping endpoint
app.post("/api/start-scraping", async (req, res) => {
  try {
    if (currentScraper && currentScraper.isRunning) {
      return res.status(400).json({ success: false, error: "Scraping already in progress" })
    }

    const config = req.body

    // Validate save directory exists or create it
    if (!fs.existsSync(config.saveDirectory)) {
      fs.mkdirSync(config.saveDirectory, { recursive: true })
    }

    currentScraper = new AuctionScraper(config)

    // Reset status
    scrapingStatus = {
      isRunning: true,
      processedButtons: 0,
      apiCalls: 0,
      uniqueAuctions: 0,
      percentage: 0,
      logs: [],
      lastResult: null,
    }

    // Set up callbacks
    currentScraper.onProgress = (progress) => {
      scrapingStatus.processedButtons = progress.buttonsProcessed || 0
      scrapingStatus.apiCalls = progress.apiCalls || 0
      scrapingStatus.uniqueAuctions = progress.uniqueAuctions || 0
      scrapingStatus.percentage = progress.percentage || 0
    }

    currentScraper.onLog = (log) => {
      addLog(log.message, log.type)
    }

    currentScraper.onComplete = (result) => {
      scrapingStatus.isRunning = false
      scrapingStatus.lastResult = result
      addLog("✅ Scraping completed successfully!", "success")
    }

    currentScraper.onError = (error) => {
      scrapingStatus.isRunning = false
      addLog(`❌ Scraping error: ${error}`, "error")
    }

    currentScraper.onWaitingForUser = () => {
      addLog("⏳ Waiting for user to complete login and click continue...", "warning")
    }

    // Start scraping in background
    currentScraper
      .start()
      .then((result) => {
        scrapingStatus.isRunning = false
        scrapingStatus.lastResult = result
        addLog("✅ Scraping completed successfully!", "success")
      })
      .catch((error) => {
        scrapingStatus.isRunning = false
        addLog(`❌ Scraping error: ${error.message}`, "error")
      })

    addLog("🚀 Scraping started...", "info")
    res.json({ success: true, message: "Scraping started" })
  } catch (error) {
    addLog(`❌ Failed to start scraping: ${error.message}`, "error")
    res.status(500).json({ success: false, error: error.message })
  }
})

// Continue scraping (user clicked continue)
app.post("/api/continue", async (req, res) => {
  try {
    if (currentScraper && currentScraper.userContinue) {
      currentScraper.userContinue()
      addLog("✅ User continued! Starting automatic extraction...", "success")
      res.json({ success: true, message: "Continued successfully" })
    } else {
      res.status(400).json({ success: false, error: "No active scraping session" })
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Stop scraping endpoint
app.post("/api/stop-scraping", async (req, res) => {
  try {
    if (currentScraper && currentScraper.isRunning) {
      await currentScraper.stop()
      scrapingStatus.isRunning = false
      addLog("🛑 Scraping stopped by user", "warning")
      res.json({ success: true, message: "Scraping stopped" })
    } else {
      res.status(400).json({ success: false, error: "No active scraping session" })
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Status endpoint
app.get("/api/status", (req, res) => {
  res.json(scrapingStatus)
})

// Get logs endpoint
app.get("/api/logs", (req, res) => {
  res.json({ logs: scrapingStatus.logs })
})

// Download results endpoint
app.get("/api/download/:type", (req, res) => {
  const { type } = req.params

  if (!scrapingStatus.lastResult) {
    return res.status(404).json({ error: "No results available" })
  }

  let filePath
  if (type === "excel") {
    filePath = scrapingStatus.lastResult.excelPath
  } else if (type === "json") {
    filePath = scrapingStatus.lastResult.jsonPath
  } else {
    return res.status(400).json({ error: "Invalid file type" })
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath)
  } else {
    res.status(404).json({ error: "File not found" })
  }
})

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.listen(port, () => {
  console.log(`🚀 Auction Scraper Web Server running on port ${port}`)
  console.log(`📱 Access at: http://localhost:${port}`)
  console.log(`🌐 Or from other devices: http://YOUR_IP_ADDRESS:${port}`)
})

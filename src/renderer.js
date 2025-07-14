class AuctionScraperUI {
  constructor() {
    this.isScrapingActive = false
    this.isWaitingForUser = false
    this.currentCategoryIndex = 0
    this.categories = [
      "Leafy",
      "Tippy",
      "Semi Leafy",
      "Premium Flowery",
      "BOP1A",
      "Ex-estate",
      "High and Medium",
      "Off Grade",
      "Dust",
    ]
    this.initializeElements()
    this.setupEventListeners()
    this.setupIPCListeners()
  }

  initializeElements() {
    // Form elements
    this.auctionUrlInput = document.getElementById("auctionUrl")
    this.saveDirectoryInput = document.getElementById("saveDirectory")
    this.maxButtonsInput = document.getElementById("maxButtons")
    this.batchSizeInput = document.getElementById("batchSize")
    this.headlessModeCheckbox = document.getElementById("headlessMode")

    // Set default values to requested amounts
    this.maxButtonsInput.value = "2500"
    this.batchSizeInput.value = "10"

    // Control buttons
    this.startButton = document.getElementById("startScraping")
    this.stopButton = document.getElementById("stopScraping")
    this.continueButton = document.getElementById("continueButton")
    this.continueSection = document.getElementById("continueSection")
    this.selectDirectoryButton = document.getElementById("selectDirectory")

    // Status elements
    this.currentStatusSpan = document.getElementById("currentStatus")
    this.buttonsProcessedSpan = document.getElementById("buttonsProcessed")
    this.apiCallsSpan = document.getElementById("apiCalls")
    this.uniqueAuctionsSpan = document.getElementById("uniqueAuctions")
    this.progressFill = document.getElementById("progressFill")
    this.progressText = document.getElementById("progressText")

    // Log and results
    this.logContainer = document.getElementById("logContainer")
    this.resultsSection = document.getElementById("resultsSection")
    this.totalRecordsSpan = document.getElementById("totalRecords")
    this.excelFileSpan = document.getElementById("excelFile")
    this.jsonFileSpan = document.getElementById("jsonFile")
  }

  setupEventListeners() {
    this.startButton.addEventListener("click", () => this.startScraping())
    this.stopButton.addEventListener("click", () => this.stopScraping())
    this.continueButton.addEventListener("click", () => this.handleContinueClick())
    this.selectDirectoryButton.addEventListener("click", () => this.selectSaveDirectory())
  }

  setupIPCListeners() {
    window.electronAPI.onScrapingProgress((event, progress) => {
      this.updateProgress(progress)
    })

    window.electronAPI.onScrapingLog((event, log) => {
      this.addLogEntry(log)
    })

    window.electronAPI.onScrapingComplete((event, result) => {
      this.handleScrapingComplete(result)
    })

    window.electronAPI.onScrapingError((event, error) => {
      this.handleScrapingError(error)
    })

    window.electronAPI.onWaitingForUserContinue((event) => {
      this.handleWaitingForUser()
    })
  }

  async selectSaveDirectory() {
    const result = await window.electronAPI.selectSaveDirectory()
    if (result.success) {
      this.saveDirectoryInput.value = result.path
      this.addLogEntry({
        type: "info",
        message: `📁 Save directory selected: ${result.path}`,
      })
    }
  }

  async startScraping() {
    if (this.isScrapingActive) return

    // Validate inputs
    const auctionUrl = this.auctionUrlInput.value.trim()
    const saveDirectory = this.saveDirectoryInput.value.trim()

    if (!auctionUrl) {
      this.addLogEntry({ type: "error", message: "Please enter an auction URL" })
      return
    }

    if (!saveDirectory) {
      this.addLogEntry({ type: "error", message: "Please select a save directory" })
      return
    }

    // Reset category index for new scraping session
    this.currentCategoryIndex = 0

    const config = {
      auctionUrl,
      saveDirectory,
      maxButtons: Number.parseInt(this.maxButtonsInput.value) || 2500,
      batchSize: Number.parseInt(this.batchSizeInput.value) || 10,
      headless: this.headlessModeCheckbox.checked,
    }

    this.isScrapingActive = true
    this.isWaitingForUser = false

    // Show continue section for initial setup only
    this.continueSection.style.display = "block"
    this.addLogEntry({
      type: "info",
      message:
        "🌐 Browser will open shortly. Complete login, select Year/Catalogue/FIRST Auction, click SEARCH, then click Continue.",
    })
    this.addLogEntry({
      type: "info",
      message: `📋 Will process first auction manually, then automatically process remaining ${this.categories.length - 1} auctions: ${this.categories.slice(1).join(", ")}`,
    })
    this.addLogEntry({
      type: "info",
      message: `⚙️ Settings: ${config.maxButtons} max buttons, batch size ${config.batchSize}`,
    })
    this.updateScrapingState(true)
    this.addLogEntry({ type: "info", message: "Starting scraping process..." })

    try {
      const result = await window.electronAPI.startScraping(config)
      if (!result.success) {
        throw new Error(result.error)
      }
    } catch (error) {
      this.handleScrapingError(error.message)
    }
  }

  async handleContinueClick() {
    // This is only for the initial setup - after that it's fully automated
    await this.userContinue()
  }

  async userContinue() {
    this.addLogEntry({
      type: "info",
      message: `🚀 Starting automated processing of all ${this.categories.length} auctions...`,
    })

    // Update button to show it's processing
    this.continueButton.textContent = "⏳ Starting Automation..."
    this.continueButton.disabled = true

    try {
      const result = await window.electronAPI.userContinue()
      if (result.success) {
        this.isWaitingForUser = false
        this.continueSection.style.display = "none"
        this.currentStatusSpan.textContent = "Processing Auctions"
        this.currentStatusSpan.className = "status-running"
        this.addLogEntry({ type: "success", message: "✅ Automated auction processing started!" })
      }
    } catch (error) {
      this.addLogEntry({ type: "error", message: `Error starting automation: ${error.message}` })
      this.continueButton.textContent = "✅ Continue Extraction"
      this.continueButton.disabled = false
    }
  }

  handleWaitingForUser() {
    // Only show waiting for user on the very first setup
    if (this.currentCategoryIndex === 0) {
      this.isWaitingForUser = true
      this.continueSection.style.display = "block"
      this.currentStatusSpan.textContent = "Waiting for Manual Setup"
      this.currentStatusSpan.className = "status-running"

      this.continueButton.textContent = "✅ Start Automated Processing"
      this.continueButton.disabled = false

      this.addLogEntry({
        type: "success",
        message:
          "✅ Browser ready! Complete login, select Year/Catalogue/FIRST Auction, click SEARCH, then click 'Start Automated Processing'.",
      })
      this.addLogEntry({
        type: "info",
        message:
          "📋 After clicking, system will capture first auction data, then automatically switch to remaining 8 auctions.",
      })
    }
  }

  async stopScraping() {
    if (!this.isScrapingActive) return

    this.addLogEntry({ type: "warning", message: "Stopping scraping process..." })

    try {
      const result = await window.electronAPI.stopScraping()
      if (result.success) {
        this.addLogEntry({ type: "info", message: "Scraping stopped successfully" })
      }
    } catch (error) {
      this.addLogEntry({ type: "error", message: `Error stopping scraper: ${error.message}` })
    }

    this.isScrapingActive = false
    this.isWaitingForUser = false
    this.currentCategoryIndex = 0
    this.updateScrapingState(false)
  }

  updateScrapingState(isActive) {
    this.startButton.disabled = isActive
    this.stopButton.disabled = !isActive

    // Disable form inputs during scraping
    this.auctionUrlInput.disabled = isActive
    this.maxButtonsInput.disabled = isActive
    this.batchSizeInput.disabled = isActive
    this.headlessModeCheckbox.disabled = isActive
    this.saveDirectoryInput.disabled = isActive
    this.selectDirectoryButton.disabled = isActive

    // Update status
    if (!isActive) {
      this.currentStatusSpan.textContent = "Idle"
      this.currentStatusSpan.className = "status-idle"
      this.continueSection.style.display = "none"
    }
  }

  updateProgress(progress) {
    this.buttonsProcessedSpan.textContent = progress.buttonsProcessed || 0
    this.apiCallsSpan.textContent = progress.apiCalls || 0
    this.uniqueAuctionsSpan.textContent = progress.uniqueAuctions || 0

    // Update progress bar
    const percentage = progress.percentage || 0
    this.progressFill.style.width = `${percentage}%`
    this.progressText.textContent = `${Math.round(percentage)}%`
  }

  addLogEntry(log) {
    const logEntry = document.createElement("div")
    logEntry.className = `log-entry ${log.type || "info"}`

    const timestamp = document.createElement("span")
    timestamp.className = "timestamp"
    timestamp.textContent = `[${new Date().toLocaleTimeString()}]`

    const message = document.createElement("span")
    message.className = "message"
    message.textContent = log.message || log

    logEntry.appendChild(timestamp)
    logEntry.appendChild(message)

    this.logContainer.appendChild(logEntry)
    this.logContainer.scrollTop = this.logContainer.scrollHeight
  }

  handleScrapingComplete(result) {
    // Increment category index after completion
    this.currentCategoryIndex++

    const completedCategory = this.categories[this.currentCategoryIndex - 1] || "auction"
    const nextCategory = this.categories[this.currentCategoryIndex]

    this.addLogEntry({
      type: "success",
      message: `✅ Auction "${completedCategory}" completed! (${this.currentCategoryIndex}/${this.categories.length})`,
    })

    // Show results for completed category
    this.resultsSection.style.display = "block"
    this.totalRecordsSpan.textContent = result.totalRecords || 0
    this.excelFileSpan.textContent = result.excelFile || "N/A"
    this.jsonFileSpan.textContent = result.jsonFile || "N/A"

    // Update progress to 100% for current category
    this.progressFill.style.width = "100%"
    this.progressText.textContent = "100%"

    // Check if there are more categories to process
    if (this.currentCategoryIndex < this.categories.length) {
      this.addLogEntry({
        type: "info",
        message: `🔄 Automatically starting next auction: "${nextCategory}" (${this.currentCategoryIndex + 1}/${this.categories.length})`,
      })

      this.currentStatusSpan.textContent = `Processing ${nextCategory}`
      this.currentStatusSpan.className = "status-running"

      // Reset progress for next category
      setTimeout(() => {
        this.progressFill.style.width = "0%"
        this.progressText.textContent = "0%"
        this.buttonsProcessedSpan.textContent = "0"
        this.apiCallsSpan.textContent = "0"
        this.uniqueAuctionsSpan.textContent = "0"
      }, 2000)
    } else {
      // All categories completed
      this.addLogEntry({
        type: "success",
        message: "🎉 All 9 auctions completed! Scraping session finished.",
      })
      this.addLogEntry({
        type: "info",
        message: "You can now close the browser or start a new scraping session.",
      })
      this.stopScraping()
    }
  }

  handleScrapingError(error) {
    this.isScrapingActive = false
    this.isWaitingForUser = false
    this.currentCategoryIndex = 0
    this.updateScrapingState(false)

    this.currentStatusSpan.textContent = "Error"
    this.currentStatusSpan.className = "status-error"

    this.addLogEntry({ type: "error", message: `Error: ${error}` })
  }
}

// Initialize the UI when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new AuctionScraperUI()
})

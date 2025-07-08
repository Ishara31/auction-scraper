class AuctionScraperUI {
  constructor() {
    this.isScrapingActive = false
    this.isWaitingForUser = false
    this.isNextCategory = false
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

    const config = {
      auctionUrl,
      saveDirectory,
      maxButtons: Number.parseInt(this.maxButtonsInput.value) || 1000,
      batchSize: Number.parseInt(this.batchSizeInput.value) || 5,
      headless: this.headlessModeCheckbox.checked,
    }

    this.isScrapingActive = true
    this.isNextCategory = false
    // Show continue section immediately when scraping starts
    this.continueSection.style.display = "block"
    this.addLogEntry({
      type: "info",
      message: "🌐 Browser will open shortly. Complete login and search, then click Continue below.",
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
    if (this.isNextCategory) {
      // This is for starting next category
      await this.startNextCategory()
    } else {
      // This is for continuing current extraction
      await this.userContinue()
    }
  }

  async startNextCategory() {
    this.addLogEntry({ type: "info", message: "🔄 Starting next category extraction..." })

    // Update button to show it's processing
    this.continueButton.textContent = "⏳ Starting Next Category..."
    this.continueButton.disabled = true

    // Reset the next category flag
    this.isNextCategory = false

    const config = {
      auctionUrl: this.auctionUrlInput.value.trim(),
      saveDirectory: this.saveDirectoryInput.value.trim(),
      maxButtons: Number.parseInt(this.maxButtonsInput.value) || 1000,
      batchSize: Number.parseInt(this.batchSizeInput.value) || 5,
      headless: this.headlessModeCheckbox.checked,
    }

    try {
      const result = await window.electronAPI.startScraping(config)
      if (result.success) {
        this.addLogEntry({ type: "success", message: "✅ Next category extraction started!" })
      }
    } catch (error) {
      this.addLogEntry({ type: "error", message: `Error starting next category: ${error.message}` })
      this.continueButton.textContent = "✅ Continue with Next Category"
      this.continueButton.disabled = false
      this.isNextCategory = true
    }
  }

  async userContinue() {
    this.addLogEntry({ type: "info", message: "🚀 User confirmed! Starting automatic extraction..." })

    // Update button to show it's processing
    this.continueButton.textContent = "⏳ Starting..."
    this.continueButton.disabled = true

    try {
      const result = await window.electronAPI.userContinue()
      if (result.success) {
        this.isWaitingForUser = false
        this.continueSection.style.display = "none"
        this.currentStatusSpan.textContent = "Processing"
        this.currentStatusSpan.className = "status-running"
        this.addLogEntry({ type: "success", message: "✅ Automatic button clicking started!" })
      }
    } catch (error) {
      this.addLogEntry({ type: "error", message: `Error continuing: ${error.message}` })
      this.continueButton.textContent = "✅ Continue Extraction"
      this.continueButton.disabled = false
    }
  }

  handleWaitingForUser() {
    this.isWaitingForUser = true
    this.continueSection.style.display = "block"
    this.currentStatusSpan.textContent = "Waiting for User"
    this.currentStatusSpan.className = "status-running"

    // Reset continue button state
    if (this.isNextCategory) {
      this.continueButton.textContent = "✅ Continue Extraction"
    } else {
      this.continueButton.textContent = "✅ Continue Extraction"
    }
    this.continueButton.disabled = false

    this.addLogEntry({
      type: "success",
      message:
        "✅ Browser ready! Complete your category selection and search steps, then click the Continue button below.",
    })
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
    this.isNextCategory = false
    this.updateScrapingState(false)
  }

  updateScrapingState(isActive) {
    this.startButton.disabled = isActive
    this.stopButton.disabled = !isActive

    // Disable form inputs during scraping
    this.auctionUrlInput.disabled = isActive
    this.saveDirectoryInput.disabled = isActive
    this.maxButtonsInput.disabled = isActive
    this.batchSizeInput.disabled = isActive
    this.headlessModeCheckbox.disabled = isActive
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
    // Don't set isScrapingActive to false - keep it active for next category
    this.isWaitingForUser = false

    this.currentStatusSpan.textContent = "Category Complete - Ready for Next"
    this.currentStatusSpan.className = "status-complete"

    this.addLogEntry({ type: "success", message: "✅ Category scraping completed successfully!" })
    this.addLogEntry({
      type: "info",
      message: "🔄 Browser is still open. Select another category and click Continue to scrape more data.",
    })

    // Show results
    this.resultsSection.style.display = "block"
    this.totalRecordsSpan.textContent = result.totalRecords || 0
    this.excelFileSpan.textContent = result.excelFile || "N/A"
    this.jsonFileSpan.textContent = result.jsonFile || "N/A"

    // Update progress to 100%
    this.progressFill.style.width = "100%"
    this.progressText.textContent = "100%"

    // Show continue section for next category
    this.continueSection.style.display = "block"
    this.continueButton.textContent = "✅ Continue with Next Category"
    this.continueButton.disabled = false
    this.isNextCategory = true // Set flag for next category

    // Reset progress for next category after a short delay
    setTimeout(() => {
      this.progressFill.style.width = "0%"
      this.progressText.textContent = "0%"
      this.buttonsProcessedSpan.textContent = "0"
      this.apiCallsSpan.textContent = "0"
      this.uniqueAuctionsSpan.textContent = "0"
    }, 3000)
  }

  handleScrapingError(error) {
    this.isScrapingActive = false
    this.isWaitingForUser = false
    this.isNextCategory = false
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

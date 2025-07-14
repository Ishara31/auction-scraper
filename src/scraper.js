const { chromium } = require("playwright")
const fs = require("fs")
const path = require("path")
const XLSX = require("xlsx")

class AuctionScraper {
  constructor(config) {
    this.config = config
    this.browser = null
    this.page = null
    this.collectedData = []
    this.processedAuctionIds = new Map()
    this.apiCallCount = 0
    this.processedButtons = 0
    this.isRunning = false
    this.isInitialized = false
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

    // Callbacks
    this.onProgress = null
    this.onLog = null
    this.onComplete = null
    this.onError = null
    this.onWaitingForUser = null
  }

  log(message, type = "info") {
    if (this.onLog) {
      this.onLog({ type, message })
    }
    const logType = typeof type === "string" ? type.toUpperCase() : "INFO"
    console.log(`[${logType}] ${message}`)
  }

  updateProgress() {
    if (this.onProgress) {
      // Adjust max buttons for all 9 categories (9 * 2500 = 22500)
      const totalMaxButtons = this.config.maxButtons * 9
      const percentage = totalMaxButtons > 0 ? (this.processedButtons / totalMaxButtons) * 100 : 0

      this.onProgress({
        buttonsProcessed: this.processedButtons,
        apiCalls: this.apiCallCount,
        uniqueAuctions: this.processedAuctionIds.size,
        percentage: Math.min(percentage, 100),
      })
    }
  }

  // Reset state for next category without closing browser
  resetForNextCategory() {
    this.log("🔄 Resetting scraper state for next auction...")

    // Reset counters and data
    this.collectedData = []
    this.processedAuctionIds = new Map()
    this.apiCallCount = 0
    this.processedButtons = 0
    // DON'T reset this.isRunning = false here!

    // Reset user continue resolver
    this.userContinueResolver = null

    this.log("✅ Scraper state reset complete. Ready for next auction.")
  }

  // Function to debug and show page structure
  async debugPageStructure() {
    try {
      this.log("🔍 Debugging page structure...")

      // Get all select elements (traditional)
      const allSelects = await this.page.$$("select")
      this.log(`📊 Found ${allSelects.length} traditional select elements`)

      // Get Vue Select components
      const vueSelects = await this.page.$$(".vs__dropdown-toggle")
      this.log(`🎯 Found ${vueSelects.length} Vue Select components`)

      for (let i = 0; i < vueSelects.length; i++) {
        const vueSelect = vueSelects[i]

        // Get the search input
        const searchInput = await vueSelect.$("input.vs__search")
        if (searchInput) {
          const placeholder = await searchInput.getAttribute("placeholder")
          const ariaLabel = await searchInput.getAttribute("aria-labelledby")
          this.log(`🎯 Vue Select ${i + 1}: placeholder="${placeholder}" aria-label="${ariaLabel}"`)
        }

        // Check for selected values
        const selectedItems = await vueSelect.$$(".vs__selected")
        for (let j = 0; j < selectedItems.length; j++) {
          const selectedText = await selectedItems[j].textContent()
          this.log(`   Selected: "${selectedText.trim()}"`)
        }
      }

      // Get Vue Select search inputs specifically
      const searchInputs = await this.page.$$("input.vs__search")
      this.log(`🔍 Found ${searchInputs.length} Vue Select search inputs`)

      for (let i = 0; i < searchInputs.length; i++) {
        const input = searchInputs[i]
        const placeholder = await input.getAttribute("placeholder")
        const ariaLabel = await input.getAttribute("aria-labelledby")
        this.log(`🔍 Search Input ${i + 1}: placeholder="${placeholder}" aria-label="${ariaLabel}"`)
      }

      // Also check for buttons
      const allButtons = await this.page.$$("button")
      this.log(`🔘 Found ${allButtons.length} button elements`)

      // Look specifically for search button
      const searchButtons = await this.page.$$('button:has-text("Search"), span:has-text("Search")')
      this.log(`🔍 Found ${searchButtons.length} search buttons/spans`)

      for (let i = 0; i < Math.min(searchButtons.length, 3); i++) {
        const button = searchButtons[i]
        const buttonText = await button.textContent()
        const buttonTag = await button.evaluate((el) => el.tagName)
        this.log(`🔍 Search element ${i + 1}: "${buttonText}" (${buttonTag})`)
      }
    } catch (error) {
      this.log(`❌ Error debugging page structure: ${error.message}`, "error")
    }
  }

  // Function to automatically select auction category from Vue Select dropdown
  async selectAuctionCategory(categoryName) {
    try {
      this.log(`🔍 Attempting to select auction: "${categoryName}"`)

      // Wait for page to be ready
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {})

      // Debug page structure first
      await this.debugPageStructure()

      // The auction dropdown is the 3rd Vue Select (vs3__combobox) based on the logs
      const auctionDropdown = await this.page.$('.vs__dropdown-toggle:has(input[aria-labelledby="vs3__combobox"])')

      if (!auctionDropdown) {
        this.log(`❌ Could not find auction dropdown (vs3__combobox)`, "error")
        return false
      }

      this.log(`✅ Found auction dropdown (vs3__combobox)`)

      // Clear any existing selection first
      const deselectButton = await auctionDropdown.$(".vs__deselect")
      if (deselectButton) {
        this.log(`🗑️ Clearing existing selection...`)
        await deselectButton.click()
        await this.page.waitForTimeout(2000)
      }

      // Click the dropdown to open it
      await auctionDropdown.click()
      await this.page.waitForTimeout(2000)

      // Get the search input inside the dropdown
      const searchInput = await auctionDropdown.$("input.vs__search")
      if (!searchInput) {
        this.log(`❌ Could not find search input in auction dropdown`, "error")
        return false
      }

      // Clear and type the category name
      await searchInput.fill("")
      await this.page.waitForTimeout(500)
      await searchInput.type(categoryName, { delay: 100 })
      await this.page.waitForTimeout(3000)

      this.log(`🔍 Typed "${categoryName}" in auction search input`)

      // Wait for dropdown options to appear
      await this.page.waitForSelector(".vs__dropdown-menu .vs__dropdown-option", { timeout: 10000 }).catch(() => {})

      // Look for dropdown options
      const options = await this.page.$$(".vs__dropdown-menu .vs__dropdown-option")
      this.log(`   Found ${options.length} dropdown options`)

      let optionFound = false
      for (const option of options) {
        const optionText = await option.textContent()
        this.log(`   Option: "${optionText}"`)

        // Check if this option matches our category (more flexible matching)
        if (
  optionText &&
  (
    optionText.toLowerCase().includes(categoryName.toLowerCase()) ||
    optionText.includes(`- ${categoryName}`) ||
    (categoryName === "Leafy" && optionText.toLowerCase().includes("leafy")) ||
    (categoryName === "Tippy" && optionText.toLowerCase().includes("tippy")) ||
    (categoryName === "Semi Leafy" && 
      (optionText.toLowerCase().includes("semi") || optionText.toLowerCase().includes("semi leafy"))) ||
    (categoryName === "Premium Flowery" && optionText.toLowerCase().includes("premium")) ||
    (categoryName === "BOP1A" && optionText.toLowerCase().includes("bop")) ||
    (categoryName === "Ex-estate" && optionText.toLowerCase().includes("ex-estate")) ||
    (categoryName === "High and Medium" && 
      (optionText.toLowerCase().includes("high") || optionText.toLowerCase().includes("medium"))) ||
    (categoryName === "Off Grade" && optionText.toLowerCase().includes("off")) ||
    (categoryName === "Dust" && optionText.toLowerCase().includes("dust"))
  )
) {
  this.log(`✅ Found matching option: "${optionText}"`)
  await option.click()
  await this.page.waitForTimeout(3000)
  optionFound = true
  break
}

      }

      if (!optionFound) {
        this.log(`⚠️ Could not find matching option for "${categoryName}"`, "warning")
        // Close dropdown by clicking elsewhere
        await this.page.click("body")
        await this.page.waitForTimeout(1000)
        return false
      }

      this.log(`✅ Successfully selected auction: "${categoryName}"`)

      // Wait for the selection to be applied
      await this.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})

      return true
    } catch (error) {
      this.log(`❌ Error selecting auction category "${categoryName}": ${error.message}`, "error")
      return false
    }
  }

  // Function to click search button
  async clickSearchButton() {
    try {
      this.log(`🔍 Looking for search button to click...`)

      // Wait a bit before looking for search button
      await this.page.waitForTimeout(1000)

      // Use the same approach as your view button clicking
      const searchButtons = await this.page.$$('button, span, input[type="submit"]')

      let searchButtonFound = false

      for (const button of searchButtons) {
        try {
          const isVisible = await button.isVisible()
          if (!isVisible) continue

          const buttonText = await button.textContent()
          const buttonTag = await button.evaluate((el) => el.tagName)
          const buttonType = await button.evaluate((el) => el.type || el.getAttribute("type"))
          const buttonValue = await button.evaluate((el) => el.value || el.getAttribute("value"))

          // Check if this looks like a search button
          const isSearchButton =
            (buttonText && buttonText.toLowerCase().includes("search")) ||
            (buttonValue && buttonValue.toLowerCase().includes("search")) ||
            buttonType === "submit" ||
            (buttonTag === "SPAN" && buttonText && buttonText.toLowerCase().includes("search"))

          if (isSearchButton) {
            this.log(`🔍 Found potential search button: "${buttonText || buttonValue}" (${buttonTag})`)

            // Scroll into view like your view buttons
            await button.scrollIntoViewIfNeeded()
            await this.page.waitForTimeout(100)

            // Click the button
            await button.click()
            this.log(`✅ Clicked search button: "${buttonText || buttonValue}" (${buttonTag})`)

            // Wait for results to load
            await this.page.waitForTimeout(3000)
            await this.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})

            searchButtonFound = true
            break
          }
        } catch (err) {
          continue
        }
      }

      if (!searchButtonFound) {
        this.log(`⚠️ Could not find search button`, "warning")
        return false
      }

      return true
    } catch (error) {
      this.log(`❌ Error clicking search button: ${error.message}`, "error")
      return false
    }
  }

  // Function to wait for results to load after search
  async waitForSearchResults() {
    try {
      this.log(`⏳ Waiting for search results to load...`)

      // Wait for common result indicators
      const resultSelectors = [
        "table tbody tr",
        ".results-table",
        ".data-table",
        ".search-results",
        "button.btn-tbl", // The view buttons we need to click
        ".tabulator-table",
        '[role="table"]',
      ]

      let resultsFound = false

      for (const selector of resultSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 10000 })
          const elements = await this.page.$$(selector)
          if (elements.length > 0) {
            this.log(`✅ Found ${elements.length} result elements with selector: ${selector}`)
            resultsFound = true
            break
          }
        } catch (err) {
          continue
        }
      }

      if (resultsFound) {
        // Additional wait for results to fully load
        await this.page.waitForTimeout(2000)
        await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {})
        return true
      } else {
        this.log(`⚠️ No search results found`, "warning")
        return false
      }
    } catch (error) {
      this.log(`❌ Error waiting for search results: ${error.message}`, "error")
      return false
    }
  }

  // Function to save data
  saveData() {
    this.log(`📊 Preparing data export for ALL categories...`)
    this.log(`📊 Total buttons processed: ${this.processedButtons}`)
    this.log(`📊 Total API calls made: ${this.apiCallCount}`)
    this.log(`📊 Unique auction IDs captured: ${this.processedAuctionIds.size}`)

    // Clear existing collected data
    this.collectedData.length = 0

    for (const [auctionId, auctionData] of this.processedAuctionIds) {
      const record = {
        auctionId: auctionId,
        category: auctionData.category || "N/A", // Add category field
        broker: auctionData.broker || "N/A",
        lotNo: auctionData.lotNo || "N/A",
        grade: auctionData.grade || "N/A",
        sellingMark: auctionData.sellingMark || "N/A",
        buttonIndex: auctionData.buttonIndex || null,
        lastUpdated: auctionData.lastUpdated,
        responseCount: Object.keys(auctionData.responses).length,
        completeResponse: JSON.stringify(auctionData.responses),
      }

      // Calculate totals
      let totalBidders = 0
      let totalBids = 0
      let hasPagination = false

      Object.values(auctionData.responses).forEach((response) => {
        if (response.recordCount) {
          totalBids += response.recordCount
        }

        if (response.pagination) {
          hasPagination = true
          record.paginationInfo = JSON.stringify(response.pagination)
        }

        if (response.data && Array.isArray(response.data)) {
          const bidders = new Set()
          response.data.forEach((item) => {
            const bidderId = item.bidderId || item.bidder_id || item.bidderNumber || item.bidder
            if (bidderId) {
              bidders.add(bidderId)
            }
          })
          totalBidders = Math.max(totalBidders, bidders.size)
        }
      })

      record.estimatedTotalBids = totalBids
      record.estimatedUniqueBidders = totalBidders
      record.hasPaginationData = hasPagination
      record.note = auctionData.note || ""

      this.collectedData.push(record)
    }

    // Save files with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-")

    // Excel export - All categories combined
    const worksheet = XLSX.utils.json_to_sheet(this.collectedData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "AllAuctionData")
    const excelFilename = `auction_data_ALL_CATEGORIES_${timestamp}.xlsx`
    const excelPath = path.join(this.config.saveDirectory, excelFilename)
    XLSX.writeFile(workbook, excelPath)

    // Enhanced JSON export with all extracted data included
    const jsonFilename = `auction_data_ALL_CATEGORIES_${timestamp}.json`
    const jsonPath = path.join(this.config.saveDirectory, jsonFilename)

    // Group data by category for summary
    const categoryStats = {}
    this.collectedData.forEach((record) => {
      const cat = record.category
      if (!categoryStats[cat]) {
        categoryStats[cat] = 0
      }
      categoryStats[cat]++
    })

    const exportData = {
      allCategories: this.categories,
      categoryStats: categoryStats,
      summary: {
        totalApiCalls: this.apiCallCount,
        totalButtonsProcessed: this.processedButtons,
        uniqueAuctionIds: this.processedAuctionIds.size,
        exportTimestamp: new Date().toISOString(),
        recordsWithBrokerData: this.collectedData.filter((r) => r.broker !== "N/A").length,
        recordsWithLotNoData: this.collectedData.filter((r) => r.lotNo !== "N/A").length,
        recordsWithGradeData: this.collectedData.filter((r) => r.grade !== "N/A").length,
        recordsWithSellingMarkData: this.collectedData.filter((r) => r.sellingMark !== "N/A").length,
        recordsWithCategoryData: this.collectedData.filter((r) => r.category !== "N/A").length,
      },
      auctionData: Array.from(this.processedAuctionIds.entries()).map(([auctionId, auctionData]) => [
        auctionId,
        {
          auctionId: auctionData.auctionId,
          category: auctionData.category || null,
          broker: auctionData.broker || null,
          lotNo: auctionData.lotNo || null,
          grade: auctionData.grade || null,
          sellingMark: auctionData.sellingMark || null,
          buttonIndex: auctionData.buttonIndex || null,
          lastUpdated: auctionData.lastUpdated,
          note: auctionData.note || null,
          responses: auctionData.responses,
        },
      ]),
    }

    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2))

    this.log(`✅ EXPORT RESULTS for ALL CATEGORIES:`)
    this.log(`✅ Total buttons processed: ${this.processedButtons}`)
    this.log(`✅ Total API calls captured: ${this.apiCallCount}`)
    this.log(`✅ Unique auction records: ${this.collectedData.length}`)
    this.log(`✅ Category breakdown: ${JSON.stringify(categoryStats)}`)
    this.log(`✅ Excel data saved to: ${excelFilename}`)
    this.log(`✅ Raw data saved to: ${jsonFilename}`)

    const result = {
      totalRecords: this.collectedData.length,
      excelFile: excelFilename,
      jsonFile: jsonFilename,
      excelPath: excelPath,
      jsonPath: jsonPath,
      categoryStats: categoryStats,
    }

    return result
  }

  async start() {
    try {
      this.isRunning = true

      // Initialize browser only if not already initialized
      if (!this.isInitialized) {
        this.log("🚀 Initializing auction scraper...")

        this.browser = await chromium.launch({
          headless: this.config.headless,
        })

        const context = await this.browser.newContext()
        this.page = await context.newPage()

        this.setupAPIInterceptor()

        this.log("🌐 Navigating to auction page...")
        await this.page.goto(this.config.auctionUrl)

        this.isInitialized = true
      }

      this.log("👉 Please complete MANUAL SETUP, then click 'Start Automated Processing'...")
      this.log("📋 MANUAL SETUP STEPS:")
      this.log("   1. Complete the login process in the browser")
      this.log("   2. Select Year from dropdown")
      this.log("   3. Select Catalogue (Sale Number) from dropdown")
      this.log("   4. Select ALL 9 auction categories (Leafy, Tippy, Semi Leafy, etc.)")
      this.log("   5. Click SEARCH button to load data for ALL categories")
      this.log("   6. Wait for all data to load completely")
      this.log("   7. Click 'Start Automated Processing' button")
      this.log("   8. System will process ALL buttons from ALL categories automatically")
      this.log(
        `   9. Expected maximum buttons to process: ${this.config.maxButtons * 9} (${this.config.maxButtons} per category × 9 categories)`,
      )

      // Notify UI that we're waiting for user
      if (this.onWaitingForUser) {
        this.onWaitingForUser()
      }

      // Wait for user to click continue button
      await this.waitForUserContinue()

      this.log("✅ Starting automated processing of ALL auction data...")

      // Set maximum page size
      await this.setMaxPageSize()

      // Process all buttons from all categories
      await this.processAllButtons()

      // Save data for all categories
      const result = this.saveData()

      // Notify completion
      if (this.onComplete) {
        this.onComplete(result)
      }

      this.log("🎉 All auction data processed successfully!")

      return { success: true, message: "All auction data processed successfully" }
    } catch (error) {
      this.log(`❌ Error during scraping: ${error.message}`, "error")
      if (this.onError) {
        this.onError(error.message)
      }
      throw error
    }
  }

  // Process all categories automatically
  async processAllCategories() {
    for (let i = 0; i < this.categories.length; i++) {
      if (!this.isRunning) break

      this.currentCategoryIndex = i
      const currentCategory = this.categories[i]

      this.log(`🔄 Processing auction ${i + 1}/${this.categories.length}: "${currentCategory}"`)

      // For the first auction (index 0), user has already selected manually
      // For subsequent auctions, we need to select automatically
      if (i > 0) {
        this.log(`🤖 Automatically selecting auction: "${currentCategory}"`)

        // Select the auction category
        const categorySelected = await this.selectAuctionCategory(currentCategory)

        if (!categorySelected) {
          this.log(`❌ Failed to select auction "${currentCategory}". Skipping...`, "error")
          continue
        }

        // Automatically click search button
        this.log(`🤖 Automatically clicking search button...`)
        const searchClicked = await this.clickSearchButton()

        if (!searchClicked) {
          this.log(`❌ Failed to click search button for "${currentCategory}". Skipping...`, "error")
          continue
        }

        // Wait for search results to load
        this.log(`⏳ Waiting for search results for "${currentCategory}"...`)
        const resultsLoaded = await this.waitForSearchResults()

        if (!resultsLoaded) {
          this.log(`❌ No results loaded for auction "${currentCategory}". Skipping...`, "error")
          continue
        }

        this.log(`✅ Successfully loaded results for "${currentCategory}"`)
      } else {
        // For first auction, user has already done manual setup
        this.log(`👤 Using manually selected auction: "${currentCategory}"`)

        // Just wait for existing results to be ready
        await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {})
      }

      // Set maximum page size
      await this.setMaxPageSize()

      // Process all buttons for this category (using your existing method)
      this.log(`🚀 Starting to process buttons for "${currentCategory}"...`)
      await this.processAllButtons()

      // Save data for this category
      this.log(`💾 Saving data for "${currentCategory}"...`)
      const result = this.saveData()

      // Notify completion
      if (this.onComplete) {
        this.onComplete(result)
      }

      this.log(`✅ Completed processing "${currentCategory}" - ${result.totalRecords} records saved`)

      // Reset for next category (but don't reset if this is the last category)
      if (i < this.categories.length - 1) {
        this.resetForNextCategory()
        // Small delay between categories
        await this.page.waitForTimeout(3000)
      }
    }

    this.log("🎉 All auctions processed successfully!")
  }

  // Simple wait for user confirmation (only used once)
  async waitForUserContinue() {
    return new Promise((resolve) => {
      this.userContinueResolver = resolve
    })
  }

  // Method to be called when user clicks continue
  userContinue() {
    if (this.userContinueResolver) {
      this.userContinueResolver()
      this.userContinueResolver = null
    }
  }

  // Enhanced API response interceptor
  setupAPIInterceptor() {
    this.page.on("response", async (response) => {
      const url = response.url()

      const relevantEndpoints = [
        "/api/AuctionItemBid/get-all-item-history/",
        "/api/AuctionItemBid/get-item-bids/",
        "/api/AuctionItemBid/get-bidder-details/",
        "/api/AuctionItemBid/get-bid-history/",
        "/api/Bidder/get-bidder-info/",
        "/api/Auction/get-item-details/",
        "/api/reports/",
        "/api/datatable/",
        "/api/search/",
      ]
      const isRelevantEndpoint = relevantEndpoints.some((endpoint) => url.includes(endpoint))

      if (isRelevantEndpoint) {
        this.apiCallCount++
        this.log(`🔍 API Call #${this.apiCallCount}: ${url}`)

        let auctionId = null
        const urlParts = url.split("/")

        // Extract auction ID
        for (let i = urlParts.length - 1; i >= 0; i--) {
          if (urlParts[i] && /^\d+$/.test(urlParts[i])) {
            auctionId = urlParts[i]
            break
          }
        }

        if (!auctionId) {
          const urlObj = new URL(url)
          auctionId =
            urlObj.searchParams.get("auctionId") ||
            urlObj.searchParams.get("itemId") ||
            urlObj.searchParams.get("id") ||
            urlObj.searchParams.get("draw") ||
            `api_call_${this.apiCallCount}`
        }

        try {
          const json = await response.json()
          const endpoint = relevantEndpoints.find((ep) => url.includes(ep)) || "unknown"

          const recordCount = Array.isArray(json)
            ? json.length
            : json.data
              ? Array.isArray(json.data)
                ? json.data.length
                : 1
              : json.recordsTotal || json.recordsFiltered || 1

          this.log(`📊 Response for ID ${auctionId}: ${recordCount} records`)

          if (!this.processedAuctionIds.has(auctionId)) {
            this.processedAuctionIds.set(auctionId, {
              auctionId,
              responses: {},
              lastUpdated: new Date().toISOString(),
              broker: null,
              lotNo: null,
              grade: null,
              sellingMark: null,
              category: null, // Add category field
            })
          }

          const auctionData = this.processedAuctionIds.get(auctionId)
          const endpointKey = endpoint.split("/").pop() || "main"

          auctionData.responses[endpointKey] = {
            url: url,
            data: json,
            timestamp: new Date().toISOString(),
            recordCount: recordCount,
          }

          if (
            json.recordsTotal ||
            json.recordsFiltered ||
            json.totalRecords ||
            json.totalCount ||
            json.total ||
            json.draw
          ) {
            auctionData.responses[endpointKey].pagination = {
              recordsTotal: json.recordsTotal,
              recordsFiltered: json.recordsFiltered,
              totalRecords: json.totalRecords || json.totalCount || json.total,
              draw: json.draw,
              start: json.start,
              length: json.length,
              currentPage: json.currentPage || json.page || Math.floor((json.start || 0) / (json.length || 10)) + 1,
              pageSize: json.pageSize || json.limit || json.length || json.size,
            }
          }

          this.updateProgress()
        } catch (err) {
          this.log(`⚠️ Failed to parse JSON for ID ${auctionId}: ${err.message}`, "warning")
        }
      }
    })
  }

  // Enhanced function to extract all required data from table row
  async extractRowData(button) {
    try {
      const rowData = await button.evaluate((btn) => {
        const row = btn.closest("tr") || btn.closest(".tabulator-row") || btn.closest('[role="row"]')
        if (!row) {
          return { broker: null, lotNo: null, grade: null, sellingMark: null, category: null, error: "Row not found" }
        }
        let broker = null
        let lotNo = null
        let grade = null
        let sellingMark = null
        let category = null

        // Method 1: Try Tabulator structure
        const brokerCell = row.querySelector('[tabulator-field="Broker"]')
        const lotNoCell =
          row.querySelector('[tabulator-field="BrokerLotNumber"]') ||
          row.querySelector('[tabulator-field="LotNo"]') ||
          row.querySelector('[tabulator-field="Lot_No"]') ||
          row.querySelector('[tabulator-field="LotNumber"]')
        const gradeCell = row.querySelector('[tabulator-field="Grade"]')
        const sellingMarkCell =
          row.querySelector('[tabulator-field="SellingMark"]') ||
          row.querySelector('[tabulator-field="Selling_Mark"]') ||
          row.querySelector('[tabulator-field="SellingMarkName"]')
        const categoryCell =
          row.querySelector('[tabulator-field="CategoryName"]') || row.querySelector('[tabulator-field="Category"]')

        if (brokerCell) {
          broker = brokerCell.textContent?.trim() || null
        }
        if (lotNoCell) {
          lotNo = lotNoCell.textContent?.trim() || null
        }
        if (gradeCell) {
          grade = gradeCell.textContent?.trim() || null
        }
        if (sellingMarkCell) {
          sellingMark = sellingMarkCell.textContent?.trim() || null
        }
        if (categoryCell) {
          category = categoryCell.textContent?.trim() || null
        }

        // Method 2: Try standard table cells if Tabulator method didn't work
        if (!broker || !lotNo || !grade || !sellingMark || !category) {
          const cells = row.querySelectorAll("td, .tabulator-cell")

          cells.forEach((cell) => {
            const cellText = cell.textContent?.trim()
            const cellClass = cell.className?.toLowerCase() || ""
            const cellTitle = cell.getAttribute("title")?.toLowerCase() || ""
            const tabulatorField = cell.getAttribute("tabulator-field")?.toLowerCase() || ""

            if (
              !broker &&
              (cellClass.includes("broker") || cellTitle.includes("broker") || tabulatorField.includes("broker"))
            ) {
              broker = cellText
            }

            if (
              !lotNo &&
              (cellClass.includes("lot") ||
                cellTitle.includes("lot") ||
                tabulatorField.includes("lot") ||
                /^\d+$/.test(cellText))
            ) {
              lotNo = cellText
            }

            if (
              !grade &&
              (cellClass.includes("grade") ||
                cellTitle.includes("grade") ||
                tabulatorField.includes("grade") ||
                /^[A-Z]{2,6}$/.test(cellText))
            ) {
              grade = cellText
            }

            if (
              !sellingMark &&
              (cellClass.includes("selling") ||
                cellClass.includes("mark") ||
                cellTitle.includes("selling") ||
                cellTitle.includes("mark") ||
                tabulatorField.includes("selling") ||
                tabulatorField.includes("mark"))
            ) {
              sellingMark = cellText
            }

            if (
              !category &&
              (cellClass.includes("category") ||
                cellTitle.includes("category") ||
                tabulatorField.includes("category") ||
                tabulatorField === "categoryname")
            ) {
              category = cellText
            }
          })
        }

        return {
          broker: broker,
          lotNo: lotNo,
          grade: grade,
          sellingMark: sellingMark,
          category: category,
          rowHtml: row.outerHTML.substring(0, 500),
          cellCount: row.querySelectorAll("td, .tabulator-cell").length,
        }
      })
      return rowData
    } catch (err) {
      this.log(`⚠️ Error extracting row data: ${err.message}`, "warning")
      return { broker: null, lotNo: null, grade: null, sellingMark: null, category: null, error: err.message }
    }
  }

  // Enhanced page size setting
  async setMaxPageSize() {
    try {
      const pageSizeSelectors = [
        'select[name="DataTables_Table_0_length"]',
        ".dataTables_length select",
        "select.form-control",
        '[name*="length"]',
        ".page-size select",
        ".entries select",
        ".pagesize select",
        'select[name="pageSize"]',
      ]

      for (const selector of pageSizeSelectors) {
        const dropdown = await this.page.$(selector)
        if (dropdown) {
          this.log(`🔧 Found page size dropdown: ${selector}`)
          const options = await dropdown.$$("option")

          let maxValue = 0
          let maxOption = null

          for (const option of options) {
            const value = await option.getAttribute("value")
            const text = await option.textContent()

            if (value === "-1" || text.toLowerCase().includes("all")) {
              maxOption = option
              maxValue = -1
              break
            } else if (value && !isNaN(Number.parseInt(value))) {
              const numValue = Number.parseInt(value)
              if (numValue > maxValue) {
                maxValue = numValue
                maxOption = option
              }
            }
          }

          if (maxOption) {
            const value = await maxOption.getAttribute("value")
            await dropdown.selectOption(value)
            this.log(`📄 Set page size to: ${value} (${await maxOption.textContent()})`)
            await this.page
              .waitForLoadState("networkidle", { timeout: 10000 })
              .catch(() => this.log("Timeout waiting for network idle after page size change."))
            return true
          }
        }
      }
    } catch (err) {
      this.log(`⚠️ Could not set page size: ${err.message}`, "warning")
    }
    return false
  }

  // Enhanced button processing
  async processButton(button, buttonIndex) {
    if (!this.isRunning) return

    try {
      this.processedButtons++
      this.log(`🔄 Processing button ${this.processedButtons} (Button index: ${buttonIndex})`)

      this.log(`📝 Extracting row data...`)
      const rowData = await this.extractRowData(button)

      await button.scrollIntoViewIfNeeded()
      await this.page.waitForTimeout(100)

      const apiCallsBefore = this.apiCallCount

      await button.click()
      await this.page.waitForSelector("#lotHistory", { timeout: 15000 })

      await this.page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => this.log("Timeout waiting for network idle after modal open."))

      const tempRowData = {
        broker: rowData.broker,
        lotNo: rowData.lotNo,
        grade: rowData.grade,
        sellingMark: rowData.sellingMark,
        category: rowData.category, // Add category
        buttonIndex: buttonIndex,
        timestamp: new Date().toISOString(),
      }

      // Check for modal pagination and handle it
      let modalPage = 1
      const maxModalPages = 100

      while (modalPage <= maxModalPages && this.isRunning) {
        this.log(`  📄 Processing modal page ${modalPage}...`)

        await this.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {})

        const nextModalSelectors = [
          "#lotHistory .next:not(.disabled)",
          "#lotHistory .paginate_button.next:not(.disabled)",
          '#lotHistory .page-link[aria-label="Next"]:not(.disabled)',
          '#lotHistory button:has-text("Next"):not(:disabled)',
        ]

        let foundNext = false
        for (const selector of nextModalSelectors) {
          const nextBtn = await this.page.$(selector)
          if (nextBtn) {
            const isDisabled = await nextBtn.evaluate(
              (el) => el.classList.contains("disabled") || el.getAttribute("aria-disabled") === "true" || el.disabled,
            )

            if (!isDisabled) {
              this.log(`    ➡️ Clicking next page in modal...`)
              await nextBtn.click()
              await this.page
                .waitForLoadState("networkidle", { timeout: 5000 })
                .catch(() => this.log("Timeout waiting for network idle after modal next click."))
              modalPage++
              foundNext = true
              break
            }
          }
        }

        if (!foundNext) {
          this.log(`    🏁 No more pages in modal`)
          break
        }
      }

      // Close modal
      const closeSelectors = [
        "#lotHistory .close",
        "#lotHistory button.close",
        "#lotHistory .btn-close",
        "#lotHistory .modal-header .close",
        '#lotHistory button[data-dismiss="modal"]',
        '#lotHistory [data-bs-dismiss="modal"]',
      ]

      let modalClosed = false
      for (const selector of closeSelectors) {
        const closeBtn = await this.page.$(selector)
        if (closeBtn) {
          await closeBtn.click()
          await this.page
            .waitForSelector("#lotHistory", { state: "hidden", timeout: 5000 })
            .catch(() => this.log("Timeout waiting for modal to close."))
          modalClosed = true
          break
        }
      }

      if (!modalClosed) {
        this.log("⚠️ Could not find standard close button, trying Escape key.")
        await this.page.keyboard.press("Escape")
        await this.page
          .waitForSelector("#lotHistory", { state: "hidden", timeout: 3000 })
          .catch(() => this.log("Timeout waiting for modal to close after Escape."))
      }

      await this.page.waitForTimeout(200)

      const apiCallsAfter = this.apiCallCount
      this.log(`    📊 API calls made for this button: ${apiCallsAfter - apiCallsBefore}`)

      // Associate row data with the most recently updated auction records
      const recentlyUpdatedAuctions = Array.from(this.processedAuctionIds.entries()).filter(([id, data]) => {
        const updateTime = new Date(data.lastUpdated)
        const buttonClickTime = new Date(tempRowData.timestamp)
        return updateTime >= new Date(buttonClickTime.getTime() - 5000)
      })

      if (recentlyUpdatedAuctions.length > 0) {
        const [auctionId, auctionData] = recentlyUpdatedAuctions[recentlyUpdatedAuctions.length - 1]
        auctionData.broker = tempRowData.broker
        auctionData.lotNo = tempRowData.lotNo
        auctionData.grade = tempRowData.grade
        auctionData.sellingMark = tempRowData.sellingMark
        auctionData.category = tempRowData.category // Add category
        auctionData.buttonIndex = tempRowData.buttonIndex
      } else {
        const fallbackId = `button_${buttonIndex}_${Date.now()}`
        this.processedAuctionIds.set(fallbackId, {
          auctionId: fallbackId,
          broker: tempRowData.broker,
          lotNo: tempRowData.lotNo,
          grade: tempRowData.grade,
          sellingMark: tempRowData.sellingMark,
          category: tempRowData.category, // Add category
          buttonIndex: tempRowData.buttonIndex,
          responses: {},
          lastUpdated: tempRowData.timestamp,
          note: "No API response captured - row data only",
        })
      }

      await button.evaluate((btn) => btn.setAttribute("data-processed", "true"))
      this.updateProgress()
    } catch (err) {
      this.log(`⚠️ Error processing button ${this.processedButtons}: ${err.message}`, "error")

      try {
        await this.page.keyboard.press("Escape")
        await this.page.waitForTimeout(200)
        const closeButtons = await this.page.$$(
          '#lotHistory .close, #lotHistory button.close, #lotHistory .btn-close, #lotHistory [data-bs-dismiss="modal"]',
        )
        for (const btn of closeButtons) {
          if (await btn.isVisible()) {
            await btn.click()
            await this.page.waitForSelector("#lotHistory", { state: "hidden", timeout: 3000 }).catch(() => {})
            break
          }
        }
      } catch (closeErr) {
        this.log(`⚠️ Error attempting to close modal after processing error: ${closeErr.message}`, "warning")
      }
    }
  }

  // MAIN PROCESSING LOOP - Enhanced for all categories
  async processAllButtons() {
    this.log("🔧 Setting maximum page size...")
    await this.setMaxPageSize()

    this.log("🔄 Starting to process ALL View buttons from ALL categories...")
    this.log(
      `🎯 Target: Up to ${this.config.maxButtons * 9} buttons (${this.config.maxButtons} per category × 9 categories)`,
    )

    let scrollAttempts = 0
    let consecutiveNoNewButtons = 0
    const maxScrollAttempts = 5000 // Increased for more data
    const maxConsecutiveNoNewButtons = 50 // Increased for more data
    await this.page.evaluate(() => window.scrollTo(0, 0))
    await this.page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => this.log("Timeout waiting for network idle after initial scroll."))

    while (
      scrollAttempts < maxScrollAttempts &&
      consecutiveNoNewButtons < maxConsecutiveNoNewButtons &&
      this.isRunning &&
      this.processedButtons < this.config.maxButtons * 9 // Adjusted for all categories
    ) {
      this.log(`📍 Scroll attempt ${scrollAttempts + 1} - Looking for unprocessed buttons...`)

      const allButtons = await this.page.$$("button.btn-tbl")

      const unprocessedButtonInfos = await Promise.all(
        allButtons.map(async (btn, index) => {
          const isProcessed = await btn.evaluate((el) => el.getAttribute("data-processed") === "true")
          const isVisible = await btn.evaluate((el) => {
            const rect = el.getBoundingClientRect()
            return (
              rect.height > 0 &&
              rect.width > 0 &&
              rect.top >= 0 &&
              rect.left >= 0 &&
              rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
              rect.right <= (window.innerWidth || document.documentElement.clientWidth)
            )
          })
          return {
            element: btn,
            index,
            isProcessed,
            isVisible,
            text: await btn.textContent(),
          }
        }),
      )
      const currentUnprocessedButtons = unprocessedButtonInfos.filter((btn) => !btn.isProcessed && btn.isVisible)
      this.log(`🔍 Found ${currentUnprocessedButtons.length} unprocessed visible buttons`)
      let buttonsProcessedInThisIteration = 0

      const batchSize = this.config.batchSize || 10
      for (let i = 0; i < currentUnprocessedButtons.length && this.isRunning; i += batchSize) {
        const batch = currentUnprocessedButtons.slice(i, i + batchSize)

        for (const buttonInfo of batch) {
          if (!this.isRunning || this.processedButtons >= this.config.maxButtons * 9) break

          const button = allButtons[buttonInfo.index]

          if (button) {
            this.log(`🚀 Processing View button (Iteration button ${buttonInfo.index + 1})`)
            await this.processButton(button, buttonInfo.index)
            buttonsProcessedInThisIteration++
            await this.page.waitForTimeout(100)
          }
        }
        await this.page.waitForTimeout(300)
      }
      this.log(`✅ Processed ${buttonsProcessedInThisIteration} buttons in this iteration`)
      this.log(
        `📊 Total processed so far: ${this.processedButtons} buttons, ${this.processedAuctionIds.size} unique auctions`,
      )

      if (buttonsProcessedInThisIteration === 0) {
        consecutiveNoNewButtons++
        this.log(`⏸️ No new buttons processed (${consecutiveNoNewButtons}/${maxConsecutiveNoNewButtons})`)
      } else {
        consecutiveNoNewButtons = 0
      }

      const scrollResult = await this.page.evaluate(async () => {
        const beforeScroll = window.scrollY
        window.scrollBy(0, window.innerHeight * 0.9)

        const isAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50

        return {
          scrolled: window.scrollY !== beforeScroll,
          isAtBottom,
          currentScrollY: window.scrollY,
          totalHeight: document.body.scrollHeight,
          viewportHeight: window.innerHeight,
        }
      })

      await this.page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => this.log("Timeout waiting for network idle after scroll."))

      let clickedLoadMore = false
      try {
        const loadMoreSelectors = [
          'button:has-text("Load More")',
          'button:has-text("Show More")',
          ".load-more",
          ".btn-load-more",
          '[data-action="load-more"]',
          ".pagination .next",
          "a.next_page",
        ]
        for (const selector of loadMoreSelectors) {
          const loadMoreBtn = await this.page.$(selector)
          if (loadMoreBtn && (await loadMoreBtn.isVisible())) {
            await loadMoreBtn.click()
            this.log(`🔄 Clicked load more button: ${selector}`)
            await this.page
              .waitForLoadState("networkidle", { timeout: 10000 })
              .catch(() => this.log("Timeout waiting for network idle after load more click."))
            clickedLoadMore = true
            consecutiveNoNewButtons = 0
            break
          }
        }
      } catch (e) {
        this.log(`No clickable load more button found: ${e.message}`)
      }

      if (scrollResult.isAtBottom && buttonsProcessedInThisIteration === 0 && !clickedLoadMore) {
        this.log("🏁 Reached bottom of page with no new buttons to process and no load more option.")
        break
      }

      scrollAttempts++
      if (scrollAttempts % 10 === 0) {
        this.log(`🚀 Scroll Progress: ${scrollAttempts}/${maxScrollAttempts} attempts`)
        this.log(`📊 Processed: ${this.processedButtons} buttons | Unique auctions: ${this.processedAuctionIds.size}`)
        this.log(`📍 Scroll pos: ${scrollResult.currentScrollY}/${scrollResult.totalHeight}`)
      }
    }

    this.log("🏁 Finished processing all buttons from all categories")
  }

  async stop() {
    this.isRunning = false
    this.log("🛑 Stopping scraper and saving data...")

    try {
      const result = this.saveData()
      this.log("✅ Data saved successfully before stop!")
      return result
    } catch (error) {
      this.log(`❌ Error saving data: ${error.message}`, "error")
    }
  }

  async cleanup() {
    try {
      if (this.browser) {
        await this.browser.close()
        this.log("🔐 Browser closed successfully")
        this.isInitialized = false
      }
    } catch (error) {
      this.log(`⚠️ Error closing browser: ${error.message}`, "warning")
    }
  }
}

module.exports = { AuctionScraper }

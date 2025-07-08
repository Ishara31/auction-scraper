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
    this.isWaitingForNextCategory = false

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
      const percentage = this.config.maxButtons > 0 ? (this.processedButtons / this.config.maxButtons) * 100 : 0

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
    this.log("🔄 Resetting scraper state for next category...")

    // Reset counters and data
    this.collectedData = []
    this.processedAuctionIds = new Map()
    this.apiCallCount = 0
    this.processedButtons = 0
    this.isRunning = false
    this.isWaitingForNextCategory = true

    // Reset user continue resolver
    this.userContinueResolver = null

    this.log("✅ Scraper state reset complete. Ready for next category.")
  }

  // Function to save data
  saveData() {
    this.log(`📊 Preparing data export...`)
    this.log(`📊 Total buttons processed: ${this.processedButtons}`)
    this.log(`📊 Total API calls made: ${this.apiCallCount}`)
    this.log(`📊 Unique auction IDs captured: ${this.processedAuctionIds.size}`)

    // Clear existing collected data
    this.collectedData.length = 0

    for (const [auctionId, auctionData] of this.processedAuctionIds) {
      const record = {
        auctionId: auctionId,
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

    // Save files
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-")

    // Excel export
    const worksheet = XLSX.utils.json_to_sheet(this.collectedData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "AuctionData")
    const excelFilename = `complete_auction_data_${timestamp}.xlsx`
    const excelPath = path.join(this.config.saveDirectory, excelFilename)
    XLSX.writeFile(workbook, excelPath)

    // Enhanced JSON export with all extracted data included
    const jsonFilename = `raw_auction_data_${timestamp}.json`
    const jsonPath = path.join(this.config.saveDirectory, jsonFilename)
    const exportData = {
      summary: {
        totalApiCalls: this.apiCallCount,
        totalButtonsProcessed: this.processedButtons,
        uniqueAuctionIds: this.processedAuctionIds.size,
        exportTimestamp: new Date().toISOString(),
        recordsWithBrokerData: this.collectedData.filter((r) => r.broker !== "N/A").length,
        recordsWithLotNoData: this.collectedData.filter((r) => r.lotNo !== "N/A").length,
        recordsWithGradeData: this.collectedData.filter((r) => r.grade !== "N/A").length,
        recordsWithSellingMarkData: this.collectedData.filter((r) => r.sellingMark !== "N/A").length,
      },
      auctionData: Array.from(this.processedAuctionIds.entries()).map(([auctionId, auctionData]) => [
        auctionId,
        {
          auctionId: auctionData.auctionId,
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

    this.log(`✅ EXPORT RESULTS:`)
    this.log(`✅ Total buttons processed: ${this.processedButtons}`)
    this.log(`✅ Total API calls captured: ${this.apiCallCount}`)
    this.log(`✅ Unique auction records: ${this.collectedData.length}`)
    this.log(`✅ Records with Broker data: ${this.collectedData.filter((r) => r.broker !== "N/A").length}`)
    this.log(`✅ Records with Lot No data: ${this.collectedData.filter((r) => r.lotNo !== "N/A").length}`)
    this.log(`✅ Records with Grade data: ${this.collectedData.filter((r) => r.grade !== "N/A").length}`)
    this.log(`✅ Records with Selling Mark data: ${this.collectedData.filter((r) => r.sellingMark !== "N/A").length}`)
    this.log(`✅ Excel data saved to: ${excelFilename}`)
    this.log(`✅ Raw data saved to: ${jsonFilename}`)

    const result = {
      totalRecords: this.collectedData.length,
      excelFile: excelFilename,
      jsonFile: jsonFilename,
      excelPath: excelPath,
      jsonPath: jsonPath,
    }

    if (this.collectedData.length < this.processedButtons) {
      this.log(
        `⚠️  ANALYSIS: Captured ${this.collectedData.length} records from ${this.processedButtons} buttons`,
        "warning",
      )
      this.log(`⚠️  This could indicate:`, "warning")
      this.log(`   - Some buttons don't trigger API calls`, "warning")
      this.log(`   - API responses are being filtered or combined`, "warning")
      this.log(`   - The auction IDs are being extracted incorrectly`, "warning")
      this.log(`   - Check the raw JSON file for detailed analysis`, "warning")
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
      } else {
        this.log("🔄 Using existing browser session...")
      }

      // Different messages for first time vs next category
      if (this.isWaitingForNextCategory) {
        this.log("👉 Please select your next category and click 'Continue' button to proceed...")
        this.log("📋 STEPS TO FOLLOW:")
        this.log("   1. Select Year from dropdown (if needed)")
        this.log("   2. Select Catalogue from dropdown (if needed)")
        this.log("   3. Select Auction from dropdown (if needed)")
        this.log("   4. Click the Search button")
        this.log("   5. Wait for results to appear")
        this.log("   6. Click the 'Continue Extraction' button in the application")
      } else {
        this.log("👉 Please complete login and select your category, then click 'Continue' button to proceed...")
        this.log("📋 STEPS TO FOLLOW:")
        this.log("   1. Complete the login process in the browser")
        this.log("   2. Select Year from dropdown")
        this.log("   3. Select Catalogue from dropdown")
        this.log("   4. Select Auction from dropdown")
        this.log("   5. Click the Search button")
        this.log("   6. Wait for results to appear")
        this.log("   7. Click the 'Continue Extraction' button in the application")
      }

      this.log("💡 You can stop the script anytime with the Stop button and data will be saved automatically!")

      // Notify UI that we're waiting for user
      if (this.onWaitingForUser) {
        this.onWaitingForUser()
      }

      // Wait for user to click continue button
      await this.waitForUserContinue()

      this.log("✅ User confirmed! Starting data extraction...")

      // Set maximum page size
      await this.setMaxPageSize()

      // Start processing buttons
      await this.processAllButtons()

      // Save data
      const result = this.saveData()

      // Reset state for next category but keep browser open
      this.resetForNextCategory()

      if (this.onComplete) {
        this.onComplete(result)
      }

      return result
    } catch (error) {
      this.log(`❌ Error during scraping: ${error.message}`, "error")
      if (this.onError) {
        this.onError(error.message)
      }
      throw error
    }
  }

  // Method to start next category - called when user clicks continue for next category
  async startNextCategory() {
    try {
      this.log("🔄 Starting next category extraction...")

      // Reset the waiting flag and start running
      this.isWaitingForNextCategory = false
      this.isRunning = true

      // Notify UI that we're waiting for user to select category
      if (this.onWaitingForUser) {
        this.onWaitingForUser()
      }

      // Wait for user to click continue button
      await this.waitForUserContinue()

      this.log("✅ User confirmed! Starting data extraction for next category...")

      // Set maximum page size
      await this.setMaxPageSize()

      // Start processing buttons
      await this.processAllButtons()

      // Save data
      const result = this.saveData()

      // Reset state for next category but keep browser open
      this.resetForNextCategory()

      if (this.onComplete) {
        this.onComplete(result)
      }

      return result
    } catch (error) {
      this.log(`❌ Error during next category scraping: ${error.message}`, "error")
      if (this.onError) {
        this.onError(error.message)
      }
      throw error
    }
  }

  // Simple wait for user confirmation
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

          if (json.recordsTotal || json.recordsFiltered || json.totalRecords || json.draw) {
            this.log(
              `📄 Pagination detected - Total: ${json.recordsTotal || json.totalRecords}, Filtered: ${json.recordsFiltered}, Draw: ${json.draw}`,
            )
          }

          if (!this.processedAuctionIds.has(auctionId)) {
            this.processedAuctionIds.set(auctionId, {
              auctionId,
              responses: {},
              lastUpdated: new Date().toISOString(),
              broker: null,
              lotNo: null,
              grade: null,
              sellingMark: null,
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
          return { broker: null, lotNo: null, grade: null, sellingMark: null, error: "Row not found" }
        }
        let broker = null
        let lotNo = null
        let grade = null
        let sellingMark = null

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

        // Method 2: Try standard table cells if Tabulator method didn't work
        if (!broker || !lotNo || !grade || !sellingMark) {
          const cells = row.querySelectorAll("td")

          cells.forEach((cell) => {
            const cellText = cell.textContent?.trim()
            const cellClass = cell.className?.toLowerCase() || ""
            const cellTitle = cell.getAttribute("title")?.toLowerCase() || ""

            if (!broker && (cellClass.includes("broker") || cellTitle.includes("broker"))) {
              broker = cellText
            }

            if (!lotNo && (cellClass.includes("lot") || cellTitle.includes("lot") || /^\d+$/.test(cellText))) {
              lotNo = cellText
            }

            if (
              !grade &&
              (cellClass.includes("grade") || cellTitle.includes("grade") || /^[A-Z]{2,6}$/.test(cellText))
            ) {
              grade = cellText
            }

            if (
              !sellingMark &&
              (cellClass.includes("selling") ||
                cellClass.includes("mark") ||
                cellTitle.includes("selling") ||
                cellTitle.includes("mark"))
            ) {
              sellingMark = cellText
            }
          })
        }

        // Method 3: Column position based extraction (fallback)
        if (!broker || !lotNo || !grade || !sellingMark) {
          const allCells = Array.from(row.querySelectorAll("td, .tabulator-cell"))
          const table = row.closest("table") || row.closest(".tabulator")
          if (table) {
            const headers = Array.from(table.querySelectorAll("th, .tabulator-col-title"))

            headers.forEach((header, index) => {
              const headerText = header.textContent?.toLowerCase().trim()

              if (headerText?.includes("broker") && allCells[index]) {
                broker = allCells[index].textContent?.trim() || null
              }

              if (
                ((headerText?.includes("lot") && headerText?.includes("no")) ||
                  headerText === "lot no" ||
                  headerText === "lotno" ||
                  headerText === "lot number") &&
                allCells[index]
              ) {
                lotNo = allCells[index].textContent?.trim() || null
              }
              if (headerText?.includes("grade") && allCells[index]) {
                grade = allCells[index].textContent?.trim() || null
              }
              if (
                ((headerText?.includes("selling") && headerText?.includes("mark")) ||
                  headerText === "selling mark" ||
                  headerText === "sellingmark") &&
                allCells[index]
              ) {
                sellingMark = allCells[index].textContent?.trim() || null
              }
            })
          }
        }

        return {
          broker: broker,
          lotNo: lotNo,
          grade: grade,
          sellingMark: sellingMark,
          rowHtml: row.outerHTML.substring(0, 500),
          cellCount: row.querySelectorAll("td, .tabulator-cell").length,
        }
      })
      return rowData
    } catch (err) {
      this.log(`⚠️ Error extracting row data: ${err.message}`, "warning")
      return { broker: null, lotNo: null, grade: null, sellingMark: null, error: err.message }
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
      this.log(`📊 Row data extracted: ${JSON.stringify(rowData)}`, "info")

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
        auctionData.buttonIndex = tempRowData.buttonIndex

        this.log(`    📝 Associated data with auction ${auctionId}:`)
        this.log(`       Broker: ${tempRowData.broker}`)
        this.log(`       LotNo: ${tempRowData.lotNo}`)
        this.log(`       Grade: ${tempRowData.grade}`)
        this.log(`       SellingMark: ${tempRowData.sellingMark}`)
      } else {
        const fallbackId = `button_${buttonIndex}_${Date.now()}`
        this.processedAuctionIds.set(fallbackId, {
          auctionId: fallbackId,
          broker: tempRowData.broker,
          lotNo: tempRowData.lotNo,
          grade: tempRowData.grade,
          sellingMark: tempRowData.sellingMark,
          buttonIndex: tempRowData.buttonIndex,
          responses: {},
          lastUpdated: tempRowData.timestamp,
          note: "No API response captured - row data only",
        })

        this.log(`    📝 Created fallback record: ${fallbackId}`)
        this.log(`       Broker: ${tempRowData.broker}`)
        this.log(`       LotNo: ${tempRowData.lotNo}`)
        this.log(`       Grade: ${tempRowData.grade}`)
        this.log(`       SellingMark: ${tempRowData.sellingMark}`)
      }

      await button.evaluate((btn) => (btn.dataset.processed = "true"))
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
        this.log(`❌ Error attempting to close modal after processing error: ${closeErr.message}`, "error")
      }
    }
  }

  // MAIN PROCESSING LOOP
  async processAllButtons() {
    this.log("🔧 Setting maximum page size...")
    await this.setMaxPageSize()

    this.log("🔄 Starting to process ALL View buttons with dynamic discovery...")

    let scrollAttempts = 0
    let consecutiveNoNewButtons = 0
    const maxScrollAttempts = 2000
    const maxConsecutiveNoNewButtons = 30
    await this.page.evaluate(() => window.scrollTo(0, 0))
    await this.page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => this.log("Timeout waiting for network idle after initial scroll."))

    while (
      scrollAttempts < maxScrollAttempts &&
      consecutiveNoNewButtons < maxConsecutiveNoNewButtons &&
      this.isRunning &&
      this.processedButtons < this.config.maxButtons
    ) {
      this.log(`📍 Scroll attempt ${scrollAttempts + 1} - Looking for unprocessed buttons...`)

      const allButtons = await this.page.$$("button.btn-tbl")

      const unprocessedButtonInfos = await Promise.all(
        allButtons.map(async (btn, index) => {
          const isProcessed = await btn.evaluate((el) => el.dataset.processed === "true")
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

      const batchSize = this.config.batchSize || 5
      for (let i = 0; i < currentUnprocessedButtons.length && this.isRunning; i += batchSize) {
        const batch = currentUnprocessedButtons.slice(i, i + batchSize)

        for (const buttonInfo of batch) {
          if (!this.isRunning || this.processedButtons >= this.config.maxButtons) break

          const button = allButtons[buttonInfo.index]

          if (button) {
            this.log(`🚀 Processing View button (Iteration button ${buttonInfo.index + 1})`)
            this.log(`📍 Button info: ${buttonInfo.text}`)
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

    this.log("🏁 Finished processing all buttons")
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

    this.resetForNextCategory()
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

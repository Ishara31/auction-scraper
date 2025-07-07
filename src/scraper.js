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

  // Function to save data - EXACT copy from your original code
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
      this.log("🚀 Initializing auction scraper...")

      this.browser = await chromium.launch({
        headless: this.config.headless,
      })

      const context = await this.browser.newContext()
      this.page = await context.newPage()

      this.setupAPIInterceptor()

      this.log("🌐 Navigating to auction page...")
      await this.page.goto(this.config.auctionUrl)

      // EXACT same approach as your original script
      this.log("👉 Please log in manually and click 'Continue' button to proceed...")
      this.log("📋 STEPS TO FOLLOW:")
      this.log("   1. Complete the login process in the browser")
      this.log("   2. Select Year from dropdown")
      this.log("   3. Select Catalogue from dropdown")
      this.log("   4. Select Auction from dropdown")
      this.log("   5. Click the Search button")
      this.log("   6. Wait for results to appear")
      this.log("   7. Click the 'Continue Extraction' button in the application")
      this.log("💡 You can stop the script anytime with the Stop button and data will be saved automatically!")

      // Notify UI that we're waiting for user
      if (this.onWaitingForUser) {
        this.onWaitingForUser()
      }

      // Wait for user to click continue button
      await this.waitForUserContinue()

      this.log("✅ User confirmed! Starting data extraction...")

      // Set maximum page size - EXACT copy from your original code
      await this.setMaxPageSize()

      // Start processing buttons - EXACT copy from your original code
      await this.processAllButtons()

      // Save data
      const result = this.saveData()

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
    } finally {
      await this.cleanup()
    }
  }

  // Simple wait for user confirmation - same as your original script
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

  // Enhanced API response interceptor - EXACT copy from your original code
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
        "/api/reports/", // Often pagination APIs are under reports
        "/api/datatable/", // DataTables API
        "/api/search/", // Search/filter APIs
      ]
      const isRelevantEndpoint = relevantEndpoints.some((endpoint) => url.includes(endpoint))

      if (isRelevantEndpoint) {
        this.apiCallCount++ // Increment only for relevant API calls
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
            urlObj.searchParams.get("draw") || // DataTables draw parameter
            `api_call_${this.apiCallCount}` // Fallback identifier
        }

        try {
          const json = await response.json()
          const endpoint = relevantEndpoints.find((ep) => url.includes(ep)) || "unknown"

          // Log response details
          const recordCount = Array.isArray(json)
            ? json.length
            : json.data
              ? Array.isArray(json.data)
                ? json.data.length
                : 1
              : json.recordsTotal || json.recordsFiltered || 1

          this.log(`📊 Response for ID ${auctionId}: ${recordCount} records`)

          // Check for pagination indicators
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

          // Enhanced pagination detection
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

  // Enhanced function to extract all required data from table row - EXACT copy from your original code
  async extractRowData(button) {
    try {
      const rowData = await button.evaluate((btn) => {
        // Find the parent row (could be tr or tabulator row)
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

          // Look for cells that might contain our data
          cells.forEach((cell) => {
            const cellText = cell.textContent?.trim()
            const cellClass = cell.className?.toLowerCase() || ""
            const cellTitle = cell.getAttribute("title")?.toLowerCase() || ""

            // Try to identify broker cell
            if (!broker && (cellClass.includes("broker") || cellTitle.includes("broker"))) {
              broker = cellText
            }

            // Try to identify lot number cell
            if (!lotNo && (cellClass.includes("lot") || cellTitle.includes("lot") || /^\d+$/.test(cellText))) {
              lotNo = cellText
            }
            // Try to identify grade cell
            if (
              !grade &&
              (cellClass.includes("grade") || cellTitle.includes("grade") || /^[A-Z]{2,6}$/.test(cellText))
            ) {
              grade = cellText
            }
            // Try to identify selling mark cell
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

          // Look for column headers to determine positions
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
          rowHtml: row.outerHTML.substring(0, 500), // First 500 chars for debugging
          cellCount: row.querySelectorAll("td, .tabulator-cell").length,
        }
      })
      return rowData
    } catch (err) {
      this.log(`⚠️ Error extracting row data: ${err.message}`, "warning")
      return { broker: null, lotNo: null, grade: null, sellingMark: null, error: err.message }
    }
  }

  // Enhanced page size setting - EXACT copy from your original code
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

          // Try to find the largest page size option
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
            // Wait for network to be idle after changing page size, more reliable than fixed timeout
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

  // Enhanced button processing - EXACT copy from your original code
  async processButton(button, buttonIndex) {
    if (!this.isRunning) return

    try {
      this.processedButtons++
      this.log(`🔄 Processing button ${this.processedButtons} (Button index: ${buttonIndex})`)

      // First, extract all data from the row
      this.log(`📝 Extracting row data...`)
      const rowData = await this.extractRowData(button)
      this.log(`📊 Row data extracted: ${JSON.stringify(rowData)}`, "info")

      await button.scrollIntoViewIfNeeded()
      await this.page.waitForTimeout(100) // Reduced wait

      // Track API calls before clicking
      const apiCallsBefore = this.apiCallCount

      await button.click()
      // Wait for modal to appear, increased timeout for robustness
      await this.page.waitForSelector("#lotHistory", { timeout: 15000 })

      // Wait for initial API calls related to modal content to complete
      await this.page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => this.log("Timeout waiting for network idle after modal open."))

      // Update auction data with all extracted information
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
      const maxModalPages = 100 // Max pages for modal, can be adjusted

      while (modalPage <= maxModalPages && this.isRunning) {
        this.log(`  📄 Processing modal page ${modalPage}...`)

        // Wait for network to be idle after potential modal page load
        await this.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {})

        // Look for next page in modal
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
              // Wait for network to be idle after clicking next page
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
        '#lotHistory [data-bs-dismiss="modal"]', // Bootstrap 5
      ]

      let modalClosed = false
      for (const selector of closeSelectors) {
        const closeBtn = await this.page.$(selector)
        if (closeBtn) {
          await closeBtn.click()
          // Wait for modal to disappear
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
      // Small wait after closing modal to ensure page is stable
      await this.page.waitForTimeout(200)

      const apiCallsAfter = this.apiCallCount
      this.log(`    📊 API calls made for this button: ${apiCallsAfter - apiCallsBefore}`)

      // Associate row data with the most recently updated auction records
      // Find auction records that were updated during this button click
      const recentlyUpdatedAuctions = Array.from(this.processedAuctionIds.entries()).filter(([id, data]) => {
        const updateTime = new Date(data.lastUpdated)
        const buttonClickTime = new Date(tempRowData.timestamp)
        // Allow a slightly larger window for API responses to be captured
        return updateTime >= new Date(buttonClickTime.getTime() - 5000) // Within 5 seconds
      })

      // Update the most recent auction record with all extracted data
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
        // If no auction ID was captured, create a record with the row data
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

      // Mark button as processed
      await button.evaluate((btn) => (btn.dataset.processed = "true"))
      this.updateProgress()
    } catch (err) {
      this.log(`⚠️ Error processing button ${this.processedButtons}: ${err.message}`, "error")

      // Attempt to close modal if an error occurred during processing
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

  // MAIN PROCESSING LOOP - EXACT copy from your original code
  async processAllButtons() {
    this.log("🔧 Setting maximum page size...")
    await this.setMaxPageSize()

    this.log("🔄 Starting to process ALL View buttons with dynamic discovery...")

    let scrollAttempts = 0
    let consecutiveNoNewButtons = 0
    const maxScrollAttempts = 2000 // Increased significantly for very long pages
    const maxConsecutiveNoNewButtons = 30 // Increased threshold
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

      // Get all buttons, including those that might have just loaded
      const allButtons = await this.page.$$("button.btn-tbl")

      // Filter for unprocessed and visible buttons
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
          }) // More strict visibility check
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

      // Process buttons in batches for better performance
      const batchSize = this.config.batchSize || 5 // Process 5 buttons at a time
      for (let i = 0; i < currentUnprocessedButtons.length && this.isRunning; i += batchSize) {
        const batch = currentUnprocessedButtons.slice(i, i + batchSize)

        for (const buttonInfo of batch) {
          if (!this.isRunning || this.processedButtons >= this.config.maxButtons) break

          // Re-select the button to ensure it's still valid after potential DOM changes
          const button = allButtons[buttonInfo.index] // Use the original element handle

          if (button) {
            this.log(`🚀 Processing View button (Iteration button ${buttonInfo.index + 1})`)
            this.log(`📍 Button info: ${buttonInfo.text}`)
            await this.processButton(button, buttonInfo.index)
            buttonsProcessedInThisIteration++
            // Minimal delay between buttons in a batch
            await this.page.waitForTimeout(100)
          }
        }
        // Small delay between batches
        await this.page.waitForTimeout(300)
      }
      this.log(`✅ Processed ${buttonsProcessedInThisIteration} buttons in this iteration`)
      this.log(
        `📊 Total processed so far: ${this.processedButtons} buttons, ${this.processedAuctionIds.size} unique auctions`,
      )
      // Check for progress
      if (buttonsProcessedInThisIteration === 0) {
        consecutiveNoNewButtons++
        this.log(`⏸️ No new buttons processed (${consecutiveNoNewButtons}/${maxConsecutiveNoNewButtons})`)
      } else {
        consecutiveNoNewButtons = 0 // Reset if new buttons were processed
      }

      // Scroll down to load more buttons
      const scrollResult = await this.page.evaluate(async () => {
        const beforeScroll = window.scrollY
        window.scrollBy(0, window.innerHeight * 0.9) // Scroll almost a full viewport

        // Check if we're at the bottom
        const isAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50 // Reduced threshold

        return {
          scrolled: window.scrollY !== beforeScroll,
          isAtBottom,
          currentScrollY: window.scrollY,
          totalHeight: document.body.scrollHeight,
          viewportHeight: window.innerHeight,
        }
      })
      // Wait for network to be idle after scrolling to allow new content to load
      await this.page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => this.log("Timeout waiting for network idle after scroll."))

      // Try to trigger any "Load More" buttons
      let clickedLoadMore = false
      try {
        const loadMoreSelectors = [
          'button:has-text("Load More")',
          'button:has-text("Show More")',
          ".load-more",
          ".btn-load-more",
          '[data-action="load-more"]',
          ".pagination .next",
          "a.next_page", // Common for pagination links
        ]
        for (const selector of loadMoreSelectors) {
          const loadMoreBtn = await this.page.$(selector)
          if (loadMoreBtn && (await loadMoreBtn.isVisible())) {
            await loadMoreBtn.click()
            this.log(`🔄 Clicked load more button: ${selector}`)
            // Wait for network to be idle after clicking load more
            await this.page
              .waitForLoadState("networkidle", { timeout: 10000 })
              .catch(() => this.log("Timeout waiting for network idle after load more click."))
            clickedLoadMore = true // Reset if load more button was clicked
            consecutiveNoNewButtons = 0 // Reset if load more button was clicked
            break
          }
        }
      } catch (e) {
        // No load more button found or clickable
        this.log(`No clickable load more button found: ${e.message}`)
      }

      // Break if we've reached the bottom and no new buttons are being processed, and no load more button was clicked
      if (scrollResult.isAtBottom && buttonsProcessedInThisIteration === 0 && !clickedLoadMore) {
        this.log("🏁 Reached bottom of page with no new buttons to process and no load more option.")
        break
      }

      scrollAttempts++
      // Progress reporting every 10 attempts
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

    // Save data before cleanup
    try {
      const result = this.saveData()
      this.log("✅ Data saved successfully before stop!")
      return result
    } catch (error) {
      this.log(`❌ Error saving data: ${error.message}`, "error")
    }

    await this.cleanup()
  }

  async cleanup() {
    try {
      if (this.browser) {
        await this.browser.close()
        this.log("🔐 Browser closed successfully")
      }
    } catch (error) {
      this.log(`⚠️ Error closing browser: ${error.message}`, "warning")
    }
  }
}

module.exports = { AuctionScraper }

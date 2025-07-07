const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  startScraping: (config) => ipcRenderer.invoke("start-scraping", config),
  stopScraping: () => ipcRenderer.invoke("stop-scraping"),
  userContinue: () => ipcRenderer.invoke("user-continue"),
  selectSaveDirectory: () => ipcRenderer.invoke("select-save-directory"),

  // Event listeners
  onScrapingProgress: (callback) => ipcRenderer.on("scraping-progress", callback),
  onScrapingLog: (callback) => ipcRenderer.on("scraping-log", callback),
  onScrapingComplete: (callback) => ipcRenderer.on("scraping-complete", callback),
  onScrapingError: (callback) => ipcRenderer.on("scraping-error", callback),
  onWaitingForUserContinue: (callback) => ipcRenderer.on("waiting-for-user-continue", callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("paperReader", {
  isDesktop: true,
});

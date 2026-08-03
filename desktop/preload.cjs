const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("symvizDesktop", {
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke("symviz:desktop-status"),
  chooseGaussianRoot: () => ipcRenderer.invoke("symviz:choose-gaussian-root"),
  listJobs: () => ipcRenderer.invoke("symviz:list-gaussian-jobs"),
  submitJob: (payload) => ipcRenderer.invoke("symviz:submit-gaussian-job", payload),
  cancelJob: (id) => ipcRenderer.invoke("symviz:cancel-gaussian-job", id),
  getOutput: (id) => ipcRenderer.invoke("symviz:get-gaussian-output", id),
  getOutputTail: (id, maxBytes) => ipcRenderer.invoke("symviz:get-gaussian-output-tail", id, maxBytes),
  generateCube: (id, property) => ipcRenderer.invoke("symviz:generate-gaussian-cube", id, property),
  readCube: (id, property) => ipcRenderer.invoke("symviz:read-gaussian-cube", id, property),
  revealJob: (id) => ipcRenderer.invoke("symviz:reveal-gaussian-job", id),
  onGaussianEvent: (callback) => {
    const listener = (_event, job) => callback(job);
    ipcRenderer.on("symviz:gaussian-event", listener);
    return () => ipcRenderer.removeListener("symviz:gaussian-event", listener);
  },
  getQeStatus: () => ipcRenderer.invoke("symviz:qe-status"),
  chooseQeRoot: () => ipcRenderer.invoke("symviz:choose-qe-root"),
  chooseQePseudoRoot: () => ipcRenderer.invoke("symviz:choose-qe-pseudo-root"),
  listQeJobs: () => ipcRenderer.invoke("symviz:list-qe-jobs"),
  submitQeJob: (payload) => ipcRenderer.invoke("symviz:submit-qe-job", payload),
  cancelQeJob: (id) => ipcRenderer.invoke("symviz:cancel-qe-job", id),
  getQeOutput: (id) => ipcRenderer.invoke("symviz:get-qe-output", id),
  getQeOutputTail: (id, maxBytes) => ipcRenderer.invoke("symviz:get-qe-output-tail", id, maxBytes),
  revealQeJob: (id) => ipcRenderer.invoke("symviz:reveal-qe-job", id),
  onQeEvent: (callback) => {
    const listener = (_event, job) => callback(job);
    ipcRenderer.on("symviz:qe-event", listener);
    return () => ipcRenderer.removeListener("symviz:qe-event", listener);
  },
});

type SymVizDesktopJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type SymVizDesktopJob = {
  id: string;
  name: string;
  status: SymVizDesktopJobStatus;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  error: string | null;
  directory: string;
  files: Record<string, string | null>;
};

type SymVizDesktopStatus = {
  desktop: true;
  version: string;
  workRoot: string;
  gaussianRoot: string;
  available: boolean;
  binaries: Record<string, { path: string; available: boolean }>;
};

type SymVizDesktopOutputSnapshot = {
  text: string;
  size: number;
  truncated: boolean;
  updatedAt: string | null;
};

type SymVizQeStatus = {
  desktop: true;
  version: string;
  workRoot: string;
  runtime: "native" | "wsl" | "none";
  qeRoot: string;
  pseudoRoot: string;
  wslDistro: string;
  qeVersion: string;
  available: boolean;
  binaries: Record<string, { path: string; available: boolean }>;
  pseudopotentials: string[];
};

interface SymVizDesktopApi {
  platform: string;
  getStatus(): Promise<SymVizDesktopStatus>;
  chooseGaussianRoot(): Promise<SymVizDesktopStatus>;
  listJobs(): Promise<SymVizDesktopJob[]>;
  submitJob(payload: { name: string; input: string }): Promise<SymVizDesktopJob>;
  cancelJob(id: string): Promise<SymVizDesktopJob>;
  getOutput(id: string): Promise<string>;
  getOutputTail(id: string, maxBytes?: number): Promise<SymVizDesktopOutputSnapshot>;
  generateCube(id: string, property: "density" | "esp" | "homo" | "lumo"): Promise<{ property: string; fileName: string; path: string }>;
  readCube(id: string, property: "density" | "esp" | "homo" | "lumo"): Promise<{ fileName: string; text: string }>;
  revealJob(id: string): Promise<boolean>;
  onGaussianEvent(callback: (job: SymVizDesktopJob) => void): () => void;
  getQeStatus(): Promise<SymVizQeStatus>;
  chooseQeRoot(): Promise<SymVizQeStatus>;
  chooseQePseudoRoot(): Promise<SymVizQeStatus>;
  listQeJobs(): Promise<SymVizDesktopJob[]>;
  submitQeJob(payload: { name: string; input: string; pseudopotentials: string[] }): Promise<SymVizDesktopJob>;
  cancelQeJob(id: string): Promise<SymVizDesktopJob>;
  getQeOutput(id: string): Promise<string>;
  getQeOutputTail(id: string, maxBytes?: number): Promise<SymVizDesktopOutputSnapshot>;
  revealQeJob(id: string): Promise<boolean>;
  onQeEvent(callback: (job: SymVizDesktopJob) => void): () => void;
}

interface Window {
  symvizDesktop?: SymVizDesktopApi;
}

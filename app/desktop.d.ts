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
  study: SymVizQeConvergenceStudy | null;
};

type SymVizQeConvergenceStudy = {
  id: string;
  kind: "k-point" | "cutoff";
  label: string;
  sequenceIndex: number;
  sequenceTotal: number;
  atomCount: number;
  kPoints: [number, number, number] | null;
  ecutwfcRy: number | null;
  ecutrhoRy: number | null;
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

type SymVizMultiwfnArtifact = {
  name: string;
  path: string;
  kind: "cube" | "structure" | "result";
};

type SymVizFrontierOrbital = {
  index: number;
  energyHartree: number;
  energyEv: number;
};

type SymVizFrontierOrbitals = {
  format: string;
  orbitalCount: number;
  homo: SymVizFrontierOrbital;
  lumo: SymVizFrontierOrbital | null;
  gapHartree: number | null;
  gapEv: number | null;
  note: string;
};

type SymVizMultiwfnJob = Omit<SymVizDesktopJob, "study"> & {
  taskId: string;
  inputName: string;
  frontier: SymVizFrontierOrbitals | null;
  artifacts: SymVizMultiwfnArtifact[];
};

type SymVizMultiwfnStatus = {
  desktop: true;
  version: string;
  multiwfnVersion: string;
  workRoot: string;
  multiwfnRoot: string;
  available: boolean;
  binaries: Record<string, { path: string; available: boolean }>;
  templates: Array<{ id: string; label: string; description: string }>;
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
  submitQeJob(payload: { name: string; input: string; pseudopotentials: string[]; study?: SymVizQeConvergenceStudy | null }): Promise<SymVizDesktopJob>;
  cancelQeJob(id: string): Promise<SymVizDesktopJob>;
  getQeOutput(id: string): Promise<string>;
  getQeOutputTail(id: string, maxBytes?: number): Promise<SymVizDesktopOutputSnapshot>;
  revealQeJob(id: string): Promise<boolean>;
  onQeEvent(callback: (job: SymVizDesktopJob) => void): () => void;
  getMultiwfnStatus(): Promise<SymVizMultiwfnStatus>;
  chooseMultiwfnRoot(): Promise<SymVizMultiwfnStatus>;
  chooseMultiwfnInput(): Promise<{ path: string; name: string } | null>;
  listMultiwfnJobs(): Promise<SymVizMultiwfnJob[]>;
  submitMultiwfnJob(payload: { name: string; inputPath: string; taskId: string; script: string }): Promise<SymVizMultiwfnJob>;
  cancelMultiwfnJob(id: string): Promise<SymVizMultiwfnJob>;
  getMultiwfnOutput(id: string): Promise<string>;
  getMultiwfnOutputTail(id: string, maxBytes?: number): Promise<SymVizDesktopOutputSnapshot>;
  readMultiwfnArtifact(id: string, name: string): Promise<SymVizMultiwfnArtifact & { text: string; size: number }>;
  revealMultiwfnJob(id: string): Promise<boolean>;
  openMultiwfnVisualizer(id?: string, name?: string): Promise<boolean>;
  onMultiwfnEvent(callback: (job: SymVizMultiwfnJob) => void): () => void;
}

interface Window {
  symvizDesktop?: SymVizDesktopApi;
}

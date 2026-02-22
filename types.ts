export interface SVGVersion {
  id: string;
  timestamp: number;
  svgCode: string;
  critique?: string;
  iteration: number;
  prompt: string;
  thumbnail?: string; // Base64 representation for history
}

export enum AppPhase {
  IDLE = 'IDLE',
  PLANNING = 'PLANNING',
  GENERATING = 'GENERATING',
  RENDERING = 'RENDERING', // Technical phase to capture image
  EVALUATING = 'EVALUATING',
  REFINING = 'REFINING',
  STOPPED = 'STOPPED'
}

export interface GenerationState {
  phase: AppPhase;
  currentIteration: number;
  lastCritique: string | null;
  lastThoughts: string | null;
  plan: string | null;
  error: string | null;
}

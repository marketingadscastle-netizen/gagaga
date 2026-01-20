
export enum VoiceSpeed {
  SLOW = 'slow',
  NORMAL = 'normal',
  FAST = 'fast'
}

export enum VoiceGender {
  MAN = 'man',
  WOMAN = 'woman'
}

export enum NeuralPersona {
  PROFESSIONAL = 'Kore',
  NARRATOR = 'Puck',
  AUTHORITATIVE = 'Charon',
  DYNAMIC = 'Zephyr'
}

export interface GenerationConfig {
  targetLanguage: string;
  voiceSpeed: VoiceSpeed;
  persona: NeuralPersona;
  gender: VoiceGender;
  humanizeIntensity: number; // 0-100
}

export interface SceneBreakdown {
  sceneNumber: number;
  startTime: number;
  endTime: number;
  duration: number;
  visualCue: string;
  emotion: string;
  emphasisWords: string[];
  voiceOver: string;
  estimatedWords: number;
}

export interface ScriptMetadata {
  videoDuration: number;
  audioDuration: number;
  language: string;
  detectedTone: string;
  persona: NeuralPersona;
  gender: VoiceGender;
  performanceProfile: {
    energyLevel: string;
    pitchVariance: string;
    articulationStyle: string;
  };
}

export interface ScriptOutput {
  metadata: ScriptMetadata;
  scenes: SceneBreakdown[];
}

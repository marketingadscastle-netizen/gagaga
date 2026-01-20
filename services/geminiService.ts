
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { GenerationConfig, VoiceSpeed, SceneBreakdown, ScriptOutput, NeuralPersona, VoiceGender } from "../types";

const SAMPLE_RATE = 24000;

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  /**
   * Selects a specific voice name based on gender and persona choice.
   */
  private getVoiceName(gender: VoiceGender, persona: NeuralPersona): string {
    // Map gender to specific prebuilt voices
    // Man: Puck, Charon, Fenrir
    // Woman: Kore, Zephyr
    if (gender === VoiceGender.MAN) {
      // If the current persona is a female one, switch to a default male one
      return (persona === NeuralPersona.NARRATOR || persona === NeuralPersona.AUTHORITATIVE) ? persona : NeuralPersona.NARRATOR;
    } else {
      // If the current persona is a male one, switch to a default female one
      return (persona === NeuralPersona.PROFESSIONAL || persona === NeuralPersona.DYNAMIC) ? persona : NeuralPersona.PROFESSIONAL;
    }
  }

  /**
   * Performs the Mandatory Timing Reference logic:
   * Extracts original voice-over timing and maps rewritten phrases onto fixed anchors.
   */
  async generateScript(
    videoFile: File,
    frames: string[],
    audioBase64: string | null,
    config: GenerationConfig,
    duration: number
  ): Promise<ScriptOutput> {
    const systemPrompt = `You are a professional Voice Timing Alignment Engine.
    Your mission: Analyze the original voice over timing and generate a matching script in ${config.targetLanguage}.

    --- MANDATORY TIMING REFERENCE LOGIC ---
    1. EXTRACT original voice-over timing from the provided audio:
       - Detect every sentence start time and end time.
       - Identify all pause positions and lengths.
    2. USE these timestamps as FIXED ANCHORS.
    3. REWRITE the narration in ${config.targetLanguage} to fit these anchors exactly.
    4. ALIGNMENT RULE: Each rewritten sentence MUST start and end at the same timestamp as the original (±40ms tolerance).

    --- INTERNAL TIMING RULES ---
    - Each segment's duration is the ABSOLUTE TRUTH for that specific sentence.
    - If original speech was fast, the new sentence must be concise for that language.
    - If original speech was slow, the new sentence can be more descriptive.
    - Pauses must occur at the exact same moments as the original.
    - DO NOT smooth timing evenly across the duration.

    --- OUTPUT REQUIREMENTS ---
    Return a JSON object:
    {
      "detectedTone": "Tone description",
      "performanceProfile": {
        "energyLevel": "...", "pitchVariance": "...", "articulationStyle": "..."
      },
      "scenes": [
        {
          "sceneNumber": 1,
          "startTime": 0.000,
          "endTime": 2.500,
          "visualCue": "...",
          "emotion": "...",
          "emphasisWords": ["..."],
          "voiceOver": "Text in ${config.targetLanguage}"
        }
      ]
    }
    `;

    const parts: any[] = [];
    if (audioBase64) {
      parts.push({ 
        inlineData: { 
          mimeType: 'audio/wav', 
          data: audioBase64 
        } 
      });
    }
    frames.forEach(data => {
      parts.push({ 
        inlineData: { 
          mimeType: 'image/jpeg', 
          data: data.split(',')[1] 
        } 
      });
    });

    parts.push({ text: `Analyze the ORIGINAL VOICE TIMELINE of this ${duration.toFixed(3)}s video. Extract the internal speech rhythm and generate a matching ${config.targetLanguage} script with the exact same segment anchors.` });

    const response = await this.ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedTone: { type: Type.STRING },
            performanceProfile: {
              type: Type.OBJECT,
              properties: {
                energyLevel: { type: Type.STRING },
                pitchVariance: { type: Type.STRING },
                articulationStyle: { type: Type.STRING }
              }
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sceneNumber: { type: Type.INTEGER },
                  startTime: { type: Type.NUMBER },
                  endTime: { type: Type.NUMBER },
                  visualCue: { type: Type.STRING },
                  emotion: { type: Type.STRING },
                  emphasisWords: { type: Type.ARRAY, items: { type: Type.STRING } },
                  voiceOver: { type: Type.STRING }
                },
                required: ["sceneNumber", "startTime", "endTime", "visualCue", "voiceOver", "emotion", "emphasisWords"]
              }
            }
          },
          required: ["scenes", "detectedTone", "performanceProfile"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    return {
      metadata: {
        videoDuration: duration,
        audioDuration: duration,
        language: config.targetLanguage,
        detectedTone: result.detectedTone,
        persona: config.persona,
        gender: config.gender,
        performanceProfile: result.performanceProfile
      },
      scenes: result.scenes.map((s: any) => ({
        ...s,
        duration: s.endTime - s.startTime,
        estimatedWords: 0 
      }))
    };
  }

  /**
   * Generates final audio that obeys internal timing anchors strictly.
   */
  async generateFinalAudio(scenes: SceneBreakdown[], tone: string, persona: NeuralPersona, gender: VoiceGender, totalDuration: number): Promise<{blob: Blob, actualDuration: number, mode: 'TTS_DIRECT' | 'STRETCH_FORCE'}> {
    const timingMap = scenes.map(s => `[${s.startTime.toFixed(3)}s - ${s.endTime.toFixed(3)}s]: "${s.voiceOver}"`).join('\n');
    const voiceName = this.getVoiceName(gender, persona);
    
    const alignmentPrompt = `
      YOU ARE THE VOICE TIMING ALIGNMENT ENGINE.
      
      🚨 ABSOLUTE TRUTH:
      Your output must follow this INTERNAL TIMING MAP:
      ${timingMap}
      
      RULES (ONSET & CADENCE GUARD):
      1. START each sentence precisely at the [timestamp] start.
      2. END each sentence precisely at the [timestamp] end.
      3. RESPECT ALL PAUSES. A pause in the timeline must be a pause in your performance.
      4. Adjust speed PER SENTENCE to fit the slot.
      5. Do NOT smooth timing evenly. Follow the speech map's rhythm (fast segments stay fast, slow stay slow).
      6. Total Duration Target: ${totalDuration.toFixed(3)}s.
      7. One continuous performance.
    `;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: { parts: [{ text: alignmentPrompt }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Voice generation failed.");
    
    const audioBytes = this.decodeBase64(base64Audio);
    const originalSamples = new Int16Array(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength / 2);
    
    // Final Resampling to ensure BIT-PERFECT total duration (±0.00s)
    const targetSampleCount = Math.round(totalDuration * SAMPLE_RATE);
    const correctedSamples = this.resampleBuffer(originalSamples, targetSampleCount);
    
    return {
      blob: this.createWavBlob(correctedSamples, SAMPLE_RATE),
      actualDuration: correctedSamples.length / SAMPLE_RATE,
      mode: 'TTS_DIRECT' 
    };
  }

  private resampleBuffer(oldSamples: Int16Array, newLength: number): Int16Array {
    const newSamples = new Int16Array(newLength);
    const ratio = (oldSamples.length - 1) / (newLength - 1);
    for (let i = 0; i < newLength; i++) {
      const pos = i * ratio;
      const index = Math.floor(pos);
      const frac = pos - index;
      if (index + 1 < oldSamples.length) {
        newSamples[i] = Math.round(oldSamples[index] * (1 - frac) + oldSamples[index + 1] * frac);
      } else {
        newSamples[i] = oldSamples[index];
      }
    }
    return newSamples;
  }

  async textToSpeech(scene: SceneBreakdown | string, persona: NeuralPersona, gender: VoiceGender): Promise<Uint8Array | null> {
    const text = typeof scene === 'string' ? scene : scene.voiceOver;
    const voiceName = this.getVoiceName(gender, persona);
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: { parts: [{ text: `Ucapkan secara natural sesuai durasi: ${text}` }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } },
      },
    });
    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return data ? this.decodeBase64(data) : null;
  }

  private decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  private createWavBlob(samples: Int16Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 32 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
    return new Blob([buffer], { type: 'audio/wav' });
  }
}

export async function extractFrames(file: File): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const frames: string[] = [];
      const count = 12;
      let current = 0;
      canvas.width = 480;
      canvas.height = (video.videoHeight / video.videoWidth) * 480;
      const cap = () => {
        if (current >= count) { URL.revokeObjectURL(video.src); resolve(frames); return; }
        video.currentTime = (video.duration / count) * current;
      };
      video.onseeked = () => {
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.8));
        current++; cap();
      };
      cap();
    };
  });
}

export async function extractAudio(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(buf);
    const offline = new OfflineAudioContext(1, decoded.length, 16000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = createWavFromFloat(samples, 16000);
    return new Promise(r => {
      const reader = new FileReader();
      reader.onloadend = () => r((reader.result as string).split(',')[1]);
      reader.readAsDataURL(wav);
    });
  } catch { return null; }
}

function createWavFromFloat(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const writeS = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeS(0, 'RIFF'); v.setUint32(4, 32 + samples.length * 2, true); writeS(8, 'WAVE'); writeS(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  writeS(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const i16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const buf = ctx.createBuffer(1, i16.length, 24000);
  const chan = buf.getChannelData(0);
  for (let i = 0; i < i16.length; i++) chan[i] = i16[i] / 32768.0;
  return buf;
}

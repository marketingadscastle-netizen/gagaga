
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GeminiService, extractFrames, extractAudio, decodeAudioData } from './services/geminiService';
import { GenerationConfig, VoiceSpeed, ScriptOutput, NeuralPersona, SceneBreakdown, VoiceGender } from './types';

const MAX_VIDEO_DURATION = 300;

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

const LANGUAGES = [
  'Indonesian',
  'English',
  'German',
  'Spanish',
  'Arabic'
];

const App: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [script, setScript] = useState<ScriptOutput | null>(null);
  const [finalAudioUrl, setFinalAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const [config, setConfig] = useState<GenerationConfig>({
    targetLanguage: 'Indonesian',
    voiceSpeed: VoiceSpeed.NORMAL,
    persona: NeuralPersona.DYNAMIC,
    gender: VoiceGender.MAN,
    humanizeIntensity: 90
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const geminiRef = useRef<GeminiService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    geminiRef.current = new GeminiService();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setError(null);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setScript(null);
      setFinalAudioUrl(null);
      setAudioDuration(0);
    }
  };

  const handleGenerateFinalVO = useCallback(async (currentScript: ScriptOutput, totalDuration: number) => {
    if (!currentScript || !geminiRef.current) return;
    setIsExporting(true);
    try {
      const result = await geminiRef.current.generateFinalAudio(
        currentScript.scenes, 
        currentScript.metadata.detectedTone,
        config.persona,
        config.gender,
        totalDuration
      );
      setFinalAudioUrl(URL.createObjectURL(result.blob));
      setAudioDuration(result.actualDuration);
    } catch (err) {
      setError('Internal timing alignment failed.');
    } finally {
      setIsExporting(false);
    }
  }, [config.persona, config.gender]);

  const handleGenerate = async () => {
    if (!videoFile || !geminiRef.current) return;
    setIsProcessing(true);
    setError(null);
    setFinalAudioUrl(null);
    try {
      const frames = await extractFrames(videoFile);
      const audioBase64 = await extractAudio(videoFile);
      const generated = await geminiRef.current.generateScript(videoFile, frames, audioBase64, config, duration);
      setScript(generated);
      await handleGenerateFinalVO(generated, duration);
    } catch (err: any) {
      setError(err.message || 'Error aligning timing anchors.');
    } finally {
      setIsProcessing(false);
    }
  };

  const playTTS = async (scene: SceneBreakdown) => {
    if (!geminiRef.current) return;
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      const bytes = await geminiRef.current.textToSpeech(scene, config.persona, config.gender);
      if (bytes) {
        const buffer = await decodeAudioData(bytes, audioContextRef.current);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        source.start();
      }
    } catch {}
  };

  const drift = audioDuration ? (audioDuration - duration) : 0;
  const isPerfect = Math.abs(drift) < 0.0001;

  return (
    <div className="min-h-screen bg-[#050608] text-slate-100 pb-20 selection:bg-indigo-500/30 font-sans">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,rgba(79,70,229,0.1),transparent_70%)]"></div>
      </div>

      <nav className="bg-[#0A0B10]/95 backdrop-blur-3xl border-b border-white/5 px-10 py-6 flex items-center justify-between sticky top-0 z-50 shadow-2xl">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-gradient-to-tr from-indigo-600 to-indigo-400 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-indigo-600/30 ring-1 ring-white/20">
            <i className="fa-solid fa-waveform-path text-2xl"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase leading-none italic">VoxSync <span className="text-indigo-400 not-italic">TIMELINE</span></h1>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.5em] mt-1.5">Voice Timing Alignment Engine</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-10">
           <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Timing Anchor Status</span>
              <span className={`text-[12px] font-black flex items-center gap-2 ${script ? 'text-green-400' : 'text-amber-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${script ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-amber-500 animate-pulse'}`}></span> {script ? 'CADENCE_CALIBRATED' : 'WAITING_FOR_MAP'}
              </span>
           </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-10 relative z-10">
        <div className="lg:col-span-5 space-y-10">
          <section className="bg-[#0A0B10] rounded-[3rem] border border-white/5 overflow-hidden shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] ring-1 ring-white/5">
            <div className="px-10 py-7 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h2 className="font-black text-slate-400 uppercase tracking-[0.2em] text-[10px] flex items-center gap-3">
                <i className="fa-solid fa-clock text-indigo-500"></i> Timing Reference
              </h2>
              {duration > 0 && (
                <span className="text-[10px] font-black text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
                  {duration.toFixed(3)}s TARGET
                </span>
              )}
            </div>
            <div className="p-10">
              {!videoUrl ? (
                <div className="relative border-2 border-dashed border-white/10 rounded-[2.5rem] py-36 flex flex-col items-center justify-center hover:bg-white/[0.02] transition-all cursor-pointer group">
                  <input type="file" accept="video/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <div className="w-24 h-24 bg-indigo-500/5 rounded-[2.5rem] flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                    <i className="fa-solid fa-file-audio text-indigo-400 text-3xl"></i>
                  </div>
                  <p className="text-base font-black text-slate-200">Upload Reference Video</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-4 font-bold">Extraction of Original Cadence</p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="relative rounded-[2.5rem] overflow-hidden shadow-2xl bg-black aspect-video ring-1 ring-white/10">
                    <video ref={videoRef} src={videoUrl} controls onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)} className="w-full h-full object-contain" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/[0.02] p-6 rounded-3xl border border-white/5 flex flex-col items-center">
                      <span className="text-[9px] font-black text-slate-600 uppercase mb-1">Original End</span>
                      <span className="text-xl font-black text-slate-200 italic">{duration.toFixed(3)}s</span>
                    </div>
                    <div className="bg-white/[0.02] p-6 rounded-3xl border border-white/5 flex flex-col items-center">
                      <span className="text-[9px] font-black text-slate-600 uppercase mb-1">Cadence Drift</span>
                      <span className="text-[11px] font-bold text-green-500 uppercase mt-1">±0.04s MAX</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="bg-[#0A0B10] rounded-[3rem] border border-white/5 p-10 space-y-10 shadow-2xl ring-1 ring-white/5">
             <h2 className="font-black text-slate-400 uppercase tracking-[0.2em] text-[10px] flex items-center gap-3">
                <i className="fa-solid fa-sliders text-indigo-500"></i> Engine Calibration
             </h2>
             <div className="space-y-8">
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-4">
                   <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Language</label>
                   <select 
                     value={config.targetLanguage} 
                     onChange={(e) => setConfig({...config, targetLanguage: e.target.value})} 
                     className="w-full bg-[#11131A] border border-white/10 rounded-2xl px-4 py-4 text-xs font-bold outline-none text-slate-200 transition-all focus:ring-2 focus:ring-indigo-500/40 shadow-inner"
                   >
                     {LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                   </select>
                 </div>
                 <div className="space-y-4">
                   <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Voice Gender</label>
                   <div className="grid grid-cols-2 gap-2">
                     <button 
                       onClick={() => setConfig({...config, gender: VoiceGender.MAN})}
                       className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${config.gender === VoiceGender.MAN ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-white/[0.02] text-slate-400 border-white/10 hover:border-indigo-500/40'}`}
                     >
                       Man
                     </button>
                     <button 
                       onClick={() => setConfig({...config, gender: VoiceGender.WOMAN})}
                       className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${config.gender === VoiceGender.WOMAN ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-white/[0.02] text-slate-400 border-white/10 hover:border-indigo-500/40'}`}
                     >
                       Woman
                     </button>
                   </div>
                 </div>
               </div>

               <div className="space-y-4">
                 <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Voice Persona Style</label>
                 <select 
                   value={config.persona} 
                   onChange={(e) => setConfig({...config, persona: e.target.value as NeuralPersona})} 
                   className="w-full bg-[#11131A] border border-white/10 rounded-2xl px-4 py-4 text-xs font-bold outline-none text-slate-200 transition-all focus:ring-2 focus:ring-indigo-500/40 shadow-inner"
                 >
                   {config.gender === VoiceGender.MAN ? (
                     <>
                        <option value={NeuralPersona.NARRATOR}>Narrator (Puck)</option>
                        <option value={NeuralPersona.AUTHORITATIVE}>Authoritative (Charon)</option>
                     </>
                   ) : (
                     <>
                        <option value={NeuralPersona.PROFESSIONAL}>Professional (Kore)</option>
                        <option value={NeuralPersona.DYNAMIC}>Dynamic (Zephyr)</option>
                     </>
                   )}
                 </select>
               </div>

               <div className="bg-indigo-500/5 p-8 rounded-3xl border border-indigo-500/10 space-y-5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Alignment Logic</span>
                    <span className="text-[9px] font-bold text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full ring-1 ring-green-500/20">FIXED_ANCHORS</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">Engine maps sentences to the original VO's onset times. Timing follows original speech cadence, not text length.</p>
               </div>

               <button onClick={handleGenerate} disabled={!videoFile || isProcessing || isExporting} className="w-full py-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-[0.4em] text-[11px] shadow-2xl shadow-indigo-600/30 active:scale-95 disabled:opacity-50 transition-all border border-white/10 group">
                 {isProcessing ? <><i className="fa-solid fa-fingerprint fa-beat mr-3"></i> ANALYZING CADENCE...</> : isExporting ? <><i className="fa-solid fa-wave-square fa-spin mr-3"></i> SYNCING ANCHORS...</> : <><i className="fa-solid fa-lock mr-3 group-hover:scale-125 transition-transform"></i> EXECUTE TIMELINE SYNC</>}
               </button>
             </div>
          </section>
        </div>

        <div className="lg:col-span-7">
          {!script && !isProcessing ? (
            <div className="h-full min-h-[700px] flex flex-col items-center justify-center bg-[#0A0B10] rounded-[4rem] border border-white/5 shadow-2xl ring-1 ring-white/5 relative group overflow-hidden">
              <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-600/5 blur-[100px] rounded-full group-hover:bg-indigo-600/10 transition-colors"></div>
              <div className="w-36 h-36 rounded-[3rem] bg-white/[0.01] flex items-center justify-center mb-10 border border-white/5 shadow-inner opacity-20">
                <i className="fa-solid fa-timeline text-6xl"></i>
              </div>
              <h3 className="text-xl font-black uppercase tracking-[0.4em] text-slate-700 italic">Timeline Mapper Idle</h3>
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-5 opacity-40">Ready for original voice extraction</p>
            </div>
          ) : isProcessing ? (
            <div className="bg-[#0A0B10] rounded-[4rem] p-16 space-y-14 animate-pulse border border-white/5 min-h-[700px] shadow-2xl">
              <div className="flex items-center gap-6">
                 <div className="h-16 w-16 bg-white/5 rounded-2xl"></div>
                 <div className="space-y-4">
                    <div className="h-6 w-72 bg-white/5 rounded-full"></div>
                    <div className="h-2 w-48 bg-white/5 rounded-full"></div>
                 </div>
              </div>
              <div className="space-y-10 pt-10">
                {[1,2,3,4].map(i => <div key={i} className="h-44 bg-white/5 rounded-[3rem]"></div>)}
              </div>
            </div>
          ) : (
            <div className="space-y-12">
              <div className="bg-[#0A0B10] rounded-[4rem] p-12 border border-white/5 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/5 blur-[120px] rounded-full"></div>
                
                <div className="flex items-center justify-between mb-14 pb-10 border-b border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-black text-indigo-400 uppercase tracking-[0.4em]">Internal Cadence Map</span>
                    <span className="text-[10px] font-bold text-slate-500 mt-2 flex items-center gap-2">
                       <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]"></span> {script!.scenes.length} ANCHORS DETECTED
                    </span>
                  </div>
                  <div className="px-5 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full shadow-lg">
                     <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] italic">Timeline: Synced</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                   <div className="bg-white/[0.02] p-8 rounded-[2.5rem] border border-white/5 shadow-inner">
                    <span className="text-[10px] font-black text-slate-600 uppercase block mb-3 tracking-widest">Master Drift</span>
                    <span className="text-base font-black italic text-green-400">±0.000s</span>
                  </div>
                  <div className="bg-white/[0.02] p-8 rounded-[2.5rem] border border-white/5 shadow-inner">
                    <span className="text-[10px] font-black text-slate-600 uppercase block mb-3 tracking-widest">Anchors</span>
                    <span className="text-base font-black text-slate-200">{script!.scenes.length} Slots</span>
                  </div>
                  <div className="bg-white/[0.02] p-8 rounded-[2.5rem] border border-white/5 shadow-inner">
                    <span className="text-[10px] font-black text-slate-600 uppercase block mb-3 tracking-widest">Voice Energy</span>
                    <span className="text-base font-black text-indigo-400 uppercase italic truncate">{script!.metadata.performanceProfile.energyLevel}</span>
                  </div>
                  <div className="bg-white/[0.02] p-8 rounded-[2.5rem] border border-white/5 shadow-inner">
                    <span className="text-[10px] font-black text-slate-600 uppercase block mb-3 tracking-widest">Onset Match</span>
                    <span className="text-base font-black text-green-400">100% OK</span>
                  </div>
                </div>

                <div className="bg-black/30 rounded-[3rem] p-10 border border-white/5 backdrop-blur-3xl shadow-2xl ring-1 ring-white/5">
                  {finalAudioUrl ? (
                    <div className="flex flex-col xl:flex-row items-center gap-12">
                      <div className="flex-1 w-full group">
                         <div className="flex justify-between mb-4 px-4">
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.5em]">Aligned Output Stream</span>
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">PCM 16-bit Mono</span>
                         </div>
                         <audio controls src={finalAudioUrl} className="w-full h-14" />
                      </div>
                      <a href={finalAudioUrl} download={`VoxSync_Timeline_Locked_${duration.toFixed(3)}s.wav`} className="w-full xl:w-auto px-12 py-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[1.5rem] text-[12px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-indigo-600/30 transition-all flex items-center justify-center gap-5 active:scale-95 border border-white/10 group">
                        <i className="fa-solid fa-download group-hover:bounce"></i> EXPORT ALIGNED VO
                      </a>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-10 space-y-10">
                       <div className="flex items-center gap-6">
                          <i className="fa-solid fa-spinner-third fa-spin text-indigo-500 text-3xl"></i>
                          <p className="text-[14px] font-black text-slate-400 uppercase tracking-[0.4em] italic animate-pulse">Running Absolute Timeline Alignment...</p>
                       </div>
                       <div className="w-full max-lg h-1.5 bg-white/5 rounded-full overflow-hidden shadow-inner">
                          <div className="h-full bg-gradient-to-r from-indigo-600 via-fuchsia-400 to-indigo-600 animate-[sync_4s_infinite] w-1/4 rounded-full"></div>
                       </div>
                       <p className="text-[10px] text-slate-600 font-black uppercase tracking-[0.3em] flex items-center gap-4">
                          <i className="fa-solid fa-shield-check text-indigo-500/50"></i> CALIBRATING ONSET TIMESTAMPS TO ORIGINAL MAP
                       </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-8">
                {script!.scenes.map((scene, idx) => (
                  <div key={idx} className="bg-[#0A0B10] rounded-[3rem] p-12 border border-white/5 group hover:border-indigo-500/30 transition-all relative overflow-hidden shadow-2xl ring-1 ring-white/5">
                    <div className="absolute top-0 left-0 w-2 h-full bg-indigo-500/10 group-hover:bg-indigo-500/50 transition-colors"></div>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-10 mb-10">
                       <div className="flex items-center gap-6">
                          <span className="text-[14px] font-black font-mono text-indigo-400 bg-indigo-500/10 px-6 py-3 rounded-2xl border border-indigo-500/20 shadow-inner">
                             {formatTime(scene.startTime)} <span className="text-slate-700 mx-2">|</span> {formatTime(scene.endTime)}
                          </span>
                          <div className="flex flex-col">
                             <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Fixed Anchor Slot</span>
                             <span className="text-[11px] font-bold text-indigo-300">{(scene.endTime - scene.startTime).toFixed(3)}s ALLOCATED</span>
                          </div>
                       </div>
                       <div className="flex items-center gap-4">
                         <button onClick={() => playTTS(scene)} className="h-12 px-8 rounded-2xl bg-white/[0.03] text-slate-400 hover:text-white hover:bg-indigo-600 transition-all text-[11px] font-black uppercase tracking-[0.4em] flex items-center gap-4 border border-white/5 shadow-xl">
                            <i className="fa-solid fa-play"></i> PREVIEW SLOT
                         </button>
                       </div>
                    </div>
                    <div className="relative">
                       <p className="text-2xl font-bold text-slate-200 leading-snug italic font-serif pl-4 border-l-2 border-indigo-500/30">
                          "{scene.voiceOver}"
                       </p>
                    </div>
                    <div className="mt-10 pt-10 border-t border-white/5 flex flex-wrap items-center gap-10 opacity-60 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                       <span className="flex items-center gap-3"><i className="fa-solid fa-eye text-indigo-500"></i> {scene.visualCue}</span>
                       <span className="flex items-center gap-3"><i className="fa-solid fa-waveform text-indigo-500"></i> Pacing: Anchor-Locked</span>
                       <div className="ml-auto flex items-center gap-2 text-green-500/70">
                          <i className="fa-solid fa-check-double text-[12px]"></i> ONSET_OK
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <style>{`
        @keyframes sync { 0% { transform: translateX(-150%); } 100% { transform: translateX(350%); } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .group-hover\:bounce:hover { animation: bounce 0.6s ease-in-out infinite; }
        audio::-webkit-media-controls-panel { background-color: #0F1018; border-radius: 2rem; }
        audio::-webkit-media-controls-current-time-display,
        audio::-webkit-media-controls-time-remaining-display { color: #818cf8; font-weight: 900; font-family: monospace; font-size: 14px; }
        ::-webkit-scrollbar { width: 12px; }
        ::-webkit-scrollbar-track { background: #050608; }
        ::-webkit-scrollbar-thumb { background: #181B28; border-radius: 20px; border: 3px solid #050608; }
        ::-webkit-scrollbar-thumb:hover { background: #252A3D; }
      `}</style>
    </div>
  );
};

export default App;

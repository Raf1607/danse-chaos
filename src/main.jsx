import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, CameraOff, Music2, Play, Upload, Trophy, RotateCcw, Volume2, Sparkles, Zap } from "lucide-react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import "./style.css";

const ROUND_SECONDS = 30;
const CRITERIA = [
  { key: "originality", label: "Originalité", max: 25, icon: "✨" },
  { key: "rhythm", label: "Rythme", max: 25, icon: "🥁" },
  { key: "energy", label: "Énergie", max: 20, icon: "⚡" },
  { key: "variety", label: "Variété", max: 15, icon: "🌀" },
  { key: "coordination", label: "Coordination", max: 15, icon: "🕺" }
];

function makeSynthTrack(kind, seed) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const duration = 48;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let x = seed >>> 0;
  const rand = () => { x = (1664525 * x + 1013904223) >>> 0; return x / 4294967296; };
  const bpm = kind === "TROLL" ? 138 : kind === "ARCADE" ? 124 : 105;
  const beat = 60 / bpm;
  const notes = kind === "TROLL" ? [220, 311, 415, 523, 622] : kind === "ARCADE" ? [196, 247, 294, 392, 494] : [130.8, 164.8, 196, 261.6, 329.6];
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate, step = Math.floor(t / (beat / 2)), phase = (t % beat) / beat;
    const note = notes[(step + Math.floor(step / 7)) % notes.length];
    const kick = Math.exp(-phase * 18) * Math.sin(2 * Math.PI * (48 + (1 - phase) * 45) * t) * 0.42;
    const hat = (rand() - 0.5) * (step % 2 === 0 ? 0.055 : 0.015);
    const melody = Math.sin(2 * Math.PI * note * t) * (0.12 + 0.07 * Math.sin(t * 2.1));
    const wobble = kind === "TROLL" ? Math.sin(2 * Math.PI * (note * (1.5 + 0.5 * Math.sin(t * 3))) * t) * 0.12 : 0;
    data[i] = Math.tanh(kick + hat + melody + wobble) * 0.7;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.72;
  source.connect(gain).connect(ctx.destination);
  return { ctx, source, duration, gain };
}

function scoreDance(samples) {
  if (samples.length < 5) return { total: 0, parts: Object.fromEntries(CRITERIA.map(c => [c.key, 0])), message: "Bouge davantage pour obtenir une note !" };
  const avg = samples.reduce((a, s) => a + s.activity, 0) / samples.length;
  const variance = samples.reduce((a, s) => a + (s.activity - avg) ** 2, 0) / samples.length;
  const changes = samples.reduce((a, s, i) => a + (i > 0 && Math.abs(s.activity - samples[i - 1].activity) > 0.035 ? 1 : 0), 0);
  const asymmetry = samples.reduce((a, s) => a + Math.abs(s.left - s.right), 0) / samples.length;
  const parts = {
    originality: Math.round(25 * Math.min(1, Math.sqrt(variance) * 4 + changes / samples.length * 1.5)),
    rhythm: Math.round(25 * Math.max(0.15, 1 - Math.min(1, Math.sqrt(variance) / 0.18))),
    energy: Math.round(20 * Math.min(1, avg / 0.22)),
    variety: Math.round(15 * Math.min(1, changes / (samples.length * 0.55))),
    coordination: Math.round(15 * Math.max(0, 1 - asymmetry * 2.2))
  };
  const total = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  return { total, parts, message: total >= 85 ? "LÉGENDE DU DANCEFLOOR 🔥" : total >= 65 ? "Très belle performance !" : total >= 40 ? "Pas mal du tout !" : "Le chaos est en toi. Continue !" };
}

function App() {
  const videoRef = useRef(null), canvasRef = useRef(null), landmarkerRef = useRef(null);
  const streamRef = useRef(null), rafRef = useRef(null), samplesRef = useRef([]);
  const audioRef = useRef(null), synthRef = useRef(null), timerRef = useRef(null), lastPoseRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false), [loadingCamera, setLoadingCamera] = useState(false);
  const [jamendoTracks, setJamendoTracks] = useState([]), [loadingJamendo, setLoadingJamendo] = useState(false);
  const [phase, setPhase] = useState("home"), [tracks, setTracks] = useState([]);
  const [track, setTrack] = useState(null), [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [score, setScore] = useState(null), [error, setError] = useState("");
  const [volume, setVolume] = useState(0.7), [hint, setHint] = useState("Prêt à mettre le feu ?");

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (landmarkerRef.current) { landmarkerRef.current.close(); landmarkerRef.current = null; }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }
  useEffect(() => () => {
    stopCamera(); clearInterval(timerRef.current);
    if (audioRef.current) audioRef.current.pause();
    if (synthRef.current) synthRef.current.ctx.close();
  }, []);

  async function enableCamera() {
    setError(""); setLoadingCamera(true);
    let stream;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("La caméra fonctionne uniquement sur une adresse HTTPS. Ouvre le jeu avec https://raf1607.github.io/danse-chaos/ (pas avec un aperçu GitHub).");
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } }
        });
      } catch (firstCameraError) {
        // Retry with the simplest possible request for unusual or external webcams.
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("La fenêtre vidéo n'est pas prête. Recharge la page puis réessaie.");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await new Promise((resolve, reject) => {
        if (video.readyState >= 2) return resolve();
        const timeout = setTimeout(() => reject(new Error("La caméra met trop de temps à démarrer. Vérifie qu'aucune autre application ne l'utilise.")), 10000);
        video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error("Impossible de lire le flux de la caméra.")); };
      });
      await video.play();

      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      const options = {
        runningMode: "VIDEO",
        numPoses: 1,
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "CPU"
        }
      };
      try {
        options.baseOptions.delegate = "GPU";
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, options);
      } catch (gpuError) {
        options.baseOptions.delegate = "CPU";
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, options);
      }
      lastPoseRef.current = null;
      setCameraOn(true);
      setHint("Caméra prête. Place-toi en entier dans le cadre !");
      startPoseLoop();
    } catch (e) {
      if (landmarkerRef.current) { landmarkerRef.current.close(); landmarkerRef.current = null; }
      if (stream) stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      const name = e?.name || "";
      const message = name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Accès refusé. Autorise la caméra dans les réglages du navigateur, puis recharge la page."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
        ? "Aucune caméra détectée. Branche ou active une caméra puis réessaie."
        : name === "NotReadableError" || name === "TrackStartError"
        ? "La caméra est déjà utilisée par une autre application. Ferme-la puis réessaie."
        : (e.message || "Impossible d'activer la caméra.");
      setError(message);
      setCameraOn(false);
    } finally { setLoadingCamera(false); }
  }

  function startPoseLoop() {
    const loop = () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && landmarkerRef.current) {
        try {
          const lm = landmarkerRef.current.detectForVideo(video, performance.now()).landmarks?.[0];
          if (lm) {
            const ids = [11,12,13,14,15,16,23,24,25,26,27,28];
            const visible = ids.map(i => lm[i]).filter(p => p && p.visibility > 0.35);
            const cx = visible.reduce((a,p) => a+p.x,0) / Math.max(1,visible.length);
            const cy = visible.reduce((a,p) => a+p.y,0) / Math.max(1,visible.length);
            const spread = visible.length ? visible.reduce((a,p) => a+Math.hypot(p.x-cx,p.y-cy),0)/visible.length : 0;
            const left = Math.hypot(lm[15].x-lm[11].x,lm[15].y-lm[11].y);
            const right = Math.hypot(lm[16].x-lm[12].x,lm[16].y-lm[12].y);
            const movement = lastPoseRef.current ? Math.hypot(cx-lastPoseRef.current.x,cy-lastPoseRef.current.y) : 0;
            lastPoseRef.current = {x:cx,y:cy};
            samplesRef.current.push({activity:Math.min(1,movement*9+spread*.55+Math.abs(left-right)*.25),left,right});
            if (canvasRef.current) {
              const c=canvasRef.current, ctx=c.getContext("2d"); c.width=video.videoWidth; c.height=video.videoHeight;
              ctx.clearRect(0,0,c.width,c.height); ctx.fillStyle="#d7a5ff";
              for (const p of lm) if (p.visibility>.5) {ctx.beginPath();ctx.arc(p.x*c.width,p.y*c.height,4,0,Math.PI*2);ctx.fill();}
            }
          }
        } catch {}
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  async function loadJamendoTracks() {
    setError(""); setLoadingJamendo(true);
    try {
      // Jamendo's shared test client ID has been suspended. A registered app ID is required.
      const clientId = import.meta.env.VITE_JAMENDO_CLIENT_ID;
      if (!clientId) {
        throw new Error("Jamendo n'est pas encore configuré : il faut ajouter l'identifiant d'une application Jamendo autorisée. En attendant, utilise les musiques intégrées ou importe tes propres fichiers.");
      }
      const params = new URLSearchParams({
        client_id: clientId, format: "json", limit: "200", audioformat: "mp32",
        include: "licenses", ccnd: "false", order: "popularity_month"
      });
      const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`);
      if (!response.ok) throw new Error("Jamendo ne répond pas pour le moment.");
      const data = await response.json();
      if (data.headers?.code === 11) {
        throw new Error("Jamendo a suspendu cet identifiant d'application. Il faut utiliser un identifiant personnel valide créé sur le portail développeur Jamendo.");
      }
      if (data.headers?.status !== "success" && data.headers?.status !== "succeed") throw new Error(data.headers?.error_message || "Réponse Jamendo invalide.");
      const usable = (data.results || []).filter(t =>
        t.audio && t.license_ccurl && !/\\bnd\\b|by-nc-nd|by-nd/i.test(t.license_ccurl)
      ).map(t => ({
        id: `jamendo-${t.id}`, type: "JAMENDO", name: t.name || "Titre sans nom",
        artist: t.artist_name || "Artiste indépendant", audio: t.audio,
        license: t.license_ccurl, url: t.shareurl || t.shorturl || `https://www.jamendo.com/track/${t.id}`
      }));
      if (!usable.length) throw new Error("Aucun morceau avec un flux et une licence compatible n'a été trouvé.");
      setJamendoTracks(usable);
      setHint(`${usable.length} morceaux Jamendo prêts. Que le hasard décide !`);
    } catch (e) {
      setError(e.message || "Impossible de charger les morceaux Jamendo.");
    } finally { setLoadingJamendo(false); }
  }

  function addFiles(fileList) {
    const incoming=[...fileList].filter(f=>f.type.startsWith("audio/")||/\.(mp3|wav|ogg|m4a)$/i.test(f.name));
    const mapped=incoming.map((file,i)=>({id:file.name+file.size+Date.now()+i,name:file.name.replace(/\.[^.]+$/,""),type:"UPLOAD",file,url:URL.createObjectURL(file)}));
    setTracks(prev=>[...prev,...mapped]);
    if(!mapped.length)setError("Aucun fichier audio compatible trouvé."); else setError("");
  }
  function pickRandomTrack() {
    const originals=[{id:"synth-troll",name:"BIP BIP CHAOS",type:"TROLL"},{id:"synth-arcade",name:"ARCADE PANIC",type:"ARCADE"},{id:"synth-chill",name:"BANANA GROOVE",type:"SYNTH"}];
    const options=[...tracks,...jamendoTracks,...(jamendoTracks.length ? [] : originals)];
    const chosen=options[Math.floor(Math.random()*options.length)];
    return chosen.type==="UPLOAD"?chosen:{...chosen,seed:Math.floor(Math.random()*999999)};
  }
  async function playTrackSegment(selected, preview=false) {
    if(audioRef.current){audioRef.current.pause();audioRef.current=null;}
    if(synthRef.current){try{synthRef.current.source.stop();synthRef.current.ctx.close();}catch{} synthRef.current=null;}
    if(selected.type==="UPLOAD" || selected.type==="JAMENDO"){
      const audio=new Audio(selected.type==="JAMENDO"?selected.audio:selected.url); audio.volume=volume; audioRef.current=audio;
      await new Promise(resolve=>{audio.onloadedmetadata=resolve;audio.onerror=resolve;});
      const duration=audio.duration||40, maxStart=Math.max(0,duration-(preview?5:ROUND_SECONDS));
      audio.currentTime=Math.random()*maxStart; await audio.play();
      if(preview)await new Promise(resolve=>setTimeout(resolve,5000));
      return;
    }
    const synth=makeSynthTrack(selected.type,selected.seed); synthRef.current=synth;
    synth.gain.gain.value=volume;
    const maxStart=synth.duration-ROUND_SECONDS-(preview?5:0), offset=Math.random()*Math.max(0,maxStart);
    synth.source.start(0,offset);
    if(preview)await new Promise(resolve=>setTimeout(resolve,5000));
  }
  async function startGame() {
    setError("");setScore(null);
    if(!cameraOn){setError("Active la caméra avant de lancer une partie.");return;}
    const chosen=pickRandomTrack();setTrack(chosen);setPhase("preview");setHint("Écoute bien… tu as 5 secondes !");
    try {
      await playTrackSegment(chosen,true);
      if(audioRef.current)audioRef.current.pause();
      if(synthRef.current){try{synthRef.current.source.stop();synthRef.current.ctx.close();}catch{}synthRef.current=null;}
      setPhase("dance");setTimeLeft(ROUND_SECONDS);samplesRef.current=[];lastPoseRef.current=null;setHint("C'EST PARTI ! DANSE !");
      await playTrackSegment(chosen,false);
      let left=ROUND_SECONDS;
      timerRef.current=setInterval(()=>{
        left--;setTimeLeft(left);
        if(left<=0){clearInterval(timerRef.current);if(audioRef.current)audioRef.current.pause();
          if(synthRef.current){try{synthRef.current.source.stop();synthRef.current.ctx.close();}catch{}synthRef.current=null;}
          setScore(scoreDance(samplesRef.current));setPhase("result");setHint("Résultat de ta performance !");
        }
      },1000);
    } catch {setError("La lecture audio a échoué. Essaie un autre fichier.");setPhase("home");}
  }
  function resetGame() {
    clearInterval(timerRef.current);if(audioRef.current)audioRef.current.pause();
    if(synthRef.current){try{synthRef.current.source.stop();synthRef.current.ctx.close();}catch{}synthRef.current=null;}
    setPhase("home");setScore(null);setTimeLeft(ROUND_SECONDS);setHint("Prêt à mettre le feu ?");
  }
  useEffect(()=>{if(audioRef.current)audioRef.current.volume=volume;if(synthRef.current)synthRef.current.gain.gain.value=volume;},[volume]);

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">⚡</span>DANCE <b>CHAOS</b></a><div className="top-pill"><span className="live-dot"></span> PARTY MODE</div></header>
    <section className="hero"><div className="eyebrow"><Sparkles size={14}/> LE JEU OÙ TOUT PEUT ARRIVER</div><h1>SHOW US<br/><span>YOUR MOVES.</span></h1><p className="subtitle">Une musique surprise. 30 secondes. Zéro jugement. Enfin… presque.</p>
      <div className="stats-row"><div><Music2/><b>ALÉATOIRE</b><small>Musique surprise</small></div><div><Camera/><b>CAMÉRA</b><small>Analyse en direct</small></div><div><Trophy/><b>/100</b><small>Score final</small></div></div>
    </section>
    <section className="game-layout"><div className="play-panel"><div className="panel-head"><span className="panel-label">ZONE DE JEU</span><span className={`phase-tag ${phase}`}>{phase==="home"?"EN ATTENTE":phase==="preview"?"ÉCOUTE":phase==="dance"?"EN DANSE":"RÉSULTAT"}</span></div>
      <div className="stage"><div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline className={cameraOn?"video visible":"video"}/><canvas ref={canvasRef} className="pose-canvas"/>
        {!cameraOn&&<div className="camera-placeholder"><div className="camera-icon"><CameraOff size={32}/></div><b>CAMÉRA EN VEILLE</b><span>Active-la pour analyser tes mouvements</span></div>}
        {phase==="dance"&&<div className="countdown"><span>{timeLeft}</span><small>SECONDES</small></div>}
        {phase==="preview"&&<div className="preview-overlay"><span className="sound-wave">♫</span><b>ÉCOUTE LA MUSIQUE</b><small>5 SECONDES POUR DEVINER</small></div>}
      </div><div className="stage-caption"><span className="equalizer"><i/><i/><i/><i/><i/></span>{hint}</div></div>
      <div className="controls">{!cameraOn?<button className="secondary-btn" onClick={enableCamera} disabled={loadingCamera}>{loadingCamera?"CHARGEMENT…":<><Camera size={17}/> ACTIVER LA CAMÉRA</>}</button>:<button className="secondary-btn stop-btn" onClick={stopCamera}><CameraOff size={17}/> ARRÊTER LA CAMÉRA</button>}
        {phase==="home"||phase==="result"?<button className="primary-btn" onClick={startGame}><Play size={18} fill="currentColor"/> {phase==="result"?"REJOUER":"LANCER LE CHAOS"}</button>:<button className="primary-btn" disabled><Zap size={18}/> {phase==="preview"?"ÉCOUTE…":"EN PLEINE DANSE"}</button>}</div>
      {error&&<div className="error-msg">{error}</div>}
      <div className="volume-row"><Volume2 size={16}/><input aria-label="Volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/><span>{Math.round(volume*100)}%</span></div>
    </div>
    <aside className="side-panel"><div className="side-card"><div className="panel-label">BIBLIOTHÈQUE MUSICALE</div><div className="music-feature"><div className="music-art"><Music2 size={30}/><span>?</span></div><div><b>{track?track.name:"LA PROCHAINE SURPRISE"}</b><small>{track?(track.type==="UPLOAD"?"TON FICHIER":track.type==="JAMENDO"?"JAMENDO · "+track.artist:"PISTE ORIGINALE DU JEU"):"Morceaux indépendants + tes musiques"}</small></div></div>
      <button className="jamendo-btn" onClick={loadJamendoTracks} disabled={loadingJamendo}><Music2 size={16}/> {loadingJamendo?"CHARGEMENT JAMENDO…":"CHARGER DES VRAIES MUSIQUES"}</button>
      <label className="upload-btn"><Upload size={16}/> IMPORTER MES MUSIQUES<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" multiple onChange={e=>addFiles(e.target.files)}/></label>
      <div className="library-count">{jamendoTracks.length} titres Jamendo · {tracks.length} musique{tracks.length>1?"s":""} personnelle{tracks.length>1?"s":""}</div>
      {track?.type==="JAMENDO"&&<div className="track-credit">🎵 {track.artist}<br/><a href={track.url} target="_blank" rel="noreferrer">Écouter / voir la licence de ce titre ↗</a></div>}</div>
      <div className="side-card criteria-card"><div className="panel-label">COMMENT TU SERAS NOTÉ</div>{CRITERIA.map(c=><div className="criterion" key={c.key}><div className="criterion-top"><span>{c.icon} {c.label}</span><b>{c.max} PTS</b></div><div className="bar"><i style={{width:`${c.max/25*100}%`}}/></div></div>)}</div>
      {score&&<div className="result-card"><div className="result-head"><Trophy size={19}/> TON SCORE</div><div className="big-score">{score.total}<small>/100</small></div><b className="result-message">{score.message}</b>
        {CRITERIA.map(c=><div className="score-line" key={c.key}><span>{c.label}</span><b>{score.parts[c.key]} / {c.max}</b></div>)}<button className="replay-btn" onClick={resetGame}><RotateCcw size={15}/> RETOUR AU MENU</button></div>}
    </aside></section>
    <footer><span>⚡ DANCE CHAOS</span><span>La caméra reste sur ton appareil. Rien n'est enregistré.</span></footer>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);

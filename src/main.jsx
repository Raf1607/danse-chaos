import React, { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { createRoot } from "react-dom/client";
import { Camera, CameraOff, Music2, Play, Upload, Trophy, RotateCcw, Volume2, Sparkles, Zap } from "lucide-react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import "./style.css";

const ROUND_SECONDS = 15;
const MATCHMAKING_URL = "https://dance-chaos-matchmaking.onrender.com";
const CRITERIA = [
  { key: "originality", label: "Originalité", max: 25, icon: "✨" },
  { key: "rhythm", label: "Rythme", max: 25, icon: "🥁" },
  { key: "energy", label: "Énergie", max: 20, icon: "⚡" },
  { key: "variety", label: "Variété", max: 15, icon: "🌀" },
  { key: "coordination", label: "Coordination", max: 15, icon: "🕺" }
];

function makeSynthTrack(kind, seed, existingContext = null) {
  const ctx = existingContext || new (window.AudioContext || window.webkitAudioContext)();
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
  const recordDestination = ctx.createMediaStreamDestination();
  gain.gain.value = 0.72;
  source.connect(gain);
  gain.connect(ctx.destination);
  gain.connect(recordDestination);
  return { ctx, source, duration, gain, audioStream: recordDestination.stream, ownsContext: !existingContext };
}

function scoreDance(samples) {
  if (samples.length < 12) return { total: 0, parts: Object.fromEntries(CRITERIA.map(c => [c.key, 0])), message: "La caméra n'a pas détecté assez de mouvements. Place-toi bien dans le cadre et réessaie !" };
  const motions = samples.map(s => s.activity || 0);
  const avg = motions.reduce((a, b) => a + b, 0) / motions.length;
  const active = motions.filter(v => v > 0.035).length / motions.length;
  // A stationary player must not earn points from landmark jitter or a static pose.
  if (avg < 0.018 || active < 0.10) {
    const parts = Object.fromEntries(CRITERIA.map(c => [c.key, 0]));
    return { total: 0, parts, message: "Aucun mouvement détecté. Bouge davantage pendant les 15 secondes !" };
  }
  const peaks = [];
  for (let i = 1; i < motions.length - 1; i++) {
    if (motions[i] >= motions[i - 1] && motions[i] > motions[i + 1] && motions[i] > Math.max(0.018, avg * 1.2)) {
      if (!peaks.length || samples[i].time - samples[peaks[peaks.length - 1]].time >= 0.32) peaks.push(i);
    }
  }
  const intervals = peaks.slice(1).map((p, i) => samples[p].time - samples[peaks[i]].time).filter(v => v >= 0.32 && v <= 1.6);
  let rhythm = 0;
  if (intervals.length >= 2) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
    rhythm = Math.max(0, 1 - sd / Math.max(mean, 0.01) / 0.85) * Math.min(1, intervals.length / 7);
  } else if (intervals.length === 1) rhythm = 0.25;
  const unique = [];
  for (const s of samples) {
    const signature = [s.left, s.right, s.activity];
    if (unique.every(p => Math.abs(p[0] - signature[0]) + Math.abs(p[1] - signature[1]) + Math.abs(p[2] - signature[2]) > 0.12)) unique.push(signature);
  }
  const changes = samples.slice(1).filter((s, i) => Math.abs(s.left - samples[i].left) + Math.abs(s.right - samples[i].right) > 0.12).length;
  const consistency = 1 - Math.min(1, samples.reduce((a, s, i) => a + (i ? Math.abs(s.activity - samples[i - 1].activity) : 0), 0) / samples.length / 0.12);
  const parts = {
    originality: Math.round(25 * Math.min(1, Math.max(0, (unique.length - 1) / 12))),
    rhythm: Math.round(25 * rhythm),
    energy: Math.round(20 * (Math.min(1, Math.max(0, avg - 0.018) / 0.18) * 0.7 + Math.min(1, active / 0.45) * 0.3)),
    variety: Math.round(15 * Math.min(1, changes / (samples.length * 0.35))),
    coordination: Math.round(15 * Math.max(0, Math.min(1, consistency)) * Math.min(1, active / 0.35))
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, parts, message: total >= 85 ? "LÉGENDE DU DANCEFLOOR 🔥" : total >= 65 ? "Très belle performance !" : total >= 40 ? "Pas mal du tout !" : "Le chaos est en toi. Continue !" };
}


function StickDancer() {
  return <div className="memory-dancer">
    <svg className="trend-mascot" viewBox="0 0 240 330" role="img" aria-label="Mascotte lumineuse qui reproduit la chorégraphie">
      <g className="mascot-body">
        <circle className="mascot-head" cx="120" cy="47" r="34"/>
        <path className="mascot-eye" d="M99 48 Q105 39 111 48 M130 48 Q136 39 142 48"/>
        <path className="mascot-smile" d="M108 61 Q120 72 132 61"/>
        <path className="mascot-neck" d="M120 80 L120 91"/>
        <path className="mascot-torso" d="M120 89 Q99 119 105 171 Q120 184 135 171 Q141 119 120 89Z"/>
        <g className="mascot-arm mascot-arm-l"><path d="M108 101 Q83 111 69 136 Q57 151 43 133"/></g>
        <g className="mascot-arm mascot-arm-r"><path d="M132 101 Q157 111 171 136 Q183 151 197 133"/></g>
        <g className="mascot-leg mascot-leg-l"><path d="M111 171 Q91 208 82 248 Q77 268 64 282"/></g>
        <g className="mascot-leg mascot-leg-r"><path d="M129 171 Q149 208 158 248 Q163 268 176 282"/></g>
        <g className="mascot-shoe"><path d="M42 282 Q61 272 79 282 L88 296 Q64 309 38 298Z"/><path d="M161 282 Q179 272 198 282 L203 298 Q176 309 152 296Z"/><path d="M47 291 L78 291 M160 291 L194 291"/></g>
      </g>
    </svg>
    <b>REGARDE ET MÉMORISE !</b><small>Chorégraphie inspirée de ta vidéo · 15 secondes</small>
  </div>;
}
function App() {
  const videoRef = useRef(null), replayVideoRef = useRef(null), musicVideoRef = useRef(null), canvasRef = useRef(null), landmarkerRef = useRef(null);
  const streamRef = useRef(null), rafRef = useRef(null), samplesRef = useRef([]), smoothLandmarksRef = useRef(null);
  const audioRef = useRef(null), synthRef = useRef(null), timerRef = useRef(null), lastPoseRef = useRef(null), lastSampleAtRef = useRef(0), recorderRef = useRef(null), recordingChunksRef = useRef([]), discardRecordingRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false), [loadingCamera, setLoadingCamera] = useState(false);
  const [framingOk, setFramingOk] = useState(false), [framingMessage, setFramingMessage] = useState("Place ta tête et ton haut du corps dans le cadre.");
  const [jamendoTracks, setJamendoTracks] = useState([]), [loadingJamendo, setLoadingJamendo] = useState(false);
  const [phase, setPhase] = useState("home"), [tracks, setTracks] = useState([]);
  const [track, setTrack] = useState(null), [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [score, setScore] = useState(null), [replayUrl, setReplayUrl] = useState(null), [error, setError] = useState("");
  const [volume, setVolume] = useState(0.7), [hint, setHint] = useState("Prêt à mettre le feu ?");
  const [roomCode,setRoomCode]=useState(""),[joinCode,setJoinCode]=useState(""),[playerName,setPlayerName]=useState(""),[roomStatus,setRoomStatus]=useState(""),[roomPlayers,setRoomPlayers]=useState([]),[isRoomHost,setIsRoomHost]=useState(false),[battleResults,setBattleResults]=useState([]);
  const peerRef=useRef(null),connectionsRef=useRef([]),roomPlayersRef=useRef([]),roomResultsRef=useRef([]),battleRef=useRef(false),battleSubmittedRef=useRef(false),finalScoreRef=useRef(null),finalSamplesRef=useRef([]),audioContextRef=useRef(null);
  const [isRandomSearching, setIsRandomSearching] = useState(false);
  const randomPollRef=useRef(null),randomPeerIdRef=useRef(null),randomStartedRef=useRef(false),randomPendingConnRef=useRef(null),randomConnHandlerRef=useRef(null);

  function stopCamera() {
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (landmarkerRef.current) { landmarkerRef.current.close(); landmarkerRef.current = null; }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setFramingOk(false);
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
      smoothLandmarksRef.current = null;
      setCameraOn(true);
      setFramingOk(false);
      setHint("Place ton visage et ton buste dans le cadre.");
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
          let lm = landmarkerRef.current.detectForVideo(video, performance.now()).landmarks?.[0];
          if (lm) {
            // Smooth landmark coordinates to reduce visible dot jitter and false movement.
            const previousLandmarks = smoothLandmarksRef.current;
            lm = lm.map((point, index) => {
              if (!point) return point;
              const previous = previousLandmarks?.[index];
              return previous
                ? { ...point, x: previous.x * 0.6 + point.x * 0.4, y: previous.y * 0.6 + point.y * 0.4 }
                : point;
            });
            smoothLandmarksRef.current = lm;
            const headVisible = (lm[0]?.visibility || 0) > 0.5;
            const torsoVisible = (lm[23]?.visibility || 0) > 0.35 && (lm[24]?.visibility || 0) > 0.35;
            const validFrame = headVisible && torsoVisible;
            setFramingOk(previous => previous === validFrame ? previous : validFrame);
            setFramingMessage(validFrame ? "Cadrage validé : tête et buste détectés." : "Ajuste la caméra : ton visage et ton buste doivent être visibles.");
            if (!validFrame) {
              lastPoseRef.current = null;
              smoothLandmarksRef.current = null;
            } else {
            const ids = [11,12,13,14,15,16,23,24,25,26,27,28];
            const visible = ids.map(i => lm[i]).filter(p => p && p.visibility > 0.35);
            const cx = visible.reduce((a,p) => a+p.x,0) / Math.max(1,visible.length);
            const cy = visible.reduce((a,p) => a+p.y,0) / Math.max(1,visible.length);
            const spread = visible.length ? visible.reduce((a,p) => a+Math.hypot(p.x-cx,p.y-cy),0)/visible.length : 0;
            const left = Math.hypot(lm[15].x-lm[11].x,lm[15].y-lm[11].y);
            const right = Math.hypot(lm[16].x-lm[12].x,lm[16].y-lm[12].y);
            const bodyScale = Math.max(0.08, Math.hypot(lm[12].x-lm[11].x, lm[12].y-lm[11].y));
            const jointIds = [13,14,15,16,25,26,27,28];
            const jointPoints = jointIds.map(id => [lm[id].x, lm[id].y]);
            let movement = 0;
            if (lastPoseRef.current?.points) {
              movement = jointPoints.reduce((sum, point, i) => sum + Math.hypot(point[0]-lastPoseRef.current.points[i][0], point[1]-lastPoseRef.current.points[i][1]), 0) / jointPoints.length / bodyScale;
            }
            const now=performance.now();
            if(now-lastSampleAtRef.current>=100){
              // Ignore tiny pose-estimation fluctuations; only real joint displacement counts.
              const cleanMovement = Math.max(0, movement - 0.012);
              samplesRef.current.push({activity:Math.min(1,cleanMovement*3.5),left,right,time:(now-(window.__danceStartTime||now))/1000});
              lastPoseRef.current = {x:cx,y:cy,points:jointPoints};
              lastSampleAtRef.current=now;
            }
            if (canvasRef.current) {
              const c=canvasRef.current, ctx=c.getContext("2d"); c.width=video.videoWidth; c.height=video.videoHeight;
              ctx.clearRect(0,0,c.width,c.height); ctx.fillStyle="#d7a5ff";
              for (const p of lm) if (p.visibility>.5) {ctx.beginPath();ctx.arc(p.x*c.width,p.y*c.height,4,0,Math.PI*2);ctx.fill();}
            }
            }
          } else {
            setFramingOk(false);
            setFramingMessage("Je ne détecte pas ton visage et ton buste. Replace-toi face à la caméra.");
            lastPoseRef.current = null;
            smoothLandmarksRef.current = null;
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
    const incoming=[...fileList].filter(f=>f.type.startsWith("audio/")||f.type.startsWith("video/")||/\.(mp3|wav|ogg|m4a|mp4|mov|webm)$/i.test(f.name));
    const mapped=incoming.map((file,i)=>({id:file.name+file.size+Date.now()+i,name:file.type.startsWith("video/")?"Audio de ma vidéo":file.name.replace(/\.[^.]+$/,""),type:file.type.startsWith("video/")?"VIDEO":"UPLOAD",file,url:URL.createObjectURL(file)}));
    setTracks(prev=>[...prev,...mapped]);
    if(!mapped.length)setError("Aucun fichier audio ou vidéo compatible trouvé."); else setError("");
  }
  function pickRandomTrack() {
    const originals=[{id:"synth-troll",name:"BIP BIP CHAOS",type:"TROLL"},{id:"synth-arcade",name:"ARCADE PANIC",type:"ARCADE"},{id:"synth-chill",name:"BANANA GROOVE",type:"SYNTH"}];
    const videoReference=tracks.find(t=>t.type==="VIDEO");
    if(videoReference) return {...videoReference,name:"Mauvais Djo · audio de ta vidéo"};
    const options=[...tracks,...jamendoTracks,...(jamendoTracks.length ? [] : originals)];
    const chosen=options[Math.floor(Math.random()*options.length)];
    return chosen.type==="UPLOAD"?chosen:{...chosen,seed:Math.floor(Math.random()*999999)};
  }
  async function playTrackSegment(selected, preview=false) {
    if(audioRef.current){audioRef.current.pause();audioRef.current=null;}
    if(synthRef.current){try{synthRef.current.source.stop();if(synthRef.current.ownsContext)synthRef.current.ctx.close();}catch{} synthRef.current=null;}
    if(selected.type==="VIDEO"){
      const player=musicVideoRef.current;
      if(!player) throw new Error("Le lecteur vidéo de référence n'est pas prêt.");
      player.pause(); player.src=selected.url; player.volume=volume; player.muted=false; audioRef.current=player;
      await new Promise((resolve,reject)=>{if(player.readyState>=1)return resolve();player.onloadedmetadata=resolve;player.onerror=()=>reject(new Error("Impossible de lire l'audio de cette vidéo."));});
      const duration=Number.isFinite(player.duration)?player.duration:40, maxStart=Math.max(0,duration-ROUND_SECONDS);
      player.currentTime=selected.fixedOffset ?? Math.random()*maxStart; selected.fixedOffset=player.currentTime; await player.play();
      if(preview)await new Promise(resolve=>setTimeout(resolve,ROUND_SECONDS*1000));
      return;
    }
    if(selected.type==="UPLOAD" || selected.type==="JAMENDO"){
      const audio=new Audio(); audio.crossOrigin="anonymous"; audio.src=selected.type==="JAMENDO"?selected.audio:selected.url; audio.volume=volume; audioRef.current=audio;
      await new Promise(resolve=>{audio.onloadedmetadata=resolve;audio.onerror=resolve;});
      const duration=audio.duration||40, maxStart=Math.max(0,duration-ROUND_SECONDS);
      audio.currentTime=selected.fixedOffset ?? Math.random()*maxStart; selected.fixedOffset=audio.currentTime; await audio.play();
      if(preview)await new Promise(resolve=>setTimeout(resolve,ROUND_SECONDS*1000));
      return;
    }
    const synth=makeSynthTrack(selected.type,selected.seed,audioContextRef.current); synthRef.current=synth;
    synth.gain.gain.value=volume;
    const maxStart=synth.duration-ROUND_SECONDS, offset=selected.fixedOffset ?? Math.random()*Math.max(0,maxStart); selected.fixedOffset=offset;
    synth.source.start(0,offset);
    if(preview)await new Promise(resolve=>setTimeout(resolve,ROUND_SECONDS*1000));
  }
  async function startGame(battleTrack = null, battleStartAt = null) {
    setError("");setScore(null);
    if (replayUrl) { URL.revokeObjectURL(replayUrl); setReplayUrl(null); }
    discardRecordingRef.current = false;
    if(!cameraOn){setError("Active la caméra avant de lancer une partie.");return;}

    const chosen=battleTrack || pickRandomTrack();battleRef.current=Boolean(battleStartAt);battleSubmittedRef.current=false;finalScoreRef.current=null;finalSamplesRef.current=[];setTrack(chosen);setPhase("memorize");setTimeLeft(ROUND_SECONDS);setHint("MÉMORISE LA CHORÉGRAPHIE !");
    try {
      if(battleStartAt) await new Promise(resolve=>setTimeout(resolve,Math.max(0,battleStartAt-Date.now())));
      let memoryLeft=ROUND_SECONDS;timerRef.current=setInterval(()=>{memoryLeft--;setTimeLeft(memoryLeft);if(memoryLeft<=0)clearInterval(timerRef.current);},1000);
      await playTrackSegment(chosen,true);clearInterval(timerRef.current);
      if(audioRef.current)audioRef.current.pause();
      if(synthRef.current){try{synthRef.current.source.stop();if(synthRef.current.ownsContext)synthRef.current.ctx.close();}catch{}synthRef.current=null;}
      setPhase("dance");setTimeLeft(ROUND_SECONDS);samplesRef.current=[];lastPoseRef.current=null;lastSampleAtRef.current=0;window.__danceStartTime=performance.now();setHint("À TOI ! REPRODUIS LA DANSE DE MÉMOIRE !");
      await playTrackSegment(chosen,false);
      // Capture la vidéo et la musique ensemble pour un replay synchronisé.
      recordingChunksRef.current = [];
      if (streamRef.current && window.MediaRecorder) {
        try {
          let audioTracks = [];
          if (synthRef.current?.audioStream) {
            audioTracks = synthRef.current.audioStream.getAudioTracks();
          } else if (audioRef.current) {
            const capturedAudio = audioRef.current.captureStream ? audioRef.current.captureStream() : audioRef.current.mozCaptureStream ? audioRef.current.mozCaptureStream() : null;
            if (capturedAudio) audioTracks = capturedAudio.getAudioTracks();
          }
          const combinedStream = new MediaStream([...streamRef.current.getVideoTracks(), ...audioTracks]);
          const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
          const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = event => { if (event.data?.size) recordingChunksRef.current.push(event.data); };
          recorder.onstop = () => {
            let blob = null;
            if (!discardRecordingRef.current && recordingChunksRef.current.length) {
              blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "video/webm" });
              setReplayUrl(URL.createObjectURL(blob));
              setHint("Revois ta danse avec la musique et découvre ton score !");
            }
            recordingChunksRef.current = [];
            recorderRef.current = null;
            if (battleRef.current) submitBattleResult(blob);
          };
          recorderRef.current = recorder;
          recorder.start(250);
        } catch (recordError) { recorderRef.current = null; }
      }
      let left=ROUND_SECONDS;
      timerRef.current=setInterval(()=>{
        left--;setTimeLeft(left);
        if(left<=0){clearInterval(timerRef.current);if(audioRef.current)audioRef.current.pause();
          const wasRecording=recorderRef.current?.state === "recording";if(wasRecording) recorderRef.current.stop();
          if(synthRef.current){try{synthRef.current.source.stop();if(synthRef.current.ownsContext)synthRef.current.ctx.close();}catch{}synthRef.current=null;}
          const finalSamples=[...samplesRef.current];finalSamplesRef.current=finalSamples;const finalScore=scoreDance(finalSamples);finalScoreRef.current=finalScore;setScore(finalScore);setPhase("result");setHint("Résultat de ta performance !");if(!wasRecording)submitBattleResult(null);
        }
      },1000);
    } catch {setError("La lecture audio a échoué. Essaie un autre fichier.");setPhase("home");}
  }
  async function unlockBattleAudio(){try{if(!audioContextRef.current||audioContextRef.current.state==="closed")audioContextRef.current=new (window.AudioContext||window.webkitAudioContext)();await audioContextRef.current.resume();}catch{}}
  function closeRoom(){if(randomPollRef.current){clearInterval(randomPollRef.current);randomPollRef.current=null;}if(randomPeerIdRef.current){fetch(MATCHMAKING_URL+"/match/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({peerId:randomPeerIdRef.current})}).catch(()=>{});randomPeerIdRef.current=null;}setIsRandomSearching(false);randomStartedRef.current=false;randomPendingConnRef.current=null;randomConnHandlerRef.current=null;connectionsRef.current.forEach(c=>{try{c.close();}catch{}});connectionsRef.current=[];if(peerRef.current){try{peerRef.current.destroy();}catch{}peerRef.current=null;}roomPlayersRef.current=[];roomResultsRef.current=[];setRoomCode("");setRoomPlayers([]);setBattleResults([]);setRoomStatus("");setIsRoomHost(false);}
  function presentResults(results){const sorted=[...results].sort((a,b)=>b.score.total-a.score.total).map(r=>({...r,videoUrl:r.videoData?URL.createObjectURL(new Blob([r.videoData],{type:"video/webm"})):null}));setBattleResults(sorted);setRoomStatus("Vainqueur : "+(sorted[0]?.name||"") +" — "+(sorted[0]?.score.total||0)+"/100");return sorted;}
  function acceptBattleResult(result){roomResultsRef.current=[...roomResultsRef.current.filter(r=>r.id!==result.id),result];if(roomResultsRef.current.length>=roomPlayersRef.current.length){const sorted=presentResults(roomResultsRef.current);connectionsRef.current.forEach(c=>{if(c.open)c.send({type:"battle-results",results:roomResultsRef.current});});}}
  async function submitBattleResult(blob){if(!battleRef.current||battleSubmittedRef.current)return;battleSubmittedRef.current=true;const scoreValue=finalScoreRef.current||scoreDance(finalSamplesRef.current.length?finalSamplesRef.current:samplesRef.current);let videoData=null;try{if(blob)videoData=await blob.arrayBuffer();}catch{}const result={id:peerRef.current?.id||("player-"+Date.now()),name:playerName.trim()||(isRoomHost?"Hôte":"Joueur"),score:scoreValue,videoData};if(isRoomHost)acceptBattleResult(result);else{const conn=connectionsRef.current[0];if(conn?.open)conn.send({type:"battle-result",result});} }
  function randomPeerOptions(){const u=new URL(MATCHMAKING_URL);return {host:u.hostname,port:u.port?Number(u.port):443,path:"/peerjs",secure:u.protocol==="https:"};}
  function stopRandomPolling(){if(randomPollRef.current){clearInterval(randomPollRef.current);randomPollRef.current=null;}}
  function receiveRandomMessage(data){if(data?.type==="room-info"){roomPlayersRef.current=data.players||roomPlayersRef.current;setRoomPlayers(roomPlayersRef.current);setRoomStatus("Adversaire trouvé ! La battle va commencer.");}if(data?.type==="battle-start"){roomResultsRef.current=[];setBattleResults([]);setRoomStatus("Battle random lancée !");startGame(data.useReferenceVideo&&tracks.some(t=>t.type==="VIDEO")?pickRandomTrack():{id:"random-track",name:"MUSIQUE COMMUNE",type:"ARCADE",seed:data.seed,fixedOffset:0},data.startAt);}if(data?.type==="battle-result"&&isRoomHost)acceptBattleResult(data.result);if(data?.type==="battle-results"){roomResultsRef.current=data.results||[];presentResults(roomResultsRef.current);}}
  function connectRandomOpponent(peer,ownId,partner){
    if(randomStartedRef.current)return;randomStartedRef.current=true;stopRandomPolling();setIsRandomSearching(false);
    const amHost=ownId.localeCompare(partner.peerId)<0;setRoomCode("RANDOM");setIsRoomHost(amHost);
    const players=[{id:ownId,name:playerName.trim()||"Joueur"},{id:partner.peerId,name:partner.name||"Joueur"}];
    roomPlayersRef.current=players;setRoomPlayers(players);setRoomStatus("Adversaire trouvé ! Connexion en cours…");
    const attach=(conn)=>{connectionsRef.current=[conn];conn.on("open",()=>{if(amHost){conn.send({type:"room-info",players});setRoomStatus("Adversaire connecté ! Préparation de la battle…");setTimeout(()=>startRoomBattle(),1200);}else setRoomStatus("Connecté à ton adversaire ! En attente du départ…");});conn.on("data",data=>{if(data?.type==="battle-result"&&amHost)acceptBattleResult(data.result);else receiveRandomMessage(data);});conn.on("close",()=>setRoomStatus("La connexion avec ton adversaire a été interrompue."));conn.on("error",()=>setRoomStatus("Problème de connexion avec ton adversaire."));};
    if(amHost){randomConnHandlerRef.current=attach;if(randomPendingConnRef.current){const pending=randomPendingConnRef.current;randomPendingConnRef.current=null;attach(pending);}}else{attach(peer.connect(partner.peerId,{reliable:true}));}
  }
  async function checkRandomMatch(peer,ownId){try{const r=await fetch(MATCHMAKING_URL+"/match/status?peerId="+encodeURIComponent(ownId));if(!r.ok)throw new Error("serveur");const d=await r.json();if(d.status==="matched"&&d.partner){connectRandomOpponent(peer,ownId,d.partner);}else if(d.status==="not-found"){stopRandomPolling();setIsRandomSearching(false);setRoomStatus("La file d’attente a expiré. Relance le mode random.");}}catch{stopRandomPolling();setIsRandomSearching(false);setRoomStatus("Serveur de matchmaking indisponible. Réessaie dans un instant.");}}
  async function startRandomMode(){if(!cameraOn){setRoomStatus("Active la caméra avant de chercher un adversaire.");return;}closeRoom();setIsRandomSearching(true);setRoomStatus("Connexion au matchmaking…");const ownId="dc-"+(window.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now());randomPeerIdRef.current=ownId;const peer=new Peer(ownId,randomPeerOptions());peerRef.current=peer;peer.on("connection",conn=>{if(randomConnHandlerRef.current)randomConnHandlerRef.current(conn);else randomPendingConnRef.current=conn;});peer.on("open",async()=>{setRoomStatus("Recherche d’un adversaire…");try{const r=await fetch(MATCHMAKING_URL+"/match/join",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({peerId:ownId,name:playerName.trim()||"Joueur"})});if(!r.ok)throw new Error("matchmaking");const d=await r.json();if(d.status==="matched"&&d.partner){connectRandomOpponent(peer,ownId,d.partner);return;}randomPollRef.current=setInterval(()=>checkRandomMatch(peer,ownId),2200);}catch{setIsRandomSearching(false);setRoomStatus("Serveur de matchmaking indisponible. Le serveur doit être activé avant de jouer en random.");}});peer.on("error",e=>{stopRandomPolling();setIsRandomSearching(false);setRoomStatus("Erreur réseau : "+(e.type||"connexion")+".");});}
  function createRoom(){closeRoom();const code=String(Math.floor(100000+Math.random()*900000));const peer=new Peer("dancechaos-"+code);peerRef.current=peer;setRoomStatus("Création du salon…");peer.on("open",()=>{roomPlayersRef.current=[{id:"host",name:playerName.trim()||"Hôte"}];setRoomPlayers(roomPlayersRef.current);setRoomCode(code);setIsRoomHost(true);setRoomStatus("Salon créé : partage le code à tes amis.");});peer.on("connection",conn=>{connectionsRef.current.push(conn);conn.on("open",()=>conn.send({type:"room-info",code}));conn.on("data",data=>{if(data?.type==="join"){roomPlayersRef.current=[...roomPlayersRef.current.filter(p=>p.id!==data.id),{id:data.id,name:data.name||"Joueur"}];setRoomPlayers(roomPlayersRef.current);connectionsRef.current.forEach(c=>{if(c.open)c.send({type:"players",players:roomPlayersRef.current});});}if(data?.type==="battle-result")acceptBattleResult(data.result);});});peer.on("error",e=>setRoomStatus("Erreur réseau : "+(e.type||"connexion")+". Réessaie."));}
  async function joinRoom(){const code=joinCode.replace(/[^0-9]/g,"").slice(0,6);if(code.length!==6){setRoomStatus("Le code doit contenir 6 chiffres.");return;}if(!cameraOn){setRoomStatus("Active la caméra avant de rejoindre.");return;}await unlockBattleAudio();closeRoom();const peer=new Peer();peerRef.current=peer;setRoomStatus("Connexion au salon…");peer.on("open",id=>{const conn=peer.connect("dancechaos-"+code,{reliable:true});connectionsRef.current=[conn];conn.on("open",()=>{conn.send({type:"join",id,name:playerName.trim()||"Joueur"});setRoomCode(code);setIsRoomHost(false);setRoomStatus("Connecté au salon. Active ta caméra avant la battle.");});conn.on("data",data=>{if(data?.type==="room-info")setRoomPlayers([{id:"host",name:"Hôte"}]);if(data?.type==="players"){roomPlayersRef.current=data.players||[];setRoomPlayers(roomPlayersRef.current);}if(data?.type==="battle-start"){roomResultsRef.current=[];setBattleResults([]);setRoomStatus("Battle lancée !");startGame({id:"room-track",name:"MUSIQUE COMMUNE",type:"ARCADE",seed:data.seed,fixedOffset:0},data.startAt);}if(data?.type==="battle-results"){roomResultsRef.current=data.results||[];presentResults(roomResultsRef.current);}});conn.on("error",()=>setRoomStatus("Impossible de rejoindre. Vérifie le code."));});peer.on("error",e=>setRoomStatus("Erreur de connexion : "+(e.type||"réseau")+".")); }
  async function startRoomBattle(){if(!isRoomHost||roomPlayersRef.current.length<2){setRoomStatus("Invite au moins un ami avant de lancer la battle.");return;}if(!cameraOn){setRoomStatus("Active la caméra avant de lancer.");return;}await unlockBattleAudio();roomResultsRef.current=[];setBattleResults([]);const seed=Math.floor(Math.random()*999999),startAt=Date.now()+5000,useReferenceVideo=tracks.some(t=>t.type==="VIDEO");connectionsRef.current.forEach(c=>{if(c.open)c.send({type:"battle-start",seed,startAt,useReferenceVideo});});setRoomStatus(useReferenceVideo?"Importe la même vidéo de référence chez chaque joueur pour entendre la musique commune.":"Même musique pour tous : la battle commence dans 5 secondes !");startGame(useReferenceVideo?pickRandomTrack():{id:"room-track",name:"MUSIQUE COMMUNE",type:"ARCADE",seed,fixedOffset:0},startAt);}
  function clearReplay() {
    if (replayUrl) URL.revokeObjectURL(replayUrl);
    setReplayUrl(null);
    if (replayVideoRef.current) replayVideoRef.current.pause();
  }
  function handleReplayProgress(event) {
    const current = event.currentTarget.currentTime;
    const sourceSamples = finalSamplesRef.current.length ? finalSamplesRef.current : samplesRef.current;
    const partial = sourceSamples.filter(sample => sample.time <= current);
    setScore(scoreDance(partial));
  }
  function finishReplay() {
    setScore(finalScoreRef.current || scoreDance(finalSamplesRef.current.length ? finalSamplesRef.current : samplesRef.current));
    clearReplay();
    setHint("Vidéo supprimée. Ton score final reste affiché !");
  }
  function resetGame() {
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    clearReplay();
    clearInterval(timerRef.current);if(audioRef.current)audioRef.current.pause();
    if(synthRef.current){try{synthRef.current.source.stop();synthRef.current.ctx.close();}catch{}synthRef.current=null;}
    setPhase("home");setScore(null);setTimeLeft(ROUND_SECONDS);setHint("Prêt à mettre le feu ?");
  }
  useEffect(()=>{if(audioRef.current)audioRef.current.volume=volume;if(synthRef.current)synthRef.current.gain.gain.value=volume;},[volume]);

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">⚡</span>DANCE <b>CHAOS</b></a><div className="top-pill"><span className="live-dot"></span> PARTY MODE</div></header>
    <section className="hero"><div className="eyebrow"><Sparkles size={14}/> LE JEU OÙ TOUT PEUT ARRIVER</div><h1>SHOW US<br/><span>YOUR MOVES.</span></h1><p className="subtitle">Une musique surprise. 15 secondes. Zéro jugement. Enfin… presque.</p>
      <div className="stats-row"><div><Music2/><b>ALÉATOIRE</b><small>Musique surprise</small></div><div><Camera/><b>CAMÉRA</b><small>Analyse en direct</small></div><div><Trophy/><b>/100</b><small>Score final</small></div></div>
    </section>
    <section className="game-layout"><div className="play-panel"><div className="panel-head"><span className="panel-label">ZONE DE JEU</span><span className={`phase-tag ${phase}`}>{phase==="home"?"EN ATTENTE":phase==="memorize"?"MÉMORISE":phase==="preview"?"ÉCOUTE":phase==="dance"?"À TOI DE JOUER":"RÉSULTAT"}</span></div>
      <div className={phase==="result"&&replayUrl?"replay-layout":""}><div className="stage"><div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline className={cameraOn?"video visible":"video"}/><video ref={musicVideoRef} playsInline preload="auto" className="music-source-video" aria-hidden="true"/>{phase==="result" && replayUrl && <video ref={replayVideoRef} src={replayUrl} autoPlay controls playsInline className="replay-video" onTimeUpdate={handleReplayProgress} onEnded={finishReplay} onError={()=>setHint("Lecture du replay impossible. Appuie sur lecture dans le lecteur vidéo.")}/>}<canvas ref={canvasRef} className="pose-canvas"/>
        {cameraOn&&!framingOk&&phase!=="result"&&<div className="framing-overlay">ℹ️ {framingMessage} — tu peux quand même jouer</div>}
        {!cameraOn&&<div className="camera-placeholder"><div className="camera-icon"><CameraOff size={32}/></div><b>CAMÉRA EN VEILLE</b><span>Active-la pour analyser tes mouvements</span></div>}
        {phase==="memorize"&&<div className="memory-overlay"><StickDancer/></div>}{phase==="dance"&&<div className="countdown"><span>{timeLeft}</span><small>SECONDES</small></div>}
        {phase==="result"&&replayUrl&&<div className="replay-badge">🎬 REPLAY DE TA DANSE · SCORE EN DIRECT</div>}{phase==="preview"&&<div className="preview-overlay"><span className="sound-wave">♫</span><b>ÉCOUTE LA MUSIQUE</b><small>5 SECONDES POUR DEVINER</small></div>}
      </div><div className="stage-caption"><span className="equalizer"><i/><i/><i/><i/><i/></span>{hint}</div></div>      {score&&<div className="result-card"><div className="result-head"><Trophy size={19}/> {replayUrl ? "TON SCORE EN DIRECT" : "TON SCORE FINAL"}</div><div className="big-score">{score.total}<small>/100</small></div><b className="result-message">{score.message}</b>
        {CRITERIA.map(c=><div className="score-line" key={c.key}><span>{c.label}</span><b>{score.parts[c.key]} / {c.max}</b></div>)}<div className="score-animation-note">{replayUrl ? "Le score évolue pendant le replay. La vidéo sera supprimée à la fin." : "Score final de ta partie de 15 secondes."}</div><button className="replay-btn" onClick={resetGame}><RotateCcw size={15}/> REJOUER</button></div>}</div>
      <div className="controls">{!cameraOn?<button className="secondary-btn" onClick={enableCamera} disabled={loadingCamera}>{loadingCamera?"CHARGEMENT…":<><Camera size={17}/> ACTIVER LA CAMÉRA</>}</button>:<button className="secondary-btn stop-btn" onClick={stopCamera}><CameraOff size={17}/> ARRÊTER LA CAMÉRA</button>}
        {phase==="home"||phase==="result"?<button className="primary-btn" onClick={startGame} disabled={!cameraOn}><Play size={18} fill="currentColor"/> {phase==="result"?"REJOUER":"LANCER LE CHAOS"}</button>:<button className="primary-btn" disabled><Zap size={18}/> {phase==="memorize"?"MÉMORISE…":phase==="preview"?"PRÉPARE-TOI":"EN PLEINE DANSE"}</button>}</div>
      {cameraOn&&<div className={framingOk?"frame-status valid":"frame-status"}>{framingOk?"✓ ":"ℹ️ "}{framingMessage} {framingOk?"":"(cela ne bloque plus la partie)"}</div>}
      {error&&<div className="error-msg">{error}</div>}
      <div className="volume-row"><Volume2 size={16}/><input aria-label="Volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/><span>{Math.round(volume*100)}%</span></div>
    </div>
    <aside className="side-panel">      <div className="side-card room-card"><div className="panel-label">SALON & BATTLES ENTRE AMIS</div>{!roomCode?<><input className="room-name-input" value={playerName} onChange={e=>setPlayerName(e.target.value.slice(0,18))} placeholder="Ton pseudo (18 caractères max)"/><button className="jamendo-btn" onClick={createRoom}>CRÉER UN SALON</button><button className="random-mode-btn" onClick={isRandomSearching?closeRoom:startRandomMode}>{isRandomSearching?"ANNULER LA RECHERCHE":"⚡ JOUER EN MODE RANDOM"}</button><div className="room-join"><input value={joinCode} onChange={e=>setJoinCode(e.target.value.replace(/[^0-9]/g,"").slice(0,6))} placeholder="Code à 6 chiffres" maxLength={6}/><button onClick={joinRoom}>REJOINDRE</button></div></>:<><div className="room-code">CODE DU SALON : <b>{roomCode}</b></div><div className="room-players">{roomPlayers.map((p,i)=><span key={p.id||i}>🕺 {p.name||"Joueur"}</span>)}</div>{isRoomHost&&<button className="jamendo-btn" onClick={startRoomBattle}>LANCER LA BATTLE</button>}<button className="room-close" onClick={closeRoom}>QUITTER LE SALON</button></>}<div className="room-status">{roomStatus}</div><div className="room-privacy">Les replays de la battle sont partagés avec les membres du salon.</div></div>
      {battleResults.length>0&&<div className="side-card battle-results"><div className="panel-label">🏆 CLASSEMENT DE LA BATTLE</div><div className="winner-banner">GAGNANT : {battleResults[0]?.name} · {battleResults[0]?.score.total}/100</div>{battleResults.map((r,i)=><div className="battle-result" key={r.id}><b>{i+1}. {r.name} — {r.score.total}/100</b>{r.videoUrl&&<video src={r.videoUrl} controls playsInline/>}</div>)}</div>}
<div className="side-card"><div className="panel-label">BIBLIOTHÈQUE MUSICALE</div><div className="music-feature"><div className="music-art"><Music2 size={30}/><span>?</span></div><div><b>{track?track.name:"LA PROCHAINE SURPRISE"}</b><small>{track?(track.type==="VIDEO"?"AUDIO EXTRAIT DE TA VIDÉO":track.type==="UPLOAD"?"TON FICHIER":track.type==="JAMENDO"?"JAMENDO · "+track.artist:"PISTE ORIGINALE DU JEU"):"Morceaux indépendants + tes musiques"}</small></div></div>
      <button className="jamendo-btn" onClick={loadJamendoTracks} disabled={loadingJamendo}><Music2 size={16}/> {loadingJamendo?"CHARGEMENT JAMENDO…":"CHARGER DES VRAIES MUSIQUES"}</button>
      <label className="upload-btn"><Upload size={16}/> IMPORTER MUSIQUE OU VIDÉO DE RÉFÉRENCE<input type="file" accept="audio/*,video/*,.mp3,.wav,.ogg,.m4a,.mp4,.mov,.webm" multiple onChange={e=>addFiles(e.target.files)}/></label>
      <div className="library-count">{jamendoTracks.length} titres Jamendo · {tracks.length} fichier{tracks.length>1?"s":""} personnel{tracks.length>1?"s":""}</div>
      {track?.type==="JAMENDO"&&<div className="track-credit">🎵 {track.artist}<br/><a href={track.url} target="_blank" rel="noreferrer">Écouter / voir la licence de ce titre ↗</a></div>}</div>
      <div className="side-card criteria-card"><div className="panel-label">COMMENT TU SERAS NOTÉ</div>{CRITERIA.map(c=><div className="criterion" key={c.key}><div className="criterion-top"><span>{c.icon} {c.label}</span><b>{c.max} PTS</b></div><div className="bar"><i style={{width:`${c.max/25*100}%`}}/></div></div>)}</div>

    </aside></section>
    <footer><span>⚡ DANCE CHAOS</span><span>Replay temporaire enregistré localement sur ton appareil, puis supprimé après lecture.</span></footer>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);

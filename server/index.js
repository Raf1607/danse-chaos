import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { ExpressPeerServer } from "peer";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20kb" }));

const waiting = [];
const matches = new Map();
const lastSeen = new Map();
const MAX_WAIT_MS = 90_000;

function cleanQueue() {
  const now = Date.now();
  for (let i = waiting.length - 1; i >= 0; i--) {
    if (now - waiting[i].lastSeen > MAX_WAIT_MS) waiting.splice(i, 1);
  }
  for (const [id, match] of matches) {
    if (now - (lastSeen.get(id) || 0) > MAX_WAIT_MS) {
      matches.delete(id);
      matches.delete(match.peerId);
    }
  }
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "dance-chaos-matchmaking" }));

app.post("/match/join", (req, res) => {
  cleanQueue();
  const { peerId, name } = req.body || {};
  if (typeof peerId !== "string" || !peerId.startsWith("dc-") || peerId.length > 100) {
    return res.status(400).json({ error: "Identifiant joueur invalide." });
  }
  const safeName = typeof name === "string" ? name.trim().slice(0, 18) : "Joueur";
  lastSeen.set(peerId, Date.now());
  const existing = matches.get(peerId);
  if (existing) return res.json({ status: "matched", partner: existing });
  let own = waiting.find(p => p.peerId === peerId);
  if (own) own.lastSeen = Date.now();
  else { own = { peerId, name: safeName, lastSeen: Date.now() }; waiting.push(own); }
  const partnerIndex = waiting.findIndex(p => p.peerId !== peerId);
  if (partnerIndex !== -1) {
    const partner = waiting.splice(partnerIndex, 1)[0];
    const selfIndex = waiting.findIndex(p => p.peerId === peerId);
    if (selfIndex !== -1) waiting.splice(selfIndex, 1);
    const partnerInfo = { peerId: partner.peerId, name: partner.name };
    const selfInfo = { peerId, name: safeName };
    matches.set(peerId, partnerInfo);
    matches.set(partner.peerId, selfInfo);
    lastSeen.set(partner.peerId, Date.now());
    return res.json({ status: "matched", partner: partnerInfo });
  }
  res.json({ status: "waiting", playersWaiting: waiting.length });
});

app.get("/match/status", (req, res) => {
  cleanQueue();
  const peerId = String(req.query.peerId || "");
  const partner = matches.get(peerId);
  if (partner) {
    lastSeen.set(peerId, Date.now());
    return res.json({ status: "matched", partner });
  }
  const entry = waiting.find(p => p.peerId === peerId);
  if (entry) entry.lastSeen = Date.now();
  res.json({ status: entry ? "waiting" : "not-found", playersWaiting: waiting.length });
});

app.post("/match/leave", (req, res) => {
  const peerId = String(req.body?.peerId || "");
  const index = waiting.findIndex(p => p.peerId === peerId);
  if (index !== -1) waiting.splice(index, 1);
  const partner = matches.get(peerId);
  matches.delete(peerId);
  if (partner) matches.delete(partner.peerId);
  lastSeen.delete(peerId);
  res.json({ ok: true });
});

const server = createServer(app);
const peerServer = ExpressPeerServer(server, { path: "/peerjs", allow_discovery: true });
app.use("/peerjs", peerServer);

const port = Number(process.env.PORT || 10000);
server.listen(port, "0.0.0.0", () => console.log("DANCE CHAOS matchmaking listening on", port));

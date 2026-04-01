const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { v4: uuidv4 } = require("uuid");

const app = express();

app.use(cors({
  origin: ['https://quiz-rui-fe.onrender.com', 'http://localhost:4200'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI, {
  tls: true,
  rejectUnauthorized: false,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000
});

const JWT_SECRET = process.env.JWT_SECRET || "quiz_rui_secret_key";

async function start() {
  await client.connect();
  console.log("Connesso a MongoDB");

  const db = client.db("rui_quiz");
  const quesiti = db.collection("quesiti");
  const progressi = db.collection("progressi");
  const utenti = db.collection("utenti");

  // ── authMiddleware DENTRO start() ────────────────
  async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token mancante' });
    }
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const utente = await utenti.findOne({ username: decoded.username });
      if (!utente || utente.sessionToken !== decoded.sessionToken) {
        return res.status(401).json({ error: 'Sessione non valida o scaduta' });
      }
      req.user = decoded;
      next();
    } catch {
      res.status(401).json({ error: 'Token non valido o scaduto' });
    }
  }

  // ── SEED ADMIN ───────────────────────────────────
  const adminEsiste = await utenti.findOne({ username: "admin" });
  if (!adminEsiste) {
    const hash = await bcrypt.hash("admin123", 10);
    await utenti.insertOne({ username: "admin", password: hash, role: "supervisor", createdAt: new Date() });
    console.log("✅ Admin creato: admin / admin123");
  }

  // ── AUTH ─────────────────────────────────────────

  app.post("/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: "Dati mancanti" });
      const utente = await utenti.findOne({ username });
      if (!utente) return res.status(401).json({ error: "Credenziali non valide" });
      const valida = await bcrypt.compare(password, utente.password);
      if (!valida) return res.status(401).json({ error: "Credenziali non valide" });
      const sessionToken = uuidv4();
      await utenti.updateOne({ username }, { $set: { sessionToken } });
      const token = jwt.sign(
        { username: utente.username, role: utente.role, sessionToken },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      res.json({ token, username: utente.username, role: utente.role });
    } catch {
      res.status(500).json({ error: "Errore login" });
    }
  });

  app.post("/auth/logout", authMiddleware, async (req, res) => {
    try {
      await utenti.updateOne({ username: req.user.username }, { $set: { sessionToken: null } });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Errore logout" });
    }
  });

  app.post("/auth/register", authMiddleware, async (req, res) => {
    try {
      if (req.user.role !== "supervisor") return res.status(403).json({ error: "Non autorizzato" });
      const { username, password, role = "limited" } = req.body;
      if (!username || !password) return res.status(400).json({ error: "Dati mancanti" });
      if (await utenti.findOne({ username })) return res.status(409).json({ error: "Username già esistente" });
      const hash = await bcrypt.hash(password, 10);
      await utenti.insertOne({ username, password: hash, role, createdAt: new Date() });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Errore registrazione" });
    }
  });

  app.get("/auth/utenti", authMiddleware, async (req, res) => {
    try {
      if (req.user.role !== "supervisor") return res.status(403).json({ error: "Non autorizzato" });
      const lista = await utenti.find({}, { projection: { password: 0 } }).toArray();
      res.json(lista);
    } catch {
      res.status(500).json({ error: "Errore" });
    }
  });

  app.delete("/auth/utenti/:username", authMiddleware, async (req, res) => {
    try {
      if (req.user.role !== "supervisor") return res.status(403).json({ error: "Non autorizzato" });
      if (req.params.username === "admin") return res.status(403).json({ error: "Non puoi eliminare admin" });
      await utenti.deleteOne({ username: req.params.username });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Errore eliminazione" });
    }
  });

  app.put("/auth/utenti/:username/password", authMiddleware, async (req, res) => {
    try {
      if (req.user.role !== "supervisor") return res.status(403).json({ error: "Non autorizzato" });
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "Password troppo corta" });
      const hash = await bcrypt.hash(newPassword, 10);
      await utenti.updateOne({ username: req.params.username }, { $set: { password: hash } });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Errore reset password" });
    }
  });

  // ── DOMANDE ──────────────────────────────────────

  app.get("/settori", authMiddleware, async (req, res) => {
    try {
      const settori = await quesiti.distinct("settore");
      res.json([...new Set(settori)].sort());
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore settori" });
    }
  });

  app.get("/materie", authMiddleware, async (req, res) => {
    try {
      const settore = req.query.settore || "tutti";
      const filter = settore !== "tutti" ? { settore } : {};
      const materie = await quesiti.distinct("materia", filter);
      materie.sort((a, b) => a.localeCompare(b, "it"));
      res.json(materie);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel recupero materie" });
    }
  });

  app.get("/domande", authMiddleware, async (req, res) => {
    try {
      const settore = req.query.settore || "tutti";
      const materia = req.query.materia || "tutte";
      const size = parseInt(req.query.size, 10) || 10;
      const match = {};
      if (settore !== "tutti") match.settore = settore;
      if (materia !== "tutte") match.materia = materia;
      const pipeline = [];
      if (Object.keys(match).length > 0) pipeline.push({ $match: match });
      pipeline.push({ $sample: { size } });
      const data = await quesiti.aggregate(pipeline).toArray();
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel recupero domande" });
    }
  });

  // ── PROGRESSI ────────────────────────────────────

  app.get("/progressi", authMiddleware, async (req, res) => {
    try {
      const items = await progressi.find({ username: req.user.username }).toArray();
      const result = {};
      for (const item of items) {
        result[String(item.numero)] = {
          numero: item.numero,
          domanda: item.domanda || "",
          materia: item.materia || "",
          settore: item.settore || "",
          seen: !!item.seen,
          correct: item.correct || 0,
          wrong: item.wrong || 0,
          lastResult: item.lastResult || null
        };
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel recupero progressi" });
    }
  });

  app.post("/progressi", authMiddleware, async (req, res) => {
    try {
      const { numero, domanda, materia, settore, seen, correct, wrong, lastResult } = req.body;
      if (!numero) return res.status(400).json({ error: "Numero domanda mancante" });
      await progressi.updateOne(
        { numero, username: req.user.username },
        {
          $set: {
            numero,
            username: req.user.username,
            domanda: domanda || "",
            materia: materia || "",
            settore: settore || "",
            seen: !!seen,
            correct: correct || 0,
            wrong: wrong || 0,
            lastResult: lastResult || null
          }
        },
        { upsert: true }
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel salvataggio progressi" });
    }
  });

  app.delete("/progressi", authMiddleware, async (req, res) => {
    try {
      const filter = req.user.role === "supervisor" ? {} : { username: req.user.username };
      await progressi.deleteMany(filter);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel reset progressi" });
    }
  });

  app.listen(3000, () => {
    console.log("Server su http://localhost:3000");
  });
}

start().catch(err => {
  console.error("Errore avvio server:", err);
});
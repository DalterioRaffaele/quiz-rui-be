const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
//app.use(express.static(__dirname));

const client = new MongoClient(process.env.MONGO_URI, {
  tls: true,
  tlsAllowInvalidHostnames: true,
  tlsAllowInvalidCertificates: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  family: 4
});


async function start() {
  await client.connect();
  console.log("Connesso a MongoDB");

  const db = client.db("rui_quiz");
  const quesiti = db.collection("quesiti");
  const progressi = db.collection("progressi");

  app.get("/domande", async (req, res) => {
    try {
      const settore = req.query.settore || "tutti";
      const materia = req.query.materia || "tutte";
      const size = parseInt(req.query.size, 10) || 10;

      const match = {};

      if (settore !== "tutti") {
        match.settore = settore;
      }

      if (materia !== "tutte") {
        match.materia = materia;
      }

      const pipeline = [];

      if (Object.keys(match).length > 0) {
        pipeline.push({ $match: match });
      }

      pipeline.push({ $sample: { size } });

      const data = await quesiti.aggregate(pipeline).toArray();
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel recupero domande" });
    }
  });

  app.get("/materie", async (req, res) => {
    try {
      const settore = req.query.settore || "tutti";
      const filter = {};

      if (settore !== "tutti") {
        filter.settore = settore;
      }

      const materie = await quesiti.distinct("materia", filter);
      materie.sort((a, b) => a.localeCompare(b, "it"));
      res.json(materie);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel recupero materie" });
    }
  });

  app.get("/progressi", async (req, res) => {
    try {
      const items = await progressi.find({}).toArray();

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

  app.post("/progressi", async (req, res) => {
    try {
      const {
        numero,
        domanda,
        materia,
        settore,
        seen,
        correct,
        wrong,
        lastResult
      } = req.body;

      if (!numero) {
        return res.status(400).json({ error: "Numero domanda mancante" });
      }

      await progressi.updateOne(
        { numero: numero },
        {
          $set: {
            numero,
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

  app.delete("/progressi", async (req, res) => {
    try {
      await progressi.deleteMany({});
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
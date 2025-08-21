import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import pino from "pino";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import pkg from "amazon-paapi";
const { AmazonApi } = pkg;

dotenv.config();

const logger = pino({ level: "info" });
const app = express();
app.use(express.json());
app.use(pinoHttp({ logger }));

// CORS：必要に応じてドメインを限定
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigin === "*" || origin === allowedOrigin) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
  })
);

// ヘルスチェック
app.get("/health", (_, res) => res.json({ ok: true }));

// ===== Amazon PA-API クライアント =====
const amazon = new AmazonApi({
  accessKey: process.env.PAAPI_ACCESS_KEY,
  secretKey: process.env.PAAPI_SECRET_KEY,
  partnerTag: process.env.PAAPI_PARTNER_TAG,
  country: "JP",
});

// /api/search?keyword=イヤホン&limit=10&index=Electronics
app.get("/api/search", async (req, res) => {
  const keyword = (req.query.keyword || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit || "10", 10), 30);
  const searchIndex = (req.query.index || "All").toString();

  if (!keyword) return res.status(400).json({ error: "keyword is required" });

  try {
    const data = await amazon.searchItems({
      keywords: keyword,
      searchIndex,
      itemCount: limit,
    });

    const items = (data.items || []).map((item) => ({
      asin: item.asin,
      title: item.title,
      url: item.detailPageUrl,
      image: item.images?.large?.url || item.images?.medium?.url || item.images?.small?.url,
      price: item.prices?.price?.displayAmount || null,
      rating: item.reviews?.rating || null,
      totalReviews: item.reviews?.totalReviews || null,
    }));

    res.json({ keyword, searchIndex, count: items.length, items });
  } catch (err) {
    req.log.error({ err }, "PA-API error");
    res.status(500).json({ error: "Amazon API error" });
  }
});

// /api/suggest?q=イヤホン
app.get("/api/suggest", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "q is required" });

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(
      q
    )}&hl=ja`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`Suggest HTTP ${r.status}`);
    const json = await r.json(); // ["q", ["q a","q b", ...]]
    const suggestions = Array.isArray(json?.[1]) ? json[1] : [];
    res.json({
      q,
      suggestions,
      rakkokeywordLinks: suggestions.map((s) => ({
        keyword: s,
        url: `https://rakkokeyword.com/result/relatedKeywords?q=${encodeURIComponent(s)}`,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Suggest error");
    res.status(500).json({ error: "Suggest error" });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  logger.info(`Server listening on :${port}`);
});

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import nacl from "tweetnacl";

const app = express();
const PORT = process.env.PORT || 10000;

const {
  DISCORD_BOT_TOKEN,
  DISCORD_PUBLIC_KEY,
  DISCORD_CHANNEL_ID,
} = process.env;

// ===== 업로드 폴더 =====
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ===== multer =====
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) =>
      cb(null, Date.now() + path.extname(file.originalname)),
  }),
});

// ===== 메모리 저장 =====
const requests = {};

// ===== 정적 파일 =====
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// ===== 메인 페이지 =====
app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public/index.html"));
});

// ===== 업로드 =====
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const id = Date.now().toString();
    const imageUrl = `https://${req.get("host")}/uploads/${path.basename(
      req.file.path
    )}`;

    requests[id] = { status: "pending" };

    const discordRes = await fetch(
      `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: `@everyone 얼굴 평가 요청\nID: ${id}`,
          allowed_mentions: { parse: ["everyone"] },
          embeds: [{ image: { url: imageUrl } }],
          components: [
            {
              type: 1,
              components: [
                { type: 2, label: "잘생김", style: 1, custom_id: `rate:${id}:잘생김` },
                { type: 2, label: "예쁨", style: 1, custom_id: `rate:${id}:예쁨` },
                { type: 2, label: "귀여움", style: 1, custom_id: `rate:${id}:귀여움` },
                { type: 2, label: "못생김", style: 4, custom_id: `rate:${id}:못생김` },
              ],
            },
          ],
        }),
      }
    );

    if (!discordRes.ok) {
      const t = await discordRes.text();
      console.error("Discord error:", t);
    }

    res.json({ id, status: "pending", imageUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "upload failed" });
  }
});

// ===== Discord Interactions =====
app.post(
  "/discord/interactions",
  express.json({
    verify: (req, _, buf) => (req.rawBody = buf),
  }),
  (req, res) => {
    const sig = req.headers["x-signature-ed25519"];
    const ts = req.headers["x-signature-timestamp"];

    const ok = nacl.sign.detached.verify(
      Buffer.from(ts + req.rawBody),
      Buffer.from(sig, "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex")
    );

    if (!ok) return res.status(401).end("bad signature");

    const { type, data } = req.body;

    if (type === 1) return res.json({ type: 1 });

    if (type === 3) {
      const [, id, result] = data.custom_id.split(":");
      requests[id] = { status: "done", result };

      return res.json({
        type: 4,
        data: { content: `결과: **${result}**`, flags: 64 },
      });
    }

    res.json({ type: 5 });
  }
);

// ===== 시작 =====
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

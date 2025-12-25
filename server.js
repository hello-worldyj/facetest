import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import nacl from "tweetnacl";

const app = express();
const PORT = process.env.PORT || 10000;

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) =>
      cb(null, Date.now() + path.extname(file.originalname)),
  }),
});

const requests = {}; // { id: { imageUrl, status, result } }

app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));
app.use(express.json({
  verify: (req, _, buf) => (req.rawBody = buf),
}));

app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// 업로드 처리
app.post("/upload", upload.single("photo"), async (req, res) => {
  const id = Date.now().toString();
  const imageUrl = `/uploads/${path.basename(req.file.path)}`;

  requests[id] = { status: "pending", result: null, imageUrl };

  // 디스코드 메시지 전송 (버튼 포함)
  await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: `@everyone 얼굴 평가 요청\nID: ${id}\n버튼을 누르거나\n\`!rate ${id} 잘생김\` 처럼 입력`,
      components: [
        {
          type: 1,
          components: [
            { type: 2, label: "잘생김", style: 1, custom_id: `rate:${id}:잘생김` },
            { type: 2, label: "예쁨", style: 1, custom_id: `rate:${id}:예쁨` },
            { type: 2, label: "귀여움", style: 1, custom_id: `rate:${id}:귀여움` },
            { type: 2, label: "못생김", style: 4, custom_id: `rate:${id}:못생김` }
          ],
        },
      ],
      embeds: [
        {
          title: "AI 얼굴 평가",
          description: "아래 버튼으로 평가해주세요.",
          image: { url: `https://${req.get("host")}${imageUrl}` },
          timestamp: new Date().toISOString(),
          color: 5814783,
        },
      ],
    }),
  });

  res.json({ id, status: "pending", imageUrl });
});

// 디스코드 인터랙션 처리
app.post("/discord/interactions", (req, res) => {
  const sig = req.headers["x-signature-ed25519"];
  const ts = req.headers["x-signature-timestamp"];

  const verified = nacl.sign.detached.verify(
    Buffer.from(ts + req.rawBody),
    Buffer.from(sig, "hex"),
    Buffer.from(DISCORD_PUBLIC_KEY, "hex")
  );

  if (!verified) return res.status(401).end("Invalid request signature");

  const { type, data } = req.body;

  if (type === 1) return res.json({ type: 1 }); // Ping

  if (type === 3) {
    const [_, id, result] = data.custom_id.split(":");

    if (!requests[id]) {
      return res.json({
        type: 4,
        data: { content: "존재하지 않는 요청입니다.", flags: 64 },
      });
    }

    if (requests[id].status === "done") {
      return res.json({
        type: 4,
        data: { content: "이미 평가가 완료된 요청입니다.", flags: 64 },
      });
    }

    requests[id].status = "done";
    requests[id].result = result;

    return res.json({
      type: 4,
      data: { content: `판정 완료: **${result}**`, flags: 64 },
    });
  }

  return res.json({ type: 5 });
});

// 상태 조회 API (폴링용)
app.get("/status/:id", (req, res) => {
  const id = req.params.id;
  if (!requests[id]) return res.status(404).json({ error: "Not found" });
  res.json(requests[id]);
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

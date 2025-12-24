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

// ===== 업로드 폴더 =====
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ===== multer 설정 =====
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

// ===== 임시 저장소 =====
const requests = {}; // { id: { status, result } }

// ===== 정적 파일 =====
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// ===== 메인 페이지 =====
app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// ===== 사진 업로드 =====
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const id = Date.now().toString();
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${path.basename(
      req.file.path
    )}`;

    requests[id] = { status: "pending", result: null };

    // Discord 메시지 (버튼 포함)
    await fetch(
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
          embeds: [
            {
              title: "업로드된 사진",
              image: { url: imageUrl },
            },
          ],
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

    res.json({ id, status: "pending", imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "업로드 실패" });
  }
});

// ===== Discord Interactions =====
app.post(
  "/discord/interactions",
  express.json({
    verify: (req, _, buf) => {
      req.rawBody = buf;
    },
  }),
  (req, res) => {
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];

    const isValid = nacl.sign.detached.verify(
      Buffer.from(timestamp + req.rawBody),
      Buffer.from(signature, "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex")
    );

    if (!isValid) {
      return res.status(401).send("Invalid request signature");
    }

    const { type, data } = req.body;

    // Discord Ping
    if (type === 1) {
      return res.json({ type: 1 });
    }

    // 버튼 클릭
    if (type === 3) {
      const [_, id, result] = data.custom_id.split(":");

      if (!requests[id] || requests[id].status === "done") {
        return res.json({
          type: 4,
          data: {
            content: "이미 판정된 요청입니다.",
            flags: 64,
          },
        });
      }

      requests[id] = { status: "done", result };

      return res.json({
        type: 4,
        data: {
          content: `판정 완료: **${result}**`,
          flags: 64,
        },
      });
    }

    return res.json({ type: 5 });
  }
);

// ===== 서버 시작 =====
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

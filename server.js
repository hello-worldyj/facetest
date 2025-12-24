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

if (!DISCORD_BOT_TOKEN || !DISCORD_PUBLIC_KEY || !DISCORD_CHANNEL_ID) {
  console.error(
    "⚠️ 필수 환경변수(DISCOED_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_CHANNEL_ID)가 설정되지 않았습니다!"
  );
  process.exit(1);
}

// 업로드 폴더 생성
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// multer 세팅
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) =>
      cb(null, Date.now() + path.extname(file.originalname)),
  }),
});

// 임시 저장소 (DB 없이 메모리)
const requests = {}; // { id: { imageUrl, status, result } }

// 정적 파일 제공
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// 메인 페이지 제공
app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// 사진 업로드 처리
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const id = Date.now().toString();
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${path.basename(
      req.file.path
    )}`;

    requests[id] = { status: "pending", result: null, imageUrl };

    // Discord에 메시지 전송 (버튼 포함)
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `@everyone 얼굴 평가 요청\nID: ${id}\n\n아래 버튼을 클릭하거나, \`!rate ${id} 잘생김\` 같은 채팅 명령어로 평가해주세요.`,
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
        embeds: [
          {
            title: "평가할 얼굴 사진",
            image: { url: imageUrl },
            color: 5814783,
            timestamp: new Date().toISOString(),
            footer: { text: "Face Review Bot" },
          },
        ],
      }),
    });

    res.json({ id, status: "pending", imageUrl });
  } catch (e) {
    console.error("업로드 처리 중 오류:", e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// Discord Interaction 검증 및 처리
app.post(
  "/discord/interactions",
  express.json({
    verify: (req, _, buf) => (req.rawBody = buf),
  }),
  (req, res) => {
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];

    if (
      !signature ||
      !timestamp ||
      !nacl.sign.detached.verify(
        Buffer.from(timestamp + req.rawBody),
        Buffer.from(signature, "hex"),
        Buffer.from(DISCORD_PUBLIC_KEY, "hex")
      )
    ) {
      return res.status(401).end("Invalid request signature");
    }

    const { type, data } = req.body;

    // Ping 요청에 응답
    if (type === 1) {
      return res.json({ type: 1 });
    }

    // 버튼 클릭(인터랙션)
    if (type === 3) {
      const [_, id, result] = data.custom_id.split(":");
      if (!requests[id]) {
        return res.json({
          type: 4,
          data: { content: "존재하지 않는 평가 요청입니다.", flags: 64 },
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
        data: {
          content: `평가 완료: **${result}**`,
          flags: 64,
        },
      });
    }

    return res.status(400).end();
  }
);

// 텍스트 명령 처리 (!rate 명령어)
app.post("/discord/message", express.json(), (req, res) => {
  const { content } = req.body;

  if (!content || !content.startsWith("!rate")) return res.sendStatus(200);

  const parts = content.split(" ");
  if (parts.length !== 3) return res.sendStatus(200);

  const [, id, result] = parts;

  if (!requests[id]) return res.sendStatus(200);
  if (requests[id].status === "done") return res.sendStatus(200);

  requests[id].status = "done";
  requests[id].result = result;

  res.sendStatus(200);
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

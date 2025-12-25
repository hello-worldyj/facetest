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

// 임시 메모리 저장소 (id: { imageUrl, status, result })
const requests = {};

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// 사진 업로드 API
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const id = Date.now().toString();
    const imageUrl = `/uploads/${path.basename(req.file.path)}`;

    requests[id] = { status: "pending", result: null, imageUrl };

    // 디스코드 채널에 평가 요청 메시지 + 버튼 보내기
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `@everyone 얼굴 평가 요청\nID: ${id}\n버튼을 눌러 평가하거나 \`!rate ${id} 결과\` 형식으로 타이핑하세요.`,
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
            title: "평가할 사진",
            image: { url: `${req.protocol}://${req.get("host")}${imageUrl}` },
            color: 5814783,
          },
        ],
      }),
    });

    res.json({ id, status: "pending", imageUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "업로드 중 오류 발생" });
  }
});

// 디스코드 인터랙션 검증 및 처리
app.post("/discord/interactions", (req, res) => {
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];

  const isValid = nacl.sign.detached.verify(
    Buffer.from(timestamp + req.rawBody),
    Buffer.from(signature, "hex"),
    Buffer.from(DISCORD_PUBLIC_KEY, "hex")
  );

  if (!isValid) return res.status(401).send("Invalid request signature");

  const body = req.body;

  // Discord Ping 확인
  if (body.type === 1) {
    return res.json({ type: 1 });
  }

  // 버튼 클릭 이벤트
  if (body.type === 3) {
    const [action, id, result] = body.data.custom_id.split(":");
    if (action !== "rate" || !requests[id]) {
      return res.json({
        type: 4,
        data: { content: "잘못된 요청입니다.", flags: 64 },
      });
    }

    if (requests[id].status === "done") {
      return res.json({
        type: 4,
        data: { content: "이미 평가가 완료된 요청입니다.", flags: 64 },
      });
    }

    // 평가 결과 저장
    requests[id].status = "done";
    requests[id].result = result;

    // 디스코드에 응답 (에페 메시지)
    return res.json({
      type: 4,
      data: {
        content: `평가 완료: **${result}**`,
        flags: 64,
      },
    });
  }

  res.json({ type: 5 });
});

// 클라이언트가 평가 결과 확인 요청 API
app.get("/result/:id", (req, res) => {
  const id = req.params.id;
  const info = requests[id];
  if (!info) return res.status(404).json({ error: "존재하지 않는 평가 ID입니다." });

  res.json(info);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

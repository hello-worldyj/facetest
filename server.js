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
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // 평가 메시지 보낼 채널 ID

// ===== 업로드 폴더 =====
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ===== multer 설정 =====
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) =>
      cb(null, Date.now() + path.extname(file.originalname)),
  }),
});

// ===== 임시 저장소 (DB 대체) =====
const requests = {}; // { id: { imageUrl, status, result } }

// ===== 정적 파일 제공 =====
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// ===== 메인 페이지 =====
app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// ===== 사진 업로드 엔드포인트 =====
app.post("/upload", upload.single("photo"), async (req, res) => {
  const id = Date.now().toString();
  const imageUrl = `/uploads/${path.basename(req.file.path)}`;

  requests[id] = { status: "pending", result: null };

  // Discord 메시지 전송 (평가 버튼 포함)
  await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: `@all 얼굴 평가 요청\nID: ${id}\n\n버튼을 누르거나\n\`!rate ${id} 잘생김\` 처럼 입력`,
      components: [
        {
          type: 1,
          components: [
            { type: 2, label: "잘생김", style: 1, custom_id: `rate:${id}:잘생김` },
            { type: 2, label: "예쁨", style: 1, custom_id: `rate:${id}:예쁨` },
            { type: 2, label: "귀여움", style: 1, custom_id: `rate:${id}:귀여움` },
            { type: 2, label: "못생김", style: 4, custom_id: `rate:${id}:못생김` }
          ]
        }
      ]
    })
  });

  res.json({ id, status: "pending", imageUrl });
});

// ===== Discord Interaction 검증 및 처리 =====
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

    if (!ok) return res.status(401).end("bad request");

    const { type, data } = req.body;

    // Ping 확인용
    if (type === 1) return res.json({ type: 1 });

    // 버튼 클릭 처리
    if (type === 3) {
      const [_, id, result] = data.custom_id.split(":");
      if (!requests[id] || requests[id].status === "done") {
        return res.json({
          type: 4,
          data: { content: "이미 판정된 요청입니다.", flags: 64 }
        });
      }

      requests[id] = { ...requests[id], status: "done", result };

      return res.json({
        type: 4,
        data: {
          content: `판정 완료: **${result}**`,
          flags: 64
        }
      });
    }

    return res.json({ type: 5 });
  }
);

// ===== !rate 명령어 텍스트 판정 처리 (수정된 부분) =====
app.post("/discord/message", express.json(), (req, res) => {
  const { content } = req.body;
  if (!content?.startsWith("!rate")) return res.sendStatus(200);

  const parts = content.trim().split(" ");
  if (parts.length < 3) return res.sendStatus(200);

  const id = parts[1];
  const result = parts.slice(2).join(" "); // 띄어쓰기 포함 결과 처리

  if (!requests[id] || requests[id].status === "done") return res.sendStatus(200);

  requests[id] = { ...requests[id], status: "done", result };

  res.sendStatus(200);
});

// ===== 서버 시작 =====
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

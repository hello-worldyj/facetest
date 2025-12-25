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

// 업로드 폴더 준비
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// multer 설정
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) =>
      cb(null, Date.now() + path.extname(file.originalname)),
  }),
});

// 임시 저장소
const requests = {};

// 정적파일 서비스
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// 메인 페이지
app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// 업로드 처리
app.post("/upload", upload.single("photo"), async (req, res) => {
  const id = Date.now().toString();
  const imageUrl = `/uploads/${path.basename(req.file.path)}`;

  requests[id] = { status: "pending", result: null, imageUrl };

  // Discord 메시지 전송 (버튼 포함)
  await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: `@everyone 얼굴 평가 요청\nID: ${id}`,
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
      // 파일 첨부 없이 메시지 보내는 기본 구조 (사진은 미리보기로 표시할 예정)
    }),
  });

  res.json({ id, status: "pending", imageUrl });
});

// Discord Interaction 검증 및 처리
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

    // Ping
    if (type === 1) return res.json({ type: 1 });

    // 버튼 클릭
    if (type === 3) {
      const [_, id, result] = data.custom_id.split(":");
      if (!requests[id] || requests[id].status === "done") {
        return res.json({
          type: 4,
          data: { content: "이미 판정된 요청입니다.", flags: 64 },
        });
      }

      requests[id].status = "done";
      requests[id].result = result;

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

// 평가 결과 조회 API
app.get("/result/:id", (req, res) => {
  const id = req.params.id;
  if (!requests[id]) return res.status(404).json({ error: "요청이 없습니다." });

  res.json(requests[id]);
});

// 시작
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

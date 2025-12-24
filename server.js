import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import nacl from "tweetnacl";

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ 환경변수 (이름 절대 안 바꿈)
const {
  DISCORD_WEBHOOK_URL,
  DISCORD_PUBLIC_KEY,
} = process.env;

// ================= 업로드 폴더 =================
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ================= multer =================
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

// ================= 임시 저장 =================
const requests = {}; // { id: { status, result } }

// ================= 미들웨어 =================
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// ================= 메인 페이지 =================
app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public/index.html"));
});

// ================= 사진 업로드 =================
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const id = Date.now().toString();
    const imageUrl = `https://${req.get("host")}/uploads/${path.basename(
      req.file.path
    )}`;

    requests[id] = { status: "pending" };

    // ✅ Discord Webhook으로 전송
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `📸 얼굴 평가 요청\nID: ${id}`,
        embeds: [
          {
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
    });

    res.json({ id, status: "pending", imageUrl });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: "upload failed" });
  }
});

// ================= Discord Interactions =================
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
      return res.status(401).end("Invalid signature");
    }

    const { type, data } = req.body;

    // Ping
    if (type === 1) {
      return res.json({ type: 1 });
    }

    // 버튼 클릭
    if (type === 3) {
      const [, id, result] = data.custom_id.split(":");

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
          flags: 64, // 누른 사람만 보임
        },
      });
    }

    return res.json({ type: 5 });
  }
);

// ================= 서버 시작 =================
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

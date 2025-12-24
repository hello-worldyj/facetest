import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 10000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!DISCORD_WEBHOOK_URL) {
  console.error("⚠️ DISCORD_WEBHOOK_URL 환경변수가 설정되지 않음");
  process.exit(1);
}

app.use(express.json());

// ===== uploads 폴더 보장 =====
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ===== multer 설정 =====
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});
const upload = multer({ storage });

// ===== 정적 파일 =====
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// ===== 메인 =====
app.get("/", (req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// ===== 업로드 =====
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const { score, percent, feedback } = req.body;
    const fileName = path.basename(req.file.path);
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;

    // Discord payload
    const payload = {
      content: "📸 새 얼굴 테스트 결과",
      embeds: [
        {
          title: "AI 얼굴 분석 (MediaPipe)",
          description: `점수: **${score} / 10**\n상위 **${percent}%**\n${feedback}`,
          image: { url: imageUrl },
          color: 5814783,
          footer: { text: "Face Review Bot" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));

    const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    if (!discordRes.ok) {
      throw new Error("Discord 전송 실패");
    }

    res.json({ score, percent, feedback, imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Server running on ${PORT}`);
});

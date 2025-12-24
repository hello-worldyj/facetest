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
  console.error("⚠️ DISCORD_WEBHOOK_URL 환경변수가 설정되어 있지 않습니다!");
  process.exit(1);
}

// 업로드 폴더 준비
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// multer 세팅
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileName = path.basename(filePath);
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;

    const payload = {
      content: "📸 새 얼굴 평가 요청!",
      embeds: [
        {
          title: "AI 얼굴 평가 결과",
          description: "사진과 함께 평가 결과를 확인하세요.",
          color: 5814783,
          image: { url: imageUrl },
          footer: { text: "Face Review Bot" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));

    const discordResponse = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    if (!discordResponse.ok) {
      const text = await discordResponse.text();
      throw new Error(`Discord 전송 오류: ${discordResponse.status} ${text}`);
    }

    res.json({ status: "success", imageUrl });
  } catch (e) {
    console.error("업로드 처리 오류:", e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});

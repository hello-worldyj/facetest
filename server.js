<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>AI 얼굴 평가</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f766e, #14b8a6);
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      color: #fff;
    }
    .card {
      width: 340px;
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(18px);
      border-radius: 22px;
      padding: 26px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.3);
      text-align: center;
    }
    h1 { margin-bottom: 16px; font-size: 22px; }
    input[type="file"] {
      width: 100%; padding: 14px; border-radius: 14px;
      border: none; background: rgba(255,255,255,0.2); color: #fff;
    }
    button {
      margin-top: 14px; width: 100%; padding: 14px;
      border-radius: 14px; border: none;
      font-size: 16px; background: #2dd4bf;
      color: #042f2e; font-weight: 700;
      cursor: pointer;
    }
    .preview img {
      width: 100%; margin-top: 16px;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    }
    .result {
      margin-top: 18px;
      background: rgba(0,0,0,0.25);
      border-radius: 16px;
      padding: 14px;
      font-size: 15px;
    }
    .score { font-size: 20px; font-weight: 800; }
    .percent { color: #99f6e4; font-weight: 700; margin: 6px 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>AI 얼굴 평가</h1>
    <form id="form">
      <input type="file" name="photo" accept="image/*" required />
      <button type="submit">평가하기</button>
    </form>
    <div class="preview" id="preview"></div>
    <div class="result" id="result" style="display:none;"></div>
  </div>

  <script>
    const form = document.getElementById("form");
    const preview = document.getElementById("preview");
    const result = document.getElementById("result");
    const fileInput = document.querySelector("input[type=file]");
    let currentId = null;
    let pollingInterval = null;

    fileInput.addEventListener("change", () => {
      preview.innerHTML = `<img src="${URL.createObjectURL(fileInput.files[0])}" alt="선택한 사진" />`;
      result.style.display = "none";
      result.textContent = "";
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!fileInput.files.length) {
        alert("사진은여?.");
        return;
      }

      result.style.display = "block";
      result.textContent = "ㄱㄷㄷㄷㄷ...";

      try {
        const res = await fetch("/upload", {
          method: "POST",
          body: new FormData(form),
        });

        if (!res.ok) throw new Error("서버 에러");

        const data = await res.json();
        currentId = data.id;

        // 3초마다 서버에 상태 확인
        pollingInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/status/${currentId}`);
            if (!statusRes.ok) throw new Error("상태 조회 실패");
            const statusData = await statusRes.json();

            if (statusData.status === "done") {
              clearInterval(pollingInterval);
              pollingInterval = null;
              result.innerHTML = `
                <div class="feedback">평가 결과: ${statusData.result}</div>
                <img src="${statusData.imageUrl}" alt="사진" style="margin-top:12px; border-radius:16px; width:100%;" />
              `;
            } else {
              result.textContent = "기달려";
            }
          } catch (err) {
            result.textContent = `병민한테 보내샘: ${err.message}`;
            clearInterval(pollingInterval);
          }
        }, 3000);
      } catch (err) {
        result.textContent = `병민한테 보내샘: ${err.message}`;
      }
    });
  </script>
</body>
</html>

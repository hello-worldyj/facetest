const input = document.getElementById("file");
const preview = document.getElementById("preview");
const result = document.getElementById("result");

let latestResult = null;

// MediaPipe 설정
const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
});

faceMesh.onResults((res) => {
  if (!res.multiFaceLandmarks.length) {
    result.style.display = "block";
    result.innerText = "얼굴 인식 실패 딴 사진 시도";
    return;
  }

  const lm = res.multiFaceLandmarks[0];
  const leftEye = lm[33];
  const rightEye = lm[263];

  const eyeDistance = Math.abs(leftEye.x - rightEye.x);

  const score = Math.min(10, Math.max(5, eyeDistance * 30)).toFixed(1);
  const percent = Math.round(100 - score * 10);

  let feedback = "개성이 느껴지는 얼굴입니다.";
  if (percent <= 5) feedback = "연예인급 외모입니다.";
  else if (percent <= 15) feedback = "상위권 외모입니다.";
  else if (percent <= 30) feedback = "호감형 얼굴입니다.";

  latestResult = { score, percent, feedback };

  result.style.display = "block";
  result.innerHTML = `
    <b>점수:</b> ${score} / 10<br/>
    <b>상위:</b> ${percent}%<br/>
    ${feedback}
  `;
});

// 파일 선택
input.addEventListener("change", () => {
  const file = input.files[0];
  if (!file) return;

  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
  result.style.display = "block";
  result.innerText = "ㄱㄷ...";
});

// 이미지 로드 → 분석 → 서버 전송
preview.onload = async () => {
  await faceMesh.send({ image: preview });

  if (!latestResult) return;

  const formData = new FormData();
  formData.append("photo", input.files[0]);
  formData.append("score", latestResult.score);
  formData.append("percent", latestResult.percent);
  formData.append("feedback", latestResult.feedback);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
};

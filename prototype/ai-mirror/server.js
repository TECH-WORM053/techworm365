// AI Mirror 프로토타입 서버
// 역할: ① public/ 폴더의 화면 파일 제공  ② 브라우저가 보낸 사진을 Claude에 전달해 해석 받기
// API 키는 이 서버 안에서만 쓰이고 브라우저로는 절대 나가지 않습니다.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3737;

// ─── 조절할 수 있는 값들 ────────────────────────────────────────
const MODEL = "claude-opus-4-8";
// effort: 응답 품질↔속도 조절. "low"(빠름) / "medium"(균형) / "high"(깊음)
const EFFORT = process.env.EFFORT || "medium";
// DEMO=1 로 실행하면 API를 호출하지 않고 준비된 문장을 보여줍니다 (비용 0원)
const FORCE_DEMO = process.env.DEMO === "1";
// ────────────────────────────────────────────────────────────────

const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 또는 로그인된 프로필을 자동으로 찾습니다

const SYSTEM_PROMPT = `당신은 젠틀몬스터 매장에 설치된 'AI Mirror'입니다.
거울 앞에 선 사람의 사진을 보고, 그 사람을 시적으로 해석합니다.

원칙:
1. 거울은 판매하지 않습니다. 해석할 뿐입니다. 제품 추천이나 구매 권유를 하지 않습니다.
2. '근거 있는 시' 방식을 씁니다: 사진에서 실제로 관찰 가능한 사실 하나(앵커)를 찾고,
   그 사실이 자연스럽게 스며든 시적인 한 문장을 만듭니다.
   예: "오늘의 당신은 차분한 직선 — 어깨의 각이 그렇게 말합니다."
3. 외모를 평가하지 않습니다. (예쁘다, 잘생겼다, 피부, 체형 등 금지)
   대신 인상, 분위기, 선, 색, 빛, 자세 같은 것을 읽습니다.
4. 사람의 신원을 추측하거나 특정하지 않습니다.
5. sentence는 한국어 한 문장, 15~45자. 과장 없이, 낯설지만 다정하게.
6. anchor는 사진에서 관찰한 사실을 아주 짧게. (예: "왼쪽으로 살짝 기운 시선")
7. mood_word는 무드를 담은 한 단어. (예: "고요", "직선", "새벽")
8. mood_tone은 화면 연출용 톤 분류입니다. 사진의 분위기에 가장 가까운 것을 고르세요.`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    anchor: { type: "string", description: "사진에서 관찰한 사실 하나 (짧게)" },
    mood_word: { type: "string", description: "무드를 담은 한 단어" },
    mood_tone: {
      type: "string",
      enum: ["warm", "cool", "calm", "vivid", "mono"],
      description: "화면 연출용 톤",
    },
    sentence: { type: "string", description: "근거 있는 시 한 문장 (한국어)" },
  },
  required: ["anchor", "mood_word", "mood_tone", "sentence"],
  additionalProperties: false,
};

// 데모 모드에서 순환하며 보여줄 문장들
const DEMO_RESULTS = [
  {
    anchor: "정면을 똑바로 향한 시선",
    mood_word: "직선",
    mood_tone: "mono",
    sentence: "오늘의 당신은 흔들리지 않는 직선 — 시선이 먼저 도착해 있습니다.",
  },
  {
    anchor: "부드럽게 내려온 어깨",
    mood_word: "고요",
    mood_tone: "calm",
    sentence: "어깨가 먼저 쉬고 있네요. 오늘의 당신은 소리 없는 물결입니다.",
  },
  {
    anchor: "화면 밖을 향한 옅은 미소",
    mood_word: "새벽",
    mood_tone: "warm",
    sentence: "입가에 남은 새벽빛 — 당신은 아직 오지 않은 하루를 먼저 웃고 있습니다.",
  },
];
let demoIndex = 0;

async function interpretWithClaude(imageBase64, mediaType) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: RESULT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: "지금 거울 앞에 선 사람을 해석해 주세요." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return { error: "이 사진은 해석할 수 없었습니다. 다시 시도해 주세요." };
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    return { error: "해석 결과가 비어 있습니다. 다시 시도해 주세요." };
  }
  return JSON.parse(textBlock.text);
}

function demoResult() {
  const result = DEMO_RESULTS[demoIndex % DEMO_RESULTS.length];
  demoIndex += 1;
  return result;
}

async function handleInterpret(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) {
      sendJson(res, 413, { error: "사진이 너무 큽니다." });
      return;
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "요청 형식이 잘못되었습니다." });
    return;
  }
  if (!body.image || !body.media_type) {
    sendJson(res, 400, { error: "사진 데이터가 없습니다." });
    return;
  }

  const started = Date.now();

  if (FORCE_DEMO) {
    await new Promise((r) => setTimeout(r, 1200)); // 실제 호출처럼 약간의 대기
    sendJson(res, 200, {
      mode: "demo",
      result: demoResult(),
      api_ms: Date.now() - started,
    });
    return;
  }

  try {
    const result = await interpretWithClaude(body.image, body.media_type);
    if (result.error) {
      sendJson(res, 200, { mode: "live", error: result.error });
      return;
    }
    sendJson(res, 200, { mode: "live", result, api_ms: Date.now() - started });
    console.log(`[live] 해석 완료 ${Date.now() - started}ms — "${result.sentence}"`);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      // API 키가 없거나 잘못됨 → 데모 모드로 대신 응답
      console.log("[demo] API 인증 실패 → 데모 문장으로 응답합니다. (README의 라이브 모드 설정 참고)");
      sendJson(res, 200, {
        mode: "demo",
        demo_reason: "auth",
        result: demoResult(),
        api_ms: Date.now() - started,
      });
    } else if (error instanceof Anthropic.RateLimitError) {
      sendJson(res, 200, { mode: "live", error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." });
    } else if (error instanceof Anthropic.APIError) {
      console.error("[error] API 오류:", error.status, error.message);
      sendJson(res, 200, { mode: "live", error: "해석 중 문제가 생겼습니다. 다시 시도해 주세요." });
    } else {
      console.error("[error] 알 수 없는 오류:", error);
      sendJson(res, 200, { mode: "live", error: "해석 중 문제가 생겼습니다. 다시 시도해 주세요." });
    }
  }
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.join(__dirname, "public", path.normalize(relative));
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/interpret") {
    await handleInterpret(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, forced_demo: FORCE_DEMO, model: MODEL, effort: EFFORT });
    return;
  }
  await serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  AI MIRROR 프로토타입 v0.1");
  console.log(`  → 브라우저에서 열기: http://localhost:${PORT}`);
  console.log(`  → 모드: ${FORCE_DEMO ? "데모 (API 호출 없음)" : "라이브 시도 (인증 실패 시 자동으로 데모 전환)"}`);
  console.log("");
});

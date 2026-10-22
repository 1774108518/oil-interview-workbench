/* ============================================================
   DeepSeek API 本地代理 · proxy.js
   零依赖，只用 Node 内置模块，不需要 npm install。

   为什么必须有它：
   浏览器直连模型接口会被 CORS 拦掉，API Key 也会暴露在前端。
   它做两件事：
   1. 当静态服务器：浏览器访问 http://127.0.0.1:8787 直接打开带样式的页面；
   2. 当 API 代理：/api/interview 透传 messages，/api/quiz 生成笔试题。

   用法：node proxy.js
   唯一要改的地方：下面的 API_KEY（DeepSeek 的 sk- 开头密钥）
   ============================================================ */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

/* ↓↓↓ 把 DeepSeek 开放平台（platform.deepseek.com）复制的 API Key 粘贴到这里 ↓↓↓ */
const API_KEY = process.env.DEEPSEEK_API_KEY;

const API_HOST = "api.deepseek.com";
const API_PATH = "/chat/completions";
const MODEL = "deepseek-chat";

/* 输出上限：面试点评一句话就够；出题要留足 JSON 的空间，1000 会截断 */
const MAX_TOKENS = { interview: 1000, quiz: 1600 };
const HOST = "127.0.0.1";
const PORT = process.env.PORT || 8787;

/* 静态文件根目录 = 这个 proxy.js 所在的文件夹，四个文件放一起就行 */
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

/* 面试的系统提示词由前端维护，保证多轮请求的 messages[0] 一字不差，缓存前缀才稳定 */

function send(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

/* DeepSeek 返回的 content 可能是字符串，也可能是分片数组，统一取出文本 */
function pickContent(message) {
  if (!message) return "";
  const content = message.content;

  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(function (part) {
        if (typeof part === "string") return part;
        return (part && part.text) || "";
      })
      .join("")
      .trim();
  }
  return "";
}

/* 校验 messages：只认 role + content，顺序与内容一律原样保留 */
function normalizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;

  const out = [];
  let total = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item.content !== "string") return null;
    if (item.role !== "system" && item.role !== "user" && item.role !== "assistant") return null;

    total += item.content.length;
    out.push({ role: item.role, content: item.content });
  }

  /* 简历会塞进 system 里，容量上限相应放宽 */
  return total > 30000 ? null : out;
}

/* ---------------- DeepSeek 请求底座：点评和出题共用 ---------------- */

function postDeepSeek(payload, done) {
  const body = JSON.stringify(payload);

  const req = https.request(
    {
      hostname: API_HOST,
      path: API_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + API_KEY,
        "Content-Length": Buffer.byteLength(body)
      },
      /* 出题比点评慢，留足 90 秒 */
      timeout: 90000
    },
    function (res) {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) {
        raw += chunk;
      });
      res.on("end", function () {
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch (err) {
          data = null;
        }

        if (res.statusCode !== 200) {
          const detail =
            data && data.error && data.error.message
              ? data.error.message
              : "deepseek api returned " + res.statusCode;
          done(new Error(detail));
          return;
        }

        if (!data) {
          done(new Error("DeepSeek 返回的不是合法 JSON"));
          return;
        }
        done(null, data, raw);
      });
    }
  );

  req.on("timeout", function () {
    req.destroy(new Error("请求超时（90 秒），稍后再试"));
  });

  req.on("error", function (err) {
    done(err);
  });

  req.write(body);
  req.end();
}

/* ---------------- 面试：透传前端给的 messages ---------------- */

function askInterview(messages, done) {
  postDeepSeek(
    {
      model: MODEL,
      messages: messages,
      temperature: 0.5,
      max_tokens: MAX_TOKENS.interview,
      stream: false
    },
    function (err, data, raw) {
      if (err) {
        done(err);
        return;
      }

      const message = data.choices && data.choices[0] && data.choices[0].message;
      const content = pickContent(message);

      if (!content) {
        const choice = data.choices && data.choices[0];
        const reason = (choice && choice.finish_reason) || "";
        console.log("[proxy] empty content. finish_reason=" + reason);
        console.log("[proxy] raw response:", raw.slice(0, 600));

        done(
          new Error(
            "模型没有返回内容" +
            (reason ? "（finish_reason: " + reason + "）" : "") +
            "，详情见 proxy 窗口日志"
          )
        );
        return;
      }

      done(null, content);
    }
  );
}

/* ---------------- 笔试出题 ---------------- */

const QUIZ_SYSTEM_PROMPT = [
  "你是三桶油（中国石油、中国石化、中国海油）校园招聘笔试的命题人。",
  "你只输出一个 JSON 对象，不输出任何解释、前后缀或 Markdown 代码块。"
].join("");

function buildQuizPrompt() {
  return [
    "请出 5 道三桶油校招笔试单选题，题型分布：",
    "第 1、2 题：行测 · 逻辑判断；第 3 题：行测 · 资料分析；第 4、5 题：企业文化与石油精神。",
    "",
    "硬性要求：",
    "1. 每题恰好 4 个选项，key 依次为 A、B、C、D，有且只有一个正确答案。",
    "2. 四个选项都要像真的，干扰项要有迷惑性，不要出现「以上都对」「以上都不对」这类凑数项。",
    "3. 涉及计算的题目必须自己验算一遍，确保 answer 对应的选项数值正确。",
    "4. 题干不超过 90 字，解析不超过 70 字，解析要说清为什么对、干扰项错在哪。",
    "5. 题目要新，不要照抄常见原题。",
    "",
    "只输出下面这个结构的 JSON，不要加任何其他文字：",
    '{"questions":[{"tag":"行测 · 逻辑判断","stem":"题干","options":[{"key":"A","text":"选项"},{"key":"B","text":"选项"},{"key":"C","text":"选项"},{"key":"D","text":"选项"}],"answer":"A","explain":"解析"}]}'
  ].join("\n");
}

/* 模型偶尔会裹 ```json ``` 或加开场白，这里做容错解析 + 结构校验 */
function normalizeQuestions(raw) {
  if (!raw) return null;

  let text = String(raw).trim();
  text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return null;
  }

  const list = Array.isArray(parsed) ? parsed : parsed && parsed.questions;
  if (!Array.isArray(list) || list.length < 5) return null;

  const cleaned = [];

  for (let i = 0; i < list.length && cleaned.length < 5; i += 1) {
    const item = list[i];
    if (!item || typeof item.stem !== "string" || !Array.isArray(item.options)) return null;
    if (item.options.length !== 4) return null;

    const options = item.options.map(function (opt, index) {
      return {
        key: String((opt && opt.key) || "ABCD"[index]).trim().toUpperCase(),
        text: String((opt && opt.text) || "").trim()
      };
    });

    const keys = options.map(function (opt) {
      return opt.key;
    });

    if (keys.join("") !== "ABCD") return null;
    if (options.some(function (opt) { return !opt.text; })) return null;

    const answer = String(item.answer || "").trim().toUpperCase();
    if (keys.indexOf(answer) === -1) return null;

    cleaned.push({
      id: "q" + (cleaned.length + 1),
      tag: String(item.tag || "行测").trim().slice(0, 20),
      stem: item.stem.trim(),
      options: options,
      answer: answer,
      explain: String(item.explain || "").trim()
    });
  }

  return cleaned.length === 5 ? cleaned : null;
}

function askZhipuQuiz(done) {
  postDeepSeek(
    {
      model: MODEL,
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT },
        { role: "user", content: buildQuizPrompt() }
      ],
      /* 出题要多样性，温度比点评高一些 */
      temperature: 0.85,
      max_tokens: MAX_TOKENS.quiz,
      stream: false
    },
    function (err, data, raw) {
      if (err) {
        done(err);
        return;
      }

      const message = data.choices && data.choices[0] && data.choices[0].message;
      const content = pickContent(message);
      const questions = normalizeQuestions(content);

      if (!questions) {
        console.log("[proxy] quiz json invalid. content:", String(content || "").slice(0, 800));
        done(new Error("AI 返回的题目格式不规范，请重新出题"));
        return;
      }
      done(null, questions);
    }
  );
}

/* ---------------- 静态文件服务 ---------------- */

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(ROOT, relative);

  /* 挡住 ../ 往上跳目录的请求 */
  if (filePath !== ROOT && filePath.indexOf(ROOT + path.sep) !== 0) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  fs.readFile(filePath, function (err, buf) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + relative);
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": buf.length,
      "Cache-Control": "no-store"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(buf);
  });
}

const server = http.createServer(function (req, res) {
  /* 允许本地页面跨域调用：file:// 打开时 Origin 是 null */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  /* 静态文件：访问 http://127.0.0.1:8787 就是带样式的完整页面 */
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  const urlPath = req.url.split("?")[0];

  if (req.method !== "POST" || (urlPath !== "/api/interview" && urlPath !== "/api/quiz")) {
    send(res, 404, { error: "接口不存在，只提供 POST /api/interview 与 POST /api/quiz" });
    return;
  }

  if (!API_KEY) {
    send(res, 500, { error: "proxy.js 里还没填 API_KEY，请粘贴后重新运行" });
    return;
  }

  let body = "";
  let aborted = false;

  req.on("data", function (chunk) {
    if (aborted) return;
    body += chunk;
    if (body.length > 20000) {
      aborted = true;
      send(res, 413, { error: "回答太长了，精简一下再提交" });
      req.destroy();
    }
  });

  req.on("end", function () {
    if (aborted) return;

    let payload = null;
    try {
      payload = JSON.parse(body || "{}");
    } catch (err) {
      send(res, 400, { error: "请求体不是合法 JSON" });
      return;
    }

    /* 出题 */
    if (urlPath === "/api/quiz") {
      askZhipuQuiz(function (err, questions) {
        if (err) {
          send(res, 502, { error: err.message });
          return;
        }
        send(res, 200, { questions: questions });
      });
      return;
    }

    /* 面试：前端传标准 OpenAI messages，这里只校验和透传 */
    const messages = normalizeMessages(payload.messages);

    if (!messages) {
      send(res, 400, { error: "messages 格式不对，需要 [{role, content}, ...]" });
      return;
    }

    askInterview(messages, function (err, content) {
      if (err) {
        send(res, 502, { error: err.message });
        return;
      }
      send(res, 200, { content: content });
    });
  });
});

server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.log("[proxy] port " + PORT + " is busy. close the other process or change PORT.");
  } else {
    console.log("[proxy] failed:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, function () {
  console.log("[proxy] listening on http://" + HOST + ":" + PORT);
  console.log("[proxy] model: " + MODEL);
  if (!API_KEY) {
    console.log("[proxy] WARNING: API_KEY is empty. open proxy.js and paste your key.");
  }
  console.log("[proxy] keep this window open, then click the interview button in the browser.");
});

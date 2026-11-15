/* ============================================================
   DeepSeek API 服务 · proxy.js（腾讯云 CloudBase Run 容器入口）
   零依赖，只用 Node 内置模块，不需要 npm install。

   它做三件事：
   1. 静态服务器：把 index.html / style.css / script.js 发给浏览器；
   2. API 代理：/api/interview 透传 messages 给 DeepSeek；
   3. 云端同步：/api/sync/save 与 /api/sync/load。

   容器内必须监听 0.0.0.0，端口取平台注入的 PORT。
   密钥从环境变量读，不要写死在代码里。
   ============================================================ */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

/* 只从环境变量读；本地调试可临时用 set DEEPSEEK_API_KEY=... 注入 */
const API_KEY = process.env.DEEPSEEK_API_KEY || "";

const API_HOST = "api.deepseek.com";
const API_PATH = "/chat/completions";
const MODEL = "deepseek-chat";

/* 输出上限：复盘报告要按四大板块写细，1800 会截在半截，
   给到 3000（约 2000 汉字），单轮提问用不到这么多也不额外计费——max_tokens 只是上限 */
const MAX_TOKENS = { interview: 3000 };

/* 容器里不能监听 127.0.0.1，否则平台的流量转发不进来 */
const HOST = "0.0.0.0";
const PORT = process.env.PORT || 8080;

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

/* ---------------- 云开发数据库（同步） ---------------- */

const SYNC_COLLECTION = "user_data";
const NOTEBOOK_LIMIT = 100;

let cloudDb = null;
let cloudInitTried = false;

/* 懒加载：没配环境变量就不初始化，保证本地/离线场景照常可用 */
function getCloudDb() {
  if (cloudInitTried) return cloudDb;
  cloudInitTried = true;

  const envId = process.env.TCB_ENV_ID;
  const secretId = process.env.TCB_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY;

  if (!envId || !secretId || !secretKey) {
    console.log("[sync] 未配置 TCB_ENV_ID / TCB_SECRET_ID / TCB_SECRET_KEY，云端同步关闭");
    return null;
  }

  try {
    const tcb = require("@cloudbase/node-sdk");
    const app = tcb.init({ env: envId, secretId: secretId, secretKey: secretKey });
    cloudDb = app.database();
    console.log("[sync] 云开发数据库已连接：" + envId + " / " + SYNC_COLLECTION);
  } catch (err) {
    cloudDb = null;
    console.log("[sync] 初始化失败：" + (err && err.message));
  }

  return cloudDb;
}

function isValidSyncCode(code) {
  return typeof code === "string" && /^[A-Za-z0-9_-]{4,32}$/.test(code);
}

function getQuery(url, key) {
  const index = url.indexOf("?");
  if (index === -1) return "";

  const params = new URLSearchParams(url.slice(index + 1));
  return params.get(key) || "";
}

async function loadUserData(syncCode) {
  const db = getCloudDb();
  if (!db) throw new Error("云端同步未配置");

  const res = await db.collection(SYNC_COLLECTION).where({ syncCode: syncCode }).limit(1).get();
  const row = res && res.data && res.data[0];
  if (!row) return null;

  return {
    goal: row.goal,
    minutes: row.minutes,
    done: row.done,
    notebook: row.notebook,
    updatedAt: row.updatedAt
  };
}

async function saveUserData(syncCode, data) {
  const db = getCloudDb();
  if (!db) throw new Error("云端同步未配置");

  const res = await db.collection(SYNC_COLLECTION).where({ syncCode: syncCode }).limit(1).get();
  const row = res && res.data && res.data[0];

  if (row && row._id) {
    await db.collection(SYNC_COLLECTION).doc(row._id).update(data);
  } else {
    await db.collection(SYNC_COLLECTION).add(Object.assign({ syncCode: syncCode }, data));
  }

  return data;
}

function handleSyncLoad(req, res) {
  const code = getQuery(req.url, "code");

  if (!isValidSyncCode(code)) {
    send(res, 400, { error: "同步码格式不对，需要 4-32 位英文、数字、下划线或短横线" });
    return;
  }

  loadUserData(code)
    .then(function (data) {
      send(res, 200, { data: data });
    })
    .catch(function (err) {
      send(res, err.message === "云端同步未配置" ? 503 : 502, { error: err.message });
    });
}

function handleSyncSave(payload, res) {
  const code = String((payload && payload.syncCode) || "").trim();

  if (!isValidSyncCode(code)) {
    send(res, 400, { error: "同步码格式不对，需要 4-32 位英文、数字、下划线或短横线" });
    return;
  }

  const data = {
    goal: Number(payload.goal) || 0,
    minutes: Number(payload.minutes) || 0,
    done: {
      written: Boolean(payload.done && payload.done.written),
      interview: Boolean(payload.done && payload.done.interview)
    },
    notebook: Array.isArray(payload.notebook) ? payload.notebook.slice(0, NOTEBOOK_LIMIT) : [],
    updatedAt: Number(payload.updatedAt) || Date.now()
  };

  saveUserData(code, data)
    .then(function (saved) {
      send(res, 200, { ok: true, updatedAt: saved.updatedAt });
    })
    .catch(function (err) {
      send(res, err.message === "云端同步未配置" ? 503 : 502, { error: err.message });
    });
}

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

function postDeepSeek(payload, done, timeoutMs) {
  const limit = timeoutMs || 90000;
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
      /* 默认 90 秒；出 10 道题要更久，单独放宽 */
      timeout: limit
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
    req.destroy(new Error("请求超时（" + Math.round(limit / 1000) + " 秒），稍后再试"));
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
    },
    /* 复盘报告是一次长输出，90 秒容易在最后一段被掐断，放宽到 150 秒 */
    150000
  );
}

/* ---------------- 静态文件服务 ---------------- */

function sendBuffer(req, res, filePath, buf) {
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
}

/* 有几个文件不在仓库里，要从依赖目录现取：
   Suga 用 buildpack 构建（npm install + npm start），没有 Dockerfile 里那步 copy */
const STATIC_FALLBACK = {
  "chart.umd.js": path.join(ROOT, "node_modules", "chart.js", "dist", "chart.umd.js")
};

/* 这些路径不对外：交付副本、依赖目录、内部状态、打包产物与说明文档 */
function isBlockedPath(relative) {
  const first = relative.split(/[\\/]/)[0];
  if (first === "docs" || first === "deploy" || first === "node_modules" || first.charAt(0) === ".") return true;
  return /\.(zip|md)$/i.test(relative);
}

function serveStatic(req, res) {
  let urlPath = "/";
  try {
    /* 非法的 % 编码会抛异常，不能让它把进程带崩 */
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("400 Bad Request");
    return;
  }

  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(ROOT, relative);

  if (isBlockedPath(relative)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found: " + relative);
    return;
  }

  /* 挡住 ../ 往上跳目录的请求 */
  if (filePath !== ROOT && filePath.indexOf(ROOT + path.sep) !== 0) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  fs.readFile(filePath, function (err, buf) {
    if (!err) {
      sendBuffer(req, res, filePath, buf);
      return;
    }

    const fallback = STATIC_FALLBACK[relative];
    if (!fallback) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + relative);
      return;
    }

    fs.readFile(fallback, function (err2, buf2) {
      if (err2) {
        console.log("[proxy] static fallback missing:", fallback);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found: " + relative);
        return;
      }
      sendBuffer(req, res, fallback, buf2);
    });
  });
}

const server = http.createServer(function (req, res) {
  /* 允许本地页面跨域调用：file:// 打开时 Origin 是 null */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split("?")[0];

  /* 云端同步读取：GET 带 query，必须排在静态文件之前 */
  if (req.method === "GET" && urlPath === "/api/sync/load") {
    handleSyncLoad(req, res);
    return;
  }

  /* 静态文件：浏览器访问根路径就是带样式的完整页面 */
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  if (req.method !== "POST" || POST_ROUTES.indexOf(urlPath) === -1) {
    send(res, 404, { error: "接口不存在" });
    return;
  }

  /* 同步接口不依赖 DeepSeek 的 Key */
  if (urlPath !== "/api/sync/save" && !API_KEY) {
    send(res, 500, { error: "服务端没有配置 DEEPSEEK_API_KEY 环境变量" });
    return;
  }

  /* 同步要传整个错题本，给到 512KB；AI 接口仍然 20KB */
  const maxBytes = urlPath === "/api/sync/save" ? 512 * 1024 : 20000;

  let body = "";
  let aborted = false;

  req.on("data", function (chunk) {
    if (aborted) return;
    body += chunk;
    if (body.length > maxBytes) {
      aborted = true;
      send(res, 413, {
        error: urlPath === "/api/sync/save" ? "同步数据太大" : "回答太长了，精简一下再提交"
      });
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

    /* 云端同步：保存 */
    if (urlPath === "/api/sync/save") {
      handleSyncSave(payload, res);
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
    console.log("[proxy] WARNING: DEEPSEEK_API_KEY is empty. set it in the CloudBase env vars.");
  }
  console.log("[proxy] keep this window open, then click the interview button in the browser.");
});

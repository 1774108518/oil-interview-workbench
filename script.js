/* ============================================================
   中海油面试模拟 · script.js

   只做一件事：定制化 AI 压力面。
   流程：选岗位 + 粘简历 → AI 提问 → 30 秒思考 → 自动录音作答 → AI 追问
   计时：进入面试记 startTime，结束面试或答满轮次时按真实分钟数结算。
   ============================================================ */
(function () {
  "use strict";

  const INTERVIEW_ENDPOINT = "/api/interview";

  const INTERVIEW_ROUNDS = 12;
  /* 断点续传的临时存档（崩溃兜底，正常关窗即清）——与下面的「面试档案」是两回事 */
  const INTERVIEW_ARCHIVE_KEY = "oil-workbench-interview-draft-v1";
  const INTERVIEW_RETRY_SECONDS = 3;

  /* 面试档案：历次复盘报告长期留存，换题、断点续传、清空草稿都不会动它 */
  const ARCHIVE_KEY = "oil-workbench-interview-archive-v1";
  const ARCHIVE_MAX = 30;
  const ARCHIVE_LIST_SHOWN = 6;
  /* 诊断书最多拿最近几次报告做横向对比：太多会超出网关 60 秒 */
  const ARCHIVE_DIAGNOSIS_SOURCE = 5;

  /* 作答节奏：30 秒思考 → 3 分钟限时作答，全自动流转 */
  const THINK_SECONDS = 30;
  const ANSWER_SECONDS = 180;
  const TIMEOUT_ANSWER = "（超时未作答）";
  const THINK_HINT = "（请思考 30 秒后开始作答）";

  const DEFAULT_GOAL = 90;
  const MAX_GOAL = 600;
  const STORE_KEY = "oil-workbench-v1";
  const SYNC_CODE_KEY = "oil-workbench-sync-code";
  const SYNC_SAVE_URL = "/api/sync/save";
  const SYNC_LOAD_URL = "/api/sync/load";

  /* ---------------- 面试：岗位与提示词 ---------------- */

  /* 开场固定要求自我介绍；简历相关内容留给第一轮追问 */
  const OPENING_QUESTION =
    "请先做一个 1—2 分钟的自我介绍：教育背景、与这个岗位相关的经历，以及你为什么选这个岗位。";

  const EMPTY_RESUME = "（候选人未提供简历文本，请围绕岗位通用要求提问）";

  /* 结束面试时追加的隐藏指令：走同一套 messages，不动 system 前缀 */
  const REPORT_INSTRUCTION = [
    "面试到此结束。现在请你切换成极其严苛的中海油资深面试主考官，写一份干货满满的《面试复盘报告》。",
    "不要写客套话，不要复述面试流程，不要夸我态度好，直接按下面四个板块输出。",
    "",
    "【板块一：致命错误剖析】",
    "指出我表现最差的 2-3 个问题（例如：岗位稳定性回答虚伪、专业术语用错、逻辑混乱、答非所问、假大空、缺少具体例子）。",
    "每一个问题都必须：",
    "1. 先引用我刚才回答里的原话，用「」括起来，一两句即可，必须一字不差，不许改写；",
    "2. 再一针见血地指出这句原话哪里不对——是事实错、逻辑跳步、还是态度上让人不放心；",
    "3. 最后写清考官听到这句会怎么想，以及这个回答会让我在这场面试里丢多少分。",
    "",
    "【板块二：高分修改示范】",
    "针对板块一里的每一个问题，告诉我满分 100 分的话，改成什么样能拿 90 分。",
    "每个问题都要直接给出一段【修改后的话术示例】，要求是可以直接背下来、下一场面试就能用的口语句子。",
    "话术里要有具体的岗位细节（平台、区块、制度、设备、数字），不要写成公文，不要出现「我会继续努力」这类空话。",
    "",
    "【板块三：同类题型万能框架】",
    "把刚才问我的题目归类（例如：抗压能力类、岗位稳定性类、人际关系类、职业规划类、专业追问题、应急处置类）。",
    "针对每一类，给出一个万能答题框架（如 STAR 法则、态度+原因+对策+总结、情境-任务-行动-结果），并说明：",
    "1. 这个框架分几步，每步该说什么；",
    "2. 套到中海油这类海岗岗位上，每一步该往里填什么素材；",
    "3. 用我刚才被问到的原题，现场套一遍给我看，写成示范答案。",
    "",
    "【板块四：下一步行动建议】",
    "给我 3 条极其具体的练习建议（例如：背熟 HSE 九项原则、用 1 分钟大声朗读《深海一号》背景资料）。",
    "每条都要写清：练什么、怎么练、练到什么程度算过关。不要写「多练习」「多了解行业」这种废话。",
    "",
    "输出要求：",
    "0. 报告第一行先输出五个维度的分数，格式一字不差照抄下面这行（满分 100，只写整数）：",
    "SCORES: 专业知识=82, 逻辑思维=76, 抗压能力=70, 岗位匹配=79, 表达沟通=75",
    "这五个词不要改写、不要加括号说明；这一行之后另起一行写正文。",
    "1. 四个板块的标题必须原样使用上面【】里的文字，一个都不能少，顺序不能调。",
    "2. 纯文本排版，板块之间空一行，板块内部按 1. 2. 3. 分条；不要 Markdown 的 #、*、- 符号，不要输出 JSON。",
    "3. 写到把话说透为止，通常 1200—1600 字；宁可写细，也不要写空话凑长度。",
    "4. 全程用中文，像面对面点评一样直接、不留情面，但每条批评都要落到可改的动作上。"
  ].join("\n");

  /* 生成高频错误诊断书用的系统提示词：独立请求，不污染面试的 messages */
  const DIAGNOSIS_SYSTEM_PROMPT = [
    "你是资深面试教练，专门给准备中海油（CNOOC）/中海油服（COSL）校招的应届生做复盘诊断。",
    "用户会给你该候选人最近几次面试的《面试复盘报告》全文。",
    "",
    "你的任务：横向对比这些报告，找出他反反复复出错、始终没有改掉的【3 个核心顽疾】。",
    "判断标准：同一个毛病至少在两次不同的报告里出现过，才算「顽疾」；只出现一次的问题不要算。",
    "顽疾要写得像人话，例如「一紧张就先铺三段背景，最后才给结论」「被问倒班永远绕开正面回答，只谈自己抗压」。",
    "",
    "对每个顽疾，按下面的结构写（不要写小标题以外的多余客套）：",
    "顽疾一：<一句话点明是什么毛病>",
    "证据：说明它在哪几次面试里出现过，引用报告里的原话或原判断，一两句即可。",
    "为什么改不掉：指出背后的真实原因（比如没有准备过这类题、怕说错所以绕、把背模板当成了准备）。",
    "强制脱敏训练计划：给 3 步，每步写清「练什么 + 每天练多久 + 怎么算过关」，必须能在 7 天内执行完。",
    "",
    "三个顽疾写完后，最后加一段「本周执行顺序」，用 3 行说明先练哪个、后练哪个，为什么。",
    "",
    "输出要求：",
    "1. 纯文本排版，不要 Markdown 的 #、*、- 符号，不要 JSON，不要表格。",
    "2. 直接开始写顽疾一，不要写「好的」「以下是诊断」这类开场白。",
    "3. 总长度控制在 900—1200 字，宁可写具体，不要写正确的废话。",
    "4. 全程用中文，语气直接，像教练当面指出问题。"
  ].join("\n");

  /* 模型没给出下一个问题时的兜底，避免对话断在这里 */
  const FALLBACK_FOLLOWUPS = [
    "能结合你在实习或课程设计里的具体例子再说一遍吗？",
    "如果现场条件不允许你按原计划处理，你会怎么调整？",
    "这件事最后的结果如何，你从中总结出了什么？"
  ];

  /* 岗位画像：key 必须和 index.html 里 option 的 value 完全一致 */
  const ROLE_PROFILES = {
    "中海油-中海油服（COSL）": {
      persona: "中海油服的海上平台监督，常年在钻井平台倒班，最烦听到「应该没问题」",
      focus: [
        "28 休 28 的倒班制度：在平台上一待 28 天，能不能接受，家里怎么安排",
        "HSE 红线：安全规定没有商量余地，给一个进度和安全冲突的场景看他怎么选",
        "简单的英语口语：平台上有外籍人员、英文报表和作业指令，敢不敢开口",
        "海上狭小空间的团队协作：几十个人关在一个平台上，闹了矛盾怎么处理"
      ]
    },
    "中海油-海南分公司": {
      persona: "中海油海南分公司的深水作业主管，参与过深海一号的建设，对深水作业的每个风险点都门儿清",
      focus: [
        "南海深水开发的极端挑战：水深上千米、压力和温度条件苛刻，问他怎么理解这些难度",
        "台风应急撤离：南海台风季，撤离怎么决策、人在现场该做什么",
        "海洋生态保护意识：溢油、钻井液排放这些敏感点，他的底线在哪",
        "长期在海岛或平台上的孤独感，他自己打算怎么排解"
      ]
    },
    "中海油-湛江分公司": {
      persona: "中海油湛江分公司的老海油人，在南海西部干了半辈子，带过不少新人",
      focus: [
        "老油田的设备维护与稳产：涠洲这类老油田，设备老化、维保压力大，问他怎么看待这种「守成」的活",
        "对海上枯燥生活的耐受度：一轮班几十天，除了工作就是睡觉",
        "对老一辈海油人「传帮带」精神的认同：愿不愿意带新人、把经验留下来",
        "家庭与工作的平衡：孩子生病、老人住院时他不在家，怎么想"
      ]
    },
    "中海油-能源发展": {
      persona: "中海油能源发展（海油发展）的技术服务主管，常年在海上工程项目上跑，看重现场经验和成本意识",
      focus: [
        "技术服务意识：客户是作业者，工期紧、要求高，怎么在压力下保证交付质量",
        "海上工程与装备：FPSO、海底管道、平台维修这类项目，他了解多少，能不能吃苦驻场",
        "成本与安全怎么平衡：降本指标压下来时，哪些钱绝对不能省",
        "长期出差与项目制工作：项目在哪人在哪，家庭怎么安排"
      ]
    },
    "综合管培生/通用岗位": {
      persona: "中海油总部的 HR，负责管培生项目，见过太多背模板的候选人",
      focus: [
        "宏观双碳战略的理解：2060 碳中和跟油气行业到底是什么关系",
        "快速学习能力：轮岗换专业，多久能上手，举个例子",
        "跨部门沟通：勘探、开发、销售诉求不一致时，怎么协调",
        "职业规划：三到五年想走到什么位置，路径是什么"
      ]
    }
  };

  /* 系统提示词：一场面试只生成一次，之后每轮原样复用，缓存前缀才稳定 */
  function buildInterviewSystemPrompt(roleKey, resume) {
    const profile = ROLE_PROFILES[roleKey] || ROLE_PROFILES["综合管培生/通用岗位"];

    return [
      "你是" + profile.persona + "，正在对一名应届生进行压力面。",
      "候选人简历：【" + resume + "】",
      "",
      "这场面试必须围绕下面这些考察点展开，一个一个往深里问：",
      profile.focus
        .map(function (item, index) {
          return index + 1 + ". " + item;
        })
        .join("\n"),
      "",
      "面试节奏：",
      "1. 开场问题已经由系统提出（自我介绍），你收到的是候选人的自我介绍。先就里面 2-3 个细节追问，问透了再进入上面的考察点。",
      "2. 之后严格围绕上面的考察点逐个施压，每个点至少追问两轮，问透了再换下一个。",
      "3. 候选人回避、含糊、背套话时，当场顶回去，要求他给具体例子和数字。",
      "",
      "硬性要求：",
      "- 每次只问一个问题。绝不一次抛出两个问题，也不预告下一个问题。",
      "- 每次提问的末尾都要加上「（请思考 30 秒后开始作答）」，只加这一句，不要解释流程。",
      "- 不夸奖、不客套、不说「很好的回答」。语气要像这个岗位真实的面试官：听得懂行话，也听得出口号。",
      "- 记住自己问过什么，不要重复提问。",
      "- 只依据简历和对话历史提问，不要编造候选人没写过的经历。",
      "- 提问要口语化，像面对面说话，不要书面腔。",
      "",
      "输出格式（前端解析用，候选人看不到）：只输出一个 JSON 对象，不要 Markdown 代码块。",
      '{"comment":"","next_question":"你要问的那一个问题"}',
      "平时 comment 一律留空字符串，不要写任何点评。",
      "只有当用户消息说「面试到此结束」时，才把完整评价写进 comment，next_question 留空。",
      "next_question 不超过 50 字，不要列表、不要序号、不要换行分段。"
    ].join("\n");
  }

  const el = {
    date: document.getElementById("todayDate"),
    minutes: document.getElementById("minutesValue"),
    goalInput: document.getElementById("goalInput"),
    fill: document.getElementById("progressFill"),
    track: document.getElementById("progressTrack"),
    text: document.getElementById("progressText"),
    count: document.getElementById("taskCount"),
    btnInterview: document.getElementById("btnInterview"),

    /* 面试设置面板 */
    setupModal: document.getElementById("setupModal"),
    roleSelect: document.getElementById("roleSelect"),
    resumeInput: document.getElementById("resumeInput"),
    setupStart: document.getElementById("setupStart"),
    setupCancel: document.getElementById("setupCancel"),
    setupClose: document.getElementById("setupClose"),
    items: {
      interview: document.querySelector('[data-task="interview"]')
    },

    /* 面试面板 */
    modal: document.getElementById("interviewModal"),
    interviewBody: document.getElementById("interviewBody"),
    interviewProgress: document.getElementById("interviewProgress"),
    chatLog: document.getElementById("chatLog"),
    answerBlock: document.getElementById("answerBlock"),
    answerStage: document.getElementById("answerStage"),
    answerStageText: document.getElementById("answerStageText"),
    answerStageTimer: document.getElementById("answerStageTimer"),
    answer: document.getElementById("answerInput"),
    answerCount: document.getElementById("answerCount"),
    fillerLine: document.getElementById("fillerLine"),
    voiceBtn: document.getElementById("voiceBtn"),
    voiceLabel: document.getElementById("voiceLabel"),
    voiceHint: document.getElementById("voiceHint"),
    recordBtn: document.getElementById("recordBtn"),
    voicePreviewWrap: document.getElementById("voicePreviewWrap"),
    voicePreview: document.getElementById("voicePreview"),
    feedback: document.getElementById("feedbackBox"),
    feedbackTitle: document.getElementById("feedbackTitle"),
    feedbackText: document.getElementById("feedbackText"),
    submit: document.getElementById("submitAnswer"),
    endBtn: document.getElementById("interviewEnd"),
    closeBtn: document.getElementById("modalClose"),
    fsBtn: document.getElementById("fsBtn"),

    /* 云端同步 */
    syncInput: document.getElementById("syncInput"),
    syncSave: document.getElementById("syncSave"),
    syncStatus: document.getElementById("syncStatus"),

    /* 面试复盘报告 */
    reportModal: document.getElementById("reportModal"),
    reportBody: document.getElementById("reportBody"),
    reportText: document.getElementById("reportText"),
    reportChartWrap: document.getElementById("reportChartWrap"),
    reportChart: document.getElementById("reportChart"),
    reportScores: document.getElementById("reportScores"),
    reportClose: document.getElementById("reportClose"),
    reportDone: document.getElementById("reportDone"),

    /* 面试档案 */
    btnArchive: document.getElementById("btnArchive"),
    archiveCount: document.getElementById("archiveCount"),
    archiveModal: document.getElementById("archiveModal"),
    archiveBody: document.getElementById("archiveBody"),
    archiveTotal: document.getElementById("archiveTotal"),
    archiveList: document.getElementById("archiveList"),
    archiveEmpty: document.getElementById("archiveEmpty"),
    archiveMore: document.getElementById("archiveMore"),
    archiveDiagnose: document.getElementById("archiveDiagnose"),
    archiveDiagnosis: document.getElementById("archiveDiagnosis"),
    archiveDiagnosisTitle: document.getElementById("archiveDiagnosisTitle"),
    archiveDiagnosisText: document.getElementById("archiveDiagnosisText"),
    archiveClose: document.getElementById("archiveClose"),
    archiveDone: document.getElementById("archiveDone"),

    /* 轻提示 */
    toast: document.getElementById("appToast")
  };

  const state = {
    date: todayKey(),
    goal: DEFAULT_GOAL,
    minutes: 0,
    done: { interview: false },
    updatedAt: 0
  };

  /* 云端同步 */
  let syncCode = "";
  let syncTimer = null;

  /* 真实计时：进入面试时记下，结束面试时结算 */
  let interviewStartAt = 0;

  /* 面试状态 */
  let currentQuestion = "";
  let interviewRound = 0; /* 已完成的轮次 */
  let interviewRecorded = false;
  /* 标准 OpenAI 对话历史，逐轮追加，永不改写、不重排 */
  let interviewMessages = [];
  /* 气泡显示顺序，与 interviewMessages 分开存，恢复时直接重放 */
  let interviewDisplay = [];
  let submitting = false;
  let finished = false;
  let cooldownTimer = null;

  /* 作答阶段：idle（未开始）| thinking（30 秒思考）| answering（3 分钟作答）| timeup（强制提交中）| typing（异常后手动重试） */
  let answerStage = "idle";
  let thinkTimer = null;
  let thinkLeft = THINK_SECONDS;
  let answerTimer = null;
  let answerLeft = ANSWER_SECONDS;
  /* 用截止时间戳算剩余，锁屏/切后台导致 interval 被节流时也不会把倒计时「冻住」 */
  let thinkDeadline = 0;
  let answerDeadline = 0;

  /* 语音输入：浏览器自带识别，纯前端，不发音频 */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let voiceRecognition = null;
  let voiceBaseText = "";
  let listening = false;

  /* MediaRecorder 保底：只录声音，不转文字 */
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let recordedUrl = "";
  let recording = false;
  let recordingPending = false;
  let discardRecording = false;

  /* 综合评价 */
  let evaluating = false;
  let evaluated = false;

  /* 面试档案 */
  let currentRole = "";
  let archive = loadArchive();
  let diagnosing = false;

  /* ---------------- 本地存储（浏览器缓存，不是数据库） ---------------- */

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch (err) {
      return null;
    }
  }

  function writeStore(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (err) {
      /* 写不进去也不影响这一屏的正常使用 */
    }
  }

  function todayKey() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + month + "-" + day;
  }

  function loadState() {
    const saved = readStore();
    if (!saved) return;

    /* 目标与数据版本跨天保留，当天归零的只是分钟数和勾选 */
    if (Number.isFinite(saved.goal)) {
      state.goal = Math.max(0, Math.min(MAX_GOAL, saved.goal));
    }
    if (Number.isFinite(saved.updatedAt)) {
      state.updatedAt = saved.updatedAt;
    }

    if (saved.date !== state.date) return;

    if (Number.isFinite(saved.minutes)) {
      state.minutes = Math.max(0, saved.minutes);
    }
    if (saved.done) {
      state.done.interview = saved.done.interview === true;
    }
  }

  function saveState() {
    state.date = todayKey();
    writeStore({
      date: state.date,
      goal: state.goal,
      minutes: state.minutes,
      done: state.done,
      updatedAt: state.updatedAt
    });
  }

  /* ---------------- 云端同步 ---------------- */

  function readSyncCode() {
    try {
      return localStorage.getItem(SYNC_CODE_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function writeSyncCode(code) {
    try {
      localStorage.setItem(SYNC_CODE_KEY, code);
    } catch (err) {
      /* 存不进去就只在本次会话有效 */
    }
  }

  function setSyncStatus(text) {
    el.syncStatus.textContent = text;
  }

  function timeText() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* 任何本地改动都走这里：打时间戳 + 落盘 + 排队推送 */
  function markDirty() {
    state.updatedAt = Date.now();
    saveState();
    scheduleSync();
  }

  function scheduleSync() {
    if (!syncCode) return;
    if (syncTimer) clearTimeout(syncTimer);

    syncTimer = setTimeout(function () {
      syncTimer = null;
      pushCloud();
    }, 800);
  }

  async function fetchCloud(code) {
    const res = await fetch(SYNC_LOAD_URL + "?code=" + encodeURIComponent(code));

    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }

    if (!res.ok) throw new Error(data.error || "读取失败 " + res.status);
    return data.data || null;
  }

  async function pushCloud() {
    if (!syncCode) return;

    try {
      const res = await fetch(SYNC_SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncCode: syncCode,
          goal: state.goal,
          minutes: state.minutes,
          done: state.done,
          updatedAt: state.updatedAt
        })
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }

      if (!res.ok) {
        setSyncStatus("同步失败：" + (data.error || res.status));
        return;
      }

      setSyncStatus("已同步 " + timeText());
    } catch (err) {
      setSyncStatus("同步失败：连不上服务端");
    }
  }

  function applyCloud(data) {
    if (!data) return;

    if (Number.isFinite(data.goal)) {
      state.goal = Math.max(0, Math.min(MAX_GOAL, data.goal));
    }
    if (Number.isFinite(data.minutes)) {
      state.minutes = Math.max(0, data.minutes);
    }
    if (data.done) {
      state.done.interview = data.done.interview === true;
    }

    state.updatedAt = Number(data.updatedAt) || 0;

    saveState();
    el.goalInput.value = state.goal > 0 ? String(state.goal) : "";
    renderAll();
  }

  /* 开页面时静默拉一次：云端更新就用云端，本地更新就推上去 */
  async function pullCloudOnStart() {
    if (!syncCode) return;

    try {
      const cloud = await fetchCloud(syncCode);

      if (!cloud) {
        await pushCloud();
        return;
      }

      if ((cloud.updatedAt || 0) > (state.updatedAt || 0)) {
        applyCloud(cloud);
        setSyncStatus("已从云端载入");
        return;
      }

      if ((state.updatedAt || 0) > (cloud.updatedAt || 0)) {
        await pushCloud();
        return;
      }

      setSyncStatus("已是最新");
    } catch (err) {
      setSyncStatus(err.message || "读取失败");
    }
  }

  async function bindAndSync() {
    const code = el.syncInput.value.trim();

    if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) {
      setSyncStatus("同步码要 4-32 位英文、数字、_ 或 -");
      return;
    }

    syncCode = code;
    writeSyncCode(code);

    el.syncSave.disabled = true;
    setSyncStatus("同步中…");

    try {
      const cloud = await fetchCloud(code);

      if (cloud && (cloud.updatedAt || 0) > (state.updatedAt || 0)) {
        applyCloud(cloud);
        setSyncStatus("已从云端载入");
      } else {
        await pushCloud();
      }

      el.syncSave.textContent = "立即同步";
    } catch (err) {
      setSyncStatus("同步失败：" + (err.message || "未知错误"));
    } finally {
      el.syncSave.disabled = false;
    }
  }

  /* ---------------- 渲染 ---------------- */

  function progressText(minutes, goal) {
    if (goal <= 0) return "还没填今日目标，填个数字就能看到进度";
    if (minutes <= 0) return "已完成 0 / " + goal + " 分钟";
    if (minutes >= goal) return "已完成 " + minutes + " / " + goal + " 分钟 · 今日目标达成";
    return "已完成 " + minutes + " / " + goal + " 分钟 · 还差 " + (goal - minutes) + " 分钟";
  }

  function renderTime() {
    const goal = state.goal;
    const minutes = state.minutes;
    const percent = goal > 0 ? Math.min(100, Math.round((minutes / goal) * 100)) : 0;

    el.minutes.textContent = String(minutes);
    el.fill.style.width = percent + "%";
    el.fill.classList.toggle("is-full", percent >= 100);
    el.track.setAttribute("aria-valuenow", String(percent));
    el.text.textContent = progressText(minutes, goal);
  }

  function renderTasks() {
    const done = state.done.interview;

    el.items.interview.classList.toggle("is-done", done);
    el.items.interview.querySelector(".task-status").textContent = done ? "已完成" : "未完成";
    el.count.textContent = (done ? "1" : "0") + " / 1 已完成";
  }

  function renderDate() {
    const d = new Date();
    const week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
    el.date.textContent = d.getMonth() + 1 + " 月 " + d.getDate() + " 日 " + week;
  }

  function renderAll() {
    renderTime();
    renderTasks();
  }

  /* ---------------- 计时（唯一入口，别在别处直接改 state.minutes） ---------------- */

  /* 真实耗时：毫秒差 → 分钟，四舍五入到整数 */
  function elapsedMinutes(startAt) {
    if (!startAt) return 0;
    return Math.round((Date.now() - startAt) / 60000);
  }

  /* 结束面试时结算；重复调用不重复记，返回 null */
  function recordInterview() {
    if (interviewRecorded) return null;
    interviewRecorded = true;

    const minutes = elapsedMinutes(interviewStartAt);

    state.minutes += minutes;
    state.done.interview = true;
    markDirty();
    renderAll();

    return minutes;
  }

  /* ---------------- 错题本 ---------------- */

  /* ---------------- 面试面板（3 轮追问） ---------------- */

  /* 每轮只追加一条 user；轮次信息放在 user 里，绝不改动 system */
  function buildInterviewUserMessage(answer) {
    const round = interviewRound + 1;
    const head = interviewRound === 0 ? "面试题：" + currentQuestion + "\n\n" : "";

    return (
      head + "考生回答：" + answer +
      "\n\n（本轮是第 " + round + " / " + INTERVIEW_ROUNDS + " 轮" +
      (round === INTERVIEW_ROUNDS ? "，最后一轮" : "") + "）"
    );
  }

  /* 容错解析模型返回的 JSON（可能裹代码块或带开场白） */
  function parseInterviewContent(raw) {
    const text = String(raw || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    let data = null;
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch (err) {
      return null;
    }

    const comment = String((data && data.comment) || "").trim();
    const nextQuestion = String((data && (data.next_question || data.nextQuestion)) || "").trim();

    /* 压力面通常不点评，comment 允许为空，但不能两个都空 */
    if (!comment && !nextQuestion) return null;

    return { comment: comment, nextQuestion: nextQuestion };
  }

  /* ---------------- 面试存档（防闪退丢记录） ---------------- */

  function saveInterviewDraft() {
    if (!interviewMessages.length) return;

    try {
      localStorage.setItem(INTERVIEW_ARCHIVE_KEY, JSON.stringify({
        messages: interviewMessages,
        display: interviewDisplay,
        round: interviewRound,
        currentQuestion: currentQuestion,
        position: currentRole,
        savedAt: Date.now()
      }));
    } catch (err) {
      /* 存不下也不影响继续面试 */
    }
  }

  function readInterviewDraft() {
    try {
      const raw = JSON.parse(localStorage.getItem(INTERVIEW_ARCHIVE_KEY) || "null");

      if (!raw || !Array.isArray(raw.messages) || !raw.messages.length) return null;
      if (!Array.isArray(raw.display) || !raw.display.length) return null;
      if (!raw.messages[0] || raw.messages[0].role !== "system") return null;

      return raw;
    } catch (err) {
      return null;
    }
  }

  function clearInterviewDraft() {
    try {
      localStorage.removeItem(INTERVIEW_ARCHIVE_KEY);
    } catch (err) {
      /* 忽略 */
    }
  }

  function scrollChatToEnd() {
    el.interviewBody.scrollTop = el.interviewBody.scrollHeight;
  }

  /* 只画气泡，不写存档 */
  function renderChatRow(kind, text) {
    const row = document.createElement("div");
    row.className = "chat-row is-" + kind;

    const who = document.createElement("span");
    who.className = "chat-who";
    who.textContent = kind === "interviewer" ? "面试官" : "我";

    const body = document.createElement("p");
    body.className = "chat-text";
    body.textContent = text;

    row.appendChild(who);
    row.appendChild(body);
    el.chatLog.appendChild(row);
    scrollChatToEnd();

    return row;
  }

  /* 提问末尾统一带上思考提示；模型已经写了就不重复加 */
  function withThinkHint(text) {
    const body = String(text || "").trim();
    if (!body) return body;

    return body.indexOf("思考") !== -1 ? body : body + THINK_HINT;
  }

  /* 画气泡 + 记进存档 */
  function appendChat(kind, text) {
    interviewDisplay.push({ kind: kind, text: text });

    const row = renderChatRow(kind, text);
    saveInterviewDraft();

    return row;
  }

  /* 聊天流里的临时提示（口头禅、纪律提醒）：不写进存档，恢复时不会重放 */
  function appendNote(text) {
    const row = document.createElement("div");
    row.className = "chat-row is-note";
    row.textContent = text;

    el.chatLog.appendChild(row);
    scrollChatToEnd();

    return row;
  }

  function appendComment(text) {
    const box = document.createElement("div");
    box.className = "chat-comment";

    const title = document.createElement("p");
    title.className = "chat-comment-title";
    title.textContent = "面试官点评";

    const body = document.createElement("p");
    body.className = "chat-comment-text";
    body.textContent = text;

    box.appendChild(title);
    box.appendChild(body);
    el.chatLog.appendChild(box);
    scrollChatToEnd();
  }

  function showFeedback(text, isError, title) {
    el.feedback.hidden = false;
    el.feedback.classList.toggle("is-error", isError === true);
    el.feedbackTitle.textContent = title || (isError ? "没能拿到点评" : "面试官点评");
    el.feedbackText.textContent = text;
    scrollChatToEnd();
  }

  function hideFeedback() {
    el.feedback.hidden = true;
  }

  function setInterviewRoundText(text) {
    el.interviewProgress.textContent = text;
  }

  /* 打开页面时询问是否继续上次未完成的面试 */
  function offerResume() {
    const draft = readInterviewDraft();
    if (!draft) return;

    const when = new Date(Number(draft.savedAt) || Date.now());
    const stamp = (when.getMonth() + 1) + "/" + when.getDate() + " " +
      String(when.getHours()).padStart(2, "0") + ":" + String(when.getMinutes()).padStart(2, "0");

    const go = window.confirm(
      "检测到上次面试未完成（" + (Number(draft.round) || 0) + " 轮，保存于 " + stamp + "），是否继续？\n\n" +
      "点「确定」继续这场面试，点「取消」放弃这次存档。"
    );

    if (!go) {
      clearInterviewDraft();
      return;
    }

    restoreInterview(draft);
  }

  function restoreInterview(draft) {
    /* 断点恢复：先把可能残留的旧定时器清掉 */
    stopAllTimers();

    interviewMessages = draft.messages;
    interviewDisplay = draft.display;
    interviewRound = Number(draft.round) || 0;
    currentQuestion = String(draft.currentQuestion || "");
    /* 档案里要写对岗位：旧存档可能没这个字段，回退到当前下拉框 */
    currentRole = String(draft.position || el.roleSelect.value || "");

    interviewRecorded = false;
    evaluating = false;
    evaluated = false;
    submitting = false;
    finished = false;
    /* 重新计时：崩溃到恢复之间的空档不该算成学习时长 */
    interviewStartAt = Date.now();

    el.chatLog.innerHTML = "";
    hideFeedback();
    el.answerBlock.hidden = false;
    el.endBtn.disabled = false;
    el.endBtn.textContent = "结束面试并生成报告";

    /* 若是「刚提交完就崩了」，最后这条回答没进消息历史，恢复时丢掉，免得气泡和上下文对不上 */
    if (interviewDisplay.length && interviewDisplay[interviewDisplay.length - 1].kind === "candidate") {
      interviewDisplay.pop();
    }

    interviewDisplay.forEach(function (item) {
      renderChatRow(item.kind, item.text);
    });

    setInterviewRoundText(
      interviewRound >= INTERVIEW_ROUNDS
        ? "已完成 " + INTERVIEW_ROUNDS + " / " + INTERVIEW_ROUNDS + " 轮"
        : "第 " + (interviewRound + 1) + " / " + INTERVIEW_ROUNDS + " 轮"
    );

    el.modal.showModal();

    /* 已答满轮次：不再起计时，直接引导生成报告 */
    if (interviewRound >= INTERVIEW_ROUNDS) {
      finished = true;
      resetStageIdle();
      el.answerStageText.textContent = "这场面试已答满轮次，可以点「结束面试并生成报告」";
      return;
    }

    /* 断点恢复：新题立刻重新走 30 秒思考 */
    beginThinking();
  }

  function openSetup() {
    el.setupModal.showModal();
  }

  function startInterview() {
    const role = el.roleSelect.value;
    const resume = el.resumeInput.value.trim() || EMPTY_RESUME;

    /* 记下岗位：报告生成后要写进面试档案 */
    currentRole = role;

    /* 计时从真正进入面试开始；填简历的时间不计入 */
    interviewStartAt = Date.now();
    stopAllTimers();
    interviewRound = 0;
    interviewRecorded = false;
    submitting = false;
    finished = false;
    currentQuestion = OPENING_QUESTION;

    /* 系统提示词只在这里生成一次，后续每轮原样复用 → 前缀稳定，缓存能命中 */
    interviewMessages = [
      { role: "system", content: buildInterviewSystemPrompt(role, resume) }
    ];
    interviewDisplay = [];
    clearInterviewDraft();

    el.setupModal.close();

    evaluated = false;
    evaluating = false;

    el.chatLog.innerHTML = "";
    hideFeedback();
    el.answerBlock.hidden = false;
    el.endBtn.disabled = false;
    el.endBtn.textContent = "结束面试并生成报告";
    setInterviewRoundText("第 1 / " + INTERVIEW_ROUNDS + " 轮");

    el.modal.showModal();
    appendChat("interviewer", withThinkHint(currentQuestion));

    /* 开场白出现后立刻开始 30 秒思考，不需要用户点任何按钮 */
    beginThinking();

    /* 进入面试就进全屏；iOS 不支持也只会静默失败，不影响流程 */
    requestFullscreen();
  }

  /* 限流：429 或服务端的「Too Many Requests / 访问量过大」类提示 */
  function isBusyError(err) {
    if (err && err.status === 429) return true;
    return /访问量过大|并发|限流|繁忙|频率|稍后再试|rate.?limit|too many/i.test(
      String((err && err.message) || "")
    );
  }

  function friendlyError(err) {
    const message = String((err && err.message) || err);

    if (message.indexOf("Failed to fetch") !== -1 || message.indexOf("Load failed") !== -1) {
      return "网络波动，请重试。";
    }

    /* 网关超时：请求被平台先掐断，服务端日志里什么都看不到 */
    if (message.indexOf("504") !== -1 || /超时|timeout/i.test(message)) {
      return "请求超时（网关约 60 秒会断开）。报告越长越容易断，请再点一次重试；连续超时就把报告的篇幅要求改短。";
    }

    return message;
  }

  function startCooldown(seconds) {
    let left = seconds;
    if (cooldownTimer) clearInterval(cooldownTimer);

    el.submit.disabled = true;
    el.submit.textContent = "请稍候 " + left + " 秒";

    cooldownTimer = setInterval(function () {
      left -= 1;

      if (left <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        el.submit.disabled = false;
        el.submit.textContent = "重新提交";
        return;
      }
      el.submit.textContent = "请稍候 " + left + " 秒";
    }, 1000);
  }

  function finishInterviewSession() {
    finished = true;
    interviewRound = INTERVIEW_ROUNDS;

    /* 面试结束，停表并停止录音 */
    stopAllTimers();

    if (listening && voiceRecognition) {
      listening = false;
      voiceRecognition.stop();
    }

    el.answerBlock.hidden = true;
    el.submit.disabled = true;
    el.submit.textContent = "已完成";
    hideFeedback();

    const minutes = recordInterview();
    setInterviewRoundText(
      "已完成 " + INTERVIEW_ROUNDS + " / " + INTERVIEW_ROUNDS + " 轮" +
      (minutes === null ? "" : " · 计入 " + minutes + " 分钟")
    );
    scrollChatToEnd();
  }

  /* ---------------- 作答阶段：30 秒思考 → 3 分钟限时作答 ---------------- */

  function setStage(stage, text) {
    answerStage = stage;
    el.answerStage.setAttribute("data-stage", stage);
    el.answerStageText.textContent = text;
  }

  function formatClock(total) {
    const safe = Math.max(0, Math.floor(total));
    return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
  }

  /* 思考阶段：输入框、麦克风、提交、录音全部锁死 */
  function lockAnswering() {
    el.answer.disabled = true;
    el.submit.disabled = true;
    el.voiceBtn.disabled = true;
    el.recordBtn.disabled = true;
  }

  /* 作答阶段：全部解锁；浏览器不支持的能力保持禁用 */
  function unlockAnswering() {
    el.answer.disabled = false;
    el.submit.disabled = false;
    el.voiceBtn.disabled = !SpeechRecognition;
    el.recordBtn.disabled = !canRecord();
  }

  function stopThinkTimer() {
    if (thinkTimer) {
      clearInterval(thinkTimer);
      thinkTimer = null;
    }
    thinkLeft = 0;
  }

  function stopAnswerTimer() {
    if (answerTimer) {
      clearInterval(answerTimer);
      answerTimer = null;
    }
    answerLeft = 0;
  }

  /* 关窗、提交、生成报告、换题都必须走这里，两个定时器一起清 */
  function stopAllTimers() {
    stopThinkTimer();
    stopAnswerTimer();
  }

  /* 请求失败后计时已停，数字留在原地会误导，改成 --:-- */
  function pauseTimerDisplay() {
    el.answerStageTimer.textContent = "--:--";
    el.answerStageTimer.classList.remove("is-urgent");
  }

  function renderThinkTimer() {
    el.answerStageTimer.classList.remove("is-urgent");
    el.answerStageTimer.textContent = Math.max(0, thinkLeft) + " 秒";
  }

  function renderAnswerTimer() {
    el.answerStageTimer.textContent = formatClock(answerLeft);
    el.answerStageTimer.classList.toggle("is-urgent", answerLeft <= 30 && answerLeft > 0);
  }

  /* 页面刚打开：没有题，也不起任何定时器 */
  function resetStageIdle() {
    stopAllTimers();
    resetVoice();

    answerStage = "idle";
    el.answerStage.setAttribute("data-stage", "idle");
    el.answerStageText.textContent = "面试开始后自动进入 30 秒思考";
    el.answerStageTimer.textContent = "--:--";
    el.answerStageTimer.classList.remove("is-urgent");

    lockAnswering();
    el.answer.value = "";
    el.answerCount.textContent = "0 字";
    el.submit.textContent = "提交回答";
    renderFillers();
  }

  /* 每道新题：清旧计时 → 锁输入 → 自动开始 30 秒思考（不需要用户点任何按钮） */
  function beginThinking() {
    stopAllTimers();
    resetVoice();

    lockAnswering();
    el.answer.value = "";
    el.answerCount.textContent = "0 字";
    renderFillers();
    /* 上一轮可能是「面试官思考中…」「重新提交」，新题一律复位 */
    el.submit.textContent = "提交回答";

    setStage("thinking", "请思考，30 秒后自动开始作答…");
    thinkLeft = THINK_SECONDS;
    thinkDeadline = Date.now() + THINK_SECONDS * 1000;
    renderThinkTimer();
    el.voiceHint.textContent = "思考阶段先别开口，30 秒后自动进入作答";

    thinkTimer = setInterval(function () {
      thinkLeft = Math.ceil((thinkDeadline - Date.now()) / 1000);

      if (thinkLeft > 0) {
        renderThinkTimer();
        return;
      }

      stopAllTimers();
      beginAnswering();
    }, 1000);
  }

  /* 30 秒到：解锁输入，同时启动 180 秒限时 */
  function beginAnswering() {
    if (!el.modal.open || finished) {
      stopAllTimers();
      return;
    }

    setStage("answering", "正在作答，剩余时间");
    unlockAnswering();

    answerLeft = ANSWER_SECONDS;
    answerDeadline = Date.now() + ANSWER_SECONDS * 1000;
    renderAnswerTimer();
    el.voiceHint.textContent = "可以打字，也可以点右侧麦克风说话";
    el.answer.focus();

    answerTimer = setInterval(function () {
      answerLeft = Math.ceil((answerDeadline - Date.now()) / 1000);

      if (answerLeft <= 0) {
        stopAnswerTimer();
        el.answerStageTimer.textContent = "00:00";
        el.answerStageTimer.classList.remove("is-urgent");
        setStage("timeup", "时间到，正在提交…");
        forceSubmit();
        return;
      }

      renderAnswerTimer();
    }, 1000);
  }

  /* 180 秒到点：停录音 → 空答案填占位文案 → 强制提交 */
  function forceSubmit() {
    if (submitting || finished) {
      stopAllTimers();
      return;
    }

    if (listening && voiceRecognition) {
      listening = false;
      voiceRecognition.stop();
    }

    if (recording) {
      discardRecording = true;
      stopRecording();
    }

    if (!el.answer.value.trim()) {
      el.answer.value = TIMEOUT_ANSWER;
      el.answerCount.textContent = el.answer.value.length + " 字";
    }

    submitAnswer(true);
  }

  async function submitAnswer(fromTimeout) {
    if (submitting || finished) return;
    if (!fromTimeout && answerStage !== "answering" && answerStage !== "typing") return;

    /* 提交即停止语音与录音，避免迟到的识别结果落到下一题 */
    if (listening && voiceRecognition) {
      listening = false;
      voiceRecognition.stop();
    }

    if (recording) {
      discardRecording = true;
      stopRecording();
    }

    const answer = el.answer.value.trim();
    if (!answer) {
      showFeedback("先开口作答或写下要点再提交。", true);
      el.answer.focus();
      return;
    }

    /* 手动提交也要立刻清掉 180 秒倒计时，否则它会在后台继续走到超时 */
    stopAllTimers();

    submitting = true;
    el.submit.disabled = true;
    el.submit.textContent = "面试官思考中…";
    hideFeedback();

    /* 先按原文统计口头禅，把提示推进聊天流，再把回答发给 AI */
    const fillerStats = countFillers(answer);
    let noteRow = null;
    if (totalFillers(fillerStats) > 0) {
      noteRow = appendNote(fillerMessage(fillerStats));
    }

    const candidateRow = appendChat("candidate", answer);

    el.answer.value = "";
    el.answerCount.textContent = "0 字";
    showFeedback("面试官正在看你的回答，大约十几秒…", false);

    const userMessage = {
      role: "user",
      content: buildInterviewUserMessage(answer)
    };
    /* 只发「已成功往返」的历史 + 本条，保证前缀稳定 */
    const outgoing = interviewMessages.concat([userMessage]);

    try {
      const res = await fetch(INTERVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: outgoing })
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }

      if (!res.ok) {
        const error = new Error(data.error || "接口返回 " + res.status);
        error.status = res.status;
        throw error;
      }

      const content = String(data.content || "").trim();
      if (!content) {
        throw new Error("模型没有返回内容，请再试一次");
      }

      const parsed = parseInterviewContent(content);
      if (!parsed) {
        throw new Error("面试官没给出有效点评，请重试一次");
      }

      /* 成功后才写入历史；失败重试时前缀不变，缓存照样能命中 */
      interviewMessages.push(userMessage, { role: "assistant", content: content });

      hideFeedback();
      if (parsed.comment) appendComment(parsed.comment);
      interviewRound += 1;
      saveInterviewDraft();

      if (interviewRound >= INTERVIEW_ROUNDS) {
        finishInterviewSession();
      } else {
        const next = parsed.nextQuestion ||
          FALLBACK_FOLLOWUPS[(interviewRound - 1) % FALLBACK_FOLLOWUPS.length];

        currentQuestion = next;

        /* 新题出现：先画题面，再自动进入 30 秒思考（两个定时器在 beginThinking 里重置） */
        appendChat("interviewer", withThinkHint(next));
        setInterviewRoundText("第 " + (interviewRound + 1) + " / " + INTERVIEW_ROUNDS + " 轮");
        beginThinking();
      }
    } catch (err) {
      /* 请求没成功：把刚插进去的这条气泡收回，避免重试后出现两份同样的回答 */
      if (noteRow && noteRow.parentNode) noteRow.remove();

      if (candidateRow && candidateRow.parentNode) {
        candidateRow.remove();
        interviewDisplay.pop();
        saveInterviewDraft();
      }

      if (isBusyError(err)) {
        showFeedback(
          "当前请求较多，冷却 " + INTERVIEW_RETRY_SECONDS + " 秒后可重新提交，回答内容不会丢。",
          true,
          "面试官正在看简历"
        );
        el.answer.value = answer;
        el.answerCount.textContent = answer.length + " 字";
        setStage("typing", "网络繁忙，冷却结束后可直接重试");
        pauseTimerDisplay();
        startCooldown(INTERVIEW_RETRY_SECONDS);
      } else {
        showFeedback(friendlyError(err), true);
        el.answer.value = answer;
        el.answerCount.textContent = answer.length + " 字";
        el.submit.disabled = false;
        el.submit.textContent = "重新提交";
        setStage("typing", "提交失败，回答已保留，可直接重试");
        pauseTimerDisplay();
      }
    } finally {
      submitting = false;
    }
  }

  /* ---------------- 语音输入（手动触发） + 录音保底 ---------------- */

  function initVoice() {
    if (!SpeechRecognition) {
      el.voiceHint.textContent = "当前浏览器不支持语音识别，可点「改用录音」或直接打字";
      return;
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = "zh-CN";
    /* continuous=false：说话停顿几秒后浏览器会自动结束 */
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onresult = function (event) {
      /* 已停止录音后，迟到的识别结果直接丢弃 */
      if (!listening) return;

      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += chunk;
        } else {
          interimText += chunk;
        }
      }

      if (finalText) voiceBaseText += finalText;
      el.answer.value = voiceBaseText + interimText;
      el.answerCount.textContent = el.answer.value.length + " 字";
      renderFillers();
    };

    voiceRecognition.onerror = function (event) {
      const code = event.error;
      stopVoice();

      if (code === "not-allowed" || code === "service-not-allowed") {
        window.alert("麦克风权限被拒绝，请去浏览器设置里允许");
        el.voiceHint.textContent = "麦克风权限被拒绝，请去浏览器设置里允许";
      } else if (code === "network") {
        el.voiceHint.textContent = "语音识别服务连不上，建议换 Edge，或点「改用录音」";
      } else if (code === "no-speech") {
        el.voiceHint.textContent = "没听到声音，再点一次麦克风，或点「改用录音」";
      } else if (code !== "aborted") {
        el.voiceHint.textContent = "识别中断：" + code + "，可点「改用录音」";
      }
    };

    voiceRecognition.onend = function () {
      stopVoice();
    };

    el.voiceHint.textContent = "点右侧麦克风开始语音输入，或直接打字";
  }

  function startVoice() {
    if (!SpeechRecognition) {
      window.alert("您的浏览器不支持语音识别，请换用 Edge 或 Chrome 浏览器，或直接打字输入");
      return;
    }

    if (!voiceRecognition || listening) return;

    if (recording) {
      el.voiceHint.textContent = "正在录音，请先点「停止录音」";
      return;
    }

    /* 只有作答阶段能开麦；思考阶段按钮本来就是禁用的 */
    if (answerStage !== "answering" && answerStage !== "typing") return;

    listening = true;
    voiceBaseText = el.answer.value;

    el.voiceBtn.classList.add("is-listening");
    el.voiceBtn.setAttribute("aria-pressed", "true");
    el.voiceLabel.textContent = "停止";
    el.voiceHint.textContent = "正在听…说话停顿几秒会自动结束";

    try {
      voiceRecognition.start();
    } catch (err) {
      stopVoice();
      window.alert(
        "麦克风启动失败：" + ((err && err.message) || "未知错误") +
        "。可点「改用录音」，或直接打字输入。"
      );
    }
  }

  function stopVoice() {
    listening = false;

    el.voiceBtn.classList.remove("is-listening");
    el.voiceBtn.setAttribute("aria-pressed", "false");
    el.voiceLabel.textContent = "语音";

    /* 阶段仍是 answering，180 秒继续走；这里只改提示，不动倒计时 */
    if (!submitting && !recording) {
      const hasText = el.answer.value.trim().length > 0;
      el.voiceHint.textContent = hasText
        ? "识别完成，可修改后提交"
        : "没识别到文字，可再点麦克风或改用录音";
    }
  }

  function toggleVoice() {
    if (!SpeechRecognition) {
      window.alert("您的浏览器不支持语音识别，请换用 Edge 或 Chrome 浏览器，或直接打字输入");
      return;
    }

    if (answerStage !== "answering" && answerStage !== "typing") return;

    if (listening) {
      listening = false;
      voiceRecognition.stop();
      return;
    }

    startVoice();
  }

  /* ---- 录音保底：只用 MediaRecorder 录声音，不转文字 ---- */

  function canRecord() {
    return Boolean(
      window.MediaRecorder &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );
  }

  async function startRecording() {
    if (recording || recordingPending) return;

    if (!canRecord()) {
      window.alert("当前浏览器不支持录音，请直接打字输入");
      return;
    }

    recordingPending = true;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      recordingPending = false;
      window.alert("麦克风权限被拒绝，请去浏览器设置里允许");
      el.voiceHint.textContent = "麦克风权限被拒绝，去浏览器设置里允许后可重试";
      return;
    }

    /* 等待授权期间关掉了弹窗：直接释放麦克风 */
    if (!el.modal.open) {
      mediaStream.getTracks().forEach(function (track) {
        track.stop();
      });
      mediaStream = null;
      recordingPending = false;
      return;
    }

    audioChunks = [];
    discardRecording = false;

    try {
      mediaRecorder = new window.MediaRecorder(mediaStream);
    } catch (err) {
      mediaStream.getTracks().forEach(function (track) {
        track.stop();
      });
      mediaStream = null;
      window.alert("当前浏览器不支持录音，请直接打字输入");
      return;
    }

    mediaRecorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = function () {
      const mime = (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
      const blob = new Blob(audioChunks, { type: mime });

      mediaRecorder = null;
      recording = false;
      el.recordBtn.textContent = "改用录音";
      el.recordBtn.disabled = false;
      el.voiceBtn.disabled = false;
      el.voiceBtn.classList.remove("is-recording");

      if (discardRecording) {
        discardRecording = false;
        audioChunks = [];
        return;
      }

      if (!blob.size) {
        el.voiceHint.textContent = "没录到声音，请重试或直接打字";
        return;
      }

      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      recordedUrl = URL.createObjectURL(blob);
      el.voicePreview.src = recordedUrl;
      el.voicePreviewWrap.hidden = false;

      el.voiceHint.textContent = "语音已录制，可在上方回放，并手动输入回答文字";
    };

    mediaRecorder.start();
    recording = true;
    recordingPending = false;

    el.recordBtn.textContent = "停止录音";
    el.voiceBtn.disabled = true;
    el.voiceBtn.classList.add("is-recording");
    el.voiceHint.textContent = "正在录音，说完点「停止录音」";
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(function (track) {
        track.stop();
      });
      mediaStream = null;
    }
  }

  function toggleRecording() {
    if (recording) {
      discardRecording = false;
      stopRecording();
      return;
    }

    if (listening && voiceRecognition) {
      listening = false;
      voiceRecognition.stop();
    }

    startRecording();
  }

  /* 每题开始 / 关窗时清干净：停录音、撤销 blob、隐藏回放 */
  function resetVoice() {
    discardRecording = true;

    if (listening && voiceRecognition) {
      listening = false;
      voiceRecognition.stop();
    }

    if (recording) stopRecording();

    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      recordedUrl = "";
    }

    el.voicePreview.removeAttribute("src");
    el.voicePreviewWrap.hidden = true;
    el.recordBtn.textContent = "改用录音";
    el.voiceBtn.classList.remove("is-listening", "is-recording");
    el.voiceLabel.textContent = "语音";
  }

  /* ---------------- 结束面试并生成复盘报告 ---------------- */

  /* 雷达图的五个维度，顺序与提示词里约定的完全一致 */
  const SCORE_LABELS = ["专业知识", "逻辑思维", "抗压能力", "岗位匹配", "表达沟通"];

  let scoreChart = null;

  /* 从报告首行解析「SCORES: 专业知识=82, ...」，缺一维就整条不算 */
  function parseScores(raw) {
    const line = String(raw || "").match(/SCORES\s*[:：]\s*(.+)/i);
    if (!line) return null;

    const found = {};

    line[1].split(/[,，;；]/).forEach(function (pair) {
      const parts = pair.split(/[=:：]/);
      if (parts.length < 2) return;

      const label = parts[0].trim();
      const value = Number(String(parts[1]).replace(/[^\d.]/g, ""));

      if (!Number.isFinite(value)) return;
      found[label] = Math.max(0, Math.min(100, Math.round(value)));
    });

    const keys = Object.keys(found);
    const scores = [];

    for (let i = 0; i < SCORE_LABELS.length; i += 1) {
      const label = SCORE_LABELS[i];

      /* 模型偶尔会写「抗压能力（心理）」这种，用包含匹配兜一下 */
      const hit = keys.find(function (key) {
        return key.indexOf(label) !== -1;
      });

      if (hit === undefined) return null;
      scores.push({ label: label, value: found[hit] });
    }

    return scores;
  }

  /* 分数那一行不给人看 */
  function stripScoreLine(text) {
    return String(text || "").replace(/^[ \t]*SCORES\s*[:：].*(\r?\n)?/im, "").trim();
  }

  function drawScoreChart(scores) {
    if (!window.Chart || !el.reportChart || !scores) return false;

    /* 先显示容器，否则 Chart.js 量不到尺寸，画出来是 0×0 */
    el.reportChartWrap.hidden = false;

    if (scoreChart) {
      scoreChart.destroy();
      scoreChart = null;
    }

    scoreChart = new window.Chart(el.reportChart, {
      type: "radar",
      data: {
        labels: scores.map(function (s) { return s.label; }),
        datasets: [{
          label: "本次得分",
          data: scores.map(function (s) { return s.value; }),
          backgroundColor: "rgba(27, 110, 168, 0.22)",
          borderColor: "#1B6EA8",
          borderWidth: 2,
          pointBackgroundColor: "#0F3A63",
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 20,
              backdropColor: "transparent",
              color: "#8496A6",
              font: { size: 10 }
            },
            grid: { color: "#E5EBF1" },
            angleLines: { color: "#E5EBF1" },
            pointLabels: { color: "#0F3A63", font: { size: 12 } }
          }
        },
        plugins: { legend: { display: false } }
      }
    });

    return true;
  }

  function showReport(text, scores) {
    el.reportText.textContent = stripScoreLine(text);

    const drawn = scores ? drawScoreChart(scores) : false;

    el.reportChartWrap.hidden = !drawn;
    el.reportScores.hidden = !(scores && !drawn);

    /* Chart.js 没加载成功时，至少把分数用文字列出来 */
    if (scores && !drawn) {
      el.reportScores.textContent = scores
        .map(function (s) { return s.label + " " + s.value; })
        .join(" · ");
    }

    el.reportBody.scrollTop = 0;
    el.reportModal.showModal();
  }

  /* 模型偶尔仍会套一层 JSON，能把 comment 取出来就用它 */
  function extractReport(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";

    if (text.charAt(0) === "{") {
      const parsed = parseInterviewContent(text);
      if (parsed && parsed.comment) return parsed.comment;
    }
    return text;
  }

  async function runReport() {
    evaluating = true;
    stopAllTimers();

    if (listening && voiceRecognition) {
      listening = false;
      voiceRecognition.stop();
    }
    el.answerBlock.hidden = true;
    el.submit.disabled = true;
    el.endBtn.disabled = true;
    el.endBtn.textContent = "报告生成中…";

    /* 先结算时长：写报告的时间不计入学习时间 */
    recordInterview();
    showFeedback("评委正在复盘这场面试，报告较长，大约需要 40—60 秒…", false);

    const instruction = { role: "user", content: REPORT_INSTRUCTION };
    const outgoing = interviewMessages.concat([instruction]);

    try {
      const res = await fetch(INTERVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: outgoing })
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }

      if (!res.ok) {
        const error = new Error(data.error || "接口返回 " + res.status);
        error.status = res.status;
        throw error;
      }

      const raw = String(data.content || "").trim();
      if (!raw) throw new Error("评委没有返回内容，请再试一次");

      const report = extractReport(raw);
      if (!report) throw new Error("报告内容为空，请重试一次");

      interviewMessages.push(instruction, { role: "assistant", content: raw });

      hideFeedback();
      showReport(report, parseScores(report));

      /* 报告落进面试档案：换题、断点续传、清草稿都不会影响它。
         存剥掉 SCORES 行的正文，档案里给人看的是正文，不是分数行 */
      addArchiveRecord(stripScoreLine(report) || report);

      evaluated = true;
      clearInterviewDraft();
      el.endBtn.disabled = false;
      el.endBtn.textContent = "查看报告";
    } catch (err) {
      showFeedback(friendlyError(err), true);
      el.endBtn.disabled = false;
      el.endBtn.textContent = "重试生成报告";
    } finally {
      evaluating = false;
    }
  }

  function handleEnd() {
    if (evaluating) return;

    /* 报告已经生成过：再点就是重新打开它 */
    if (evaluated) {
      el.reportModal.showModal();
      return;
    }

    /* 一句没答就点结束：直接关，不生成报告也不计时 */
    if (interviewRound === 0 && !finished) {
      el.modal.close();
      return;
    }

    runReport();
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    el.goalInput.addEventListener("input", function () {
      const raw = el.goalInput.value.trim();
      const value = Number(raw);

      state.goal =
        raw === "" || !Number.isFinite(value)
          ? 0
          : Math.max(0, Math.min(MAX_GOAL, Math.round(value)));

      markDirty();
      renderTime();
    });

    el.btnInterview.addEventListener("click", openSetup);

    /* 面试设置面板 */
    el.setupStart.addEventListener("click", startInterview);

    el.setupCancel.addEventListener("click", function () {
      el.setupModal.close();
    });

    el.setupClose.addEventListener("click", function () {
      el.setupModal.close();
    });

    /* 面试 */
    /* 不再有「开始作答」按钮：新题出现即自动进入思考 */
    el.submit.addEventListener("click", function () {
      submitAnswer(false);
    });
    el.recordBtn.addEventListener("click", toggleRecording);
    el.endBtn.addEventListener("click", handleEnd);
    el.voiceBtn.addEventListener("click", toggleVoice);

    el.closeBtn.addEventListener("click", function () {
      el.modal.close();
    });

    el.answer.addEventListener("input", function () {
      el.answerCount.textContent = el.answer.value.length + " 字";
      renderFillers();
    });

    /* 手机上点边缘很容易误触遮罩导致闪退，面试弹窗禁止点背景关闭，也禁用 Esc */
    el.modal.addEventListener("cancel", function (event) {
      event.preventDefault();
    });

    /* 关窗不计时：只有「结束面试」和答满轮次才计时 */
    el.modal.addEventListener("close", function () {
      /* 关窗必须清定时器、语音与录音，否则会在后台继续跑 */
      stopAllTimers();
      resetVoice();
      exitFullscreen();

      /* 兜底：万一浏览器拒绝退出全屏，也别把首页永久藏在 is-fs 里 */
      if (!isFullscreen()) document.body.classList.remove("is-fs");

      submitting = false;
      finished = false;
      interviewRound = 0;
      evaluating = false;
      evaluated = false;
      interviewDisplay = [];
      /* 正常关窗说明这场面试结束了，清掉存档；崩溃不会触发 close，存档得以保留 */
      clearInterviewDraft();

      if (cooldownTimer) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    });

    /* 云端同步 */
    el.syncSave.addEventListener("click", bindAndSync);

    el.syncInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") bindAndSync();
    });

    /* 复盘报告 */
    el.reportClose.addEventListener("click", function () {
      el.reportModal.close();
    });

    el.reportDone.addEventListener("click", function () {
      el.reportModal.close();
    });

    el.reportModal.addEventListener("click", function (event) {
      if (event.target === el.reportModal) el.reportModal.close();
    });

    /* 全屏与防作弊 */
    el.fsBtn.addEventListener("click", toggleFullscreen);

    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (name) {
      document.addEventListener(name, handleFullscreenChange);
    });

    /* 回答框禁止粘贴：面试要的是即兴表达，不是复制简历 */
    el.answer.addEventListener("paste", function (event) {
      event.preventDefault();
      showToast("面试中禁止粘贴，请自己组织语言");
    });

    /* 右键菜单只在面试进行时禁掉，别影响其他页面操作 */
    document.addEventListener("contextmenu", function (event) {
      if (!el.modal.open) return;
      event.preventDefault();
      showToast("面试中已禁用右键菜单");
    });

    /* 面试档案 */
    el.btnArchive.addEventListener("click", openArchive);
    el.archiveDiagnose.addEventListener("click", runDiagnosis);

    el.archiveClose.addEventListener("click", function () {
      el.archiveModal.close();
    });

    el.archiveDone.addEventListener("click", function () {
      el.archiveModal.close();
    });

    el.archiveModal.addEventListener("click", function (event) {
      if (event.target === el.archiveModal) el.archiveModal.close();
    });
  }

  /* ---------------- 轻提示（toast） ---------------- */

  let toastTimer = null;

  function showToast(text) {
    if (!el.toast) return;

    el.toast.textContent = String(text || "");
    el.toast.classList.add("is-show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("is-show");
      toastTimer = null;
    }, 2600);
  }

  /* ---------------- 全屏沉浸模式（防作弊） ---------------- */

  let fsExitByButton = false;

  function fullscreenApi() {
    const root = document.documentElement;

    return {
      request: root.requestFullscreen || root.webkitRequestFullscreen || null,
      exit: document.exitFullscreen || document.webkitExitFullscreen || null,
      current: function () {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
      }
    };
  }

  function isFullscreen() {
    return Boolean(fullscreenApi().current());
  }

  /* iOS Safari 对普通元素基本不支持全屏：这里全部吞掉异常，不让它中断面试 */
  function requestFullscreen() {
    const api = fullscreenApi();
    if (!api.request || isFullscreen()) return false;

    try {
      const result = api.request.call(document.documentElement);
      if (result && typeof result.catch === "function") {
        result.catch(function () {
          /* 用户拒绝或被浏览器拦住，静默降级为普通窗口 */
        });
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function exitFullscreen() {
    const api = fullscreenApi();
    if (!api.exit || !isFullscreen()) return;

    /* 主动退出不算违纪，标记一下，别弹警告 */
    fsExitByButton = true;

    try {
      const result = api.exit.call(document);
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (err) {
      /* 忽略 */
    }
  }

  function updateFsButton(fs) {
    if (!el.fsBtn) return;

    el.fsBtn.textContent = fs ? "退出" : "全屏";
    el.fsBtn.setAttribute("aria-label", fs ? "退出全屏" : "进入全屏");
  }

  function handleFullscreenChange() {
    const fs = isFullscreen();

    document.body.classList.toggle("is-fs", fs);
    updateFsButton(fs);

    if (fs) return;

    /* 点按钮退出是正常操作，只有按 Esc 这类非常规退出才提示 */
    if (fsExitByButton) {
      fsExitByButton = false;
      return;
    }

    if (el.modal.open) {
      showToast("检测到您退出了全屏，请注意考试纪律");
    }
  }

  function toggleFullscreen() {
    if (isFullscreen()) {
      exitFullscreen();
      return;
    }
    requestFullscreen();
  }

  /* ---------------- 口头禅实时统计 ---------------- */

  const FILLERS = ["嗯", "啊", "那个", "然后", "就是"];

  function countFillers(text) {
    const source = String(text || "");
    const stats = {};

    FILLERS.forEach(function (word) {
      let count = 0;
      let index = source.indexOf(word);

      while (index !== -1) {
        count += 1;
        index = source.indexOf(word, index + word.length);
      }

      stats[word] = count;
    });

    return stats;
  }

  function totalFillers(stats) {
    return FILLERS.reduce(function (sum, word) {
      return sum + (stats[word] || 0);
    }, 0);
  }

  function renderFillers() {
    if (!el.fillerLine) return null;

    const stats = countFillers(el.answer.value);

    el.fillerLine.innerHTML = "口头禅：" + FILLERS.map(function (word) {
      const hit = stats[word] > 0;
      return '<span class="filler-item' + (hit ? " is-hit" : "") + '">' +
        word + "(" + stats[word] + ")</span>";
    }).join(" ");

    return stats;
  }

  function fillerMessage(stats) {
    const parts = FILLERS
      .filter(function (word) { return stats[word] > 0; })
      .map(function (word) { return stats[word] + " 次「" + word + "」"; });

    return "⚠️ 你在刚才的回答中使用了 " + parts.join("、") + "，注意精简语言！";
  }

  /* ---------------- 面试档案（历次复盘报告 + 高频错误诊断书） ---------------- */

  function dateStamp() {
    const d = new Date();
    const pad = function (n) {
      return String(n).padStart(2, "0");
    };

    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /* 单条档案的最低要求：有报告正文、有日期；缺字段的一律当坏数据丢掉 */
  function isValidArchiveItem(item) {
    if (!item || typeof item !== "object") return false;
    if (typeof item.reportText !== "string" || !item.reportText.trim()) return false;
    if (typeof item.date !== "string" || !item.date.trim()) return false;
    return true;
  }

  /* 读坏了就当空档案，绝不能让首页白屏 */
  function loadArchive() {
    try {
      const raw = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter(isValidArchiveItem).slice(0, ARCHIVE_MAX);
    } catch (err) {
      return [];
    }
  }

  function saveArchive() {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
    } catch (err) {
      /* 存不下不影响当前使用 */
    }
  }

  function escapeText(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* 报告生成成功后调用；同一场面试只进一次（成功即 evaluated） */
  function addArchiveRecord(reportText) {
    const text = String(reportText || "").trim();
    if (!text) return;

    archive.unshift({
      id: Date.now(),
      date: dateStamp(),
      position: currentRole || "未记录岗位",
      reportText: text
    });

    if (archive.length > ARCHIVE_MAX) archive = archive.slice(0, ARCHIVE_MAX);

    saveArchive();
    renderArchiveCount();
  }

  function renderArchiveCount() {
    el.archiveCount.textContent = String(archive.length);
    el.archiveCount.classList.toggle("is-zero", archive.length === 0);
    /* 按钮状态跟着数据走，不依赖 HTML 里的初始 disabled */
    el.archiveDiagnose.disabled = archive.length === 0 || diagnosing;
  }

  function renderArchive() {
    el.archiveTotal.textContent = archive.length + " 次";
    el.archiveEmpty.hidden = archive.length > 0;
    el.archiveDiagnose.disabled = archive.length === 0 || diagnosing;
    renderArchiveCount();

    const shown = archive.slice(0, ARCHIVE_LIST_SHOWN);

    el.archiveList.innerHTML = shown.map(function (item) {
      const snippet = String(item.reportText || "").replace(/\s+/g, " ").trim().slice(0, 110);

      return (
        '<div class="archive-item">' +
        '<div class="archive-head">' +
        '<span class="archive-date">' + escapeText(item.date) + "</span>" +
        '<span class="archive-role">' + escapeText(item.position || "") + "</span>" +
        "</div>" +
        '<p class="archive-snippet">' + escapeText(snippet) + "…</p>" +
        "</div>"
      );
    }).join("");

    if (archive.length > ARCHIVE_LIST_SHOWN) {
      el.archiveMore.hidden = false;
      el.archiveMore.textContent =
        "只显示最近 " + ARCHIVE_LIST_SHOWN + " 次；诊断会用到最近 " +
        Math.min(archive.length, ARCHIVE_DIAGNOSIS_SOURCE) + " 份报告";
    } else {
      el.archiveMore.hidden = true;
    }
  }

  function openArchive() {
    /* 多标签页时档案可能变了，打开前重读一次；读坏了 loadArchive 会返回空数组 */
    archive = loadArchive();

    /* 第一次用：不弹空面板，直接一句提示，别让人以为坏了 */
    if (!archive.length) {
      showToast("还没有历史面试记录，先去面一场吧！");
      return;
    }

    try {
      renderArchive();
      el.archiveModal.showModal();
      el.archiveBody.scrollTop = 0;
    } catch (err) {
      /* 渲染异常也不能把整页拖死 */
      showToast("档案打不开，刷新页面再试一次");
    }
  }

  /* 诊断书是独立的一次请求：只带教练提示词 + 报告合集，不复用面试的 messages */
  function buildDiagnosisMessages(list) {
    const blocks = list.map(function (item, index) {
      /* 单份报告截到 2600 字：防止 5 份拼起来撞上代理的请求体上限 */
      const text = String(item.reportText || "").slice(0, 2600);

      return "【第 " + (index + 1) + " 次 · " + item.date + " · " +
        (item.position || "未记录岗位") + "】\n" + text;
    });

    const userContent = [
      "这是该候选人最近 " + list.length + " 次面试的复盘报告，按时间从新到旧排列：",
      "",
      blocks.join("\n\n----------\n\n"),
      "",
      "请横向对比这些报告，找出他反反复复出错、始终没有改掉的 3 个核心顽疾，并按要求给出强制脱敏训练计划。"
    ].join("\n");

    return [
      { role: "system", content: DIAGNOSIS_SYSTEM_PROMPT },
      { role: "user", content: userContent }
    ];
  }

  async function runDiagnosis() {
    if (diagnosing) return;
    if (!archive.length) return;

    const list = archive.slice(0, ARCHIVE_DIAGNOSIS_SOURCE);

    diagnosing = true;
    el.archiveDiagnose.disabled = true;
    el.archiveDiagnose.textContent = "教练正在对比这 " + list.length + " 份报告…";
    el.archiveDiagnosis.hidden = false;
    el.archiveDiagnosis.classList.remove("is-error");
    el.archiveDiagnosisTitle.textContent = "高频错误诊断书";
    el.archiveDiagnosisText.textContent = "正在横向比对，大约需要 30—50 秒…";

    try {
      const res = await fetch(INTERVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: buildDiagnosisMessages(list) })
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }

      if (!res.ok) {
        const error = new Error(data.error || "接口返回 " + res.status);
        error.status = res.status;
        throw error;
      }

      const text = String(data.content || "").trim();
      if (!text) throw new Error("教练没有返回内容，请再试一次");

      el.archiveDiagnosis.classList.remove("is-error");
      el.archiveDiagnosisTitle.textContent = "高频错误诊断书（基于最近 " + list.length + " 次面试）";
      el.archiveDiagnosisText.textContent = text;

      if (typeof el.archiveDiagnosis.scrollIntoView === "function") {
        el.archiveDiagnosis.scrollIntoView({ block: "nearest" });
      }
    } catch (err) {
      el.archiveDiagnosis.classList.add("is-error");
      el.archiveDiagnosisTitle.textContent = "诊断生成失败";
      el.archiveDiagnosisText.textContent = friendlyError(err);
    } finally {
      diagnosing = false;
      el.archiveDiagnose.disabled = archive.length === 0;
      el.archiveDiagnose.textContent = "AI 帮我生成高频错误诊断书";
    }
  }

  /* ---------------- 启动 ---------------- */

  loadState();
  el.goalInput.value = state.goal > 0 ? String(state.goal) : "";
  renderDate();
  renderAll();
  renderArchiveCount();
  initVoice();
  bindEvents();

  /* 浏览器支持全屏才显示那个按钮（iOS Safari 一般不支持） */
  if (el.fsBtn) {
    el.fsBtn.hidden = !(document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen);
    updateFsButton(false);
  }

  resetStageIdle();
  renderFillers();

  /* 恢复同步码；有就静默拉一次云端 */
  syncCode = readSyncCode();
  if (syncCode) {
    el.syncInput.value = syncCode;
    el.syncSave.textContent = "立即同步";
    setSyncStatus("已绑定");
    pullCloudOnStart();
  }

  /* 稍等一拍，让首页先渲染出来再问要不要继续上次的面试 */
  setTimeout(offerResume, 400);
})();

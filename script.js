/* ============================================================
   三桶油笔试面试训练工作台 · script.js

   笔试：优先向 /api/quiz 要新题；失败则从本地 50 道题库抽题。
        交卷后判分（绿对红错 + 解析），并按真实耗时计时。
   面试：3 轮追问式对话，每轮 AI 点评 + 追问。
        满 3 轮或点「结束面试」时，按真实耗时计时。

   计时口径：
   弹窗打开时记 startTime，交卷 / 结束面试时记 endTime，
   两者相减后四舍五入为分钟数（只做 1 分钟就记 1 分钟）。
   点 ×、点遮罩、按 Esc 关窗一律不计时。
   ============================================================ */
(function () {
  "use strict";

  /* 两个接口地址：与 proxy.js 中的端口保持一致 */
  const INTERVIEW_ENDPOINT = "http://127.0.0.1:8787/api/interview";
  const QUIZ_ENDPOINT = "http://127.0.0.1:8787/api/quiz";

  const INTERVIEW_ROUNDS = 5;
  const INTERVIEW_RETRY_SECONDS = 3;

  const DEFAULT_GOAL = 90;
  const MAX_GOAL = 600;
  const STORE_KEY = "oil-workbench-v1";

  /* ---------------- 本地题库（50 道，AI 出题失败时的兜底） ---------------- */

  const LOCAL_QUIZ = [
    /* --- 行测 · 逻辑判断（16 题） --- */
    {
      tag: "行测 · 逻辑判断",
      stem: "某油田招聘规定：只有通过笔试，才能进入面试环节。小王已经参加了面试。由此可以推出：",
      options: ["小王通过了笔试", "小王没有通过笔试", "小王可能没有通过笔试", "无法确定小王是否通过笔试"],
      answer: "A",
      explain: "「只有 P 才 Q」是必要条件，等价于「Q → P」。参加了面试说明笔试已通过，故选 A。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "某油田近年原油产量持续下降，有人认为主因是设备老化。以下哪项如果为真，最能削弱这一观点？",
      options: [
        "该油田近三年未对主要生产设备进行更新",
        "该油田因设备故障导致的停机时间同比增加 40%",
        "该油田所在区域去年遭遇罕见洪涝，停产近两个月",
        "该油田一线员工平均年龄偏大"
      ],
      answer: "C",
      explain: "削弱题最稳的路径是「另有他因」。洪涝停产也能解释产量下降，切断了设备老化的因果链。A、B 在加强。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "某油田推行「隐患随手拍」后，事故率明显下降。以下哪项最能支持「是这项措施降低了事故率」？",
      options: [
        "推行期间该油田原油产量同比上升",
        "同期未推行该措施的兄弟油田事故率基本持平",
        "员工对活动的参与热情很高",
        "该油田此前事故率一直偏高"
      ],
      answer: "B",
      explain: "B 提供了对照组：没推行的没降、推行的降了，因果关系才立得住。其余选项与事故率升降无直接关系。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "所有采油工都持证上岗；有些持证上岗的员工是转岗人员。由此可以推出：",
      options: ["有些采油工是转岗人员", "所有转岗人员都是采油工", "有些转岗人员持证上岗", "持证上岗的都是采油工"],
      answer: "C",
      explain: "「有些持证上岗的员工是转岗人员」直接等价于「有些转岗人员持证上岗」。A 项把两个「有些」硬连起来，推不出。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "「该班组所有成员都参加了应急演练」的矛盾命题是：",
      options: ["该班组所有成员都没参加", "该班组有的成员没参加", "该班组有的成员参加了", "该班组多数成员参加了"],
      answer: "B",
      explain: "全称肯定的矛盾是特称否定，即「有的成员没参加」。A 项是「所有都不」，强度过头，不是矛盾命题。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "如果新井投产，则必须通过竣工验收。下列推理正确的是：",
      options: ["通过竣工验收，则新井投产", "未通过竣工验收，则新井不能投产", "新井未投产，则未通过竣工验收", "未投产的新井都通过了验收"],
      answer: "B",
      explain: "「投产 → 验收」的逆否命题是「未验收 → 未投产」，二者等价。A 项把充分条件当成了必要条件。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "钻井：钻头  相当于  采油：？",
      options: ["抽油机", "原油", "井架", "套管"],
      answer: "A",
      explain: "钻头是钻井的核心工具，抽油机是采油的核心设备，都是「作业—工具」关系。原油是产物，不是工具。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "某井区规定：凡进入生产区必须佩戴安全帽。小李进入了生产区，但没有佩戴安全帽。由此可以推出：",
      options: ["小李违反了该规定", "小李不是本单位员工", "该规定对小李无效", "小李佩戴了其他防护用品"],
      answer: "A",
      explain: "全称命题「凡进入生产区都必须戴安全帽」，小李进入了且未戴，构成直接违反，故选 A。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "甲、乙、丙三人中只有一人说了真话。甲说「我没有违章」；乙说「甲违章了」；丙说「我没有违章」。由此可以确定：",
      options: ["丙违章作业", "甲违章作业", "乙违章作业", "三人都没违章"],
      answer: "A",
      explain: "甲、乙的话互为矛盾，必有一真一假；既然只有一人说真话，丙说的必是假话，即丙违章。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "甲、乙、丙、丁四班轮流值夜班，共四天。已知：甲不在第一天；乙在丙的前一天；丁在第四天。第三天值班的是：",
      options: ["甲", "乙", "丙", "丁"],
      answer: "A",
      explain: "丁占第四天，剩前三天排甲乙丙。乙丙相邻，只能排第 1、2 天或第 2、3 天；若排第 2、3 天，甲只能排第 1 天，违反条件。故乙第 1 天、丙第 2 天，甲第 3 天。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "「只要完成年度产量指标，就能获得绩效奖励」。据此理解正确的是：",
      options: ["获得奖励的一定完成了指标", "完成指标的一定能获得奖励", "未完成指标的也可能获得奖励", "完成指标是获得奖励的必要条件"],
      answer: "B",
      explain: "「只要 P 就 Q」中 P 是 Q 的充分条件，P 成立则 Q 必成立，故选 B。A 项是把充分条件误当必要条件。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "某油田今年原油产量同比增长 8%，天然气产量同比下降 3%。由此不能推出：",
      options: ["原油产量高于去年", "天然气产量低于去年", "油气当量总产量一定增长", "原油产量的变化方向与天然气相反"],
      answer: "C",
      explain: "原油增、天然气减，两者相加后的当量总量是否增长取决于各自权重，无法必然推出 C。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "某研究称「使用新型钻井液的井，机械钻速平均提高 15%」，据此认为新型钻井液能提高钻速。该结论成立需要的前提是：",
      options: [
        "新型钻井液价格更低",
        "使用新型钻井液的井与对比井的其它条件基本相同",
        "所有井都使用了新型钻井液",
        "钻速提高能降低钻井成本"
      ],
      answer: "B",
      explain: "要证明因果，必须排除地层、井深、钻压等其他变量的干扰，B 正是这个前提。其余选项与因果关系无关。"
    },
    {
      tag: "行测 · 逻辑判断",
      stem: "某油田提高注水量后，原油产量不升反降。以下哪项最能解释这一现象？",
      options: ["注水成本上升", "注水压力过高导致地层破裂，水沿裂缝窜入油层通道", "员工对新设备不熟悉", "同期国际油价上涨"],
      answer: "B",
      explain: "B 给出了直接机理：水窜导致油井含水上升、产油下降，能解释「注水越多产量越低」的反常结果。"
    },
    {
      tag: "行测 · 数量关系",
      stem: "某项检修任务，甲队单独完成需 12 天，乙队单独完成需 18 天。两队合作需要多少天？",
      options: ["6 天", "7.2 天", "7.5 天", "8 天"],
      answer: "B",
      explain: "合作效率 = 1/12 + 1/18 = 5/36，工期 = 36/5 = 7.2 天。"
    },
    {
      tag: "行测 · 数量关系",
      stem: "某油田将 1200 万元投资按 3:5 分配给两个区块，较大部分分得多少万元？",
      options: ["450", "600", "750", "800"],
      answer: "C",
      explain: "总份数为 8，较大部分占 5 份：1200 × 5 ÷ 8 = 750 万元。"
    },

    /* --- 资料分析（10 题） --- */
    {
      tag: "资料分析 · 增长率",
      stem: "某油田 2023 年原油产量 1200 万吨，2024 年为 1260 万吨。2024 年同比增长率是多少？",
      options: ["3%", "5%", "6%", "8%"],
      answer: "B",
      explain: "增长率 =（1260 − 1200）÷ 1200 = 5%。"
    },
    {
      tag: "资料分析 · 基期量",
      stem: "某油田 2024 年原油产量 1260 万吨，比上年增长 5%。2023 年产量约为多少万吨？",
      options: ["1150", "1200", "1230", "1323"],
      answer: "B",
      explain: "基期量 = 1260 ÷（1 + 5%）= 1200 万吨。D 项 1323 是把「求基期」做成了「求现期」。"
    },
    {
      tag: "资料分析 · 年均增长",
      stem: "某油田 2022 年产量 1000 万吨，2024 年达到 1210 万吨。这两年的年均增长率约为：",
      options: ["5%", "10%", "15%", "21%"],
      answer: "B",
      explain: "1000 × 1.1 × 1.1 = 1210，故年均增长率约为 10%。21% 是两期总增长率，不是年均。"
    },
    {
      tag: "资料分析 · 比重",
      stem: "某石油公司 2024 年营业收入 800 亿元，其中勘探开发板块 320 亿元。该板块占营业收入的比重是：",
      options: ["25%", "32%", "40%", "45%"],
      answer: "C",
      explain: "比重 = 320 ÷ 800 = 40%。"
    },
    {
      tag: "资料分析 · 百分点",
      stem: "某公司新能源业务收入占比由 2023 年的 32% 提高到 2024 年的 35%，提高了：",
      options: ["3 个百分点", "3%", "9.4%", "10 个百分点"],
      answer: "A",
      explain: "两个百分数相减，单位是「百分点」：35% − 32% = 3 个百分点。写成 3% 是常见错误。"
    },
    {
      tag: "资料分析 · 平均数",
      stem: "某油田 2024 年产油 1260 万吨，在岗员工 2.1 万人。人均年产油约为：",
      options: ["60 吨", "300 吨", "600 吨", "1200 吨"],
      answer: "C",
      explain: "1260 万吨 ÷ 2.1 万人 = 600 吨/人。注意万吨与万人的单位相互抵消。"
    },
    {
      tag: "资料分析 · 倍数",
      stem: "某油田 A 区块年产油 1260 万吨，B 区块年产油 420 万吨。A 是 B 的多少倍？",
      options: ["2 倍", "3 倍", "4 倍", "5 倍"],
      answer: "B",
      explain: "1260 ÷ 420 = 3，即 3 倍。"
    },
    {
      tag: "资料分析 · 现期量",
      stem: "某油田 2024 年产油 1260 万吨，若 2025 年再增长 5%，2025 年产量约为：",
      options: ["1290 万吨", "1300 万吨", "1323 万吨", "1330 万吨"],
      answer: "C",
      explain: "1260 ×（1 + 5%）= 1323 万吨。"
    },
    {
      tag: "资料分析 · 增长量",
      stem: "某油田原油产量由 1200 万吨增至 1260 万吨，增长量是多少？",
      options: ["5 万吨", "60 万吨", "5%", "60%"],
      answer: "B",
      explain: "增长量 = 现期 − 基期 = 1260 − 1200 = 60 万吨。增长量带单位，增长率才是百分数。"
    },
    {
      tag: "资料分析 · 增长率",
      stem: "某板块营业收入由 2023 年的 200 亿元增至 2024 年的 250 亿元，增长率是：",
      options: ["20%", "25%", "50%", "80%"],
      answer: "B",
      explain: "增长率 =（250 − 200）÷ 200 = 25%。50 亿元是增长量，不是增长率。"
    },

    /* --- 时政 · 能源政策（12 题） --- */
    {
      tag: "时政 · 能源政策",
      stem: "我国提出的「双碳」目标，具体是指：",
      options: ["2025 年前碳达峰、2035 年前碳中和", "2030 年前碳达峰、2060 年前碳中和", "2035 年前碳达峰、2050 年前碳中和", "2030 年前碳达峰、2050 年前碳中和"],
      answer: "B",
      explain: "2020 年 9 月我国在联合国大会上提出：2030 年前实现碳达峰，2060 年前实现碳中和。"
    },
    {
      tag: "时政 · 能源政策",
      stem: "我国能源安全新战略概括为「四个革命、一个合作」，其中不属于「四个革命」的是：",
      options: ["能源消费革命", "能源供给革命", "能源技术革命", "能源价格革命"],
      answer: "D",
      explain: "四个革命指消费革命、供给革命、技术革命、体制革命；一个合作指全方位加强国际合作。没有「价格革命」。"
    },
    {
      tag: "时政 · 能源政策",
      stem: "全国碳排放权交易市场于 2021 年 7 月上线交易，首批纳入的行业是：",
      options: ["钢铁行业", "发电行业", "石化行业", "建材行业"],
      answer: "B",
      explain: "首批仅纳入发电行业，之后再按「成熟一个、纳入一个」的原则逐步扩围。"
    },
    {
      tag: "时政 · 海洋油气",
      stem: "我国首个自营勘探开发的超深水大气田是：",
      options: ["崖城 13-1", "荔湾 3-1", "深海一号", "陵水 17-2"],
      answer: "C",
      explain: "「深海一号」超深水大气田 2021 年投产，标志着我国海洋石油勘探开发能力迈入超深水时代。"
    },
    {
      tag: "时政 · 海洋油气",
      stem: "我国目前最大的原油生产基地是：",
      options: ["大庆油田", "胜利油田", "渤海油田", "长庆油田"],
      answer: "C",
      explain: "渤海油田是我国第一大原油生产基地；长庆油田则以油气当量计为我国第一大油气田。"
    },
    {
      tag: "时政 · 油气行业",
      stem: "以油气当量计算，我国产量最大的油气田是：",
      options: ["大庆油田", "长庆油田", "塔里木油田", "西南油气田"],
      answer: "B",
      explain: "长庆油田油气当量产量居全国首位；大庆油田以原油产量计仍属主力，但油气当量已被长庆超过。"
    },
    {
      tag: "时政 · 油气行业",
      stem: "大庆油田被发现并投入开发的年份是：",
      options: ["1949 年", "1959 年", "1969 年", "1978 年"],
      answer: "B",
      explain: "1959 年 9 月松基三井喷出工业油流，大庆油田由此发现，恰逢新中国成立十周年，故名「大庆」。"
    },
    {
      tag: "时政 · 油气行业",
      stem: "西气东输一线工程的起点位于：",
      options: ["四川盆地", "鄂尔多斯盆地", "塔里木盆地", "准噶尔盆地"],
      answer: "C",
      explain: "西气东输一线西起新疆塔里木盆地轮南，东至上海，2004 年全线投产。"
    },
    {
      tag: "时政 · 能源政策",
      stem: "我国「十四五」规划的起止年份是：",
      options: ["2019—2023 年", "2020—2024 年", "2021—2025 年", "2022—2026 年"],
      answer: "C",
      explain: "「十四五」指第十四个五年规划，起止为 2021 年至 2025 年。"
    },
    {
      tag: "时政 · 油气行业",
      stem: "我国油气增储上产「七年行动计划」启动于：",
      options: ["2016 年", "2017 年", "2019 年", "2021 年"],
      answer: "C",
      explain: "2019 年国家启动油气增储上产七年行动计划（2019—2025 年），推动国内原油产量止跌回升。"
    },
    {
      tag: "时政 · 能源政策",
      stem: "「碳中和」的准确含义是：",
      options: ["完全不排放二氧化碳", "二氧化碳排放量达到历史最高值", "排放的二氧化碳与吸收的二氧化碳相互抵消，实现净零排放", "只允许新能源企业排放二氧化碳"],
      answer: "C",
      explain: "碳中和指一定时期内排放与吸收（含碳汇、CCUS 等）相抵消，达到相对「零排放」，并非绝对不排放。"
    },
    {
      tag: "时政 · 能源政策",
      stem: "「碳达峰」指的是：",
      options: ["二氧化碳排放量由增转降的历史拐点", "二氧化碳排放量降为零", "煤炭消费量降到零", "新能源装机超过火电"],
      answer: "A",
      explain: "碳达峰是排放量达到峰值后开始下降的拐点；碳中和才是净零排放，两者是先后关系。"
    },

    /* --- 企业文化 · 石油精神（12 题） --- */
    {
      tag: "企业文化 · 石油精神",
      stem: "「大庆精神、铁人精神」是中国石油的企业精神。其中大庆精神的核心内涵通常概括为：",
      options: ["爱国、创业、求实、奉献", "艰苦奋斗、自力更生", "以人为本、追求卓越", "诚信、创新、业绩、和谐"],
      answer: "A",
      explain: "大庆精神概括为「爱国、创业、求实、奉献」。D 项属于企业的经营管理理念，容易混淆。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "「宁可少活二十年，拼命也要拿下大油田」这句话出自：",
      options: ["王进喜", "焦裕禄", "雷锋", "钱学森"],
      answer: "A",
      explain: "这是铁人王进喜的名言，集中体现了他「有条件要上，没有条件创造条件也要上」的铁人精神。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "大庆「三老四严」中的「三老」指的是：",
      options: ["当老实人、说老实话、办老实事", "老实做人、老实做事、老实说话", "老经验、老办法、老传统", "老同志、老队伍、老作风"],
      answer: "A",
      explain: "「三老」即当老实人、说老实话、办老实事，是大庆会战时期形成的作风要求。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "「三老四严」中的「四严」指的是：",
      options: ["严格的要求、严密的组织、严肃的态度、严明的纪律", "严格的标准、严谨的作风、严肃的纪律、严密的流程", "严管、严查、严罚、严改", "严于律己、严以用权、严以修身、严以治企"],
      answer: "A",
      explain: "「四严」为严格的要求、严密的组织、严肃的态度、严明的纪律，与「三老」合称「三老四严」。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "大庆会战时期形成的「四个一样」不包括：",
      options: ["黑夜和白天一个样", "坏天气和好天气一个样", "领导不在现场和领导在现场一个样", "产量高和产量低一个样"],
      answer: "D",
      explain: "「四个一样」的第四项是「没有人检查和有人检查一个样」，不是产量高低一个样。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "大庆石油会战被称为「两论起家」，「两论」指的是：",
      options: ["《矛盾论》《实践论》", "《资本论》《国富论》", "《论持久战》《新民主主义论》", "《方法论》《认识论》"],
      answer: "A",
      explain: "会战队伍以毛泽东《实践论》《矛盾论》为思想武器，「两论起家」由此而来。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "我国工业企业的岗位责任制最早是在哪里系统建立起来的？",
      options: ["鞍钢", "大庆油田", "长春一汽", "克拉玛依油田"],
      answer: "B",
      explain: "1962 年大庆油田在总结基层管理经验的基础上，率先系统建立了岗位责任制。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "石油企业常讲的「三基」工作是指：",
      options: ["基层建设、基础工作、基本素质", "基础、基层、基本功", "基层、基础、基地", "基本制度、基本队伍、基本保障"],
      answer: "A",
      explain: "「三基」指基层建设、基础工作、基本素质，是石油行业基层管理的传统抓手。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "2016 年提出的「石油精神」，通常概括为：",
      options: ["苦干实干、三老四严", "爱国、进步、民主、科学", "自力更生、艰苦奋斗", "精益求精、追求卓越"],
      answer: "A",
      explain: "石油精神的核心表述是「苦干实干」「三老四严」，是对大庆精神、铁人精神的继承与凝练。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "中国石化的企业精神是：",
      options: ["爱我中华、振兴石化", "大庆精神、铁人精神", "以人为本、追求卓越", "诚信、创新、业绩、和谐"],
      answer: "A",
      explain: "「爱我中华、振兴石化」是中国石化的企业精神；「大庆精神、铁人精神」是中国石油的企业精神。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "歌曲《我为祖国献石油》集中体现的核心精神是：",
      options: ["爱国主义精神", "精益求精的工匠精神", "改革创新的时代精神", "艰苦奋斗的创业精神"],
      answer: "A",
      explain: "「锦绣河山美如画，祖国建设跨骏马」——这首歌的核心是为国分忧、为国奉献的爱国主义情怀。"
    },
    {
      tag: "企业文化 · 石油精神",
      stem: "「三老四严」中「四严」的第一条是：",
      options: ["严格的要求", "严密的组织", "严肃的态度", "严明的纪律"],
      answer: "A",
      explain: "「四严」的标准顺序是：严格的要求、严密的组织、严肃的态度、严明的纪律。"
    }
  ];

  /* ---------------- 面试：岗位与提示词 ---------------- */

  /* 开场固定要自我介绍（系统提示词第一条原则），不再随机抽题 */
  const OPENING_QUESTION =
    "请先做一个 1—2 分钟的自我介绍：教育背景、与这个岗位相关的经历，以及你为什么选这个岗位。";

  const EMPTY_RESUME = "（候选人未提供简历文本，请围绕岗位通用要求提问）";

  /* 结束面试时追加的隐藏指令：走同一套 messages，不动 system 前缀 */
  const EVAL_INSTRUCTION = [
    "面试到此结束。请作为面试官，结合刚才候选人的所有回答，给出综合评价。",
    "评价必须包含四部分：",
    "1. 逻辑表达得分（1-100 分，先给分再给一句理由）；",
    "2. 岗位匹配度（重点看稳重与稳定性）；",
    "3. 专业知识表现；",
    "4. 具体的改进建议。",
    "这次不受 120 字限制，四点写清楚、分条写；next_question 返回空字符串。"
  ].join("\n");

  /* 模型没给出下一个问题时的兜底，避免对话断在这里 */
  const FALLBACK_FOLLOWUPS = [
    "能结合你在实习或课程设计里的具体例子再说一遍吗？",
    "如果现场条件不允许你按原计划处理，你会怎么调整？",
    "这件事最后的结果如何，你从中总结出了什么？"
  ];

  /* 系统提示词：一场面试只生成一次，之后每轮原样复用，缓存前缀才稳定 */
  function buildInterviewSystemPrompt(role, resume) {
    return [
      "你现在是【" + role + "】的资深面试官，正在对候选人进行半结构化面试。这是候选人的简历：【" + resume + "】。",
      "面试必须遵循以下三个核心原则：",
      "第一，开场必须要求候选人进行【1-2分钟的自我介绍】，并针对自我介绍的细节进行追问。",
      "第二，极度关注【岗位稳定性】。必须旁敲侧击地问候选人：能否接受长期野外作业、海上倒班、艰苦环境？家人是否支持？是否有考公/考研的打算？（这是三桶油最看重的点）。",
      "第三，考察【岗位专业知识】。根据简历中的项目经历，结合岗位实际场景提1-2个专业问题（例如：海上油气泄漏的应急处理、设备防腐等）。",
      "每次只问一个问题，等候选人回答后，再追问或换下一个考察点。态度要专业、严肃。",
      "",
      "输出要求：只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释性文字。",
      'JSON 格式：{"comment":"对本次回答的点评，不超过 120 字","next_question":"下一个问题，只问一个，不超过 40 字"}',
      "如果用户消息标注了「最后一轮」，next_question 返回空字符串。"
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
    btnWritten: document.getElementById("btnWritten"),
    btnInterview: document.getElementById("btnInterview"),

    /* 面试设置面板 */
    setupModal: document.getElementById("setupModal"),
    roleSelect: document.getElementById("roleSelect"),
    resumeInput: document.getElementById("resumeInput"),
    setupStart: document.getElementById("setupStart"),
    setupCancel: document.getElementById("setupCancel"),
    setupClose: document.getElementById("setupClose"),
    items: {
      written: document.querySelector('[data-task="written"]'),
      interview: document.querySelector('[data-task="interview"]')
    },

    /* 笔试面板 */
    quizModal: document.getElementById("quizModal"),
    quizBody: document.getElementById("quizBody"),
    quizLoading: document.getElementById("quizLoading"),
    quizLoadingText: document.getElementById("quizLoadingText"),
    quizLoadingSub: document.getElementById("quizLoadingSub"),
    quizContent: document.getElementById("quizContent"),
    quizNotice: document.getElementById("quizNotice"),
    quizList: document.getElementById("quizList"),
    quizProgress: document.getElementById("quizProgress"),
    quizResult: document.getElementById("quizResult"),
    quizScore: document.getElementById("quizScore"),
    quizScoreNote: document.getElementById("quizScoreNote"),
    quizSubmit: document.getElementById("quizSubmit"),
    quizCancel: document.getElementById("quizCancel"),
    quizClose: document.getElementById("quizClose"),

    /* 面试面板 */
    modal: document.getElementById("interviewModal"),
    interviewBody: document.getElementById("interviewBody"),
    interviewProgress: document.getElementById("interviewProgress"),
    chatLog: document.getElementById("chatLog"),
    answerBlock: document.getElementById("answerBlock"),
    answer: document.getElementById("answerInput"),
    answerCount: document.getElementById("answerCount"),
    voiceBtn: document.getElementById("voiceBtn"),
    voiceLabel: document.getElementById("voiceLabel"),
    voiceHint: document.getElementById("voiceHint"),
    feedback: document.getElementById("feedbackBox"),
    feedbackTitle: document.getElementById("feedbackTitle"),
    feedbackText: document.getElementById("feedbackText"),
    submit: document.getElementById("submitAnswer"),
    endBtn: document.getElementById("interviewEnd"),
    closeBtn: document.getElementById("modalClose")
  };

  const state = {
    date: todayKey(),
    goal: DEFAULT_GOAL,
    minutes: 0,
    done: { written: false, interview: false }
  };

  /* 笔试状态 */
  let quizData = [];
  let quizPhase = "idle"; /* idle | loading | answering | graded | error */
  let quizController = null;
  let quizSubmitted = false;
  let quizConfirmPending = false;

  /* 真实计时：弹窗打开的那一刻记下，交卷 / 结束面试时结算 */
  let quizStartAt = 0;
  let interviewStartAt = 0;

  /* 面试状态 */
  let currentQuestion = "";
  let interviewRound = 0; /* 已完成的轮次 */
  let interviewRecorded = false;
  /* 标准 OpenAI 对话历史，逐轮追加，永不改写、不重排 */
  let interviewMessages = [];
  let submitting = false;
  let finished = false;
  let cooldownTimer = null;

  /* 语音输入：浏览器自带识别，纯前端，不发音频 */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let voiceRecognition = null;
  let voiceBaseText = "";
  let listening = false;

  /* 综合评价 */
  let evaluating = false;
  let evaluated = false;

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

    /* 目标跨天保留，当天归零的只是分钟数和勾选 */
    if (Number.isFinite(saved.goal)) {
      state.goal = Math.max(0, Math.min(MAX_GOAL, saved.goal));
    }

    if (saved.date !== state.date) return;

    if (Number.isFinite(saved.minutes)) {
      state.minutes = Math.max(0, saved.minutes);
    }
    if (saved.done) {
      state.done.written = saved.done.written === true;
      state.done.interview = saved.done.interview === true;
    }
  }

  function saveState() {
    state.date = todayKey();
    writeStore({
      date: state.date,
      goal: state.goal,
      minutes: state.minutes,
      done: state.done
    });
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
    let doneCount = 0;

    ["written", "interview"].forEach(function (kind) {
      const item = el.items[kind];
      const done = state.done[kind];

      if (done) doneCount += 1;
      item.classList.toggle("is-done", done);
      item.querySelector(".task-status").textContent = done ? "已完成" : "未完成";
    });

    el.count.textContent = doneCount + " / 2 已完成";
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

  /* 交卷时结算，返回本次计入的分钟数 */
  function recordWritten() {
    const minutes = elapsedMinutes(quizStartAt);

    state.minutes += minutes;
    state.done.written = true;
    saveState();
    renderAll();

    return minutes;
  }

  /* 结束面试时结算；重复调用不重复记，返回 null */
  function recordInterview() {
    if (interviewRecorded) return null;
    interviewRecorded = true;

    const minutes = elapsedMinutes(interviewStartAt);

    state.minutes += minutes;
    state.done.interview = true;
    saveState();
    renderAll();

    return minutes;
  }

  /* ---------------- 笔试面板 ---------------- */

  function toOptions(raw) {
    return (raw || []).map(function (opt, index) {
      if (typeof opt === "string") {
        return { key: "ABCD"[index], text: opt };
      }
      return {
        key: String((opt && opt.key) || "ABCD"[index]).toUpperCase(),
        text: String((opt && opt.text) || "")
      };
    });
  }

  function pickLocalQuiz(count) {
    const pool = LOCAL_QUIZ.slice();

    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    return pool.slice(0, count).map(function (item, index) {
      return {
        id: "q" + (index + 1),
        tag: item.tag,
        stem: item.stem,
        options: toOptions(item.options),
        answer: item.answer,
        explain: item.explain
      };
    });
  }

  function quizItemHtml(item, index) {
    const options = item.options
      .map(function (opt) {
        return (
          '<label class="quiz-option" data-key="' + opt.key + '">' +
          '<input type="radio" name="' + item.id + '" value="' + opt.key + '" />' +
          '<span class="opt-key">' + opt.key + "</span>" +
          '<span class="opt-text">' + opt.text + "</span>" +
          "</label>"
        );
      })
      .join("");

    return (
      '<div class="quiz-item">' +
      '<div class="quiz-head">' +
      '<span class="quiz-no">' + (index + 1) + "</span>" +
      '<span class="quiz-tag">' + item.tag + "</span>" +
      "</div>" +
      '<p class="quiz-stem">' + item.stem + "</p>" +
      '<div class="quiz-options">' + options + "</div>" +
      '<p class="quiz-explain" hidden><b>解析 </b>' + item.explain + "</p>" +
      "</div>"
    );
  }

  /* 出题中 / 出题失败：只显示中间状态，隐藏题面 */
  function setQuizPhase(phase, title, sub) {
    quizPhase = phase;

    if (phase === "loading" || phase === "error") {
      el.quizLoading.hidden = false;
      el.quizContent.hidden = true;
      el.quizLoading.classList.toggle("is-error", phase === "error");
      el.quizLoadingText.textContent = title || "";
      el.quizLoadingSub.textContent = sub || "";
      el.quizSubmit.textContent = phase === "error" ? "重新出题" : "交卷";
      el.quizSubmit.disabled = phase === "loading";
      return;
    }

    el.quizLoading.hidden = true;
    el.quizContent.hidden = false;
    el.quizSubmit.disabled = false;
    el.quizSubmit.textContent = phase === "graded" ? "关闭" : "交卷";
  }

  function collectAnswers() {
    return quizData.map(function (item) {
      const checked = el.quizList.querySelector('input[name="' + item.id + '"]:checked');
      return checked ? checked.value : "";
    });
  }

  function updateQuizProgress() {
    const answered = collectAnswers().filter(function (v) {
      return v !== "";
    }).length;

    el.quizProgress.textContent = "已答 " + answered + " / " + quizData.length;
  }

  function renderQuiz() {
    el.quizList.innerHTML = quizData.map(quizItemHtml).join("");
    el.quizResult.hidden = true;
    el.quizProgress.className = "quiz-progress";
    el.quizBody.scrollTop = 0;
    updateQuizProgress();
  }

  function openQuiz() {
    quizSubmitted = false;
    quizConfirmPending = false;
    quizData = [];
    quizStartAt = Date.now();

    el.quizList.innerHTML = "";
    el.quizResult.hidden = true;
    el.quizProgress.className = "quiz-progress";
    el.quizNotice.hidden = true;

    el.quizModal.showModal();
    el.quizBody.scrollTop = 0;

    generateQuiz();
  }

  /* 本地题库兜底：AI 出题失败时直接用，不打断答题 */
  function fallbackToLocalQuiz(reason) {
    quizData = pickLocalQuiz(5);
    renderQuiz();
    setQuizPhase("answering");

    el.quizNotice.hidden = false;
    el.quizNotice.textContent = "AI 出题失败（" + reason + "），已切换到本地题库。";
  }

  async function generateQuiz() {
    if (quizController) quizController.abort();
    quizController = new AbortController();

    setQuizPhase(
      "loading",
      "正在为你出题，请稍候…",
      "AI 正在从行测和企业文化里挑题，通常需要 10—20 秒"
    );

    try {
      const res = await fetch(QUIZ_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 5 }),
        signal: quizController.signal
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }

      if (!res.ok) {
        throw new Error(data.error || "接口返回 " + res.status);
      }

      const list = Array.isArray(data.questions) ? data.questions : [];
      if (list.length < 5) {
        throw new Error("AI 返回的题目数量不足");
      }

      quizData = list.slice(0, 5).map(function (item, index) {
        return {
          id: "q" + (index + 1),
          tag: item.tag,
          stem: item.stem,
          options: toOptions(item.options),
          answer: item.answer,
          explain: item.explain
        };
      });

      el.quizNotice.hidden = true;
      renderQuiz();
      setQuizPhase("answering");
    } catch (err) {
      /* 关窗时中止请求，什么都不做 */
      if (err && err.name === "AbortError") return;

      fallbackToLocalQuiz(friendlyShortError(err));
    }
  }

  function friendlyShortError(err) {
    const message = String((err && err.message) || err);

    if (message.indexOf("Failed to fetch") !== -1 || message.indexOf("Load failed") !== -1) {
      return "连不上本地代理";
    }
    return message;
  }

  function gradeQuiz(answers) {
    let correctCount = 0;

    quizData.forEach(function (item, index) {
      const block = el.quizList.children[index];
      const picked = answers[index];

      if (picked === item.answer) correctCount += 1;
      block.classList.add("is-graded");

      block.querySelectorAll(".quiz-option").forEach(function (label) {
        const key = label.getAttribute("data-key");
        label.querySelector("input").disabled = true;

        if (key === item.answer) label.classList.add("is-correct");
        if (key === picked && picked !== item.answer) label.classList.add("is-wrong");
      });

      block.querySelector(".quiz-explain").hidden = false;
    });

    el.quizScore.textContent = Math.round(correctCount * (100 / quizData.length)) + " 分";
    el.quizScoreNote.textContent =
      correctCount + " / " + quizData.length + " 题正确" +
      (correctCount === quizData.length ? " · 全对" : "");
    el.quizResult.hidden = false;
    el.quizBody.scrollTop = 0;

    el.quizProgress.className = "quiz-progress";
    el.quizProgress.textContent = "批改完成，可以逐题看解析";

    quizSubmitted = true;
    setQuizPhase("graded");

    /* 交卷即结算，与「关闭弹窗」解耦 */
    const minutes = recordWritten();
    el.quizScoreNote.textContent += " · 本次计入 " + minutes + " 分钟";
  }

  function submitQuiz() {
    if (quizPhase === "loading") return;

    if (quizPhase === "error") {
      generateQuiz();
      return;
    }

    /* 已交卷时按钮变成「关闭」 */
    if (quizSubmitted) {
      el.quizModal.close();
      return;
    }

    const answers = collectAnswers();
    const blanks = answers.filter(function (v) {
      return v === "";
    }).length;

    /* 有漏题先提醒一次，再点才真的交 */
    if (blanks > 0 && !quizConfirmPending) {
      quizConfirmPending = true;
      el.quizProgress.className = "quiz-progress is-warn";
      el.quizProgress.textContent = "还有 " + blanks + " 题没答，再点一次「交卷」直接提交";
      return;
    }

    gradeQuiz(answers);
  }

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
    if (!comment) return null;

    return {
      comment: comment,
      nextQuestion: String((data && (data.next_question || data.nextQuestion)) || "").trim()
    };
  }

  function scrollChatToEnd() {
    el.interviewBody.scrollTop = el.interviewBody.scrollHeight;
  }

  function appendChat(kind, text) {
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

  function openSetup() {
    el.setupModal.showModal();
  }

  function startInterview() {
    const role = el.roleSelect.value;
    const resume = el.resumeInput.value.trim() || EMPTY_RESUME;

    /* 计时从真正进入面试开始；填简历的时间不计入 */
    interviewStartAt = Date.now();
    interviewRound = 0;
    interviewRecorded = false;
    submitting = false;
    finished = false;
    currentQuestion = OPENING_QUESTION;

    /* 系统提示词只在这里生成一次，后续每轮原样复用 → 前缀稳定，缓存能命中 */
    interviewMessages = [
      { role: "system", content: buildInterviewSystemPrompt(role, resume) }
    ];

    el.setupModal.close();

    evaluated = false;
    evaluating = false;

    el.chatLog.innerHTML = "";
    el.answer.value = "";
    el.answerCount.textContent = "0 字";
    hideFeedback();
    el.answerBlock.hidden = false;
    el.submit.disabled = false;
    el.submit.textContent = "提交回答";
    el.endBtn.disabled = false;
    el.endBtn.textContent = "结束并评价";
    setInterviewRoundText("第 1 / " + INTERVIEW_ROUNDS + " 轮");

    el.modal.showModal();
    appendChat("interviewer", currentQuestion);
    el.answer.focus();
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
      return "连不上本地代理。请先在命令行运行 node proxy.js，看到启动提示后再回来。";
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

  async function submitAnswer() {
    if (submitting || finished) return;

    const answer = el.answer.value.trim();
    if (!answer) {
      showFeedback("先把回答写下来再提交，写几个要点也算。", true);
      el.answer.focus();
      return;
    }

    submitting = true;
    el.submit.disabled = true;
    el.submit.textContent = "面试官思考中…";
    hideFeedback();
    appendChat("candidate", answer);

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
      appendComment(parsed.comment);
      interviewRound += 1;

      if (interviewRound >= INTERVIEW_ROUNDS) {
        finishInterviewSession();
      } else {
        const next = parsed.nextQuestion ||
          FALLBACK_FOLLOWUPS[(interviewRound - 1) % FALLBACK_FOLLOWUPS.length];

        currentQuestion = next;
        appendChat("interviewer", next);
        setInterviewRoundText("第 " + (interviewRound + 1) + " / " + INTERVIEW_ROUNDS + " 轮");
        el.submit.disabled = false;
        el.submit.textContent = "提交回答";
        el.answer.focus();
      }
    } catch (err) {
      if (isBusyError(err)) {
        showFeedback(
          "当前请求较多，冷却 " + INTERVIEW_RETRY_SECONDS + " 秒后可重新提交，回答内容不会丢。",
          true,
          "面试官正在看简历"
        );
        el.answer.value = answer;
        el.answerCount.textContent = answer.length + " 字";
        startCooldown(INTERVIEW_RETRY_SECONDS);
      } else {
        showFeedback(friendlyError(err), true);
        el.answer.value = answer;
        el.answerCount.textContent = answer.length + " 字";
        el.submit.disabled = false;
        el.submit.textContent = "重新提交";
      }
    } finally {
      submitting = false;
    }
  }

  /* ---------------- 语音输入（浏览器自带识别，不发音频给后端） ---------------- */

  function initVoice() {
    if (!SpeechRecognition) {
      el.voiceBtn.disabled = true;
      el.voiceHint.textContent = "当前浏览器不支持语音识别，请用 Chrome 或 Edge";
      return;
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = "zh-CN";
    /* continuous=false：说话停顿几秒后浏览器会自动结束 */
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onresult = function (event) {
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
    };

    voiceRecognition.onerror = function (event) {
      stopVoice();

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        el.voiceHint.textContent = "麦克风被拒绝，点地址栏左侧的锁图标允许后重试";
      } else if (event.error === "no-speech") {
        el.voiceHint.textContent = "没听到声音，再点一次麦克风";
      } else if (event.error === "network") {
        el.voiceHint.textContent = "语音服务连不上，国内建议改用 Edge";
      } else if (event.error !== "aborted") {
        el.voiceHint.textContent = "识别中断：" + event.error;
      }
    };

    voiceRecognition.onend = function () {
      stopVoice();
    };

    el.voiceHint.textContent = "点一下开始说，停顿几秒自动结束";
  }

  function startVoice() {
    if (!voiceRecognition || listening) return;

    listening = true;
    voiceBaseText = el.answer.value;

    el.voiceBtn.classList.add("is-listening");
    el.voiceBtn.setAttribute("aria-pressed", "true");
    el.voiceLabel.textContent = "正在听…点击结束";
    el.voiceHint.textContent = "说话停顿几秒会自动结束";

    try {
      voiceRecognition.start();
    } catch (err) {
      stopVoice();
    }
  }

  function stopVoice() {
    listening = false;

    el.voiceBtn.classList.remove("is-listening");
    el.voiceBtn.setAttribute("aria-pressed", "false");
    el.voiceLabel.textContent = "语音输入";
  }

  function toggleVoice() {
    if (!SpeechRecognition) return;

    if (listening) {
      voiceRecognition.stop();
      return;
    }
    startVoice();
  }

  /* ---------------- 结束面试并评价 ---------------- */

  function appendEvaluation(text) {
    const box = document.createElement("div");
    box.className = "chat-eval";

    const title = document.createElement("p");
    title.className = "chat-eval-title";
    title.textContent = "面试综合评价";

    const body = document.createElement("p");
    body.className = "chat-eval-text";
    body.textContent = text;

    box.appendChild(title);
    box.appendChild(body);
    el.chatLog.appendChild(box);
    scrollChatToEnd();
  }

  async function runEvaluation() {
    evaluating = true;
    el.answerBlock.hidden = true;
    el.submit.disabled = true;
    el.endBtn.disabled = true;
    el.endBtn.textContent = "评价生成中…";

    /* 先结算时长：整理评价本身不计入学习时间 */
    recordInterview();
    showFeedback("面试官正在整理综合评价，大约十几秒…", false);

    const instruction = { role: "user", content: EVAL_INSTRUCTION };
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

      const content = String(data.content || "").trim();
      if (!content) throw new Error("模型没有返回内容，请再试一次");

      const parsed = parseInterviewContent(content);
      if (!parsed) throw new Error("评价格式不规范，请重试一次");

      interviewMessages.push(instruction, { role: "assistant", content: content });

      hideFeedback();
      appendEvaluation(parsed.comment);

      evaluated = true;
      el.endBtn.disabled = false;
      el.endBtn.textContent = "关闭";
    } catch (err) {
      showFeedback(friendlyError(err), true);
      el.endBtn.disabled = false;
      el.endBtn.textContent = "重试评价";
    } finally {
      evaluating = false;
    }
  }

  function handleEnd() {
    if (evaluating) return;

    if (evaluated) {
      el.modal.close();
      return;
    }

    /* 一句没答就点结束：直接关，不评价也不计时 */
    if (interviewRound === 0 && !finished) {
      el.modal.close();
      return;
    }

    runEvaluation();
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

      saveState();
      renderTime();
    });

    el.btnWritten.addEventListener("click", openQuiz);
    el.btnInterview.addEventListener("click", openSetup);

    /* 面试设置面板 */
    el.setupStart.addEventListener("click", startInterview);

    el.setupCancel.addEventListener("click", function () {
      el.setupModal.close();
    });

    el.setupClose.addEventListener("click", function () {
      el.setupModal.close();
    });

    /* 笔试 */
    el.quizSubmit.addEventListener("click", submitQuiz);

    el.quizCancel.addEventListener("click", function () {
      el.quizModal.close();
    });

    el.quizClose.addEventListener("click", function () {
      el.quizModal.close();
    });

    el.quizList.addEventListener("change", function () {
      quizConfirmPending = false;
      el.quizProgress.className = "quiz-progress";
      updateQuizProgress();
    });

    el.quizModal.addEventListener("click", function (event) {
      if (event.target === el.quizModal) el.quizModal.close();
    });

    /* 关窗：中止还在路上的出题请求；这里不计时（计时已在交卷时发生） */
    el.quizModal.addEventListener("close", function () {
      if (quizController) {
        quizController.abort();
        quizController = null;
      }
      quizSubmitted = false;
      quizPhase = "idle";
      quizConfirmPending = false;
    });

    /* 面试 */
    el.submit.addEventListener("click", submitAnswer);
    el.endBtn.addEventListener("click", handleEnd);
    el.voiceBtn.addEventListener("click", toggleVoice);

    el.closeBtn.addEventListener("click", function () {
      el.modal.close();
    });

    el.answer.addEventListener("input", function () {
      el.answerCount.textContent = el.answer.value.length + " 字";
    });

    el.modal.addEventListener("click", function (event) {
      if (event.target === el.modal) el.modal.close();
    });

    /* 关窗不计时：只有「结束面试」和满 3 轮才计时 */
    el.modal.addEventListener("close", function () {
      submitting = false;
      finished = false;
      interviewRound = 0;
      evaluating = false;
      evaluated = false;

      if (listening && voiceRecognition) {
        voiceRecognition.stop();
      }
      if (cooldownTimer) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    });
  }

  /* ---------------- 启动 ---------------- */

  loadState();
  el.goalInput.value = state.goal > 0 ? String(state.goal) : "";
  renderDate();
  renderAll();
  initVoice();
  bindEvents();
})();

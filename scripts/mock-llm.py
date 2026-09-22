"""Mock OpenAI-compatible chat completions endpoint（内容感知版）。

用于在无真实 API Key 的情况下演示「人物专属主题生成」完整流程。
监听 127.0.0.1:8787，在 .env.local 中配置（休眠回退路径，仅本地调试）：
  VITE_LLM_BASE_URL=http://127.0.0.1:8787/v1
  VITE_LLM_MODEL=mock-persona
  VITE_LLM_API_KEY=sk-mock（任意非空）

判别逻辑（基于请求 messages 的内容）：
- Call 1「解析与审核」：system prompt 含「内容审核助手」。
  从 user 消息中提取人物名（剥离"我喜欢"等引导词），然后：
    · 名字含「周杰伦」「蔡徐坤」等娱乐明星 → allow=false（娱乐圈明星暂不支持）
    · 名字在已知非人物词表（海边/星空/骑行 等）或无法识别为人物
      → isPerson=false, category=not_person
    · 其余（如 苏轼、李白、达芬奇）→ allow=true，category=historical
- Call 2「主题设计」：system prompt 含「主题设计师」。
  解析用户消息中编号语录的数量，quoteIds 取前 6 条，
  主题视觉按人物名做简单哈希配色，返回合法主题 JSON。
- 旧版「海滨假日」行为：若 user 消息含「海边」且不是审核调用，返回原主题 JSON。
"""

import hashlib
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

CELEBRITIES = ["周杰伦", "蔡徐坤", "杨幂", "肖战", "王一博"]
NON_PERSONS = ["海边", "星空", "骑行", "宇宙", "星辰", "银河", "星"]

# 常见人物姓氏/名单（用于把"苏轼"这类名字识别为人物；不在名单也未必拒绝——
# 只要不是明星/非人物词，默认按历史人物放行，便于演示各种人物）
KNOWN_PEOPLE_HINTS = "苏李杜白王张刘陈杨赵黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾梵居爱"

EMOJIS = ["📜", "🖋️", "🏔️", "🌊", "🎋", "🌙", "📚", "🎨"]


def extract_person(text: str) -> str:
    """从用户句子中剥离引导词，得到候选人物名。"""
    s = text.strip()
    for p in ["我最近迷上了", "我最近迷上", "最近迷上了", "最近迷上",
              "我特别喜欢", "我喜欢看", "我喜欢听", "我喜欢读",
              "我喜欢", "我热爱", "我爱", "我想", "喜欢", "热爱"]:
        if s.startswith(p):
            s = s[len(p):]
            break
    return re.sub(r"[，。！？!?,.\s、~～…·\"'「」『』]", "", s)


# 模拟真实大模型的「归一化为全名」行为（梵高 bug 的复现关键）：
# 用户输入简称，审核返回全名 + 最常用中文简称 shortName
FULL_NAMES = {"梵高": "文森特·梵高", "居里夫人": "玛丽·居里", "爱因斯坦": "阿尔伯特·爱因斯坦"}


def short_name_for(person: str, typed: str) -> str:
    """最常用中文简称：归一化变了则用用户原输入；含间隔号则取末段。"""
    if person != typed:
        return typed
    if "·" in person:
        return person.split("·")[-1]
    return person


def moderation_response(user_text: str) -> dict:
    name = extract_person(user_text)
    for celeb in CELEBRITIES:
        if celeb in name:
            return {
                "isPerson": True, "personName": celeb, "shortName": celeb,
                "category": "entertainment_celebrity",
                "allow": False, "reason": "娱乐圈明星暂不支持",
            }
    is_person = bool(name) and name not in NON_PERSONS and name[0] in KNOWN_PEOPLE_HINTS
    if not is_person:
        return {
            "isPerson": False, "personName": None, "shortName": None,
            "category": "not_person", "allow": False,
            "reason": "未检测到人物名",
        }
    person = FULL_NAMES.get(name, name)
    return {
        "isPerson": True, "personName": person,
        "shortName": short_name_for(person, name),
        "category": "historical", "allow": True, "reason": "",
    }


def design_response(user_text: str) -> dict:
    """根据用户消息中的人物名与编号语录生成主题 JSON。"""
    m = re.search(r"人物：([^\n]+)", user_text)
    person = m.group(1).strip() if m else "未知人物"
    # 编号语录的最大序号
    ids = [int(n) for n in re.findall(r"(?m)^(\d+)\.", user_text)]
    count = max(ids) if ids else 0
    pick = list(range(1, min(6, count) + 1))

    h = int(hashlib.md5(person.encode()).hexdigest(), 16)
    hue = h % 360
    hue2 = (hue + 45) % 360
    primary = hsl_hex(hue, 55, 40)
    return {
        "name": f"{person}·风雅",
        "keyword": person,
        "primaryColor": primary,
        "gradient": [hsl_hex(hue, 60, 62), hsl_hex(hue2, 65, 45)],
        "textOnBg": "light",
        "emoji": EMOJIS[h % len(EMOJIS)],
        "quoteIds": pick,
        "portraitPrompt": (
            f"Engraved etching style bust portrait of {person}, "
            f"circular medallion composition, {primary} monochrome tones, "
            "plain background, no text"
        ),
    }


def hsl_hex(h: int, s: int, l: int) -> str:
    """简易 HSL(度,%,%) → #RRGGBB。"""
    s_f, l_f = s / 100.0, l / 100.0
    c = (1 - abs(2 * l_f - 1)) * s_f
    x = c * (1 - abs((h / 60.0) % 2 - 1))
    m = l_f - c / 2
    h6 = h % 360
    if h6 < 60: r, g, b = c, x, 0
    elif h6 < 120: r, g, b = x, c, 0
    elif h6 < 180: r, g, b = 0, c, x
    elif h6 < 240: r, g, b = 0, x, c
    elif h6 < 300: r, g, b = x, 0, c
    else: r, g, b = c, 0, x
    return "#{:02x}{:02x}{:02x}".format(
        round((r + m) * 255), round((g + m) * 255), round((b + m) * 255))


# 宽松兜底（VITE_QUOTE_FALLBACK=llm）的「语录助手」调用应答：
# 凭知识给出真实语录（人物名从 user 消息「人物：X」解析）
QUOTES = {
    "梵高": [
        {"text": "我梦见了画，然后画下了梦。", "source": "梵高书信"},
        {"text": "正常状态好比一条铺好的路：走起来舒服，但长不出花来。", "source": "梵高书信"},
        {"text": "伟大的事情不是一时冲动做成的，而是由一系列小事积聚而成的。", "source": "梵高书信"},
        {"text": "如果你听到内心的声音说你不会画画，那么无论如何都要画下去，那个声音自然会沉默。", "source": "梵高书信"},
        {"text": "爱许多事物吧，因为那里有真正的力量。", "source": "梵高书信"},
        {"text": "我越来越相信，创造美好的代价是努力、失望以及毅力。", "source": "梵高书信"},
    ],
    "李清照": [
        {"text": "生当作人杰，死亦为鬼雄。", "source": "《夏日绝句》"},
        {"text": "寻寻觅觅，冷冷清清，凄凄惨惨戚戚。", "source": "《声声慢》"},
        {"text": "知否，知否？应是绿肥红瘦。", "source": "《如梦令》"},
        {"text": "莫道不销魂，帘卷西风，人比黄花瘦。", "source": "《醉花阴》"},
        {"text": "物是人非事事休，欲语泪先流。", "source": "《武陵春》"},
        {"text": "花自飘零水自流。一种相思，两处闲愁。", "source": "《一剪梅》"},
    ],
}
# 其他人物默认给苏轼语录
DEFAULT_QUOTES = [
    {"text": "古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。", "source": "《晁错论》"},
    {"text": "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", "source": "《定风波》"},
    {"text": "回首向来萧瑟处，归去，也无风雨也无晴。", "source": "《定风波》"},
    {"text": "人生如梦，一尊还酹江月。", "source": "《念奴娇·赤壁怀古》"},
    {"text": "不识庐山真面目，只缘身在此山中。", "source": "《题西林壁》"},
    {"text": "但愿人长久，千里共婵娟。", "source": "《水调歌头》"},
]


def quotes_response(user_text: str) -> list:
    """语录助手调用：按人物返回真实语录列表（JSON 数组）。"""
    m = re.search(r"人物：([^\n]+)", user_text)
    person = m.group(1).strip() if m else ""
    for key, quotes in QUOTES.items():
        if key in person:
            return quotes
    return DEFAULT_QUOTES


# 旧版行为：非审核场景下包含「海边」时返回海滨假日主题
LEGACY_THEME_JSON = {
    "name": "海滨假日",
    "keyword": "海边",
    "primaryColor": "#0e7aa8",
    "gradient": ["#7ec8e3", "#c9ecf7", "#fdf6e3"],
    "textOnBg": "dark",
    "emoji": "🌊",
    "quotes": [
        {"text": "面朝大海，春暖花开。", "source": "海子《面朝大海，春暖花开》"},
        {"text": "海纳百川，有容乃大。", "source": "林则徐自勉联"},
        {"text": "长风破浪会有时，直挂云帆济沧海。", "source": "李白《行路难·其一》"},
    ],
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        with open("/tmp/mock-llm-request.json", "w") as f:
            json.dump(body, f, ensure_ascii=False, indent=2)

        messages = body.get("messages", [])
        system = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
        user = next((m.get("content", "") for m in messages if m.get("role") == "user"), "")

        if "内容审核助手" in system:
            result = moderation_response(user)
        elif "语录助手" in system:
            result = quotes_response(user)
        elif "主题设计师" in system:
            result = design_response(user)
        elif "海边" in user:
            result = LEGACY_THEME_JSON
        else:
            result = moderation_response(user)

        resp = {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300},
        }
        payload = json.dumps(resp, ensure_ascii=False).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print("mock-llm listening on http://127.0.0.1:8787/v1/chat/completions")
    HTTPServer(("127.0.0.1", 8787), Handler).serve_forever()

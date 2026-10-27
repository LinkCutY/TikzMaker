export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  /** Suggested model ids; the real list is fetched from GET /models when possible. */
  models: string[];
  keyUrl?: string;
  note: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    // Suggestions only — the authoritative list comes from GET /models on your account.
    // The field is free-text, so any id your account exposes can be typed here.
    models: ["deepseek-flash", "deepseek-v4-pro"],
    keyUrl: "https://platform.deepseek.com/api_keys",
    note: "deepseek-flash 支持图片输入；deepseek-v4-pro 仅文本。模型名区分大小写",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
    keyUrl: "https://platform.openai.com/api-keys",
    note: "gpt-4o / 4.1 系列支持识图",
  },
  {
    id: "dashscope",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-max", "qwen-plus", "qwen-vl-max"],
    keyUrl: "https://bailian.console.aliyun.com/",
    note: "国内可直连，qwen-vl 系列支持识图",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-air", "glm-4v-plus"],
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "glm-4v 系列支持识图",
  },
  {
    id: "moonshot",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
    note: "长上下文",
  },
  {
    id: "ollama",
    name: "本地 Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5-coder:14b", "llama3.1:8b"],
    note: "本地推理，不用 key（随便填一个即可）",
  },
  {
    id: "custom",
    name: "自定义",
    baseUrl: "",
    models: [],
    note: "任何 OpenAI 兼容网关：填 Base URL 与模型名",
  },
];

export function providerById(id: string | undefined): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function detectProvider(baseUrl: string, model?: string): string {
  const url = (baseUrl || "").trim().toLowerCase();
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("openai.com")) return "openai";
  if (url.includes("dashscope") || url.includes("aliyuncs")) return "dashscope";
  if (url.includes("bigmodel")) return "zhipu";
  if (url.includes("moonshot")) return "moonshot";
  if (url.includes("localhost") || url.includes("127.0.0.1")) return "ollama";
  if (model) {
    if (model.startsWith("deepseek")) return "deepseek";
    if (model.startsWith("gpt")) return "openai";
    if (model.startsWith("qwen")) return "dashscope";
    if (model.startsWith("glm")) return "zhipu";
    if (model.startsWith("moonshot")) return "moonshot";
  }
  return "custom";
}

export type Capability = "yes" | "no" | "unknown";

export interface ModelMeta {
  id: string;
  name?: string;
  inputModalities?: string[];
}

/**
 * Capability comes from the provider's own /models metadata when available.
 * Name heuristics are only a fallback — vendors add vision models faster than
 * anyone can hardcode a table, so we never *block* on a guess.
 */
const squash = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The UI shows display names ("DeepSeek-V4.1-Flash 1017") while the protocol
 * needs ids ("deepseek-flash"). Accept either from the user and send the id.
 */
export function resolveModelId(input: string, metas: ModelMeta[], known: string[]): string {
  const raw = (input || "").trim();
  if (!raw) return raw;
  const key = squash(raw);
  if (known.includes(raw)) return raw;

  const byId = known.find((k) => squash(k) === key);
  if (byId) return byId;

  const byMetaName = metas.find((m) => m.name && squash(m.name) === key);
  if (byMetaName) return byMetaName.id;

  // tolerate a trailing version badge: "DeepSeek-V4.1-Flash 1017"
  const withoutVersion = raw.replace(/\s+\d{3,4}$/, "");
  const key2 = squash(withoutVersion);
  if (key2 !== key) {
    const byId2 = known.find((k) => squash(k) === key2);
    if (byId2) return byId2;
    const byName2 = metas.find((m) => m.name && squash(m.name) === key2);
    if (byName2) return byName2.id;
  }
  return raw;
}

/** "DeepSeek-V4.1-Flash — deepseek-flash" when both are known. */
export function modelLabel(id: string, metas: ModelMeta[]): string {
  const name = metas.find((m) => m.id === id)?.name;
  if (!name || squash(name) === squash(id)) return id;
  return `${name} — ${id}`;
}

export function visionCapability(model: string, meta?: ModelMeta): Capability {
  if (meta?.inputModalities?.length) {
    return meta.inputModalities.includes("image") ? "yes" : "no";
  }
  const m = (model || "").toLowerCase();
  if (!m) return "unknown";
  if (/(vision|-vl|vl-|vl\d|4o|4\.1|omni|gemini|flash-vision|qwen-vl|glm-4v)/.test(m)) return "yes";
  if (/^(deepseek-(chat|reasoner|coder)|moonshot-|gpt-3\.5)/.test(m)) return "no";
  return "unknown";
}

import { useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, ExternalLink, Loader2, RefreshCw, Server, Settings as SettingsIcon, X } from "lucide-react";
import { useApp } from "../store";
import { api, type HealthResponse } from "../lib/api";
import { PROVIDERS, providerById, visionCapability, type ModelMeta } from "../lib/providers";

export function SettingsDrawer({ health }: { health: HealthResponse | null }) {
  const { drawer, openDrawer, settings, patchSettings, useProvider, toast } = useApp();
  const learned = useApp((s) => s.learnedModels);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [meta, setMeta] = useState<ModelMeta[]>([]);
  const [delayText, setDelayText] = useState<string | null>(null);
  if (drawer !== "settings") return null;

  const provider = providerById(settings.provider);
  const currentMeta = meta.find((m) => m.id === settings.apiModel);
  const vision = visionCapability(settings.apiModel, currentMeta);
  const modelOptions = Array.from(
    new Set([...provider.models, ...meta.map((m) => m.id), ...(learned[settings.provider] ?? [])])
  ).filter(Boolean);
  if (settings.apiModel && !modelOptions.includes(settings.apiModel)) modelOptions.push(settings.apiModel);

  async function test() {
    if (!settings.apiKey.trim()) {
      toast("error", "请先填写 API Key");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.aiCheck({ baseUrl: settings.apiBaseUrl }, settings.apiKey);
      setMeta(res.meta ?? []);
      setTestResult(`连接成功 · ${(res.models ?? []).length} 个模型可用`);
    } catch (err: any) {
      setTestResult(err?.message || "连接失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={() => openDrawer("none")} />
      <aside className="drawer">
        <div className="drawer-head">
          <SettingsIcon size={15} />
          <div className="drawer-title">设置</div>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => openDrawer("none")} title="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="drawer-body">
          <div className="section-label">模型服务</div>
          <div className="card">
            <div className="field">
              <label>服务商</label>
              <div className="provider-grid">
                {PROVIDERS.map((p) => (
                  <button key={p.id} className="provider-chip" data-active={settings.provider === p.id} title={p.note} onClick={() => useProvider(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="hint">
                {provider.note}
                {provider.keyUrl && (
                  <>
                    {" · "}
                    <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="link">
                      获取 API Key <ExternalLink size={10} style={{ verticalAlign: -1 }} />
                    </a>
                  </>
                )}
              </div>
            </div>

            <div className="field">
              <label>API Key</label>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={showKey ? "text" : "password"}
                  value={settings.apiKey}
                  placeholder={settings.provider === "ollama" ? "本地服务可随便填" : "sk-..."}
                  onChange={(e) => patchSettings({ apiKey: e.target.value })}
                  style={{ paddingRight: 34 }}
                />
                <button className="icon-btn" style={{ position: "absolute", right: 2, top: 2 }} onClick={() => setShowKey((v) => !v)} title={showKey ? "隐藏" : "显示"}>
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <div className="hint">只存在本机 localStorage，通过请求头 <code className="mono">x-ai-key</code> 发给本地后端。</div>
            </div>

            <div className="field">
              <label>模型</label>
              <div className="row" style={{ gap: 6 }}>
                {/* free text + suggestions: the account's /models is the truth, not this list */}
                <input
                  className="input mono"
                  list="settings-model-options"
                  value={settings.apiModel}
                  spellCheck={false}
                  onChange={(e) => patchSettings({ apiModel: e.target.value })}
                  placeholder="模型 id，可手打"
                  style={{ flex: 1 }}
                />
                <datalist id="settings-model-options">
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </datalist>
                <button className="icon-btn" title="从服务商拉取模型列表" onClick={() => void test()} disabled={testing} style={{ border: "1px solid var(--border)" }}>
                  {testing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                </button>
              </div>
              <div className="hint" style={{ color: vision === "yes" ? "var(--ok)" : vision === "no" ? "var(--warn)" : undefined }}>
                {vision === "yes"
                  ? currentMeta?.inputModalities
                    ? "✓ 支持图片输入（服务商 /models 已声明）"
                    : "✓ 按模型名判断支持图片输入"
                  : vision === "no"
                    ? "✗ 该模型只接受文本；识图请换一个多模态模型"
                    : "? 未能确认是否支持图片，识图时会实测"}
              </div>
            </div>

            <div className="field">
              <label>Base URL</label>
              <input
                className="input mono"
                value={settings.apiBaseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => patchSettings({ apiBaseUrl: e.target.value })}
              />
              {settings.apiBaseUrl ? (
                <div className="hint">后端拼接 <code className="mono">/chat/completions</code>，任何 OpenAI 兼容网关都行。</div>
              ) : (
                <div className="notice notice--warn" style={{ padding: "6px 9px", alignItems: "center" }}>
                  <AlertTriangle size={12} />
                  <span style={{ flex: 1, fontSize: 11.5 }}>地址为空，请求一定会失败</span>
                  {provider.baseUrl && (
                    <button className="btn" style={{ height: 24 }} onClick={() => patchSettings({ apiBaseUrl: provider.baseUrl })}>
                      填入默认
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="row">
              <button className="btn" onClick={() => void test()} disabled={testing}>
                {testing ? <Loader2 size={13} className="spin" /> : <Server size={13} />}
                测试连接
              </button>
              {testResult && (
                <span className="hint" style={{ color: testResult.startsWith("连接成功") ? "var(--ok)" : "var(--err)" }}>
                  {testResult.startsWith("连接成功") && <Check size={12} style={{ verticalAlign: -2, marginRight: 3 }} />}
                  {testResult}
                </span>
              )}
            </div>
          </div>

          <div className="section-label">编译</div>
          <div className="card">
            <div className="field">
              <label>LaTeX 引擎</label>
              <div className="seg">
                {(health?.engines ?? []).map((e) => (
                  <button key={e.name} data-active={settings.engine === e.name} disabled={!e.available} title={e.available ? e.version : "未安装"} onClick={() => patchSettings({ engine: e.name })}>
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="row row--between">
              <div>
                <div style={{ fontSize: 12.5 }}>自动编译</div>
                <div className="hint">停止输入后自动渲染</div>
              </div>
              <span className="switch" data-on={settings.autoCompile} onClick={() => patchSettings({ autoCompile: !settings.autoCompile })} />
            </div>
            <div className="field">
              <label>防抖延迟（毫秒）</label>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                value={delayText ?? String(settings.delay)}
                onFocus={() => setDelayText(String(settings.delay))}
                onChange={(e) => setDelayText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={() => {
                  const n = Number(delayText ?? settings.delay);
                  if (String(delayText ?? "").trim() !== "" && Number.isFinite(n)) {
                    patchSettings({ delay: Math.max(200, Math.min(5000, Math.round(n))) });
                  }
                  setDelayText(null);
                }}
              />
            </div>
          </div>

          <div className="section-label">预览</div>
          <div className="card">
            <div className="field">
              <label>背景</label>
              <div className="seg">
                {(["checker", "white", "dark"] as const).map((bg) => (
                  <button key={bg} data-active={settings.previewBg === bg} onClick={() => patchSettings({ previewBg: bg })}>
                    {bg === "checker" ? "棋盘" : bg === "white" ? "白色" : "深色"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="section-label">运行环境</div>
          <div className="card">
            <Row k="版本" v={health?.version ?? "—"} />
            <Row k="渲染器" v={health?.renderer ? health.renderer : "未检测到"} />
            <Row k="Python" v={health?.python ?? "—"} mono />
            {(health?.engines ?? []).map((e) => (
              <Row key={e.name} k={e.label} v={e.available ? "可用" : "未安装"} ok={e.available} />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

function Row({ k, v, mono, ok }: { k: string; v: string; mono?: boolean; ok?: boolean }) {
  return (
    <div className="row row--between" style={{ fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)" }}>{k}</span>
      <span className={mono ? "mono" : undefined} style={{ color: ok === false ? "var(--err)" : ok ? "var(--ok)" : "var(--text-faint)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {v}
      </span>
    </div>
  );
}

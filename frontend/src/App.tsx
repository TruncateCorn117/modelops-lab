import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Box,
  ChevronRight,
  CircleHelp,
  Database,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Network,
  PanelLeftClose,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { appPath, getToken, saveToken, useApi } from "./api";
import { GITHUB_URL, PublicDemoContext } from "./publicDemo";
import type { Health } from "./types";
import { Button, Modal, Notice, ToastProvider, useToast } from "./ui";
import Overview from "./pages/Overview";
import Models from "./pages/Models";
import Playground from "./pages/Playground";
import Evaluations from "./pages/Evaluations";
import Datasets from "./pages/Datasets";
import Requests from "./pages/Requests";

const navigation = [
  {
    id: "overview",
    label: "工作区总览",
    icon: LayoutDashboard,
    en: "Overview",
  },
  { id: "models", label: "模型中心", icon: Box, en: "Model registry" },
  {
    id: "playground",
    label: "工单体验台",
    icon: TerminalSquare,
    en: "Playground",
  },
  {
    id: "evaluations",
    label: "评测实验室",
    icon: FlaskConical,
    en: "Evaluations",
  },
  { id: "datasets", label: "数据集", icon: Database, en: "Datasets" },
  { id: "requests", label: "请求日志", icon: Activity, en: "Observability" },
] as const;
function getRoute() {
  const path = window.location.hash.slice(1).split("/")[0];
  return navigation.some((item) => item.id === path) ? path : "overview";
}
export function navigate(page: string) {
  window.location.hash = page;
}
function Workspace() {
  const [page, setPage] = useState(getRoute);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const health = useApi<Health>("/api/health", 30000);
  const publicDemo = health.data?.public_demo ?? false;
  useEffect(() => {
    const listener = () => {
      setPage(getRoute());
      setMobileMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const current = navigation.find((item) => item.id === page)!;
  return (
    <PublicDemoContext.Provider value={publicDemo}>
      <div className="app-shell">
        {mobileMenu && (
          <button
            className="sidebar-scrim"
            aria-label="收起菜单"
            onClick={() => setMobileMenu(false)}
          />
        )}
        <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
          <a className="brand" href="#overview" aria-label="ModelOps Lab 首页">
            <span className="brand-mark">
              <Box size={24} strokeWidth={1.8} />
            </span>
            <span>
              ModelOps<span className="brand-lab">Lab</span>
            </span>
          </a>
          <div className="workspace-label">
            <span className="workspace-icon">
              <Network size={17} />
            </span>
            <div>
              <strong>制造业模型工作台</strong>
              <small>Manufacturing workspace</small>
            </div>
          </div>
          <div className="nav-caption">WORKSPACE</div>
          <nav aria-label="主导航">
            {navigation.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`nav-item ${item.id === page ? "active" : ""}`}
                aria-current={item.id === page ? "page" : undefined}
              >
                <item.icon size={19} strokeWidth={1.7} />
                <span>{item.label}</span>
                {item.id === page && <span className="nav-active-dot" />}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <div className="sidebar-note-icon">
                <FlaskConical size={18} />
              </div>
              <strong>可复现，从每一次调用开始</strong>
              <p>
                记录模型、数据与提示词版本，
                <br />
                让模型选型有据可依。
              </p>
              <button onClick={() => setHelp(true)}>
                查看使用指南 <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="sidebar-footer">
              <span>
                <span className="tiny-dot" /> Open source edition
              </span>
              <span>v{health.data?.version || "0.2.0"}</span>
            </div>
          </div>
          <button
            className="mobile-sidebar-close icon-button"
            onClick={() => setMobileMenu(false)}
            aria-label="收起菜单"
          >
            <PanelLeftClose size={20} />
          </button>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                onClick={() => setMobileMenu(true)}
                aria-label="展开菜单"
              >
                <Menu size={20} />
              </button>
              <span>工作空间</span>
              <ChevronRight size={14} />
              <strong>{current.label}</strong>
            </div>
            <div className="topbar-actions">
              <span
                className={`connection-status ${health.error ? "offline" : ""}`}
              >
                <span className="status-dot" />
                {health.loading
                  ? "连接中"
                  : health.error
                    ? "服务未连接"
                    : "服务已连接"}
              </span>
              <span className="topbar-divider" />
              <button
                className="icon-button"
                aria-label="使用指南"
                title="使用指南"
                onClick={() => setHelp(true)}
              >
                <CircleHelp size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="连接设置"
                title="连接设置"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={18} />
              </button>
              <span
                className="workspace-avatar"
                title={publicDemo ? "公开演示工作区" : "本地工作区"}
              >
                ML
              </span>
            </div>
          </header>
          <main className="main-content">
            {publicDemo && (
              <div className="public-demo-banner">
                <ShieldCheck size={19} />
                <div>
                  <strong>公开演示 · 输入不保存</strong>
                  <span>
                    仅测试合成示例；请勿输入企业工单、个人信息或密钥。
                  </span>
                </div>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  GitHub · 完整版本 <ArrowUpRight size={14} />
                </a>
              </div>
            )}
            {health.data?.auth_required && !getToken() && (
              <div className="auth-banner">
                <ShieldCheck size={18} />
                <span>当前工作区已启用访问保护，请配置 API 密钥后继续。</span>
                <Button onClick={() => setSettings(true)}>连接设置</Button>
              </div>
            )}
            {page === "overview" && <Overview />}
            {page === "models" && <Models />}
            {page === "playground" && <Playground />}
            {page === "evaluations" && <Evaluations />}
            {page === "datasets" && <Datasets />}
            {page === "requests" && <Requests />}
            <footer className="content-footer">
              <span>
                ModelOps Lab <span> / </span> 制造业工单处理与模型评测
              </span>
              <span>独立开源项目 · 示例数据均为合成</span>
            </footer>
          </main>
        </div>
        {settings && (
          <Settings
            onClose={() => setSettings(false)}
            authRequired={health.data?.auth_required ?? false}
            publicDemo={publicDemo}
          />
        )}
        {help && (
          <Modal
            title="开始使用 ModelOps Lab"
            description="从一条工单开始，完成一次可复现的模型评测。"
            onClose={() => setHelp(false)}
          >
            <div className="modal-body">
              {publicDemo && (
                <Notice>
                  当前为公开演示，可使用合成示例体验规则模拟服务，并浏览预置评测。模型接入、数据导入和新建评测请在本地部署完整版本。
                  <a
                    className="text-link"
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看 GitHub 项目 <ArrowUpRight size={14} />
                  </a>
                </Notice>
              )}
              <div className="guide-steps">
                {[
                  {
                    title: publicDemo ? "查看模型服务" : "接入模型服务",
                    text: publicDemo
                      ? "查看预置规则模拟服务。公开演示不调用真实大模型；本地部署后可接入 Ollama 或 OpenAI 兼容服务。"
                      : "模型中心预置规则模拟服务，可直接体验。连接真实模型时，选择 Ollama 或 OpenAI 兼容服务，填写模型名称和服务地址。",
                    page: "models",
                  },
                  {
                    title: "运行一条工单",
                    text: publicDemo
                      ? "在工单体验台选择规则模型并运行合成示例，查看分类与字段提取结果。本次输入与结果不保存。"
                      : "在工单体验台选择模型、输入文本，查看分类与字段提取结果，以及本次调用的请求编号。",
                    page: "playground",
                  },
                  {
                    title: publicDemo ? "浏览对比评测" : "创建对比评测",
                    text: publicDemo
                      ? "查看已有评测的配置快照、数据指纹与逐条结果。演示规则结果不代表真实大模型能力。"
                      : "选择数据集、模型和测试集划分，平台会记录参数快照、数据指纹和指标。演示规则结果不代表真实大模型能力。",
                    page: "evaluations",
                  },
                  {
                    title: "查看问题与导出报告",
                    text: publicDemo
                      ? "对比预测与标准答案，下载 Markdown、JSON 或 CSV 报告。请求日志仅展示预置数据，不包含访客输入。"
                      : "在评测详情逐条对比标准答案；在请求日志中查看失败原因。报告可导出 Markdown、JSON 或 CSV。",
                    page: "requests",
                  },
                ].map((step, index) => (
                  <button
                    className="guide-step"
                    key={step.page}
                    onClick={() => {
                      navigate(step.page);
                      setHelp(false);
                    }}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.text}</p>
                    </div>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
              <Notice>
                首版覆盖工单字段提取与四类故障分类。健康检查反映服务可达性，不能证明回答正确；评测质量依赖测试数据的覆盖范围。
              </Notice>
            </div>
            <div className="modal-footer">
              <a
                className="button button-secondary"
                href={appPath("docs")}
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen size={15} />
                API 文档 <ArrowUpRight size={14} />
              </a>
              <Button variant="primary" onClick={() => setHelp(false)}>
                开始探索
              </Button>
            </div>
          </Modal>
        )}
      </div>
    </PublicDemoContext.Provider>
  );
}
function Settings({
  onClose,
  authRequired,
  publicDemo,
}: {
  onClose: () => void;
  authRequired: boolean;
  publicDemo: boolean;
}) {
  const [token, setToken] = useState(getToken);
  const notify = useToast();
  return (
    <Modal
      title="连接设置"
      description={
        publicDemo
          ? "当前为公开演示，可直接体验合成示例。"
          : "配置当前浏览器会话访问工作区所需的密钥。"
      }
      onClose={onClose}
    >
      {publicDemo ? (
        <>
          <div className="modal-body">
            <Notice>
              公开演示无需填写密钥。连接自己的模型、导入数据和创建评测，请本地部署完整版本。
            </Notice>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              查看 GitHub 与部署指南 <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="modal-footer">
            <a
              className="button button-secondary"
              href={appPath("docs")}
              target="_blank"
              rel="noreferrer"
            >
              API 文档 <ArrowUpRight size={14} />
            </a>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveToken(token);
            notify(
              token
                ? "连接密钥已保存，正在刷新工作区。"
                : "已清除当前会话的连接密钥。",
            );
            onClose();
          }}
        >
          <div className="modal-body">
            <div className="settings-status">
              <ShieldCheck size={20} />
              <div>
                <strong>
                  {authRequired
                    ? "后端已启用 API 鉴权"
                    : "后端当前未要求 API 密钥"}
                </strong>
                <p>密钥仅保存在当前标签页会话中，不写入项目配置。</p>
              </div>
            </div>
            <label className="form-field">
              <span>工作区 API 密钥</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="输入 MODEL_OPS_API_KEY 对应的值"
                autoComplete="off"
              />
            </label>
            <Notice>
              这是访问 ModelOps Lab
              的密钥。上游模型密钥应配置在后端环境变量中，再在模型配置里填写变量名称。
            </Notice>
          </div>
          <div className="modal-footer">
            <Button onClick={onClose} type="button" icon={<X size={15} />}>
              取消
            </Button>
            <Button type="submit" variant="primary">
              保存设置
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
export default function App() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

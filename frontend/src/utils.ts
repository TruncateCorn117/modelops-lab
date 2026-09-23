import type { Category, TicketOutput } from "./types";

export const categoryLabels: Record<Category, string> = {
  mechanical: "机械故障",
  electrical: "电气故障",
  software: "软件故障",
  other: "其他",
};
export const fieldLabels: Record<keyof TicketOutput, string> = {
  equipment_id: "设备编号",
  equipment: "设备名称",
  production_line: "产线",
  reported_at: "报告日期",
  fault_code: "故障代码",
  category: "工单分类",
  symptom: "故障现象",
  action_taken: "已采取措施",
  downtime_minutes: "停机时长（分钟）",
};
export const fields = Object.keys(fieldLabels) as (keyof TicketOutput)[];
export const number = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
export const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export function latency(value: number | null | undefined) {
  if (value == null) return "—";
  return value >= 1000
    ? `${number(value / 1000, 2)} s`
    : `${number(value, 1)} ms`;
}
export function date(value: string | null | undefined, short = false) {
  if (!value) return "—";
  const normalized = /[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(short ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function outputValue(
  key: keyof TicketOutput,
  value: string | number | null | undefined,
) {
  if (value == null || value === "") return "未提供";
  if (key === "category")
    return categoryLabels[value as Category] || String(value);
  return String(value);
}
export function isActive(status: string) {
  return status === "running" || status === "queued";
}

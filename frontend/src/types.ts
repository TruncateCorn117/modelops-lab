export type Provider = "demo" | "ollama" | "openai";
export type FaultMode = "none" | "noisy" | "timeout" | "invalid_json" | "error";
export type Category = "mechanical" | "electrical" | "software" | "other";
export interface TicketOutput {
  equipment_id: string | null;
  equipment: string | null;
  production_line: string | null;
  reported_at: string | null;
  fault_code: string | null;
  category: Category;
  symptom: string | null;
  action_taken: string | null;
  downtime_minutes: number | null;
}
export interface ModelInput {
  name: string;
  version: string;
  provider: Provider;
  model_name: string;
  base_url: string;
  api_key_env: string;
  timeout_seconds: number;
  temperature: number;
  max_tokens: number;
  fault_mode: FaultMode;
  enabled: boolean;
}
export interface Model extends ModelInput {
  id: string;
  is_default: boolean;
  created_at: string;
  status: "unknown" | "healthy" | "unavailable";
  last_checked: string | null;
  health_detail: string | null;
}
export interface DatasetRow {
  id: string;
  text: string;
  expected: TicketOutput;
  split: "dev" | "test";
}
export interface Dataset {
  id: string;
  name: string;
  description: string;
  source: "synthetic" | "user";
  revision: string;
  sha256: string;
  count: number;
  created_at: string;
}
export interface DatasetDetail extends Dataset {
  rows: DatasetRow[];
}
export interface Score {
  field_accuracy: number;
  fields_correct: number;
  fields_total: number;
  category_correct: boolean;
  field_matches: Record<string, boolean>;
}
export interface Summary {
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
  valid_output_rate: number;
  field_accuracy: number;
  category_accuracy: number;
  macro_f1: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  throughput_rps: number | null;
  errors: Record<string, number>;
  confusion_matrix: Record<string, Record<string, number>>;
}
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";
export interface Run {
  id: string;
  name: string;
  dataset_id: string;
  dataset_name: string;
  model_ids: string[];
  model_names: string[];
  status: RunStatus;
  total: number;
  completed: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  concurrency: number;
  max_samples: number;
  split: "test" | "dev" | "all";
  prompt_version: string;
  dataset_sha256: string;
  model_snapshots: Model[];
  summary: Summary | null;
  by_model: (Summary & {
    model_id: string;
    model_name: string;
    is_simulated: boolean;
  })[];
  error: string | null;
}
export interface RunResult {
  id: string;
  model_id: string;
  model_name: string;
  text: string;
  expected: TicketOutput;
  output: TicketOutput | null;
  status: "success" | "error";
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  score: Score;
}
export interface RequestLog {
  id: string;
  model_id: string;
  model_name: string;
  run_id: string | null;
  status: "success" | "error";
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  is_simulated: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
}
export interface RequestDetail extends RequestLog {
  text: string;
  output: TicketOutput | null;
}
export interface Inference {
  id: string;
  model_id: string;
  model_name: string;
  output: TicketOutput;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  is_simulated: boolean;
  created_at: string;
}
export interface Dashboard {
  models_total: number;
  models_healthy: number;
  requests_total: number;
  success_rate: number | null;
  p95_latency_ms: number | null;
  runs_total: number;
  active_runs: number;
  resource: {
    process_cpu_percent: number;
    process_memory_mb: number;
    scope: "api_process";
    sampled_at: string;
  };
  recent_requests: RequestLog[];
  recent_runs: Run[];
  daily: { date: string; requests: number; errors: number }[];
  by_model: {
    model_id: string;
    model_name: string;
    requests: number;
    success_rate: number;
    avg_latency_ms: number;
  }[];
  auth_enabled: boolean;
}
export interface Health {
  status: string;
  version: string;
  auth_required: boolean;
}

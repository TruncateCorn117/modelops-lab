"""Versioned API contracts. Dataset labels and model outputs share one schema."""

import os
import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Category = Literal["mechanical", "electrical", "software", "other"]


class TicketOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    equipment_id: str | None
    equipment: str | None
    production_line: str | None
    reported_at: str | None
    fault_code: str | None
    category: Category
    symptom: str | None
    action_taken: str | None
    downtime_minutes: int | None = Field(ge=0)

    @field_validator(
        "equipment_id", "equipment", "production_line", "reported_at", "fault_code", "symptom", "action_taken"
    )
    @classmethod
    def bounded_strings(cls, value):
        if value is not None and (not value.strip() or len(value) > 2000):
            raise ValueError("Output fields must be non-empty strings of at most 2000 characters, or null")
        return value


class ModelInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    version: str = Field(default="1.0", min_length=1, max_length=100)
    provider: Literal["demo", "ollama", "openai"] = "demo"
    model_name: str = Field(default="rule-baseline", min_length=1, max_length=200)
    base_url: str = Field(default="", max_length=500)
    api_key_env: str = Field(default="", max_length=100)
    timeout_seconds: float = Field(default=60, ge=1, le=300)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=128, le=8192)
    fault_mode: Literal["none", "noisy", "timeout", "invalid_json", "error"] = "none"
    enabled: bool = True

    @field_validator("api_key_env")
    @classmethod
    def env_name(cls, value):
        if value and not re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", value):
            raise ValueError(
                "Use an environment variable name such as INFERENCE_API_KEY, never a secret value"
            )
        return value

    @model_validator(mode="after")
    def validate_connection(self):
        if self.provider == "demo":
            self.base_url = ""
            self.api_key_env = ""
            return self
        if self.fault_mode != "none":
            raise ValueError("Fault injection is available only for demo providers")
        if "\\" in self.base_url:
            raise ValueError("Backslashes are not allowed in base_url")
        parsed = urlsplit(self.base_url)
        try:
            _ = parsed.port
        except ValueError:
            raise ValueError("base_url contains an invalid port") from None
        allowed = {
            x.strip().lower()
            for x in os.getenv(
                "MODEL_OPS_ALLOWED_HOSTS", "localhost,127.0.0.1,::1,host.docker.internal"
            ).split(",")
            if x.strip()
        }
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
        if parsed.hostname.lower() not in allowed:
            raise ValueError(
                "Host is not allowed. Add the exact hostname to MODEL_OPS_ALLOWED_HOSTS on the server"
            )
        self.base_url = self.base_url.rstrip("/")
        return self


class InferInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    model_id: str | None = None
    text: str = Field(min_length=1, max_length=8000)


class DatasetRow(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=8000)
    expected: TicketOutput
    split: Literal["dev", "test"] = "test"


class DatasetInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    source: Literal["synthetic", "user"] = "user"
    revision: str = Field(default="1.0", max_length=50)
    rows: list[DatasetRow] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_rows(self):
        if len({r.id for r in self.rows}) != len(self.rows):
            raise ValueError("Dataset row IDs must be unique")
        if len({r.text for r in self.rows}) != len(self.rows):
            raise ValueError("Duplicate text is not allowed across dataset rows or splits")
        return self


class RunInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(default="工单模型对比", min_length=1, max_length=120)
    dataset_id: str
    model_ids: list[str] = Field(min_length=1, max_length=4)
    concurrency: int = Field(default=1, ge=1, le=8)
    max_samples: int = Field(default=30, ge=1, le=1000)
    split: Literal["test", "dev", "all"] = "test"

    @field_validator("model_ids")
    @classmethod
    def unique_models(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Select each model only once")
        return value

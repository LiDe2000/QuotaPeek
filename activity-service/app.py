"""Configuration publisher only. Never receives account identifiers or credentials."""

import hashlib
import os
from pathlib import Path
from typing import Literal, Self

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    ValidationError,
    model_validator,
)


# Configuration models, ordered from individual conditions to the complete catalog.
class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Condition(Model):
    path: str = Field(min_length=1, max_length=200)
    equals: JsonValue


class Rule(Model):
    all: list[Condition] = Field(min_length=1, max_length=10)
    status: Literal[
        "unknown", "available", "claimed", "verification", "failed", "pending"
    ]


class Mapping(Model):
    rules: list[Rule] = Field(max_length=30)


class Request(Model):
    url: str = Field(min_length=1, max_length=2000)
    method: Literal["GET", "POST"]
    query: dict[str, str] = Field(default_factory=dict, max_length=30)
    body: dict[str, JsonValue] | None = None
    timeoutMs: int = Field(default=5000, ge=500, le=30000)

    @model_validator(mode="after")
    def body_matches_method(self) -> Self:
        if self.method == "GET" and self.body is not None:
            raise ValueError("GET cannot have a body")
        return self


class Operation(Model):
    request: Request
    response: Mapping


class Activity(Model):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,79}$")
    providerId: Literal["workbuddy", "zcode"]
    title: str = Field(min_length=1, max_length=2000)
    reward: str = Field(min_length=1, max_length=2000)
    description: str = Field(default="", max_length=4000)
    enabled: bool = True
    regions: list[Literal["cn", "global"]] = Field(default_factory=list, max_length=2)
    adapterId: Literal[
        "mock-http-v1", "workbuddy-checkin-v1", "zcode-preview-v1", "zcode-plan-v1"
    ]
    startsAt: int | None = Field(default=None, ge=0)
    expiresAt: int | None = Field(default=None, ge=0)
    query: Operation
    claim: Operation | None = None


class Catalog(Model):
    schemaVersion: Literal[2]
    revision: str = Field(min_length=1, max_length=200)
    activities: list[Activity] = Field(max_length=100)

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        ids = [item.id for item in self.activities]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate activity ids")
        return self


# Read and validate the catalog on each request so file edits take effect immediately.
def create_app(catalog_path: Path | None = None) -> FastAPI:
    path = catalog_path or Path(
        os.environ.get(
            "ACTIVITY_CATALOG_FILE",
            Path(__file__).with_name("activities.json"),
        )
    )
    api = FastAPI(title="QuotaPeek activity configuration", version="2.0.0")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:1420", "http://localhost:1420"],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept"],
    )

    @api.get("/health")
    def health():
        return {"status": "ok", "role": "configuration-publisher"}

    @api.get("/v1/activities", response_model=Catalog, response_model_exclude_none=True)
    def activities(response: Response):
        try:
            with path.open("rb") as source:
                content = source.read(1_000_001)
            if len(content) > 1_000_000:
                raise ValueError("Catalog too large")
            catalog = Catalog.model_validate_json(content)
        except FileNotFoundError:
            raise HTTPException(404, "No activity configuration is published.")
        except (OSError, ValidationError, ValueError):
            raise HTTPException(
                503, "Activity configuration is invalid or unavailable."
            )
        catalog.revision = hashlib.sha256(content).hexdigest()[:16]
        response.headers["Cache-Control"] = "no-store"
        return catalog

    @api.get("/v1/catalog-schema")
    def schema():
        return Catalog.model_json_schema()

    return api


app = create_app()

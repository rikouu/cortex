"""Cortex memory plugin — native Hermes MemoryProvider integration.

Cortex is a local/remote universal AI agent memory service. This provider uses
Cortex REST APIs directly so Hermes can select it via ``memory.provider: cortex``
and get automatic recall/write behavior without routing through MCP tools.

Config via environment variables:
  CORTEX_URL          — Cortex base URL (default: http://127.0.0.1:21100)
  CORTEX_AUTH_TOKEN   — Optional bearer token
  CORTEX_AGENT_ID     — Cortex agent id (default: hermes)
  CORTEX_PAIRING_CODE — Optional Cortex pairing code

Non-secret settings may also live in ``$HERMES_HOME/cortex.json``. Keep secrets such as tokens in environment variables.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error

logger = logging.getLogger(__name__)

_DEFAULT_URL = "http://127.0.0.1:21100"
_DEFAULT_AGENT_ID = "hermes"
_DEFAULT_TIMEOUT = 8.0
_DEFAULT_RECALL_MAX_TOKENS = 4000
_VALID_CATEGORIES = {
    "identity", "preference", "decision", "fact", "entity", "correction",
    "todo", "context", "summary", "skill", "relationship", "goal",
    "insight", "project_state", "constraint", "policy",
    "agent_self_improvement", "agent_user_habit", "agent_relationship",
    "agent_persona",
}
_VALID_LAYERS = {"working", "core", "archive"}


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y", "on"}:
            return True
        if lowered in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _coerce_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(value)))
    except Exception:
        return default


def _coerce_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        return max(minimum, min(maximum, float(value)))
    except Exception:
        return default


def _get_default_hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return get_hermes_home()
    except Exception:
        return Path.home() / ".hermes"


def _load_config(hermes_home: Optional[str] = None) -> dict:
    """Load Cortex provider config from env, overridden by cortex.json."""
    config = {
        "url": os.environ.get("CORTEX_URL", _DEFAULT_URL),
        "auth_token": os.environ.get("CORTEX_AUTH_TOKEN", ""),
        "agent_id": os.environ.get("CORTEX_AGENT_ID", _DEFAULT_AGENT_ID),
        "pairing_code": os.environ.get("CORTEX_PAIRING_CODE", ""),
        "recall_max_tokens": os.environ.get("CORTEX_RECALL_MAX_TOKENS", _DEFAULT_RECALL_MAX_TOKENS),
        "timeout": os.environ.get("CORTEX_TIMEOUT", _DEFAULT_TIMEOUT),
        "debug": os.environ.get("CORTEX_DEBUG", "false"),
    }

    home = Path(hermes_home) if hermes_home else _get_default_hermes_home()
    config_path = home / "cortex.json"
    if config_path.exists():
        try:
            file_cfg = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(file_cfg, dict):
                aliases = {
                    "cortex_url": "url",
                    "base_url": "url",
                }
                file_only_keys = {"url", "agent_id", "recall_max_tokens", "timeout", "debug"}
                normalized = {}
                for key, value in file_cfg.items():
                    normalized_key = aliases.get(key, key)
                    if normalized_key in file_only_keys:
                        normalized[normalized_key] = value
                config.update({k: v for k, v in normalized.items() if v is not None and v != ""})
        except Exception:
            logger.debug("Failed to parse cortex.json", exc_info=True)

    url = str(config.get("url") or _DEFAULT_URL).strip().rstrip("/") or _DEFAULT_URL
    config["url"] = url
    config["auth_token"] = str(config.get("auth_token") or "").strip()
    config["agent_id"] = str(config.get("agent_id") or _DEFAULT_AGENT_ID).strip() or _DEFAULT_AGENT_ID
    config["pairing_code"] = str(config.get("pairing_code") or "").strip()
    config["recall_max_tokens"] = _coerce_int(
        config.get("recall_max_tokens"), _DEFAULT_RECALL_MAX_TOKENS, 1, 32000
    )
    config["timeout"] = _coerce_float(config.get("timeout"), _DEFAULT_TIMEOUT, 0.5, 60.0)
    config["debug"] = _coerce_bool(config.get("debug"), False)
    return config


class _CortexClient:
    """Tiny urllib-based Cortex REST client."""

    def __init__(self, base_url: str, auth_token: str = "", timeout: float = _DEFAULT_TIMEOUT):
        self.base_url = (base_url or _DEFAULT_URL).rstrip("/")
        self.auth_token = auth_token or ""
        self.timeout = timeout

    def _request(self, method: str, path: str, payload: Optional[dict] = None,
                 query: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        if query:
            clean_query = {k: v for k, v in query.items() if v not in (None, "", [])}
            if clean_query:
                url = f"{url}?{urllib.parse.urlencode(clean_query, doseq=True)}"

        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return {}
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {"result": parsed}

    def post(self, path: str, payload: dict) -> dict:
        return self._request("POST", path, payload=payload)

    def get(self, path: str, query: Optional[dict] = None) -> dict:
        return self._request("GET", path, query=query)

    def delete(self, path: str) -> dict:
        return self._request("DELETE", path)


def _error_message(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code}: {exc.reason}"
    if isinstance(exc, urllib.error.URLError):
        return str(exc.reason)
    return str(exc)


def _clean_text(text: str) -> str:
    return (text or "").strip()


def _is_trivial_exchange(user_content: str, assistant_content: str) -> bool:
    combined = f"{user_content or ''} {assistant_content or ''}".strip().lower()
    return combined in {"", "ok", "okay", "thanks", "thank you", "yes", "no", "k"}


RECALL_SCHEMA = {
    "name": "cortex_recall",
    "description": "Recall relevant long-term memories from Cortex.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query or current task context."},
            "max_tokens": {"type": "integer", "description": "Maximum context tokens to return."},
            "layers": {
                "type": "array",
                "items": {"type": "string", "enum": ["working", "core", "archive"]},
                "description": "Optional Cortex memory layers to search.",
            },
            "skip_filters": {"type": "boolean", "description": "Skip Cortex relevance filters."},
        },
        "required": ["query"],
    },
}

REMEMBER_SCHEMA = {
    "name": "cortex_remember",
    "description": "Store a durable explicit memory in Cortex.",
    "parameters": {
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Memory content to store."},
            "category": {"type": "string", "description": "Cortex memory category.", "enum": sorted(_VALID_CATEGORIES)},
            "layer": {"type": "string", "enum": ["working", "core", "archive"], "description": "Memory layer, default core."},
            "importance": {"type": "number", "description": "Importance from 0 to 1."},
            "confidence": {"type": "number", "description": "Confidence from 0 to 1."},
        },
        "required": ["content"],
    },
}

FORGET_SCHEMA = {
    "name": "cortex_forget",
    "description": "Delete a Cortex memory by id.",
    "parameters": {
        "type": "object",
        "properties": {"memory_id": {"type": "string", "description": "Cortex memory id to delete."}},
        "required": ["memory_id"],
    },
}

SEARCH_SCHEMA = {
    "name": "cortex_search",
    "description": "Search Cortex memories and return raw ranked results.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "limit": {"type": "integer", "description": "Maximum result count."},
            "categories": {"type": "array", "items": {"type": "string"}},
            "layers": {"type": "array", "items": {"type": "string", "enum": ["working", "core", "archive"]}},
            "debug": {"type": "boolean"},
        },
        "required": ["query"],
    },
}

RELATIONS_SCHEMA = {
    "name": "cortex_relations",
    "description": "List Cortex entity relationships.",
    "parameters": {
        "type": "object",
        "properties": {
            "subject": {"type": "string"},
            "object": {"type": "string"},
            "limit": {"type": "integer"},
        },
        "required": [],
    },
}

STATS_SCHEMA = {
    "name": "cortex_stats",
    "description": "Get Cortex memory service statistics.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}


class CortexMemoryProvider(MemoryProvider):
    """Native Cortex MemoryProvider using Cortex REST APIs."""

    def __init__(self):
        self._config: dict = {}
        self._client: Optional[_CortexClient] = None
        self._session_id = ""
        self._agent_id = _DEFAULT_AGENT_ID
        self._pairing_code = ""
        self._agent_context = "primary"
        self._recall_max_tokens = _DEFAULT_RECALL_MAX_TOKENS
        self._prefetch_results: dict[str, str] = {}
        self._prefetch_lock = threading.Lock()
        self._prefetch_threads: dict[str, threading.Thread] = {}
        self._sync_thread: Optional[threading.Thread] = None
        self._write_thread: Optional[threading.Thread] = None

    @property
    def name(self) -> str:
        return "cortex"

    def is_available(self) -> bool:
        cfg = _load_config()
        return bool(cfg.get("url"))

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        config_path = Path(hermes_home) / "cortex.json"
        existing = {}
        if config_path.exists():
            try:
                existing = json.loads(config_path.read_text(encoding="utf-8"))
            except Exception:
                existing = {}
        secret_keys = {"auth_token", "pairing_code", "token", "api_key"}
        for key in secret_keys:
            existing.pop(key, None)
        safe_values = {k: v for k, v in values.items() if k not in secret_keys}
        existing.update(safe_values)
        config_path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            os.chmod(config_path, 0o600)
        except Exception:
            logger.debug("Failed to chmod cortex.json", exc_info=True)

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {"key": "url", "description": "Cortex server URL", "default": _DEFAULT_URL},
            {"key": "auth_token", "description": "Cortex auth token", "secret": True, "required": False, "env_var": "CORTEX_AUTH_TOKEN"},
            {"key": "agent_id", "description": "Cortex agent id", "default": _DEFAULT_AGENT_ID},
            {"key": "pairing_code", "description": "Optional Cortex pairing code", "secret": True, "required": False, "env_var": "CORTEX_PAIRING_CODE"},
            {"key": "recall_max_tokens", "description": "Maximum tokens for automatic recall", "default": str(_DEFAULT_RECALL_MAX_TOKENS)},
        ]

    def initialize(self, session_id: str, **kwargs) -> None:
        hermes_home = kwargs.get("hermes_home")
        self._config = _load_config(hermes_home)
        self._session_id = session_id or ""
        self._agent_context = kwargs.get("agent_context") or "primary"
        self._agent_id = self._resolve_agent_id(kwargs)
        self._pairing_code = self._config.get("pairing_code", "")
        self._recall_max_tokens = self._config.get("recall_max_tokens", _DEFAULT_RECALL_MAX_TOKENS)
        self._client = _CortexClient(
            self._config.get("url", _DEFAULT_URL),
            self._config.get("auth_token", ""),
            self._config.get("timeout", _DEFAULT_TIMEOUT),
        )

    def _resolve_agent_id(self, kwargs: Dict[str, Any]) -> str:
        configured = self._config.get("agent_id") or ""
        if configured and configured != _DEFAULT_AGENT_ID:
            return configured
        user_id = kwargs.get("user_id")
        identity = kwargs.get("agent_identity") or self._config.get("agent_id") or _DEFAULT_AGENT_ID
        if user_id:
            return f"{identity}:{user_id}"
        return configured or identity or _DEFAULT_AGENT_ID

    def system_prompt_block(self) -> str:
        return (
            "# Cortex Memory\n"
            f"Active. Agent ID: {self._agent_id}.\n"
            "Use cortex_recall to search Cortex, cortex_remember to store durable facts, "
            "and cortex_forget to remove memories by id."
        )

    def _client_or_raise(self) -> _CortexClient:
        if self._client is None:
            self._client = _CortexClient(_DEFAULT_URL)
        return self._client

    def _recall_payload(self, query: str, **overrides) -> dict:
        payload = {
            "query": query,
            "agent_id": self._agent_id,
            "max_tokens": overrides.get("max_tokens", self._recall_max_tokens),
        }
        if self._pairing_code:
            payload["pairing_code"] = self._pairing_code
        layers = overrides.get("layers")
        if layers:
            payload["layers"] = [layer for layer in layers if layer in _VALID_LAYERS]
        if overrides.get("skip_filters") is not None:
            payload["skip_filters"] = bool(overrides.get("skip_filters"))
        return payload

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        key = session_id or self._session_id or "default"
        thread = self._prefetch_threads.get(key)
        if thread and thread.is_alive():
            thread.join(timeout=3.0)
        with self._prefetch_lock:
            result = self._prefetch_results.pop(key, "")
        if not result:
            return ""
        return f"## Cortex Memory\n{result}"

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        query = _clean_text(query)
        if not query:
            return
        key = session_id or self._session_id or "default"

        def _run():
            try:
                response = self._client_or_raise().post("/api/v1/recall", self._recall_payload(query))
                context = _clean_text(str(response.get("context") or ""))
                if context:
                    with self._prefetch_lock:
                        self._prefetch_results[key] = context
            except Exception as exc:
                logger.debug("Cortex prefetch failed: %s", _error_message(exc))

        thread = threading.Thread(target=_run, daemon=True, name=f"cortex-prefetch-{key}")
        self._prefetch_threads[key] = thread
        thread.start()

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        if self._agent_context != "primary":
            return
        user = _clean_text(user_content)
        assistant = _clean_text(assistant_content)
        if _is_trivial_exchange(user, assistant):
            return

        payload = {
            "user_message": user,
            "assistant_message": assistant,
            "messages": [
                {"role": "user", "content": user},
                {"role": "assistant", "content": assistant},
            ],
            "agent_id": self._agent_id,
            "session_id": session_id or self._session_id,
        }
        if self._pairing_code:
            payload["pairing_code"] = self._pairing_code

        def _sync():
            try:
                self._client_or_raise().post("/api/v1/ingest", payload)
            except Exception as exc:
                logger.warning("Cortex sync failed: %s", _error_message(exc))

        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=5.0)
        self._sync_thread = threading.Thread(target=_sync, daemon=True, name="cortex-sync")
        self._sync_thread.start()

    def on_memory_write(self, action, target, content, metadata=None) -> None:
        if self._agent_context != "primary":
            return
        if action not in {"add", "replace"}:
            return
        text = _clean_text(content)
        if not text:
            return
        payload = self._memory_payload(text, metadata or {})
        payload["source"] = "hermes_builtin_memory"

        def _write():
            try:
                self._client_or_raise().post("/api/v1/memories", payload)
            except Exception as exc:
                logger.debug("Cortex explicit memory mirror failed: %s", _error_message(exc))

        if self._write_thread and self._write_thread.is_alive():
            self._write_thread.join(timeout=5.0)
        self._write_thread = threading.Thread(target=_write, daemon=True, name="cortex-memory-write")
        self._write_thread.start()

    def _memory_payload(self, content: str, args: Dict[str, Any]) -> dict:
        category = str(args.get("category") or "fact")
        if category not in _VALID_CATEGORIES:
            category = "fact"
        layer = str(args.get("layer") or "core")
        if layer not in _VALID_LAYERS:
            layer = "core"
        payload = {
            "layer": layer,
            "category": category,
            "content": content,
            "agent_id": self._agent_id,
            "importance": _coerce_float(args.get("importance"), 0.7, 0.0, 1.0),
            "source": args.get("source") or "hermes_cortex_provider",
        }
        if args.get("confidence") is not None:
            payload["confidence"] = _coerce_float(args.get("confidence"), 0.8, 0.0, 1.0)
        return payload

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [RECALL_SCHEMA, REMEMBER_SCHEMA, FORGET_SCHEMA, SEARCH_SCHEMA, RELATIONS_SCHEMA, STATS_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        args = args or {}
        try:
            if tool_name == "cortex_recall":
                query = _clean_text(args.get("query", ""))
                if not query:
                    return tool_error("Missing required parameter: query")
                payload = self._recall_payload(
                    query,
                    max_tokens=args.get("max_tokens") or self._recall_max_tokens,
                    layers=args.get("layers"),
                    skip_filters=args.get("skip_filters"),
                )
                return json.dumps(self._client_or_raise().post("/api/v1/recall", payload))

            if tool_name == "cortex_remember":
                if self._agent_context != "primary":
                    return tool_error("Cortex memory writes are disabled outside the primary agent context")
                content = _clean_text(args.get("content", ""))
                if not content:
                    return tool_error("Missing required parameter: content")
                return json.dumps(self._client_or_raise().post("/api/v1/memories", self._memory_payload(content, args)))

            if tool_name == "cortex_forget":
                if self._agent_context != "primary":
                    return tool_error("Cortex memory deletes are disabled outside the primary agent context")
                memory_id = _clean_text(args.get("memory_id", ""))
                if not memory_id:
                    return tool_error("Missing required parameter: memory_id")
                safe_id = urllib.parse.quote(memory_id, safe="")
                return json.dumps(self._client_or_raise().delete(f"/api/v1/memories/{safe_id}"))

            if tool_name == "cortex_search":
                query = _clean_text(args.get("query", ""))
                if not query:
                    return tool_error("Missing required parameter: query")
                payload = {
                    "query": query,
                    "agent_id": self._agent_id,
                    "limit": _coerce_int(args.get("limit", 10), 10, 1, 100),
                }
                for key in ("layers", "categories", "debug"):
                    if args.get(key) not in (None, "", []):
                        payload[key] = args[key]
                return json.dumps(self._client_or_raise().post("/api/v1/search", payload))

            if tool_name == "cortex_relations":
                query = {"agent_id": self._agent_id, "limit": _coerce_int(args.get("limit", 20), 20, 1, 200)}
                if args.get("subject"):
                    query["subject"] = args["subject"]
                if args.get("object"):
                    query["object"] = args["object"]
                return json.dumps(self._client_or_raise().get("/api/v1/relations", query))

            if tool_name == "cortex_stats":
                return json.dumps(self._client_or_raise().get("/api/v1/stats"))
        except Exception as exc:
            return tool_error(_error_message(exc))

        return tool_error(f"Unknown tool: {tool_name}")

    def shutdown(self) -> None:
        for thread in list(self._prefetch_threads.values()):
            if thread and thread.is_alive():
                thread.join(timeout=5.0)
        self._prefetch_threads.clear()
        self._prefetch_results.clear()
        for attr in ("_sync_thread", "_write_thread"):
            thread = getattr(self, attr)
            if thread and thread.is_alive():
                thread.join(timeout=5.0)
            setattr(self, attr, None)


def register(ctx) -> None:
    """Register Cortex as a memory provider plugin."""
    ctx.register_memory_provider(CortexMemoryProvider())

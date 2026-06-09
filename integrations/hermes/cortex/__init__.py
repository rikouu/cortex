"""Cortex memory provider for Hermes Agent.

Implements Hermes' ``MemoryProvider`` ABC (``agent/memory_provider.py``) so Cortex
can be selected as a first-class ``memory.provider`` — automatic pre-turn recall,
post-turn ingestion, and explicit remember/search/forget tools — instead of only
being callable through MCP.

Reference implementation for issue rikouu/cortex#23. Zero third-party dependencies
(stdlib ``urllib`` only). It talks to a running Cortex server over its public REST
API:

    POST /api/v1/recall            pre-turn recall / search
    POST /api/v1/ingest            post-turn extraction
    POST /api/v1/memories          store a verbatim memory
    DELETE /api/v1/memories/:id    forget a memory
    GET  /api/v1/health            availability probe

Install: copy this directory to ``$HERMES_HOME/plugins/memory/cortex/`` (or publish
it as its own repo and ``hermes plugins install <owner>/<repo>``), then set
``memory.provider: cortex`` in ``~/.hermes/config.yaml`` and configure via
``hermes memory setup``.
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

try:
    # Provided by the Hermes runtime.
    from agent.memory_provider import MemoryProvider
except Exception:  # pragma: no cover - allows importing the module standalone for linting/tests
    class MemoryProvider:  # type: ignore
        """Fallback stub so this file imports outside a Hermes checkout."""

logger = logging.getLogger(__name__)

DEFAULT_URL = "http://127.0.0.1:21100"
DEFAULT_AGENT_ID = "hermes"

# Recall budget should be short — it sits on the critical path before each turn.
RECALL_TIMEOUT = 8.0
INGEST_TIMEOUT = 6.0
WRITE_TIMEOUT = 6.0
HEALTH_TIMEOUT = 2.0


# ── Tool schemas (OpenAI function-calling format) ──────────────────────────────
SEARCH_SCHEMA: Dict[str, Any] = {
    "name": "cortex_search",
    "description": (
        "Search Cortex long-term memory for relevant facts, preferences, decisions, "
        "constraints, and past context. Returns ranked memories with their ids "
        "(needed for cortex_forget)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What you want to recall."},
        },
        "required": ["query"],
    },
}

REMEMBER_SCHEMA: Dict[str, Any] = {
    "name": "cortex_remember",
    "description": (
        "Store a durable fact, preference, decision, constraint, or policy in Cortex "
        "long-term memory. Use for information that should persist across sessions."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "The information to remember — specific and concise."},
            "category": {
                "type": "string",
                "description": "Memory category.",
                "enum": [
                    "identity", "preference", "decision", "fact", "entity",
                    "correction", "todo", "skill", "relationship", "goal",
                    "insight", "project_state", "constraint", "policy",
                ],
                "default": "fact",
            },
        },
        "required": ["content"],
    },
}

FORGET_SCHEMA: Dict[str, Any] = {
    "name": "cortex_forget",
    "description": (
        "Delete a memory from Cortex by id. Get the id from cortex_search results. "
        "Use when the user asks you to forget something or a fact is no longer true."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "memory_id": {"type": "string", "description": "The id of the memory to delete."},
        },
        "required": ["memory_id"],
    },
}


class CortexMemoryProvider(MemoryProvider):
    """Self-hosted Cortex memory backend for Hermes, via its REST API."""

    def __init__(self) -> None:
        self._config: Dict[str, Any] = {}
        self._session_id: str = ""
        self._agent_id: str = DEFAULT_AGENT_ID
        self._pairing_code: str = ""
        # Background prefetch plumbing (recall for the NEXT turn).
        self._prefetch_thread: Optional[threading.Thread] = None
        self._prefetch_result: str = ""
        self._sync_threads: List[threading.Thread] = []

    # ── Identity ───────────────────────────────────────────────────────────────
    @property
    def name(self) -> str:
        return "cortex"

    # ── Config ───────────────────────────────────────────────────────────────--
    def _load_config(self) -> Dict[str, Any]:
        """Merge env vars over a non-secret JSON config in $HERMES_HOME, env wins."""
        cfg: Dict[str, Any] = {
            "url": DEFAULT_URL,
            "auth_token": "",
            "agent_id": DEFAULT_AGENT_ID,
            "pairing_code": "",
        }

        hermes_home = os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
        cfg_file = Path(hermes_home) / "cortex.json"
        if cfg_file.is_file():
            try:
                file_cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
                for k, v in file_cfg.items():
                    if v is not None:
                        cfg[k] = v
            except (OSError, ValueError) as exc:
                logger.warning("cortex: failed to read %s: %s", cfg_file, exc)

        env_map = {
            "CORTEX_URL": "url",
            "CORTEX_AUTH_TOKEN": "auth_token",
            "CORTEX_AGENT_ID": "agent_id",
            "CORTEX_PAIRING_CODE": "pairing_code",
        }
        for env_var, key in env_map.items():
            val = os.environ.get(env_var)
            if val:
                cfg[key] = val

        cfg["url"] = str(cfg["url"]).rstrip("/")
        return cfg

    def is_available(self) -> bool:
        # Per the ABC contract: check config only, no network calls here.
        cfg = self._config or self._load_config()
        return bool(cfg.get("url"))

    def initialize(self, session_id: str, **kwargs: Any) -> None:
        self._config = self._load_config()
        self._session_id = session_id or ""
        # Prefer the per-instance pairing code for namespace isolation; fall back to
        # the Hermes user id so memories are scoped per user when no code is set.
        self._agent_id = self._config.get("agent_id") or DEFAULT_AGENT_ID
        self._pairing_code = self._config.get("pairing_code") or (kwargs.get("user_id") or "")
        logger.info(
            "cortex: initialized (url=%s, agent_id=%s, scoped=%s)",
            self._config.get("url"), self._agent_id, bool(self._pairing_code),
        )

    # ── HTTP helpers ─────────────────────────────────────────────────────────--
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        token = self._config.get("auth_token")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]], timeout: float) -> Any:
        url = f"{self._config.get('url', DEFAULT_URL)}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - operator-configured Cortex URL
            body = resp.read().decode("utf-8")
        return json.loads(body) if body else None

    def _scoped(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        payload["agent_id"] = self._agent_id
        if self._pairing_code:
            payload["pairing_code"] = self._pairing_code
        return payload

    # ── Recall (pre-turn) ─────────────────────────────────────────────────────-
    def _recall(self, query: str) -> str:
        if not query:
            return ""
        try:
            result = self._request("POST", "/api/v1/recall", self._scoped({"query": query}), RECALL_TIMEOUT)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            logger.warning("cortex: recall failed: %s", exc)
            return ""
        if not result:
            return ""
        meta = result.get("meta") or {}
        if result.get("context") and (meta.get("injected_count") or 0) > 0:
            return str(result["context"])
        return ""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        # Use the queued background result if one is ready, else recall inline.
        if self._prefetch_thread is not None:
            self._prefetch_thread.join(timeout=RECALL_TIMEOUT)
            self._prefetch_thread = None
            if self._prefetch_result:
                result, self._prefetch_result = self._prefetch_result, ""
                return result
        return self._recall(query)

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        def _run() -> None:
            self._prefetch_result = self._recall(query)

        self._prefetch_result = ""
        self._prefetch_thread = threading.Thread(target=_run, daemon=True)
        self._prefetch_thread.start()

    # ── Ingest (post-turn) ─────────────────────────────────────────────────────
    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        if not user_content or not assistant_content:
            return

        payload = self._scoped({
            "user_message": user_content,
            "assistant_message": assistant_content,
        })
        if messages:
            payload["messages"] = messages

        def _run() -> None:
            try:
                self._request("POST", "/api/v1/ingest", payload, INGEST_TIMEOUT)
            except (urllib.error.URLError, OSError, ValueError) as exc:
                logger.warning("cortex: ingest failed: %s", exc)

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()
        self._sync_threads = [t for t in self._sync_threads if t.is_alive()]
        self._sync_threads.append(thread)

    # ── Tools ───────────────────────────────────────────────────────────────--
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [SEARCH_SCHEMA, REMEMBER_SCHEMA, FORGET_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs: Any) -> str:
        if tool_name == "cortex_search":
            return self._tool_search(args)
        if tool_name == "cortex_remember":
            return self._tool_remember(args)
        if tool_name == "cortex_forget":
            return self._tool_forget(args)
        return json.dumps({"error": f"unknown tool: {tool_name}"})

    def _tool_search(self, args: Dict[str, Any]) -> str:
        query = (args or {}).get("query", "").strip()
        if not query:
            return json.dumps({"error": "query is required"})
        try:
            result = self._request("POST", "/api/v1/recall", self._scoped({"query": query}), RECALL_TIMEOUT)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            return json.dumps({"error": f"search failed: {exc}"})
        meta = (result or {}).get("meta") or {}
        return json.dumps({
            "context": (result or {}).get("context", ""),
            "count": meta.get("injected_count", 0),
            "memory_ids": meta.get("memory_ids", []),
        })

    def _tool_remember(self, args: Dict[str, Any]) -> str:
        content = (args or {}).get("content", "").strip()
        if not content:
            return json.dumps({"error": "content is required"})
        payload = self._scoped({
            "content": content,
            "category": (args or {}).get("category") or "fact",
            "layer": "core",
            "importance": 0.7,
            "confidence": 0.9,
        })
        try:
            result = self._request("POST", "/api/v1/memories", payload, WRITE_TIMEOUT)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            return json.dumps({"error": f"remember failed: {exc}"})
        return json.dumps({"ok": True, "id": (result or {}).get("id"), "remembered": content})

    def _tool_forget(self, args: Dict[str, Any]) -> str:
        memory_id = (args or {}).get("memory_id", "").strip()
        if not memory_id:
            return json.dumps({"error": "memory_id is required"})
        try:
            self._request("DELETE", f"/api/v1/memories/{urllib.parse.quote(memory_id)}", None, WRITE_TIMEOUT)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            return json.dumps({"error": f"forget failed: {exc}"})
        return json.dumps({"ok": True, "forgot": memory_id})

    # ── System prompt ─────────────────────────────────────────────────────────-
    def system_prompt_block(self) -> str:
        return (
            "You have long-term memory powered by Cortex. Relevant memories are "
            "recalled automatically before each turn. You can also call "
            "`cortex_search` to look something up, `cortex_remember` to store a "
            "durable fact/preference/decision, and `cortex_forget` to delete a "
            "memory by id."
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────────-
    def shutdown(self) -> None:
        for thread in self._sync_threads:
            thread.join(timeout=INGEST_TIMEOUT)
        self._sync_threads = []
        if self._prefetch_thread is not None:
            self._prefetch_thread.join(timeout=RECALL_TIMEOUT)
            self._prefetch_thread = None

    # ── Setup wizard ──────────────────────────────────────────────────────────-
    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "url",
                "description": "Cortex server URL (e.g. http://127.0.0.1:21100)",
                "secret": False,
                "required": True,
                "default": DEFAULT_URL,
                "env_var": "CORTEX_URL",
            },
            {
                "key": "auth_token",
                "description": "Bearer token for an authenticated Cortex server (optional)",
                "secret": True,
                "required": False,
                "default": "",
                "env_var": "CORTEX_AUTH_TOKEN",
            },
            {
                "key": "agent_id",
                "description": "Agent identifier for memory attribution",
                "secret": False,
                "required": False,
                "default": DEFAULT_AGENT_ID,
                "env_var": "CORTEX_AGENT_ID",
            },
            {
                "key": "pairing_code",
                "description": "Instance pairing code for namespace isolation (optional)",
                "secret": False,
                "required": False,
                "default": "",
                "env_var": "CORTEX_PAIRING_CODE",
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        """Persist non-secret config to $HERMES_HOME/cortex.json. Secrets stay in env."""
        non_secret = {
            "url": values.get("url", DEFAULT_URL),
            "agent_id": values.get("agent_id", DEFAULT_AGENT_ID),
            "pairing_code": values.get("pairing_code", ""),
        }
        cfg_file = Path(hermes_home) / "cortex.json"
        cfg_file.write_text(json.dumps(non_secret, indent=2), encoding="utf-8")

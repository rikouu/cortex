import json
import stat
import urllib.error

import pytest

from plugins.memory import discover_memory_providers, load_memory_provider
from plugins.memory.cortex import CortexMemoryProvider, _CortexClient, _load_config


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_load_config_defaults(monkeypatch, tmp_path):
    monkeypatch.delenv("CORTEX_URL", raising=False)
    monkeypatch.delenv("CORTEX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("CORTEX_AGENT_ID", raising=False)

    cfg = _load_config(str(tmp_path))

    assert cfg["url"] == "http://127.0.0.1:21100"
    assert cfg["auth_token"] == ""
    assert cfg["agent_id"] == "hermes"
    assert cfg["recall_max_tokens"] == 4000


def test_load_config_file_overrides_non_secret_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_URL", "http://env.example")
    monkeypatch.setenv("CORTEX_AUTH_TOKEN", "env-token")
    monkeypatch.setenv("CORTEX_AGENT_ID", "env-agent")
    monkeypatch.setenv("CORTEX_PAIRING_CODE", "env-pair")
    (tmp_path / "cortex.json").write_text(json.dumps({
        "url": "http://file.example",
        "auth_token": "file-token",
        "token": "alias-token",
        "api_key": "alias-api-key",
        "agent_id": "file-agent",
        "pairing_code": "file-pair",
        "recall_max_tokens": 123,
    }))

    cfg = _load_config(str(tmp_path))

    assert cfg["url"] == "http://file.example"
    assert cfg["auth_token"] == "env-token"
    assert cfg["agent_id"] == "file-agent"
    assert cfg["pairing_code"] == "env-pair"
    assert cfg["recall_max_tokens"] == 123




def test_schema_marks_secret_values_as_secret():
    provider = CortexMemoryProvider()
    schema = {item["key"]: item for item in provider.get_config_schema()}

    assert schema["auth_token"]["secret"] is True
    assert schema["auth_token"]["env_var"] == "CORTEX_AUTH_TOKEN"
    assert schema["pairing_code"]["secret"] is True
    assert schema["pairing_code"]["env_var"] == "CORTEX_PAIRING_CODE"

def test_client_sends_json_and_auth_header(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        captured["headers"] = dict(request.header_items())
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse({"ok": True})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = _CortexClient("http://cortex.local/", "secret-token", timeout=7)
    result = client.post("/api/v1/recall", {"query": "hello"})

    assert result == {"ok": True}
    assert captured["url"] == "http://cortex.local/api/v1/recall"
    assert captured["method"] == "POST"
    assert captured["headers"]["Authorization"] == "Bearer secret-token"
    assert captured["headers"]["Content-type"] == "application/json"
    assert captured["body"] == {"query": "hello"}
    assert captured["timeout"] == 7


def test_plugin_discovery_and_load(monkeypatch):
    monkeypatch.setenv("CORTEX_URL", "http://127.0.0.1:21100")

    providers = {name: available for name, _desc, available in discover_memory_providers()}
    provider = load_memory_provider("cortex")

    assert providers["cortex"] is True
    assert isinstance(provider, CortexMemoryProvider)


def test_provider_schema_names():
    provider = CortexMemoryProvider()
    names = {schema["name"] for schema in provider.get_tool_schemas()}

    assert names == {
        "cortex_recall",
        "cortex_remember",
        "cortex_forget",
        "cortex_search",
        "cortex_relations",
        "cortex_stats",
    }


def test_queue_prefetch_and_prefetch_formats_context(monkeypatch, tmp_path):
    calls = []

    class FakeClient:
        def post(self, path, payload):
            calls.append((path, payload))
            return {"context": "- Tsun uses Hermes", "count": 1, "memories": [{"id": "m1"}]}

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli")
    provider._client = FakeClient()

    provider.queue_prefetch("Hermes memory", session_id="session-1")
    provider._prefetch_threads["session-1"].join(timeout=1)
    result = provider.prefetch("Hermes memory", session_id="session-1")

    assert calls == [("/api/v1/recall", {
        "query": "Hermes memory",
        "agent_id": "hermes",
        "max_tokens": 4000,
    })]
    assert result == "## Cortex Memory\n- Tsun uses Hermes"


def test_prefetch_is_isolated_by_session(tmp_path):
    class FakeClient:
        def post(self, path, payload):
            return {"context": f"memory for {payload['query']}"}

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="telegram")
    provider._client = FakeClient()

    provider.queue_prefetch("session-a", session_id="a")
    provider._prefetch_threads["a"].join(timeout=1)
    provider.queue_prefetch("session-b", session_id="b")
    provider._prefetch_threads["b"].join(timeout=1)

    assert provider.prefetch("ignored", session_id="a") == "## Cortex Memory\nmemory for session-a"
    assert provider.prefetch("ignored", session_id="b") == "## Cortex Memory\nmemory for session-b"


def test_sync_turn_posts_to_ingest(monkeypatch, tmp_path):
    calls = []

    class FakeClient:
        def post(self, path, payload):
            calls.append((path, payload))
            return {"ok": True}

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli")
    provider._client = FakeClient()

    provider.sync_turn("remember this", "stored", session_id="session-2")
    provider._sync_thread.join(timeout=1)

    assert calls == [("/api/v1/ingest", {
        "user_message": "remember this",
        "assistant_message": "stored",
        "messages": [
            {"role": "user", "content": "remember this"},
            {"role": "assistant", "content": "stored"},
        ],
        "agent_id": "hermes",
        "session_id": "session-2",
    })]


def test_non_primary_agent_context_skips_writes(tmp_path):
    class FakeClient:
        def post(self, path, payload):  # pragma: no cover - should not be called
            raise AssertionError("non-primary context should not write")

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli", agent_context="subagent")
    provider._client = FakeClient()

    provider.sync_turn("remember this", "stored", session_id="session-1")
    provider.on_memory_write("add", "memory", "Tsun prefers direct answers")

    assert provider._sync_thread is None
    assert provider._write_thread is None


def test_save_config_filters_secrets_and_sets_0600_permissions(tmp_path):
    provider = CortexMemoryProvider()
    config_path = tmp_path / "cortex.json"
    config_path.write_text(json.dumps({"auth_token": "old-token", "pairing_code": "old-pair", "url": "old"}))

    provider.save_config({
        "url": "http://cortex.local",
        "agent_id": "hermes-test",
        "auth_token": "secret-token",
        "pairing_code": "secret-pair",
    }, str(tmp_path))

    saved = json.loads(config_path.read_text())
    mode = stat.S_IMODE(config_path.stat().st_mode)

    assert saved == {"agent_id": "hermes-test", "url": "http://cortex.local"}
    assert mode == 0o600


def test_non_primary_context_blocks_write_and_delete_tools(tmp_path):
    class FakeClient:
        def post(self, path, payload):  # pragma: no cover - should not be called
            raise AssertionError("non-primary context should not write")

        def delete(self, path):  # pragma: no cover - should not be called
            raise AssertionError("non-primary context should not delete")

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli", agent_context="subagent")
    provider._client = FakeClient()

    remember = json.loads(provider.handle_tool_call("cortex_remember", {"content": "do not write"}))
    forget = json.loads(provider.handle_tool_call("cortex_forget", {"memory_id": "m1"}))

    assert "disabled outside the primary agent context" in remember["error"]
    assert "disabled outside the primary agent context" in forget["error"]


def test_cortex_remember_tool_posts_memory(monkeypatch, tmp_path):
    calls = []

    class FakeClient:
        def post(self, path, payload):
            calls.append((path, payload))
            return {"id": "mem_1", "content": payload["content"]}

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli")
    provider._client = FakeClient()

    result = json.loads(provider.handle_tool_call("cortex_remember", {
        "content": "Tsun prefers direct answers",
        "category": "preference",
        "importance": 0.9,
    }))

    assert result["id"] == "mem_1"
    assert calls == [("/api/v1/memories", {
        "layer": "core",
        "category": "preference",
        "content": "Tsun prefers direct answers",
        "agent_id": "hermes",
        "importance": 0.9,
        "source": "hermes_cortex_provider",
    })]


def test_forget_search_relations_and_stats_tools(tmp_path):
    calls = []

    class FakeClient:
        def post(self, path, payload):
            calls.append(("post", path, payload))
            return {"path": path, "payload": payload}

        def get(self, path, query=None):
            calls.append(("get", path, query or {}))
            return {"path": path, "query": query or {}}

        def delete(self, path):
            calls.append(("delete", path, {}))
            return {"ok": True}

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli")
    provider._client = FakeClient()

    assert json.loads(provider.handle_tool_call("cortex_forget", {"memory_id": "m1"}))["ok"] is True
    assert json.loads(provider.handle_tool_call("cortex_search", {"query": "Hermes", "limit": 3}))["path"] == "/api/v1/search"
    assert json.loads(provider.handle_tool_call("cortex_relations", {"subject": "Hermes"}))["path"] == "/api/v1/relations"
    assert json.loads(provider.handle_tool_call("cortex_stats", {}))["path"] == "/api/v1/stats"

    assert calls[0] == ("delete", "/api/v1/memories/m1", {})
    assert calls[1] == ("post", "/api/v1/search", {"query": "Hermes", "agent_id": "hermes", "limit": 3})
    assert calls[2] == ("get", "/api/v1/relations", {"agent_id": "hermes", "subject": "Hermes", "limit": 20})
    assert calls[3] == ("get", "/api/v1/stats", {})




def test_http_error_message_does_not_return_response_body():
    err = urllib.error.HTTPError(
        "http://cortex.local",
        401,
        "Unauthorized",
        {},
        None,
    )

    from plugins.memory.cortex import _error_message

    assert _error_message(err) == "HTTP 401: Unauthorized"

def test_tool_errors_do_not_raise(tmp_path):
    class FailingClient:
        def post(self, path, payload):
            raise urllib.error.URLError("down")

    provider = CortexMemoryProvider()
    provider.initialize("session-1", hermes_home=str(tmp_path), platform="cli")
    provider._client = FailingClient()

    result = json.loads(provider.handle_tool_call("cortex_recall", {"query": "Hermes"}))

    assert "error" in result
    assert "down" in result["error"]

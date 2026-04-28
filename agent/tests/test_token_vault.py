"""AI-8766 — Tests for the Python side of the platform-token vault.

Covers:

* roundtrip encrypt/decrypt for short and long plaintexts
* per-user key isolation (decrypt with wrong user_id fails)
* version byte gate (unknown version raises TokenVaultError)
* malformed blob handling (truncated input raises)
* missing master key surfaces a clear error
* wire-format compatibility with the Node.js helper, exercised by shelling
  out to ``node`` with the same master key + user_id and confirming the
  byte sequence Node produces decrypts successfully in Python (and vice
  versa). Skipped automatically if ``node`` is not on PATH.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

# Make the agent package importable when pytest is invoked from the repo root.
ROOT = Path(__file__).resolve().parents[2]
AGENT_DIR = ROOT / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))


@pytest.fixture(autouse=True)
def _set_master_key(monkeypatch):
    # 32 bytes of 0x42 -> deterministic across the suite.
    key = base64.b64encode(b"\x42" * 32).decode()
    monkeypatch.setenv("CLAPCHEEKS_TOKEN_MASTER_KEY", key)


def test_roundtrip_short_token():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token

    user_id = "user-123"
    plain = "X-Auth-Token=abc123def456"
    blob = encrypt_token(plain, user_id)
    assert blob[0] == 1, "version byte"
    assert len(blob) >= 1 + 12 + 16 + len(plain)
    assert decrypt_token(blob, user_id) == plain


def test_roundtrip_long_json_blob():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token

    user_id = "user-XYZ"
    plain = json.dumps({
        "sessionid": "long" * 50,
        "ds_user_id": "12345",
        "csrftoken": "abcdef" * 10,
        "mid": "ZZ-something",
        "ig_did": "0001-0002-0003-0004",
    })
    blob = encrypt_token(plain, user_id)
    assert decrypt_token(blob, user_id) == plain


def test_per_user_isolation():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token

    blob = encrypt_token("secret", "alice")
    # Decrypting under a different user_id triggers GCM auth-tag failure
    from cryptography.exceptions import InvalidTag
    with pytest.raises(InvalidTag):
        decrypt_token(blob, "bob")


def test_unknown_version_rejected():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token, TokenVaultError

    blob = bytearray(encrypt_token("secret", "alice"))
    blob[0] = 99
    with pytest.raises(TokenVaultError):
        decrypt_token(bytes(blob), "alice")


def test_truncated_blob():
    from clapcheeks.auth.token_vault import decrypt_token, TokenVaultError

    with pytest.raises(TokenVaultError):
        decrypt_token(b"\x01\x02\x03", "alice")


def test_missing_master_key_raises(monkeypatch):
    from clapcheeks.auth.token_vault import encrypt_token, TokenVaultError

    monkeypatch.delenv("CLAPCHEEKS_TOKEN_MASTER_KEY", raising=False)
    with pytest.raises(TokenVaultError, match="not set"):
        encrypt_token("secret", "alice")


def test_decrypt_supabase_handles_hex():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token_supabase

    blob = encrypt_token("secret-hex", "alice")
    hex_value = "\\x" + blob.hex()
    assert decrypt_token_supabase(hex_value, "alice") == "secret-hex"


def test_decrypt_supabase_handles_base64():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token_supabase

    blob = encrypt_token("secret-b64", "alice")
    b64_value = base64.b64encode(blob).decode()
    assert decrypt_token_supabase(b64_value, "alice") == "secret-b64"


def test_decrypt_supabase_passes_through_bytes():
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token_supabase

    blob = encrypt_token("secret-bytes", "alice")
    assert decrypt_token_supabase(blob, "alice") == "secret-bytes"


def test_decrypt_supabase_handles_falsy():
    from clapcheeks.auth.token_vault import decrypt_token_supabase

    assert decrypt_token_supabase(None, "alice") is None
    assert decrypt_token_supabase("", "alice") is None
    assert decrypt_token_supabase(b"", "alice") is None


# ---------------------------------------------------------------------------
# Cross-language wire compatibility (skip if node not available)
# ---------------------------------------------------------------------------


def _node_available() -> bool:
    return shutil.which("node") is not None


@pytest.mark.skipif(not _node_available(), reason="node not on PATH")
def test_node_python_wire_compatibility(tmp_path):
    """Encrypt with Node, decrypt with Python — and the reverse.

    Inlines a small Node script so it doesn't depend on the web/ workspace
    being built. Uses identical scrypt params + format as the production
    code.
    """
    from clapcheeks.auth.token_vault import encrypt_token, decrypt_token

    master_key_b64 = os.environ["CLAPCHEEKS_TOKEN_MASTER_KEY"]
    user_id = "wire-user-789"
    plain = "wire-compat-test-PAYLOAD-1234567890"

    node_script = tmp_path / "vault.js"
    node_script.write_text(textwrap.dedent("""
        const { createCipheriv, createDecipheriv, scryptSync } = require('crypto');
        const VERSION = 1;
        const IV_BYTES = 12;
        const TAG_BYTES = 16;
        const KEY_BYTES = 32;
        const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

        function deriveKey(masterB64, userId) {
            const master = Buffer.from(masterB64, 'base64');
            return scryptSync(master, Buffer.from(userId, 'utf8'), KEY_BYTES, SCRYPT);
        }

        function encrypt(plain, masterB64, userId, ivHex) {
            const key = deriveKey(masterB64, userId);
            const iv = Buffer.from(ivHex, 'hex');
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
            const tag = cipher.getAuthTag();
            return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]).toString('hex');
        }

        function decrypt(blobHex, masterB64, userId) {
            const buf = Buffer.from(blobHex, 'hex');
            const version = buf[0];
            if (version !== VERSION) throw new Error('bad version: ' + version);
            const iv = buf.subarray(1, 13);
            const tag = buf.subarray(13, 29);
            const ct = buf.subarray(29);
            const key = deriveKey(masterB64, userId);
            const dec = createDecipheriv('aes-256-gcm', key, iv);
            dec.setAuthTag(tag);
            return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
        }

        const cmd = process.argv[2];
        const masterB64 = process.argv[3];
        const userId = process.argv[4];
        if (cmd === 'encrypt') {
            const plain = process.argv[5];
            const ivHex = process.argv[6];
            process.stdout.write(encrypt(plain, masterB64, userId, ivHex));
        } else if (cmd === 'decrypt') {
            const blobHex = process.argv[5];
            process.stdout.write(decrypt(blobHex, masterB64, userId));
        } else {
            process.exit(2);
        }
    """))

    # 1) Node encrypts -> Python decrypts.
    iv_hex = "0a" * 12  # Deterministic IV so the test is reproducible.
    node_blob_hex = subprocess.check_output([
        "node", str(node_script), "encrypt", master_key_b64, user_id, plain, iv_hex,
    ], timeout=60).decode()
    node_blob = bytes.fromhex(node_blob_hex)
    assert node_blob[0] == 1
    assert decrypt_token(node_blob, user_id) == plain

    # 2) Python encrypts -> Node decrypts.
    py_blob = encrypt_token(plain, user_id)
    py_decrypted_by_node = subprocess.check_output([
        "node", str(node_script), "decrypt", master_key_b64, user_id, py_blob.hex(),
    ], timeout=60).decode()
    assert py_decrypted_by_node == plain

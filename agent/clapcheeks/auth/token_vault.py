"""AI-8766 — Python side of the platform-token vault.

Wire-format compatible with ``web/lib/crypto/token-vault.ts``::

    byte 0       : version (currently 1)
    bytes 1..12  : iv (12 random bytes)
    bytes 13..28 : GCM auth tag (16 bytes)
    bytes 29..   : ciphertext

Per-user key = scrypt(MASTER_KEY, salt=user_id, n=16384, r=8, p=1, length=32).

The Python ``cryptography`` ``AESGCM`` helper concatenates ciphertext+tag and
hides the auth tag from the caller, which makes wire-compat with Node's
``crypto`` (which exposes ``getAuthTag()`` separately) awkward. We use the
lower-level ``Cipher`` API so we can place the tag exactly where Node puts
it.

Master key MUST be set via the ``CLAPCHEEKS_TOKEN_MASTER_KEY`` env var as a
base64-encoded 32-byte value (``openssl rand -base64 32``).
"""

from __future__ import annotations

import base64
import os
from typing import Final

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

VERSION: Final[int] = 1
IV_BYTES: Final[int] = 12
TAG_BYTES: Final[int] = 16
KEY_BYTES: Final[int] = 32
HEADER_BYTES: Final[int] = 1 + IV_BYTES + TAG_BYTES  # 29

SCRYPT_N: Final[int] = 16384
SCRYPT_R: Final[int] = 8
SCRYPT_P: Final[int] = 1


class TokenVaultError(RuntimeError):
    """Raised when encryption / decryption fails for a recoverable reason
    (bad version, malformed blob, missing master key)."""


def _master_key() -> bytes:
    raw = os.environ.get("CLAPCHEEKS_TOKEN_MASTER_KEY")
    if not raw:
        raise TokenVaultError(
            "CLAPCHEEKS_TOKEN_MASTER_KEY not set. "
            "Generate with: openssl rand -base64 32"
        )
    raw = raw.strip().replace("-", "+").replace("_", "/")
    # Pad if missing trailing '='. base64.b64decode is strict about length.
    pad = "=" * (-len(raw) % 4)
    try:
        key = base64.b64decode(raw + pad)
    except Exception as exc:  # noqa: BLE001
        raise TokenVaultError(f"CLAPCHEEKS_TOKEN_MASTER_KEY is not valid base64: {exc}") from exc
    if len(key) != KEY_BYTES:
        raise TokenVaultError(
            f"CLAPCHEEKS_TOKEN_MASTER_KEY must decode to {KEY_BYTES} bytes, got {len(key)}"
        )
    return key


def _derive_key(user_id: str) -> bytes:
    if not user_id:
        raise TokenVaultError("user_id required for key derivation")
    kdf = Scrypt(
        salt=user_id.encode("utf-8"),
        length=KEY_BYTES,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
    )
    return kdf.derive(_master_key())


def encrypt_token(plaintext: str, user_id: str) -> bytes:
    """Encrypt ``plaintext`` (UTF-8 string) for ``user_id``.

    Returns wire-format bytes suitable for writing directly into a Postgres
    ``bytea`` column.
    """
    if not isinstance(plaintext, str):
        raise TokenVaultError("plaintext must be str")
    key = _derive_key(user_id)
    iv = os.urandom(IV_BYTES)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
    ct = encryptor.update(plaintext.encode("utf-8")) + encryptor.finalize()
    tag = encryptor.tag
    if len(tag) != TAG_BYTES:
        raise TokenVaultError(f"unexpected GCM tag length {len(tag)}")
    return bytes([VERSION]) + iv + tag + ct


def decrypt_token(blob: bytes | bytearray | memoryview, user_id: str) -> str:
    """Decrypt a wire-format blob for ``user_id``.

    Raises ``TokenVaultError`` for recoverable issues (bad version,
    truncated blob). Raises ``cryptography.exceptions.InvalidTag`` if the
    blob was tampered with or encrypted under a different key.
    """
    buf = bytes(blob)
    if len(buf) < HEADER_BYTES + 1:
        raise TokenVaultError(f"blob too short ({len(buf)} bytes)")
    version = buf[0]
    if version != VERSION:
        raise TokenVaultError(f"unsupported vault version {version}")
    iv = buf[1 : 1 + IV_BYTES]
    tag = buf[1 + IV_BYTES : HEADER_BYTES]
    ct = buf[HEADER_BYTES:]
    key = _derive_key(user_id)
    decryptor = Cipher(algorithms.AES(key), modes.GCM(iv, tag)).decryptor()
    pt = decryptor.update(ct) + decryptor.finalize()
    return pt.decode("utf-8")


def decrypt_token_supabase(value, user_id: str) -> str | None:
    """Decrypt a value as returned by supabase-py for a ``bytea`` column.

    supabase-py / PostgREST return ``bytea`` columns as a string in one of
    two forms depending on configuration:

    * ``"\\xDEADBEEF..."`` — Postgres hex format
    * base64 — when the request includes the binary content-type header

    This helper handles both, plus the case where the column is already
    ``bytes`` (e.g. when called from psycopg directly). Returns ``None`` if
    the value is empty / falsy.
    """
    if value in (None, "", b""):
        return None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return decrypt_token(value, user_id)
    if isinstance(value, str):
        if value.startswith("\\x"):
            return decrypt_token(bytes.fromhex(value[2:]), user_id)
        # Try base64; fall back to hex without prefix.
        try:
            return decrypt_token(base64.b64decode(value), user_id)
        except Exception:
            try:
                return decrypt_token(bytes.fromhex(value), user_id)
            except Exception as exc:  # noqa: BLE001
                raise TokenVaultError(
                    f"unrecognised bytea encoding for token: {exc}"
                ) from exc
    raise TokenVaultError(f"unsupported token value type: {type(value).__name__}")


__all__ = [
    "encrypt_token",
    "decrypt_token",
    "decrypt_token_supabase",
    "TokenVaultError",
    "VERSION",
    "IV_BYTES",
    "TAG_BYTES",
    "KEY_BYTES",
    "HEADER_BYTES",
]

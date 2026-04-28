"""Authentication helpers for Clapcheeks (token vault, key derivation).

Submodules:
    token_vault — AES-256-GCM encryption / decryption for platform tokens
                  stored in clapcheeks_user_settings.*_enc columns.
"""

from clapcheeks.auth.token_vault import (
    encrypt_token,
    decrypt_token,
    TokenVaultError,
)

__all__ = ["encrypt_token", "decrypt_token", "TokenVaultError"]

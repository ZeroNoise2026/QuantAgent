"""
auth.py — Supabase JWT verification for FastAPI.

Verifies tokens issued by Supabase Auth (legacy HS256 mode) and exposes
a FastAPI dependency that returns the authenticated user's UUID.

Usage:
    from auth import get_current_user

    @app.get("/api/something")
    def handler(user_id: str = Depends(get_current_user)):
        ...
"""

from __future__ import annotations

import logging
from typing import Optional

import jwt
from fastapi import Header, HTTPException, status

from config import SUPABASE_JWT_SECRET

logger = logging.getLogger(__name__)

# Supabase access tokens always carry aud="authenticated" for logged-in users.
_AUDIENCE = "authenticated"


def _decode(token: str) -> dict:
    if not SUPABASE_JWT_SECRET:
        # Misconfiguration — never silently accept tokens.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET not configured on server.",
        )
    try:
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience=_AUDIENCE,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired.")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience.")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    """FastAPI dependency. Returns the user's UUID (string) from a Bearer JWT.

    Raises 401 if the header is missing/malformed or the token is invalid.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header (expected 'Bearer <jwt>').",
        )
    token = authorization.split(" ", 1)[1].strip()
    payload = _decode(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject (sub) claim.")
    return user_id


def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Like get_current_user, but returns None instead of raising if no/invalid token.
    Useful for endpoints that work both authenticated and anonymously."""
    if not authorization:
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None

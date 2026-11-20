"""API call settings, read at call time. ANTHROPIC_SPEED=fast enables fast mode (Opus 5.5);
ANTHROPIC_EFFORT=low|medium|high sets effort. If fast mode is unavailable, falls back to standard speed."""
import logging
import os

import anthropic

log = logging.getLogger("apiopts")
_fast_ok = True


def api_create(client, **kw):
    global _fast_ok
    extra = {}
    if os.getenv("ANTHROPIC_SPEED") == "fast" and _fast_ok:
        extra["speed"] = "fast"
    if os.getenv("ANTHROPIC_EFFORT"):
        extra["output_config"] = {"effort": os.getenv("ANTHROPIC_EFFORT")}
    try:
        return client.messages.create(extra_body=extra or None, **kw)
    except (anthropic.BadRequestError, anthropic.PermissionDeniedError, anthropic.RateLimitError) as e:
        if extra.get("speed") != "fast":
            raise
        if not isinstance(e, anthropic.RateLimitError):
            _fast_ok = False  # this key or model can't use fast mode; stop trying
        log.warning("fast mode unavailable (%s: %s), using standard speed", type(e).__name__, str(e)[:160])
        extra.pop("speed")
        return client.messages.create(extra_body=extra or None, **kw)

"""Entry point — run the harness as `python -m ws_harness`."""

from __future__ import annotations

import asyncio
import sys

from .colors import verdict_interrupted
from .flow import run


async def main() -> int:
    """Run the full frontend flow."""
    return await run()


if __name__ == "__main__":
    try:
        rc = asyncio.run(main())
        sys.exit(rc)
    except KeyboardInterrupt:
        verdict_interrupted()
        sys.exit(130)

"""Terminal color utilities — ANSI color codes for status output."""

from __future__ import annotations

# ANSI escape sequences
C_RESET = "\033[0m"
C_GREEN = "\033[92m"
C_YELLOW = "\033[93m"
C_BLUE = "\033[94m"
C_CYAN = "\033[96m"
C_RED = "\033[91m"
C_BOLD = "\033[1m"
C_DIM = "\033[2m"


def color(code: str, text: str) -> str:
    """Wrap text with ANSI color code."""
    return f"{code}{text}{C_RESET}"


def multi_color(codes: str, text: str) -> str:
    """Wrap text with multiple ANSI color codes (e.g. C_BOLD + C_CYAN)."""
    return f"{codes}{text}{C_RESET}"


def banner(title: str) -> None:
    """Print a cyan bold banner title."""
    print(f"\n{multi_color(C_BOLD + C_CYAN, f'═══ {title} ═══')}")


def info(text: str) -> None:
    """Print dim gray info line."""
    print(f"  {color(C_DIM, '→ ')}{text}")


def ok(text: str) -> None:
    """Print green success line."""
    print(f"  {color(C_GREEN, '✓ ')}{text}")


def warn(text: str) -> None:
    """Print yellow warning line."""
    print(f"  {color(C_YELLOW, '⚠ ')}{text}")


def err(text: str) -> None:
    """Print red error line."""
    print(f"  {color(C_RED, '✗ ')}{text}")


def verdict_stable() -> None:
    """Print green stable verdict."""
    print(f"\n{color(C_GREEN, '✓ WS CONNECTION STABLE')}")


def verdict_stall() -> None:
    """Print red stall verdict."""
    print(f"\n{color(C_RED, '✗ CONNECTION STALL')}")


def verdict_inconclusive() -> None:
    """Print yellow inconclusive verdict."""
    print(f"\n{color(C_YELLOW, '⚠ INCONCLUSIVE')}")


def verdict_interrupted() -> None:
    """Print yellow interrupted message."""
    print(f"\n{color(C_YELLOW, 'Interrupted by user')}")

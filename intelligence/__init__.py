"""Aeris intelligence layer (TDD §5).

Pure-Python, dependency-free, fully unit-testable. Each stage is a separate module:
quality (§5.1) · environmental (§5.2) · exposure (§5.3) · baseline (§5.4) ·
pattern (§5.5) · decision (§5.6) · persistence/hysteresis/cooldown (§5.7) · explain (§5.8).

Medical-safety invariants enforced across the layer (TDD §1.2, §9, §14):
- invalid PM sensor never produces a PM-based caution
- stale data is reported as stale/no-data, never reused as "current"
- every decision carries reason_codes, freshness and sample size
- the word "SAFE" is never emitted as a medical assurance
"""

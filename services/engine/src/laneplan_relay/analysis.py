"""The deterministic relay engine.

These are the parts of laneplan-relay that must never be a model call. A relay chain either
closes a loop or it does not, and a chain either fits inside the visit budget or it does not.
Those are arithmetic and graph facts, so they are code.

Every function here is pure:
  - no clock (the planning minute is an argument),
  - no network,
  - no randomness,
  - no filesystem,
  - no reliance on dict iteration order (every emitted collection is explicitly sorted).

So two calls with equal arguments produce byte-identical output, which is the property the
whole product is selling. See docs/adr/0002-python-engine-boundary.md.
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from .protocol import EngineError

ENGINE_VERSION: Final[str] = "1.0.0"

MAX_FACILITIES: Final[int] = 2000
MAX_LANES: Final[int] = 8000
MAX_LEGS_CAP: Final[int] = 64
WHITE: Final[int] = 0
GREY: Final[int] = 1
BLACK: Final[int] = 2

# Risk band cut-offs. Named because an unexplained 66 in a scoring function is a decision
# nobody can review.
BAND_HIGH: Final[int] = 66
BAND_MODERATE: Final[int] = 33

# A full day of slack, in minutes, is the denominator for window tightness.
DAY_MINUTES: Final[int] = 1440
# Dwell beyond eight hours is treated as maximum pressure.
DWELL_PRESSURE_CEILING: Final[int] = 480


# --------------------------------------------------------------------------- record ops
# Generic structural helpers. Kept because the CLI and MCP surfaces expose them as tools;
# they operate on records, not on relay networks.


class Record(TypedDict):
    id: str
    kind: str
    payload: dict[str, Any]
    createdAt: int
    updatedAt: int


class NormalizeInput(TypedDict):
    records: list[Record]


class NormalizedRecord(TypedDict):
    id: str
    kind: str
    fields: dict[str, Any]
    updatedAt: int


class NormalizeOutput(TypedDict):
    records: list[NormalizedRecord]
    kinds: list[str]
    count: int


class DiffInput(TypedDict):
    before: list[Record]
    after: list[Record]


class Change(TypedDict):
    id: str
    kind: str
    change: str
    fields: list[str]


class DiffOutput(TypedDict):
    added: list[str]
    removed: list[str]
    changed: list[Change]
    unchanged: int


class SummaryInput(TypedDict):
    records: list[Record]


class SummaryOutput(TypedDict):
    total: int
    byKind: dict[str, int]
    oldest: int
    newest: int


def _require_records(payload: Any, field: str) -> list[Record]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"expected an object with {field!r}")
    records = payload.get(field)
    if not isinstance(records, list):
        raise EngineError("BAD_SHAPE", f"{field!r} must be a list")
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise EngineError("BAD_SHAPE", f"{field}[{index}] must be an object")
        for key in ("id", "kind", "payload", "createdAt", "updatedAt"):
            if key not in record:
                raise EngineError("MISSING_FIELD", f"{field}[{index}] is missing {key!r}")
        if not isinstance(record["payload"], dict):
            raise EngineError("BAD_SHAPE", f"{field}[{index}].payload must be an object")
    return records


def normalize(payload: NormalizeInput) -> NormalizeOutput:
    """Flatten records into a stable, sorted, comparable shape."""
    records = _require_records(payload, "records")
    normalized: list[NormalizedRecord] = []
    for record in records:
        payload_obj = record["payload"]
        normalized.append(
            {
                "id": record["id"],
                "kind": record["kind"],
                "fields": {key: payload_obj[key] for key in sorted(payload_obj)},
                "updatedAt": record["updatedAt"],
            }
        )
    normalized.sort(key=lambda item: (item["kind"], item["id"]))
    return {
        "records": normalized,
        "kinds": sorted({item["kind"] for item in normalized}),
        "count": len(normalized),
    }


def diff(payload: DiffInput) -> DiffOutput:
    """Compute a minimal structural diff between two record sets."""
    before = {record["id"]: record for record in _require_records(payload, "before")}
    after = {record["id"]: record for record in _require_records(payload, "after")}

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed: list[Change] = []
    unchanged = 0

    for identifier in sorted(set(before) & set(after)):
        left = before[identifier]
        right = after[identifier]
        if left == right:
            unchanged += 1
            continue
        touched = sorted(
            set(left["payload"]) ^ set(right["payload"])
            | {
                key
                for key in set(left["payload"]) & set(right["payload"])
                if left["payload"][key] != right["payload"][key]
            }
        )
        changed.append(
            {"id": identifier, "kind": right["kind"], "change": "modified", "fields": touched}
        )

    return {"added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def summarize(payload: SummaryInput) -> SummaryOutput:
    """Aggregate counts without mutating or discarding anything."""
    records = _require_records(payload, "records")
    by_kind: dict[str, int] = {}
    for record in records:
        by_kind[record["kind"]] = by_kind.get(record["kind"], 0) + 1
    stamps = [record["updatedAt"] for record in records] or [0]
    return {
        "total": len(records),
        "byKind": dict(sorted(by_kind.items())),
        "oldest": min(stamps),
        "newest": max(stamps),
    }


# --------------------------------------------------------------------------- relay domain


class Facility(TypedDict):
    id: str
    name: str
    kind: str


class Lane(TypedDict):
    id: str
    fromFacility: str
    toFacility: str
    dwellMinutes: int
    transitMinutes: int
    openMinute: int
    closeMinute: int


class Network(TypedDict):
    facilities: list[Facility]
    lanes: list[Lane]


class Leg(TypedDict):
    laneId: str
    fromFacility: str
    toFacility: str
    departMinute: int
    arriveMinute: int
    dwellMinutes: int


class Plan(TypedDict):
    legs: list[Leg]
    terminus: str
    arriveMinute: int
    totalDwellMinutes: int
    laneIds: list[str]


class CycleFinding(TypedDict):
    laneId: str
    facility: str
    path: list[str]


class BudgetFinding(TypedDict):
    facility: str
    legsUsed: int
    maxLegs: int
    prunedLaneIds: list[str]


class WindowFinding(TypedDict):
    laneId: str
    facility: str
    departureMinute: int
    openMinute: int
    closeMinute: int


class WalkResult(TypedDict):
    engine: str
    plans: list[Plan]
    planCount: int
    legsWalked: int
    branchesPruned: int
    cycle: CycleFinding | None
    budget: BudgetFinding | None
    windowMiss: WindowFinding | None
    maxLegs: int
    startFacility: str


class CyclesResult(TypedDict):
    engine: str
    cycles: list[CycleFinding]
    count: int
    acyclic: bool


class Factor(TypedDict):
    name: str
    weight: int
    value: float
    contribution: float
    detail: str


class ScoreResult(TypedDict):
    engine: str
    facility: str
    score: int
    band: str
    factors: list[Factor]
    recommendation: str


def _require_int(value: Any, name: str, *, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise EngineError("BAD_SHAPE", f"{name} must be an integer")
    if not low <= value <= high:
        raise EngineError("OUT_OF_RANGE", f"{name} must be between {low} and {high}, got {value}")
    return value


def _require_network(payload: Any) -> Network:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with 'network'")
    network = payload.get("network")
    if not isinstance(network, dict):
        raise EngineError("BAD_SHAPE", "'network' must be an object")
    facilities = network.get("facilities")
    lanes = network.get("lanes")
    if not isinstance(facilities, list) or not isinstance(lanes, list):
        raise EngineError("BAD_SHAPE", "'network' needs 'facilities' and 'lanes' lists")
    if len(facilities) > MAX_FACILITIES:
        raise EngineError("INPUT_TOO_LARGE", f"network has more than {MAX_FACILITIES} facilities")
    if len(lanes) > MAX_LANES:
        raise EngineError("INPUT_TOO_LARGE", f"network has more than {MAX_LANES} lanes")

    known = _require_facilities(facilities)
    _require_lanes(lanes, known)

    return {"facilities": facilities, "lanes": lanes}


def _require_facilities(facilities: list[Any]) -> set[str]:
    """Validate facility ids and return the set lanes are checked against."""
    known: set[str] = set()
    for index, facility in enumerate(facilities):
        if not isinstance(facility, dict):
            raise EngineError("BAD_SHAPE", f"facilities[{index}] must be an object")
        identifier = facility.get("id")
        if not isinstance(identifier, str) or not identifier:
            raise EngineError("BAD_SHAPE", f"facilities[{index}].id must be a non-empty string")
        if identifier in known:
            raise EngineError("DUPLICATE", f"facility id {identifier!r} appears twice")
        known.add(identifier)
    return known


def _require_lanes(lanes: list[Any], known: set[str]) -> None:
    seen_lanes: set[str] = set()
    for index, lane in enumerate(lanes):
        if not isinstance(lane, dict):
            raise EngineError("BAD_SHAPE", f"lanes[{index}] must be an object")
        lane_id = lane.get("id")
        if not isinstance(lane_id, str) or not lane_id:
            raise EngineError("BAD_SHAPE", f"lanes[{index}].id must be a non-empty string")
        if lane_id in seen_lanes:
            raise EngineError("DUPLICATE", f"lane id {lane_id!r} appears twice")
        seen_lanes.add(lane_id)
        for end in ("fromFacility", "toFacility"):
            target = lane.get(end)
            if target not in known:
                raise EngineError("UNKNOWN_FACILITY", f"lane {lane_id!r} references unknown {end}")
        _require_int(lane.get("dwellMinutes"), f"lane {lane_id!r} dwellMinutes", low=0, high=10080)
        _require_int(
            lane.get("transitMinutes"), f"lane {lane_id!r} transitMinutes", low=0, high=10080
        )
        open_minute = _require_int(
            lane.get("openMinute"), f"lane {lane_id!r} openMinute", low=0, high=10**7
        )
        close_minute = _require_int(
            lane.get("closeMinute"), f"lane {lane_id!r} closeMinute", low=0, high=10**7
        )
        if close_minute < open_minute:
            raise EngineError("BAD_SHAPE", f"lane {lane_id!r} closes before it opens")


def _adjacency(network: Network) -> dict[str, list[Lane]]:
    """Outbound lanes per facility, ordered by (openMinute, id) so a walk is reproducible."""
    adjacency: dict[str, list[Lane]] = {
        facility["id"]: [] for facility in network["facilities"]
    }
    for lane in network["lanes"]:
        adjacency.setdefault(lane["fromFacility"], []).append(lane)
    for lanes in adjacency.values():
        lanes.sort(key=lambda lane: (lane["openMinute"], lane["id"]))
    return adjacency


class _WalkState:
    """Mutable counters for one walk. Never escapes the function that created it."""

    def __init__(self) -> None:
        self.legs_walked = 0
        self.branches_pruned = 0
        self.cycle: CycleFinding | None = None
        self.budget: BudgetFinding | None = None
        self.window_miss: WindowFinding | None = None


class _Walk:
    """Everything one traversal needs, so the recursive step stays small and explicit."""

    def __init__(self, adjacency: dict[str, list[Lane]], max_legs: int) -> None:
        self.adjacency = adjacency
        self.max_legs = max_legs
        self.plans: list[Plan] = []
        self.state = _WalkState()


def _note_cycle(state: _WalkState, lane: Lane, path: list[str]) -> None:
    state.branches_pruned += 1
    if state.cycle is None:
        state.cycle = {
            "laneId": lane["id"],
            "facility": lane["toFacility"],
            "path": [*path, lane["toFacility"]],
        }


def _note_window(state: _WalkState, lane: Lane, facility: str, departure: int) -> None:
    state.branches_pruned += 1
    if state.window_miss is None:
        state.window_miss = {
            "laneId": lane["id"],
            "facility": facility,
            "departureMinute": departure,
            "openMinute": lane["openMinute"],
            "closeMinute": lane["closeMinute"],
        }


def _note_budget(state: _WalkState, facility: str, legs_used: int, max_legs: int, lanes: list[Lane]) -> None:
    state.branches_pruned += 1
    if state.budget is None:
        state.budget = {
            "facility": facility,
            "legsUsed": legs_used,
            "maxLegs": max_legs,
            "prunedLaneIds": [lane["id"] for lane in lanes],
        }


def _descend(
    facility: str,
    arrive_minute: int,
    legs: list[Leg],
    path: list[str],
    walk: _Walk,
) -> None:
    lanes = walk.adjacency.get(facility, [])
    if not lanes:
        # A facility with no outbound lane is a terminus: the chain ends here and is a plan.
        # Arriving at one on the first hop is a dead end, not a zero-leg plan.
        if legs:
            walk.plans.append(_as_plan(legs, facility, arrive_minute))
        else:
            walk.state.branches_pruned += 1
        return
    if len(legs) >= walk.max_legs:
        _note_budget(walk.state, facility, len(legs), walk.max_legs, lanes)
        return

    for lane in lanes:
        departure = arrive_minute + lane["dwellMinutes"]
        if departure < lane["openMinute"] or departure > lane["closeMinute"]:
            _note_window(walk.state, lane, facility, departure)
            continue
        if lane["toFacility"] in path:
            _note_cycle(walk.state, lane, path)
            continue
        walk.state.legs_walked += 1
        _descend(
            lane["toFacility"],
            departure + lane["transitMinutes"],
            [
                *legs,
                {
                    "laneId": lane["id"],
                    "fromFacility": facility,
                    "toFacility": lane["toFacility"],
                    "departMinute": departure,
                    "arriveMinute": departure + lane["transitMinutes"],
                    "dwellMinutes": lane["dwellMinutes"],
                },
            ],
            [*path, lane["toFacility"]],
            walk,
        )


def _as_plan(legs: list[Leg], terminus: str, arrive_minute: int) -> Plan:
    return {
        "legs": legs,
        "terminus": terminus,
        "arriveMinute": arrive_minute,
        "totalDwellMinutes": sum(leg["dwellMinutes"] for leg in legs),
        "laneIds": [leg["laneId"] for leg in legs],
    }


def _plan_sort_key(plan: Plan) -> tuple[int, int, tuple[str, ...]]:
    return (plan["arriveMinute"], len(plan["legs"]), tuple(plan["laneIds"]))


def walk_relay_graph(payload: Any) -> WalkResult:
    """Walk the declared lane graph and report what the walk found.

    The walk is depth-first over outbound lanes ordered by (openMinute, id). It stops a branch
    for exactly three reasons, and records the first occurrence of each:

      cycle      a lane returns to a facility already on the path
      budget     the chain has used its whole leg allowance with lanes still available
      window     the departure falls outside the lane's open/close window

    A chain that reaches a facility with no outbound lane is a plan. Plans are ranked by
    arrival, then leg count, then lane ids, so equal input always yields equal output.
    """
    network = _require_network(payload)
    start_facility = payload.get("startFacility")
    if not isinstance(start_facility, str) or not start_facility:
        raise EngineError("BAD_SHAPE", "'startFacility' must be a non-empty string")
    start_minute = _require_int(payload.get("startMinute", 0), "startMinute", low=0, high=10**7)
    max_legs = _require_int(payload.get("maxLegs", 8), "maxLegs", low=1, high=MAX_LEGS_CAP)
    max_plans = _require_int(payload.get("maxPlans", 25), "maxPlans", low=1, high=500)

    adjacency = _adjacency(network)
    if start_facility not in adjacency:
        raise EngineError("UNKNOWN_FACILITY", f"startFacility {start_facility!r} is not in the network")

    walk = _Walk(adjacency, max_legs)
    _descend(start_facility, start_minute, [], [start_facility], walk)
    plans = walk.plans
    state = walk.state
    plans.sort(key=_plan_sort_key)

    return {
        "engine": ENGINE_VERSION,
        "plans": plans[:max_plans],
        "planCount": len(plans),
        "legsWalked": state.legs_walked,
        "branchesPruned": state.branches_pruned,
        "cycle": state.cycle,
        "budget": state.budget,
        "windowMiss": state.window_miss,
        "maxLegs": max_legs,
        "startFacility": start_facility,
    }


def _canonical_cycle(path: list[str], lane_id: str) -> CycleFinding:
    """Rotate a closed path so it starts at its lexicographically smallest facility."""
    ring = path[:-1]
    if not ring:
        return {"laneId": lane_id, "facility": path[-1], "path": list(path)}
    pivot = min(range(len(ring)), key=lambda index: ring[index])
    rotated = ring[pivot:] + ring[:pivot]
    return {
        "laneId": lane_id,
        "facility": rotated[0],
        "path": [*rotated, rotated[0]],
    }


def find_cycles(payload: Any) -> CyclesResult:
    """Enumerate every distinct cycle in the lane graph, ignoring time entirely.

    Uses an iterative depth-first search with three-colour marking, so a deep network cannot
    exhaust the interpreter stack. Each cycle is rotated to a canonical starting facility and
    the result is sorted, which makes this usable as a regression check on a declared network.
    """
    network = _require_network(payload)
    adjacency = _adjacency(network)

    colour: dict[str, int] = {facility: WHITE for facility in adjacency}
    found: list[CycleFinding] = []

    for root in sorted(adjacency):
        if colour[root] != WHITE:
            continue
        colour[root] = GREY
        path: list[str] = [root]
        on_path: set[str] = {root}
        stack: list[tuple[str, Any]] = [(root, iter(adjacency.get(root, [])))]

        while stack:
            node, lanes = stack[-1]
            descended = False
            for lane in lanes:
                nxt = lane["toFacility"]
                if nxt in on_path:
                    found.append(_canonical_cycle([*path, nxt], lane["id"]))
                elif nxt in adjacency and colour[nxt] == WHITE:
                    colour[nxt] = GREY
                    path.append(nxt)
                    on_path.add(nxt)
                    stack.append((nxt, iter(adjacency[nxt])))
                    descended = True
                    break
            if descended:
                continue
            stack.pop()
            colour[node] = BLACK
            on_path.discard(node)
            path.pop()

    unique = {(tuple(item["path"]), item["laneId"]): item for item in found}
    cycles = [unique[key] for key in sorted(unique)]

    return {"engine": ENGINE_VERSION, "cycles": cycles, "count": len(cycles), "acyclic": not cycles}


def _dwell_factor(lanes: list[Lane]) -> Factor:
    """Longest declared dwell out of this facility is the pressure it creates."""
    if not lanes:
        return {
            "name": "dwell_pressure",
            "weight": 35,
            "value": 0.0,
            "contribution": 0.0,
            "detail": "no outbound lanes: this facility is a terminus, not a handoff",
        }
    dwell = max(lane["dwellMinutes"] for lane in lanes)
    ratio = min(dwell / float(DWELL_PRESSURE_CEILING), 1.0)
    return {
        "name": "dwell_pressure",
        "weight": 35,
        "value": round(ratio, 4),
        "contribution": round(ratio * 35, 2),
        "detail": f"longest dwell out of this facility is {dwell} min",
    }


def _tightness_factor(lanes: list[Lane], arrival: int) -> Factor:
    """A tight window is the risk, so this scores tightness (1 - slack), not slack."""
    headroom = min(
        (min(lane["closeMinute"] - arrival, lane["openMinute"] + DAY_MINUTES - arrival) + 1)
        / float(DAY_MINUTES)
        for lane in lanes
    )
    tightness = 1.0 - min(max(headroom, 0.0), 1.0)
    return {
        "name": "window_tightness",
        "weight": 30,
        "value": round(tightness, 4),
        "contribution": round(tightness * 30, 2),
        "detail": (
            f"arriving at minute {arrival}, tightest lane window leaves "
            f"{round(headroom * DAY_MINUTES)} min of slack"
        ),
    }


def _fanout_factor(lanes: list[Lane]) -> Factor:
    ratio = min(len(lanes) / 6.0, 1.0)
    return {
        "name": "fanout",
        "weight": 20,
        "value": round(ratio, 4),
        "contribution": round(ratio * 20, 2),
        "detail": f"{len(lanes)} outbound lane(s) from this facility",
    }


def _criticality_factor(network: Network, facility: str) -> Factor:
    inbound = sum(1 for lane in network["lanes"] if lane["toFacility"] == facility)
    ratio = min(inbound / 4.0, 1.0)
    return {
        "name": "inbound_criticality",
        "weight": 15,
        "value": round(ratio, 4),
        "contribution": round(ratio * 15, 2),
        "detail": f"{inbound} inbound lane(s) depend on this facility",
    }


def _band(score: int) -> str:
    if score >= BAND_HIGH:
        return "high"
    if score >= BAND_MODERATE:
        return "moderate"
    return "low"


def _recommendation(facility: str, band: str) -> str:
    if band == "high":
        return (
            f"Re-time the handoff at {facility}: confirm a receiving slot before committing "
            "the lane, because the chain already spends most of its budget getting here."
        )
    if band == "moderate":
        return (
            f"Book the slot at {facility} early and hold one fallback lane; the declared "
            "windows leave little slack if the inbound leg runs late."
        )
    return (
        f"{facility} is comfortable to hand off through; the declared windows and dwell "
        "leave room for the inbound leg to vary."
    )


def score_handoff(payload: Any) -> ScoreResult:
    """Score one facility's handoff risk from the network alone.

    Weighted factors, each normalised to 0..1 before weighting, so the score is explainable
    line by line rather than a single opaque number. Read the factors, not just the total.
    """
    network = _require_network(payload)
    facility = payload.get("facility")
    if not isinstance(facility, str) or not facility:
        raise EngineError("BAD_SHAPE", "'facility' must be a non-empty string")
    arrival = _require_int(payload.get("arrivalMinute", 0), "arrivalMinute", low=0, high=10**7)

    adjacency = _adjacency(network)
    if facility not in adjacency:
        raise EngineError("UNKNOWN_FACILITY", f"facility {facility!r} is not in the network")
    lanes = adjacency[facility]

    factors = [_dwell_factor(lanes)]
    if lanes:
        factors.append(_tightness_factor(lanes, arrival))
        factors.append(_fanout_factor(lanes))
    factors.append(_criticality_factor(network, facility))

    total = sum(factor["contribution"] for factor in factors)
    score = int(round(min(total, 100.0)))
    band = _band(score)

    return {
        "engine": ENGINE_VERSION,
        "facility": facility,
        "score": score,
        "band": band,
        "factors": factors,
        "recommendation": _recommendation(facility, band),
    }


OPERATIONS: Final[dict[str, Any]] = {
    "normalize": normalize,
    "diff": diff,
    "summarize": summarize,
    "walk_relay_graph": walk_relay_graph,
    "find_cycles": find_cycles,
    "score_handoff": score_handoff,
}


def analyse(op: str, payload: Any) -> Any:
    handler = OPERATIONS.get(op)
    if handler is None:
        known = ", ".join(sorted(OPERATIONS))
        raise EngineError("UNKNOWN_OP", f"unknown op {op!r}; available: {known}")
    return handler(payload)

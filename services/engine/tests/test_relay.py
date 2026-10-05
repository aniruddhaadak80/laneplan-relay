"""Tests for the relay engine.

The properties that matter here are: a cycle is reported, a budget breach is reported, and
equal input always produces equal output. Everything else is detail.
"""

from __future__ import annotations

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from laneplan_relay.analysis import ENGINE_VERSION, find_cycles, score_handoff, walk_relay_graph
from laneplan_relay.protocol import EngineError


def facility(identifier: str, kind: str = "depot") -> dict[str, object]:
    return {"id": identifier, "name": identifier.upper(), "kind": kind}


def lane(  # noqa: PLR0913 - a fixture builder: every lane field is independently interesting
    lane_id: str,
    source: str,
    target: str,
    *,
    dwell: int = 10,
    transit: int = 60,
    open_minute: int = 0,
    close_minute: int = 10080,
) -> dict[str, object]:
    return {
        "id": lane_id,
        "fromFacility": source,
        "toFacility": target,
        "dwellMinutes": dwell,
        "transitMinutes": transit,
        "openMinute": open_minute,
        "closeMinute": close_minute,
    }


def network(facilities: list[dict[str, object]], lanes: list[dict[str, object]]) -> dict[str, object]:
    return {"facilities": facilities, "lanes": lanes}


LINE = network(
    [facility("A", "port"), facility("B", "hub"), facility("C", "lastmile")],
    [
        lane("ab", "A", "B", dwell=30, transit=120),
        lane("bc", "B", "C", dwell=20, transit=45),
    ],
)

LOOP = network(
    [facility("A"), facility("B"), facility("C")],
    [
        lane("ab", "A", "B"),
        lane("bc", "B", "C"),
        lane("ca", "C", "A"),
    ],
)


class TestWalk:
    def test_linear_chain_yields_one_plan(self) -> None:
        result = walk_relay_graph(
            {"network": LINE, "startFacility": "A", "startMinute": 0, "maxLegs": 8}
        )
        assert result["engine"] == ENGINE_VERSION
        assert result["planCount"] == 1
        assert result["plans"][0]["terminus"] == "C"
        assert result["plans"][0]["laneIds"] == ["ab", "bc"]

    def test_arrival_accumulates_dwell_and_transit(self) -> None:
        result = walk_relay_graph({"network": LINE, "startFacility": "A", "startMinute": 0})
        plan = result["plans"][0]
        assert plan["arriveMinute"] == 30 + 120 + 20 + 45
        assert plan["totalDwellMinutes"] == 50

    def test_reports_the_closing_edge_of_a_cycle(self) -> None:
        result = walk_relay_graph({"network": LOOP, "startFacility": "A", "maxLegs": 8})
        assert result["cycle"] is not None
        assert result["cycle"]["laneId"] == "ca"
        assert result["cycle"]["facility"] == "A"
        assert result["cycle"]["path"] == ["A", "B", "C", "A"]

    def test_cycle_is_suppressed_by_the_visit_budget(self) -> None:
        result = walk_relay_graph({"network": LOOP, "startFacility": "A", "maxLegs": 2})
        assert result["cycle"] is None
        assert result["budget"] is not None
        assert result["budget"]["facility"] == "C"
        assert result["budget"]["maxLegs"] == 2

    def test_reports_the_first_window_miss(self) -> None:
        shut = network(
            [facility("A"), facility("B")],
            [lane("ab", "A", "B", dwell=0, transit=60, open_minute=500, close_minute=600)],
        )
        result = walk_relay_graph({"network": shut, "startFacility": "A", "startMinute": 0})
        assert result["windowMiss"] == {
            "laneId": "ab",
            "facility": "A",
            "departureMinute": 0,
            "openMinute": 500,
            "closeMinute": 600,
        }
        assert result["planCount"] == 0

    def test_plans_are_ranked_by_arrival(self) -> None:
        two_routes = network(
            [facility("A"), facility("B"), facility("C"), facility("D")],
            [
                lane("slow", "A", "B", transit=600),
                lane("fast", "A", "C", transit=60),
                lane("cb", "C", "D", transit=30),
            ],
        )
        result = walk_relay_graph({"network": two_routes, "startFacility": "A"})
        assert result["plans"][0]["laneIds"] == ["fast", "cb"]

    def test_terminus_with_no_outbound_lane_is_a_plan(self) -> None:
        dead = network([facility("A"), facility("B")], [])
        result = walk_relay_graph({"network": dead, "startFacility": "A"})
        assert result["planCount"] == 0
        assert result["legsWalked"] == 0

    def test_unknown_start_facility_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            walk_relay_graph({"network": LINE, "startFacility": "ZZ"})
        assert caught.value.code == "UNKNOWN_FACILITY"

    def test_rejects_a_lane_pointing_nowhere(self) -> None:
        with pytest.raises(EngineError) as caught:
            walk_relay_graph(
                {
                    "network": network([facility("A")], [lane("x", "A", "GHOST")]),
                    "startFacility": "A",
                }
            )
        assert caught.value.code == "UNKNOWN_FACILITY"

    def test_rejects_a_duplicate_lane_id(self) -> None:
        duplicated = network(
            [facility("A"), facility("B")], [lane("x", "A", "B"), lane("x", "A", "B")]
        )
        with pytest.raises(EngineError) as caught:
            walk_relay_graph({"network": duplicated, "startFacility": "A"})
        assert caught.value.code == "DUPLICATE"

    def test_rejects_an_out_of_range_budget(self) -> None:
        with pytest.raises(EngineError) as caught:
            walk_relay_graph({"network": LINE, "startFacility": "A", "maxLegs": 0})
        assert caught.value.code == "OUT_OF_RANGE"

    def test_rejects_a_boolean_smuggled_in_as_an_integer(self) -> None:
        with pytest.raises(EngineError) as caught:
            walk_relay_graph({"network": LINE, "startFacility": "A", "maxLegs": True})
        assert caught.value.code == "BAD_SHAPE"

    def test_result_is_json_serialisable_and_stable(self) -> None:
        first = walk_relay_graph({"network": LOOP, "startFacility": "A"})
        second = walk_relay_graph({"network": LOOP, "startFacility": "A"})
        assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)

    @settings(max_examples=25, deadline=None)
    @given(
        dwell=st.integers(min_value=0, max_value=600),
        transit=st.integers(min_value=0, max_value=600),
        start=st.integers(min_value=0, max_value=5000),
    )
    def test_walk_is_deterministic_for_any_timing(self, dwell: int, transit: int, start: int) -> None:
        net = network(
            [facility("A"), facility("B"), facility("C")],
            [
                lane("ab", "A", "B", dwell=dwell, transit=transit),
                lane("bc", "B", "C", dwell=dwell, transit=transit),
            ],
        )
        payload = {"network": net, "startFacility": "A", "startMinute": start}
        assert json.dumps(walk_relay_graph(payload), sort_keys=True) == json.dumps(
            walk_relay_graph(payload), sort_keys=True
        )

    @settings(max_examples=25, deadline=None)
    @given(legs=st.integers(min_value=1, max_value=12))
    def test_a_chain_never_exceeds_the_budget(self, legs: int) -> None:
        net = network(
            [facility("A"), facility("B"), facility("C")],
            [lane("ab", "A", "B"), lane("bc", "B", "C")],
        )
        result = walk_relay_graph({"network": net, "startFacility": "A", "maxLegs": legs})
        for plan in result["plans"]:
            assert len(plan["legs"]) <= legs


class TestFindCycles:
    def test_acyclic_network(self) -> None:
        result = find_cycles({"network": LINE})
        assert result["acyclic"] is True
        assert result["count"] == 0

    def test_finds_a_simple_loop(self) -> None:
        result = find_cycles({"network": LOOP})
        assert result["count"] == 1
        assert result["cycles"][0]["path"] == ["A", "B", "C", "A"]

    def test_cycle_is_reported_from_its_smallest_facility(self) -> None:
        net = network(
            [facility("Z"), facility("M"), facility("A")],
            [lane("zm", "Z", "M"), lane("ma", "M", "A"), lane("az", "A", "Z")],
        )
        result = find_cycles({"network": net})
        assert result["cycles"][0]["path"] == ["A", "Z", "M", "A"]

    def test_a_deep_chain_does_not_exhaust_the_stack(self) -> None:
        depth = 1500
        facilities = [facility(f"F{index:05d}") for index in range(depth)]
        lanes = [
            lane(f"L{index:05d}", f"F{index:05d}", f"F{index + 1:05d}")
            for index in range(depth - 1)
        ]
        result = find_cycles({"network": network(facilities, lanes)})
        assert result["acyclic"] is True


class TestScoreHandoff:
    def test_reports_weighted_factors(self) -> None:
        result = score_handoff({"network": LINE, "facility": "B", "arrivalMinute": 0})
        assert result["engine"] == ENGINE_VERSION
        assert result["facility"] == "B"
        names = [factor["name"] for factor in result["factors"]]
        assert names == ["dwell_pressure", "window_tightness", "fanout", "inbound_criticality"]
        assert all(0.0 <= factor["value"] <= 1.0 for factor in result["factors"])
        assert 0 <= result["score"] <= 100
        assert result["band"] in {"low", "moderate", "high"}

    def test_contributions_sum_to_the_score(self) -> None:
        result = score_handoff({"network": LINE, "facility": "B", "arrivalMinute": 0})
        assert round(sum(f["contribution"] for f in result["factors"])) == result["score"]

    def test_a_terminus_scores_low_and_explains_itself(self) -> None:
        result = score_handoff({"network": LINE, "facility": "C"})
        assert result["band"] == "low"
        assert result["score"] < 15
        assert "terminus" in result["factors"][0]["detail"]

    def test_a_tight_window_scores_higher_than_a_slack_one(self) -> None:
        tight = network(
            [facility("A"), facility("B")],
            [lane("ab", "A", "B", open_minute=0, close_minute=10)],
        )
        slack = network([facility("A"), facility("B")], [lane("ab", "A", "B")])
        tight_score = score_handoff({"network": tight, "facility": "A", "arrivalMinute": 0})
        slack_score = score_handoff({"network": slack, "facility": "A", "arrivalMinute": 0})
        assert tight_score["score"] > slack_score["score"]

    def test_recommendation_is_actionable(self) -> None:
        result = score_handoff({"network": LINE, "facility": "B"})
        assert len(result["recommendation"]) > 40

    def test_rejects_an_unknown_facility(self) -> None:
        with pytest.raises(EngineError) as caught:
            score_handoff({"network": LINE, "facility": "NOPE"})
        assert caught.value.code == "UNKNOWN_FACILITY"

    @settings(max_examples=25, deadline=None)
    @given(arrival=st.integers(min_value=0, max_value=10000))
    def test_score_is_deterministic_for_any_arrival(self, arrival: int) -> None:
        payload = {"network": LINE, "facility": "B", "arrivalMinute": arrival}
        assert json.dumps(score_handoff(payload), sort_keys=True) == json.dumps(
            score_handoff(payload), sort_keys=True
        )

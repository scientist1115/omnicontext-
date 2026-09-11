#!/usr/bin/env python3
"""
OmniContext 단순화 공학 시뮬레이터

지원 도메인:
  - thermal_1d      : 1D 비정상 열전도 (유한차분법, explicit scheme)
  - electrical_dc    : 저항망 DC 회로 (노드 전압법, 선형대수)
  - mechanical_beam  : 보(beam) 처짐 (Euler-Bernoulli 이론식)
  - risk_probability : 위험 요인 조합에 따른 확률 몬테카를로 시뮬레이션
                        (실제 통계 데이터가 아니라 입력한 가정치 기반 추정)

사용법: 표준입력(stdin)으로 JSON을 받아서 표준출력(stdout)으로 JSON 결과를 냅니다.
    echo '{"domain": "thermal_1d", "params": {...}}' | python3 simulate.py

주의: 이건 진짜 CFD/FEA가 아니라 "이론적으로 말이 되는지" 정도를 확인하는
단순화된 1D/2D 모델입니다. 복잡한 실제 형상, 난류, 비선형 재료 물성 등은
반영하지 않습니다.
"""

import sys
import json
import numpy as np


def simulate_thermal_1d(p):
    """1D 비정상 열전도. 양쪽 경계조건은 고정온도(dirichlet) 또는 단열(neumann=0).

    params:
      length_m: 막대/판 길이
      n_nodes: 격자점 개수 (기본 50)
      thermal_diffusivity_m2s: 열확산율 alpha = k / (rho * cp)
      initial_temp_c: 초기 전체 온도
      left_bc: {"type": "fixed"|"insulated", "value": 온도(옵션)}
      right_bc: 위와 동일
      duration_s: 시뮬레이션 시간
    """
    L = float(p["length_m"])
    N = int(p.get("n_nodes", 50))
    alpha = float(p["thermal_diffusivity_m2s"])
    T0 = float(p.get("initial_temp_c", 25))
    duration = float(p["duration_s"])

    dx = L / (N - 1)
    # 안정 조건(CFL)을 만족하도록 dt 자동 계산
    dt = 0.4 * dx ** 2 / alpha
    steps = max(1, int(duration / dt))

    T = np.full(N, T0, dtype=float)

    left_bc = p.get("left_bc", {"type": "insulated"})
    right_bc = p.get("right_bc", {"type": "insulated"})

    r = alpha * dt / dx ** 2

    for _ in range(steps):
        T_new = T.copy()
        T_new[1:-1] = T[1:-1] + r * (T[2:] - 2 * T[1:-1] + T[:-2])

        if left_bc["type"] == "fixed":
            T_new[0] = float(left_bc["value"])
        else:  # insulated: 단열 -> 이웃과 동일 (제로 플럭스)
            T_new[0] = T_new[1]

        if right_bc["type"] == "fixed":
            T_new[-1] = float(right_bc["value"])
        else:
            T_new[-1] = T_new[-2]

        T = T_new

    return {
        "domain": "thermal_1d",
        "grid_points": N,
        "dx_m": dx,
        "dt_s": dt,
        "steps_simulated": steps,
        "final_temperature_profile_c": [round(float(x), 3) for x in T],
        "min_temp_c": round(float(T.min()), 3),
        "max_temp_c": round(float(T.max()), 3),
        "note": "explicit 유한차분법, CFL 안정조건 기반 자동 시간간격",
    }


def simulate_electrical_dc(p):
    """저항망 DC 회로. 노드 전압법(modified nodal analysis)으로 해석.

    params:
      nodes: ["n1", "n2", ...] 노드 이름 목록
      ground_node: 접지로 삼을 노드 이름
      resistors: [{"from": "n1", "to": "n2", "ohm": 100}, ...]
      voltage_source: {"positive": "n1", "negative": "gnd", "volts": 5}
    """
    nodes = list(p["nodes"])
    ground = p["ground_node"]
    resistors = p["resistors"]
    vsrc = p["voltage_source"]

    free_nodes = [n for n in nodes if n != ground]
    idx = {n: i for i, n in enumerate(free_nodes)}
    n = len(free_nodes)

    G = np.zeros((n, n))
    I = np.zeros(n)

    def stamp_conductance(a, b, g):
        if a != ground:
            G[idx[a], idx[a]] += g
            if b != ground:
                G[idx[a], idx[b]] -= g
        if b != ground:
            G[idx[b], idx[b]] += g
            if a != ground:
                G[idx[b], idx[a]] -= g

    for r_ in resistors:
        g = 1.0 / float(r_["ohm"])
        stamp_conductance(r_["from"], r_["to"], g)

    # 전압원은 매우 큰 컨덕턴스로 근사 (간단한 모델링)
    BIG = 1e6
    pos, neg, volts = vsrc["positive"], vsrc["negative"], float(vsrc["volts"])
    if pos != ground:
        G[idx[pos], idx[pos]] += BIG
        I[idx[pos]] += BIG * volts if neg == ground else 0
    if neg != ground:
        G[idx[neg], idx[neg]] += BIG
        I[idx[neg]] -= BIG * volts if pos == ground else 0
    if pos != ground and neg != ground:
        G[idx[pos], idx[neg]] -= BIG
        G[idx[neg], idx[pos]] -= BIG

    V = np.linalg.solve(G, I)
    voltages = {ground: 0.0}
    for node_name, i in idx.items():
        voltages[node_name] = round(float(V[i]), 5)

    currents = []
    for r_ in resistors:
        va = voltages[r_["from"]]
        vb = voltages[r_["to"]]
        i_amp = (va - vb) / float(r_["ohm"])
        currents.append({
            "from": r_["from"], "to": r_["to"],
            "ohm": r_["ohm"], "current_a": round(float(i_amp), 6),
        })

    return {
        "domain": "electrical_dc",
        "node_voltages_v": voltages,
        "branch_currents": currents,
        "note": "노드 전압법 기반 선형 DC 회로 해석 (전압원은 이상적 전압원으로 근사)",
    }


def simulate_mechanical_beam(p):
    """Euler-Bernoulli 보 처짐 이론식.

    params:
      length_m, elastic_modulus_pa, moment_of_inertia_m4
      support_type: "cantilever" | "simply_supported"
      load_type: "point" | "distributed"
      load_n: 점하중(N) (point일 때)
      load_position_m: 점하중 위치 (cantilever는 자유단 기준 무시하고 끝단 가정 가능)
      load_n_per_m: 분포하중(N/m) (distributed일 때)
    """
    L = float(p["length_m"])
    E = float(p["elastic_modulus_pa"])
    I_ = float(p["moment_of_inertia_m4"])
    support = p.get("support_type", "cantilever")
    load_type = p.get("load_type", "point")

    x = np.linspace(0, L, 100)
    EI = E * I_

    if support == "cantilever" and load_type == "point":
        P = float(p["load_n"])
        a = float(p.get("load_position_m", L))
        y = np.where(
            x <= a,
            (P * x ** 2 * (3 * a - x)) / (6 * EI),
            (P * a ** 2 * (3 * x - a)) / (6 * EI),
        )
        max_defl = P * a ** 2 * (3 * L - a) / (6 * EI) if a <= L else None

    elif support == "cantilever" and load_type == "distributed":
        w = float(p["load_n_per_m"])
        y = (w * x ** 2 * (6 * L ** 2 - 4 * L * x + x ** 2)) / (24 * EI)
        max_defl = w * L ** 4 / (8 * EI)

    elif support == "simply_supported" and load_type == "point":
        P = float(p["load_n"])
        a = float(p.get("load_position_m", L / 2))
        b = L - a
        y = np.where(
            x <= a,
            (P * b * x * (L ** 2 - b ** 2 - x ** 2)) / (6 * L * EI),
            (P * a * (L - x) * (2 * L * x - a ** 2 - x ** 2)) / (6 * L * EI),
        )
        max_defl = (P * b * (L ** 2 - b ** 2) ** 1.5) / (9 * np.sqrt(3) * L * EI) if b < L else None

    else:  # simply_supported + distributed
        w = float(p["load_n_per_m"])
        y = (w * x * (L ** 3 - 2 * L * x ** 2 + x ** 3)) / (24 * EI)
        max_defl = 5 * w * L ** 4 / (384 * EI)

    return {
        "domain": "mechanical_beam",
        "support_type": support,
        "load_type": load_type,
        "max_deflection_m": round(float(max_defl), 8) if max_defl is not None else None,
        "deflection_profile_sample": [round(float(v), 8) for v in y[::10]],
        "note": "Euler-Bernoulli 보 이론 기준 선형탄성 해석 (전단변형 미반영)",
    }


def simulate_risk_probability(p):
    """위험 요인 조합에 따른 사건 발생 확률을 몬테카를로 시뮬레이션으로 추정.

    중요: 실제 통계 데이터를 쓰는 게 아니라, 사용자/AI가 입력한 "이 요인이
    위험을 몇 배 높인다"는 가정(odds_multiplier)을 바탕으로 계산합니다.
    결과는 그 가정이 맞다는 전제 하의 이론적 추정치일 뿐입니다.

    params:
      trials: 시행 횟수 (기본 100000)
      base_probability: 아무 위험 요인 없을 때 기본 발생 확률 (0~1)
      factors: [
        {
          "name": "빗길",
          "odds_multiplier": 2.5,      # 이 요인이 있으면 승산(odds)이 몇 배가 되는지 가정
          "uncertainty_pct": 20,        # 그 가정치의 불확실성 (±%, 몬테카를로에서 흔들어줌)
          "prevalence": 1.0             # 이 시나리오에서 이 요인이 적용될 확률 (0~1, 기본 1=항상 적용)
        }, ...
      ]
    """
    trials = int(p.get("trials", 100000))
    base_p = float(p["base_probability"])
    base_p = min(max(base_p, 1e-6), 1 - 1e-6)
    base_logit = np.log(base_p / (1 - base_p))

    factors = p.get("factors", [])
    rng = np.random.default_rng(42)

    logits = np.full(trials, base_logit)
    factor_summ = []

    for f in factors:
        mult = float(f["odds_multiplier"])
        unc = float(f.get("uncertainty_pct", 0)) / 100.0
        prevalence = float(f.get("prevalence", 1.0))

        active = rng.random(trials) < prevalence
        # 가정치 자체도 불확실하다고 보고, 로그정규분포로 흔들어줌
        sampled_mult = rng.normal(mult, mult * unc, trials) if unc > 0 else np.full(trials, mult)
        sampled_mult = np.clip(sampled_mult, 1e-3, None)

        logits += np.where(active, np.log(sampled_mult), 0.0)
        factor_summ.append({
            "name": f.get("name", "요인"),
            "assumed_odds_multiplier": mult,
            "applied_in_pct_of_trials": round(float(active.mean() * 100), 1),
        })

    probs = 1 / (1 + np.exp(-logits))
    outcomes = rng.random(trials) < probs

    overall = float(outcomes.mean())
    # 90% 신뢰구간은 시행을 100개 배치로 나눠 배치별 비율의 5~95 백분위로 근사
    batch_size = max(1, trials // 100)
    n_batches = trials // batch_size
    batch_rates = outcomes[: n_batches * batch_size].reshape(n_batches, batch_size).mean(axis=1)
    ci_low, ci_high = np.percentile(batch_rates, [5, 95])

    hist_counts, hist_edges = np.histogram(probs, bins=12, range=(0, 1))

    return {
        "domain": "risk_probability",
        "trials": trials,
        "overall_probability_pct": round(overall * 100, 2),
        "ci_90_low_pct": round(float(ci_low) * 100, 2),
        "ci_90_high_pct": round(float(ci_high) * 100, 2),
        "factor_breakdown": factor_summ,
        "probability_histogram": {
            "bin_edges_pct": [round(float(e) * 100, 1) for e in hist_edges],
            "counts": [int(c) for c in hist_counts],
        },
        "note": "실제 통계가 아니라 입력된 가정치(odds_multiplier) 기반 몬테카를로 추정치입니다. 가정이 달라지면 결과도 크게 달라집니다.",
    }


DOMAINS = {
    "thermal_1d": simulate_thermal_1d,
    "electrical_dc": simulate_electrical_dc,
    "mechanical_beam": simulate_mechanical_beam,
    "risk_probability": simulate_risk_probability,
}


def main():
    try:
        raw = sys.stdin.read()
        req = json.loads(raw)
        domain = req["domain"]
        params = req["params"]

        if domain not in DOMAINS:
            print(json.dumps({"error": f"지원하지 않는 도메인: {domain}. 사용 가능: {list(DOMAINS.keys())}"}))
            sys.exit(1)

        result = DOMAINS[domain](params)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()

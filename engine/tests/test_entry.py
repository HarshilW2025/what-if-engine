from app.sandbox import wie


def test_chelyabinsk_airburst():
    r = wie.entry(19, 19, 18, 3300)
    assert r["outcome"] == "airburst" and 25 < r["burst_alt_km"] < 45  # observed: brightest near 30 km
    assert 0.3 < r["energy_mt"] < 0.7  # observed: about 0.4 to 0.5 Mt


def test_tunguska_airburst():
    r = wie.entry(60, 15, 45, 3000)
    assert r["outcome"] == "airburst" and 3 < r["burst_alt_km"] < 15  # estimated burst at 5 to 10 km


def test_big_rock_hits_almost_unslowed():
    r = wie.entry(1000, 20, 45, 3000)
    assert r["outcome"] == "ground impact" and r["impact_speed_kms"] > 19
    assert 0 <= r["air_energy_mt"] < 0.05 * r["energy_mt"]


def test_grazing_entry_skips_out():
    assert wie.entry(20, 12, 5, 3000)["outcome"] == "skips back to space"


def test_other_worlds():
    assert wie.entry(100, 15, 45, 3000, planet="mars")["outcome"] == "ground impact"  # thin air
    assert wie.entry(100, 15, 45, 3000, planet="venus")["outcome"] == "airburst"  # thick air screens small rocks

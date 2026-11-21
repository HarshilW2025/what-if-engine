"""ScenarioSpec: the single contract between Claude, the validator, the engines and the UI.

Units keep numbers near 1 so floating point error stays small:
  gravity     AU, years, solar masses (G = 4 pi^2)
  relativity  light years, years, fractions of c, g = 9.80665 m/s^2
  black hole  solar masses; distances in Schwarzschild radii
  cosmology   km/s/Mpc, Gyr, density fractions (Omega)
  quantum     dimensionless units (hbar = m = 1)
"""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

Tier = Literal["exact", "theory", "unknown"]
Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]


class _Strict(BaseModel):
    """Rejects unknown fields, so a typo from the model fails loudly."""
    model_config = ConfigDict(extra="forbid")


# ---------- gravity (N-body, REBOUND IAS15) ----------
class Body(_Strict):
    name: str = Field(min_length=1, max_length=40)
    mass_msun: float = Field(ge=0, le=1e12, description="0 means a massless test particle")
    pos_au: Vec3
    vel_au_yr: Vec3
    radius_au: float = Field(default=0.0, ge=0, le=1e4, description="used for merges; 0 = point")
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class Change(_Strict):
    """The what if moment. Before it, the system runs exactly as it is today."""
    t_yr: float = Field(gt=0, description="when the what if happens, 10 to 30% into the run")
    label: str = Field(min_length=1, max_length=120, description="what happens, in plain words: 'The Sun vanishes'")
    remove: list[str] = Field(default_factory=list, max_length=50, description="bodies that vanish")
    mass_factor: dict[str, float] = Field(default_factory=dict, description="body name to mass multiplier (2 = twice as massive)")
    speed_factor: dict[str, float] = Field(default_factory=dict, description="body name to speed multiplier relative to the most massive other body (0 stops it)")
    moves: list[Body] = Field(default_factory=list, max_length=50, description="existing bodies given a new mass, position and velocity, relative to relative_to")
    appear: list[str] = Field(default_factory=list, max_length=50, description="names of bodies in bodies that only exist after the change; their pos_au and vel_au_yr are relative to relative_to")
    relative_to: str | None = Field(default=None, description="body that moves and appear are placed relative to; none means the centre of mass frame")


class GravityParams(_Strict):
    engine: Literal["gravity"] = "gravity"
    bodies: list[Body] = Field(min_length=1, max_length=200)
    duration_yr: float = Field(gt=0, le=1e7)
    frames: int = Field(default=1500, ge=10, le=4000)
    gravity_speed: Literal["instant", "delayed_naive"] = "instant"
    gr_1pn: bool = Field(default=False, description="Einstein-Infeld-Hoffmann 1PN correction")
    gw_radiation: bool = Field(default=False, description="Peters / 2.5PN orbital decay")
    collisions: Literal["none", "merge"] = "merge"
    g_scale: float = Field(default=1.0, gt=0, le=1e3, description="multiplies G")
    mond: bool = Field(default=False, description="theory tier: Milgrom force law")
    change: Change | None = Field(default=None, description="the what if moment: today's system runs first, then this happens")

    @model_validator(mode="after")
    def _check(self) -> "GravityParams":
        if not any(b.mass_msun > 0 for b in self.bodies):
            raise ValueError("at least one body must have mass > 0")
        names = [b.name for b in self.bodies]
        if len(set(names)) != len(names):
            raise ValueError("body names must be unique")
        c = self.change
        if c is not None:
            used = set(c.remove) | set(c.mass_factor) | set(c.speed_factor) | {b.name for b in c.moves} | set(c.appear) | ({c.relative_to} if c.relative_to else set())
            unknown = used - set(names)
            if unknown:
                raise ValueError(f"change names unknown bodies: {sorted(unknown)}")
            if c.t_yr >= self.duration_yr:
                raise ValueError("change.t_yr must be inside the run")
            if c.relative_to and c.relative_to in set(c.remove) | set(c.appear):
                raise ValueError("relative_to must exist at the moment of the change")
            if any(k < 0 for k in [*c.mass_factor.values(), *c.speed_factor.values()]):
                raise ValueError("mass_factor and speed_factor must be 0 or more")
            if not any(b.mass_msun > 0 for b in self.bodies if b.name not in c.appear):
                raise ValueError("before the change at least one body must have mass")
        return self


# ---------- special relativity ----------
class RelativityParams(_Strict):
    engine: Literal["relativity"] = "relativity"
    mode: Literal["cruise", "rocket", "faster_than_light"]
    distance_ly: float = Field(gt=0, le=1e11)
    speed_c: float | None = Field(default=None, gt=0, le=1000)
    accel_g: float | None = Field(default=None, gt=0, le=1000)
    flip_midway: bool = Field(default=True, description="rocket decelerates for the second half")
    frames: int = Field(default=600, ge=10, le=4000)

    @model_validator(mode="after")
    def _check(self) -> "RelativityParams":
        if self.mode == "cruise" and (self.speed_c is None or self.speed_c >= 1):
            raise ValueError("cruise needs 0 < speed_c < 1")
        if self.mode == "rocket" and self.accel_g is None:
            raise ValueError("rocket needs accel_g")
        if self.mode == "faster_than_light" and (self.speed_c is None or self.speed_c <= 1):
            raise ValueError("faster_than_light needs speed_c > 1")
        return self


# ---------- black holes ----------
class BlackHoleParams(_Strict):
    engine: Literal["blackhole"] = "blackhole"
    mass_msun: float = Field(gt=0, le=1e11)
    spin: float = Field(default=0.0, ge=0, le=0.998, description="Kerr spin a/M; 0 = Schwarzschild")
    observer_r_rs: float = Field(default=10.0, gt=1.0, le=1e6, description="camera distance in Schwarzschild radii")
    infall: bool = False
    accretion_disk: bool = True
    evaporate: bool = Field(default=False, description="Hawking evaporation timeline")
    white_hole_bounce: bool = Field(default=False, description="theory tier: Rovelli and Vidotto")


# ---------- cosmology (Friedmann equation) ----------
class CosmologyParams(_Strict):
    engine: Literal["cosmology"] = "cosmology"
    h0: float = Field(default=67.4, gt=10, le=500, description="km/s/Mpc, Planck 2018 default")
    omega_m: float = Field(default=0.315, ge=0, le=10)
    omega_r: float = Field(default=9.0e-5, ge=0, le=1)
    omega_de: float = Field(default=0.685, ge=-5, le=10)
    w0: float = Field(default=-1.0, ge=-5, le=1, description="CPL dark energy w(a) = w0 + wa(1 - a)")
    wa: float = Field(default=0.0, ge=-5, le=5)
    t_max_gyr: float = Field(default=100.0, gt=0, le=1e4)
    bounce: bool = Field(default=False, description="theory tier: bounce instead of a crunch")
    frames: int = Field(default=600, ge=10, le=4000)

    @property
    def omega_k(self) -> float:
        return 1.0 - (self.omega_m + self.omega_r + self.omega_de)


# ---------- quantum (split-step Fourier) ----------
class QuantumParams(_Strict):
    engine: Literal["quantum"] = "quantum"
    dims: Literal[1, 2] = 1
    potential: Literal["free", "barrier", "step", "harmonic", "double_slit"]
    k0: float = Field(default=5.0, gt=-50, lt=50, description="wave packet momentum")
    sigma: float = Field(default=1.0, gt=0.05, le=20, description="wave packet width")
    v0: float = Field(default=10.0, ge=-1000, le=1000, description="barrier or step height")
    width: float = Field(default=1.0, gt=0, le=50)
    grid: int = Field(default=1024, ge=64, le=4096)
    duration: float = Field(default=4.0, gt=0, le=100)
    frames: int = Field(default=300, ge=10, le=2000)

    @model_validator(mode="after")
    def _check(self) -> "QuantumParams":
        if self.grid & (self.grid - 1):
            raise ValueError("grid must be a power of two")
        if self.dims == 2 and self.grid > 512:
            raise ValueError("2D grid must be 512 or smaller")
        if self.potential == "double_slit" and self.dims != 2:
            raise ValueError("double_slit needs dims = 2")
        return self


# ---------- tier 3: no simulation ----------
class NoSimParams(_Strict):
    engine: Literal["none"] = "none"
    reason: str = Field(min_length=1, max_length=700)


EngineParams = Annotated[
    Union[GravityParams, RelativityParams, BlackHoleParams, CosmologyParams, QuantumParams, NoSimParams],
    Field(discriminator="engine"),
]


class ScenarioSpec(_Strict):
    tier: Tier
    title: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=1, max_length=500)
    params: EngineParams
    cards: list[str] = Field(default_factory=list, max_length=10, description="theory card ids used")
    assumptions: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def _tier_rules(self) -> "ScenarioSpec":
        engine = self.params.engine
        if self.tier == "unknown" and engine != "none":
            raise ValueError("unknown tier must not run a simulation (engine must be 'none')")
        if self.tier != "unknown" and engine == "none":
            raise ValueError("exact and theory tiers need a real engine")
        if self.tier == "theory" and not self.cards:
            raise ValueError("theory tier must cite at least one theory card")
        return self


def spec_json_schema() -> dict:
    """JSON Schema for the Claude tool definition."""
    return ScenarioSpec.model_json_schema()

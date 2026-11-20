from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Support = Literal["consensus", "mainstream-candidate", "significant-minority", "minority", "fringe"]


class Theory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    proponents: str = Field(default="", max_length=120)
    support: Support
    summary: str = Field(min_length=1, max_length=500)
    simulated: bool = False
    card: str | None = Field(default=None, max_length=60)


class ModelSpec(BaseModel):
    """A Claude-written physics model. tier 'theory' carries the competing scientific pictures."""

    model_config = ConfigDict(extra="forbid")
    tier: Literal["exact", "theory"]
    title: str = Field(min_length=1, max_length=80)
    assumptions: list[str] = Field(default_factory=list, max_length=12)
    theories: list[Theory] = Field(default_factory=list, max_length=5)
    code: str = Field(min_length=20, max_length=30000)

    @model_validator(mode="after")
    def _rules(self):
        if self.tier == "theory":
            if len(self.theories) < 2:
                raise ValueError("tier 'theory' needs 2 to 5 competing theories")
            if sum(t.simulated for t in self.theories) != 1:
                raise ValueError("exactly one theory must have simulated: true")
        return self

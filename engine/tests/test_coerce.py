from pydantic import BaseModel, ConfigDict

from app.ai.coerce import as_list, fix_tool_input


def test_wrapped_json_list():
    assert as_list('<parameter name="problems">["a", "b"]</parameter>') == ["a", "b"]


def test_parameter_items():
    v = '\n<parameter name="item">one</parameter>\n<parameter name="item">two</parameter>'
    assert as_list(v) == ["one", "two"]


def test_item_tags_and_plain():
    assert as_list("<item>x</item><item>y</item>") == ["x", "y"]
    assert as_list("just one") == ["just one"]
    assert as_list(["a"]) == ["a"]


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str
    assumptions: list[str]


def test_fix_tool_input_folds_stray_item():
    raw = {"answer": "hi", "assumptions": '\n<parameter name="item">a</parameter>', "item": "b"}
    assert M.model_validate(fix_tool_input(M, raw)).assumptions == ["a", "b"]


def test_reviewer_uses_shared_helper():
    from app.ai import reviewer
    assert reviewer._as_list("<item>p</item>") == ["p"]

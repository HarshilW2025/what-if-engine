"""Repairs list fields that Claude sometimes sends as one string of tool markup."""
import json
import re
import types
import typing

_WRAP_OPEN = re.compile(r'^\s*<parameter name="[^"]*">\s*')
_WRAP_CLOSE = re.compile(r'\s*</parameter>\s*$')
_SPLIT = re.compile(r'</?parameter[^>]*>|</?item>')
_STRAY = ("item", "items", "parameter")


def as_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return list(v)
    if not isinstance(v, str):
        return [v]
    s = _WRAP_CLOSE.sub("", _WRAP_OPEN.sub("", v.strip()))
    if s.startswith("["):
        try:
            x = json.loads(s)
            if isinstance(x, list):
                return x
        except ValueError:
            pass
    if "<parameter" in s or "<item>" in s:
        return [p.strip() for p in _SPLIT.split(s) if p.strip()]
    return [s] if s else []


def _is_list(ann):
    if ann is list or typing.get_origin(ann) is list:
        return True
    if typing.get_origin(ann) in (typing.Union, types.UnionType):
        return any(_is_list(a) for a in typing.get_args(ann) if a is not type(None))
    return False


def fix_tool_input(cls, data):
    """Before validation: turn garbled list strings into lists and fold stray item keys back in."""
    if not isinstance(data, dict):
        return data
    data = dict(data)
    fields = getattr(cls, "model_fields", {})
    garbled = []
    for name, f in fields.items():
        if isinstance(data.get(name), str) and _is_list(f.annotation):
            data[name] = as_list(data[name])
            garbled.append(name)
    for k in _STRAY:
        if k in data and k not in fields:
            extra = data.pop(k)
            if len(garbled) == 1:
                data[garbled[0]] = list(data[garbled[0]]) + as_list(extra)
    return data

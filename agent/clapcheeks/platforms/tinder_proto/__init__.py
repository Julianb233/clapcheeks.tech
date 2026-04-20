"""Generated Tinder protobuf modules live here.

Drop the `*_pb2.py` files produced by `protoc --python_out=...` into this
directory. The TinderAPIClient seams in `../tinder_api.py` will import from
this package once the modules are present.

Expected modules (names match what the Tinder iOS app ships; rename as
needed):
    rate_pb2.py         — rate/like/pass requests
    recs_pb2.py         — /v2/recs/core response
    matches_pb2.py      — /v2/matches list
    messages_pb2.py     — /user/matches/<id> message send

Do NOT commit the generated modules — they're derived from a proprietary IPA
and their legal status is uncertain. This directory is included so the import
path is stable even while the modules are absent.
"""

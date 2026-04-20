# tinder_proto/

Generated Tinder protobuf modules go here. See
`docs/SETUP_TINDER_TOKEN.md` for the extraction flow (protoc + blackbox-protobuf).

**Expected files** (names are conventions — adjust `tinder_api.py` imports to
match what you actually generate):

```
rate_pb2.py          # /like/<rec_id> and /pass/<rec_id> bodies
recs_pb2.py          # /v2/recs/core response
matches_pb2.py       # /v2/matches list
messages_pb2.py      # /user/matches/<id> outbound message
```

Once the files are in place, fill in the `_encode_*` / `_decode_*` seams in
`../tinder_api.py` and flip `CLAPCHEEKS_TINDER_MODE=api` in
`~/.clapcheeks/.env`.

This directory is gitignored by convention — the modules derive from a
proprietary IPA and should not be committed.

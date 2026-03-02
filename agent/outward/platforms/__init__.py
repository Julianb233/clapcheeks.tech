"""Platform automation — mode-agnostic swipe/match/message logic.

Each platform module (tinder.py, bumble.py, hinge.py) uses the driver
provided by SessionManager — it doesn't know or care whether the driver
is iPhone USB, iPhone WiFi, or Mac cloud.
"""
